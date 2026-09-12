import { beforeEach, expect, it } from "vitest";
import { createDefaultProject } from "../src/document/schema";
import { decode, encode } from "../src/document/codec";
import {
  addNote,
  docStore,
  loadDocument,
  resizePattern,
  undo,
} from "../src/state/store";
import { nextPatternLength } from "../src/state/patternRail";

beforeEach(() => {
  loadDocument(createDefaultProject());
  docStore.temporal.getState().clear();
});

it("grows drums and pitched clips to odd lengths and preserves them on validation", () => {
  for (const lane of ["drums", "bass"] as const) {
    const id = docStore.getState().doc.patterns[lane][0]!.id;
    expect(resizePattern(lane, id, 3).ok).toBe(true);
    expect(resizePattern(lane, id, 5).ok).toBe(true);
  }
  const restored = decode(encode(docStore.getState().doc));
  expect(restored.patterns.bass[0]!.bars).toBe(5);
  const drums = restored.patterns.drums[0]!;
  expect(drums.bars).toBe(5);
  if (drums.kind === "drums") expect(drums.steps.kick).toHaveLength(80);
});

it("protects notes beyond an odd boundary and allows undo of a clean shrink", () => {
  const id = docStore.getState().doc.patterns.bass[0]!.id;
  resizePattern("bass", id, 5);
  addNote("bass", id, { degree: 0, start: 64, length: 1 });
  expect(resizePattern("bass", id, 3)).toMatchObject({
    ok: false,
    reason: "blocked",
  });
  undo();
  expect(resizePattern("bass", id, 3).ok).toBe(true);
  undo();
  expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(5);
});

it.each([0, -1, 1.5, 129, NaN, Infinity])(
  "rejects invalid length %s without changing the document",
  (bars) => {
    const before = docStore.getState().doc;
    expect(
      resizePattern("bass", before.patterns.bass[0]!.id, bars),
    ).toMatchObject({ ok: false, reason: "invalid-length" });
    expect(docStore.getState().doc).toBe(before);
  },
);

it("keeps keyboard preset jumps usable from custom lengths", () => {
  expect(nextPatternLength(3, 1)).toBe(4);
  expect(nextPatternLength(3, -1)).toBe(2);
  expect(nextPatternLength(7, 1)).toBe(8);
});
