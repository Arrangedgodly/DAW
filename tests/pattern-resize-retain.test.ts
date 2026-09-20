/** Shrinking a clip keeps the cut-off content; growing restores it; doubling overwrites it. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultProject,
  type DrumPattern,
  type PitchedPattern,
} from "../src/document/schema";
import {
  addNote,
  canUndo,
  doublePattern,
  docStore,
  loadDocument,
  resizePattern,
  undo,
} from "../src/state/store";

const doc = () => docStore.getState().doc;

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
  loadDocument(createDefaultProject());
});

describe("resize retains cut-off content", () => {
  it("pitched: shrink stashes notes, grow restores them, double discards", () => {
    const id = doc().patterns.bass![0]!.id;
    expect(resizePattern("bass", id, 2).ok).toBe(true);
    const degree = (doc().patterns.bass![0] as PitchedPattern).rowDegrees[0]!;
    addNote("bass", id, { degree, start: 20, length: 1 });
    expect(resizePattern("bass", id, 1).ok).toBe(true);
    let p = doc().patterns.bass![0] as PitchedPattern;
    expect(p.bars).toBe(1);
    expect(p.notes.some((n) => n.start === 20)).toBe(false);
    expect(resizePattern("bass", id, 2).ok).toBe(true);
    p = doc().patterns.bass![0] as PitchedPattern;
    expect(p.notes.some((n) => n.start === 20)).toBe(true);
    expect(p.overflow).toBeUndefined();

    resizePattern("bass", id, 1);
    doublePattern("bass", id);
    p = doc().patterns.bass![0] as PitchedPattern;
    expect(p.overflow).toBeUndefined();
    expect(p.notes.some((n) => n.start === 20)).toBe(false);
  });

  it("drums: shrink stashes hits, grow restores them", () => {
    const id = doc().patterns.drums![0]!.id;
    resizePattern("drums", id, 2);
    const steps = (doc().patterns.drums![0] as DrumPattern).steps;
    const piece = Object.keys(steps)[0] as keyof typeof steps;
    const row = [...steps[piece]];
    row[20] = true;
    docStore.setState({
      doc: {
        ...doc(),
        patterns: {
          ...doc().patterns,
          drums: [
            {
              ...(doc().patterns.drums![0] as DrumPattern),
              steps: { ...steps, [piece]: row },
            },
          ],
        },
      },
    });
    expect(resizePattern("drums", id, 1).ok).toBe(true);
    const shrunk = doc().patterns.drums![0] as DrumPattern;
    expect(shrunk.steps[piece]).toHaveLength(16);
    expect(resizePattern("drums", id, 2).ok).toBe(true);
    const back = doc().patterns.drums![0] as DrumPattern;
    expect(back.steps[piece][20]).toBe(true);
    expect(back.overflow).toBeUndefined();
  });
});
