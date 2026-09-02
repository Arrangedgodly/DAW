/**
 * WELCOME SONG — the first-run demo project (PX-1, Professor X).
 *
 * The demo is the product's handshake: it must sound genuinely musical AND
 * teach by example (every lane populated, patterns chained into a two-section
 * loop, tasteful FX, swing). It is a REAL project document — fully editable,
 * autosaves, exports — created on first boot when nothing exists in IDB
 * (boot.ts). NEW still creates the empty default (newProject.ts).
 *
 * Composition (verified structurally in tests/demoSong.test.ts — nobody can
 * hear a unit test; human listen is explicitly R12's session):
 * - Key C minor (project scale), 112 BPM, swing 20%.
 * - Chords: i–VI–III–VII (degrees 0, 5, 2, 6) — one bar each, diatonic
 *   triads via the chords lane's stack semantics, long gate + sustain
 *   markers, reverb wash.
 * - Bass: locks to each bar's chord ROOT at octave 2 (THICK PULSE), a
 *   syncopated 6-hit rhythm, with a stepwise APPROACH note into the next
 *   bar's root (classic voice-leading: G→A♭, D→E♭, A♭→B♭, B♭→C).
 * - Lead: CUT P50 at octave 4, melody in scale degrees around C5 (degree 7)
 *   with syncopation and rests — starts on a rest, off-beat entries,
 *   stepwise + triad motion, dotted-8th delay + light reverb.
 * - Drums: 8-BIT ROOM kit; kick/snare backbone with syncopated kicks, 8th
 *   hats, open-hat pickup, and a snare/tom fill in the last bar ("DROP").
 * - Sections: chain slots VERSE / VERSE / LIFT / DROP (cue labels on the
 *   chords lane, positional per DES-6).
 *
 * Deterministic by construction: pure data, no ids/dates/randomness — the
 * canonical codec bytes are pinned as a golden (codec/demo-project-canonical-v1).
 */

import {
  DRUM_PIECES,
  SCHEMA_VERSION,
  type DrumPattern,
  type DrumPiece,
  type PitchedCell,
  type PitchedPattern,
  type ProjectDocument,
} from "./schema";

// ---------------------------------------------------------------------------
// Tiny authoring helpers (kept local so the document module stays dependency-
// free; strings are easier to read/author than 0/1/2 arrays).
// ---------------------------------------------------------------------------

const EMPTY = "................";

/** "x.." → [true,false,false]; one char per 16th step. */
function drumRow(spec: string): boolean[] {
  return [...spec].map((c) => c === "x");
}

/**
 * "1..." note-on, "2..." sustain marker, "." rest. One char per 16th step.
 * Returned rows carry the given scale degree.
 */
function pitchedRow(degree: number, spec: string): { degree: number; steps: PitchedCell[] } {
  return {
    degree,
    steps: [...spec].map((c) => (c === "1" ? 1 : c === "2" ? 2 : 0)) as PitchedCell[],
  };
}

/** All diatonic rows 0..maxDegree, silent except where `specs` has a string. */
function rowsByDegree(
  specs: Readonly<Record<number, string>>,
  maxDegree: number,
): { degree: number; steps: PitchedCell[] }[] {
  const rows: { degree: number; steps: PitchedCell[] }[] = [];
  for (let degree = 0; degree <= maxDegree; degree++) {
    rows.push(pitchedRow(degree, specs[degree] ?? EMPTY));
  }
  return rows;
}

function drumPattern(id: string, name: string, rows: Partial<Record<DrumPiece, string>>): DrumPattern {
  const steps = {} as Record<DrumPiece, boolean[]>;
  for (const piece of DRUM_PIECES) steps[piece] = drumRow(rows[piece] ?? "................");
  return { kind: "drums", id, name, bars: 1, steps };
}

function pitchedPattern(
  id: string,
  name: string,
  rows: readonly { degree: number; steps: PitchedCell[] }[],
): PitchedPattern {
  return { kind: "pitched", id, name, bars: 1, rows };
}

// ---------------------------------------------------------------------------
// Drums — groove bars A/B and a fill bar. Swing 20% carries the off-beat hats.
// ---------------------------------------------------------------------------

const DRUMS_A = drumPattern("drums-1", "A", {
  kick: "x.......x.x.....",
  snare: "....x.......x...",
  hat: "x.x.x.x.x.x.x...",
  openhat: "..............x.",
});
const DRUMS_B = drumPattern("drums-2", "B", {
  kick: "x.....x.x.......",
  snare: "....x.......x...",
  hat: "x.x.x.x.x.x.x.x.",
});
const DRUMS_C = drumPattern("drums-3", "C", {
  kick: "x.......x.x.....",
  snare: "....x.......x..x",
  hat: "x.x.x.x.x.x.x...",
  openhat: "..............x.",
});
// DROP fill: snare/tom 16th pickup into the loop restart.
const DRUMS_D = drumPattern("drums-4", "D", {
  kick: "x.......x.......",
  snare: "....x......xx.x.",
  hat: "x.x.x...........",
  tom: ".............x.x",
});

// ---------------------------------------------------------------------------
// Bass — root-locked (degree per bar = the chord row's root degree), one
// stepwise approach note at step 14 into the next bar's root.
// ---------------------------------------------------------------------------

const BASS_ROOT = "1..1..1.1..1...."; // syncopated 6-hit root rhythm (steps 0,3,6,8,11)
const APPROACH = "..............1.."; // step 14: a single stepwise lead-in note

const BASS_A = pitchedPattern("bass-1", "A", rowsByDegree({ 0: BASS_ROOT, 4: APPROACH }, 6)); // C root; G→A♭
const BASS_B = pitchedPattern("bass-2", "B", rowsByDegree({ 5: BASS_ROOT, 6: APPROACH }, 6)); // A♭ root; B♭→E♭
const BASS_C = pitchedPattern("bass-3", "C", rowsByDegree({ 2: BASS_ROOT, 5: APPROACH }, 6)); // E♭ root; A♭→B♭
const BASS_D = pitchedPattern("bass-4", "D", rowsByDegree({ 6: BASS_ROOT, 7: APPROACH }, 7)); // B♭ root; C→C

// ---------------------------------------------------------------------------
// Chords — one diatonic triad per bar (the lane stacks [deg, deg+2, deg+4]),
// long gate (6 steps) + sustain markers to bar end.
// ---------------------------------------------------------------------------

const CHORD_PAD = "1222222222......"; // note-on + 9 sustains ≈ 15/16 of a bar

const CHORDS_A = pitchedPattern("chords-1", "A", rowsByDegree({ 0: CHORD_PAD }, 6)); // i   C minor
const CHORDS_B = pitchedPattern("chords-2", "B", rowsByDegree({ 5: CHORD_PAD }, 6)); // VI  A♭ major
const CHORDS_C = pitchedPattern("chords-3", "C", rowsByDegree({ 2: CHORD_PAD }, 6)); // III E♭ major
const CHORDS_D = pitchedPattern("chords-4", "D", rowsByDegree({ 6: CHORD_PAD }, 6)); // VII B♭ major

// ---------------------------------------------------------------------------
// Lead — melody in C minor around C5 (degree 7 at octave base 4). Rests and
// off-beat entries on purpose; stepwise + triad motion over each chord.
// Rows are degrees 7..14 (the C5 register); degrees 0..6 stay silent.
// ---------------------------------------------------------------------------

const LEAD_A = pitchedPattern(
  "lead-1",
  "A",
  rowsByDegree(
    {
      7: "....1.........2..", // C5 — opens on a REST, syncopated entry
      8: "........1........", // D5 answer
      9: "..............1..", // E♭5 pickup
    },
    14,
  ),
);
const LEAD_B = pitchedPattern(
  "lead-2",
  "B",
  rowsByDegree(
    {
      12: "...1..1....1.....", // A♭5 over the VI chord (off-beat)
      11: "......1..........",
      10: "..........1......", // F5
    },
    14,
  ),
);
const LEAD_C = pitchedPattern(
  "lead-3",
  "C",
  rowsByDegree(
    {
      9: "1..2.....1.......", // E♭5 over the III chord
      8: "..........1......", // D5
      7: "............1.2..", // C5 tail with sustain
    },
    14,
  ),
);
const LEAD_D = pitchedPattern(
  "lead-4",
  "D",
  rowsByDegree(
    {
      14: "1..1........1....", // B♭5 — the DROP peak
      12: "......1..........",
      11: "..........1......",
      10: "............1..2.", // F5 with sustain into the loop restart
    },
    14,
  ),
);

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function createDemoProject(): ProjectDocument {
  return {
    name: "WELCOME SONG",
    version: SCHEMA_VERSION,
    // loopBars 1 matches the 1-bar patterns (IM-6: must agree with the grid).
    transport: { bpm: 112, swing: 0.2, loopBars: 1, metronome: false },
    scale: { root: 0, mode: "minor" },
    laneOverrides: null,
    lanes: [
      { id: "drums", kitId: "kit-soft", gate: { unit: "steps", value: 1 }, fxChain: [] },
      {
        id: "bass",
        presetId: "preset-bass-5",
        gate: { unit: "steps", value: 1 },
        fxChain: [
          // Round the triangle off further + keep the sub tight.
          { type: "filter", bypassed: false, params: { kind: "lowpass", cutoffHz: 500, q: 0.7 } },
          { type: "drive", bypassed: false, params: { amount: 0.2 } },
        ],
      },
      {
        id: "chords",
        presetId: "preset-chords-3",
        gate: { unit: "steps", value: 6 },
        fxChain: [
          // Soft-focus the pad (lowpass) + a wet reverb crossfade that also
          // trims the dry level — the demo's gain staging lives in the doc.
          { type: "filter", bypassed: false, params: { kind: "lowpass", cutoffHz: 900, q: 0.7 } },
          { type: "reverb", bypassed: false, params: { size: 0.55, mix: 0.4 } },
        ],
      },
      {
        id: "lead",
        presetId: "preset-lead-3",
        gate: { unit: "steps", value: 2 },
        fxChain: [
          { type: "delay", bypassed: false, params: { timeSteps: 3, feedback: 0.35, mix: 0.28 } },
          { type: "reverb", bypassed: false, params: { size: 0.35, mix: 0.3 } },
        ],
      },
    ],
    patterns: {
      drums: [DRUMS_A, DRUMS_B, DRUMS_C, DRUMS_D],
      bass: [BASS_A, BASS_B, BASS_C, BASS_D],
      chords: [CHORDS_A, CHORDS_B, CHORDS_C, CHORDS_D],
      lead: [LEAD_A, LEAD_B, LEAD_C, LEAD_D],
    },
    songChain: {
      drums: ["drums-1", "drums-2", "drums-3", "drums-4"],
      bass: ["bass-1", "bass-2", "bass-3", "bass-4"],
      chords: ["chords-1", "chords-2", "chords-3", "chords-4"],
      lead: ["lead-1", "lead-2", "lead-3", "lead-4"],
    },
    // Section labels (DES-6 positional cue slots; only the chords lane
    // carries text — the harmonic lane defines the sections).
    chainCues: {
      drums: [null, null, null, null],
      bass: [null, null, null, null],
      chords: ["VERSE", "VERSE", "LIFT", "DROP"],
      lead: [null, null, null, null],
    },
  };
}
