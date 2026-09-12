import { expect, it, vi } from "vitest";
import { createCompositionEngine } from "../../src/viz/compositionEngine";
import { defaultComposition, VISUAL_EFFECTS } from "../../src/viz/composition";

it("every effect expands on a drum transient and stretches through a held lead note", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  const scale = vi.spyOn(ctx, "scale");
  for (const effect of VISUAL_EFFECTS) {
    const composition = defaultComposition();
    composition.lanes.drums.effect = effect.id;
    composition.lanes.lead.effect = effect.id;
    const engine = createCompositionEngine(composition, {
      drums: "#f23d4c",
      bass: "#ffa326",
      chords: "#51c47b",
      lead: "#3e91ef",
    });
    engine.setPlaying(true);
    const draw = (now: number) => {
      scale.mockClear();
      engine.draw(
        ctx,
        { width: 480, height: 320, index: 0, time: now * 1000, dpr: 1 },
        now,
        112,
      );
      return scale.mock.calls.map((call) => [...call]);
    };
    engine.ignite({
      lane: "drums",
      pitch: 50,
      velocity: 1,
      audibleAt: 10,
      holdSeconds: 2,
    });
    engine.ignite({
      lane: "lead",
      pitch: 72,
      velocity: 1,
      audibleAt: 10,
      holdSeconds: 2,
      releaseSeconds: 0.2,
    });
    const onset = draw(10);
    const held = draw(11.8);
    const released = draw(12.5);
    expect(onset[0]![0], effect.id).toBeGreaterThan(1.8);
    expect(onset).toHaveLength(2);
    expect(held).toHaveLength(1);
    expect(held[0]![0], effect.id).toBeGreaterThan(1.8);
    expect(released).toHaveLength(0);
    engine.setReducedMotion(true);
    expect(draw(10)).toHaveLength(0);
    engine.dispose();
  }
  scale.mockRestore();
});

it("silence produces zero artwork pixels; held notes return, and mute/stop clear them", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const engine = createCompositionEngine(defaultComposition(), {
    drums: "red",
    bass: "orange",
    chords: "green",
    lead: "blue",
  });
  engine.setPlaying(true);
  const pixels = (now: number) => {
    ctx.clearRect(0, 0, 480, 320);
    engine.draw(
      ctx,
      { width: 480, height: 320, index: 0, time: now * 1000, dpr: 1 },
      now,
      112,
    );
    return ctx.getImageData(0, 0, 480, 320).data.some((value) => value !== 0);
  };
  expect(pixels(0)).toBe(false);
  engine.ignite({
    lane: "lead",
    pitch: 72,
    velocity: 0.01,
    audibleAt: 1,
    holdSeconds: 3,
    releaseSeconds: 0.2,
  });
  expect(pixels(2)).toBe(true);
  expect(pixels(4.5)).toBe(false);
  engine.ignite({
    lane: "lead",
    pitch: 72,
    velocity: 0.8,
    audibleAt: 5,
    holdSeconds: 3,
  });
  expect(pixels(5.1)).toBe(true);
  engine.setAudible("lead", false);
  expect(pixels(5.2)).toBe(false);
  engine.ignite({
    lane: "lead",
    pitch: 72,
    velocity: 1,
    audibleAt: 5.3,
    holdSeconds: 3,
  });
  engine.setAudible("lead", true);
  expect(pixels(5.4)).toBe(false);
  engine.ignite({ lane: "drums", pitch: 50, velocity: 1, audibleAt: 6 });
  expect(pixels(6)).toBe(true);
  engine.setPlaying(false);
  expect(pixels(6.01)).toBe(false);
  engine.dispose();
});

it("motion modes differ visually, blend independently, and retain silence", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const hashes = new Set<number>();
  for (const mode of ["orbit", "fluid", "trails"] as const) {
    for (const blend of mode === "orbit" ? [false] : [false, true]) {
      const engine = createCompositionEngine(defaultComposition(), {
        drums: "red",
        bass: "orange",
        chords: "green",
        lead: "blue",
      });
      engine.setMotion(mode, blend);
      engine.setPlaying(true);
      engine.ignite({ lane: "drums", audibleAt: 0, pitch: 60, velocity: 0.8 });
      engine.ignite({
        lane: "lead",
        audibleAt: 0,
        pitch: 72,
        velocity: 0.8,
        holdSeconds: 2,
      });
      ctx.clearRect(0, 0, 480, 320);
      const frame = { width: 480, height: 320, index: 0, time: 0, dpr: 1 };
      engine.draw(ctx, frame, 0.1, 112);
      let hash = 2166136261;
      for (const byte of ctx.getImageData(0, 0, 480, 320).data)
        hash = Math.imul(hash ^ byte, 16777619);
      hashes.add(hash);
      ctx.clearRect(0, 0, 480, 320);
      engine.draw(ctx, frame, 5, 112);
      expect(ctx.getImageData(0, 0, 480, 320).data.some((v) => v !== 0)).toBe(
        false,
      );
      engine.dispose();
    }
  }
  expect(hashes.size).toBe(5);
});
