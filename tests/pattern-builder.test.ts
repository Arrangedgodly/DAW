import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultProject,
  DRUM_PIECES,
  type PlaybackRule,
  type PitchedPattern,
} from "../src/document/schema";
import { decode, encode } from "../src/document/codec";
import {
  appendChainSlot,
  docStore,
  doublePattern,
  insertPatternBlock,
  loadDocument,
  removeChainSlot,
  removePattern,
  setPlaybackRule,
  setSongSection,
  undo,
} from "../src/state/store";
const doc = () => docStore.getState().doc;
const rule: PlaybackRule = {
  unit: "bars",
  amount: 8,
  action: "goto",
  target: 1,
};
beforeEach(() => {
  loadDocument(createDefaultProject());
  docStore.temporal.getState().clear();
});

describe("pattern builder edits", () => {
  it("inserts an independent snapshot and undoes both pattern creation and insertion together", () => {
    const original = doc();
    const source = original.patterns.bass[0];
    const id = insertPatternBlock("bass", source, 0);
    expect(doc().songChain.bass.slice(0, 2)).toEqual([source.id, id]);
    expect(doc().patterns.bass.at(-1)).toEqual({
      ...source,
      id,
      name: `${source.name}+`,
    });
    expect(doc().patterns.bass.at(-1)).not.toBe(source);
    doublePattern("bass", id);
    expect(doc().patterns.bass[0].bars).toBe(source.bars);
    undo();
    undo();
    expect(doc()).toEqual(original);
  });
  it("reuses a pattern without creating another library entry", () => {
    const source = doc().patterns.bass[0];
    const count = doc().patterns.bass.length;
    expect(insertPatternBlock("bass", source, 0, true)).toBe(source.id);
    expect(doc().patterns.bass.length).toBe(count);
    expect(doc().songChain.bass.slice(0, 2)).toEqual([source.id, source.id]);
  });
  it("doubles arbitrary pitched lengths and retains every note attribute", () => {
    const source: PitchedPattern = {
      ...(doc().patterns.bass[0] as PitchedPattern),
      bars: 3,
      notes: [{ degree: 0, start: 4, length: 2 }],
    };
    loadDocument({
      ...doc(),
      patterns: { ...doc().patterns, bass: [source] },
      songChain: { ...doc().songChain, bass: [source.id] },
    });
    expect(doublePattern("bass", source.id)).toBe(true);
    const doubled = doc().patterns.bass[0] as PitchedPattern;
    expect(doubled.bars).toBe(6);
    expect(doubled.notes).toEqual([
      source.notes[0],
      { ...source.notes[0], start: 52 },
    ]);
    undo();
    expect(doc().patterns.bass[0]).toEqual(source);
  });
  it("repeats all sixteen drum rows and refuses growth beyond 128 bars", () => {
    const source = doc().patterns.drums[0];
    if (source.kind !== "drums") throw new Error("fixture");
    expect(doublePattern("drums", source.id)).toBe(true);
    const doubled = doc().patterns.drums[0];
    if (doubled.kind !== "drums") throw new Error("fixture");
    for (const piece of DRUM_PIECES)
      expect(doubled.steps[piece]).toEqual([
        ...source.steps[piece],
        ...source.steps[piece],
      ]);
    while (doublePattern("drums", source.id)) {
      /* grow to cap */
    }
    const atLimit = doc();
    expect(doc().patterns.drums[0].bars).toBe(128);
    expect(doublePattern("drums", source.id)).toBe(false);
    expect(doc()).toBe(atLimit);
  });
  it("retains playback rules and jump destinations when inserting and removing earlier blocks", () => {
    const source = doc().patterns.bass[0];
    appendChainSlot("bass", source.id);
    setPlaybackRule("bass", 0, rule);
    insertPatternBlock("bass", source, -1);
    expect(doc().playbackRules?.bass?.[1]).toEqual({ ...rule, target: 2 });
    removeChainSlot("bass", 0);
    expect(doc().playbackRules?.bass?.[0]).toEqual(rule);
    removeChainSlot("bass", 1);
    expect(doc().playbackRules?.bass?.[0]).toEqual({
      unit: "bars",
      amount: 8,
      action: "next",
    });
  });
  it("prunes rules with removed patterns, and round-trips section and playback settings", () => {
    const source = doc().patterns.bass[0];
    const copy = insertPatternBlock("bass", source, 0);
    setPlaybackRule("bass", 0, rule);
    setSongSection(0, { name: "Verse", bars: 16, next: 1 });
    expect(decode(encode(doc()))).toEqual(doc());
    removePattern("bass", copy);
    expect(doc().playbackRules?.bass?.length).toBe(doc().songChain.bass.length);
    expect(doc().playbackRules?.bass?.[0]?.action).toBe("next");
  });
  it("rejects invalid duration and destinations without changing the document", () => {
    const original = doc();
    expect(() => setPlaybackRule("bass", 0, { ...rule, amount: 0 })).toThrow();
    expect(() =>
      setPlaybackRule("bass", 0, { ...rule, target: 999 }),
    ).toThrow();
    expect(doc()).toBe(original);
  });
});
