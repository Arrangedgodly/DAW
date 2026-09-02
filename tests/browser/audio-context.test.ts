/**
 * TH-1 browser test 1 — audio context smoke (D8/RES-7).
 *
 * Proves the browser project runs against real Chromium audio: an
 * AudioContext actually reaches `running`, and an OfflineAudioContext
 * renders real samples. If this fails, every other browser audio test is
 * meaningless — it is the canary for autoplay/flag problems in the harness.
 */

import { describe, expect, it } from "vitest";
import { SAMPLE_RATE } from "./helpers";

describe("browser audio context smoke", () => {
  it("AudioContext resumes to running state", async () => {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      // CI launches Chromium with --autoplay-policy=no-user-gesture-required
      // (see vite.config.ts browser provider options), so resume must succeed
      // without a synthetic gesture.
      await ctx.resume();
      expect(ctx.state).toBe("running");
      expect(ctx.sampleRate).toBe(SAMPLE_RATE);
    } finally {
      await ctx.close();
    }
  });

  it("OfflineAudioContext renders non-silent audio", async () => {
    const duration = 0.25;
    const ctx = new OfflineAudioContext(
      2,
      Math.ceil(duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.5;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    osc.stop(duration);

    const buffer = await ctx.startRendering();
    expect(buffer.length).toBe(Math.ceil(duration * SAMPLE_RATE));
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
      expect(Number.isFinite(data[i])).toBe(true);
    }
    expect(peak).toBeGreaterThan(0.1);
  });
});
