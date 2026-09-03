/**
 * DES-4 grid math tests: playhead grid-time→x, quantized step, step-crossing
 * dedupe (trigger glow), and note-run (gate-width) derivation.
 */

import { describe, expect, it } from "vitest";
import {
  columnActive,
  noteRuns,
  playheadX,
  quantizedStep,
  stepsCrossed,
} from "../src/grid/math";
import { loopLengthSeconds, timeAtStep } from "../src/audio/time";

const OPTS = { bars: 1, bpm: 120, swing: 0 } as const;
const STEP_W = 26; // 24px cell + 2px gap

describe("playheadX", () => {
  it("starts at 0 and lands on step boundaries exactly", () => {
    expect(playheadX(0, OPTS, STEP_W)).toBe(0);
    const stepDur = 0.125; // 120 bpm 16ths
    for (let s = 0; s < 16; s++) {
      expect(playheadX(s * stepDur, OPTS, STEP_W)).toBeCloseTo(s * STEP_W, 6);
    }
  });

  it("interpolates linearly between steps (no swing)", () => {
    const x = playheadX(0.0625, OPTS, STEP_W); // half a step
    expect(x).toBeCloseTo(STEP_W / 2, 6);
  });

  it("is swing-aware: delayed off-beats shift x to the audio grid", () => {
    const swung = { bars: 1, bpm: 120, swing: 0.5 };
    const tOdd = timeAtStep(1, swung); // swung late
    const tEven = timeAtStep(2, swung);
    const xOdd = playheadX(tOdd, swung, STEP_W);
    expect(xOdd).toBeCloseTo(STEP_W, 6);
    const xMid = playheadX((tOdd + tEven) / 2, swung, STEP_W);
    expect(xMid).toBeGreaterThan(STEP_W);
    expect(xMid).toBeLessThan(2 * STEP_W);
  });

  it("clamps and wraps within the loop", () => {
    const loopLen = loopLengthSeconds(1, 120);
    expect(playheadX(-1, OPTS, STEP_W)).toBe(0);
    const end = playheadX(loopLen, OPTS, STEP_W);
    expect(end).toBeLessThanOrEqual(16 * STEP_W);
    expect(end).toBeGreaterThan(15.9 * STEP_W);
  });
});

describe("quantizedStep", () => {
  it("matches the engine step grid", () => {
    expect(quantizedStep(0, OPTS)).toBe(0);
    expect(quantizedStep(0.124, OPTS)).toBe(0);
    expect(quantizedStep(0.126, OPTS)).toBe(1);
    expect(quantizedStep(1.999, OPTS)).toBe(15);
  });
});

describe("stepsCrossed (glow dedupe)", () => {
  it("fires nothing while the column holds", () => {
    expect(stepsCrossed(3, 3, 16)).toEqual([]);
    expect(stepsCrossed(null, 3, 16)).toEqual([]);
  });

  it("fires exactly the entered column on a normal advance", () => {
    expect(stepsCrossed(3, 4, 16)).toEqual([4]);
    expect(stepsCrossed(0, 1, 16)).toEqual([1]);
  });

  it("does not duplicate when frames skip ahead", () => {
    expect(stepsCrossed(4, 7, 16)).toEqual([5, 6, 7]);
  });

  it("wraps at the loop boundary, entering step 0", () => {
    expect(stepsCrossed(15, 0, 16)).toEqual([0]);
    expect(stepsCrossed(14, 0, 16)).toEqual([15, 0]);
  });
});

describe("noteRuns (gate width)", () => {
  it("single note-on without sustain is one 1-step run", () => {
    expect(noteRuns([0, 0, 1, 0])).toEqual([{ start: 2, length: 1 }]);
  });

  it("sustain markers extend the run and join back-to-back notes", () => {
    expect(noteRuns([1, 2, 2, 0, 1, 2])).toEqual([
      { start: 0, length: 3 },
      { start: 4, length: 2 },
    ]);
  });

  it("a sustain marker alone is not a run", () => {
    expect(noteRuns([0, 2, 2])).toEqual([]);
  });

  it("runs truncate at the pattern end", () => {
    expect(noteRuns([0, 0, 1, 2, 2])).toEqual([{ start: 2, length: 3 }]);
  });
});

describe("columnActive", () => {
  it("detects drums, notes, and sustains in a column", () => {
    expect(columnActive([[false], [true]], 0)).toBe(true);
    expect(columnActive([[0], [1]], 0)).toBe(true);
    expect(columnActive([[0], [2]], 0)).toBe(true);
    expect(columnActive([[false], [0]], 0)).toBe(false);
  });
});
