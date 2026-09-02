/**
 * Pure musical-time math. No audio, DOM, or random dependencies.
 *
 * Grid: 4/4, sixteenth-note steps (16 steps per bar).
 * Swing delays every odd 16th step by `swing` fraction of one step (0..1).
 */

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR; // 16

export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const MIN_SWING = 0;
export const MAX_SWING = 1;

export type LoopBars = 1 | 2 | 4;

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

export function clampSwing(swing: number): number {
  return Math.min(MAX_SWING, Math.max(MIN_SWING, swing));
}

/** Seconds per quarter note. */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** Seconds per sixteenth step (no swing). */
export function secondsPerStep(bpm: number): number {
  return secondsPerBeat(bpm) / STEPS_PER_BEAT;
}

/** Total step count of a pattern of `bars` bars. */
export function totalSteps(bars: LoopBars): number {
  return bars * STEPS_PER_BAR;
}

/** Pattern duration in seconds (swing never changes loop length). */
export function loopLengthSeconds(bars: LoopBars, bpm: number): number {
  return totalSteps(bars) * secondsPerStep(bpm);
}

export interface GrooveOptions {
  readonly bpm: number;
  /** Swing amount 0..1; delays every odd 16th by `swing` * one step. */
  readonly swing?: number;
}

/**
 * Absolute time (seconds from loop start) of a step index, including swing.
 * Odd steps are delayed by `swing` * secondsPerStep.
 * Note: at swing = 1 the last odd step of the loop lands exactly on the
 * loop boundary (zero-width step) — inherent to a full-step swing.
 */
export function timeAtStep(step: number, opts: GrooveOptions): number {
  const spb = secondsPerStep(opts.bpm);
  const swing = clampSwing(opts.swing ?? 0);
  const base = step * spb;
  return step % 2 === 1 ? base + swing * spb : base;
}

export interface Position {
  readonly bar: number;
  readonly beat: number;
  /** Step within the beat (0..3). */
  readonly step: number;
}

/** Decompose a loop-relative step index (0-based) into bar/beat/step. */
export function barBeatStep(step: number): Position {
  const s = Math.floor(step);
  return {
    bar: Math.floor(s / STEPS_PER_BAR),
    beat: Math.floor((s % STEPS_PER_BAR) / STEPS_PER_BEAT),
    step: s % STEPS_PER_BEAT,
  };
}

/** Compose a loop-relative step index from bar/beat/step. */
export function stepIndex(pos: Position): number {
  return pos.bar * STEPS_PER_BAR + pos.beat * STEPS_PER_BEAT + pos.step;
}

export interface StepAtTimeOptions extends GrooveOptions {
  readonly bars: LoopBars;
}

/**
 * Inverse of timeAtStep: the step index (within one loop, 0..steps-1)
 * sounding at time `t` (seconds from loop start, 0 <= t < loop length).
 * Boundary rule: a step occupies [timeAtStep(i), timeAtStep(i + 1)).
 */
export function stepIndexAtTime(t: number, opts: StepAtTimeOptions): number {
  const steps = totalSteps(opts.bars);
  const loopLen = steps * secondsPerStep(opts.bpm);
  const local = ((t % loopLen) + loopLen) % loopLen;
  for (let i = 0; i < steps - 1; i++) {
    if (local >= timeAtStep(i, opts) && local < timeAtStep(i + 1, opts)) {
      return i;
    }
  }
  return steps - 1;
}

/** Smallest step index (>= 0) whose sounding time is >= `t`. */
export function nextStepAtOrAfter(t: number, opts: GrooveOptions): number {
  if (t <= 0) return 0;
  const spb = secondsPerStep(opts.bpm);
  const guess = Math.floor(t / spb);
  for (let i = Math.max(0, guess - 1); ; i++) {
    if (timeAtStep(i, opts) >= t) return i;
  }
}
