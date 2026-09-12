import { describe, expect, it } from "vitest";
import { createCompositionEngine } from "../../src/viz/compositionEngine";
import {
  defaultComposition,
  editLayer,
  rerollComposition,
  VISUAL_EFFECTS,
} from "../../src/viz/composition";
function fingerprint(
  effect: (typeof VISUAL_EFFECTS)[number]["id"],
  seed = 48271,
): number {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let composition = defaultComposition();
  composition.seed = seed;
  composition = editLayer(composition, "drums", {
    effect,
    variation: seed,
    x: 0.5,
    y: 0.5,
  });
  const engine = createCompositionEngine(composition, {
    drums: "#f23d4c",
    bass: "#000000",
    chords: "#000000",
    lead: "#000000",
  });
  engine.setPlaying(true);
  engine.ignite({ lane: "drums", pitch: 60, velocity: 0.8, audibleAt: 0 });
  engine.draw(
    ctx,
    { width: 480, height: 320, index: 0, time: 0, dpr: 1 },
    0,
    112,
  );
  engine.dispose();
  let hash = 2166136261;
  for (const byte of ctx.getImageData(0, 0, 480, 320).data)
    hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}
describe("composition canvas fingerprints", () => {
  it("renders reproducible and distinct library geometry", () => {
    const hashes = VISUAL_EFFECTS.map((e) => fingerprint(e.id));
    expect(new Set(hashes).size).toBe(24);
    expect(VISUAL_EFFECTS.map((e) => fingerprint(e.id))).toEqual(hashes);
  });
  it("variation seeds change the geometry within the same effect", () => {
    for (const e of VISUAL_EFFECTS)
      expect(fingerprint(e.id, 1234), e.id).not.toBe(fingerprint(e.id, 56789));
    expect(rerollComposition(defaultComposition())).toEqual(
      rerollComposition(defaultComposition()),
    );
  });
});
