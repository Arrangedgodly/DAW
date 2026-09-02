/**
 * TH-1 browser test 2 — scheduler onset budget, D8 layer 2 (RES-7 §±2ms).
 *
 * Discharges the IM-3 caveat: this verifies the REAL process() loop, not the
 * node-parity twin. A dense 4-lane 2-bar pattern is compiled by the
 * production compiler (compileLaneEvents — the only scheduling authority),
 * pre-loaded into the real AudioWorklet module (addModule works on
 * OfflineAudioContext), rendered offline, and onsets are found by sample-
 * energy detection. Budget: every onset must land within ONE render quantum
 * (128 samples ≈ 2.9 ms @ 44.1 kHz) of timeAtStep(step) × 44100.
 *
 * Each lane is rendered in its own offline graph: amplitude-region onset
 * detection needs inter-onset silence, and legato tails across lanes would
 * merge regions in a single mixdown. All four renders share the exact same
 * worklet code path the app uses.
 */

import { describe, expect, it } from "vitest";
import { compileLaneEvents } from "../../src/audio/compile";
import { getDrumKit, getPreset } from "../../src/audio/presets";
import {
  loopLengthSeconds,
  timeAtStep,
  type GrooveOptions,
} from "../../src/audio/time";
import { toEffectiveScale } from "../../src/document/scales";
import type {
  DrumPattern,
  LaneGate,
  PitchedPattern,
} from "../../src/document/schema";
import { SAMPLE_RATE, detectOnsets, renderOffline } from "./helpers";

const GROOVE: GrooveOptions = { bpm: 120, swing: 0.15 };
const BARS = 2;
const STEPS = 32;
const START_TIME = 0.25;
const LOOP_SECONDS = loopLengthSeconds(BARS, GROOVE.bpm);
/** D8 layer 2: one render quantum. */
const QUANTUM_SAMPLES = 128;

const SHORT_GATE: LaneGate = { unit: "steps", value: 0.25 };

function drumPattern(): DrumPattern {
  const steps = (on: (step: number) => boolean) =>
    Array.from({ length: STEPS }, (_, i) => on(i));
  return {
    kind: "drums",
    id: "perf-drums",
    name: "dense",
    bars: BARS,
    steps: {
      kick: steps((s) => s % 4 === 0),
      snare: steps((s) => s % 8 === 4),
      hat: steps(() => true),
      openhat: steps(() => false),
      clap: steps((s) => s % 16 === 8),
      tom: steps(() => false),
    },
  };
}

function pitchedPattern(
  id: string,
  degree: number,
  on: (step: number) => boolean,
): PitchedPattern {
  return {
    kind: "pitched",
    id,
    name: id,
    bars: BARS,
    rows: [
      {
        degree,
        steps: Array.from({ length: STEPS }, (_, i) =>
          on(i) ? (1 as const) : (0 as const),
        ),
      },
    ],
  };
}

/** Unique swung onset times (seconds, loop-relative) for a set of steps. */
function expectedTimes(stepsOn: readonly number[]): number[] {
  return [...new Set(stepsOn.map((s) => timeAtStep(s, GROOVE)))].sort(
    (a, b) => a - b,
  );
}

describe("scheduler onset budget (offline, real worklet)", () => {
  const scale = toEffectiveScale({ root: 0, mode: "minor" });

  const lanes = [
    {
      name: "drums (hit on every 16th)",
      events: compileLaneEvents({
        pattern: drumPattern(),
        preset: getDrumKit("kit-default")!,
        gate: SHORT_GATE,
        groove: GROOVE,
      }),
      expected: expectedTimes(Array.from({ length: STEPS }, (_, i) => i)),
    },
    {
      name: "bass (note on every 16th)",
      events: compileLaneEvents({
        pattern: pitchedPattern("perf-bass", 0, () => true),
        preset: getPreset("preset-bass-1")!,
        gate: SHORT_GATE,
        groove: GROOVE,
        scale,
      }),
      expected: expectedTimes(Array.from({ length: STEPS }, (_, i) => i)),
    },
    {
      name: "chords (note on every 8th)",
      events: compileLaneEvents({
        pattern: pitchedPattern("perf-chords", 3, (s) => s % 2 === 0),
        preset: getPreset("preset-chords-1")!,
        gate: SHORT_GATE,
        groove: GROOVE,
        scale,
      }),
      expected: expectedTimes(
        Array.from({ length: STEPS }, (_, i) => i).filter((s) => s % 2 === 0),
      ),
    },
    {
      name: "lead (note on every 16th)",
      events: compileLaneEvents({
        pattern: pitchedPattern("perf-lead", 7, () => true),
        preset: getPreset("preset-lead-1")!,
        gate: SHORT_GATE,
        groove: GROOVE,
        scale,
      }),
      expected: expectedTimes(Array.from({ length: STEPS }, (_, i) => i)),
    },
  ];

  it.each(lanes)("onsets within one render quantum: $name", async (lane) => {
    expect(lane.events.length).toBeGreaterThan(0);
    const { mono } = await renderOffline({
      startTime: START_TIME,
      duration: START_TIME + LOOP_SECONDS + 0.5,
      lanes: [lane.events],
    });

    const onsets = detectOnsets(mono);
    const expectedSamples = lane.expected.map(
      (t) => Math.round((t + START_TIME) * SAMPLE_RATE),
    );

    // No spurious onsets (region splits inside a tail) and none missed.
    expect(onsets.length).toBe(expectedSamples.length);

    for (let i = 0; i < expectedSamples.length; i++) {
      const delta = onsets[i] - expectedSamples[i];
      expect(
        Math.abs(delta),
        `onset ${i}: detected ${onsets[i]} vs expected ${expectedSamples[i]} (Δ${delta} samples)`,
      ).toBeLessThanOrEqual(QUANTUM_SAMPLES);
    }
  });

  it("combined 4-lane dense mix renders through the full graph", async () => {
    const { mono } = await renderOffline({
      startTime: START_TIME,
      duration: START_TIME + LOOP_SECONDS + 0.5,
      lanes: lanes.map((l) => l.events),
    });
    let peak = 0;
    let nonFinite = 0;
    for (let i = 0; i < mono.length; i++) {
      if (!Number.isFinite(mono[i])) nonFinite++;
      const a = Math.abs(mono[i]);
      if (a > peak) peak = a;
    }
    expect(nonFinite).toBe(0);
    expect(peak).toBeGreaterThan(0.1);
    // No soft-clip stage exists in this raw-graph helper yet (session master
    // gain + soft-clip is the D2 chain); the bound is "sane sum of ≤16
    // voices", i.e. no runaway feedback/NaN spiral.
    expect(peak).toBeLessThanOrEqual(8.0);
  });
});
