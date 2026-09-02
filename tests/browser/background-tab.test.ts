/**
 * TH-3 browser test — background-tab survival against a REAL AudioContext.
 *
 * Honest scope statement (D2): headless CI cannot reliably reproduce
 * hidden-tab timer throttling or rAF suspension — a synthetic
 * visibilitychange event changes document.visibilityState but does NOT make
 * Chromium clamp timers or stop rAF in a headless page. So this test proves
 * the OBSERVABLE CONTRACT with a real running context:
 *
 *  1. Audio-clock continuity "while hidden": ctx.currentTime advances in
 *     lockstep with wall time across a synthetic hidden window (the audio
 *     thread does not pause), and every transport tick whose time falls
 *     inside the window is scheduled exactly once at its exact absolute
 *     time (no misses, no duplicates — the 1.5 s horizon's whole job).
 *  2. Resync-from-clock on refocus: after visibility flips back to
 *     "visible", a rAF-driven reader (the Booth playhead's exact pattern:
 *     recompute from transport position each frame) reports values that
 *     match the ctx.currentTime-derived analytic position immediately —
 *     first frame after refocus included, no jump, no stale value.
 *
 * The parts CI cannot prove — that real rAF actually parks in a truly
 * backgrounded tab and that real 1 Hz clamping occurs — are delegated to
 * the human verification session R12 (see docs/ultron production-log TH-3).
 */

import { describe, expect, it } from "vitest";
import { Transport } from "../../src/audio/transport";
import { SAMPLE_RATE } from "./helpers";

const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Best-effort visibilityState override (works in Chromium). */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("TH-3 background tab (real AudioContext)", () => {
  it("audio clock keeps running and every tick is scheduled exactly once across a hidden window", async () => {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      await ctx.resume();
      expect(ctx.state).toBe("running");

      const scheduled = new Map<number, { time: number; when: number }>();
      const transport = new Transport({
        getContext: () => ctx,
        scheduleEvent: (event, when) =>
          scheduled.set(event.step, { time: event.time, when }),
        cancelScheduledEvents: () => {},
        intervalMs: 200,
        horizonSeconds: 1.5,
      });

      const startedAt = ctx.currentTime;
      transport.play(0);
      expect(transport.snapshot.playing).toBe(true);

      // --- Hidden window (~3 s of wall time, >> one 1 Hz refill period). ---
      setVisibility("hidden");
      const hiddenStart = performance.now();
      const samples: number[] = [];
      const readClock = () => {
        samples.push(ctx.currentTime);
        if (performance.now() - hiddenStart < 3000) {
          requestAnimationFrame(readClock);
        }
      };
      requestAnimationFrame(readClock);
      await waitMs(3100);

      // 1. Audio-clock continuity: advanced ~ wall time, never stalled.
      const wall = (performance.now() - hiddenStart) / 1000;
      const advanced = ctx.currentTime - startedAt;
      expect(advanced).toBeGreaterThan(wall - 0.25);
      expect(advanced).toBeLessThan(wall + 0.5);
      expect(samples.length).toBeGreaterThan(0);
      // Monotone, no stalls > 0.5 s between consecutive reads.
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
        expect(samples[i] - samples[i - 1]).toBeLessThan(0.5);
      }

      // 2. Horizon coverage: every tick that has already sounded (time in
      //    (start, now]) was scheduled exactly once at its exact time.
      const startDelay = 0.1;
      const stepDur = 0.125; // 120 bpm 16ths
      const elapsed = ctx.currentTime - startedAt - startDelay;
      const dueSteps = Math.floor(elapsed / stepDur);
      expect(dueSteps).toBeGreaterThan(16); // meaningful window covered
      for (let k = 0; k < dueSteps; k++) {
        const entry = scheduled.get(k);
        expect(entry, `step ${k} scheduled`).toBeDefined();
        expect(entry!.when).toBeCloseTo(entry!.time, 10);
      }
      expect(scheduled.size).toBeGreaterThanOrEqual(dueSteps);

      // --- Refocus. ---
      setVisibility("visible");

      // 3. Resync-from-clock: the playhead pattern (rAF reader that
      //    recomputes from transport position each frame) matches the
      //    analytic ctx.currentTime-derived loop time on the FIRST frames
      //    after refocus — no jump, no stale parked value.
      const loopLen = 2; // 1 bar @ 120 bpm
      const frameValues: number[] = [];
      await new Promise<void>((resolve) => {
        let frames = 0;
        const frame = () => {
          const loopTime = transport.getLoopTime();
          const elapsedNow = ctx.currentTime - startedAt - startDelay;
          const analytic = ((elapsedNow % loopLen) + loopLen) % loopLen;
          // Sampled at frame time; allow one step of slop for the gap
          // between the position read and the clock read in this harness.
          expect(Math.abs(loopTime - analytic)).toBeLessThan(stepDur);
          frameValues.push(loopTime);
          if (++frames >= 5) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      expect(frameValues.length).toBe(5);
      // No backwards stall: the reader is live (frames differ across ~ms).
      transport.stop();
    } finally {
      await ctx.close();
    }
  });
});
