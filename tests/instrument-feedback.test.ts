import { expect, it } from "vitest";
import { laneDisplayName, soundOptionsFor } from "../src/components/laneMeta";
import { DRUM_KITS } from "../src/audio/presets";
import {
  CORE_DRUM_PIECES,
  DRUM_PIECES,
  createDefaultProject,
} from "../src/document/schema";
import { decode, encode } from "../src/document/codec";
import { buildDrumNotes, GM_DRUM_NOTES } from "../src/audio/exportMidi";

it("separates pads from chords and names every pitched lane by its sound", () => {
  const options = soundOptionsFor("bass");
  expect(options.find((p) => p.id === "preset-chords-1")?.family).toBe("Pads");
  expect(options.find((p) => p.id === "preset-chords-4")?.family).toBe(
    "Chords",
  );
  expect(options.some((p) => p.family === "Pads & chords")).toBe(false);
  for (const lane of ["bass", "chords", "lead", "extra1"] as const) {
    expect(laneDisplayName(lane, "preset-chords-1")).toBe("Pads");
    expect(laneDisplayName(lane, "preset-bass-1")).toBe("Bass");
  }
});

it("old six-row files load with silent extension rows and unchanged bytes", () => {
  const doc = createDefaultProject();
  const encoded = encode(doc);
  expect(
    Object.keys(JSON.parse(encoded).patterns.drums[0].steps).sort(),
  ).toEqual([...CORE_DRUM_PIECES].sort());
  const restored = decode(encoded);
  const pattern = restored.patterns.drums[0];
  if (pattern.kind !== "drums") throw new Error("Expected drums");
  expect(Object.keys(pattern.steps)).toHaveLength(16);
  expect(
    Object.values(pattern.steps).every(
      (row) => row.length === pattern.bars * 16 && row.every((on) => !on),
    ),
  ).toBe(true);
  expect(encode(restored)).toBe(encoded);
});

it("all 16 drum voices survive save/load and export to distinct MIDI notes", () => {
  const doc = createDefaultProject();
  const pattern = doc.patterns.drums[0];
  if (pattern.kind !== "drums") throw new Error("Expected drums");
  DRUM_PIECES.forEach((piece, step) => {
    pattern.steps[piece][step] = true;
  });
  const restored = decode(encode(doc));
  expect(restored.patterns.drums[0]).toEqual(pattern);
  expect(new Set(Object.values(GM_DRUM_NOTES)).size).toBe(16);
  expect(
    buildDrumNotes(
      restored.patterns.drums,
      restored.lanes[0].gate,
      restored.transport.bpm,
    ),
  ).toHaveLength(16);
  for (const kit of Object.values(DRUM_KITS)) {
    expect(Object.keys(kit.pieces)).toHaveLength(16);
    expect(new Set(Object.values(kit.pieces).map((p) => p.id)).size).toBe(16);
  }
});
