/**
 * WELCOME SONG — the first-run demo project (PX-1, Professor X; PX-4 re-composed
 * as the POLY-LOOP demo).
 *
 * The demo is the product's handshake: it must sound genuinely musical AND
 * teach by example. It is a REAL project document — fully editable, autosaves,
 * exports — created on first boot when nothing exists in IDB (boot.ts). NEW
 * still creates the empty default (newProject.ts).
 *
 * POLY-LOOP ARRANGEMENT (PX-4, i3-4 — the lanes loop at UNEQUAL cycle lengths,
 * so the combinations evolve instead of repeating every four bars):
 * - CHORDS run the 8-BAR CYCLE — four 2-bar patterns, one chord each: i–VI–
 *   III–VII (degrees 0, 5, 2, 6) held two bars apiece. The long lane.
 * - LEAD runs a 4-BAR CYCLE — the same four-bar melody phrase lands on a
 *   DIFFERENT chord each time the 8-bar chord cycle comes round (i, i, VI,
 *   VI … then III, III, VII, VII) — the poly-loop effect, audible.
 * - DRUMS stay on the proven 4-BAR CYCLE — the PX-1 groove bars A–D.
 * - BASS stays on the unchanged 4-BAR CYCLE — the root-locked PX-1 line,
 *   one bar per chord root, cycling twice per chord cycle so the same bass
 *   note lands as root, then as color, against the two-bar chords.
 * The song CYCLE — the LCM the transport, one-shot and exports run on — is
 * 8 bars (the longest lane). The first PLAY still opens on the proven PX-1
 * groove: core drums + the opening melody + root-locked bass.
 *
 * DELIBERATE LAWS (PX-4 production choices, recorded — each MEASURED
 * against an established gate; the plan's "e.g. drums 32/64B" shape was
 * composed and measured RED, see production-log PX-4):
 * - Four chain slots per lane: the phone rail's condensed row keeps the `+`
 *   append reachable beside the tiles (MB-3's hit-box audit measured 8
 *   tiles pushing the append past the strip's scroll clip).
 * - DRUMS patterns stay 1 bar: the euclid fill rail's 220 px pin and the
 *   drums quadrant's no-internal-scroll laws are budgeted for the 16-step
 *   readout/row, TH-1's 50 ms pool-wide-toggle guard scales with lane
 *   steps (8-bar patterns measured a 52 ms worst block), and the phone
 *   default-view law wants the first-boot drums row scroll-free.
 * - The LONG lane is CHORDS at 2-bar patterns: a view-only 2-bar pitched
 *   row stays inside its quadrant at the law viewports, and 2-bar patterns
 *   keep every demo pattern inside the v1/v2 vocabulary {1,2,4} — the
 *   migration fixtures stay era-legal saves. Longer view-only patterns
 *   h-scroll at 1280×800 (DA-2's axe scrollable-region law flags a
 *   scrollable view-only region with no tab stops).
 * - The poly-loop lives in the CHAIN TOTALS — which is what lane cycles
 *   are — and the 1→128 LENGTH ladder stays demonstrated by the controls.
 *
 * Composition (verified structurally in tests/demoSong.test.ts — nobody can
 * hear a unit test; human listen is explicitly the pending-human carry):
 * - Key C minor (project scale), 112 BPM, swing 20%.
 * - Chords: diatonic triads via the chords lane's stack semantics, long gate
 *   + sustain markers, re-attack on each bar downbeat, reverb wash.
 * - Bass: locks to each bar's chord ROOT at octave 2 (THICK PULSE), a
 *   syncopated 6-hit rhythm, with a stepwise APPROACH note into the next
 *   bar's root (classic voice-leading: G→A♭, D→E♭, A♭→B♭, B♭→C).
 * - Lead: CUT P50 at octave 4, melody in scale degrees around C5 (degree 7)
 *   with syncopation and rests — opens on a rest, off-beat entries, stepwise
 *   + triad motion, dotted-8th delay + light reverb. Degrees stay within
 *   7…12 + 14 (the RC-1 default register window law: the melody reads in the
 *   ROWS 6–12 window on first boot).
 * - Drums: 8-BIT ROOM kit; kick/snare backbone with syncopated kicks, 8th
 *   hats, open-hat pickups, claps in the lift/drop, and snare/tom 16th fills
 *   into the cycle wrap.
 * - Sections: chain cue labels on the chords lane (VERSE / VERSE / LIFT /
 *   DROP, positional per DES-6 — one label per 2-bar chord slot).
 *
 * Deterministic by construction: pure data, no ids/dates/randomness — the
 * canonical codec bytes are pinned as a golden (codec/demo-project-canonical-v3).
 */

import {
  DRUM_PIECES,
  SCHEMA_VERSION,
  type DrumPattern,
  type DrumPiece,
  type PatternBars,
  type PitchedCell,
  type PitchedPattern,
  type PitchedRow,
  type ProjectDocument,
  notesFromRowCells,
  type LaneGate,
  resolveGateSteps,
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
function pitchedRow(degree: number, spec: string): PitchedRow {
  return {
    degree,
    steps: [...spec].map((c) =>
      c === "1" ? 1 : c === "2" ? 2 : 0,
    ) as PitchedCell[],
  };
}

/** All diatonic rows 0..maxDegree, silent except where `specs` has a string. */
function rowsByDegree(
  specs: Readonly<Record<number, string>>,
  maxDegree: number,
): PitchedRow[] {
  const rows: PitchedRow[] = [];
  for (let degree = 0; degree <= maxDegree; degree++) {
    rows.push(pitchedRow(degree, specs[degree] ?? EMPTY));
  }
  return rows;
}

function drumPattern(
  id: string,
  name: string,
  bars: PatternBars,
  rows: Partial<Record<DrumPiece, string>>,
): DrumPattern {
  const steps = {} as Record<DrumPiece, boolean[]>;
  for (const piece of DRUM_PIECES)
    steps[piece] = drumRow(rows[piece] ?? ".".repeat(bars * 16));
  return { kind: "drums", id, name, bars, steps };
}

function pitchedPattern(
  id: string,
  name: string,
  bars: PatternBars,
  gate: LaneGate,
  rows: readonly PitchedRow[],
): PitchedPattern {
  // v2 (SC-1): patterns are authored in the readable v1 cell strings, then
  // converted through the SAME law the migration uses — the demo's v2 bytes
  // are exactly what migrating the v1 demo produces (asserted in tests).
  // All demo gates are steps-unit, so the conversion is BPM-independent.
  return {
    kind: "pitched",
    id,
    name,
    bars,
    rowDegrees: rows.map((row) => row.degree),
    notes: notesFromRowCells(rows, resolveGateSteps(gate, 112), bars * 16),
  };
}

// ---------------------------------------------------------------------------
// Drums — groove bars A/B and a fill bar. Swing 20% carries the off-beat hats.
// ---------------------------------------------------------------------------

const DRUMS_A = drumPattern("drums-1", "A", 1, {
  kick: "x.......x.x.....",
  snare: "....x.......x...",
  hat: "x.x.x.x.x.x.x...",
  openhat: "..............x.",
});
const DRUMS_B = drumPattern("drums-2", "B", 1, {
  kick: "x.....x.x.......",
  snare: "....x.......x...",
  hat: "x.x.x.x.x.x.x.x.",
});
const DRUMS_C = drumPattern("drums-3", "C", 1, {
  kick: "x.......x.x.....",
  snare: "....x.......x..x",
  hat: "x.x.x.x.x.x.x...",
  openhat: "..............x.",
});
// DROP fill: snare/tom 16th pickup into the loop restart.
const DRUMS_D = drumPattern("drums-4", "D", 1, {
  kick: "x.......x.......",
  snare: "....x......xx.x.",
  hat: "x.x.x...........",
  tom: ".............x.x",
});

// ---------------------------------------------------------------------------
// Bass — 4-BAR CYCLE, unchanged from PX-1: root-locked (degree per bar = the
// chord row's root degree), one stepwise approach note at step 14 into the
// next bar's root. Against the 2-bar chords the same line hears as root on
// the chord's first bar and as color (6th/maj7) on its second.
// ---------------------------------------------------------------------------

const BASS_ROOT = "1..1..1.1..1...."; // syncopated 6-hit root rhythm (steps 0,3,6,8,11)
const APPROACH = "..............1.."; // step 14: a single stepwise lead-in note

const BASS_A = pitchedPattern(
  "bass-1",
  "A",
  1,
  { unit: "steps", value: 1 },
  rowsByDegree({ 0: BASS_ROOT, 4: APPROACH }, 6),
); // C root; G→A♭
const BASS_B = pitchedPattern(
  "bass-2",
  "B",
  1,
  { unit: "steps", value: 1 },
  rowsByDegree({ 5: BASS_ROOT, 6: APPROACH }, 6),
); // A♭ root; B♭→E♭
const BASS_C = pitchedPattern(
  "bass-3",
  "C",
  1,
  { unit: "steps", value: 1 },
  rowsByDegree({ 2: BASS_ROOT, 5: APPROACH }, 6),
); // E♭ root; A♭→B♭
const BASS_D = pitchedPattern(
  "bass-4",
  "D",
  1,
  { unit: "steps", value: 1 },
  rowsByDegree({ 6: BASS_ROOT, 7: APPROACH }, 7),
); // B♭ root; C→C

// ---------------------------------------------------------------------------
// Chords — 8-BAR CYCLE: one diatonic triad per 2-bar pattern (the lane stacks
// [deg, deg+2, deg+4]), long gate (6 steps) + sustain markers, re-attacking
// on each bar's downbeat (the PX-1 pad rhythm, held two bars per chord).
// ---------------------------------------------------------------------------

const CHORD_PAD = "1222222222......"; // note-on + 9 sustains ≈ 15/16 of a bar
const CHORD_PAD_2BAR = CHORD_PAD + CHORD_PAD; // one attack per bar downbeat

const CHORDS_A = pitchedPattern(
  "chords-1",
  "A",
  2,
  { unit: "steps", value: 6 },
  rowsByDegree({ 0: CHORD_PAD_2BAR }, 6),
); // i   C minor
const CHORDS_B = pitchedPattern(
  "chords-2",
  "B",
  2,
  { unit: "steps", value: 6 },
  rowsByDegree({ 5: CHORD_PAD_2BAR }, 6),
); // VI  A♭ major
const CHORDS_C = pitchedPattern(
  "chords-3",
  "C",
  2,
  { unit: "steps", value: 6 },
  rowsByDegree({ 2: CHORD_PAD_2BAR }, 6),
); // III E♭ major
const CHORDS_D = pitchedPattern(
  "chords-4",
  "D",
  2,
  { unit: "steps", value: 6 },
  rowsByDegree({ 6: CHORD_PAD_2BAR }, 6),
); // VII B♭ major

// ---------------------------------------------------------------------------
// Lead — 4-BAR CYCLE: four 1-bar phrases over the chords' 8-BAR cycle, so
// the SAME melody lands on a different chord each time the chords come
// round (bars 1-4 over i, i, VI, VI; the repeat hears it over III, III,
// VII, VII — the poly-loop effect). The opening bar is the PX-1 melody
// kept note-for-note; degrees stay within 7…12 + 14 (never 13 — the RC-1
// default-window law: the melody reads in the ROWS 6–12 window on first
// boot; the manifest is rows 0..14, degrees 0..6 silent).
// ---------------------------------------------------------------------------

const LEAD_A = pitchedPattern(
  "lead-1",
  "A",
  1,
  { unit: "steps", value: 2 },
  rowsByDegree(
    {
      7: "....1.........2..", // C5 — opens on a REST, syncopated entry
      8: ".........1......", // D5 answer (off the beat)
      9: "..............1..", // E♭5 pickup
    },
    14,
  ),
); // bar 1 over i — the proven PX-1 opening.
const LEAD_B = pitchedPattern(
  "lead-2",
  "B",
  1,
  { unit: "steps", value: 2 },
  rowsByDegree(
    {
      8: "......1..........", // D5
      9: "...1.....1.......", // E♭5 — the answer figure
      11: ".............1...", // G5 pickup into the VI bars
    },
    14,
  ),
); // bar 2 over i — the answer, stepwise.
const LEAD_C = pitchedPattern(
  "lead-3",
  "C",
  1,
  { unit: "steps", value: 2 },
  rowsByDegree(
    {
      7: "............1.2..", // C5 tail with sustain (the VI chord's 3rd)
      8: "...........1....", // D5 (the maj7 color, off the beat)
      9: "1..2.....1.......", // E♭5 over the VI chord (the 5th)
    },
    14,
  ),
); // bar 3 over VI — the proven PX-1 VI bar.
const LEAD_D = pitchedPattern(
  "lead-4",
  "D",
  1,
  { unit: "steps", value: 2 },
  rowsByDegree(
    {
      10: "............1..2.", // F5 with sustain into the phrase wrap (the VI's 6th)
      11: "..........1......", // G5 (the VI's 7th)
      12: "......1..........", // A♭5 — the VI root
      14: "1..1........1....", // B♭5 — the phrase peak (the VI's 9th)
    },
    14,
  ),
); // bar 4 over VI — the proven PX-1 peak bar, tail into the wrap.

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function createDemoProject(): ProjectDocument {
  return {
    name: "WELCOME SONG",
    version: SCHEMA_VERSION,
    // v3 (SV-1): no loopBars — the cycle basis is the LCM of lane chain
    // totals (LL-2): chords 4×2B = 8, drums/lead/bass 4×1B = 4 → the song
    // CYCLE is 8 bars — the longest lane. Each lane's own sweep wraps at
    // its OWN cycle (the poly-loop demo), the booth readout and one-shot
    // run on the 8-bar LCM, and exports span exactly one full cycle (XP-1).
    transport: { bpm: 112, swing: 0.2, metronome: false },
    scale: { root: 0, mode: "minor" },
    laneOverrides: null,
    lanes: [
      {
        id: "drums",
        kitId: "kit-soft",
        gate: { unit: "steps", value: 1 },
        fxChain: [],
      },
      {
        id: "bass",
        presetId: "preset-bass-5",
        gate: { unit: "steps", value: 1 },
        fxChain: [
          // Round the triangle off further + keep the sub tight.
          {
            type: "filter",
            bypassed: false,
            params: { kind: "lowpass", cutoffHz: 500, q: 0.7 },
          },
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
          {
            type: "filter",
            bypassed: false,
            params: { kind: "lowpass", cutoffHz: 900, q: 0.7 },
          },
          { type: "reverb", bypassed: false, params: { size: 0.55, mix: 0.4 } },
        ],
      },
      {
        id: "lead",
        presetId: "preset-lead-3",
        gate: { unit: "steps", value: 2 },
        fxChain: [
          {
            type: "delay",
            bypassed: false,
            params: { timeSteps: 3, feedback: 0.35, mix: 0.28 },
          },
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
    // carries text — the harmonic lane defines the sections, one label per
    // 2-bar chord slot across the 8-bar chord cycle).
    chainCues: {
      drums: [null, null, null, null],
      bass: [null, null, null, null],
      chords: ["VERSE", "VERSE", "LIFT", "DROP"],
      lead: [null, null, null, null],
    },
  };
}
