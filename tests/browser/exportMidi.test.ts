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
 *   scale-degree resolution; durations come from gates (+ sustain markers);
 *   cue markers survive as marker meta events (asserted via midi-file's
 *   parseMidi, the runtime dep, since @tonejs/midi folds meta differently).
 */

import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { parseMidi } from "midi-file";
import { exportMidi, PPQ, TICKS_PER_STEP } from "../../src/audio/exportMidi";
import type { DownloadSeam } from "../../src/persist/fileIO";
import { referenceMidiProject } from "../midiReference";

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
    expect(midi.tracks.map((t) => t.name)).toEqual(["DRUMS", "BASS", "CHORDS", "LEAD"]);
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
    expect(kicks.map((n) => n.ticks)).toEqual([0, 4, 8, 12].map((s) => s * TICKS_PER_STEP));
    expect(kicks[0].velocity).toBeCloseTo(105 / 127, 4);
    expect(kicks[0].durationTicks).toBe(TICKS_PER_STEP); // gate 1 step

    const snares = drums.notes.filter((n) => n.midi === 38);
    expect(snares.map((n) => n.ticks)).toEqual([4, 12].map((s) => s * TICKS_PER_STEP));

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
    expect(chords.notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([48, 51, 55]);
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
});
