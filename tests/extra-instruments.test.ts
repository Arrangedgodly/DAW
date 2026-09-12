import { beforeEach, describe, expect, it } from "vitest";
import {
  addInstrumentLane,
  removeInstrumentLane,
  loadDocument,
  docStore,
  addNote,
  undo,
  redo,
  setLaneSoundId,
} from "../src/state/store";
import { createDefaultProject } from "../src/document/schema";
import { encode, decode } from "../src/document/codec";
import { compileSong } from "../src/audio/song";
import { buildMidiData } from "../src/audio/exportMidi";
import { soundOptionsFor } from "../src/components/laneMeta";
import { EXPANDED_PRESETS } from "../src/audio/expandedPresets";
import { VoicePresetSchema } from "../src/audio/presets";
import * as v from "valibot";

beforeEach(() => {
  loadDocument(createDefaultProject());
  docStore.temporal.getState().clear();
});

describe("optional instrument tracks", () => {
  it("adds into the clicked quadrant and refuses occupied slots", () => {
    expect(addInstrumentLane("preset-bells-crystal", "extra4")).toBe("extra4");
    expect(docStore.getState().doc.patterns.extra1).toBeUndefined();
    expect(addInstrumentLane("preset-brass-horn", "extra2")).toBe("extra2");
    expect(addInstrumentLane("preset-brass-horn", "extra4")).toBeNull();
    expect(docStore.getState().doc.lanes.map((l) => l.id)).toEqual([
      "drums",
      "bass",
      "chords",
      "lead",
      "extra2",
      "extra4",
    ]);
    expect(decode(encode(docStore.getState().doc))).toEqual(
      docStore.getState().doc,
    );
  });
  it("adds four tracks, saves their notes, compiles and exports each on its own channel", () => {
    for (let i = 1; i <= 4; i++) {
      const id = addInstrumentLane("preset-brass-horn")!;
      expect(id).toBe(`extra${i}`);
      if (id === "drums") throw new Error("Expected pitched lane");
      addNote(id, `${id}-1`, { degree: i, start: i, length: 2 });
    }
    expect(addInstrumentLane()).toBeNull();
    const doc = docStore.getState().doc;
    expect(doc.lanes).toHaveLength(8);
    expect(decode(encode(doc))).toEqual(doc);
    expect(Object.keys(compileSong(doc, { bpm: 120, swing: 0 }))).toHaveLength(
      8,
    );
    const midi = buildMidiData(doc);
    expect(midi.header.numTracks).toBe(9);
    const channels = midi.tracks
      .slice(5)
      .map((track) => track.find((e) => e.type === "noteOn"));
    expect(channels.every(Boolean)).toBe(true);
    expect(
      new Set(channels.map((e) => (e && "channel" in e ? e.channel : -1))).size,
    ).toBe(4);
  });

  it("removal and undo restore the full track, and vacant slots can be reused", () => {
    addInstrumentLane();
    addInstrumentLane();
    addNote("extra1", "extra1-1", { degree: 0, start: 0, length: 4 });
    const before = encode(docStore.getState().doc);
    removeInstrumentLane("extra1");
    expect(docStore.getState().doc.patterns.extra1).toBeUndefined();
    expect(() => decode(encode(docStore.getState().doc))).not.toThrow();
    undo();
    expect(encode(docStore.getState().doc)).toBe(before);
    redo();
    expect(addInstrumentLane()).toBe("extra1");
    expect(docStore.getState().doc.lanes.map((l) => l.id)).toEqual([
      "drums",
      "bass",
      "chords",
      "lead",
      "extra1",
      "extra2",
    ]);
  });

  it("rejects orphan lane data and keeps existing four-track files intact", () => {
    const original = createDefaultProject();
    expect(decode(encode(original))).toEqual(original);
    expect(() =>
      decode(
        JSON.stringify({
          ...original,
          patterns: { ...original.patterns, extra1: [] },
        }),
      ),
    ).toThrow();
    removeInstrumentLane("bass");
    expect(docStore.getState().doc.lanes).toHaveLength(4);
  });

  it("shares every pitched sound without changing painted notes", () => {
    addNote("bass", "bass-1", { degree: 0, start: 0, length: 2 });
    const patterns = docStore.getState().doc.patterns;
    setLaneSoundId("bass", "preset-bells-crystal");
    expect(docStore.getState().doc.patterns).toEqual(patterns);
    expect(soundOptionsFor("extra1")).toEqual(soundOptionsFor("bass"));
    for (const preset of EXPANDED_PRESETS)
      expect(v.safeParse(VoicePresetSchema, preset).success).toBe(true);
  });
});
