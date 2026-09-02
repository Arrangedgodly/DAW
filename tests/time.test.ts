import { describe, expect, it } from "vitest";
import {
  BEATS_PER_BAR,
  MAX_BPM,
  MIN_BPM,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  barBeatStep,
  clampBpm,
  clampSwing,
  loopLengthSeconds,
  nextStepAtOrAfter,
  secondsPerBeat,
  secondsPerStep,
  stepIndex,
  stepIndexAtTime,
  timeAtStep,
  totalSteps,
} from "../src/audio/time";

describe("time constants", () => {
  it("uses a 4/4 sixteenth grid", () => {
    expect(STEPS_PER_BEAT).toBe(4);
    expect(BEATS_PER_BAR).toBe(4);
    expect(STEPS_PER_BAR).toBe(16);
  });

  it("counts pattern steps for 1/2/4 bars", () => {
    expect(totalSteps(1)).toBe(16);
    expect(totalSteps(2)).toBe(32);
    expect(totalSteps(4)).toBe(64);
  });
});

describe("clamping", () => {
  it("clamps bpm to 60..200", () => {
    expect(clampBpm(40)).toBe(MIN_BPM);
    expect(clampBpm(60)).toBe(60);
    expect(clampBpm(120)).toBe(120);
    expect(clampBpm(200)).toBe(MAX_BPM);
    expect(clampBpm(999)).toBe(200);
  });

  it("clamps swing to 0..1", () => {
    expect(clampSwing(-1)).toBe(0);
    expect(clampSwing(0)).toBe(0);
    expect(clampSwing(0.37)).toBe(0.37);
    expect(clampSwing(1)).toBe(1);
    expect(clampSwing(1.5)).toBe(1);
  });
});

describe("seconds per beat/step", () => {
  it("is exact at 60 bpm", () => {
    expect(secondsPerBeat(60)).toBe(1);
    expect(secondsPerStep(60)).toBe(0.25);
  });

  it("is exact at 120 bpm", () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(secondsPerStep(120)).toBe(0.125);
  });

  it("is deterministic across the bpm range (same expression, exact equality)", () => {
    for (const bpm of [60, 72, 90, 100, 128, 150, 174, 200]) {
      expect(secondsPerBeat(bpm)).toBe(60 / bpm);
      expect(secondsPerStep(bpm)).toBe(60 / bpm / 4);
    }
  });
});

describe("loopLengthSeconds", () => {
  it("computes exact loop lengths", () => {
    expect(loopLengthSeconds(1, 60)).toBe(4);
    expect(loopLengthSeconds(2, 60)).toBe(8);
    expect(loopLengthSeconds(4, 60)).toBe(16);
    expect(loopLengthSeconds(1, 120)).toBe(2);
    expect(loopLengthSeconds(4, 120)).toBe(8);
    expect(loopLengthSeconds(2, 90)).toBe(2 * 16 * (60 / 90 / 4));
  });
});

describe("timeAtStep (grid without swing)", () => {
  it("is step * secondsPerStep", () => {
    for (let step = 0; step < 64; step++) {
      expect(timeAtStep(step, { bpm: 120 })).toBe(step * 0.125);
    }
  });

  it("bar boundaries land on exact multiples", () => {
    expect(timeAtStep(16, { bpm: 120 })).toBe(2);
    expect(timeAtStep(32, { bpm: 120 })).toBe(4);
    expect(timeAtStep(16, { bpm: 60 })).toBe(4);
  });
});

describe("timeAtStep with swing", () => {
  it("leaves even steps untouched", () => {
    expect(timeAtStep(0, { bpm: 120, swing: 1 })).toBe(0);
    expect(timeAtStep(2, { bpm: 120, swing: 0.75 })).toBe(0.25);
    expect(timeAtStep(16, { bpm: 120, swing: 1 })).toBe(2);
  });

  it("delays odd steps by swing * step", () => {
    expect(timeAtStep(1, { bpm: 120, swing: 0 })).toBe(0.125);
    expect(timeAtStep(1, { bpm: 120, swing: 0.5 })).toBe(0.1875);
    expect(timeAtStep(3, { bpm: 120, swing: 0.5 })).toBe(0.4375);
    expect(timeAtStep(1, { bpm: 120, swing: 1 })).toBe(0.25);
    expect(timeAtStep(1, { bpm: 60, swing: 1 })).toBe(0.5);
  });

  it("is monotonic for swing < 1", () => {
    for (const swing of [0, 0.25, 0.5, 0.66, 0.99]) {
      let prev = -Infinity;
      for (let step = 0; step < 64; step++) {
        const t = timeAtStep(step, { bpm: 120, swing });
        expect(t).toBeGreaterThan(prev);
        prev = t;
      }
    }
  });

  it("at 100% swing the last odd step lands on the loop end", () => {
    // step 15 of a 1-bar loop at 120 bpm: 15*0.125 + 1*0.125 = 2 = loop length
    expect(timeAtStep(15, { bpm: 120, swing: 1 })).toBe(
      loopLengthSeconds(1, 120),
    );
  });
});

describe("barBeatStep / stepIndex round-trip", () => {
  it("decomposes positions", () => {
    expect(barBeatStep(0)).toEqual({ bar: 0, beat: 0, step: 0 });
    expect(barBeatStep(1)).toEqual({ bar: 0, beat: 0, step: 1 });
    expect(barBeatStep(4)).toEqual({ bar: 0, beat: 1, step: 0 });
    expect(barBeatStep(7)).toEqual({ bar: 0, beat: 1, step: 3 });
    expect(barBeatStep(16)).toEqual({ bar: 1, beat: 0, step: 0 });
    expect(barBeatStep(35)).toEqual({ bar: 2, beat: 0, step: 3 });
    expect(barBeatStep(63)).toEqual({ bar: 3, beat: 3, step: 3 });
  });

  it("round-trips every step of a 4-bar pattern", () => {
    for (let step = 0; step < 64; step++) {
      expect(stepIndex(barBeatStep(step))).toBe(step);
    }
  });
});

describe("stepIndexAtTime (inverse of timeAtStep)", () => {
  it("maps exact step times back to their step (half-open intervals)", () => {
    for (let step = 0; step < 16; step++) {
      const t = timeAtStep(step, { bpm: 60 });
      expect(stepIndexAtTime(t, { bars: 1, bpm: 60 })).toBe(step);
    }
  });

  it("maps mid-step times correctly", () => {
    expect(stepIndexAtTime(0.1, { bars: 1, bpm: 60 })).toBe(0);
    expect(stepIndexAtTime(0.3, { bars: 1, bpm: 60 })).toBe(1);
    expect(stepIndexAtTime(3.99, { bars: 1, bpm: 60 })).toBe(15);
  });

  it("handles exact loop boundaries (t == loop length wraps to step 0)", () => {
    expect(stepIndexAtTime(4, { bars: 1, bpm: 60 })).toBe(0);
    expect(stepIndexAtTime(8, { bars: 2, bpm: 60 })).toBe(0);
  });

  it("works with swing", () => {
    const opts = { bars: 1, bpm: 120, swing: 0.5 } as const;
    // step 0 spans [0, 0.1875), step 1 spans [0.1875, 0.25)
    expect(stepIndexAtTime(0.1874, opts)).toBe(0);
    expect(stepIndexAtTime(0.1875, opts)).toBe(1);
    expect(stepIndexAtTime(0.2499, opts)).toBe(1);
    expect(stepIndexAtTime(0.25, opts)).toBe(2);
    // step 3 spans [0.4375, 0.5)
    expect(stepIndexAtTime(0.45, opts)).toBe(3);
    // loop end wraps
    expect(stepIndexAtTime(2, opts)).toBe(0);
  });

  it("covers all pattern lengths", () => {
    for (const bars of [1, 2, 4] as const) {
      for (let step = 0; step < totalSteps(bars) - 1; step++) {
        const t = timeAtStep(step, { bpm: 120 });
        expect(stepIndexAtTime(t, { bars, bpm: 120 })).toBe(step);
      }
    }
  });
});

describe("nextStepAtOrAfter", () => {
  it("returns 0 for t <= 0", () => {
    expect(nextStepAtOrAfter(-1, { bpm: 120 })).toBe(0);
    expect(nextStepAtOrAfter(0, { bpm: 120 })).toBe(0);
  });

  it("returns the next step at or after t", () => {
    expect(nextStepAtOrAfter(0.13, { bpm: 120 })).toBe(2);
    expect(nextStepAtOrAfter(0.25, { bpm: 120 })).toBe(2);
    expect(nextStepAtOrAfter(0.250001, { bpm: 120 })).toBe(3);
  });

  it("accounts for swing", () => {
    // with swing 1, step 1 sounds at 0.25; query at 0.2 -> step 1
    expect(nextStepAtOrAfter(0.2, { bpm: 120, swing: 1 })).toBe(1);
  });
});
