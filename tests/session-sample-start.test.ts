import { expect, it } from "vitest";
import { Session } from "../src/engine/session";
import { EventOutbox } from "../src/audio/voiceEngine";
import type {
  SampleVoiceHost,
  VoiceEngineHost,
} from "../src/audio/voiceEngine";

it("waits for an agent-selected sample before starting transport", async () => {
  let ready = false;
  const loaded: string[] = [];
  const host: VoiceEngineHost = {
    outbox: new EventOutbox(8),
    sendEvents() {},
    connect() {},
    allOff() {},
    dispose() {},
  };
  const samples: SampleVoiceHost = {
    sendEvents() {},
    connect() {},
    allOff() {},
    dispose() {},
    async preload(refs) {
      loaded.push(...refs);
      await Promise.resolve();
      ready = true;
    },
    async settled() {},
    droppedCount: () => 0,
    stolenCount: () => 0,
  };
  const session = new Session({
    engine: {
      getContext: () => ({
        currentTime: 10,
        sampleRate: 44100,
        state: "running",
        resume: async () => {},
      }),
      unlock: async () => {},
    } as never,
    createVoiceEngineHost: async () => host,
    createSampleVoiceHost: async () => samples,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });
  session.setLaneSound("bass", "preset-bass-13");
  let readyAtPlay = false;
  const stop = session.subscribe((s) => {
    if (s.playing) readyAtPlay = ready;
  });
  await session.togglePlay();
  stop();
  await session.togglePlay();
  expect(loaded).toContain("voice.bass.lowtone");
  expect(readyAtPlay).toBe(true);

  // A second press while decoding cancels the pending start.
  let finish = () => {};
  samples.preload = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const pending = session.togglePlay();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await session.togglePlay();
  finish();
  await pending;
  expect(session.transport.snapshot.playing).toBe(false);
});
