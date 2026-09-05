/**
 * R-3 browser gate (refinement entry 3 — critique P2-4 / deferred #11):
 * LOOP re-enable around one-shot exhaustion must not produce dead air while
 * the transport claims to be playing.
 *
 * Two live laws against a REAL AudioContext with the REAL refill timers
 * (the critique's own measurement conditions):
 *  1. the critique's choreography — one-shot plays out, the transport
 *     AUTO-STOPS, LOOP is re-enabled, PLAY is pressed: the first audible
 *     onset must land within the normal first-lookahead window (the
 *     startDelay pre-roll + travel), NOT ~1.5 s (a horizon's worth) later.
 *  2. the stall window the critique measured — LOOP re-enabled DURING the
 *     exhausted tail (the final horizon-seconds of the pass, while the
 *     transport still reads playing): audio must CONTINUE past the pass
 *     end instead of falling silent forever.
 *
 * Audible path + measurement follow the suite's conventions: real
 * oscillator blips (the metronome voice vocabulary) scheduled at each
 * compiled tick's exact absolute time, tapped by an AnalyserNode (energy
 * windows) alongside the step clock (the compiled event times themselves).
 */

import { describe, expect, it } from "vitest";
import { Transport } from "../../src/audio/transport";
import { SAMPLE_RATE } from "./helpers";

const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface BlipHarness {
  ctx: AudioContext;
  transport: Transport;
  tap: AnalyserNode;
  scheduled: { step: number; when: number }[];
  dispose(): Promise<void>;
}

/** Real metronome-style blips per compiled tick, tapped (inaudible). */
async function makeBlipHarness(): Promise<BlipHarness> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const tap = ctx.createAnalyser();
  tap.fftSize = 2048;
  master.connect(tap); // capture-only: never reaches the destination
  const scheduled: { step: number; when: number }[] = [];
  const transport = new Transport({
    getContext: () => ctx,
    scheduleEvent: (event, when) => {
      scheduled.push({ step: event.step, when });
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.5, when + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(env);
      env.connect(master);
      osc.start(when);
      osc.stop(when + 0.06);
    },
    cancelScheduledEvents: () => {},
    intervalMs: 200,
    horizonSeconds: 1.5,
    cycleSteps: 16, // LL-2: the steps-typed basis (one bar — the v0.1 shape)
  });
  return {
    ctx,
    transport,
    tap,
    scheduled,
    dispose: async () => {
      transport.stop();
      await ctx.close();
    },
  };
}

/** Audio-clock time of the first energy window past `from` (null: timeout). */
async function firstEnergyAfter(
  h: BlipHarness,
  from: number,
  timeoutS: number,
): Promise<number | null> {
  const buf = new Float32Array(h.tap.fftSize);
  const deadline = performance.now() + timeoutS * 1000;
  for (;;) {
    h.tap.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    const clock = h.ctx.currentTime;
    if (peak > 1e-3 && clock >= from) return clock;
    if (performance.now() > deadline) return null;
    await waitMs(20);
  }
}

async function waitUntilAutoStopped(h: BlipHarness): Promise<void> {
  const deadline = performance.now() + 6000;
  while (h.transport.snapshot.playing) {
    if (performance.now() > deadline) throw new Error("auto-stop never fired");
    await waitMs(50);
  }
}

describe("R-3 loop re-enable around one-shot exhaustion (real AudioContext)", () => {
  it("critique repro: auto-stop → LOOP re-enable → PLAY sounds within the normal first-lookahead window (energy + step clock)", async () => {
    const h = await makeBlipHarness();
    try {
      // One-shot from the top: pass = [T0+0.1, T0+2.1) @120 bpm, 1 bar.
      h.transport.setLoop(false);
      h.transport.play();
      await waitUntilAutoStopped(h);
      expect(h.scheduled.at(-1)!.step).toBe(15); // exactly one pass compiled

      // The user's recovery gesture: LOOP back on, then PLAY.
      h.transport.setLoop(true);
      const playClock = h.ctx.currentTime;
      h.transport.play();
      expect(h.transport.snapshot.playing).toBe(true);

      // Step clock: the first compiled onset is the startDelay pre-roll +
      // travel — the normal window. The defect class: a stale horizon /
      // high-water making this silence for ~1.5 s (a full horizon).
      const first = h.scheduled.find((s) => s.when > playClock)!;
      expect(first.step).toBe(0);
      expect(first.when - playClock).toBeLessThanOrEqual(0.6);

      // Energy window: it is AUDIBLE in that window too (not just
      // compiled) — the critique measured silence here.
      const onset = await firstEnergyAfter(h, playClock, 2);
      expect(onset).not.toBeNull();
      expect(onset! - playClock).toBeLessThanOrEqual(0.6);
    } finally {
      await h.dispose();
    }
  }, 15000);

  it("stall window: LOOP re-enabled during the exhausted tail keeps audio sounding past the pass end (no silent playing)", async () => {
    const h = await makeBlipHarness();
    try {
      const t0 = h.ctx.currentTime;
      h.transport.setLoop(false);
      h.transport.play();
      // Wait INTO the exhausted tail: the horizon (1.5 s) has covered the
      // pass end since t0+0.6, audio still sounds until t0+2.1.
      while (h.ctx.currentTime < t0 + 1.2) await waitMs(25);
      const before = h.scheduled.length;
      expect(before).toBe(16); // the whole one-shot already compiled

      h.transport.setLoop(true); // the stall moment (deferred #11)
      expect(h.transport.snapshot.playing).toBe(true);

      // Audio must CONTINUE past the pass end (t0+2.1): the next pass
      // resumes at the boundary. Pre-fix: compileTicks returns [] forever
      // — silence from the pass end while `playing` stays true.
      const onset = await firstEnergyAfter(h, t0 + 2.2, 2);
      expect(onset).not.toBeNull();
      // And compilation actually resumed (step clock keeps advancing).
      await waitMs(300);
      expect(h.scheduled.length).toBeGreaterThan(16);
      expect(h.scheduled.at(-1)!.step).toBeGreaterThan(15);
      expect(h.transport.snapshot.playing).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 15000);
});
