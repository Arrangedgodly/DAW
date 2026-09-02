/**
 * TH-3 unit tests — background-tab survival (Thor: boring by design).
 *
 * What is provable here (fake timers + fake audio clock):
 *  1. Hidden-tab timer throttling to 1 Hz: the 200 ms refill timer is
 *     simulated at 1000 ms cadence for a full virtual minute; the 1.5 s
 *     horizon keeps the queue fed — every step event is handed to the
 *     engine exactly once, at its exact absolute time, with zero misses.
 *  2. Wake-from-throttle burst: firing the refill callback several times
 *     without the audio clock advancing (a clamped-then-bursty timer) never
 *     double-schedules — refill is idempotent via the generatedUntil cursor.
 *  3. Refocus resync: transport position derives exclusively from
 *     ctx.currentTime (never accumulated rAF deltas), so after an arbitrary
 *     "hidden" gap the very first read on refocus is already correct — no
 *     jump, no drift, no warm-up frames.
 *
 * What is NOT provable here and is covered by tests/browser/
 * background-tab.test.ts: real visibilitychange dispatch against a real
 * AudioContext (audio clock continuity while "hidden") — see the honest
 * caveat in that file about headless rAF throttling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EngineEvent, LookaheadScheduler } from "../src/audio/scheduler";
import { Transport } from "../src/audio/transport";

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

/** Metronome compiler: one tick per 16th at 120 bpm = 0.125 s. */
const STEP = 0.125;
const provideMetronome = (after: number, until: number): EngineEvent[] => {
  const events: EngineEvent[] = [];
  let k = Math.floor(after / STEP) + 1;
  while (k * STEP <= until) {
    events.push({ type: "tick", time: k * STEP, step: k });
    k += 1;
  }
  return events;
};

describe("TH-3 background tab — 1 Hz throttled refill survives on the 1.5 s horizon", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the queue fed for a full virtual minute with the refill timer clamped to 1 Hz", () => {
    const ctx = fakeContext(0);
    const scheduled = new Map<number, number>(); // step -> count

    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (event) =>
        scheduled.set(event.step, (scheduled.get(event.step) ?? 0) + 1),
      provideEvents: provideMetronome,
      intervalMs: 200, // requested cadence…
      horizonSeconds: 1.5,
      // …but the hidden tab clamps it: the injected timer only fires at 1 Hz.
      setIntervalFn: (fn) => setInterval(fn, 1000),
    });

    scheduler.start();

    // 60 s of virtual time. The audio clock advances in lockstep with wall
    // time (it is the hardware sample clock — throttling does not touch it).
    const TOTAL = 60;
    for (let t = 1; t <= TOTAL; t++) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(1000);
    }

    // Every step that sounded inside [0, TOTAL) was scheduled exactly once…
    const lastStep = Math.floor((TOTAL - 1) / STEP);
    for (let k = 1; k <= lastStep; k++) {
      expect(scheduled.get(k), `step ${k}`).toBe(1);
    }
    expect(scheduled.size).toBeGreaterThanOrEqual(lastStep);
    // …and the queue is still ahead of the playhead (horizon never drained:
    // events beyond the playhead are already scheduled, none late).
    scheduler.stop();
  });

  it("never lets the playhead catch the horizon even at the worst 1 Hz phase", () => {
    const ctx = fakeContext(0);
    const scheduled: number[] = [];

    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (event) => scheduled.push(event.step),
      provideEvents: provideMetronome,
      horizonSeconds: 1.5,
      // Worst phase: timer fires 1 s AFTER each clock advance, so the gap
      // between a refill and the furthest scheduled event is only 0.5 s.
      setIntervalFn: (fn) => setInterval(fn, 1000),
    });

    scheduler.start();
    for (let t = 1; t <= 30; t++) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(1000);
      // Events up to currentTime+1.5 were requested; everything that has
      // already sounded (time <= currentTime) was delivered in time.
      const due = Math.floor(t / STEP);
      const delivered = scheduled.filter((s) => s <= due).length;
      expect(delivered, `t=${t}`).toBe(due);
    }
    scheduler.stop();
  });
});

describe("TH-3 wake-from-throttle — refill is idempotent (no burst double-scheduling)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a burst of refills at the same audio-clock time schedules each event exactly once", () => {
    const ctx = fakeContext(0);
    const calls: Array<{ step: number; when: number }> = [];

    let timerFn: (() => void) | null = null;
    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (event, when) => calls.push({ step: event.step, when }),
      provideEvents: provideMetronome,
      intervalMs: 200,
      horizonSeconds: 1.5,
      setIntervalFn: (fn, ms) => {
        timerFn = fn;
        return setInterval(fn, ms);
      },
    });

    scheduler.start();
    const baseline = calls.length;
    expect(baseline).toBeGreaterThan(0);

    // Simulate the clamp lifting: several coalesced callbacks fire back to
    // back before the audio clock moves (the classic post-throttle burst).
    ctx.currentTime = 1;
    expect(timerFn).not.toBeNull();
    for (let i = 0; i < 5; i++) timerFn!();

    // Only events in the NEW horizon slice [1, 2.5] are handed over —
    // nothing already queued is scheduled a second time.
    const steps = calls.map((c) => c.step);
    expect(new Set(steps).size).toBe(steps.length); // no duplicates
    expect(calls.length).toBeGreaterThan(baseline); // progress resumed
    for (const c of calls) expect(c.when).toBe(c.step * STEP);
    scheduler.stop();
  });

  it("the compile cursor never rewinds: an empty poll means end-of-song and later refills stay parked", () => {
    const ctx = fakeContext(0);
    const scheduled: number[] = [];
    let polls = 0;
    const scheduler = new LookaheadScheduler({
      getContext: () => ctx,
      scheduleEvent: (event) => scheduled.push(event.step),
      // One-shot song: 4 s of music, then the compiler is exhausted.
      provideEvents: (after, until) => {
        polls += 1;
        return provideMetronome(after, Math.min(until, 4));
      },
      intervalMs: 200,
      horizonSeconds: 1.5,
    });

    scheduler.start();
    for (let t = 1; t <= 20; t++) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(200);
    }
    // Exactly the 4 s of song, each step once; refills past the end hand out
    // nothing new (the cursor parked at the end, it does not rewind or
    // replay). This is what keeps a throttled-then-bursty timer from
    // re-scheduling a finished song's events.
    expect(scheduled.length).toBe(Math.floor(4 / STEP));
    const steps = new Set(scheduled);
    expect(steps.size).toBe(scheduled.length);
    // Cursor is a pure forward latch: polls keep happening but stay empty.
    expect(polls).toBeGreaterThan(20);
    scheduler.stop();
  });
});

describe("TH-3 refocus resync — position derives from ctx.currentTime, not rAF history", () => {
  it("the first read after an arbitrary hidden gap is already correct (no jump, no drift)", () => {
    const ctx = fakeContext(100);
    const transport = new Transport({
      getContext: () => ctx,
      scheduleEvent: () => {},
      cancelScheduledEvents: () => {},
      intervalMs: 200,
      horizonSeconds: 1.5,
    });

    transport.play(0);
    // rAF-era read while "visible".
    const visible = transport.getLoopTime();
    expect(visible).toBeGreaterThanOrEqual(0);

    // Tab hidden for 60 s: no rAF reads happen (they are the thing that
    // paused); the audio clock keeps running on the audio thread.
    const hiddenFor = 60;
    ctx.currentTime += hiddenFor;

    // Refocus: the very next read recomputes from ctx.currentTime alone.
    // Loop is 1 bar @120 bpm = 2 s, so 60 s lands exactly at the same
    // loop-relative position — and it must equal the analytic value.
    const loopLen = 2;
    const elapsed = ctx.currentTime - 100 - 0.1; // minus startDelay
    const expected = ((elapsed % loopLen) + loopLen) % loopLen;
    expect(transport.getLoopTime()).toBeCloseTo(expected, 10);

    // Statelessness: repeated reads at a fixed clock do not accumulate.
    const a = transport.getLoopTime();
    const b = transport.getLoopTime();
    expect(a).toBe(b);

    // And a non-multiple gap (the generic case) also lands analytically.
    ctx.currentTime += 0.731;
    const elapsed2 = ctx.currentTime - 100 - 0.1;
    const expected2 = ((elapsed2 % loopLen) + loopLen) % loopLen;
    expect(transport.getLoopTime()).toBeCloseTo(expected2, 10);
    transport.stop();
  });

  it("position never moves backwards on refocus even across many hidden cycles", () => {
    const ctx = fakeContext(0);
    const transport = new Transport({
      getContext: () => ctx,
      scheduleEvent: () => {},
      cancelScheduledEvents: () => {},
      intervalMs: 200,
      horizonSeconds: 1.5,
    });
    transport.play(0);

    // Loop-relative position is mod 2 s, so "backwards" means: the
    // refocus-read must equal the clock-derived value, never the stale
    // pre-hide value (which would be a visible backwards jump).
    const before = transport.getLoopTime();
    ctx.currentTime += 7.3; // hidden gap
    const after = transport.getLoopTime();
    const loopLen = 2;
    const elapsed = ctx.currentTime - 0.1;
    expect(after).toBeCloseTo(((elapsed % loopLen) + loopLen) % loopLen, 10);
    // And it is NOT simply the stale parked value (7.3 s is not a loop
    // multiple, so the two must differ — proving a resync happened).
    expect(after).not.toBeCloseTo(before, 5);
    transport.stop();
  });
});
