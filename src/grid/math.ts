/**
 * Pure grid-time math (DES-4). Everything here is DOM-free and unit-tested:
 * the renderer consumes these for the playhead sweep and trigger glow.
 *
 * Coordinates: x grows left→right across `steps` step columns of equal
 * visual width `stepWidthPx`. Musical time is loop-relative seconds with
 * swing already applied (transport timeline seconds, time.ts semantics).
 */

import {
  type GrooveOptions,
  type Position,
  secondsPerStep,
  stepIndexAtTime,
  timeAtStep,
} from "../audio/time";
import type { PitchedCell } from "../document/schema";

/**
 * LL-2 (seam G1 — the playhead-basis swap): the sweep basis is STEPS-typed
 * and carries the LANE's OWN chain-cycle total. The 60 Hz frame supplies
 * `steps` = the lane's live chain total; `t` is the transport's LCM-cycle
 * loop time (the wrap into this lane's own cycle happens inside
 * stepIndexAtTime's single modulo — the exact modulo-of-ctx-time law).
 */
export interface PlayheadOptions extends GrooveOptions {
  readonly steps: number;
}

/**
 * Playhead x position (px) for a loop-relative time on the frame's cycle
 * basis. Interpolates between the swung times of the surrounding steps so
 * the bar tracks the audio grid exactly (swing-aware), rather than assuming
 * uniform step spacing. `t` is clamped into [0, cycleLength).
 *
 * LL-2: `gridSteps` (default = the basis itself) wraps the cycle position
 * INTO THE RENDERER'S OWN PATTERN EXTENT — the LL-1 glow-modulus law
 * extended to the sweep. A single-pattern chain (grid == chain total) is
 * the identity: the sweep wraps exactly at the lane's cycle, the poly-loop
 * visual (drums 64B vs bass 4B sweep at different cycle lengths). A
 * multi-slot chain (the demo: 4×1-bar chain under a 1-bar grid) keeps the
 * per-pattern wrap — the demo's sweep is byte-identical to v0.1 while the
 * chain phase, not a pattern-local clock, drives it.
 */
export function playheadX(
  t: number,
  opts: PlayheadOptions,
  stepWidthPx: number,
  gridSteps: number = opts.steps,
): number {
  const cycleSteps = opts.steps;
  const loopLen = cycleSteps * secondsPerStep(opts.bpm);
  // LL-2: the frame's clock wraps at the TRANSPORT's (longer-or-equal) LCM
  // cycle — reduce it onto THIS lane's own cycle. STRICTLY greater wraps
  // (the LCM→lane re-base; the idiom matches time.ts's own fast path, and
  // an already-reduced t is an exact fmod no-op). t == loopLen exactly is
  // the one-shot tail's parked value (getLoopTime's non-loop clamp) — the
  // v0.1 far-right park law — so it clamps instead of wrapping.
  const local =
    t > loopLen
      ? t % loopLen
      : Math.min(Math.max(t, 0), Math.max(loopLen - 1e-9, 0));
  const step = stepIndexAtTime(local, opts);
  const t0 = timeAtStep(step, opts);
  // End of the last step = cycle end (uniform: swing only delays within
  // beats).
  const t1 = step + 1 < cycleSteps ? timeAtStep(step + 1, opts) : loopLen;
  const span = Math.max(t1 - t0, 1e-9);
  const frac = Math.min(Math.max((local - t0) / span, 0), 1);
  const grid = Math.max(1, gridSteps);
  return ((step + frac) % grid) * stepWidthPx;
}

/**
 * Quantized step under the playhead (reduced-motion column highlight, D9)
 * on the frame's cycle basis — the LANE's chain-cycle step (0..steps-1).
 * The RENDERER wraps this into its own pattern extent (the same modulus
 * the glow rides, LL-1/LL-2 — one law for sweep and glow).
 */
export function quantizedStep(t: number, opts: PlayheadOptions): number {
  const loopLen = opts.steps * secondsPerStep(opts.bpm);
  // LL-2: same LCM→lane reduction as playheadX (see there); t == loopLen
  // exactly is the one-shot tail's final step.
  const local =
    t > loopLen
      ? t % loopLen
      : Math.min(Math.max(t, 0), Math.max(loopLen - 1e-9, 0));
  return stepIndexAtTime(local, opts);
}

/**
 * Steps crossed moving from `prevStep` to `nextStep` (exclusive → inclusive,
 * wrapping at `totalSteps`). Dedupes the rAF stream: the caller fires glow
 * once per column crossing even when frames repeat or skip. A wrap fires
 * every remaining step of the old pass plus the entered steps of the new one.
 * Returns [] when prev === next (no crossing).
 */
export function stepsCrossed(
  prevStep: number | null,
  nextStep: number,
  totalStepCount: number,
): number[] {
  if (prevStep === null || prevStep === nextStep) return [];
  const out: number[] = [];
  const n = Math.max(totalStepCount, 1);
  let s = (prevStep + 1) % n;
  let guard = 0;
  while (guard < n) {
    out.push(s);
    if (s === nextStep) break;
    s = (s + 1) % n;
    guard++;
  }
  return out;
}

/** A sustained-note run in a pitched row: cell 1 followed by cell 2s. */
export interface NoteRun {
  /** Step the note starts on. */
  readonly start: number;
  /** Total width in steps (1 + sustain markers). */
  readonly length: number;
}

/**
 * Gate-length runs for the cell-width raise: each note-on starts a run that
 * extends across its following sustain markers (cell value 2).
 */
export function noteRuns(steps: readonly PitchedCell[]): NoteRun[] {
  const runs: NoteRun[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] !== 1) continue;
    let len = 1;
    while (i + len < steps.length && steps[i + len] === 2) len++;
    runs.push({ start: i, length: len });
    i += len - 1;
  }
  return runs;
}

/** Column test helper parity: does this column hold any sounding cell? */
export function columnActive(
  rows: readonly (readonly (boolean | PitchedCell)[])[],
  step: number,
): boolean {
  for (const row of rows) {
    const cell = row[step];
    if (cell === true || cell === 1 || cell === 2) return true;
  }
  return false;
}

/** Seconds per step at a bpm — re-exported for renderer consumers. */
export { secondsPerStep };

export type { Position };
