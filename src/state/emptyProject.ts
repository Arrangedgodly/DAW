/**
 * Empty-project predicate (HU-2): "all lanes are silent and untouched" — no
 * drum step set, no pitched cell non-zero, anywhere in the document. Pure, so
 * the stage hint derived from it disappears on the first edit by construction
 * (no hidden flags to reset).
 */

import type { ProjectDocument } from "../document/schema";

/** In-world hint label for the empty stage (not a modal). */
export const EMPTY_HINT_LABEL = "PICK A PRESET · PAINT THE GRID";

export function isProjectEmpty(doc: ProjectDocument): boolean {
  for (const step of doc.patterns.drums.flatMap((p) =>
    p.kind === "drums" ? Object.values(p.steps) : [],
  )) {
    if (step.some(Boolean)) return false;
  }
  for (const lane of ["bass", "chords", "lead"] as const) {
    for (const pattern of doc.patterns[lane] ?? []) {
      if (pattern.kind !== "pitched") continue;
      // v2 (SC-1): emptiness = no notes anywhere (an empty pattern may still
      // carry its row-degree manifest — that is grid shape, not content).
      if (pattern.notes.length > 0) return false;
    }
  }
  return true;
}
