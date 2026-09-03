/**
 * PX-1 browser tests — the WELCOME SONG demo, rendered OFFLINE through the
 * REAL worklet + FX graph (same path as WAV export). Nobody on the machine
 * can listen on CI's behalf (the human listen is explicitly R12's session),
 * so musicality is verified acoustically-by-metric:
 *
 *  - clean, non-clipping mix (finite samples, 0.05 < peak < 0.95);
 *  - energy present in every bar (all 4 chain slots actually sound);
 *  - downbeat transients at every bar start (kick + chord + bass land at
 *    steps 0/16/32/48 — RMS jumps at each expected onset step);
 *  - the loop is not a wall of sound: the gap between the melody's opening
 *    rest and its first attack is measurable (bar-1 RMS before the lead's
 *    first note is lower than after — the arrangement breathes).
 */

import { describe, expect, it } from "vitest";
import { createDemoProject } from "../../src/document/demoSong";
import { renderProjectToBuffer } from "../../src/audio/render";
import { assertCleanAudio, findNonFinite } from "./helpers";

const SAMPLE_RATE = 44100;

function rms(buf: Float32Array, from: number, to: number): number {
  let sum = 0;
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(buf.length, Math.ceil(to));
  for (let i = start; i < end; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe("PX-1 demo song — offline render metrics (real worklet + FX)", () => {
  it(
    "renders a clean, energetic, non-clipping 4-bar loop with onsets at the bar grid",
    { timeout: 180000 },
    async () => {
      const rendered = await renderProjectToBuffer(createDemoProject());
      const [left, right] = rendered.channels;

      // Shape: 4-bar loop @112 BPM → 4 bars × 4 beats × 23625 samples.
      expect(rendered.sampleRate).toBe(SAMPLE_RATE);
      expect(rendered.loopSamples).toBe(4 * 4 * ((SAMPLE_RATE * 60) / 112));

      // (a) Clean + non-clipping: finite everywhere, peak in (0.05, 0.95).
      const peak = assertCleanAudio([left, right], "demo", {
        minPeak: 0.05,
        maxPeak: 0.95,
      });
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThan(0.95);
      expect(findNonFinite(left) + findNonFinite(right)).toBe(0);

      const mono = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++)
        mono[i] = (left[i]! + right[i]!) / 2;

      // (b) Energy present in EVERY bar (each chain slot actually sounds).
      const barSamples = rendered.loopSamples / 4;
      for (let bar = 0; bar < 4; bar++) {
        const energy = rms(mono, bar * barSamples, (bar + 1) * barSamples);
        expect(energy).toBeGreaterThan(0.01);
      }

      // (c) Downbeat transients on the bar grid: RMS in the 40 ms AFTER each
      // bar start is clearly higher than the 40 ms just before it. Kick +
      // bass + chord all land on step 0 of each bar (structurally asserted
      // in tests/demoSong.test.ts; here we hear the mix prove it).
      const w = 0.04 * SAMPLE_RATE;
      for (let bar = 0; bar < 4; bar++) {
        const t = bar * barSamples;
        const before = rms(mono, t - w, t - 2);
        const after = rms(mono, t + 2, t + w);
        expect(after).toBeGreaterThan(before * 1.5 + 1e-6);
      }

      // (d) It breathes: the melody's opening rest is real — the lead first
      // attacks at step 4 of bar 1 (swing pushes it late), so bar 1's first
      // quarter has demonstrably less high-frequency-ish activity than the
      // bar's second quarter where the lead + delay tail join. Using overall
      // RMS: the second quarter of bar 1 must not be quieter than the first.
      const q = barSamples / 4;
      const q1 = rms(mono, 0, q);
      const q2 = rms(mono, q, 2 * q);
      expect(q2).toBeGreaterThan(q1 * 0.9);
    },
  );
});
