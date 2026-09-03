import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transport, type TransportSnapshot } from "../src/audio/transport";
import type { EngineEvent } from "../src/audio/scheduler";

function fakeContext(start = 0) {
  const ctx = {
    currentTime: start,
    sampleRate: 44100,
    state: "running" as AudioContextState,
    async resume() {
      ctx.state = "running";
    },
  };
  return ctx;
}

interface Harness {
  ctx: ReturnType<typeof fakeContext>;
  transport: Transport;
  scheduled: Array<{ event: EngineEvent; when: number }>;
  cancel: ReturnType<typeof vi.fn>;
  states: TransportSnapshot[];
  unsubscribe: () => void;
}

function makeTransport(bars: 1 | 2 | 4 = 1): Harness {
  const ctx = fakeContext(0);
  const scheduled: Array<{ event: EngineEvent; when: number }> = [];
  const cancel = vi.fn();
  const transport = new Transport({
    getContext: () => ctx,
    scheduleEvent: (event, when) => scheduled.push({ event, when }),
    cancelScheduledEvents: cancel,
    loopBars: bars,
    intervalMs: 200,
    horizonSeconds: 1.5,
  });
  const states: TransportSnapshot[] = [];
  const unsubscribe = transport.subscribe((s) => states.push(s));
  return { ctx, transport, scheduled, cancel, states, unsubscribe };
}

describe("Transport state machine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts stopped with defaults and emits on transitions", () => {
    const h = makeTransport();
    expect(h.transport.snapshot).toEqual({
      playing: false,
      bpm: 120,
      swing: 0,
      loop: true,
      loopBars: 1,
    });

    h.transport.play();
    expect(h.transport.snapshot.playing).toBe(true);
    h.transport.stop();
    expect(h.transport.snapshot.playing).toBe(false);
    expect(h.states.length).toBe(2); // play, stop
    h.unsubscribe();
  });

  it("play is idempotent and stop is idempotent", () => {
    const h = makeTransport();
    h.transport.play();
    h.transport.play();
    expect(h.states.length).toBe(1);
    h.transport.stop();
    h.transport.stop();
    expect(h.states.length).toBe(2);
  });

  it("play schedules ticks at exact step times with a start lead", () => {
    const h = makeTransport();
    h.transport.play(); // timelineStart = 0.1, 120 bpm, step = 0.125
    // horizon [0, 1.5] -> steps sounding at 0.1 .. 1.475
    expect(h.scheduled.length).toBe(12); // steps 0..11
    for (let i = 0; i < 12; i++) {
      expect(h.scheduled[i].when).toBe(0.1 + i * 0.125);
      expect(h.scheduled[i].event.step).toBe(i);
      expect(h.scheduled[i].when).toBe(h.scheduled[i].event.time);
    }
    h.transport.stop();
  });

  it("loops: continues compiling the next pass on later refills", () => {
    const h = makeTransport();
    h.transport.play();
    h.ctx.currentTime = 1; // one refill
    vi.advanceTimersByTime(200);
    // horizon [1, 2.5] -> absolute step times 0.1 + k*0.125 <= 2.5: k=0..19
    expect(h.scheduled.length).toBe(20);
    expect(h.scheduled[16].when).toBe(0.1 + 16 * 0.125); // loop 2, step 0
    expect(h.scheduled[16].event.step).toBe(16); // global step counter
    h.transport.stop();
  });

  it("stop cancels pending events via the injected cancel function", () => {
    const h = makeTransport();
    h.transport.play();
    expect(h.cancel).not.toHaveBeenCalled();
    h.transport.stop();
    expect(h.cancel).toHaveBeenCalledTimes(1);
    // No further scheduling after stop.
    const count = h.scheduled.length;
    h.ctx.currentTime = 5;
    vi.advanceTimersByTime(1000);
    expect(h.scheduled.length).toBe(count);
  });

  it("with loop off, generation ends after one pass", () => {
    const h = makeTransport();
    h.transport.setLoop(false);
    h.transport.play();
    const firstRefill = h.scheduled.length;
    expect(firstRefill).toBe(12); // same horizon as looping case
    h.ctx.currentTime = 5; // beyond the 2 s pattern
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    expect(h.scheduled.length).toBe(16); // full 16-step pattern, then stop
    h.transport.stop();
  });

  it("play(offset) starts at a later musical position", () => {
    const h = makeTransport();
    // offset 1 s into a 2 s (1-bar @120) loop -> step 8 is next at/after 1 s
    h.transport.play(1);
    expect(h.scheduled[0].event.step).toBe(8);
    expect(h.scheduled[0].when).toBe(0.1 + 8 * 0.125);
    // and the pattern still loops from the top afterwards
    h.ctx.currentTime = 1;
    vi.advanceTimersByTime(200);
    const times = h.scheduled.map((s) => s.when);
    expect(times).toContain(0.1 + 16 * 0.125); // next pass, global step 16
    h.transport.stop();
  });

  it("applies swing to scheduled times", () => {
    const h = makeTransport();
    h.transport.setSwing(0.5);
    h.transport.play();
    // even steps on grid, odd steps delayed by 0.0625
    expect(h.scheduled[0].when).toBe(0.1);
    expect(h.scheduled[1].when).toBe(0.1 + 0.1875);
    expect(h.scheduled[2].when).toBe(0.1 + 0.25);
    expect(h.scheduled[3].when).toBe(0.1 + 0.4375);
    h.transport.stop();
  });

  it("position tracking derives from ctx.currentTime", () => {
    const h = makeTransport();
    // Stopped: default position bar 0 / beat 0 / step 0.
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 0 });

    h.transport.play();
    // Before the timeline starts (0.1 s lead): still the start position.
    h.ctx.currentTime = 0.05;
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 0 });

    // Step 3 spans [0.475, 0.6) absolute (start 0.1 + 3*0.125).
    h.ctx.currentTime = 0.5;
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 3 });

    // Loop end (0.1 + 2 = 2.1) wraps back to pattern step 0 (1-bar loop).
    h.ctx.currentTime = 2.1;
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 0 });
    h.transport.stop();
  });

  it("position respects swing and loop wrap", () => {
    const h = makeTransport();
    h.transport.setSwing(0.5);
    h.transport.play();
    // step 1 spans [0.2875, 0.35)
    h.ctx.currentTime = 0.3;
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 1 });
    // exactly at the loop end (0.1 + 2 = 2.1) wraps to pattern step 0
    h.ctx.currentTime = 2.1;
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 0 });
    h.transport.stop();
  });

  it("position reports the final step after a non-loop pattern ends", () => {
    const h = makeTransport();
    h.transport.setLoop(false);
    h.transport.play();
    h.ctx.currentTime = 0.1 + 2 + 1; // past the 2 s pattern
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 3, step: 3 });
    h.transport.stop();
  });

  // IN-4 (verifier finding: LOOP off mid-play stalled the transport — playing
  // stayed true, the button read STOP, position froze at the window edge).
  it("loop off mid-play AUTO-STOPS at the one-shot end (playing flips off, position parks, nothing more schedules)", () => {
    const h = makeTransport();
    h.transport.play(); // loop ON: passes wrap normally
    h.ctx.currentTime = 1;
    vi.advanceTimersByTime(200);
    expect(h.transport.snapshot.playing).toBe(true);

    // Mid-pass loop-off: the current pass completes, then the song ends. The
    // first refill compiles the final pass to its horizon and marks the
    // one-shot exhausted; the first refill PAST the final sounding step
    // (pass end 4.1 s) performs the auto-stop.
    h.transport.setLoop(false);
    h.ctx.currentTime = 5;
    vi.advanceTimersByTime(200);
    expect(h.transport.snapshot.playing).toBe(true); // final pass still sounding
    h.ctx.currentTime = 6; // audio clock advanced → next refill polls again
    vi.advanceTimersByTime(200);
    expect(h.transport.snapshot.playing).toBe(false);
    // The final transition EMITTED (the UI button flips STOP → PLAY by itself).
    expect(h.states.at(-1)?.playing).toBe(false);
    // Position + playhead park at the final step / loop end (v0 display law).
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 3, step: 3 });
    expect(h.transport.getLoopTime()).toBe(2); // loopLengthSeconds(1, 120)
    // No further scheduling after the auto-stop.
    const count = h.scheduled.length;
    h.ctx.currentTime = 10;
    vi.advanceTimersByTime(1000);
    expect(h.scheduled.length).toBe(count);
    // Manual stop stays idempotent afterwards.
    h.transport.stop();
    expect(h.transport.snapshot.playing).toBe(false);

    // PLAY restarts clean from the top (parked flag cleared, no wrap ghost).
    const before = h.scheduled.length;
    h.ctx.currentTime = 10;
    h.transport.play();
    expect(h.transport.snapshot.playing).toBe(true);
    expect(h.scheduled.length).toBe(before + 12); // fresh pass from step 0
    expect(h.scheduled[before]!.event.step).toBe(0);
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 0 });
    h.transport.stop();
  });

  it("loop re-enabled BEFORE the one-shot end keeps looping (no premature auto-stop)", () => {
    const h = makeTransport();
    h.transport.setLoop(false);
    h.transport.play();
    h.transport.setLoop(true); // same task, before any pass wraps
    h.ctx.currentTime = 5;
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    expect(h.transport.snapshot.playing).toBe(true); // still looping
    expect(h.scheduled.length).toBeGreaterThan(16); // second pass compiled
    h.transport.stop();
  });

  // R-3 (critique P2-4 / deferred #11): a one-shot EXHAUSTS its compile
  // cursor one horizon (1.5 s) before the last step sounds. Re-enabling LOOP
  // inside that window used to leave `exhausted` latched — compileTicks
  // returned [] forever while `playing` stayed true: dead air with the
  // transport claiming to play, and the auto-stop could never fire (it
  // requires !loop). The re-arm must resume looping.
  it("R-3: loop re-enabled during the exhausted tail RESUMES looping seamlessly at the pass boundary (no silent-playing stall)", () => {
    const h = makeTransport();
    h.transport.setLoop(false);
    h.transport.play(); // pass [0.1, 2.1); horizon 1.5 s
    h.ctx.currentTime = 1.0; // horizon [1, 2.5] covers the pass end
    vi.advanceTimersByTime(200);
    expect(h.scheduled.length).toBe(16); // whole one-shot compiled: EXHAUSTED
    expect(h.transport.snapshot.playing).toBe(true); // tail still sounding

    // The stall moment: loop back ON while exhausted + playing.
    h.transport.setLoop(true);
    h.ctx.currentTime = 1.6;
    vi.advanceTimersByTime(200);
    // Compilation resumed: the next pass starts EXACTLY at the pass boundary
    // (2.1 s = 0.1 + 16 * 0.125), global step numbering continues.
    expect(h.scheduled.length).toBeGreaterThan(16);
    expect(h.scheduled[16]!.event.step).toBe(16);
    expect(h.scheduled[16]!.when).toBe(0.1 + 16 * 0.125);
    expect(h.transport.snapshot.playing).toBe(true);
    // And it keeps looping on later refills.
    h.ctx.currentTime = 3;
    vi.advanceTimersByTime(200);
    h.ctx.currentTime = 5;
    vi.advanceTimersByTime(200);
    expect(h.scheduled.at(-1)!.event.step).toBeGreaterThan(31);
    h.transport.stop();
  });

  it("R-3: loop re-enabled just past the pass end (before the auto-stop refill) resumes from the first step at/after now — never the past", () => {
    const h = makeTransport();
    h.transport.setLoop(false);
    h.transport.play();
    h.ctx.currentTime = 1.0; // exhaust the cursor (horizon covers 2.1)
    vi.advanceTimersByTime(200);
    expect(h.scheduled.length).toBe(16);
    // Past the pass end but BEFORE the refill that would auto-stop.
    h.ctx.currentTime = 2.15;
    h.transport.setLoop(true);
    h.ctx.currentTime = 2.3; // the resume refill happens a bit later
    vi.advanceTimersByTime(200);
    expect(h.scheduled.length).toBeGreaterThan(16);
    const resumed = h.scheduled[16]!;
    // The law: first new onset is the first grid step at/after the
    // re-enable moment (2.15) — 2.225 = 2.1 + 1 * 0.125 — inside one step,
    // and never a replay of already-sounded steps.
    expect(resumed.when).toBeGreaterThanOrEqual(2.15);
    expect(resumed.when).toBeLessThanOrEqual(2.15 + 0.125);
    expect(resumed.event.step).toBe(17); // pass 1, step 1 (global numbering)
    h.transport.stop();
  });

  it("R-3 repro (critique P2-4 choreography): one-shot exhausts → auto-stop → LOOP re-enable → PLAY sounds within the normal first-lookahead window (NOT ~1.5 s)", () => {
    const h = makeTransport();
    h.transport.play(); // loop ON from a fresh start (regression guard)
    h.transport.setLoop(false); // mid-play toggle to one-shot
    h.ctx.currentTime = 5;
    vi.advanceTimersByTime(200); // final pass compiled, exhausted
    h.ctx.currentTime = 6;
    vi.advanceTimersByTime(200); // auto-stop
    expect(h.transport.snapshot.playing).toBe(false);

    h.transport.setLoop(true); // the user re-enables LOOP while stopped
    h.ctx.currentTime = 10;
    const playClock = h.ctx.currentTime;
    h.transport.play();
    // First audible onset: the startDelay pre-roll + at most one step —
    // the normal first-lookahead window. The defect class this pins shut:
    // a stale horizon/high-water making the next PLAY silent for a
    // horizon's worth (~1.5 s) of dead air.
    const first = h.scheduled.find((s) => s.when > playClock)!;
    expect(first.when - playClock).toBeLessThanOrEqual(0.1 + 0.125);
    expect(first.event.step).toBe(0); // fresh pass from the top
    expect(h.transport.getPosition()).toEqual({ bar: 0, beat: 0, step: 0 });
    h.transport.stop();
  });

  it("setters clamp, dedupe, and emit snapshot changes", () => {
    const h = makeTransport();
    h.transport.setBpm(500);
    expect(h.transport.snapshot.bpm).toBe(200);
    h.transport.setBpm(20);
    expect(h.transport.snapshot.bpm).toBe(60);
    h.transport.setBpm(60); // no change -> no emit
    const emissions = h.states.length;
    h.transport.setSwing(2);
    expect(h.transport.snapshot.swing).toBe(1);
    h.transport.setLoopBars(4);
    expect(h.transport.snapshot.loopBars).toBe(4);
    h.transport.setLoop(false);
    expect(h.transport.snapshot.loop).toBe(false);
    expect(h.states.length).toBe(emissions + 3);
  });
});
