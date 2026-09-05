/**
 * Arrangement density (T10 — route.md playback-reactivity #8, the DEPTH-BAND
 * raise): a PURE function of the document — never signal analysis, never
 * playback state. The ambient stage wash (chassis.css) keys its intensity
 * off this band: denser arrangements sit in a warmer light band, sparser
 * ones recede. The band is deliberately QUANTIZED (4 steps) so the wash
 * crossfades only at meaningful density boundaries, not on every cell edit
 * — an attribute write (data-density on .stage-floors) happens only when
 * the BAND changes, which the D2 law keeps to document-commit time (the
 * StageFloor subscription below the store's existing doc seam; no rAF, no
 * observers, no new store).
 *
 * Metric: total sounding CONTENT across the whole arrangement — every set
 * drum step in every drums pattern plus every note in every pitched
 * pattern. Thresholds place the shipped states honestly (unit-pinned in
 * tests/ambientDensity.test.ts):
 *   band 0  empty            (the fresh NEW project)
 *   band 1  sparse  ≤ 40     (first ideas)
 *   band 2  medium  ≤ 128    (the WELCOME SONG demo = 97 content)
 *   band 3  dense   > 128    (a filled-out arrangement)
 */

import type { ProjectDocument } from "../document/schema";

export type DensityBand = 0 | 1 | 2 | 3;

/** Upper-inclusive content edges for bands 1 and 2 (band 0 is exactly 0). */
export const DENSITY_BAND_EDGE_SPARSE = 40;
export const DENSITY_BAND_EDGE_MEDIUM = 128;

/** Total set drum steps + pitched notes across every pattern in the doc. */
export function arrangementContent(doc: ProjectDocument): number {
  let count = 0;
  for (const pattern of doc.patterns.drums) {
    if (pattern.kind !== "drums") continue;
    for (const row of Object.values(pattern.steps)) {
      for (const on of row) if (on) count++;
    }
  }
  for (const lane of ["bass", "chords", "lead"] as const) {
    for (const pattern of doc.patterns[lane]) {
      if (pattern.kind !== "pitched") continue;
      count += pattern.notes.length;
    }
  }
  return count;
}

/** The wash band for a document — pure, assertable, 4 steps. */
export function densityBand(doc: ProjectDocument): DensityBand {
  const content = arrangementContent(doc);
  if (content <= 0) return 0;
  if (content <= DENSITY_BAND_EDGE_SPARSE) return 1;
  if (content <= DENSITY_BAND_EDGE_MEDIUM) return 2;
  return 3;
}
