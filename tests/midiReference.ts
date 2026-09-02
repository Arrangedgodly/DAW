/**
 * Shared reference project for MF-5 MIDI tests (unit + golden + browser
 * parse-back). Same lineage as the WAV reference project (drums four-on-the
 * floor + lead degree 3) extended so every export feature has coverage:
 * every lane has notes, chords stack a triad, the lead uses a sustain marker,
 * and chainCues carry two section labels.
 */

import {
  createDefaultProject,
  type ProjectDocument,
  type PitchedCell,
} from "../src/document/schema";

export function referenceMidiProject(): ProjectDocument {
  const doc = createDefaultProject();

  // Drums: kick four-on-the-floor, snare on 4+12, hats on the evens.
  const drums = doc.patterns.drums[0];
  drums.steps.kick = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
  drums.steps.snare = Array.from({ length: 16 }, (_, i) => i === 4 || i === 12);
  drums.steps.hat = Array.from({ length: 16 }, (_, i) => i % 2 === 0);

  // Bass (default C minor, octave base 2 → degree 0 = C2 = MIDI 36):
  // degree 0 on step 0 with a sustain marker on step 1.
  const bass = doc.patterns.bass[0];
  const bassSteps = new Array(16).fill(0) as PitchedCell[];
  bassSteps[0] = 1;
  bassSteps[1] = 2;
  bass.rows[0].steps = bassSteps;

  // Chords: degree 0 triad on the downbeat (stacks [0, 2, 4] → C2/Eb2/G2).
  const chords = doc.patterns.chords[0];
  const chordSteps = new Array(16).fill(0) as PitchedCell[];
  chordSteps[0] = 1;
  chords.rows[0].steps = chordSteps;

  // Lead (octave base 4 → degree 3 of C minor = F4 = MIDI 65) on step 8.
  const lead = doc.patterns.lead[0];
  const leadSteps = new Array(16).fill(0) as PitchedCell[];
  leadSteps[8] = 1;
  lead.rows[3].steps = leadSteps;

  // Section cues: VERSE at slot 0 (drums), DROP at slot 0 of the lead chain
  // (distinct labels — both at tick 0, both must survive as markers).
  doc.chainCues = {
    drums: ["VERSE"],
    bass: [null],
    chords: [null],
    lead: ["DROP"],
  };
  return doc;
}
