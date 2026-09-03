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
  type LoopBars,
  type Position,
  loopLengthSeconds,
  secondsPerStep,
  stepIndexAtTime,
  timeAtStep,
  totalSteps,
} from "../audio/time";
import type { PitchedCell } from "../document/schema";

export interface PlayheadOptions extends GrooveOptions {
  readonly bars: LoopBars;
}

/**
 * Playhead x position (px) for a loop-relative time. Interpolates between
 * the swung times of the surrounding steps so the bar tracks the audio grid
 * exactly (swing-aware), rather than assuming uniform step spacing.
 * `t` is clamped into [0, loopLength).
 */
export function playheadX(
  t: number,
  opts: PlayheadOptions,
  stepWidthPx: number,
): number {
  const loopLen = loopLengthSeconds(opts.bars, opts.bpm);
  const local = Math.min(Math.max(t, 0), Math.max(loopLen - 1e-9, 0));
  const step = stepIndexAtTime(local, opts);
  const steps = totalSteps(opts.bars);
  const t0 = timeAtStep(step, opts);
  // End of the last step = loop end (uniform: swing only delays within beats).
  const t1 = step + 1 < steps ? timeAtStep(step + 1, opts) : loopLen;
  const span = Math.max(t1 - t0, 1e-9);
  const frac = Math.min(Math.max((local - t0) / span, 0), 1);
  return (step + frac) * stepWidthPx;
}

/**
 * Quantized step under the playhead (reduced-motion column highlight, D9).
 * Same authority as the engine's step grid.
 */
export function quantizedStep(t: number, opts: PlayheadOptions): number {
  const loopLen = loopLengthSeconds(opts.bars, opts.bpm);
  const local = Math.min(Math.max(t, 0), Math.max(loopLen - 1e-9, 0));
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

/** Loop length in steps for a bars setting (16 × bars). */
export function gridStepCount(bars: LoopBars): number {
  return totalSteps(bars);
}

/** Seconds per step at a bpm — re-exported for renderer consumers. */
export { secondsPerStep };

export type { Position };
