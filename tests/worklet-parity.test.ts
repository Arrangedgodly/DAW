import { beforeAll, describe, expect, it } from "vitest";
import * as dsp from "../src/audio/dsp";

/**
 * The worklet file (src/audio/worklets/voiceEngine.js) is plain JS served as
 * a raw Vite asset — it cannot import dsp.ts, so it carries an inline twin of
 * the DSP. This test imports the worklet in node through its test seam and
 * asserts the twin matches the canonical dsp.ts bit-for-bit. If you change
 * one copy without the other, this file fails.
 */

let workletDsp: {
  midiToFreq: (m: number) => number;
  polyblep: (t: number, dt: number) => number;
  pulseValue: (phase: number, duty: number) => number;
  pulseSample: (phase: number, duty: number, dt: number) => number;
  triangleValue: (phase: number) => number;
  lfsrNext: (reg: number, shortMode: boolean) => number;
  lfsrOutput: (reg: number) => number;
  adsrLevel: (
    t: number,
    a: number,
    d: number,
    s: number,
    r: number,
    hold: number,
  ) => number;
};

beforeAll(async () => {
  let captured: typeof workletDsp | undefined;
  (globalThis as Record<string, unknown>).__bbRegisterVoiceEngineDsp = (
    fns: typeof workletDsp,
  ) => {
    captured = fns;
  };
  await import("../src/audio/worklets/voiceEngine.js");
  if (!captured) throw new Error("worklet test seam did not fire");
  workletDsp = captured;
});

function expectClose(a: number, b: number): void {
  if (a === b) return;
  expect(Math.abs(a - b)).toBeLessThan(1e-12);
}

describe("worklet DSP parity with dsp.ts", () => {
  it("midiToFreq", () => {
    for (const m of [0, 33, 60, 69, 81, 96, 127]) {
      expectClose(workletDsp.midiToFreq(m), dsp.midiToFreq(m));
    }
  });

  it("polyblep across a phase sweep at several dt", () => {
    for (const dt of [1 / 32, 100 / 44100, 0.2]) {
      for (let i = 0; i <= 2000; i++) {
        const t = i / 2000;
        expectClose(workletDsp.polyblep(t, dt), dsp.polyblep(t, dt));
      }
    }
  });

  it("pulseValue and pulseSample", () => {
    for (const duty of [0.125, 0.25, 0.5, 0.75]) {
      for (let i = 0; i < 2000; i++) {
        const phase = i / 2000;
        expectClose(
          workletDsp.pulseValue(phase, duty),
          dsp.pulseValue(phase, duty),
        );
        expectClose(
          workletDsp.pulseSample(phase, duty, 100 / 44100),
          dsp.pulseSample(phase, duty, 100 / 44100),
        );
      }
    }
  });

  it("triangleValue over two full periods", () => {
    for (let i = 0; i <= 4000; i++) {
      const phase = i / 2000;
      expectClose(workletDsp.triangleValue(phase), dsp.triangleValue(phase));
    }
  });

  it("lfsrNext/lfsrOutput — full long-mode period and short-mode sweeps", () => {
    let a = 1;
    let b = 1;
    for (let i = 0; i < 32767; i++) {
      a = dsp.lfsrNext(a, false);
      b = workletDsp.lfsrNext(b, false);
      if (a !== b) throw new Error(`LFSR long divergence at step ${i}`);
      if (dsp.lfsrOutput(a) !== workletDsp.lfsrOutput(b)) {
        throw new Error(`LFSR output divergence at step ${i}`);
      }
    }
    for (const seed of [1, 7, 0x1234, 32767]) {
      let x = seed;
      let y = seed;
      for (let i = 0; i < 1000; i++) {
        x = dsp.lfsrNext(x, true);
        y = workletDsp.lfsrNext(y, true);
        if (x !== y) throw new Error(`LFSR short divergence at seed ${seed}`);
      }
    }
  });

  it("adsrLevel over a dense time sweep with varied envelopes", () => {
    const envelopes = [
      [0.01, 0.1, 0.5, 0.2, 0.4],
      [0, 0, 1, 0, 0.1],
      [0.005, 0.25, 0, 0.5, 1.0],
      [0.02, 0.02, 0.8, 0.01, 0.03],
    ] as const;
    for (const [a, d, s, r, hold] of envelopes) {
      for (let i = 0; i <= 4000; i++) {
        const t = (i / 1000) * 0.3;
        expectClose(
          workletDsp.adsrLevel(t, a, d, s, r, hold),
          dsp.adsrLevel(t, a, d, s, r, hold),
        );
      }
    }
  });
});
