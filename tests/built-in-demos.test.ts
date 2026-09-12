import { describe, expect, it } from "vitest";
import { createBuiltInDemo } from "../src/document/builtInDemos";
import { createDemoProject } from "../src/document/demoSong";
import { encode, decode } from "../src/document/codec";
import { validateProject } from "../src/document/validate";
import { getPreset } from "../src/audio/presets";

describe("built-in demos", () => {
  it("keeps the original welcome song byte-identical and returns independent copies", () => {
    expect(encode(createBuiltInDemo("welcome"))).toBe(
      encode(createDemoProject()),
    );
    const a = createBuiltInDemo("glass-arcade");
    const b = createBuiltInDemo("glass-arcade");
    expect(a).toEqual(b);
    expect(a.patterns.extra1).not.toBe(b.patterns.extra1);
  });
  for (const id of ["glass-arcade", "after-hours"] as const)
    it(`${id} ships a valid, fully arranged eight-lane song`, () => {
      const doc = createBuiltInDemo(id);
      expect(validateProject(doc)).toEqual(doc);
      expect(decode(encode(doc))).toEqual(doc);
      expect(doc.lanes).toHaveLength(8);
      for (const lane of doc.lanes) {
        if (lane.id !== "drums") expect(getPreset(lane.presetId)).toBeDefined();
        const patterns = doc.patterns[lane.id]!;
        expect(doc.songChain[lane.id]).toHaveLength(4);
        expect(patterns.reduce((n, p) => n + p.bars, 0)).toBe(8);
        expect(
          patterns.some((p) =>
            p.kind === "pitched"
              ? p.notes.length > 0
              : Object.values(p.steps).some((row) => row.some(Boolean)),
          ),
        ).toBe(true);
        for (const p of patterns)
          if (p.kind === "pitched")
            for (const note of p.notes) {
              expect(note.start + note.length).toBeLessThanOrEqual(p.bars * 16);
              expect(p.rowDegrees).toContain(note.degree);
            }
      }
      expect(
        doc.patterns.extra3!.some(
          (p) => p.kind === "pitched" && p.notes.length === 0,
        ),
      ).toBe(true);
    });
});
