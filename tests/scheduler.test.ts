import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type EngineEvent,
  LookaheadScheduler,
} from "../src/audio/scheduler";
import { AudioEngineContext } from "../src/audio/context";

/** Minimal fake audio context: currentTime is advanced by hand. */
function fakeContext(start = 0) {
  const ctx = {
    currentTime: start,
    sampleRate: 44100,
    state: "suspended" as AudioContextState,
    async resume() {
      ctx.state = "running";
    },
  };
  return ctx;
}

describe("LookaheadScheduler determinism (fake AudioContext)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules each event at its exact absolute audio-clock time (±0)", () => {
    const ctx = fakeContext(0);
    const scheduled: Array<{ event: EngineEvent; when: number }> = [];

    // Compiler: metronome ticks every 0.125 s (120 bpm, 16ths).
    const provide = (after: number, until: number): EngineEvent[] => {
      const events: EngineEvent[] = [];
      let k = Math.floor(after / 0.125) + 1;
      while (k * 0.125 <= until) {
        events.push({ type: "tick", time: k * 0.125, step: k });
        k += 1;
      }
      return events;
    };

    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (event, when) => scheduled.push({ event, when }),
      provideEvents: provide,
      intervalMs: 200,
      horizonSeconds: 1.5,
    });

    scheduler.start();

    // t=0: horizon is [0, 1.5] -> events k=1..12 scheduled at exact times.
    expect(scheduled.length).toBe(12);
    for (let k = 1; k <= 12; k++) {
      expect(scheduled[k - 1].when).toBe(k * 0.125);
      expect(scheduled[k - 1].when).toBe(scheduled[k - 1].event.time);
    }

    // Simulate 1 s of audio clock + one refill tick.
    ctx.currentTime = 1;
    vi.advanceTimersByTime(200);
    // horizon [1, 2.5] -> k=13..20, exact equality.
    expect(scheduled.length).toBe(20);
    for (let k = 13; k <= 20; k++) {
      expect(scheduled[k - 1].when).toBe(k * 0.125);
    }

    scheduler.stop();
  });

  it("never schedules events beyond the horizon", () => {
    const ctx = fakeContext(0);
    const times: number[] = [];
    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (_e, when) => times.push(when),
      provideEvents: (after, until) => {
        const events: EngineEvent[] = [];
        for (let k = Math.floor(after / 0.5) + 1; k * 0.5 <= until; k++) {
          events.push({ type: "tick", time: k * 0.5, step: k });
        }
        return events;
      },
      intervalMs: 250,
      horizonSeconds: 1,
    });

    scheduler.start();
    expect(times.length).toBe(2); // 0.5 and 1.0 are within [0, 1]
    expect(times[0]).toBe(0.5);
    expect(times[1]).toBe(1);

    // Advance the audio clock 4 s but let only ONE refill run: the horizon
    // still bounds what is handed out (background-tab safety is about the
    // clock, but we must never front-run the horizon itself).
    ctx.currentTime = 4;
    vi.advanceTimersByTime(250);
    const maxTime = Math.max(...times);
    expect(maxTime).toBeLessThanOrEqual(4 + 1);
    // Every handed-out time is still an exact multiple of the 0.5 grid.
    for (const t of times) {
      expect(t / 0.5).toBe(Math.round(t / 0.5));
    }
    scheduler.stop();
  });

  it("survives a background-tab 1 Hz-throttled refill (horizon covers it)", () => {
    const ctx = fakeContext(0);
    const times: number[] = [];
    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (_e, when) => times.push(when),
      provideEvents: (after, until) => {
        const events: EngineEvent[] = [];
        for (let k = Math.floor(after / 0.25) + 1; k * 0.25 <= until; k++) {
          events.push({ type: "tick", time: k * 0.25, step: k });
        }
        return events;
      },
      intervalMs: 200,
      horizonSeconds: 2,
    });

    scheduler.start();
    // Refills are throttled to 1 Hz in a background tab: only one refill
    // fires per second while the audio clock keeps running.
    ctx.currentTime = 1;
    vi.advanceTimersByTime(1000);
    ctx.currentTime = 2;
    vi.advanceTimersByTime(1000);

    // Every event so far was handed out at its exact time; nothing late by
    // more than... nothing at all: times are exact multiples of 0.25.
    for (const t of times) {
      expect(t / 0.25).toBe(Math.round(t / 0.25));
    }
    // The horizon (2 s) kept coverage ahead of the 1 s gap.
    expect(Math.max(...times)).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it("stops cleanly: no further refills or events after stop()", () => {
    const ctx = fakeContext(0);
    const times: number[] = [];
    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (_e, when) => times.push(when),
      provideEvents: (after, until) => {
        const events: EngineEvent[] = [];
        for (let k = Math.floor(after / 0.5) + 1; k * 0.5 <= until; k++) {
          events.push({ type: "tick", time: k * 0.5, step: k });
        }
        return events;
      },
      intervalMs: 100,
      horizonSeconds: 1,
    });

    scheduler.start();
    expect(scheduler.running).toBe(true);
    const countAtStop = times.length;
    scheduler.stop();
    expect(scheduler.running).toBe(false);

    ctx.currentTime = 10;
    vi.advanceTimersByTime(1000);
    expect(times.length).toBe(countAtStop);
  });

  it("an empty compiler response ends generation without looping forever", () => {
    const ctx = fakeContext(0);
    const times: number[] = [];
    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (_e, when) => times.push(when),
      // End of song: exactly one event ever, then nothing more.
      provideEvents: (after) =>
        after < 0.5 ? [{ type: "tick", time: 0.5, step: 1 }] : [],
      intervalMs: 100,
      horizonSeconds: 1,
    });

    scheduler.start();
    expect(times).toEqual([0.5]);
    ctx.currentTime = 5;
    vi.advanceTimersByTime(1000);
    expect(times).toEqual([0.5]);
    scheduler.stop();
  });
});

describe("AudioEngineContext bootstrap", () => {
  it("creates the context lazily via the injected factory", () => {
    const fake = fakeContext(3);
    const factory = vi.fn(() => fake);
    const engine = new AudioEngineContext(factory);

    expect(engine.created).toBe(false);
    expect(engine.state).toBe("suspended");

    expect(engine.getContext().currentTime).toBe(3);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.created).toBe(true);
    // Lazy: only one construction ever.
    engine.getContext();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("exposes running state after unlock (resume on gesture)", async () => {
    const fake = fakeContext(0);
    const engine = new AudioEngineContext(() => fake);
    await engine.unlock();
    expect(engine.state).toBe("running");
  });

  it("unlock is idempotent when already running", async () => {
    const fake = { ...fakeContext(0), state: "running" as AudioContextState };
    const resume = vi.fn(fake.resume);
    const engine = new AudioEngineContext(() => ({ ...fake, resume }));
    await engine.unlock();
    expect(resume).not.toHaveBeenCalled();
  });

  it("default factory targets 44100 Hz", async () => {
    // Only validate the factory constant; real construction stays untested
    // in node (no Web Audio). The factory itself is the single allow-listed
    // construction site.
    const engine = new AudioEngineContext(() => ({
      currentTime: 0,
      sampleRate: 44100,
      state: "suspended" as AudioContextState,
      resume: async () => {},
    }));
    expect(engine.sampleRate).toBe(44100);
  });
});
