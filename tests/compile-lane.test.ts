import { describe, expect, it } from "vitest";
import { compileLaneEvents } from "../src/audio/compile";
import { getDrumKit, getPreset } from "../src/audio/presets";
import { timeAtStep, secondsPerStep } from "../src/audio/time";
import { toEffectiveScale } from "../src/document/scales";
import type {
  DrumPattern,
  LaneGate,
  PitchedPattern,
  PitchedRow,
} from "../src/document/schema";
import { notesFromRowCells, resolveGateSteps } from "../src/document/schema";

const groove = { bpm: 120, swing: 0 };
const swung = { bpm: 130, swing: 0.4 };
const scale = toEffectiveScale({ root: 0, mode: "minor" });

/**
 * Author pitched patterns in the readable v1 cell strings and convert through
 * the SC-1 migration law, exactly like a migrated document would (gate +
 * groove must match the compile call so the derived sustain counts agree).
 */
function pitchedPattern(
  rows: { degree: number; steps: number[] }[],
  gate: LaneGate,
  grooveOpts: { bpm: number },
): PitchedPattern {
  const pitchedRows = rows as PitchedRow[];
  return {
    kind: "pitched",
    id: "p",
    name: "P",
    bars: 1,
    rowDegrees: pitchedRows.map((r) => r.degree),
    notes: notesFromRowCells(
      pitchedRows,
      resolveGateSteps(gate, grooveOpts.bpm),
      16,
    ),
  };
}

/** Hand-authored v2 notes (the SC-2 native law input). */
function notesPattern(
  notes: readonly { degree: number; start: number; length: number }[],
  rowDegrees: readonly number[] = [0, 1, 2, 3, 4, 5, 6],
  bars: 1 | 2 | 4 = 1,
): PitchedPattern {
  return {
    kind: "pitched",
    id: "p",
    name: "P",
    bars,
    rowDegrees: [...rowDegrees],
    notes: [...notes],
  };
}

describe("compileLaneEvents — pitched", () => {
  const preset = getPreset("preset-bass-1")!;

  it("event times are exactly the timeAtStep values (swing included)", () => {
    const pattern = pitchedPattern(
      [{ degree: 0, steps: [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] }],
      { unit: "steps", value: 2 },
      swung,
    );
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 2 },
      groove: swung,
      scale,
    });
    const onSteps = [0, 2, 8, 15];
    expect(events.map((e) => e.time)).toEqual(
      onSteps.map((s) => timeAtStep(s, swung)),
    );
    expect(events).toEqual([...events].sort((a, b) => a.time - b.time));
  });

  it("gate in steps → holdSeconds = gate * secondsPerStep", () => {
    const pattern = pitchedPattern(
      [{ degree: 0, steps: [1, ...Array(15).fill(0)] }],
      { unit: "steps", value: 2 },
      groove,
    );
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 2 },
      groove,
      scale,
    });
    expect(events[0].holdSeconds).toBeCloseTo(2 * secondsPerStep(120), 12);
  });

  it("SC-2: holdSeconds comes from note.length, not the lane gate", () => {
    // A 3.5-step note under a 1-step gate still sounds 3.5 steps: the gate is
    // only the single-click default, never a duration scaler.
    const pattern = notesPattern([{ degree: 0, start: 0, length: 3.5 }]);
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 1 },
      groove,
      scale,
    });
    expect(events).toHaveLength(1);
    expect(events[0].holdSeconds).toBeCloseTo(3.5 * secondsPerStep(120), 12);
  });

  it("SC-2: changing the lane gate leaves compiled holds untouched", () => {
    const pattern = notesPattern([{ degree: 2, start: 4, length: 8 }]);
    const holds = [1, 4, 16].map(
      (gateValue) =>
        compileLaneEvents({
          pattern,
          preset,
          gate: { unit: "steps", value: gateValue },
          groove,
          scale,
        })[0].holdSeconds,
    );
    expect(holds[0]).toBeCloseTo(8 * secondsPerStep(120), 12);
    expect(holds[1]).toBe(holds[0]);
    expect(holds[2]).toBe(holds[0]);
  });

  it("SC-2: a note may sound past the pattern end (v0 gate-overhang law)", () => {
    // Head on the last step, 15 steps long: sounds across the wrap.
    const pattern = notesPattern([{ degree: 0, start: 15, length: 15 }]);
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 1 },
      groove,
      scale,
    });
    expect(events[0].time).toBe(timeAtStep(15, groove));
    expect(events[0].holdSeconds).toBeCloseTo(15 * secondsPerStep(120), 12);
  });

  it("SC-2: notes on degrees outside the row manifest are unplayed", () => {
    // v1 law preserved: no row → nothing to sound (manifest is pattern data).
    const pattern = notesPattern(
      [
        { degree: 0, start: 0, length: 1 },
        { degree: 5, start: 0, length: 1 },
      ],
      [0, 1, 2, 3, 4], // degree 5 has no row
    );
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 1 },
      groove,
      scale,
    });
    expect(events).toHaveLength(1);
  });

  it("seconds-gate notes hold their migrated grid length (SC-2 law)", () => {
    // The v1 seconds gate resolved to the 0.25-step grid at migration
    // (0.31 s / 0.125 s = 2.48 → 2.5 steps); the note's own length is now the
    // duration — musical time, so it survives BPM changes (documented SC-1
    // quantization corner, consumed natively by SC-2).
    const pattern = pitchedPattern(
      [{ degree: 0, steps: [1, ...Array(15).fill(0)] }],
      { unit: "seconds", value: 0.31 },
      groove,
    );
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "seconds", value: 0.31 },
      groove,
      scale,
    });
    expect(events[0].holdSeconds).toBeCloseTo(2.5 * secondsPerStep(120), 12);
  });

  it("sustain markers (cell 2) extend the hold by one step each", () => {
    const gate = { unit: "steps" as const, value: 1 };
    const pattern = pitchedPattern(
      [{ degree: 0, steps: [1, 2, 2, 0, ...Array(12).fill(0)] }],
      gate,
      groove,
    );
    const events = compileLaneEvents({ pattern, preset, gate, groove, scale });
    expect(events.length).toBe(1);
    expect(events[0].holdSeconds).toBeCloseTo(
      (1 + 2) * secondsPerStep(120),
      12,
    );
  });

  it("frequency comes from degreeToMidi at the preset octave", () => {
    const pattern = pitchedPattern(
      [{ degree: 7, steps: [1, ...Array(15).fill(0)] }],
      { unit: "steps", value: 1 },
      groove,
    );
    const events = compileLaneEvents({
      pattern,
      preset,
      gate: { unit: "steps", value: 1 },
      groove,
      scale,
    });
    // degree 7 in 7-note minor at octaveBase 2 = root one octave up = MIDI 48
    expect(events[0].freq).toBeCloseTo(440 * Math.pow(2, (48 - 69) / 12), 9);
  });

  it("chord stacking emits degree, +2, +4 at the same time", () => {
    const pattern = pitchedPattern(
      [{ degree: 0, steps: [1, ...Array(15).fill(0)] }],
      { unit: "steps", value: 4 },
      groove,
    );
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
    const pattern = pitchedPattern(
      [{ degree: 0, steps: [1, ...Array(15).fill(0)] }],
      { unit: "steps", value: 1 },
      groove,
    );
    expect(() =>
      compileLaneEvents({
        pattern,
        preset,
        gate: { unit: "steps", value: 1 },
        groove,
      }),
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
      kick: [
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
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
    const kickTimes = events
      .filter((e) => e.freq === kit.pieces.kick.baseFreq)
      .map((e) => e.time);
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
