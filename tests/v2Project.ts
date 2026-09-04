/**
 * SV-1 test support: v2-shaped project texts (the pre-v3 on-disk form).
 *
 * `v2ProjectText` re-stamps a live v3 document as v2: version → 2 and the
 * transport regains `loopBars` (required by v2's strict schema). For the
 * default/demo the result is EXACTLY the bytes the pre-SV-1 app saved (the
 * SC-1-era canonical goldens), so migration tests can prove
 * `decode(v2 view of X) === X` — the v2→v3 losslessness law — and that the
 * v2 bytes themselves did not churn (they equal the recorded v2 golden
 * hashes).
 *
 * `boundaryV2ProjectText` is a hand-authored neighbor pinning the v2-side
 * boundaries that survive v3 unchanged: 4-bar patterns (the v2 ceiling)
 * with notes at the v2 bounds (start 63, length 128) plus the loopBars=4
 * pairing, so the widening is provably a NO-OP on every v2-legal value.
 */

import { canonicalize } from "../src/document/codec";
import type { ProjectDocument } from "../src/document/schema";
import { createDefaultProject } from "../src/document/schema";
import { createDemoProject } from "../src/document/demoSong";

/** The v2 document text for the same musical content as `doc`. */
export function v2ProjectText(
  doc: ProjectDocument,
  loopBars: 1 | 2 | 4 = 1,
): string {
  const { version: _v, ...rest } = doc;
  void _v;
  return canonicalize({
    ...rest,
    version: 2,
    transport: { ...doc.transport, loopBars },
  });
}

export function v2DefaultProjectText(): string {
  return v2ProjectText(createDefaultProject());
}

export function v2DemoProjectText(): string {
  return v2ProjectText(createDemoProject());
}

/**
 * Hand-authored v2 boundary neighbor: 4-bar patterns (the v2 vocabulary
 * ceiling) on every lane, v2-boundary notes (start 63, length 128 — the v2
 * ceilings, still legal inside v3's widened 2047/2048 bounds), loopBars 4
 * paired with the pattern bars (the IM-6-era agreement). Every value must
 * survive v2→v3 byte-for-byte (the widening is a no-op on v2-legal values;
 * only loopBars drops).
 */
export function boundaryV2ProjectText(): string {
  const doc = createDefaultProject();
  const bass = doc.patterns.bass[0];
  const lead = doc.patterns.lead[0];
  if (bass.kind !== "pitched" || lead.kind !== "pitched")
    throw new Error("expected pitched patterns");
  bass.bars = 4;
  bass.notes = [
    { degree: 0, start: 0, length: 128 }, // the v2 MAX_NOTE_LENGTH
    { degree: 6, start: 63, length: 0.25 }, // the v2 start ceiling
  ];
  lead.bars = 4;
  lead.notes = [{ degree: 3, start: 63, length: 128 }];
  const drums = doc.patterns.drums[0];
  if (drums.kind !== "drums") throw new Error("expected drums pattern");
  drums.bars = 4;
  for (const piece of Object.keys(drums.steps) as (keyof typeof drums.steps)[]) {
    drums.steps[piece] = new Array(64).fill(false);
  }
  drums.steps.kick[63] = true; // the v2 last step
  return v2ProjectText(doc, 4);
}
