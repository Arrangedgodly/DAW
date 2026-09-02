import { describe, expect, it } from "vitest";
import {
  MAX_VOICE_FREQ,
  adsrLevel,
  lfsrNext,
  lfsrOutput,
  midiToFreq,
  noteSeed,
  polyblep,
  pulseSample,
  pulseValue,
  triangleValue,
} from "../src/audio/dsp";

describe("midiToFreq", () => {
  it("A4 = 440, A5 = 880, C5 ~ 523.25", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9);
    expect(midiToFreq(81)).toBeCloseTo(880, 9);
    expect(midiToFreq(72)).toBeCloseTo(523.2511306, 6);
  });
});

describe("polyblep", () => {
  it("is zero away from an edge", () => {
    expect(polyblep(0.5, 0.01)).toBe(0);
    expect(polyblep(0.2, 0.01)).toBe(0);
    expect(polyblep(0.8, 0.01)).toBe(0);
  });

  it("is exactly -1 at t=0 and +1 at t=1⁻ (full correction)", () => {
    expect(polyblep(0, 0.01)).toBe(-1);
    expect(polyblep(1 - 1e-9, 0.01)).toBeCloseTo(1, 6);
  });

  it("vanishes as dt → 0 for any fixed non-edge phase", () => {
    for (const t of [0.001, 0.5, 0.999]) {
      expect(polyblep(t, 1e-9)).toBeCloseTo(0, 6);
    }
  });
});

describe("pulse", () => {
  it("threshold respects duty", () => {
    expect(pulseValue(0.1, 0.25)).toBe(1);
    expect(pulseValue(0.3, 0.25)).toBe(-1);
    expect(pulseValue(0.49, 0.5)).toBe(1);
    expect(pulseValue(0.51, 0.5)).toBe(-1);
  });

  it("band-limited sample stays within ±2 and equals ±1 mid-phase", () => {
    const dt = 100 / 44100;
    for (let i = 0; i < 1000; i++) {
      const phase = i / 1000;
      const v = pulseSample(phase, 0.25, dt);
      expect(Math.abs(v)).toBeLessThanOrEqual(2);
    }
    expect(pulseSample(0.5, 0.25, dt)).toBe(-1); // far from both edges
  });
});

describe("triangle (NES 32-step)", () => {
  it("quantizes to 16 staircase levels (each held two steps), exact extremes", () => {
    const values = new Set<number>();
    for (let i = 0; i < 32; i++) {
      const v = triangleValue(i / 32);
      values.add(v);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(values.size).toBe(16); // descends 16 levels, ascends the same 16
    expect(triangleValue(0)).toBe(1);
    expect(triangleValue(15 / 32)).toBe(-1);
    expect(triangleValue(16 / 32)).toBe(-1);
    expect(triangleValue(31 / 32)).toBe(1);
  });

  it("wraps periodically and handles phase >= 1", () => {
    expect(triangleValue(1.25)).toBeCloseTo(triangleValue(0.25), 12);
    expect(triangleValue(2.5)).toBeCloseTo(triangleValue(0.5), 12);
  });
});

describe("LFSR (NES noise)", () => {
  it("long mode has maximal period 32767 and never reaches 0", () => {
    let reg = 1;
    let period = 0;
    do {
      reg = lfsrNext(reg, false);
      period++;
      expect(reg).toBeGreaterThan(0);
      expect(reg).toBeLessThan(32768);
    } while (reg !== 1 && period < 40000);
    expect(period).toBe(32767);
  });

  it("short mode cycles (93-state tap) with deterministic output bits", () => {
    let reg = 0x1234;
    const outs: number[] = [];
    for (let i = 0; i < 100; i++) {
      outs.push(lfsrOutput(reg));
      reg = lfsrNext(reg, true);
    }
    // Deterministic + bipolar.
    for (const o of outs) expect(Math.abs(o)).toBe(1);
    // Re-run from the same seed → identical sequence.
    let reg2 = 0x1234;
    for (let i = 0; i < 100; i++) {
      expect(lfsrOutput(reg2)).toBe(outs[i]);
      reg2 = lfsrNext(reg2, true);
    }
  });
});

describe("adsrLevel", () => {
  const a = 0.01;
  const d = 0.1;
  const s = 0.5;
  const r = 0.2;
  const hold = 0.4;

  it("exact segment boundary levels", () => {
    expect(adsrLevel(0, a, d, s, r, hold)).toBe(0);
    expect(adsrLevel(a / 2, a, d, s, r, hold)).toBeCloseTo(0.5, 12);
    expect(adsrLevel(a, a, d, s, r, hold)).toBeCloseTo(1, 12);
    expect(adsrLevel(a + d / 2, a, d, s, r, hold)).toBeCloseTo(0.75, 12);
    expect(adsrLevel(a + d, a, d, s, r, hold)).toBeCloseTo(s, 12);
    expect(adsrLevel(hold, a, d, s, r, hold)).toBeCloseTo(s, 12);
    expect(adsrLevel(hold + r / 2, a, d, s, r, hold)).toBeCloseTo(s / 2, 12);
    expect(adsrLevel(hold + r, a, d, s, r, hold)).toBe(0);
    expect(adsrLevel(hold + r + 1, a, d, s, r, hold)).toBe(0);
  });

  it("zero-length segments are legal and jump", () => {
    // instant attack, no decay, sustain 1, instant release at hold
    expect(adsrLevel(0, 0, 0, 1, 0, 0.1)).toBe(1);
    expect(adsrLevel(0.05, 0, 0, 1, 0, 0.1)).toBe(1);
    expect(adsrLevel(0.1, 0, 0, 1, 0, 0.1)).toBe(0);
  });

  it("negative time is silent", () => {
    expect(adsrLevel(-0.001, a, d, s, r, hold)).toBe(0);
  });
});

describe("noteSeed", () => {
  it("is deterministic, in 1..32767, and varies with both salts", () => {
    const s1 = noteSeed(1013, 5, 7);
    expect(s1).toBe(noteSeed(1013, 5, 7));
    expect(s1).toBeGreaterThanOrEqual(1);
    expect(s1).toBeLessThanOrEqual(32767);
    expect(new Set([noteSeed(1013, 5, 7), noteSeed(1013, 6, 7), noteSeed(1013, 5, 8)]).size).toBe(3);
  });
});

describe("constants", () => {
  it("voice frequency cap is the NES-ish 12.4 kHz", () => {
    expect(MAX_VOICE_FREQ).toBe(12400);
  });
});
