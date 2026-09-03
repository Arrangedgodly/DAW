/**
 * SC-1 test support: v1-shaped project texts.
 *
 * `v1ProjectText` reverse-projects a live v2 document onto the v1 cell-row
 * shape through the SAME compatibility view the engine consumes
 * (`pitchedPatternView`), producing exactly the bytes a v0 app would have
 * saved for the same content — so migration tests can prove
 * `migrate(v1 view of X) === X` (view ∘ migration = identity).
 *
 * `sustainHeavyV1ProjectText` is a hand-authored literal (NOT derived from
 * v2) that independently pins the migration law: sustained runs, lone
 * note-ons, orphan sustain markers, end-of-pattern notes, and a seconds-unit
 * gate.
 */

import { canonicalize } from "../src/document/codec";
import {
  type LaneGate,
  type LaneId,
  type PitchedPattern,
  type PitchedRow,
  type ProjectDocument,
  pitchedPatternView,
  resolveGateSteps,
} from "../src/document/schema";
import { createDefaultProject } from "../src/document/schema";
import { createDemoProject } from "../src/document/demoSong";

interface V1PitchedPattern {
  kind: "pitched";
  id: string;
  name: string;
  bars: 1 | 2 | 4;
  rows: PitchedRow[];
}

/** The v1 document text for the same musical content as `doc`. */
export function v1ProjectText(doc: ProjectDocument): string {
  const gateSteps = (lane: LaneId): number => {
    const conf = doc.lanes.find((l) => l.id === lane)!;
    return resolveGateSteps(conf.gate as LaneGate, doc.transport.bpm);
  };
  const patterns: Record<string, unknown> = {};
  for (const lane of ["drums", "bass", "chords", "lead"] as const) {
    patterns[lane] = doc.patterns[lane].map((p) => {
      if (p.kind !== "pitched") return p;
      const pitched = p as PitchedPattern;
      const v1: V1PitchedPattern = {
        kind: "pitched",
        id: pitched.id,
        name: pitched.name,
        bars: pitched.bars,
        rows: pitchedPatternView(pitched, gateSteps(lane)).rows,
      };
      return v1;
    });
  }
  const { patterns: _drop, ...rest } = doc;
  void _drop;
  return canonicalize({ ...rest, version: 1, patterns });
}

export function v1DefaultProjectText(): string {
  return v1ProjectText(createDefaultProject());
}

export function v1DemoProjectText(): string {
  return v1ProjectText(createDemoProject());
}

/**
 * Hand-authored sustain-heavy v1 neighbor (C minor, 112 BPM, mixed gates).
 * bass gate = 3 steps (sustained + lone hits + orphan markers + a run that
 * reaches the pattern end), chords gate = 0.25 SECONDS (the quantization
 * corner: 0.25s / secondsPerStep(112) = 1.867 steps → 1.75 on the quarter
 * grid), lead gate = 2 steps (a run touching the pattern end + a plain hit).
 */
export function sustainHeavyV1ProjectText(): string {
  const cells = (spec: string): number[] =>
    [...spec].map((c) => (c === "1" ? 1 : c === "2" ? 2 : 0));
  const rows = (specs: Record<number, string>, max: number): PitchedRow[] =>
    Array.from({ length: max + 1 }, (_, degree) => ({
      degree,
      steps: cells(specs[degree] ?? "................"),
    }));
  return canonicalize({
    name: "SUSTAIN LAB",
    version: 1,
    transport: { bpm: 112, swing: 0.2, loopBars: 1, metronome: false },
    scale: { root: 0, mode: "minor" },
    laneOverrides: null,
    lanes: [
      {
        id: "drums",
        kitId: "kit-default",
        gate: { unit: "steps", value: 1 },
        fxChain: [],
      },
      {
        id: "bass",
        presetId: "preset-bass-1",
        gate: { unit: "steps", value: 3 },
        fxChain: [],
      },
      {
        id: "chords",
        presetId: "preset-chords-1",
        gate: { unit: "seconds", value: 0.25 },
        fxChain: [],
      },
      {
        id: "lead",
        presetId: "preset-lead-1",
        gate: { unit: "steps", value: 2 },
        fxChain: [],
      },
    ],
    patterns: {
      drums: [
        {
          kind: "drums",
          id: "drums-1",
          name: "A",
          bars: 1,
          steps: {
            kick: cells("x.......x.......").map((c) => c === 1),
            snare: Array(16).fill(false),
            hat: Array(16).fill(false),
            openhat: Array(16).fill(false),
            clap: Array(16).fill(false),
            tom: Array(16).fill(false),
          },
        },
      ],
      bass: [
        {
          kind: "pitched",
          id: "bass-1",
          name: "A",
          bars: 1,
          rows: rows(
            {
              // run of 1+2+2 (span 3 → note length gate 3 + 2 sustains = 5),
              // lone hits at 8 and 12, ORPHAN marker at 14 (audio-dead → dropped)
              0: "122.....1...1.2.",
              // orphan markers on degree 4 (audio-dead; dropped by migration)
              4: "..2..2...........",
            },
            6,
          ),
        },
      ],
      chords: [
        {
          kind: "pitched",
          id: "chords-1",
          name: "A",
          bars: 1,
          rows: rows(
            {
              // seconds gate 0.25 → 1.75 steps: lone note-on = length 1.75;
              // sustained run = 1.75 + 1 sustain = 2.75
              0: "1.12............",
            },
            6,
          ),
        },
      ],
      lead: [
        {
          kind: "pitched",
          id: "lead-1",
          name: "A",
          bars: 1,
          rows: rows(
            {
              // head at 14 sustains to the pattern end (length 2 + 1 = 3);
              // head ON the last step (length 2 — plays past the loop, as v1 did)
              7: "..............12",
              9: "...............1",
            },
            14,
          ),
        },
      ],
    },
    songChain: {
      drums: ["drums-1"],
      bass: ["bass-1"],
      chords: ["chords-1"],
      lead: ["lead-1"],
    },
  });
}
