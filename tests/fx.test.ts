/**
 * IM-4 unit tests — pure FX math: IR determinism + decay shape, musical
 * delay-time math, tail budget, drive curve, bitcrusher quantization.
 */

import { describe, expect, it } from "vitest";
import {
  DELAY_MAX_SECONDS,
  MUSICAL_DELAY_UNITS,
  computeTailSamples,
  delaySeconds,
  driveCurve,
  driveShaper,
  musicalDelaySteps,
  nearestMusicalDelayUnit,
  quantizeBits,
  renderImpulseResponse,
  reverbSeconds,
  xorshift32,
  type MusicalDelayUnitId,
} from "../src/audio/fx";
import { secondsPerStep } from "../src/audio/time";
import type { FxDevice } from "../src/document/schema";

const SR = 44100;

describe("procedural impulse response", () => {
  it("is deterministic given a seed (identical online/offline contract)", () => {
    const a = renderImpulseResponse({ seed: 12345, size: 0.5, sampleRate: SR });
    const b = renderImpulseResponse({ seed: 12345, size: 0.5, sampleRate: SR });
    expect([...a.channels[0]]).toEqual([...b.channels[0]]);
    expect([...a.channels[1]]).toEqual([...b.channels[1]]);
    const c = renderImpulseResponse({ seed: 12346, size: 0.5, sampleRate: SR });
    expect([...a.channels[0]]).not.toEqual([...c.channels[0]]);
  });

  it("channels are decorrelated (L ≠ R)", () => {
    const ir = renderImpulseResponse({ seed: 777, size: 0.8, sampleRate: SR });
    expect([...ir.channels[0]]).not.toEqual([...ir.channels[1]]);
  });

  it("length tracks size, capped at 1.5 s", () => {
    expect(reverbSeconds(0)).toBeCloseTo(0.7, 10);
    expect(reverbSeconds(1)).toBeCloseTo(1.5, 10);
    expect(reverbSeconds(2)).toBeCloseTo(1.5, 10); // clamped
    const short = renderImpulseResponse({ seed: 1, size: 0, sampleRate: SR });
    const long = renderImpulseResponse({ seed: 1, size: 1, sampleRate: SR });
    expect(short.channels[0].length).toBe(Math.round(0.7 * SR));
    expect(long.channels[0].length).toBe(Math.round(1.5 * SR));
    expect(long.channels[0].length).toBeLessThanOrEqual(Math.round(1.5 * SR));
  });

  it("decays exponentially: early energy >> late energy, tail near zero", () => {
    const ir = renderImpulseResponse({ seed: 42, size: 1, sampleRate: SR });
    const ch = ir.channels[0];
    const n = ch.length;
    const head = ch.slice(0, Math.floor(n * 0.1));
    const tail = ch.slice(Math.floor(n * 0.9));
    const rms = (xs: ArrayLike<number>) => {
      let s = 0;
      for (let i = 0; i < xs.length; i++) s += xs[i]! * xs[i]!;
      return Math.sqrt(s / xs.length);
    };
    expect(rms(head)).toBeGreaterThan(rms(tail) * 10);
    const last = ch.slice(n - 64);
    expect(rms(last)).toBeLessThan(rms(head) / 15);
  });

  it("each channel has the fixed target L2 norm (normalize=false leveling)", () => {
    for (const size of [0, 0.5, 1]) {
      const ir = renderImpulseResponse({ seed: 99, size, sampleRate: SR });
      for (const ch of ir.channels) {
        let e = 0;
        for (let i = 0; i < ch.length; i++) e += ch[i]! * ch[i]!;
        expect(Math.sqrt(e)).toBeCloseTo(0.5, 5);
      }
    }
  });
});

describe("musical delay-time math", () => {
  it("named units map to 16th-step counts", () => {
    const byId = new Map(MUSICAL_DELAY_UNITS.map((u) => [u.id, u.steps]));
    expect(byId.get("1/8")).toBe(2);
    expect(byId.get("1/8.")).toBe(3);
    expect(byId.get("1/4")).toBe(4);
    expect(byId.get("1/2")).toBe(8);
    expect(musicalDelaySteps("1/8.")).toBe(3);
  });

  it("steps → seconds via time.ts at several BPMs", () => {
    expect(delaySeconds(4, 120)).toBeCloseTo(0.5, 10); // 1/4 @ 120
    expect(delaySeconds(2, 60)).toBeCloseTo(0.5, 10); // 1/8 @ 60
    expect(delaySeconds(3, 100)).toBeCloseTo(3 * secondsPerStep(100), 10);
  });

  it("clamps to the 2 s DelayNode cap", () => {
    expect(delaySeconds(64, 60)).toBe(DELAY_MAX_SECONDS); // 16 s raw
    expect(delaySeconds(8, 200)).toBeLessThanOrEqual(DELAY_MAX_SECONDS);
  });

  it("nearest unit round-trips exact step counts", () => {
    for (const u of MUSICAL_DELAY_UNITS) {
      expect(nearestMusicalDelayUnit(u.steps)).toBe(u.id as MusicalDelayUnitId);
    }
  });
});

describe("drive curve + bitcrusher quantization", () => {
  it("curve is odd-symmetric, unity at edges, monotone in amount", () => {
    const soft = driveCurve(0.1);
    const hard = driveCurve(1);
    const n = soft.length;
    expect(soft[0]).toBeCloseTo(-1, 6);
    expect(soft[n - 1]).toBeCloseTo(1, 6);
    // Odd symmetry via mirrored indices (x_i + x_{n-1-i} = 0 exactly).
    for (const i of [1, 100, 400, 511]) {
      expect(soft[i]!).toBeCloseTo(-soft[n - 1 - i]!, 6);
    }
    // Harder amount compresses the midband more (tanh knee).
    const mid = Math.floor(n / 2) + 100;
    expect(Math.abs(hard[mid]!)).toBeGreaterThan(Math.abs(soft[mid]!));
    expect(driveShaper(0.5, 0)).toBe(0.5); // amount 0 = exactly transparent
    expect(driveShaper(0.5, 1)).toBeGreaterThan(0.5); // asymmetric knee lifts mid
    expect(driveShaper(0.5, 1)).toBeLessThan(1);
  });

  it("driveCurve caches per bucketed amount (identity)", () => {
    expect(driveCurve(0.33)).toBe(driveCurve(0.33));
  });

  it("quantizeBits snaps to 2^bits levels", () => {
    expect(quantizeBits(0.26, 2)).toBeCloseTo(1 / 3, 10);
    expect(quantizeBits(-0.01, 1)).toBe(-1); // 1 bit = sign only
    expect(quantizeBits(0.6, 1)).toBe(1);
    expect(quantizeBits(0.999, 16)).toBeCloseTo(1, 2);
    expect(quantizeBits(0.5, 16)).toBeCloseTo(0.5, 4);
  });
});

describe("computeTailSamples (IM-5 budget)", () => {
  const reverb = (size: number): FxDevice => ({
    type: "reverb",
    bypassed: false,
    params: { size, mix: 0.4 },
  });
  const delay = (timeSteps: number, feedback = 0.5): FxDevice => ({
    type: "delay",
    bypassed: false,
    params: { timeSteps, feedback, mix: 0.5 },
  });

  it("empty chains → zero tail", () => {
    expect(computeTailSamples([[], []], 120, SR)).toBe(0);
  });

  it("reverb contributes IR length (+50 ms guard)", () => {
    const samples = computeTailSamples([[reverb(0)]], 120, SR);
    expect(samples).toBe(Math.ceil((0.7 + 0.05) * SR));
  });

  it("delay contributes delay × 6 decays", () => {
    const samples = computeTailSamples([[delay(4)]], 120, SR); // 0.5 s delay
    expect(samples).toBe(Math.ceil(3 * SR));
  });

  it("takes the max across devices and lanes; bypassed devices excluded", () => {
    const samples = computeTailSamples(
      [[reverb(1)], [delay(8), reverb(0.2)]], // 1/2 @120 = 1 s → 6 s wins
      120,
      SR,
    );
    expect(samples).toBe(Math.ceil(6 * SR));
    expect(
      computeTailSamples([[delay(4, 0.5)], [{ ...reverb(1), bypassed: true }]], 120, SR),
    ).toBe(Math.ceil(3 * SR));
  });
});

describe("xorshift32", () => {
  it("deterministic, never zero-state stuck", () => {
    const a = xorshift32(7);
    const b = xorshift32(7);
    expect(a()).toBe(b());
    expect(a()).not.toBe(a());
    const zero = xorshift32(0); // must not deadlock at 0
    expect(zero()).toBeGreaterThan(0);
  });
});
