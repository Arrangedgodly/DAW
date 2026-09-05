/**
 * Timing-math edge sweep (HW-1): systematic table-driven sweep over the full
 * transport parameter space — BPM 60..200 step 10 x swing {0,.25,.5,.75,1} x
 * bars {1,2,4} — asserting:
 *   1. loopLengthSeconds is exactly totalSteps * secondsPerStep (swing never
 *      changes loop length),
 *   2. stepIndexAtTime(timeAtStep(i)) === i for every non-degenerate step
 *      (at swing = 1 the final odd step collapses onto the loop boundary —
 *      documented in time.ts, excluded from the inverse check),
 *   3. mid-step times land in the earlier step (half-open intervals),
 *   4. t === loop length wraps to step 0.
 * Complements (not duplicates) tests/time.test.ts, which covers semantics and
 * spot values; this file owns exhaustive parameter coverage.
 */

import { describe, expect, it } from "vitest";
import {
  loopLengthSeconds,
  secondsPerStep,
  stepIndexAtTime,
  timeAtStep,
  totalSteps,
  type LoopBars,
} from "../src/audio/time";

const BPMS: number[] = [];
for (let bpm = 60; bpm <= 200; bpm += 10) BPMS.push(bpm);
const SWINGS = [0, 0.25, 0.5, 0.75, 1] as const;
// LL-2: the sweep rows stay BARS-shaped (the v2 vocabulary identity); the
// stepIndexAtTime calls below are steps-typed (bars x 16) — the wider basis
// the production seam now carries.
const BARS = [1, 2, 4] as const;

interface Row {
  bpm: number;
  swing: number;
  bars: LoopBars;
}

const ROWS: Row[] = [];
for (const bpm of BPMS)
  for (const swing of SWINGS)
    for (const bars of BARS) ROWS.push({ bpm, swing, bars });

const id = ({ bpm, swing, bars }: Row) =>
  `${bpm} bpm / swing ${swing} / ${bars} bar(s)`;

describe("timing edge sweep (15 bpm x 5 swing x 3 bars = 225 combos)", () => {
  it("covers the full grid", () => {
    expect(BPMS).toHaveLength(15);
    expect(ROWS).toHaveLength(225);
  });

  for (const row of ROWS) {
    it(`${id(row)}: loop length exact, timeAtStep/stepIndexAtTime inverse, boundary wrap`, () => {
      const { bpm, swing, bars } = row;
      const opts = { bpm, swing };
      const steps = totalSteps(bars);
      const loopLen = loopLengthSeconds(bars, bpm);

      // 1. Loop length exactness: swing never changes loop length.
      expect(loopLen).toBe(steps * secondsPerStep(bpm));

      // 2. Inverse property at exact step onsets (skip degenerate zero-width
      //    steps: odd steps at swing = 1 collapse into the next step).
      for (let i = 0; i < steps; i++) {
        const t = timeAtStep(i, opts);
        const next = i + 1 < steps ? timeAtStep(i + 1, opts) : loopLen;
        if (t < next) {
          expect(stepIndexAtTime(t, { steps, ...opts })).toBe(i);
          // 3. Midpoint of a non-degenerate step interval maps to the earlier step.
          expect(stepIndexAtTime((t + next) / 2, { steps, ...opts })).toBe(i);
        }
      }

      // 4. Exact loop boundary wraps to step 0 (and half a loop is well-formed).
      expect(stepIndexAtTime(loopLen, { steps, ...opts })).toBe(0);
      expect(
        stepIndexAtTime(loopLen / 2, { steps, ...opts }),
      ).toBeGreaterThanOrEqual(0);
      expect(stepIndexAtTime(loopLen / 2, { steps, ...opts })).toBeLessThan(
        steps,
      );
    });
  }

  it("even-step onsets are swing-invariant across the whole sweep", () => {
    for (const row of ROWS) {
      const { bpm, swing, bars } = row;
      for (let i = 0; i < totalSteps(bars); i += 2) {
        expect(timeAtStep(i, { bpm, swing })).toBe(
          timeAtStep(i, { bpm, swing: 0 }),
        );
      }
    }
  });

  it("swing=1 makes the final odd step land exactly on the loop boundary at every bpm/bars", () => {
    for (const bpm of BPMS) {
      for (const bars of BARS) {
        const steps = totalSteps(bars);
        expect(timeAtStep(steps - 1, { bpm, swing: 1 })).toBe(
          loopLengthSeconds(bars, bpm),
        );
      }
    }
  });
});
