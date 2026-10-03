import { describe, expect, it, vi } from "vitest";
import { Session } from "../src/engine/session";
import {
  getDrumKit,
  getPreset,
  type VoiceNoteOnEvent,
  WAVE_CODE,
} from "../src/audio/presets";
import {
  EventOutbox,
  type VoiceEngineHost,
  type SampleVoiceHost,
} from "../src/audio/voiceEngine";
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

function auditionSession(
  preload: (refs: readonly string[]) => Promise<void> = async () => {},
) {
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
  const samples: SampleVoiceHost = {
    sendEvents: (_lane, events) => sent.push([...events]),
    connect: () => {},
    allOff: () => {},
    dispose: () => {},
    preload,
    settled: async () => {},
    droppedCount: () => 0,
    stolenCount: () => 0,
  };
  const session = new Session({
    engine: fakeEngine(),
    createVoiceEngineHost: async () => host,
    createSampleVoiceHost: async () => samples,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });
  return { session, sent };
}

describe("Session.audition", () => {
  it("loads only the clicked sample slot, including the alternate 808 recordings", async () => {
    const preload = vi.fn<(refs: readonly string[]) => Promise<void>>(
      async () => {},
    );
    const { session, sent } = auditionSession(preload);
    session.setLaneSound("drums", "kit-808");
    await session.audition("drums", "snare2");
    expect(preload).toHaveBeenCalledWith(["drums.808.snare2"]);
    expect(sent[0][0].sample?.ref).toBe("drums.808.snare2");
    preload.mockClear();
    await session.audition("drums", "cowbell");
    expect(preload).not.toHaveBeenCalled();
    expect(sent[1][0].sample).toBeUndefined();
  });

  it("discards a stale preview when the sound changes during decoding", async () => {
    let finish = () => {};
    let started = () => {};
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { session, sent } = auditionSession(async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    session.setLaneSound("lead", "preset-lead-13");
    const stale = session.audition("lead", 0);
    await loading;
    session.setLaneSound("lead", "preset-lead-2");
    await session.audition("lead", 0);
    finish();
    await stale;
    expect(sent).toHaveLength(1);
    expect(sent[0][0].wave).toBe(1);
    expect(sent[0][0].sample).toBeUndefined();
  });
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
describe("isolated sound library previews", () => {
  it("renders a candidate phrase without changing the lane's applied sound", async () => {
    const { session, sent } = auditionSession();
    session.setLaneSound("lead", "preset-lead-1");
    await session.previewSound("lead", "preset-lead-2");
    expect(sent[0]).toHaveLength(4);
    expect(sent[0][3].time - sent[0][0].time).toBeCloseTo(1.2);
    expect(sent[0][0].wave).toBe(noteWave("preset-lead-2"));
    await session.audition("lead", 0);
    expect(sent[1][0].wave).toBe(noteWave("preset-lead-1"));
  });
  it("preloads all recorded pieces used in the consistent kit rhythm", async () => {
    const preload = vi.fn(async () => {});
    const { session, sent } = auditionSession(preload);
    await session.previewSound("drums", "kit-808");
    expect(preload).toHaveBeenCalledWith(
      expect.arrayContaining([
        "drums.808.kick",
        "drums.808.snare",
        "drums.808.hat",
      ]),
    );
    expect(sent.flat().length).toBe(10);
    expect(
      Math.max(...sent.flat().map((e) => e.time)) -
        Math.min(...sent.flat().map((e) => e.time)),
    ).toBeCloseTo(1.75);
  });
  it("cancels a loading candidate without scheduling it or hiding load failures", async () => {
    let finish = () => {};
    let started = () => {};
    const loading = new Promise<void>((r) => {
      started = r;
    });
    const { session, sent } = auditionSession(async () => {
      started();
      await new Promise<void>((r) => {
        finish = r;
      });
    });
    const pending = session.previewSound("drums", "kit-808");
    await loading;
    session.stopSoundPreview();
    finish();
    await pending;
    expect(sent).toHaveLength(0);
    const failed = auditionSession(async () => {
      throw new Error("missing recording");
    });
    await expect(
      failed.session.previewSound("drums", "kit-808"),
    ).rejects.toThrow("missing recording");
    expect(failed.sent).toHaveLength(0);
  });
});
function noteWave(id: string) {
  return WAVE_CODE[getPreset(id)!.wave];
}
function midiOfFreq(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + A4_MIDI);
}
