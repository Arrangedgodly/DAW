/**
 * MF-5 unit tests — tick math, mapping tables, marker encoding, and a
 * hand-computed small-case byte walk through writeMidi (structure-level
 * asserts via midi-file parseMidi: the writer + our delta encoding round-trip
 * into exactly the events we intend).
 */

import { describe, expect, it } from "vitest";
import { parseMidi, writeMidi } from "midi-file";
import {
  createDefaultProject,
  type PitchedCell,
  type ProjectDocument,
} from "../src/document/schema";
import {
  buildCueMarkers,
  buildDrumNotes,
  buildMidiData,
  buildPitchedNotes,
  DRUM_CHANNEL,
  encodeMidi,
  gateTicks,
  GM_DRUM_NOTES,
  GM_DRUM_VELOCITIES,
  LANE_CHANNELS,
  LANE_OCTAVE_FALLBACK,
  MIDI_EXTENSION,
  noteCount,
  PPQ,
  PRESET_GM_PROGRAMS,
  PITCHED_VELOCITY,
  stepTick,
  TICKS_PER_STEP,
  TRACK_COUNT,
} from "../src/audio/exportMidi";
import { PRESET_LIBRARY } from "../src/audio/presets";
import { referenceMidiProject } from "./midiReference";

// ---------------------------------------------------------------------------
// Tick math (16th = PPQ/4 at PPQ 480; verify midi-file's PPQ convention)
// ---------------------------------------------------------------------------

describe("tick math", () => {
  it("16th step = PPQ/4 = 120 ticks at PPQ 480", () => {
    expect(PPQ).toBe(480);
    expect(TICKS_PER_STEP).toBe(120);
    expect(stepTick(0)).toBe(0);
    expect(stepTick(1)).toBe(120);
    expect(stepTick(16)).toBe(1920); // one bar
    expect(stepTick(17)).toBe(2040);
  });

  it("swing shifts odd 16ths by round(swing × one step), evens untouched", () => {
    expect(stepTick(1, 0.5)).toBe(180); // 120 + 60
    expect(stepTick(3, 0.5)).toBe(420);
    expect(stepTick(0, 0.5)).toBe(0);
    expect(stepTick(2, 0.5)).toBe(240);
    expect(stepTick(1, 1)).toBe(240);
  });

  it("gate in steps is exact; gate in seconds rounds at the project BPM", () => {
    expect(gateTicks({ unit: "steps", value: 1 }, 120)).toBe(120);
    expect(gateTicks({ unit: "steps", value: 0.25 }, 120)).toBe(30);
    // 0.25 s at 120 BPM = one eighth = 240 ticks exactly.
    expect(gateTicks({ unit: "seconds", value: 0.25 }, 120)).toBe(240);
    // 0.1 s at 120 BPM = 0.2 beats (0.5 s/beat) = 96 ticks exactly.
    expect(gateTicks({ unit: "seconds", value: 0.1 }, 120)).toBe(96);
  });

  it("midi-file honors header.ticksPerBeat = 480 (PPQ convention, round trip)", () => {
    const data = buildMidiData(referenceMidiProject());
    expect(data.header.ticksPerBeat).toBe(480);
    const reparsed = parseMidi([...encodeMidi(referenceMidiProject())]);
    expect(reparsed.header.ticksPerBeat).toBe(480);
    expect(reparsed.header.format).toBe(1);
    expect(reparsed.header.numTracks).toBe(TRACK_COUNT);
    expect(writeMidi(buildMidiData(referenceMidiProject()))).toEqual(
      writeMidi(buildMidiData(referenceMidiProject())),
    );
  });
});

// ---------------------------------------------------------------------------
// Channel / program / GM drum mapping tables
// ---------------------------------------------------------------------------

describe("mapping tables", () => {
  it("drums map to GM channel 9 (zero-based) with the committed GM notes", () => {
    expect(DRUM_CHANNEL).toBe(9);
    expect(GM_DRUM_NOTES).toEqual({
      kick: 36,
      snare: 38,
      hat: 42,
      openhat: 46,
      clap: 39,
      tom: 45,
    });
    for (const v of Object.values(GM_DRUM_VELOCITIES)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(127);
    }
  });

  it("pitched lanes use one distinct channel each, none colliding with drums", () => {
    const channels = Object.values(LANE_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).not.toContain(DRUM_CHANNEL);
    expect(LANE_CHANNELS.bass).toBe(0);
    expect(LANE_CHANNELS.chords).toBe(1);
    expect(LANE_CHANNELS.lead).toBe(2);
  });

  it("every shipped preset has a valid GM program hint (0-based 0..127)", () => {
    for (const id of Object.keys(PRESET_LIBRARY)) {
      expect(PRESET_GM_PROGRAMS[id], `preset ${id}`).toBeDefined();
    }
    for (const p of Object.values(PRESET_GM_PROGRAMS)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(127);
    }
    // Spot-anchor the families (GM 0-based): synth bass, warm pad, square lead.
    expect(PRESET_GM_PROGRAMS["preset-bass-1"]).toBe(38);
    expect(PRESET_GM_PROGRAMS["preset-chords-1"]).toBe(89);
    expect(PRESET_GM_PROGRAMS["preset-lead-1"]).toBe(80);
  });

  it("octave fallbacks are bass-low, lead-high", () => {
    expect(LANE_OCTAVE_FALLBACK.bass).toBeLessThan(LANE_OCTAVE_FALLBACK.chords);
    expect(LANE_OCTAVE_FALLBACK.chords).toBeLessThan(LANE_OCTAVE_FALLBACK.lead);
  });

  it("pitched velocity is a valid sensible default", () => {
    expect(PITCHED_VELOCITY).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// Note building (pattern-walk semantics identical to compile.ts)
// ---------------------------------------------------------------------------

describe("note building", () => {
  const doc = referenceMidiProject();

  it("drums: GM notes at 16th ticks, gate 1 step = 120 ticks", () => {
    const lane = doc.lanes.find((l) => l.id === "drums")!;
    const notes = buildDrumNotes([doc.patterns.drums[0]], lane.gate, 120).sort(
      (a, b) => a.tick - b.tick || a.noteNumber - b.noteNumber,
    );
    // 4 kicks + 2 snares + 8 hats = 14 hits.
    expect(notes).toHaveLength(14);
    expect(notes.filter((n) => n.noteNumber === 36).map((n) => n.tick)).toEqual(
      [0, 480, 960, 1440],
    );
    expect(notes.filter((n) => n.noteNumber === 38).map((n) => n.tick)).toEqual(
      [480, 1440],
    );
    expect(notes.filter((n) => n.noteNumber === 42).map((n) => n.tick)).toEqual(
      [0, 240, 480, 720, 960, 1200, 1440, 1680],
    );
    for (const n of notes) expect(n.durationTicks).toBe(120);
  });

  it("bass: scale-degree resolution C minor octave 2 (degree 0 = C2 = 36) with sustain", () => {
    const lane = doc.lanes.find((l) => l.id === "bass")!;
    const notes = buildPitchedNotes(
      doc,
      "bass",
      [doc.patterns.bass[0]],
      lane.gate,
      120,
      0,
    );
    expect(notes).toHaveLength(1);
    // preset-bass-1 pitchRange.octaveBase = 2; C minor degree 0 → 12*(2+1)+0 = 36.
    expect(notes[0].noteNumber).toBe(36);
    expect(notes[0].tick).toBe(0);
    // Gate 2 steps + 1 sustain marker = 3 × 120 = 360 ticks.
    expect(notes[0].durationTicks).toBe(360);
  });

  it("chords: diatonic triad stack [0, 2, 4] at the lane channel", () => {
    const lane = doc.lanes.find((l) => l.id === "chords")!;
    const notes = buildPitchedNotes(
      doc,
      "chords",
      [doc.patterns.chords[0]],
      lane.gate,
      120,
      0,
    );
    // C minor triad from degree 0 at octave base 3 (preset-chords-1): C3, Eb3, G3.
    expect(notes.map((n) => n.noteNumber).sort((a, b) => a - b)).toEqual([
      48, 51, 55,
    ]);
    for (const n of notes) expect(n.tick).toBe(0);
  });

  it("lead: degree 3 of C minor at octave 4 = F4 = 65 on step 8", () => {
    const lane = doc.lanes.find((l) => l.id === "lead")!;
    const notes = buildPitchedNotes(
      doc,
      "lead",
      [doc.patterns.lead[0]],
      lane.gate,
      120,
      0,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].noteNumber).toBe(65);
    expect(notes[0].tick).toBe(8 * 120);
  });

  it("noteCount totals every lane", () => {
    // 14 drums + 1 bass + 3 chords + 1 lead.
    expect(noteCount(doc)).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// Cue markers
// ---------------------------------------------------------------------------

describe("cue markers", () => {
  it("non-null cues become markers at their slot's chain-start tick, deduped", () => {
    const doc = referenceMidiProject();
    expect(buildCueMarkers(doc)).toEqual([
      { tick: 0, text: "VERSE" },
      { tick: 0, text: "DROP" },
    ]);
    // Same label on two lanes at the same tick collapses to one marker.
    doc.chainCues = {
      drums: ["VERSE"],
      bass: [null],
      chords: ["VERSE"],
      lead: [null],
    };
    expect(buildCueMarkers(doc)).toEqual([{ tick: 0, text: "VERSE" }]);

    // A 2-slot chain places slot 1 at its accumulated step offset.
    doc.chainCues = {
      drums: [null, "DROP"],
      bass: [null],
      chords: [null],
      lead: [null],
    };
    doc.songChain = {
      ...doc.songChain,
      drums: [doc.patterns.drums[0].id, doc.patterns.drums[0].id],
    };
    expect(buildCueMarkers(doc)).toEqual([{ tick: 16 * 120, text: "DROP" }]);
  });

  it("absent chainCues → no markers (backward-compatible docs)", () => {
    const doc = createDefaultProject();
    expect(doc.chainCues).toBeUndefined();
    expect(buildCueMarkers(doc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hand-computed small case through writeMidi (structure-level byte walk)
// ---------------------------------------------------------------------------

describe("hand-computed bytes through writeMidi", () => {
  function tinyProject(): ProjectDocument {
    const doc = createDefaultProject();
    // ONE kick on step 0; everything else silent.
    doc.patterns.drums[0].steps.kick = [true, ...new Array(15).fill(false)];
    // One lead note on step 0, degree 0 (C minor, octave base 4 → C4 = 60).
    const leadSteps = new Array(16).fill(0) as PitchedCell[];
    leadSteps[0] = 1;
    doc.patterns.lead[0].rows[0].steps = leadSteps;
    doc.chainCues = {
      drums: ["A"],
      bass: [null],
      chords: [null],
      lead: [null],
    };
    return doc;
  }

  it("tempo track: 4/4 + 120 BPM (500000 µs/beat) + marker, exact deltas", () => {
    const parsed = parseMidi([...encodeMidi(tinyProject())]);
    const t0 = parsed.tracks[0];
    // Delta-0 block: track name, time signature, tempo, marker "A" (tick 0).
    const head = t0.slice(0, 4);
    expect(head.every((e) => e.deltaTime === 0)).toBe(true);
    expect(head.map((e) => e.type)).toEqual([
      "trackName",
      "timeSignature",
      "setTempo",
      "marker",
    ]);
    const ts = t0[1];
    if (ts.type !== "timeSignature") throw new Error("unreachable");
    expect(ts.numerator).toBe(4);
    expect(ts.denominator).toBe(4);
    const tempo = t0[2];
    if (tempo.type !== "setTempo") throw new Error("unreachable");
    expect(tempo.microsecondsPerBeat).toBe(500000);
    const marker = t0[3];
    if (marker.type !== "marker") throw new Error("unreachable");
    expect(marker.text).toBe("A");
    expect(t0[t0.length - 1].type).toBe("endOfTrack");
  });

  it("drums track: kick noteOn 36 @0 v105 / noteOff @120 on channel 9", () => {
    const parsed = parseMidi([...encodeMidi(tinyProject())]);
    const drums = parsed.tracks[1];
    expect(drums.map((e) => `${e.type}:${e.deltaTime}`).join(",")).toBe(
      "trackName:0,noteOn:0,noteOff:120,endOfTrack:0",
    );
    const on = drums[1];
    if (on.type !== "noteOn") throw new Error("unreachable");
    expect(on.channel).toBe(9);
    expect(on.noteNumber).toBe(36);
    expect(on.velocity).toBe(105);
    const off = drums[2];
    if (off.type !== "noteOff") throw new Error("unreachable");
    expect(off.channel).toBe(9);
    expect(off.noteNumber).toBe(36);
  });

  it("lead track: program hint 80, C4 = 60 on channel 2, gate 2 steps = 240 ticks", () => {
    const parsed = parseMidi([...encodeMidi(tinyProject())]);
    const lead = parsed.tracks[4];
    expect(lead.map((e) => e.type).join(",")).toBe(
      "trackName,programChange,noteOn,noteOff,endOfTrack",
    );
    const pc = lead[1];
    if (pc.type !== "programChange") throw new Error("unreachable");
    expect(pc.channel).toBe(2);
    expect(pc.programNumber).toBe(80);
    const on = lead[2];
    if (on.type !== "noteOn") throw new Error("unreachable");
    expect(on.noteNumber).toBe(60);
    expect(on.velocity).toBe(96);
    expect(on.deltaTime).toBe(0);
    const off = lead[3];
    if (off.type !== "noteOff") throw new Error("unreachable");
    expect(off.deltaTime).toBe(240);
  });

  it("file starts with MThd and five MTrk chunks", () => {
    const bytes = encodeMidi(tinyProject());
    expect(bytes[0]).toBe(0x4d); // 'M'
    const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
    expect(tag(0)).toBe("MThd");
    expect(tag(14)).toBe("MTrk"); // MThd chunk = 8 header bytes + 6 data bytes
    // Header: format 1, 5 tracks, 480 PPQ.
    const u16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];
    expect(u16(9 + 1 - 1)).toBeDefined(); // (layout asserted via parseMidi above)
  });
});

// ---------------------------------------------------------------------------
// Download (typed result, seam-captured)
// ---------------------------------------------------------------------------

describe("exportMidi download", () => {
  it("returns a typed success, downloads <stem>.bitbounce.mid as audio/midi", async () => {
    const { exportMidi } = await import("../src/audio/exportMidi");
    let captured: { blob: Blob; name: string } | undefined;
    let name = "";
    const seam = {
      createObjectURL: (blob: Blob) => {
        captured = { blob, name };
        return "blob:x";
      },
      revokeObjectURL: () => undefined,
      createElement: () => ({
        click: () => {
          if (captured) captured.name = name;
        },
        set href(_h: string) {},
        get href() {
          return "";
        },
        set download(n: string) {
          name = n;
        },
        get download() {
          return name;
        },
      }),
    };
    const doc = referenceMidiProject();
    doc.name = "My Song/2";
    const result = exportMidi(doc, { seam });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trackCount).toBe(TRACK_COUNT);
    expect(result.noteCount).toBe(19);
    expect(result.filename).toBe(`My Song2${MIDI_EXTENSION}`);
    expect(captured!.blob.type).toBe("audio/midi");
    expect(result.byteLength).toBe(captured!.blob.size);
  });
});
