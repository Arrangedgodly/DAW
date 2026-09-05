/**
 * XP-1 shared LCM-cycle export fixtures (i3-5).
 *
 * Two unequal-chain reference documents shared by the unit suite, the hard
 * MIDI golden (tests/golden/midi-lcm-export.golden.test.ts), the browser
 * export gates (exportWav/exportMidi) and the fingerprint canary:
 *
 * - `lcmCycleProject()` — the SMALL unequal-chain reference (4-bar cycle):
 *   drums chain [2B, 2B] = 64 steps, bass [2B] = 32, chords [1B] = 16,
 *   lead [1B] = 16 → export cycle = LCM = 64 steps = 4 bars. Bass repeats
 *   ×2, chords/lead ×4 within the cycle; drums walks once. Cue markers:
 *   VERSE (drums slot 0), DROP (drums slot 1), GROOVE (bass slot 0 —
 *   repeats with the chain at ticks 0 and 3840).
 *
 * - `wideUnequalChainProject()` — the plan's own probe (i3-5/I3-d): drums
 *   64 bars + bass 4 bars + chords 8 bars (+ the default 1-bar lead) → the
 *   export cycle is the LONGEST lane = 64 bars = 1024 steps = 5,644,800
 *   samples @44100/120 BPM. The user-facing example: one export contains
 *   every lane's full poly-loop phase relationship exactly once.
 */

import {
  createDefaultProject,
  type DrumPattern,
  type ProjectDocument,
} from "../src/document/schema";

/** Grow a drums pattern to `bars`, padding every piece row with silence. */
function growDrums(p: DrumPattern, bars: number): DrumPattern {
  const len = bars * 16;
  const steps = {} as Record<keyof DrumPattern["steps"], boolean[]>;
  for (const piece of Object.keys(p.steps) as (keyof DrumPattern["steps"])[]) {
    const src = p.steps[piece] ?? [];
    steps[piece] = [...src, ...new Array<boolean>(len - src.length).fill(false)];
  }
  return { ...p, bars, steps };
}

/** The SMALL unequal-chain reference: 4-bar export cycle (see module doc). */
export function lcmCycleProject(): ProjectDocument {
  const doc = createDefaultProject();

  // Drums: pattern A (2 bars, four-on-the-floor kick) + pattern B (2 bars,
  // backbeat snare + even hats) chained [A, B] → 64 steps.
  const a = growDrums(doc.patterns.drums[0], 2);
  a.steps.kick = Array.from({ length: 32 }, (_, i) => i % 4 === 0);
  const b: DrumPattern = {
    kind: "drums",
    id: "drums-2",
    name: "B",
    bars: 2,
    steps: {
      kick: new Array<boolean>(32).fill(false),
      snare: Array.from({ length: 32 }, (_, i) => i % 8 === 4),
      hat: Array.from({ length: 32 }, (_, i) => i % 2 === 0),
      openhat: new Array<boolean>(32).fill(false),
      clap: new Array<boolean>(32).fill(false),
      tom: new Array<boolean>(32).fill(false),
    },
  };
  doc.patterns.drums = [a, b];
  doc.songChain.drums = [a.id, b.id];

  // Bass: one 2-bar pattern → 32 steps (repeats ×2 in the cycle).
  const bass = doc.patterns.bass[0];
  doc.patterns.bass = [
    bass.kind === "pitched"
      ? { ...bass, bars: 2, notes: [{ degree: 0, start: 0, length: 3 }] }
      : bass,
  ];

  // Chords: the default 1-bar pattern with a degree-0 triad on the
  // downbeat (repeats ×4 in the cycle).
  const chords = doc.patterns.chords[0];
  doc.patterns.chords = [
    chords.kind === "pitched"
      ? { ...chords, notes: [{ degree: 0, start: 0, length: 4 }] }
      : chords,
  ];

  // Lead: the default 1-bar pattern, degree 3 on step 8 (repeats ×4).
  const lead = doc.patterns.lead[0];
  doc.patterns.lead = [
    lead.kind === "pitched"
      ? { ...lead, notes: [{ degree: 3, start: 8, length: 2 }] }
      : lead,
  ];

  doc.chainCues = {
    drums: ["VERSE", "DROP"],
    bass: ["GROOVE"],
    chords: [null],
    lead: [null],
  };
  return doc;
}

/**
 * The plan's wide probe (I3-d): drums 64B + bass 4B + chords 8B (+ default
 * 1-bar lead) → export cycle = 64 bars. Drum rows are padded to the full
 * width with the four-on-the-floor kept in every bar (so the whole render
 * carries real signal at the seam windows); bass/chords keep bar-1 content
 * (growing is content-preserving by law).
 */
export function wideUnequalChainProject(): ProjectDocument {
  const doc = createDefaultProject();

  const drums = growDrums(doc.patterns.drums[0], 64);
  drums.steps.kick = Array.from(
    { length: 64 * 16 },
    (_, i) => i % 4 === 0,
  );
  drums.steps.hat = Array.from({ length: 64 * 16 }, (_, i) => i % 2 === 0);
  doc.patterns.drums = [drums];

  const bass = doc.patterns.bass[0];
  doc.patterns.bass = [
    bass.kind === "pitched"
      ? {
          ...bass,
          bars: 4,
          notes: [{ degree: 0, start: 0, length: 3 }],
        }
      : bass,
  ];

  const chords = doc.patterns.chords[0];
  doc.patterns.chords = [
    chords.kind === "pitched"
      ? { ...chords, bars: 8, notes: [{ degree: 0, start: 0, length: 4 }] }
      : chords,
  ];

  const lead = doc.patterns.lead[0];
  doc.patterns.lead = [
    lead.kind === "pitched"
      ? { ...lead, notes: [{ degree: 3, start: 0, length: 2 }] }
      : lead,
  ];
  return doc;
}
