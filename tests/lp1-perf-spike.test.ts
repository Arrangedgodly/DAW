/**
 * LP-1 (iteration 3) — long-loop perf spike, NODE half (Thor).
 *
 * Measures + proves the bounded time-math half of the 128-bar spike:
 *
 * (c) O(steps) scan cost vs the bounded replacement at 2048 steps:
 *   - `stepIndexAtTime` (time.ts:99-112) and `stepOfTime` (song.ts:118-123)
 *     are O(steps) linear scans. Today they run at ≤64 steps (LoopBars 1/2/4
 *     compat window), but song.ts's `stepOfTime` is ALREADY steps-parametric
 *     and runs over a full pattern at compile time — a dense 128-bar pattern
 *     compiles with a 2048-step scan PER EVENT, on every content edit
 *     (engineBridge recompiles the lane on every toggle). LL-2 additionally
 *     re-bases the playhead/quantizedStep basis to per-lane chain totals
 *     (up to 2048 steps), putting the scan on the per-rAF path.
 *   - The committed replacement: an O(1) guess-and-verify closed form —
 *     floor(t / spb) as the guess, then at most ±1 candidate checks using
 *     the EXACT timeAtStep boundary predicates (bit-identical decisions to
 *     the scan by construction; proven by the exhaustive sweep below).
 * (e) codec round-trip cost of the dense-128-bar document (SV-1 measured
 *   2,693,153 canonical chars ≈ 2.63 MB max-dense; re-confirmed here with
 *   encode/decode wall-time at that size).
 * Plus the pure halves of the export cost: compile + event expansion at the
 * 128-bar LCM (the audio render wall-time is the browser harness's number).
 *
 * What is ASSERTED (deterministic, CI-stable) vs RECORDED (console lines
 * `[LP-1 …]`, journaled into docs/dev/perf-budget.md §10 by the worker):
 * the equivalence sweep + API parity are hard asserts; every timing number
 * is recorded only (timing asserts are flaky on shared runners — the TH-1
 * recorded choice).
 */

import { describe, expect, it } from "vitest";
import { compileLaneEvents } from "../src/audio/compile";
import { compileLaneSchedule } from "../src/audio/song";
import { expandLaneEventsForLoop } from "../src/audio/render";
import {
  type GrooveOptions,
  secondsPerStep,
  stepIndexAtTime,
  timeAtStep,
} from "../src/audio/time";
import { decode, encode } from "../src/document/codec";
import {
  type DrumPattern,
  type Note,
  type Pattern,
  type ProjectDocument,
  createDefaultProject,
} from "../src/document/schema";
import { getPreset } from "../src/audio/presets";
import { effectiveScale } from "../src/document/scales";
import {
  scanStepIndexAtTime,
  scanStepOfTime,
  stepIndexAtTimeBounded,
  stepOfTimeBounded,
} from "./lp1-spike-harness";

// ---------------------------------------------------------------------------
// (c) Equivalence proofs — exhaustive sweeps (hard asserts)
// ---------------------------------------------------------------------------

const SWEEP_BPMS = [60, 83, 90, 120, 137, 150, 176, 200];
const SWEEP_SWINGS = [0, 0.125, 0.25, 1 / 3, 0.5, 0.625, 0.75, 0.9, 1];
const SWEEP_STEP_COUNTS = [16, 64, 112, 1024, 2048];

/** Neighbors around a boundary time without relying on Math.nextafter. */
function boundaryNeighborhood(t: number): number[] {
  const eps = Math.max(Math.abs(t) * 1e-12, 1e-15);
  return [t - eps, t, t + eps];
}

describe("LP-1 (c): bounded step lookup replaces the O(steps) scans", () => {
  // EXHAUSTIVE at the target scale: every step boundary + midpoint + ulp
  // neighbors of one 2048-step loop, at the swing extremes + mid (the
  // parity-driven cases). The spike's full run additionally swept every
  // bpm/swing/step-count combination (~5.2M checks, 65 s, numbers journaled
  // in perf-budget.md §10); the committed proof keeps the exhaustive
  // target-scale sweep + the broad spot sweep below (~10 s).
  it("stepOfTimeBounded === scan at EVERY step boundary + midpoint of the 2048-step loop (swing 0 / 0.5 / 1)",
    { timeout: 60_000 },
    () => {
      let checked = 0;
      for (const swing of [0, 0.5, 1]) {
        const groove: GrooveOptions = { bpm: 120, swing };
        const steps = 2048;
        for (let i = 0; i < steps; i++) {
          const t0 = timeAtStep(i, groove);
          const t1 = i + 1 < steps ? timeAtStep(i + 1, groove) : t0 + 1;
          for (const t of [
            ...boundaryNeighborhood(t0),
            ...boundaryNeighborhood(t1),
            (t0 + t1) / 2,
          ]) {
            if (t < 0) continue;
            expect(stepOfTimeBounded(t, groove, steps)).toBe(
              scanStepOfTime(t, groove, steps),
            );
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(40_000);
    });

  it("stepOfTimeBounded === scan across the bpm × swing × step-count grid (spot: edges, odd/even, every 97th)",
    { timeout: 60_000 },
    () => {
      for (const bpm of SWEEP_BPMS) {
        for (const swing of SWEEP_SWINGS) {
          const groove: GrooveOptions = { bpm, swing };
          for (const steps of SWEEP_STEP_COUNTS) {
            const probes = new Set<number>();
            for (let i = 0; i < 16; i++) probes.add(i); // loop head
            for (let i = Math.max(0, steps - 16); i < steps; i++)
              probes.add(i); // loop tail (fallback edge)
            for (let i = 0; i < steps; i += 97) probes.add(i); // stride
            for (const i of probes) {
              const t0 = timeAtStep(i, groove);
              const t1 = i + 1 < steps ? timeAtStep(i + 1, groove) : t0 + 1;
              for (const t of [
                ...boundaryNeighborhood(t0),
                ...boundaryNeighborhood(t1),
                (t0 + t1) / 2,
              ]) {
                if (t < 0) continue;
                expect(stepOfTimeBounded(t, groove, steps)).toBe(
                  scanStepOfTime(t, groove, steps),
                );
              }
            }
            // Beyond the end (unwrapped compile times can exceed the
            // pattern-local window — overhang tail).
            const end = timeAtStep(steps - 1, groove);
            for (const t of [end, end + 10, end * 3]) {
              expect(stepOfTimeBounded(t, groove, steps)).toBe(
                scanStepOfTime(t, groove, steps),
              );
            }
          }
        }
      }
    });

  it("stepIndexAtTimeBounded === scan for wrapped times incl. negatives + the production LoopBars parity",
    { timeout: 120_000 },
    () => {
      for (const bpm of SWEEP_BPMS) {
        for (const swing of SWEEP_SWINGS) {
          const groove = { bpm, swing };
          for (const steps of SWEEP_STEP_COUNTS) {
            const loopLen = steps * secondsPerStep(bpm);
            for (const t of [
              0,
              loopLen,
              loopLen * 2.5,
              loopLen * 1000 + loopLen / 3,
              -loopLen / 2,
              -loopLen * 7 - 0.000001,
              loopLen - 1e-9,
            ]) {
              expect(stepIndexAtTimeBounded(t, steps, groove)).toBe(
                scanStepIndexAtTime(t, steps, groove),
              );
            }
            // Random spot checks across the whole loop.
            let seed = 0x5eed ^ steps;
            for (let k = 0; k < 200; k++) {
              seed = (seed * 1664525 + 1013904223) >>> 0;
              const t = (seed / 0xffffffff) * loopLen;
              expect(stepIndexAtTimeBounded(t, steps, groove)).toBe(
                scanStepIndexAtTime(t, steps, groove),
              );
            }
          }
        }
      }
      // Parity with the PRODUCTION function at its legal vocab (1/2/4 bars):
      // the bounded form is a drop-in at today's sizes too. (LL-2: the
      // production option is steps-typed — bars x 16.)
      for (const bars of [1, 2, 4] as const) {
        const groove = { bpm: 120, swing: 0.5 };
        const loopLen = bars * 16 * secondsPerStep(120);
        for (let k = 0; k < 500; k++) {
          const t = (k / 500) * loopLen;
          expect(stepIndexAtTimeBounded(t, bars * 16, groove)).toBe(
            stepIndexAtTime(t, { steps: bars * 16, ...groove }),
          );
        }
      }
    });

  it("RECORDED (c): scan vs bounded cost at 2048 steps — per-call and projected per-frame",
    { timeout: 120_000 },
    () => {
      const steps = 2048;
      const groove: GrooveOptions = { bpm: 120, swing: 0.25 };
      const loopLen = steps * secondsPerStep(120);
      const samples = 4096;
      const ts = Array.from(
        { length: samples },
        (_, i) => ((i + 0.37) / samples) * loopLen,
      );

      const bench = (fn: (t: number) => number, iterations: number): number => {
        // Warmup.
        for (const t of ts) fn(t);
        const t0 = performance.now();
        for (let r = 0; r < iterations; r++) for (const t of ts) fn(t);
        const totalCalls = iterations * samples;
        return ((performance.now() - t0) * 1e6) / totalCalls; // ns/call
      };

      // The scan is ~26 µs/call — 10 iterations already give 40k samples.
      const scanNs = bench((t) => scanStepIndexAtTime(t, steps, groove), 10);
      const boundedNs = bench(
        (t) => stepIndexAtTimeBounded(t, steps, groove),
        200,
      );
      // The scan's average cost at a uniform t distribution is ~half the
      // worst-case (a full miss walks the entire loop) — also record the
      // worst case by always querying near the loop end.
      const worstTs = Array.from(
        { length: samples },
        (_, i) => loopLen - 1e-6 - (i / samples) * 1e-9,
      );
      const t0 = performance.now();
      for (let r = 0; r < 10; r++) for (const t of worstTs) scanStepIndexAtTime(t, steps, groove);
      const scanWorstNs =
        ((performance.now() - t0) * 1e6) / (10 * samples);

      // Per-frame projection (the LL-2 shape): 4 grids × (playheadX +
      // quantizedStep) + the booth's getPosition() = 9 lookups/frame.
      const perFrameScanUs = (9 * scanNs) / 1000;
      const perFrameScanWorstUs = (9 * scanWorstNs) / 1000;
      const perFrameBoundedUs = (9 * boundedNs) / 1000;
      console.log(
        `[LP-1 (c) time-math @2048 steps] scan avg ${scanNs.toFixed(0)} ns/call, scan worst ${scanWorstNs.toFixed(0)} ns/call, bounded ${boundedNs.toFixed(1)} ns/call | projected per rAF frame (9 lookups): scan ${perFrameScanUs.toFixed(0)} µs (worst ${perFrameScanWorstUs.toFixed(0)} µs) vs bounded ${perFrameBoundedUs.toFixed(1)} µs`,
      );
      // Sanity only (generous, not a CI-timing gate): the bounded form is
      // an O(1) lookup — it must not degrade into a scan-sized cost.
      expect(boundedNs).toBeLessThan(1000);
    });
});

// ---------------------------------------------------------------------------
// (c, compile half) — the per-EDIT cost: compileLaneSchedule on a dense
// 128-bar pattern (the engineBridge recompile path).
// ---------------------------------------------------------------------------

/** Max-dense 128-bar pitched pattern: a note on every step of every row. */
function maxDensePitched(
  id: string,
  bars: 128,
  rowDegrees: readonly number[],
  stride = 1,
): Pattern {
  const notes: Note[] = [];
  for (const degree of rowDegrees)
    for (let start = 0; start < bars * 16; start += stride)
      notes.push({ degree, start, length: 1 });
  return {
    kind: "pitched",
    id,
    name: "X",
    bars,
    rowDegrees: [...rowDegrees],
    notes,
  };
}

/** compileLaneSchedule with the bounded stepOfTime (the LP-1 replacement). */
function compileLaneScheduleBounded(input: {
  chain: readonly Pattern[];
  preset: ReturnType<typeof getPreset>;
  groove: GrooveOptions;
  scale: ReturnType<typeof effectiveScale>;
  stackChord?: boolean;
}): ReturnType<typeof compileLaneSchedule> {
  // Same body as song.ts compileLaneSchedule, with stepOfTimeBounded in the
  // event→step inversion (the ONLY change — seam F5).
  const segments: Array<{ patternId: string; startStep: number; steps: number }> =
    [];
  const byStep = new Map<number, ReturnType<typeof compileLaneEvents>[number][]>();
  let cursor = 0;
  for (const pattern of input.chain) {
    const steps = pattern.bars * 16;
    segments.push({ patternId: pattern.id, startStep: cursor, steps });
    const events = compileLaneEvents({
      pattern,
      preset: input.preset,
      gate: { unit: "steps", value: 1 },
      groove: input.groove,
      scale: input.scale,
      stackChord: input.stackChord,
    });
    for (const event of events) {
      const local = stepOfTimeBounded(event.time, input.groove, steps);
      const chainStep = cursor + local;
      const bucket = byStep.get(chainStep);
      if (bucket) bucket.push(event);
      else byStep.set(chainStep, [event]);
    }
    cursor += steps;
  }
  return { chainSteps: cursor, segments, byStep } as ReturnType<
    typeof compileLaneSchedule
  >;
}

describe("LP-1 (c): compile cost at 128 bars (per-edit recompile path)", () => {
  it("RECORDED: compileLaneSchedule max-dense 128-bar lead — scan vs bounded, identical output",
    () => {
      const doc = createDefaultProject();
      const groove: GrooveOptions = { bpm: 120, swing: 0 };
      // 15-row lead manifest (the demo's worst lane).
      const pattern = maxDensePitched("lead-dense", 128, Array.from({ length: 15 }, (_, i) => i));
      const preset = getPreset("preset-lead-1")!;
      const scale = effectiveScale(doc, "lead");

      const inputs = { chain: [pattern], preset, groove, scale };
      const t0 = performance.now();
      const scanned = compileLaneSchedule({
        chain: inputs.chain,
        preset: inputs.preset,
        groove: inputs.groove,
        scale: inputs.scale,
        gate: { unit: "steps", value: 1 },
      });
      const scanMs = performance.now() - t0;

      const t1 = performance.now();
      const bounded = compileLaneScheduleBounded(inputs);
      const boundedMs = performance.now() - t1;

      // Identical schedules (the replacement is behavior-preserving).
      expect(bounded.chainSteps).toBe(scanned.chainSteps);
      expect(bounded.byStep.size).toBe(scanned.byStep.size);
      expect([...bounded.byStep.keys()].sort((a, b) => a - b)).toEqual(
        [...scanned.byStep.keys()].sort((a, b) => a - b),
      );

      const events = [...scanned.byStep.values()].reduce(
        (n, b) => n + b.length,
        0,
      );
      console.log(
        `[LP-1 (c) compile @128 bars max-dense] ${pattern.notes.length.toLocaleString()} notes → ${events.toLocaleString()} events | stepOfTime scan ${scanMs.toFixed(1)} ms vs bounded ${boundedMs.toFixed(1)} ms per compile (every content edit recompiles the lane)`,
      );
      // Deterministic sanity: the dense compile is not accidentally free.
      expect(events).toBeGreaterThan(30_000);

      // Musical density (a note every 4th step — steady 16th-chain feel at
      // 128 bars): the realistic editing-latency point.
      const musical = maxDensePitched("lead-musical", 128, Array.from({ length: 15 }, (_, i) => i), 4);
      const m0 = performance.now();
      compileLaneSchedule({
        chain: [musical],
        preset,
        groove,
        scale,
        gate: { unit: "steps", value: 1 },
      });
      const musicalScanMs = performance.now() - m0;
      const m1 = performance.now();
      compileLaneScheduleBounded({
        chain: [musical],
        preset,
        groove,
        scale,
      });
      const musicalBoundedMs = performance.now() - m1;
      console.log(
        `[LP-1 (c) compile @128 bars musical density] ${musical.notes.length.toLocaleString()} notes | scan ${musicalScanMs.toFixed(1)} ms vs bounded ${musicalBoundedMs.toFixed(1)} ms per edit-recompile`,
      );
      expect(musical.notes.length).toBe(7_680);
    });
});

// ---------------------------------------------------------------------------
// Export pure-half: event expansion at the 128-bar LCM loop.
// ---------------------------------------------------------------------------

describe("LP-1 (d, pure half): export expansion cost at the LCM loop", () => {
  it("RECORDED: expandLaneEventsForLoop at 2048-step loop, dense schedule",
    () => {
      const doc = createDefaultProject();
      const groove: GrooveOptions = { bpm: 120, swing: 0 };
      const pattern = maxDensePitched("lead-dense", 128, Array.from({ length: 15 }, (_, i) => i));
      const schedule = compileLaneScheduleBounded({
        chain: [pattern],
        preset: getPreset("preset-lead-1")!,
        groove,
        scale: effectiveScale(doc, "lead"),
      });
      const t0 = performance.now();
      const events = expandLaneEventsForLoop(schedule, 2048, groove);
      const ms = performance.now() - t0;
      console.log(
        `[LP-1 (d) export expansion @128-bar LCM] one dense lane: ${events.length.toLocaleString()} events expanded in ${ms.toFixed(1)} ms`,
      );
      expect(events.length).toBeGreaterThan(30_000);
    });
});

// ---------------------------------------------------------------------------
// (e) Codec round-trip at the dense-128-bar scale (SV-1 re-confirmation).
// ---------------------------------------------------------------------------

/** SV-1's max-dense shape: one 128-bar pattern per lane, max density, 3 FX. */
function maxDenseDoc(): ProjectDocument {
  const base = createDefaultProject();
  const fx = [
    { type: "filter" as const, bypassed: false, params: { cutoffHz: 2000, q: 0.9 } },
    { type: "delay" as const, bypassed: false, params: { timeSteps: 3, feedback: 0.35, mix: 0.3 } },
    { type: "reverb" as const, bypassed: false, params: { size: 0.5, mix: 0.3 } },
  ];
  const denseDrums: DrumPattern = {
    kind: "drums",
    id: "drums-1",
    name: "A",
    bars: 128,
    steps: Object.fromEntries(
      Object.entries((base.patterns.drums[0] as DrumPattern).steps).map(
        ([piece]) => [piece, new Array(2048).fill(true)],
      ),
    ) as DrumPattern["steps"],
  };
  return {
    ...base,
    lanes: base.lanes.map((l) => ({ ...l, fxChain: fx })),
    patterns: {
      drums: [denseDrums],
      bass: [maxDensePitched("bass-1", 128, [0, 1, 2, 3, 4, 5, 6])],
      chords: [maxDensePitched("chords-1", 128, [0, 1, 2, 3, 4, 5, 6])],
      lead: [maxDensePitched("lead-1", 128, Array.from({ length: 15 }, (_, i) => i))],
    },
    songChain: {
      drums: ["drums-1"],
      bass: ["bass-1"],
      chords: ["chords-1"],
      lead: ["lead-1"],
    },
  };
}

describe("LP-1 (e): codec round-trip at the dense-128-bar scale", () => {
  it("RECORDED: encode/decode wall-time + size of the max-dense v3 doc",
    () => {
      const doc = maxDenseDoc();
      const t0 = performance.now();
      const text = encode(doc);
      const encodeMs = performance.now() - t0;
      const t1 = performance.now();
      const back = decode(text);
      const decodeMs = performance.now() - t1;
      expect(back.name).toBe(doc.name);
      expect(back.patterns.lead[0]!.notes.length).toBe(
        doc.patterns.lead[0]!.notes.length,
      );
      console.log(
        `[LP-1 (e) codec] max-dense 128-bar doc: ${text.length.toLocaleString()} canonical chars (SV-1 measured 2,693,153) | encode ${encodeMs.toFixed(0)} ms, decode ${decodeMs.toFixed(0)} ms round-trip`,
      );
      // Under the SV-1 cap (4 MB) — the CA-2 guard family's margin.
      expect(text.length).toBeLessThan(4_194_304);
      expect(text.length).toBeGreaterThan(2_000_000);
    });
});
