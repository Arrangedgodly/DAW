/** Boundary, history, and persistence laws for retained pattern overflow. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DRUM_PIECES,
  createDefaultProject,
  type DrumPattern,
  type PitchedPattern,
} from "../src/document/schema";
import { decode, encode } from "../src/document/codec";
import {
  addNote,
  docStore,
  loadDocument,
  resizePattern,
  undo,
  redo,
  doublePattern,
} from "../src/state/store";

const doc = () => docStore.getState().doc;
const bass = () => doc().patterns.bass[0] as PitchedPattern;
const drums = () => doc().patterns.drums[0] as DrumPattern;

beforeEach(() => {
  loadDocument(createDefaultProject());
  docStore.temporal.getState().clear();
});

describe("pitched shrink boundaries", () => {
  it.each([
    { start: 8, length: 8, hidden: false },
    { start: 8, length: 8.25, hidden: false },
    { start: 14, length: 4, hidden: false },
    { start: 15, length: 8, hidden: false },
    { start: 16, length: 0.25, hidden: true },
    { start: 20, length: 4, hidden: true },
    { start: 2047, length: 1, hidden: true },
  ])(
    "start $start, length $length: hidden=$hidden, full note restores",
    ({ start, length, hidden }) => {
      resizePattern("bass", "bass-1", 128);
      const note = { degree: 0, start, length };
      addNote("bass", "bass-1", note);
      expect(resizePattern("bass", "bass-1", 1)).toEqual({ ok: true, bars: 1 });
      expect(bass().notes).toEqual(hidden ? [] : [note]);
      expect(bass().overflow).toEqual(hidden ? [note] : undefined);
      // Exercise saved-document validation, not merely in-memory restoration.
      loadDocument(decode(encode(doc())));
      expect(resizePattern("bass", "bass-1", 128).ok).toBe(true);
      expect(bass().notes).toEqual([note]);
      expect(bass().overflow).toBeUndefined();
    },
  );

  it("preserves a sustain spanning a custom three-bar boundary", () => {
    resizePattern("bass", "bass-1", 4);
    addNote("bass", "bass-1", { degree: 0, start: 44, length: 10 });
    expect(resizePattern("bass", "bass-1", 3).ok).toBe(true);
    expect(bass().notes).toEqual([{ degree: 0, start: 44, length: 10 }]);
    expect(bass().overflow).toBeUndefined();
  });

  it("partial growth restores only newly in-bounds anchors without duplication", () => {
    resizePattern("bass", "bass-1", 8);
    const notes = [
      { degree: 0, start: 10, length: 1 },
      { degree: 1, start: 20, length: 3 },
      { degree: 2, start: 70, length: 8 },
      { degree: 3, start: 72, length: 6 },
    ];
    notes.forEach((n) => addNote("bass", "bass-1", n));
    resizePattern("bass", "bass-1", 1);
    resizePattern("bass", "bass-1", 2);
    expect(bass().notes).toEqual(notes.slice(0, 2));
    expect(bass().overflow).toEqual(notes.slice(2));
    resizePattern("bass", "bass-1", 1);
    resizePattern("bass", "bass-1", 8);
    expect(bass().notes).toEqual(notes);
    expect(bass().overflow).toBeUndefined();
  });
});

describe("drum shrink boundaries", () => {
  it.each([15, 16, 20, 100, 2047])(
    "retains the hit at step %s through repeated shrink and grow",
    (step) => {
      resizePattern("drums", "drums-1", 128);
      const p = drums();
      const steps = {
        ...p.steps,
        snare: [...p.steps.snare],
        hat: [...p.steps.hat],
      };
      steps.snare[step] = steps.hat[step] = true;
      loadDocument({
        ...doc(),
        patterns: { ...doc().patterns, drums: [{ ...p, steps }] },
      });
      resizePattern("drums", "drums-1", 2);
      resizePattern("drums", "drums-1", 1);
      for (const piece of ["snare", "hat"] as const) {
        expect(drums().steps[piece]).toHaveLength(16);
        expect(drums().steps[piece].filter(Boolean)).toHaveLength(
          step < 16 ? 1 : 0,
        );
        if (step >= 16)
          expect(drums().overflow?.[piece]?.[step - 16]).toBe(true);
      }
      loadDocument(decode(encode(doc())));
      resizePattern("drums", "drums-1", 128);
      expect(drums().steps).toEqual(steps);
      expect(drums().overflow).toBeUndefined();
    },
  );

  it("empty rows shrink at every size without a meaningless overflow stash", () => {
    for (const bars of [128, 64, 32, 16, 8, 4, 2, 1]) {
      expect(resizePattern("drums", "drums-1", bars).ok).toBe(true);
      for (const piece of DRUM_PIECES) {
        expect(drums().steps[piece]).toHaveLength(bars * 16);
        expect(drums().steps[piece].some(Boolean)).toBe(false);
      }
      expect(drums().overflow).toBeUndefined();
    }
  });
});

describe("resize history and overwrite", () => {
  it("undo and redo restore the complete active and hidden content", () => {
    resizePattern("bass", "bass-1", 8);
    addNote("bass", "bass-1", { degree: 0, start: 64, length: 4 });
    const before = doc();
    const depth = docStore.temporal.getState().pastStates.length;
    resizePattern("bass", "bass-1", 4);
    const shrunk = doc();
    expect(docStore.temporal.getState().pastStates).toHaveLength(depth + 1);
    undo();
    expect(doc()).toEqual(before);
    redo();
    expect(doc()).toEqual(shrunk);
  });

  it("rapid resize gestures coalesce and undo restores the original full pattern", () => {
    resizePattern("bass", "bass-1", 2);
    addNote("bass", "bass-1", { degree: 0, start: 20, length: 4 });
    const before = doc();
    resizePattern("bass", "bass-1", 1);
    resizePattern("bass", "bass-1", 4);
    undo();
    expect(doc()).toEqual(before);
  });

  it("Double repeats visible content and discards hidden notes, with undo recovery", () => {
    resizePattern("bass", "bass-1", 2);
    addNote("bass", "bass-1", { degree: 0, start: 2, length: 2 });
    addNote("bass", "bass-1", { degree: 1, start: 20, length: 4 });
    resizePattern("bass", "bass-1", 1);
    const before = doc();
    expect(doublePattern("bass", "bass-1")).toBe(true);
    expect(bass().overflow).toBeUndefined();
    expect(bass().notes).toEqual([
      { degree: 0, start: 2, length: 2 },
      { degree: 0, start: 18, length: 2 },
    ]);
    undo();
    expect(doc()).toEqual(before);
  });

  it("limit, invalid values, and missing patterns never write history", () => {
    resizePattern("drums", "drums-1", 128);
    const before = doc();
    const depth = docStore.temporal.getState().pastStates.length;
    expect(resizePattern("drums", "drums-1", 128)).toEqual({
      ok: false,
      reason: "no-op",
    });
    expect(resizePattern("drums", "missing", 1)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(resizePattern("drums", "drums-1", 129)).toEqual({
      ok: false,
      reason: "invalid-length",
    });
    expect(doc()).toBe(before);
    expect(docStore.temporal.getState().pastStates).toHaveLength(depth);
  });
});
