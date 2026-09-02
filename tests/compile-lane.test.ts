import { describe, expect, it } from "vitest";
import { compileLaneEvents } from "../src/audio/compile";
import { getDrumKit, getPreset } from "../src/audio/presets";
import { timeAtStep, secondsPerStep } from "../src/audio/time";
import { toEffectiveScale } from "../src/document/scales";
import type { DrumPattern, PitchedPattern } from "../src/document/schema";

const groove = { bpm: 120, swing: 0 };
const swung = { bpm: 130, swing: 0.4 };
const scale = toEffectiveScale({ root: 0, mode: "minor" });

function pitchedPattern(rows: { degree: number; steps: number[] }[]): PitchedPattern {
  return {
    kind: "pitched",
    id: "p",
    name: "P",
    bars: 1,
    rows: rows.map((r) => ({ degree: r.degree, steps: r.steps as PitchedPattern["rows"][number]["steps"] })),
  };
}

describe("compileLaneEvents — pitched", () => {
  const preset = getPreset("preset-bass-1")!;

  it("event times are exactly the timeAtStep values (swing included)", () => {
    const pattern = pitchedPattern([
      { degree: 0, steps: [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] },
    ]);
    const events = compileLaneEvents({ pattern, preset, gate: { unit: "steps", value: 2 }, groove: swung, scale });
    const onSteps = [0, 2, 8, 15];
    expect(events.map((e) => e.time)).toEqual(onSteps.map((s) => timeAtStep(s, swung)));
    expect(events).toEqual([...events].sort((a, b) => a.time - b.time));
  });

  it("gate in steps → holdSeconds = gate * secondsPerStep", () => {
    const pattern = pitchedPattern([{ degree: 0, steps: [1, ...Array(15).fill(0)] }]);
    const events = compileLaneEvents({ pattern, preset, gate: { unit: "steps", value: 2 }, groove, scale });
    expect(events[0].holdSeconds).toBeCloseTo(2 * secondsPerStep(120), 12);
  });

  it("gate in seconds is passed through", () => {
    const pattern = pitchedPattern([{ degree: 0, steps: [1, ...Array(15).fill(0)] }]);
    const events = compileLaneEvents({ pattern, preset, gate: { unit: "seconds", value: 0.31 }, groove, scale });
    expect(events[0].holdSeconds).toBe(0.31);
  });

  it("sustain markers (cell 2) extend the hold by one step each", () => {
    const pattern = pitchedPattern([{ degree: 0, steps: [1, 2, 2, 0, ...Array(12).fill(0)] }]);
    const gate = { unit: "steps" as const, value: 1 };
    const events = compileLaneEvents({ pattern, preset, gate, groove, scale });
    expect(events.length).toBe(1);
    expect(events[0].holdSeconds).toBeCloseTo((1 + 2) * secondsPerStep(120), 12);
  });

  it("frequency comes from degreeToMidi at the preset octave", () => {
    const pattern = pitchedPattern([{ degree: 7, steps: [1, ...Array(15).fill(0)] }]);
    const events = compileLaneEvents({ pattern, preset, gate: { unit: "steps", value: 1 }, groove, scale });
    // degree 7 in 7-note minor at octaveBase 2 = root one octave up = MIDI 48
    expect(events[0].freq).toBeCloseTo(440 * Math.pow(2, (48 - 69) / 12), 9);
  });

  it("chord stacking emits degree, +2, +4 at the same time", () => {
    const pattern = pitchedPattern([{ degree: 0, steps: [1, ...Array(15).fill(0)] }]);
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 4 },
      groove,
      scale,
      stackChord: true,
    });
    expect(events.length).toBe(3);
    expect(new Set(events.map((e) => e.time)).size).toBe(1);
    expect(new Set(events.map((e) => e.freq)).size).toBe(3);
  });

  it("throws when a pitched pattern has no scale", () => {
    const pattern = pitchedPattern([{ degree: 0, steps: [1, ...Array(15).fill(0)] }]);
    expect(() =>
      compileLaneEvents({ pattern, preset, gate: { unit: "steps", value: 1 }, groove }),
    ).toThrow(/scale/);
  });
});

describe("compileLaneEvents — drums", () => {
  const kit = getDrumKit("kit-default")!;
  const pattern: DrumPattern = {
    kind: "drums",
    id: "d",
    name: "D",
    bars: 1,
    steps: {
      kick: [true, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false],
      snare: Array(16).fill(false),
      hat: Array(16).fill(false),
      openhat: Array(16).fill(false),
      clap: Array(16).fill(false),
      tom: Array(16).fill(false),
    },
  };
  pattern.steps.snare[4] = true;

  it("maps pieces to their kit presets at exact step times", () => {
    const events = compileLaneEvents({
      pattern,
      preset: kit,
      gate: { unit: "steps", value: 1 },
      groove: swung,
    });
    expect(events.length).toBe(3);
    const kickTimes = events.filter((e) => e.freq === kit.pieces.kick.baseFreq).map((e) => e.time);
    expect(kickTimes).toEqual([timeAtStep(0, swung), timeAtStep(7, swung)]);
    const snare = events.find((e) => e.freq === kit.pieces.snare.baseFreq)!;
    expect(snare.time).toBe(timeAtStep(4, swung));
    expect(snare.noiseMix).toBeCloseTo(kit.pieces.snare.noiseMix, 9);
    expect(events).toEqual([...events].sort((a, b) => a.time - b.time));
  });

  it("each piece keeps its own envelope/sweep character", () => {
    const events = compileLaneEvents({
      pattern,
      preset: kit,
      gate: { unit: "steps", value: 1 },
      groove,
    });
    const kick = events.find((e) => e.sweepSeconds > 0)!;
    expect(kick.freq).toBe(kit.pieces.kick.baseFreq);
    expect(kick.sweepSeconds).toBe(kit.pieces.kick.pitchSweep!.seconds);
  });

  it("skips pieces missing from the kit map (forward compat)", () => {
    const partial = { ...kit, pieces: { ...kit.pieces } } as typeof kit;
    delete (partial.pieces as Record<string, unknown>).clap;
    const events = compileLaneEvents({
      pattern,
      preset: partial,
      gate: { unit: "steps", value: 1 },
      groove,
    });
    expect(events.length).toBe(3); // clap was off anyway; no crash
  });
});
