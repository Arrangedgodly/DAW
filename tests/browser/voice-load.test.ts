/**
 * TH-1 browser test 4 — worst-case voice load (offline).
 *
 * 16 simultaneous voices (4 lanes × 4 stacked chord notes — the pool max,
 * 4 × 8-voice lanes fully loaded is exercised via every-step retries) plus
 * the real metronome oscillator path, through the real worklet graph.
 * Asserts: render completes without error, no NaN/Infinity anywhere in the
 * buffer (denormal/garbage guard), output is audible and peak-limited.
 */

import { describe, expect, it } from "vitest";
import { compileLaneEvents } from "../../src/audio/compile";
import { getDrumKit, getPreset } from "../../src/audio/presets";
import { toEffectiveScale } from "../../src/document/scales";
import type { DrumPattern, PitchedPattern } from "../../src/document/schema";
import { SAMPLE_RATE, findNonFinite, renderOffline } from "./helpers";

const GROOVE = { bpm: 120, swing: 0 };
const START_TIME = 0.25;
const DURATION = 4.0;

function fullDrums(): DrumPattern {
  const all = new Array(32).fill(true);
  return {
    kind: "drums",
    id: "load-drums",
    name: "all",
    bars: 2,
    steps: {
      kick: all,
      snare: all,
      hat: all,
      openhat: all,
      clap: all,
      tom: all,
    },
  };
}

/** Chord lane: stackChord triples every event → 3 voices per note. */
function chordPattern(): PitchedPattern {
  return {
    kind: "pitched",
    id: "load-chords",
    name: "chords",
    bars: 2,
    rows: [
      { degree: 0, steps: new Array(32).fill(1) },
      { degree: 4, steps: new Array(32).fill(1) },
    ],
  };
}

describe("voice load (16 simultaneous voices + metronome, offline)", () => {
  it("renders without error, NaN, or silence", async () => {
    const scale = toEffectiveScale({ root: 0, mode: "minor" });
    const gate = { unit: "steps" as const, value: 4 };

    const drums = compileLaneEvents({
      pattern: fullDrums(),
      preset: getDrumKit("kit-default")!,
      gate,
      groove: GROOVE,
    });
    const bass = compileLaneEvents({
      pattern: {
        kind: "pitched",
        id: "load-bass",
        name: "bass",
        bars: 2,
        rows: [{ degree: 0, steps: new Array(32).fill(1) }],
      },
      preset: getPreset("preset-bass-1")!,
      gate,
      groove: GROOVE,
      scale,
    });
    const chords = compileLaneEvents({
      pattern: chordPattern(),
      preset: getPreset("preset-chords-1")!,
      gate,
      groove: GROOVE,
      scale,
      stackChord: true,
    });
    const lead = compileLaneEvents({
      pattern: {
        kind: "pitched",
        id: "load-lead",
        name: "lead",
        bars: 2,
        rows: [{ degree: 7, steps: new Array(32).fill(1) }],
      },
      preset: getPreset("preset-lead-1")!,
      gate,
      groove: GROOVE,
      scale,
    });

    // Sanity: chords lane stacks 2 rows × 3 chord tones = 6 voices per step,
    // drums fire 6 pieces per step, bass + lead 1 each → ≥16 concurrent
    // voices at every step — above the 8-voices/lane pool on 2 lanes.
    const perStepChords = chords.filter((e) => e.time === chords[0].time);
    expect(perStepChords.length).toBe(6);
    expect(drums.filter((e) => e.time === drums[0].time).length).toBe(6);

    const { mono } = await renderOffline({
      startTime: START_TIME,
      duration: DURATION,
      lanes: [drums, bass, chords, lead],
      metronome: {
        beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
        downbeats: new Set([0, 2]),
      },
    });

    expect(mono.length).toBe(Math.ceil(DURATION * SAMPLE_RATE));
    expect(findNonFinite(mono)).toBe(0);

    let peak = 0;
    for (let i = 0; i < mono.length; i++) {
      const a = Math.abs(mono[i]);
      if (a > peak) peak = a;
    }
    // Audible under full load...
    expect(peak).toBeGreaterThan(0.2);
    // ...and the raw sum stays sane (no runaway feedback/NaN spiral). The
    // master soft-clip stage (D2) is session-level and lands with IM-4; the
    // bound here is ~16 full-level voices plus click.
    expect(peak).toBeLessThanOrEqual(8.0);
  });
});
