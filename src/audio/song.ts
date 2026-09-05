/**
 * Song compiler (IM-7): a lane's song is its CHAIN of patterns, concatenated
 * by musical position. Pure function, exact times — the only scheduling
 * authority (D2–D4) alongside compileLaneEvents, which it drives per segment.
 *
 * Semantics (documented decisions):
 * - Chain length (steps) = sum of the member patterns' bars × 16. Each pattern
 *   occupies a SEGMENT at a chain-local start step. Pattern bar counts are
 *   1/2/4 → segment offsets are always multiples of 16 (EVEN), so swing parity
 *   inside a pattern is preserved exactly: chain time of pattern-local step s
 *   in a segment starting at O is timeAtStep(O + s) = O·spb + timeAtStep(s).
 *   (With an odd O the swung odd steps would shift — impossible here.)
 * - Empty-chain fallback: if a lane's chain is empty, or every id in it fails
 *   to resolve, the lane falls back to its FIRST pattern looping (a one-
 *   segment chain). Unknown ids inside a non-empty chain are skipped.
 * - The chain loops as a whole (iteration = chainSteps). Per-lane chains may
 *   differ in length: each lane wraps independently against the transport's
 *   monotonic global step (poly-loop). LL-2: the transport's cycle basis is
 *   the LCM of the lane chain totals (playhead/position/one-shot semantics);
 *   per-lane sweeps key on each lane's own chainSteps (laneCycleSteps).
 * - Events are grouped by chain-local STEP (byStep) so the session can deliver
 *   per scheduled tick and mutate the map for quantized live switching.
 */

import { compileLaneEvents } from "./compile";
import { type GrooveOptions, stepOfTimeBounded } from "./time";
import {
  type DrumKit,
  type VoiceNoteOnEvent,
  type VoicePreset,
} from "./presets";
import {
  type LaneGate,
  type LaneId,
  type Pattern,
  type ProjectDocument,
} from "../document/schema";
import { type EffectiveScale, effectiveScale } from "../document/scales";
import { getDrumKit, getPreset } from "./presets";

/** One pattern slot inside a lane's chain. */
export interface LaneSegment {
  readonly patternId: string;
  /** Chain-local step where this segment starts. */
  readonly startStep: number;
  /** Steps in this segment (bars × 16). */
  readonly steps: number;
}

/** A lane's compiled playback schedule for one chain iteration. */
export interface LaneSchedule {
  /** Total steps in one chain iteration (sum of segment steps). */
  readonly chainSteps: number;
  readonly segments: readonly LaneSegment[];
  /**
   * Compiled events keyed by chain-local step (event times are exact
   * timeAtStep of that chain-local step — grouping is lossless).
   */
  readonly byStep: ReadonlyMap<number, readonly VoiceNoteOnEvent[]>;
}

export interface LaneScheduleInput {
  /** Resolved patterns in chain order (ids may repeat). */
  readonly chain: readonly Pattern[];
  readonly preset: VoicePreset | DrumKit;
  readonly gate: LaneGate;
  readonly groove: GrooveOptions;
  readonly scale?: EffectiveScale;
  readonly stackChord?: boolean;
  /** RC-1 (v3): per-lane register offset in octaves (see compile.ts). */
  readonly octaveOffset?: number;
}

/**
 * Resolve a lane's chain ids to patterns. Empty chain / all-unknown ids →
 * [first pattern] (documented fallback). Unknown ids inside an otherwise
 * non-empty chain are skipped.
 */
export function resolveChainPatterns(
  doc: ProjectDocument,
  lane: LaneId,
): readonly Pattern[] {
  const patterns = doc.patterns[lane];
  const resolved = doc.songChain[lane]
    .map((id) => patterns.find((p) => p.id === id))
    .filter((p): p is Pattern => p !== undefined);
  return resolved.length > 0 ? resolved : [patterns[0]];
}

/**
 * LL-2 (i3-4, seam G4): the lane's CYCLE basis — its chain total in steps
 * (sum of the resolved chain's pattern bars × 16; the same bounded
 * resolveChainPatterns scan the compiler runs, LP-1 §10). This is the
 * per-lane playhead sweep basis (LaneGrid's readFrame) and the per-lane
 * half of the `p` position announcement. 0 when the lane has no resolvable
 * pattern at all (empty pool — unreachable through the UI's store actions,
 * but never a crash here; the LCM derivation skips zeros).
 */
export function laneCycleSteps(doc: ProjectDocument, lane: LaneId): number {
  let steps = 0;
  for (const pattern of resolveChainPatterns(doc, lane)) {
    if (pattern) steps += pattern.bars * 16;
  }
  return steps;
}

/** Compile one lane's chain into a schedule. Pure; exact times. */
export function compileLaneSchedule(input: LaneScheduleInput): LaneSchedule {
  const segments: LaneSegment[] = [];
  const byStep = new Map<number, VoiceNoteOnEvent[]>();
  let cursor = 0;
  for (const pattern of input.chain) {
    const steps = pattern.bars * 16;
    segments.push({ patternId: pattern.id, startStep: cursor, steps });
    const events = compileLaneEvents({
      pattern,
      preset: input.preset,
      gate: input.gate,
      groove: input.groove,
      scale: input.scale,
      stackChord: input.stackChord,
      octaveOffset: input.octaveOffset,
    });
    for (const event of events) {
      // Compile times are loop-relative seconds; invert to the pattern-local
      // step with the same grid the compiler used (see Session.setLaneEvents).
      const local = stepOfTime(event.time, input.groove, steps);
      const chainStep = cursor + local;
      const bucket = byStep.get(chainStep);
      if (bucket) bucket.push(event);
      else byStep.set(chainStep, [event]);
    }
    cursor += steps;
  }
  return { chainSteps: cursor, segments, byStep };
}

/**
 * Inverse of timeAtStep within a pattern (boundary rule: [t(i), t(i+1))).
 * LL-1 (LP-1 §10b — seam F5): the O(steps) scan is replaced by the shared
 * bounded lookup (time.ts stepOfTimeBounded — the same division-floor guess
 * + ≤3 exact predicates, bit-identical by construction). This runs once per
 * compiled event inside compileLaneSchedule, which made every pitched edit
 * recompile cost O(notes × steps) — 276-438 ms at 128 bars musical density
 * before, 2.5-4.3 ms after (LP-1 §10c).
 */
function stepOfTime(t: number, groove: GrooveOptions, steps: number): number {
  return stepOfTimeBounded(t, groove, steps);
}

/** Compile every lane's chain (full-song scheduling). */
export function compileSong(
  doc: ProjectDocument,
  groove: GrooveOptions,
): Record<LaneId, LaneSchedule> {
  const out = {} as Record<LaneId, LaneSchedule>;
  for (const laneConf of doc.lanes) {
    const lane = laneConf.id;
    if (doc.patterns[lane].length === 0) continue;
    const chain = resolveChainPatterns(doc, lane);
    out[lane] =
      lane === "drums"
        ? compileLaneSchedule({
            chain,
            preset: getDrumKit(laneConf.kitId) ?? getDrumKit("kit-default")!,
            gate: laneConf.gate,
            groove,
          })
        : compileLaneSchedule({
            chain,
            preset: getPreset(laneConf.presetId) ?? getPreset("preset-lead-1")!,
            gate: laneConf.gate,
            groove,
            scale: effectiveScale(doc, lane),
            stackChord: lane === "chords",
            // RC-1 (v3): the lane's register offset rides the one compiler.
            octaveOffset: laneConf.octave ?? 0,
          });
  }
  return out;
}
