import { describe, expect, it } from "vitest";
import { LANE_IDS } from "../src/document/schema";
import {
  COMPOSITION_KEY,
  defaultComposition,
  editLayer,
  parseComposition,
  orbitPosition,
  rerollComposition,
  VISUAL_EFFECTS,
} from "../src/viz/composition";
import {
  changeComposition,
  composition,
  resetCompositionForTests,
  restoreComposition,
} from "../src/viz/compositionState";
import {
  activityLevel,
  attackLevel,
  createCompositionEngine,
} from "../src/viz/compositionEngine";

describe("per-instrument composition", () => {
  it("changes just the selected lane and clamps placement and scale", () => {
    const original = defaultComposition();
    const next = editLayer(original, "bass", {
      effect: "torus",
      x: 10,
      y: -1,
      scale: 999,
    });
    expect(next.lanes.bass).toMatchObject({
      effect: "torus",
      x: 0.92,
      y: 0.08,
      scale: 130,
    });
    for (const id of ["drums", "chords", "lead"] as const)
      expect(next.lanes[id]).toBe(original.lanes[id]);
    expect(editLayer(next, "bass", { x: NaN })).toBe(next);
  });
  it("rerolls reproducibly with broad coverage and bounded complete assignments", () => {
    let a = defaultComposition(),
      b = defaultComposition();
    const seen = new Set<string>(),
      forms = new Set<string>();
    for (let n = 0; n < 250; n++) {
      const prior = a;
      a = rerollComposition(a);
      b = rerollComposition(b);
      expect(a).toEqual(b);
      expect(parseComposition(JSON.stringify(a))).toEqual(a);
      for (const id of LANE_IDS) {
        expect(a.lanes[id].x).not.toBe(prior.lanes[id].x);
        expect(a.lanes[id].y).not.toBe(prior.lanes[id].y);
        expect(a.lanes[id].scale).toBe(prior.lanes[id].scale);
        seen.add(a.lanes[id].effect);
      }
      forms.add(JSON.stringify(a.lanes));
    }
    expect(seen.size).toBe(VISUAL_EFFECTS.length);
    expect(forms.size).toBe(250);
  });
  it("rejects old, corrupt, nonfinite, missing-lane and unknown effect data", () => {
    const good = defaultComposition();
    for (const raw of [
      null,
      "{",
      JSON.stringify({ version: 1, presetId: "first-light", seed: 1 }),
      JSON.stringify({ ...good, lanes: {} }),
      JSON.stringify({ ...good, seed: -1 }),
      JSON.stringify({
        ...good,
        lanes: {
          ...good.lanes,
          bass: { ...good.lanes.bass, effect: "missing" },
        },
      }),
      JSON.stringify({
        ...good,
        lanes: { ...good.lanes, bass: { ...good.lanes.bass, x: Infinity } },
      }),
    ])
      expect(parseComposition(raw)).toBeNull();
  });
  it("persists committed moves once, restores once, and survives storage failure", () => {
    resetCompositionForTests();
    const map = new Map<string, string>();
    let writes = 0;
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        writes++;
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    restoreComposition(storage);
    const next = editLayer(composition(), "lead", { x: 0.4 });
    changeComposition(next, false, storage);
    expect(writes).toBe(0);
    changeComposition(next, true, storage);
    expect(writes).toBe(1);
    expect(map.has(COMPOSITION_KEY)).toBe(true);
    resetCompositionForTests();
    restoreComposition(storage);
    expect(composition()).toEqual(next);
    const failed = {
      ...storage,
      setItem: () => {
        throw Error("quota");
      },
    };
    const latest = rerollComposition(next);
    changeComposition(latest, true, failed);
    restoreComposition(storage);
    expect(composition()).toEqual(latest);
    resetCompositionForTests();
  });
  it("routes MIDI to one layer, decays on the audio clock and keeps a bounded ledger", () => {
    const engine = createCompositionEngine(defaultComposition(), {
      drums: "red",
      bass: "orange",
      chords: "green",
      lead: "blue",
    });
    for (let n = 0; n < 10000; n++)
      engine.ignite({ lane: "bass", pitch: 42, velocity: 0.8, audibleAt: 10 });
    const p = engine.probe();
    expect(p.layers).toBe(8);
    expect(p.activity.bass.velocity).toBe(0.8);
    expect(p.activity.drums.velocity).toBe(0);
    expect(activityLevel(p.activity.bass, 9)).toBe(0);
    expect(activityLevel(p.activity.bass, 10)).toBe(0.8);
    expect(activityLevel(p.activity.bass, 12)).toBeLessThan(0.01);
    engine.setPlaying(false);
    expect(engine.probe().activity.bass.velocity).toBe(0);
    engine.dispose();
    expect(engine.probe().layers).toBe(0);
  });
});

describe("MIDI phrasing", () => {
  const note = {
    at: 10,
    pitch: 60,
    velocity: 0.8,
    holdSeconds: 2,
    releaseSeconds: 0.4,
  };
  it("drums explode briefly even when the MIDI gate is long", () => {
    const drum = { ...note, lane: "drums" as const };
    expect(activityLevel(drum, 10)).toBe(0.8);
    expect(activityLevel(drum, 10.2)).toBeLessThan(0.011);
    expect(attackLevel(drum, 10.3)).toBeLessThan(0.03);
    expect(activityLevel(drum, 9)).toBe(0);
  });
  it("pitched effects sustain for the actual note gate and release afterwards", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const held = { ...note, lane };
      expect(activityLevel(held, 11.9)).toBeCloseTo(0.8);
      expect(attackLevel(held, 11)).toBeLessThan(0.0001);
      expect(activityLevel(held, 12.2)).toBeGreaterThan(0);
      expect(activityLevel(held, 12.4)).toBeLessThan(0.01);
      expect(activityLevel({ ...held, holdSeconds: 0.1 }, 11)).toBeLessThan(
        0.001,
      );
    }
  });
  it("a short overlapping note does not cut off a held chord, and stop clears it", () => {
    const engine = createCompositionEngine(defaultComposition(), {
      drums: "red",
      bass: "orange",
      chords: "green",
      lead: "blue",
    });
    engine.ignite({
      lane: "chords",
      audibleAt: 10,
      pitch: 60,
      velocity: 0.8,
      holdSeconds: 4,
      releaseSeconds: 0.3,
    });
    engine.ignite({
      lane: "chords",
      audibleAt: 11,
      pitch: 67,
      velocity: 0.5,
      holdSeconds: 0.1,
      releaseSeconds: 0.1,
    });
    expect(engine.probe(12).energy.chords).toBeCloseTo(0.8);
    expect(engine.probe(12).energy.lead).toBe(0);
    for (let n = 0; n < 1000; n++)
      engine.ignite({
        lane: "chords",
        audibleAt: 12,
        pitch: 60,
        velocity: 0.2,
        holdSeconds: 0.1,
      });
    expect(engine.probe().voices.chords).toBe(16);
    engine.setPlaying(false);
    expect(engine.probe(12).energy.chords).toBe(0);
    engine.dispose();
  });
});

it("orbits a shared center with independent scale, bounded radius, and persisted strength", () => {
  const original = defaultComposition();
  const centered = editLayer(original, "lead", { orbitStrength: 0 });
  expect(orbitPosition(centered.lanes.lead, 0, 1200, 800)).toEqual({
    x: 600,
    y: 400,
  });
  expect(orbitPosition(centered.lanes.lead, 80, 1200, 800)).toEqual({
    x: 600,
    y: 400,
  });
  const wide = editLayer(original, "lead", { orbitStrength: 100 });
  for (const time of [0, 1, 30, 500]) {
    const p = orbitPosition(wide.lanes.lead, time, 1200, 800);
    expect(Math.hypot(p.x - 600, p.y - 400)).toBeCloseTo(256);
  }
  expect(orbitPosition(wide.lanes.lead, 0, 1200, 800)).not.toEqual(
    orbitPosition(wide.lanes.lead, 10, 1200, 800),
  );
  expect(
    orbitPosition({ ...wide.lanes.lead, scale: 35 }, 10, 1200, 800),
  ).toEqual(orbitPosition(wide.lanes.lead, 10, 1200, 800));
  expect(parseComposition(JSON.stringify(wide))?.lanes.lead.orbitStrength).toBe(
    100,
  );
  expect(rerollComposition(wide).lanes.lead.orbitStrength).toBe(100);
  expect(
    editLayer(wide, "lead", { orbitStrength: -20 }).lanes.lead.orbitStrength,
  ).toBe(0);
  expect(editLayer(wide, "lead", { orbitStrength: NaN })).toBe(wide);
});

it("restores motion choices, migrates old compositions, and rejects corrupt settings", () => {
  const current = {
    ...defaultComposition(),
    motion: "trails" as const,
    blended: false,
  };
  expect(parseComposition(JSON.stringify(current))).toEqual(current);
  expect(rerollComposition(current)).toMatchObject({
    motion: "trails",
    blended: false,
  });
  const legacy = { ...current, motion: undefined, blended: undefined };
  expect(parseComposition(JSON.stringify(legacy))).toMatchObject({
    motion: "fluid",
    blended: true,
  });
  for (const patch of [
    { motion: "unknown" },
    { motion: null },
    { blended: "true" },
    { blended: null },
  ])
    expect(
      parseComposition(JSON.stringify({ ...current, ...patch })),
    ).toBeNull();
});

describe("extra instrument visuals", () => {
  it("upgrades four-lane saved settings without changing their effects", () => {
    const original = defaultComposition();
    const legacy = {
      ...original,
      lanes: Object.fromEntries(LANE_IDS.map((id) => [id, original.lanes[id]])),
    };
    const restored = parseComposition(JSON.stringify(legacy))!;
    expect(restored.lanes.drums).toEqual(original.lanes.drums);
    expect(restored.lanes.extra4).toEqual(original.lanes.extra4);
  });
  it("keeps extra voices independent and clears a muted or removed layer", () => {
    const engine = createCompositionEngine(defaultComposition(), {});
    for (const lane of ["extra1", "extra2", "extra3", "extra4"] as const) {
      for (let n = 0; n < 25; n++)
        engine.ignite({
          lane,
          pitch: 65,
          velocity: 0.6,
          audibleAt: 1,
          holdSeconds: 1,
        });
      expect(engine.probe(1.1).voices[lane]).toBe(16);
      expect(engine.probe(1.1).energy[lane]).toBeGreaterThan(0);
    }
    engine.setAudible("extra2", false);
    expect(engine.probe(1.1).voices.extra2).toBe(0);
    expect(engine.probe(1.1).voices.extra3).toBe(16);
    engine.dispose();
  });
});
