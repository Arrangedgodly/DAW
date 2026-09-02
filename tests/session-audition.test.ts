import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";
import { getDrumKit, getPreset, type VoiceNoteOnEvent } from "../src/audio/presets";
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
});
