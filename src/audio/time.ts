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
  // Single multiplication (not step*spb + swing*spb): at swing = 1 the last
  // odd step must land EXACTLY on the loop boundary steps*spb, and the
  // two-term sum differs by 1 ulp at several BPMs (found by the HW-1 sweep).
  return (step + (step % 2 === 1 ? swing : 0)) * spb;
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
 * LL-1 (iteration 3, LP-1 §10b — seam A5/F5): the O(1) guess-and-verify step
 * lookup for a NON-NEGATIVE, unwrapped pattern-local time. One division-floor
 * GUESS (`floor(t / secondsPerStep)`) plus at most three EXACT
 * timeAtStep-boundary predicate checks (candidates guess-1..guess+1) —
 * bit-identical decisions to the old O(steps) scan BY CONSTRUCTION because
 * the predicates are timeAtStep verbatim; proven by the LP-1 node harness's
 * exhaustive equivalence sweep (every step boundary + midpoint + ulp
 * neighbors of the 2048-step loop at swing 0/0.5/1; a bpm × swing ×
 * step-count spot grid; wrapped/negative times — tests/lp1-perf-spike.test.ts).
 * The scan cost O(steps) per call made the per-edit compile path 276-438 ms
 * at 128 bars; this is 84-136 ns (~200-460× cheaper, LP-1 §10c).
 */
export function stepOfTimeBounded(
  t: number,
  groove: GrooveOptions,
  steps: number,
): number {
  if (steps <= 1) return Math.max(steps - 1, 0);
  const spb = secondsPerStep(groove.bpm);
  const guess = Math.max(0, Math.floor(t / spb));
  for (let i = Math.max(0, guess - 1); i <= guess + 1; i++) {
    if (t >= timeAtStep(i, groove) && t < timeAtStep(i + 1, groove)) {
      return Math.min(i, steps - 1);
    }
  }
  return steps - 1;
}

/**
 * Inverse of timeAtStep: the step index (within one loop, 0..steps-1)
 * sounding at time `t` (seconds from loop start, 0 <= t < loop length).
 * Boundary rule: a step occupies [timeAtStep(i), timeAtStep(i + 1)).
 * LL-1: the O(steps) scan body is replaced by the bounded lookup above —
 * decisions are bit-identical (the predicates are the same timeAtStep calls
 * the scan made; the LP-1 sweep pins the equivalence).
 */
export function stepIndexAtTime(t: number, opts: StepAtTimeOptions): number {
  const steps = totalSteps(opts.bars);
  const loopLen = steps * secondsPerStep(opts.bpm);
  // Single-modulo fast path for t >= 0: the ((t % L) + L) % L idiom rounds the
  // result by 1 ulp for positive t (found by the HW-1 timing sweep), which
  // broke exact-onset inverse lookups at e.g. 200 bpm / swing 0.5.
  const local = t >= 0 ? t % loopLen : ((t % loopLen) + loopLen) % loopLen;
  return stepOfTimeBounded(local, opts, steps);
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
