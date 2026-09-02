/**
 * DES-4 session pattern-playback seam: setLaneEvents groups compiled events
 * by pattern step and delivers them on the transport tick for that step at
 * the tick's swung absolute time.
 */

import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";
import { compileLaneEvents } from "../src/audio/compile";
import { getDrumKit, type VoiceNoteOnEvent } from "../src/audio/presets";
import { EventOutbox, type VoiceEngineHost } from "../src/audio/voiceEngine";
import type { AudioContextLike } from "../src/audio/context";
import { createDefaultProject, type DrumPattern } from "../src/document/schema";
import { timeAtStep } from "../src/audio/time";

function makeCtx(): { ctx: AudioContextLike; tick: (t: number) => void } {
  const state = { now: 10 };
  const ctx: AudioContextLike = {
    get currentTime() {
      return state.now;
    },
    sampleRate: 44100,
    state: "running",
    resume: async () => {},
  } as unknown as AudioContextLike;
  return { ctx, tick: (t) => (state.now = t) };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Session pattern playback seam", () => {
  it("delivers lane events on the matching tick at the tick time", async () => {
    const { ctx, tick } = makeCtx();
    const sent: { lane: number; events: VoiceNoteOnEvent[] }[] = [];
    const host: VoiceEngineHost = {
      outbox: new EventOutbox(4),
      sendEvents: (lane, events) => sent.push({ lane, events: [...events] }),
      connect: () => {},
      allOff: () => {},
      dispose: () => {},
    };
    let intervalCb: (() => void) | null = null;
    const session = new Session({
      engine: { getContext: () => ctx, unlock: async () => {} } as never,
      createVoiceEngineHost: async () => host,
      setIntervalFn: (cb) => {
        intervalCb = cb as () => void;
        return 0;
      },
      clearIntervalFn: () => {},
    });

    const base = createDefaultProject().patterns.drums[0] as DrumPattern;
    const steps = { ...base.steps, kick: [...base.steps.kick] };
    steps.kick[0] = true;
    steps.kick[4] = true;
    const pattern: DrumPattern = { ...base, steps };
    const groove = { bpm: 120, swing: 0 };
    const events = compileLaneEvents({
      pattern,
      preset: getDrumKit("kit-default")!,
      gate: { unit: "steps", value: 1 },
      groove,
    });
    expect(events.length).toBe(2);

    session.setLaneEvents("drums", events, 16);
    session.transport.play(); // timeline starts at ctx.now + 0.1
    tick(10.05);
    expect(intervalCb).toBeTruthy();
    intervalCb!();
    await flush();

    // Both scheduled ticks (steps 0 and 4, within the horizon) delivered.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const all = sent.flatMap((s) => s.events);
    const times = all.map((e) => e.time).sort((a, b) => a - b);
    expect(times[0]).toBeCloseTo(timeAtStep(0, groove) + 10.1, 6);
    expect(times[1]).toBeCloseTo(timeAtStep(4, groove) + 10.1, 6);
    // Drums lane index 0.
    expect(sent.every((s) => s.lane === 0)).toBe(true);
  });

  it("maps event time to pattern step by the same grid the compiler used", async () => {
    const { ctx, tick } = makeCtx();
    const sent: VoiceNoteOnEvent[][] = [];
    const host: VoiceEngineHost = {
      outbox: new EventOutbox(4),
      sendEvents: (_lane, events) => sent.push([...events]),
      connect: () => {},
      allOff: () => {},
      dispose: () => {},
    };
    let intervalCb: (() => void) | null = null;
    const session = new Session({
      engine: { getContext: () => ctx, unlock: async () => {} } as never,
      createVoiceEngineHost: async () => host,
      setIntervalFn: (cb) => {
        intervalCb = cb as () => void;
        return 0;
      },
      clearIntervalFn: () => {},
    });

    const base = createDefaultProject().patterns.drums[0] as DrumPattern;
    const steps = { ...base.steps, snare: [...base.steps.snare] };
    steps.snare[2] = true; // step 2 = 0.25 s
    const groove = { bpm: 120, swing: 0 };
    const events = compileLaneEvents({
      pattern: { ...base, steps },
      preset: getDrumKit("kit-default")!,
      gate: { unit: "steps", value: 1 },
      groove,
    });

    session.setLaneEvents("drums", events, 16);
    session.transport.play();
    tick(10.05);
    intervalCb!();
    await flush();

    // Step 2's tick carries the snare exactly at its swung time.
    const snare = sent.flat().find((e) => e.freq! > 100);
    expect(snare).toBeDefined();
    expect(snare!.time).toBeCloseTo(timeAtStep(2, groove) + 10.1, 6);
  });
});
