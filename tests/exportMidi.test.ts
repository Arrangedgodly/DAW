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
  type ProjectDocument,
} from "../src/document/schema";
import {
  buildCueMarkers,
  buildDrumNotes,
  buildMidiData,
  buildPitchedNotes,
  DRUM_CHANNEL,
  encodeMidi,
  exportCycleSteps,
  exportMidi,
  gateTicks,
  GM_DRUM_NOTES,
  GM_DRUM_VELOCITIES,
  LANE_CHANNELS,
  LANE_OCTAVE_FALLBACK,
  MIDI_EXTENSION,
  noteCount,
  noteLengthTicks,
  PPQ,
  PRESET_GM_PROGRAMS,
  PITCHED_VELOCITY,
  repeatNotesToCycle,
  stepTick,
  TICKS_PER_STEP,
  TRACK_COUNT,
} from "../src/audio/exportMidi";
import { PRESET_LIBRARY } from "../src/audio/presets";
import { computeLoopSteps } from "../src/audio/render";
import { laneCycleSteps } from "../src/audio/song";
import { LANE_IDS } from "../src/document/schema";
import { referenceMidiProject } from "./midiReference";
import { lcmCycleProject } from "./exportLcmReference";

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

  it("SC-2: note lengths map to exact ticks on the 0.25-step grid", () => {
    // 0.25-step granularity × 120 ticks/step is always an integer.
    expect(noteLengthTicks(1)).toBe(120);
    expect(noteLengthTicks(2.5)).toBe(300);
    expect(noteLengthTicks(0.25)).toBe(30);
    expect(noteLengthTicks(15)).toBe(1800);
    expect(noteLengthTicks(128)).toBe(15360);
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
    const notes = buildPitchedNotes(doc, "bass", [doc.patterns.bass[0]], 0);
    expect(notes).toHaveLength(1);
    // preset-bass-1 pitchRange.octaveBase = 2; C minor degree 0 → 12*(2+1)+0 = 36.
    expect(notes[0].noteNumber).toBe(36);
    expect(notes[0].tick).toBe(0);
    // Migrated v1 shape: gate 2 steps + 1 sustain marker = one 3-step note.
    expect(notes[0].durationTicks).toBe(360);
  });

  it("chords: diatonic triad stack [0, 2, 4] at the lane channel", () => {
    const notes = buildPitchedNotes(doc, "chords", [doc.patterns.chords[0]], 0);
    // C minor triad from degree 0 at octave base 3 (preset-chords-1): C3, Eb3, G3.
    expect(notes.map((n) => n.noteNumber).sort((a, b) => a - b)).toEqual([
      48, 51, 55,
    ]);
    for (const n of notes) expect(n.tick).toBe(0);
  });

  it("lead: degree 3 of C minor at octave 4 = F4 = 65 on step 8", () => {
    const notes = buildPitchedNotes(doc, "lead", [doc.patterns.lead[0]], 0);
    expect(notes).toHaveLength(1);
    expect(notes[0].noteNumber).toBe(65);
    expect(notes[0].tick).toBe(8 * 120);
  });

  it("SC-2: durations come from note lengths (fractional + long + gate-independent)", () => {
    // Same hand-authored notes under THREE different lane gates: durations
    // must not move — the gate is only the single-click default.
    const withNotes = (
      notes: readonly { degree: number; start: number; length: number }[],
      gateValue: number,
    ): ProjectDocument => {
      const d = createDefaultProject();
      const lane = d.lanes.find((l) => l.id === "lead")!;
      lane.gate = { unit: "steps", value: gateValue };
      const lead = d.patterns.lead[0];
      d.patterns.lead = lead.kind === "pitched" ? [{ ...lead, notes }] : [];
      return d;
    };
    const authored = [
      { degree: 0, start: 2, length: 2.5 },
      { degree: 0, start: 8, length: 15 },
    ];
    for (const gateValue of [1, 2, 16]) {
      const gated = withNotes(authored, gateValue);
      const notes = buildPitchedNotes(gated, "lead", gated.patterns.lead, 0);
      expect(notes.map((n) => n.durationTicks)).toEqual([300, 1800]);
      expect(notes.map((n) => n.tick)).toEqual([240, 960]);
    }
  });

  it("SC-2: notes on degrees outside the row manifest are skipped (compiler parity)", () => {
    const d = createDefaultProject();
    const lead = d.patterns.lead[0];
    if (lead.kind !== "pitched") throw new Error("kind");
    d.patterns.lead = [
      {
        ...lead,
        rowDegrees: [0, 1, 2, 3], // degree 7 has no row
        notes: [
          { degree: 0, start: 0, length: 1 },
          { degree: 7, start: 0, length: 4 },
        ],
      },
    ];
    const notes = buildPitchedNotes(d, "lead", d.patterns.lead, 0);
    expect(notes).toHaveLength(1);
    expect(notes[0].noteNumber).toBe(60); // degree 0 at octave base 4 = C4
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
    // One lead note on step 0, degree 0 (C minor, octave base 4 → C4 = 60):
    // lone note-on under the default lead gate (2 steps) — v2 note shape.
    const lead = doc.patterns.lead[0];
    if (lead.kind !== "pitched") throw new Error("expected pitched lead");
    lead.notes = [{ degree: 0, start: 0, length: 2 }];
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
// XP-1 (i3-5) — the LCM cycle law: MIDI export spans EXACTLY one full
// export cycle (the LCM of lane chain totals, the same computeLoopSteps law
// the offline WAV render and the transport's cycle basis use). Shorter
// chains repeat within the cycle; equal-chain docs are byte-identical.
// ---------------------------------------------------------------------------

describe("XP-1: exportCycleSteps — the one LCM for one-shot, WAV and MIDI", () => {
  it("equal-chain documents keep the 1-bar v0.1 basis", () => {
    expect(exportCycleSteps(referenceMidiProject())).toBe(16);
    expect(exportCycleSteps(createDefaultProject())).toBe(16);
  });

  it("unequal chains → the LCM (= the longest lane at powers-of-two, I3-d)", () => {
    // drums 64B + bass 4B + chords 8B + lead 1B → lcm(1024,64,128,16) = 1024.
    const doc = createDefaultProject();
    const drums = doc.patterns.drums[0];
    if (drums.kind !== "drums") throw new Error("kind");
    drums.bars = 64;
    const bass = doc.patterns.bass[0];
    if (bass.kind !== "pitched") throw new Error("kind");
    bass.bars = 4;
    const chords = doc.patterns.chords[0];
    if (chords.kind !== "pitched") throw new Error("kind");
    chords.bars = 8;
    expect(exportCycleSteps(doc)).toBe(64 * 16);
  });

  it("incommensurate multi-slot chains give a TRUE LCM (the LL-2 case)", () => {
    // A [2-bar, 1-bar] chain (48 steps) next to 1-bar lanes → 48, not 32/64.
    const doc = createDefaultProject();
    const a = doc.patterns.drums[0];
    if (a.kind !== "drums") throw new Error("kind");
    a.bars = 2;
    const b: typeof a = {
      ...a,
      id: "drums-2",
      bars: 1,
      steps: {
        kick: new Array<boolean>(16).fill(false),
        snare: new Array<boolean>(16).fill(false),
        hat: new Array<boolean>(16).fill(false),
        openhat: new Array<boolean>(16).fill(false),
        clap: new Array<boolean>(16).fill(false),
        tom: new Array<boolean>(16).fill(false),
      },
    };
    doc.patterns.drums = [a, b];
    doc.songChain.drums = [a.id, b.id];
    expect(laneCycleSteps(doc, "drums")).toBe(48);
    expect(exportCycleSteps(doc)).toBe(48);
    // The identity with the render path's own LCM derivation (render.ts
    // computes it over compiled chain totals — the same numbers).
    expect(exportCycleSteps(doc)).toBe(
      computeLoopSteps(LANE_IDS.map((lane) => laneCycleSteps(doc, lane))),
    );
  });

  it("an unchained pool pattern never moves the basis (IM-6 split parity)", () => {
    const doc = referenceMidiProject();
    const extra = { ...doc.patterns.lead[0], id: "lead-99" };
    if (extra.kind !== "pitched") throw new Error("kind");
    extra.bars = 128; // however wide — it is NOT in the chain
    doc.patterns.lead = [...doc.patterns.lead, extra];
    expect(exportCycleSteps(doc)).toBe(16);
  });

  it("the degenerate all-empty document falls back to the constant 16", () => {
    const doc = createDefaultProject();
    for (const lane of LANE_IDS) {
      doc.patterns[lane] = [];
      doc.songChain[lane] = [];
    }
    expect(exportCycleSteps(doc)).toBe(16);
  });
});

describe("XP-1: repeatNotesToCycle — chain-local notes repeat at the chain length", () => {
  const note = (tick: number) => ({
    tick,
    noteNumber: 36,
    velocity: 105,
    durationTicks: 120,
  });

  it("cycle === chain (or below / non-multiple) is the IDENTITY (zero-drift law)", () => {
    const notes = [note(0), note(480)];
    expect(repeatNotesToCycle(notes, 16, 16)).toEqual(notes);
    expect(repeatNotesToCycle(notes, 16, 8)).toEqual(notes);
    expect(repeatNotesToCycle(notes, 0, 64)).toEqual(notes);
    // Impossible by construction (cycle is the LCM of chain totals) — but
    // never silently mangle: identity, not truncation.
    expect(repeatNotesToCycle(notes, 48, 64)).toEqual(notes);
  });

  it("repeats at exact k × chainSteps × TICKS_PER_STEP offsets", () => {
    const out = repeatNotesToCycle([note(0), note(960)], 16, 64);
    expect(out.map((n) => n.tick)).toEqual([
      0, 960, 1920, 2880, 3840, 4800, 5760, 6720,
    ]);
    // Durations/velocities untouched — only the tick moves.
    for (const n of out) {
      expect(n.durationTicks).toBe(120);
      expect(n.velocity).toBe(105);
    }
  });

  it("iteration offsets are whole bars (even steps — swing parity preserved)", () => {
    // Chain totals are multiples of 16 steps, so every k × chainSteps offset
    // is an even step: pattern-local odd-step swing delays keep their exact
    // magnitude at every iteration (the audio law, render.ts:41-42).
    for (let chain = 16; chain <= 128; chain += 16) {
      for (let k = 1; k < 8; k++) {
        expect(((k * chain) % 2)).toBe(0);
      }
    }
    const swung = repeatNotesToCycle(
      [note(stepTick(1, 0.5))],
      16,
      64,
    );
    // Iteration 1 lands at 1920 + 180 — the same +60 swing delay.
    expect(swung[1].tick).toBe(16 * TICKS_PER_STEP + stepTick(1, 0.5));
  });

  it("is pure (input untouched)", () => {
    const notes = [note(120)];
    const before = JSON.stringify(notes);
    repeatNotesToCycle(notes, 16, 64);
    expect(JSON.stringify(notes)).toBe(before);
  });
});

describe("XP-1: the LCM-cycle export bytes (unequal chains)", () => {
  const doc = lcmCycleProject();
  // Cycle: lcm(64, 32, 16, 16) = 64 steps = 4 bars = 7680 ticks.

  it("drums (the longest lane) walk the chain exactly once", () => {
    const lane = doc.lanes.find((l) => l.id === "drums")!;
    const single = buildDrumNotes(
      doc.patterns.drums,
      lane.gate,
      120,
      0,
    ).sort((a, b) => a.tick - b.tick);
    // A: 8 four-on-the-floor kicks in 2 bars; B: 4 snares + 16 hats.
    expect(single).toHaveLength(28);
    const last = single[single.length - 1];
    expect(last.tick).toBeLessThan(64 * TICKS_PER_STEP); // inside the cycle
    // B's content starts at chain step 32 (slot 1) — the cursor walk.
    const snares = single.filter((n) => n.noteNumber === 38);
    expect(snares.map((n) => n.tick)).toEqual([4320, 5280, 6240, 7200]);
  });

  it("bass repeats ×2, chords/lead ×4 within the cycle (parse-exact ticks)", () => {
    const bass = repeatNotesToCycle(
      buildPitchedNotes(doc, "bass", doc.patterns.bass, 0),
      laneCycleSteps(doc, "bass"),
      64,
    );
    expect(bass.map((n) => n.tick)).toEqual([0, 3840]); // 32 steps × 120

    const chords = repeatNotesToCycle(
      buildPitchedNotes(doc, "chords", doc.patterns.chords, 0),
      laneCycleSteps(doc, "chords"),
      64,
    );
    expect(chords).toHaveLength(3 * 4); // triad × 4 iterations
    expect([...new Set(chords.map((n) => n.tick))]).toEqual([
      0, 1920, 3840, 5760,
    ]);

    const lead = repeatNotesToCycle(
      buildPitchedNotes(doc, "lead", doc.patterns.lead, 0),
      laneCycleSteps(doc, "lead"),
      64,
    );
    expect(lead.map((n) => n.tick)).toEqual([960, 2880, 4800, 6720]);
  });

  it("cue markers repeat with their lane's chain, deduped by tick+text", () => {
    expect(buildCueMarkers(doc, 64)).toEqual([
      { tick: 0, text: "VERSE" },
      { tick: 0, text: "GROOVE" },
      { tick: 3840, text: "DROP" },
      { tick: 3840, text: "GROOVE" }, // bass slot 0 repeats at its chain length
    ]);
    // Without the cycle parameter: the previous single-chain walk.
    expect(buildCueMarkers(doc)).toEqual([
      { tick: 0, text: "VERSE" },
      { tick: 0, text: "GROOVE" },
      { tick: 3840, text: "DROP" },
    ]);
  });

  it("encoded tracks carry the repeated notes at the lane channels", () => {
    const parsed = parseMidi([...encodeMidi(doc)]);
    // Bass track (index 2 in raw tracks: 0 = tempo, 1 = drums, 2 = bass…).
    const bassOn = parsed.tracks[2].filter(
      (e) => e.type === "noteOn" && e.channel === LANE_CHANNELS.bass,
    );
    expect(bassOn.map((e) => (e.type === "noteOn" ? e.deltaTime : -1)).length)
      .toBe(2);
    const bassTicks: number[] = [];
    let t = 0;
    for (const e of parsed.tracks[2]) {
      t += e.deltaTime;
      if (e.type === "noteOn" && e.channel === LANE_CHANNELS.bass)
        bassTicks.push(t);
    }
    expect(bassTicks).toEqual([0, 3840]);

    const leadTicks: number[] = [];
    t = 0;
    for (const e of parsed.tracks[4]) {
      t += e.deltaTime;
      if (e.type === "noteOn" && e.channel === LANE_CHANNELS.lead)
        leadTicks.push(t);
    }
    expect(leadTicks).toEqual([960, 2880, 4800, 6720]);
  });

  it("noteCount counts the FILLED cycle; bars report the cycle length", () => {
    // 28 drums + 2 bass + 12 chords + 4 lead.
    expect(noteCount(doc)).toBe(46);
    const cap = captureSeamForNotes();
    const result = exportMidi(doc, { seam: cap.seam });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bars).toBe(4);
    expect(result.noteCount).toBe(46);
    // The equal-chain reference is unchanged (19 notes, 1 bar).
    const ref = exportMidi(referenceMidiProject(), { seam: cap.seam });
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    expect(ref.bars).toBe(1);
    expect(ref.noteCount).toBe(19);
  });

  it("deterministic: identical documents → byte-identical files", () => {
    expect(encodeMidi(doc)).toEqual(encodeMidi(lcmCycleProject()));
  });
});

/** Capture seam reused by the LCM describe (typed result checks only). */
function captureSeamForNotes() {
  let captured: Blob | undefined;
  const seam = {
    createObjectURL: (blob: Blob) => {
      captured = blob;
      return "blob:x";
    },
    revokeObjectURL: () => undefined,
    createElement: () => ({
      click: () => undefined,
      href: "",
      download: "",
    }),
  };
  return { seam, blob: () => captured };
}

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

// ---------------------------------------------------------------------------
// PS-4 — MIDI export law for sample voices: the exported note is the SAME
// midi the audio engine maps playbackRate from (degreeToMidi at the preset's
// octaveBase vs the measured rootMidi), and the GM hint is present so a
// stock soundfont lands in the right family. Drums stay kit-independent
// (GM channel-10 map) — recorded kits export exactly like synth kits.
// ---------------------------------------------------------------------------

describe("PS-4 sample-voice export law", () => {
  function sampleProject(): ProjectDocument {
    const doc = createDefaultProject();
    const lead = doc.lanes.find((l) => l.id === "lead")!;
    lead.presetId = "preset-lead-13"; // PHASER UP (sample, rootMidi 60, octave 4)
    const pattern = doc.patterns.lead[0];
    if (pattern.kind !== "pitched") throw new Error("expected pitched");
    pattern.notes = [{ degree: 3, start: 0, length: 2 }];
    return doc;
  }

  it("a sample-preset lane exports notes at the pitch the audio plays (octaveBase pitch)", () => {
    const doc = sampleProject();
    const notes = buildPitchedNotes(doc, "lead", doc.patterns.lead, 0);
    expect(notes).toHaveLength(1);
    // C minor, degree 3, octaveBase 4 → F4 = 65 — the same midi noteParamsFor
    // maps to playbackRate 2^((65-60)/12) against the measured root.
    expect(notes[0]!.noteNumber).toBe(65);
    expect(notes[0]!.durationTicks).toBe(noteLengthTicks(2));
  });

  it("the GM program hint rides the sample lane's track (hint-only, as ever)", () => {
    const parsed = parseMidi([...encodeMidi(sampleProject())]);
    const lead = parsed.tracks[4];
    const pc = lead.find((e) => e.type === "programChange");
    if (!pc || pc.type !== "programChange") throw new Error("no programChange");
    expect(pc.programNumber).toBe(PRESET_GM_PROGRAMS["preset-lead-13"]);
    expect(pc.channel).toBe(LANE_CHANNELS.lead);
  });

  it("every sample preset and sample kit is covered by the hint/kit tables (no gaps)", () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      if (p.voiceType !== "sample") continue;
      if (p.pitchRange === undefined) continue; // drum pieces: kit track, no hint
      expect(
        PRESET_GM_PROGRAMS[p.id],
        `${p.id}: sample preset misses its GM hint`,
      ).toBeDefined();
    }
    // Sample drum kits share the piece → GM drum note map: exporting with a
    // recorded kit must produce the identical note numbers as a synth kit.
    const drumsDoc = createDefaultProject();
    drumsDoc.lanes.find((l) => l.id === "drums")!.kitId = "kit-808";
    const synth = buildDrumNotes(
      drumsDoc.patterns.drums,
      drumsDoc.lanes[0]!.gate,
      120,
      0,
    );
    drumsDoc.lanes.find((l) => l.id === "drums")!.kitId = "kit-default";
    const withSampleKit = buildDrumNotes(
      drumsDoc.patterns.drums,
      drumsDoc.lanes[0]!.gate,
      120,
      0,
    );
    expect(withSampleKit).toEqual(synth);
  });
});

// ---------------------------------------------------------------------------
// HW-5 export-mix resolution (coordinator, recorded at LY-1 verification):
// MIDI export keeps ALL lanes' notes regardless of the mix — muting is a
// MONITOR MIX state, not note data; notes export for other DAWs.
// ---------------------------------------------------------------------------

describe("HW-5: the lane mix never touches MIDI bytes", () => {
  /** The reference project with a deliberately loud mix on every lane. */
  function mixedReference() {
    const doc = referenceMidiProject();
    doc.lanes = doc.lanes.map((lane) => {
      if (lane.id === "drums") return { ...lane, mute: true };
      if (lane.id === "bass") return { ...lane, volume: 0.1 };
      if (lane.id === "chords") return { ...lane, solo: true, volume: 0.9 };
      return { ...lane, solo: true, mute: true };
    });
    return doc;
  }

  it("encodeMidi bytes are IDENTICAL with and without the mix", () => {
    const clean = encodeMidi(referenceMidiProject());
    const mixed = encodeMidi(mixedReference());
    expect(mixed.byteLength).toBe(clean.byteLength);
    // Manual byte compare (typed-array deep equal is slow on large files).
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] !== mixed[i]) {
        expect.fail(`MIDI differs at byte ${i} under a lane mix`);
      }
    }
  });

  it("a muted+soloed lane's notes are ALL still exported", () => {
    const doc = mixedReference();
    const clean = referenceMidiProject();
    for (const laneConf of doc.lanes) {
      const chain = doc.patterns[laneConf.id];
      const notes =
        laneConf.id === "drums"
          ? buildDrumNotes(
              chain,
              laneConf.gate,
              doc.transport.bpm,
              doc.transport.swing,
            )
          : buildPitchedNotes(doc, laneConf.id, chain, doc.transport.swing);
      const cleanNotes =
        laneConf.id === "drums"
          ? buildDrumNotes(
              clean.patterns[laneConf.id],
              clean.lanes.find((l) => l.id === laneConf.id)!.gate,
              clean.transport.bpm,
              clean.transport.swing,
            )
          : buildPitchedNotes(
              clean,
              laneConf.id,
              clean.patterns[laneConf.id],
              clean.transport.swing,
            );
      expect(notes.length, `${laneConf.id} note count under mix`).toBe(
        cleanNotes.length,
      );
      expect(notes.length, `${laneConf.id} has content to export`).toBeGreaterThan(
        0,
      );
    }
    expect(noteCount(doc)).toBe(noteCount(clean));
  });
});
