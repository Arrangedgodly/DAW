import { describe, expect, it } from "vitest";
import { bootVizApp, sleep, type CanvasRegionSpec } from "./viz-harness";
import { COMPOSITION_KEY, parseComposition } from "../../src/viz/composition";
const regions: CanvasRegionSpec[] = Array.from({ length: 25 }, (_, i) => ({
  name: `area-${i}`,
  fx: 0.1 + (i % 5) * 0.18,
  fy: 0.1 + Math.floor(i / 5) * 0.18,
  size: 24,
}));
describe("built composition journeys", () => {
  it(
    "plays real MIDI visuals, rerolls during playback, returns focus, and restores the composition on a fresh boot",
    { timeout: 60000 },
    async () => {
      let app = await bootVizApp({ width: 1280, height: 800 });
      try {
        const contexts = app.instrument().contextCount;
        await app.openViz();
        expect(app.instrument().contextCount).toBe(contexts);
        await app.doc().fonts.ready;
        await sleep(150);
        // Warm the readback probe: Chromium may switch canvas raster backends
        // after repeated getImageData calls, producing one AA-only change.
        await app.sampleCanvasActivity({ durationMs: 150, regions });
        const still = await app.sampleCanvasActivity({
          durationMs: 300,
          regions,
        });
        expect(still.changes).toHaveLength(0);
        await app.closeViz();
        expect(app.doc().activeElement).toBe(app.$(".booth-btn-viz"));
        await app.play();
        await sleep(1300);
        await app.openViz();
        const moving = await app.sampleCanvasActivity({
          durationMs: 2600,
          regions,
        });
        expect(moving.changes.length).toBeGreaterThan(10);
        const intervals = moving.samples
          .slice(1)
          .map((s, i) => s.t - moving.samples[i]!.t)
          .sort((a, b) => a - b);
        console.log("Composition frame intervals ms", {
          median: intervals[Math.floor(intervals.length * 0.5)],
          p95: intervals[Math.floor(intervals.length * 0.95)],
        });
        const start = app.audioNow();
        app.$<HTMLButtonElement>(".viz-reroll").click();
        await sleep(220);
        expect(app.playing()).toBe(true);
        expect(app.audioNow()).toBeGreaterThan(start);
        app.$<HTMLButtonElement>('[aria-label="Select lead"]').click();
        const select = app.$<HTMLSelectElement>(
          '[aria-label$="visual effect"]',
        );
        select.value = "ribbon";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const motion = app.$<HTMLSelectElement>(
          '[aria-label="Motion direction"]',
        );
        motion.value = "orbit";
        motion.dispatchEvent(new Event("change", { bubbles: true }));
        const orbit = app.$<HTMLInputElement>(
          '[aria-label="lead orbit strength"]',
        );
        orbit.value = "75";
        orbit.dispatchEvent(new Event("input", { bubbles: true }));
        orbit.dispatchEvent(new Event("change", { bubbles: true }));
        motion.value = "trails";
        motion.dispatchEvent(new Event("change", { bubbles: true }));
        const blending = app.$<HTMLSelectElement>(
          '[aria-label="Instrument blending"]',
        );
        blending.value = "blend";
        blending.dispatchEvent(new Event("change", { bubbles: true }));
        const stored = parseComposition(
          app.win.localStorage.getItem(COMPOSITION_KEY),
        );
        expect(stored?.lanes.lead).toMatchObject({
          effect: "ribbon",
          orbitStrength: 75,
        });
        await app.closeViz();
        expect(app.playing()).toBe(true);
        await app.stop();
        await app.openViz();
        await app.sampleCanvasActivity({ durationMs: 150, regions });
        const idle = await app.sampleCanvasActivity({
          durationMs: 300,
          regions,
        });
        expect(idle.changes).toHaveLength(0);
        await app.teardown();
        app = await bootVizApp({
          width: 1280,
          height: 800,
          composition: stored!,
        });
        await app.openViz();
        app.$<HTMLButtonElement>('[aria-label="Select lead"]').click();
        expect(
          app.$<HTMLSelectElement>('[aria-label$="visual effect"]').value,
        ).toBe("ribbon");
        expect(
          app.$<HTMLSelectElement>('[aria-label="Motion direction"]').value,
        ).toBe("trails");
        expect(
          app.$<HTMLSelectElement>('[aria-label="Instrument blending"]').value,
        ).toBe("blend");
        expect(
          parseComposition(app.win.localStorage.getItem(COMPOSITION_KEY))?.lanes
            .lead.orbitStrength,
        ).toBe(75);
      } finally {
        await app.teardown();
      }
    },
  );
});
