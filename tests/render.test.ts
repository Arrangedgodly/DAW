/**
 * IM-5 unit tests: pure helpers of the offline render pipeline (node).
 * The real offline render (worklet + FX graph + parity proofs) is covered by
 * tests/browser/render-parity.test.ts (D8 layer 2).
 */

import { describe, expect, it } from "vitest";
import {
  computeLoopSteps,
  expandLaneEventsForLoop,
  foldTail,
  lcm,
} from "../src/audio/render";
import { timeAtStep, secondsPerStep } from "../src/audio/time";
import type { VoiceNoteOnEvent } from "../src/audio/presets";

const SR = 44100;

function fakeEvent(time: number): VoiceNoteOnEvent {
  return {
    type: "note-on",
    time,
    wave: 0,
    freq: 220,
    freqEnd: 220,
    sweepSeconds: 0,
    duty: 0.5,
    noiseMix: 0,
    noiseShort: false,
    noiseRate: 1,
    attack: 0.001,
    decay: 0.05,
    sustain: 0.5,
    release: 0.05,
  } as VoiceNoteOnEvent;
}

describe("lcm / computeLoopSteps", () => {
  it("lcm is exact for chain-length multiples", () => {
    expect(lcm(16, 16)).toBe(16);
    expect(lcm(16, 32)).toBe(32);
    expect(lcm(32, 48)).toBe(96);
  });

  it("LCM over lanes; empty/zero chains skipped", () => {
    expect(computeLoopSteps([16, 32, 64])).toBe(64);
    expect(computeLoopSteps([16, 0, 16])).toBe(16);
    // LL-2: the fallback is the constant 16 (one bar — the v0.1 default
    // basis; the SV-1 compat derivation retired).
    expect(computeLoopSteps([0, 0])).toBe(16);
  });

  it("loop length is exactly bars × beats × samples/beat at 44100", () => {
    // All 1-bar chains, bpm 120: 16 steps × 0.125 s × 44100 = 88200.
    const steps = computeLoopSteps([16, 16, 16, 16]);
    expect(steps).toBe(16);
    expect(steps * secondsPerStep(120) * SR).toBe(88200);
    // bars(1) × beats(4) × (44100 × 60 / 120) — the AC formula, independently.
    expect(1 * 4 * ((SR * 60) / 120)).toBe(88200);
    // bpm 140, 2-bar loop: 32 steps × 60/(140·4) s × 44100 = 151200, integer.
    const steps140 = computeLoopSteps([32]);
    expect(steps140 * secondsPerStep(140) * SR).toBe(151200);
    expect(Number.isInteger(steps140 * secondsPerStep(140) * SR)).toBe(true);
  });
});

describe("expandLaneEventsForLoop", () => {
  it("wraps a lane's chain against the common loop with exact step times", () => {
    const groove = { bpm: 120, swing: 0 };
    const byStep = new Map<number, VoiceNoteOnEvent[]>([
      [0, [fakeEvent(0)]],
      [3, [fakeEvent(0.1)]],
    ]);
    const events = expandLaneEventsForLoop(
      { chainSteps: 16, byStep },
      32,
      groove,
    );
    // step 0 → global 0 and 16; step 3 → global 3 and 19.
    expect(events.map((e) => e.time)).toEqual([
      timeAtStep(0, groove),
      timeAtStep(3, groove),
      timeAtStep(16, groove),
      timeAtStep(19, groove),
    ]);
    // The shared-compile identity: every event time is EXACTLY
    // timeAtStep(globalStep) — the same pure time math the live scheduler
    // uses (compileSong is the only scheduling authority; D2–D4). Individual
    // steps are not integer samples (5512.5/step @120 BPM); the LOOP boundary
    // is, because loopSteps is a multiple of 16.
    expect(Number.isInteger(timeAtStep(32, groove) * SR)).toBe(true);
  });

  it("preserves exact swing times on wrapped iterations", () => {
    const groove = { bpm: 120, swing: 0.3 };
    const byStep = new Map<number, VoiceNoteOnEvent[]>([[1, [fakeEvent(0)]]]);
    const events = expandLaneEventsForLoop(
      { chainSteps: 16, byStep },
      32,
      groove,
    );
    expect(events.map((e) => e.time)).toEqual([
      timeAtStep(1, groove),
      timeAtStep(17, groove),
    ]);
  });

  it("sorted output; empty chain → no events", () => {
    const groove = { bpm: 100, swing: 0 };
    const byStep = new Map<number, VoiceNoteOnEvent[]>([
      [5, [fakeEvent(0), fakeEvent(0)]],
    ]);
    const events = expandLaneEventsForLoop(
      { chainSteps: 8, byStep },
      16,
      groove,
    );
    expect(events).toHaveLength(4);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    }
    expect(
      expandLaneEventsForLoop({ chainSteps: 0, byStep }, 16, groove),
    ).toEqual([]);
  });
});

describe("foldTail", () => {
  it("wraps the tail beyond loopSamples onto the first tail-length samples", () => {
    const L = 10; // tail length is implied: raw.length - L = 4
    const raw = [
      new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100, 200, 300, 400]),
    ];
    const [out] = foldTail(raw, L);
    expect(out).toHaveLength(L);
    // out[i] = raw[i] + raw[L+i] for i < T, else raw[i].
    expect(Array.from(out)).toEqual([101, 202, 303, 404, 5, 6, 7, 8, 9, 10]);
  });

  it("zero tail is a truncation; throws when buffer shorter than loop", () => {
    const raw = [new Float32Array([1, 2, 3])];
    expect(Array.from(foldTail(raw, 3)[0])).toEqual([1, 2, 3]);
    expect(() => foldTail(raw, 4)).toThrow();
  });

  it("is pure (input untouched)", () => {
    const raw = [new Float32Array([1, 2, 3, 4])];
    const before = Array.from(raw[0]);
    foldTail(raw, 2);
    expect(Array.from(raw[0])).toEqual(before);
  });
});
