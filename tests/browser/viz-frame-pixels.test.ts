import { describe, expect, it } from "vitest";
import { ALL_LANE_IDS } from "../../src/document/schema";
import { createCompositionEngine } from "../../src/viz/compositionEngine";
import { defaultComposition } from "../../src/viz/composition";

/** Fixed eight-lane frames, including per-lane sound and animated geometry. */
function frameHashes(): number[] {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const colors = Object.fromEntries(
    ALL_LANE_IDS.map((id, i) => [id, `hsl(${i * 43} 90% 58%)`]),
  );
  const engine = createCompositionEngine(defaultComposition(), colors);
  engine.setPlaying(true);
  for (const [i, id] of ALL_LANE_IDS.entries()) {
    engine.ignite({
      lane: id,
      pitch: 42 + i * 7,
      velocity: 0.5 + i * 0.05,
      audibleAt: 0,
      holdSeconds: 0.2,
      releaseSeconds: 0.4,
    });
    engine.setTimbre(id, {
      level: 0.25 + i * 0.06,
      transient: 0.7 - i * 0.05,
      brightness: 0.2 + i * 0.08,
      noisiness: i * 0.06,
      low: 0.7 - i * 0.05,
      mid: 0.4,
      high: 0.2 + i * 0.08,
    });
  }
  const hashes: number[] = [];
  for (const [index, now] of [0, 0.033, 0.067, 0.12].entries()) {
    ctx.clearRect(0, 0, 480, 320);
    engine.draw(ctx, { width: 480, height: 320, index, time: now * 1000, dpr: 1 }, now, 112);
    let hash = 2166136261;
    for (const byte of ctx.getImageData(0, 0, 480, 320).data)
      hash = Math.imul(hash ^ byte, 16777619);
    hashes.push(hash >>> 0);
  }
  engine.dispose();
  return hashes;
}

describe("eight-lane visualizer frame pixels", () => {
  it("preserves the fixed reactive sequence", () => {
    expect(frameHashes()).toEqual([
      3372253067, 3672592734, 2858053307, 3234583933,
    ]);
  });
});
