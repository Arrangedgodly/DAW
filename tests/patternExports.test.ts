import { describe, expect, it } from "vitest";
import { parseMidi } from "midi-file";
import { encodePatternMidi, exportPatternMidi } from "../src/audio/exportMidi";
import { linearizeSchedule } from "../src/audio/linearArrangement";
import {
  compileSong,
  compileLaneSchedule,
  resolveChainSlots,
} from "../src/audio/song";
import { getPreset } from "../src/audio/presets";
import { expandLaneEventsForLoop } from "../src/audio/render";
import { referenceMidiProject } from "./midiReference";
import { effectiveScale } from "../src/document/scales";

describe("pattern MIDI", () => {
  it("exports only the chosen pattern, preserves empty bars, and excludes arrangement cues", () => {
    const doc = referenceMidiProject();
    const pattern = doc.patterns.lead[0];
    pattern.bars = 3;
    doc.songChain.lead = [pattern.id, pattern.id];
    doc.transport.swing = 0.5;
    if (pattern.kind !== "pitched") throw new Error("pitched");
    pattern.notes = [{ degree: 3, start: 1, length: 2 }];
    const midi = parseMidi(encodePatternMidi(doc, "lead", pattern.id));
    expect(midi.header.numTracks).toBe(2);
    const notes = midi.tracks[1].filter((e) => e.type === "noteOn");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      channel: 2,
      noteNumber: 65,
      deltaTime: 180,
    });
    for (const track of midi.tracks)
      expect(track.reduce((n, e) => n + e.deltaTime, 0)).toBe(5760);
    expect(midi.tracks.flat().some((e) => e.type === "marker")).toBe(false);
    expect(midi.tracks[0]).toContainEqual(
      expect.objectContaining({
        type: "setTempo",
        microsecondsPerBeat: 500000,
      }),
    );
  });

  it("clips overhanging note-offs at the pattern end", () => {
    const doc = referenceMidiProject();
    const p = doc.patterns.lead[0];
    if (p.kind !== "pitched") throw new Error("pitched");
    p.notes = [{ degree: 3, start: 15, length: 4 }];
    const midi = parseMidi(encodePatternMidi(doc, "lead", p.id));
    let tick = 0;
    for (const e of midi.tracks[1]) {
      tick += e.deltaTime;
      if (e.type === "noteOff") expect(tick).toBe(1920);
    }
    expect(tick).toBe(1920);
  });

  it("preserves chord stacks and GM drums", () => {
    const doc = referenceMidiProject();
    const chords = parseMidi(
      encodePatternMidi(doc, "chords", doc.patterns.chords[0].id),
    );
    expect(
      chords.tracks[1]
        .filter((e) => e.type === "noteOn")
        .map((e) => e.noteNumber),
    ).toEqual([48, 51, 55]);
    const drums = parseMidi(
      encodePatternMidi(doc, "drums", doc.patterns.drums[0].id),
    );
    expect(
      drums.tracks[1]
        .filter((e) => e.type === "noteOn")
        .every((e) => e.channel === 9),
    ).toBe(true);
  });

  it("reports missing patterns and download errors without throwing", () => {
    const doc = referenceMidiProject();
    expect(exportPatternMidi(doc, "lead", "missing")).toMatchObject({
      ok: false,
      kind: "encode",
    });
    expect(
      exportPatternMidi(doc, "lead", doc.patterns.lead[0].id, {
        seam: {
          createObjectURL: () => {
            throw new Error("download blocked");
          },
          revokeObjectURL: () => {},
          createElement: () => ({ href: "", download: "", click() {} }),
        },
      }),
    ).toMatchObject({ ok: false, kind: "io" });
  });
});

describe("finite linear arrangement", () => {
  it("uses bars and repeats in order while ignoring routing and indefinite holds", () => {
    const doc = referenceMidiProject();
    const p = doc.patterns.lead[0];
    if (p.kind !== "pitched") throw new Error("pitched");
    p.bars = 2;
    p.notes = [
      { degree: 3, start: 0, length: 1 },
      { degree: 4, start: 24, length: 1 },
    ];
    doc.songChain.lead = [p.id, p.id, p.id];
    doc.playbackRules = {
      lead: [
        { unit: "bars", amount: 3, action: "random" },
        { unit: "repeats", amount: 2, action: "stop" },
        { unit: "hold", amount: 1, action: "previous" },
      ],
    };
    const slots = resolveChainSlots(doc, "lead");
    const groove = { bpm: 120, swing: 0.5 };
    const schedule = linearizeSchedule(
      compileLaneSchedule({
        chain: slots.map((s) => s.pattern),
        slots,
        groove,
        gate: 2,
        scale: effectiveScale(doc, "lead"),
        preset: getPreset("preset-lead-1")!,
      }),
    );
    expect(schedule.chainSteps).toBe(144);
    expect(schedule.segments.map((s) => s.startStep)).toEqual([0, 48, 112]);
    expect([...schedule.byStep.keys()]).toEqual([
      0, 24, 32, 48, 72, 80, 104, 112, 136,
    ]);
    const events = expandLaneEventsForLoop(
      schedule,
      schedule.chainSteps,
      groove,
    );
    expect(events.map((e) => e.time)).toEqual([0, 3, 4, 6, 9, 10, 13, 14, 17]);
  });

  it("preserves the old shared compiler and leaves document data untouched", () => {
    const doc = referenceMidiProject();
    const before = JSON.stringify(doc);
    const original = compileSong(doc, { bpm: 120, swing: 0 });
    const linear = linearizeSchedule(original.lead);
    expect(linear.chainSteps).toBe(16);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
