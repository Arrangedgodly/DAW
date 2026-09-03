import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";
import {
  getDrumKit,
  getPreset,
  type VoiceNoteOnEvent,
} from "../src/audio/presets";
import { EventOutbox, type VoiceEngineHost } from "../src/audio/voiceEngine";
import type { AudioContextLike } from "../src/audio/context";

function fakeCtx(): AudioContextLike {
  return {
    currentTime: 10,
    sampleRate: 44100,
    state: "running",
    resume: async () => {},
  };
}

/** Duck-typed AudioEngineContext: everything Session touches at runtime. */
function fakeEngine(): never {
  return {
    getContext: () => fakeCtx(),
    unlock: async () => {},
  } as never;
}

function auditionSession() {
  const sent: VoiceNoteOnEvent[][] = [];
  const host: VoiceEngineHost = {
    outbox: new EventOutbox(4),
    sendEvents: (_lane, events) => {
      sent.push([...events]);
    },
    connect: () => {},
    allOff: () => {},
    dispose: () => {},
  };
  const session = new Session({
    engine: fakeEngine(),
    createVoiceEngineHost: async () => host,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });
  return { session, sent };
}

describe("Session.audition", () => {
  it("pitched: triggers one voice at now+30ms with the lane preset", async () => {
    const { session, sent } = auditionSession();
    await session.audition("bass", 4);
    expect(sent.length).toBe(1);
    const [ev] = sent[0];
    expect(ev.time).toBeCloseTo(10.03, 9);
    expect(ev.type).toBe("note-on");
    expect(ev.wave).toBe(0); // preset-bass-1 is a pulse
    // degree 4 of C minor at octaveBase 2
    expect(ev.freq).toBeGreaterThan(40);
    expect(ev.freq).toBeLessThan(200);
    expect(ev.holdSeconds).toBeCloseTo(0.25, 9);
  });

  it("drums: routes the piece through its kit preset", async () => {
    const { session, sent } = auditionSession();
    await session.audition("drums", "snare");
    const [ev] = sent[0];
    const snare = getDrumKit("kit-default")!.pieces.snare;
    expect(ev.freq).toBe(snare.baseFreq);
    expect(ev.noiseMix).toBeCloseTo(snare.noiseMix, 9);
    expect(ev.noiseShort).toBe(false);
  });

  it("setLaneSound swaps the audition preset; metronome path untouched", async () => {
    const { session, sent } = auditionSession();
    session.setLaneSound("lead", "preset-lead-2");
    await session.audition("lead", 0);
    const [ev] = sent[0];
    const preset = getPreset("preset-lead-2")!;
    expect(ev.wave).toBe(1); // triangle
    expect(ev.level).toBeCloseTo(preset.level, 9);
    expect(session.metronomeOn).toBe(false);
  });

  it("no-op (no throw) when the context cannot host worklets", async () => {
    const session = new Session({
      engine: fakeEngine(),
      createVoiceEngineHost: async () => null,
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });
    await expect(session.audition("bass", 0)).resolves.toBeUndefined();
  });

  it("setLaneScale retunes audition to the lane's effective scale (IM-6)", async () => {
    const { session, sent } = auditionSession();
    // Before any scale is pushed, the fallback is the project default (C minor):
    // degree 0 → C.
    await session.audition("bass", 0);
    const fallbackMidi = midiOfFreq(sent[0][0].freq);

    // D major (root 2): degree 0 is two semitones above C.
    session.setLaneScale("bass", {
      root: 2,
      mode: "major",
      intervals: [0, 2, 4, 5, 7, 9, 11],
    });
    sent.length = 0;
    await session.audition("bass", 0);
    expect(midiOfFreq(sent[0][0].freq)).toBe(fallbackMidi + 2);

    // Clearing the override falls back to the project default again.
    session.setLaneScale("bass", null);
    sent.length = 0;
    await session.audition("bass", 0);
    expect(midiOfFreq(sent[0][0].freq)).toBe(fallbackMidi);
  });

  it("chords lane auditions the diatonic triad (three voices)", async () => {
    const { session, sent } = auditionSession();
    await session.audition("chords", 0);
    expect(sent[0]).toHaveLength(3);
    const midis = sent[0].map((e) => midiOfFreq(e.freq)).sort((a, b) => a - b);
    // C minor default: triad on degree 0 = C, Eb, G.
    expect(midis[1] - midis[0]).toBe(3);
    expect(midis[2] - midis[1]).toBe(4);
  });
});

const A4_MIDI = 69;
function midiOfFreq(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + A4_MIDI);
}
