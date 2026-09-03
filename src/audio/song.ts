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
 *   monotonic global step (poly-loop). Loop toggle/loopBars remain transport
 *   (playhead/stop) semantics; the chain is the arrangement.
 * - Events are grouped by chain-local STEP (byStep) so the session can deliver
 *   per scheduled tick and mutate the map for quantized live switching.
 */

import { compileLaneEvents } from "./compile";
import { type GrooveOptions, timeAtStep } from "./time";
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

/** Inverse of timeAtStep within a pattern (boundary rule: [t(i), t(i+1))). */
function stepOfTime(t: number, groove: GrooveOptions, steps: number): number {
  for (let i = 0; i < steps - 1; i++) {
    if (t >= timeAtStep(i, groove) && t < timeAtStep(i + 1, groove)) return i;
  }
  return steps - 1;
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
          });
  }
  return out;
}
