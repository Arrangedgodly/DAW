import { addNote, docStore, loadDocument } from "../src/state/store";
import { encode, decode } from "../src/document/codec";
import { buildPitchedNotes } from "../src/audio/exportMidi";
import { resolveChainPatterns } from "../src/audio/song";
import { compileLaneEvents } from "../src/audio/compile";
import { getPreset } from "../src/audio/presets";
import { effectiveScale } from "../src/document/scales";
import { describe, expect, it } from "vitest";
import { pitchDomain, pitchWindowStart } from "../src/document/pitchWindow";
import { MODE_NAMES, MODE_INTERVALS } from "../src/document/scales";
import { createDemoProject } from "../src/document/demoSong";

describe("pitched editing window", () => {
  it("orders every scale from high to low across the MIDI domain", () => {
    for (const mode of MODE_NAMES)
      for (let root = 0; root < 12; root++) {
        const doc = createDemoProject();
        doc.scale = { root, mode };
        for (const lane of ["bass", "chords", "lead"] as const) {
          const { pitches, degrees, windowRows } = pitchDomain(doc, lane);
          expect(windowRows).toBe(MODE_INTERVALS[mode].length);
          expect(pitches.length).toBeGreaterThan(40);
          expect(degrees.some((degree) => degree < 0)).toBe(true);
          expect(degrees.some((degree) => degree > windowRows * 2)).toBe(true);
          pitches.forEach((pitch, index) => {
            expect(pitch).toBeGreaterThanOrEqual(0);
            expect(pitch).toBeLessThanOrEqual(127);
            expect(MODE_INTERVALS[mode]).toContain(
              (((pitch - root) % 12) + 12) % 12,
            );
            if (index) {
              expect(pitch).toBeLessThan(pitches[index - 1]);
              expect(degrees[index]).toBe(degrees[index - 1] - 1);
            }
          });
        }
      }
  });

  it("moves up the screen for higher octaves and restores the same rows on return", () => {
    const doc = createDemoProject();
    const before = JSON.stringify(doc);
    for (const lane of ["bass", "chords", "lead"] as const) {
      const { pitches, windowRows, maxOrigin, maxStart } = pitchDomain(
        doc,
        lane,
      );
      const start = (origin: number) =>
        pitchWindowStart(pitches, origin, windowRows);
      for (let origin = 12; origin + 12 <= maxOrigin; origin++) {
        expect(start(origin + 12)).toBe(start(origin) - windowRows);
        expect(start(origin - 12)).toBe(start(origin) + windowRows);
        expect(start(origin + 1)).toBeLessThanOrEqual(start(origin));
        expect(pitches[start(origin)]).toBeLessThanOrEqual(origin + 11);
      }
      expect(start(0)).toBe(maxStart);
      expect(start(maxOrigin)).toBe(0);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});

it("new low and high register notes survive save, compilation and MIDI export", () => {
  const demo = createDemoProject();
  for (const lane of ["bass", "chords", "lead"] as const) {
    loadDocument(demo);
    const pattern = demo.patterns[lane][0];
    const before = pattern.kind === "pitched" ? [...pattern.notes] : [];
    const domain = pitchDomain(demo, lane);
    const low = -7;
    const high = 28;
    for (const degree of [low, high])
      expect(addNote(lane, pattern.id, { degree, start: 0, length: 1 })).toBe(
        true,
      );
    const saved = decode(encode(docStore.getState().doc));
    const next = saved.patterns[lane][0];
    if (next.kind !== "pitched") throw new Error("Expected pitched pattern");
    for (const note of before) expect(next.notes).toContainEqual(note);
    expect(next.rowDegrees).toContain(low);
    expect(next.rowDegrees).toContain(high);
    const midi = buildPitchedNotes(
      saved,
      lane,
      resolveChainPatterns(saved, lane),
      0,
    );
    for (const degree of [low, high])
      expect(midi.map((note) => note.noteNumber)).toContain(
        domain.pitches[domain.degrees.indexOf(degree)],
      );
    const config = saved.lanes.find((item) => item.id === lane)!;
    if (!("presetId" in config)) throw new Error("Expected pitched lane");
    const compiled = compileLaneEvents({
      pattern: next,
      preset: getPreset(config.presetId)!,
      gate: config.gate,
      groove: { bpm: 112, swing: 0 },
      scale: effectiveScale(saved, lane),
    });
    expect(compiled.length).toBeGreaterThan(0);
    expect(
      compiled.every((event) => Number.isFinite(event.freq) && event.freq > 0),
    ).toBe(true);
  }
});
