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
  type Note,
  type PitchedPattern,
} from "../src/document/schema";

function withNotes(
  doc: ProjectDocument,
  lane: "bass" | "chords" | "lead",
  notes: readonly Note[],
): void {
  doc.patterns[lane] = doc.patterns[lane].map((p) =>
    p.kind === "pitched" ? ({ ...p, notes } satisfies PitchedPattern) : p,
  );
}

export function referenceMidiProject(): ProjectDocument {
  const doc = createDefaultProject();

  // Drums: kick four-on-the-floor, snare on 4+12, hats on the evens.
  const drums = doc.patterns.drums[0];
  drums.steps.kick = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
  drums.steps.snare = Array.from({ length: 16 }, (_, i) => i === 4 || i === 12);
  drums.steps.hat = Array.from({ length: 16 }, (_, i) => i % 2 === 0);

  // Bass (default C minor, octave base 2 → degree 0 = C2 = MIDI 36):
  // degree 0 on step 0, three steps long — the v1 shape was a note-on with a
  // sustain marker (gate 2 + 1 sustain = length 3, the migration law).
  withNotes(doc, "bass", [{ degree: 0, start: 0, length: 3 }]);

  // Chords: degree 0 triad on the downbeat (stacks [0, 2, 4] → C2/Eb2/G2),
  // one gate long (default chords gate = 4 steps).
  withNotes(doc, "chords", [{ degree: 0, start: 0, length: 4 }]);

  // Lead (octave base 4 → degree 3 of C minor = F4 = MIDI 65) on step 8,
  // one lead gate long (default lead gate = 2 steps).
  withNotes(doc, "lead", [{ degree: 3, start: 8, length: 2 }]);

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
