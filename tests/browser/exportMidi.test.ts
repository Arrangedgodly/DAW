/**
 * MF-5 browser tests — dev-only parse-back diligence (Mr. Fantastic: the
 * file must import correctly into OTHER DAWs).
 *
 * Exports the reference project through the REAL encode + download seam,
 * then parses the downloaded bytes back with @tonejs/midi (the dev-only
 * dependency committed by RES-5b — a completely independent parser from our
 * writer) and asserts the structural contract:
 *   format 1; 5 tracks (tempo/cue + 4 lanes); tempo = project BPM; drums on
 *   channel 9 (zero-based) with GM note numbers at exact 16th ticks
 *   (16th = PPQ/4 = 120 ticks at PPQ 480); pitched pitches equal the expected
 *   scale-degree resolution; durations come from note lengths (SC-2: exact on
 *   the 0.25-step grid — parse-back equality); cue markers survive as marker
 *   meta events (asserted via midi-file's parseMidi, the runtime dep, since
 *   @tonejs/midi folds meta differently).
 */

import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { parseMidi } from "midi-file";
import {
  exportMidi,
  PPQ,
  TICKS_PER_STEP,
} from "../../src/audio/exportMidi";
import type { DownloadSeam } from "../../src/persist/fileIO";
import { referenceMidiProject } from "../midiReference";
import { wideUnequalChainProject } from "../exportLcmReference";

function captureSeam(): { seam: DownloadSeam; blob: () => Blob | undefined } {
  let captured: Blob | undefined;
  const seam: DownloadSeam = {
    createObjectURL: (blob) => {
      captured = blob;
      return "blob:captured";
    },
    revokeObjectURL: () => undefined,
    createElement: () => ({ click: () => undefined, href: "", download: "" }),
  };
  return { seam, blob: () => captured };
}

describe("MF-5 MIDI export — third-party parse-back (@tonejs/midi)", () => {
  it("exports a format-1 file: 5 tracks, project tempo, 4/4, PPQ 480", async () => {
    const cap = captureSeam();
    const result = exportMidi(referenceMidiProject(), { seam: cap.seam });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trackCount).toBe(5);
    expect(result.noteCount).toBe(19);

    const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
    expect(cap.blob()!.type).toBe("audio/midi");
    expect(result.filename).toBe(`Untitled.bitbounce.mid`);

    // Raw structure (midi-file parse-back — same framing lib, but the bytes
    // are the bytes): format 1, 5 tracks, 480 ticks per quarter.
    const raw = parseMidi([...bytes]);
    expect(raw.header.format).toBe(1);
    expect(raw.header.numTracks).toBe(5);
    expect(raw.header.ticksPerBeat).toBe(PPQ);

    // Independent parse (tonejs): tempo + time signature are folded into the
    // header; a format-1 file's EMPTY tempo track is shifted off midi.tracks
    // (verified against tonejs/Midi.js), leaving exactly the 4 lane tracks.
    const midi = new Midi(bytes.slice().buffer);
    expect(midi.header.tempos).toHaveLength(1);
    expect(midi.header.tempos[0].bpm).toBeCloseTo(120, 2);
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([4, 4]);
    expect(midi.header.ppq).toBe(PPQ);
    expect(midi.tracks).toHaveLength(4);
    expect(midi.tracks.map((t) => t.name)).toEqual([
      "DRUMS",
      "BASS",
      "CHORDS",
      "LEAD",
    ]);
  });

  it("drums land on channel 9 with GM note numbers at exact 16th ticks", async () => {
    const cap = captureSeam();
    exportMidi(referenceMidiProject(), { seam: cap.seam });
    const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
    const midi = new Midi(bytes.slice().buffer);

    const drums = midi.tracks[0]; // tempo track shifted off
    expect(drums.channel).toBe(9); // zero-based wire channel = GM "channel 10"
    expect(drums.name).toBe("DRUMS");
    expect(drums.notes).toHaveLength(14); // 4 kicks + 2 snares + 8 hats

    const kicks = drums.notes.filter((n) => n.midi === 36);
    expect(kicks.map((n) => n.ticks)).toEqual(
      [0, 4, 8, 12].map((s) => s * TICKS_PER_STEP),
    );
    expect(kicks[0].velocity).toBeCloseTo(105 / 127, 4);
    expect(kicks[0].durationTicks).toBe(TICKS_PER_STEP); // gate 1 step

    const snares = drums.notes.filter((n) => n.midi === 38);
    expect(snares.map((n) => n.ticks)).toEqual(
      [4, 12].map((s) => s * TICKS_PER_STEP),
    );

    const hats = drums.notes.filter((n) => n.midi === 42);
    expect(hats).toHaveLength(8);
    expect(hats[1].ticks).toBe(2 * TICKS_PER_STEP);
  });

  it("pitched notes match scale-degree resolution; durations from gates+sustain", async () => {
    const cap = captureSeam();
    exportMidi(referenceMidiProject(), { seam: cap.seam });
    const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
    const midi = new Midi(bytes.slice().buffer);

    // Bass: channel 0, program hint 38 (Synth Bass 1), C2=36 @0, duration
    // gate 2 steps + 1 sustain marker = 360 ticks.
    const bass = midi.tracks[1];
    expect(bass.channel).toBe(0);
    expect(bass.instrument.number).toBe(38);
    expect(bass.notes).toHaveLength(1);
    expect(bass.notes[0].midi).toBe(36);
    expect(bass.notes[0].ticks).toBe(0);
    expect(bass.notes[0].durationTicks).toBe(3 * TICKS_PER_STEP);

    // Chords: channel 1, C-minor triad C3/Eb3/G3 stacked on the downbeat.
    const chords = midi.tracks[2];
    expect(chords.channel).toBe(1);
    expect(chords.notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([
      48, 51, 55,
    ]);
    for (const n of chords.notes) expect(n.ticks).toBe(0);

    // Lead: channel 2, program 80 (square lead), degree 3 of C minor at
    // octave 4 = F4 = 65, on step 8, gate 2 steps.
    const lead = midi.tracks[3];
    expect(lead.channel).toBe(2);
    expect(lead.instrument.number).toBe(80);
    expect(lead.notes).toHaveLength(1);
    expect(lead.notes[0].midi).toBe(65);
    expect(lead.notes[0].ticks).toBe(8 * TICKS_PER_STEP);
    expect(lead.notes[0].durationTicks).toBe(2 * TICKS_PER_STEP);
    expect(lead.notes[0].velocity).toBeCloseTo(96 / 127, 4);
  });

  it("SC-2: parse-back durations EQUAL note lengths (fractional + sustained)", async () => {
    // A hand-authored v2 project: fractional 0.25-grid lengths, a long
    // sustained note running past its neighbors, a chords-lane triad. The
    // independent parser must read back exactly length × TICKS_PER_STEP.
    const doc = referenceMidiProject();
    const withNotes = (
      lane: "bass" | "chords" | "lead",
      notes: readonly { degree: number; start: number; length: number }[],
    ) => {
      doc.patterns[lane] = doc.patterns[lane].map((p) =>
        p.kind === "pitched" ? { ...p, notes } : p,
      );
    };
    withNotes("bass", [
      { degree: 0, start: 0, length: 2.5 },
      { degree: 0, start: 8, length: 15 },
    ]);
    withNotes("chords", [{ degree: 0, start: 0, length: 12 }]);
    withNotes("lead", [{ degree: 3, start: 4, length: 0.25 }]);

    const cap = captureSeam();
    const result = exportMidi(doc, { seam: cap.seam });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
    const midi = new Midi(bytes.slice().buffer);

    const bass = midi.tracks[1].notes.sort((a, b) => a.ticks - b.ticks);
    expect(bass.map((n) => n.durationTicks)).toEqual([
      2.5 * TICKS_PER_STEP,
      15 * TICKS_PER_STEP,
    ]);
    for (const n of midi.tracks[2].notes)
      expect(n.durationTicks).toBe(12 * TICKS_PER_STEP);
    expect(midi.tracks[3].notes[0].durationTicks).toBe(0.25 * TICKS_PER_STEP);
  });

  it("cue markers survive as marker meta events in track 0", async () => {
    const cap = captureSeam();
    exportMidi(referenceMidiProject(), { seam: cap.seam });
    const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());

    // Markers asserted on the raw event list (tonejs folds meta text).
    const raw = parseMidi([...bytes]);
    const markers = raw.tracks[0].filter((e) => e.type === "marker");
    expect(markers.map((e) => (e.type === "marker" ? e.text : ""))).toEqual([
      "VERSE",
      "DROP",
    ]);
    for (const m of markers) expect(m.deltaTime).toBe(0); // slot 0 = tick 0
  });

  // XP-1 (i3-5): the MIDI file spans EXACTLY one full LCM cycle — the same
  // cycle the WAV export renders (drums 64B + bass 4B + chords 8B → 64
  // bars). Parse-back with the independent parser: every lane's content
  // repeats at its own chain length within the cycle and reaches into the
  // FINAL chain iteration; the toast reports the cycle bars.
  it("XP-1: unequal chains — one LCM cycle, every lane spans it (64 bars)", async () => {
    const doc = wideUnequalChainProject();
    const cap = captureSeam();
    const result = exportMidi(doc, { seam: cap.seam });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const CYCLE_BARS = 64;
    const CYCLE_TICKS = CYCLE_BARS * 16 * TICKS_PER_STEP; // 122,880
    expect(result.bars).toBe(CYCLE_BARS); // the toast's cycle-bar count

    const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
    const midi = new Midi(bytes.slice().buffer);
    expect(midi.header.ppq).toBe(PPQ);
    expect(midi.tracks).toHaveLength(4);

    // Drums (64-bar chain): 1 iteration — a kick on every beat 0 of every
    // bar through the whole cycle, so its last hit reaches bar 63.
    const drums = midi.tracks[0];
    const kicks = drums.notes.filter((n) => n.midi === 36);
    expect(kicks).toHaveLength(CYCLE_BARS * 4); // four-on-the-floor × 64
    // Last kick: step 1020 (bar 63, beat 3) — four steps before the cycle end.
    expect(kicks[kicks.length - 1].ticks).toBe(CYCLE_TICKS - 4 * TICKS_PER_STEP);

    // Bass (4-bar chain → ×16 iterations at exact k × 7680-tick offsets).
    const bass = midi.tracks[1].notes.sort((a, b) => a.ticks - b.ticks);
    expect(bass).toHaveLength(16);
    expect(bass.map((n) => n.ticks)).toEqual(
      Array.from({ length: 16 }, (_, k) => k * 4 * 16 * TICKS_PER_STEP),
    );
    // Chords (8-bar chain → ×8 iterations, triads).
    const chords = midi.tracks[2].notes;
    expect(chords).toHaveLength(8 * 3);
    expect(Math.max(...chords.map((n) => n.ticks))).toBe(7 * 8 * 16 * TICKS_PER_STEP);
    // Lead (1-bar chain → ×64 iterations).
    const lead = midi.tracks[3].notes;
    expect(lead).toHaveLength(64);

    // Track durations = the full cycle: every content lane's last note
    // lands inside the FINAL chain iteration (a lane-local export — the
    // pre-XP-1 shape — would stop at its own chain end).
    const lastTick = (notes: { ticks: number }[]) =>
      Math.max(...notes.map((n) => n.ticks));
    expect(lastTick(bass)).toBe(CYCLE_TICKS - 4 * 16 * TICKS_PER_STEP);
    expect(lastTick(chords)).toBe(CYCLE_TICKS - 8 * 16 * TICKS_PER_STEP);
    expect(lastTick(lead)).toBe(CYCLE_TICKS - 1 * 16 * TICKS_PER_STEP);
    // Last drum event: the final hat at step 1022 — two steps shy of the end.
    expect(lastTick(drums.notes)).toBe(CYCLE_TICKS - 2 * TICKS_PER_STEP);
  });
});
