/**
 * VZ-IM-5 unit tests — the node rendering engine's pure math + the
 * engine's registry/draw discipline, node-driven with every DOM effect
 * injected (hues, sprite baker, recorder context — the module's own seam
 * design; the pipeline suite's recorder precedent). The BUILT-bundle
 * journey + the canvas fingerprint gate live in
 * tests/browser/viz-fingerprint.test.ts; this suite proves the mechanism.
 *
 * What is pinned here mechanically:
 * - THE ONE-SHOT ENVELOPE (table-tested): never early, peak at rise end,
 *   linear decay, EXACTLY 0 at/after the window end (no infinite pulse,
 *   any horizon), amplitude/decay clamped, degenerate inputs read 0.
 * - CANONICAL PITCH: per-lane MIDI windows (frozen), clamped ends,
 *   non-finite → the neutral center.
 * - ANGLE LAW: degrees, 0 = up, clockwise — the four cardinal vectors +
 *   the diagonal, frozen.
 * - PER-KIND PARAM MATH (frozen cases): bloom pitch displacement, spark
 *   fan angles + shard division, ripple r0/expansion/thinning, streak run
 *   span (low pitch = long run, high = pop at the end), orbit body turns
 *   (phase + rate × beats + k/bodies), river canonical position + flow.
 * - VOCABULARY DEFAULTS are the renderer's fallback law (missing fields
 *   resolve to the documented VIZ_KIND_DOCS defaults).
 * - IGNITION ENUMERATION: lane binding matches (lane + "any"), hue source
 *   is the HITTING lane, spark multiplies, the per-lane burst cap
 *   truncates at VIZ_MAX_HIT_OBJECTS_PER_LANE, decay windows clamped into
 *   [0.1, 0.4], zero-velocity hits still enumerate (VZ-HU-3's policy, not
 *   silently decided here), and enumeration is deterministic (deep-equal).
 * - ENGINE DISCIPLINE: registry age + oldest-first eviction at spawn (the
 *   VZ-HU-3 seam: maxLiveObjects + probe ledger), rest marks drawn from
 *   NaN now (the still diagram before first play), draw-state hygiene
 *   (composite/alpha/dash restored), integer drawImage blits, setArrangement
 *   = full teardown between rigs, dispose terminal.
 * - DRAW-LAW COMPLIANCE (grep-asserted against the real source, the
 *   viz-preset-model fence-test precedent): `createRadialGradient` exactly
 *   once (inside the baker — never per frame), no `shadowBlur`, no
 *   `Math.random`, every `drawImage` call site rounds its coordinates.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANE_IDS, type LaneId } from "../src/document/schema";
import type { VizNoteOn } from "../src/engine/session";
import {
  VIZ_CANARY_PRESET_IDS,
  VIZ_PRESETS,
  generateArrangement,
  type VizArrangement,
  type VizNode,
} from "../src/viz/presets";
import {
  VIZ_ENVELOPE_DECAY_MAX_SECONDS,
  VIZ_ENVELOPE_DECAY_MIN_SECONDS,
  VIZ_KIND_DOCS,
  VIZ_MAX_HIT_OBJECTS_PER_LANE,
} from "../src/viz/vocabulary";
import { VIZ_MAX_LIVE_OBJECTS } from "../src/viz/clamps";
import {
  VIZ_LANE_PITCH_WINDOWS,
  VIZ_PROVISIONAL_MAX_LIVE_OBJECTS,
  bloomIgnitionPoint,
  canonicalPitch,
  createVizNodeEngine,
  defaultBootArrangement,
  degToUnitVector,
  enumerateIgnition,
  normalizeDecayWindow,
  oneShotEnvelope,
  orbitBodyForPitch,
  orbitBodyPoint,
  orbitBodyTurns,
  rippleGeometry,
  riverPitchPoint,
  sparkFanAngles,
  stageOf,
  streakSpan,
  vizFieldDefault,
  visualAmplitudeOf,
  type VizNodeEngineOptions,
} from "../src/viz/nodes";

// ---------------------------------------------------------------------------
// Test doubles (plain objects — node env, no DOM)
// ---------------------------------------------------------------------------

/** One recorded draw call (property writes + method calls, order kept). */
interface RecordedCall {
  readonly op: "blit" | "segment" | "circle";
  readonly hue: string;
  readonly alpha: number;
  readonly numbers: readonly number[];
}

/** A recording 2d-context stub covering the engine's full draw surface. */
function recorderContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  state: { composite: string; alpha: number; dash: readonly number[] };
} {
  const calls: RecordedCall[] = [];
  const state = { composite: "source-over", alpha: 1, dash: [] as number[] };
  let strokeStyle = "";
  let lineWidth = 0;
  const ctx = {
    set globalCompositeOperation(v: string) {
      state.composite = v;
    },
    get globalCompositeOperation() {
      return state.composite;
    },
    set globalAlpha(v: number) {
      state.alpha = v;
    },
    get globalAlpha() {
      return state.alpha;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    set lineWidth(v: number) {
      lineWidth = v;
    },
    set lineCap(_v: string) {
      /* recorded implicitly via segments */
    },
    setLineDash(v: readonly number[]) {
      state.dash = [...v];
    },
    drawImage(sprite: unknown, x: number, y: number, w: number, h: number) {
      const tag = sprite as { hueTag?: string };
      calls.push({
        op: "blit",
        hue: tag?.hueTag ?? "?",
        alpha: state.alpha,
        numbers: [x, y, w, h],
      });
    },
    beginPath() {
      path = [];
    },
    moveTo(x: number, y: number) {
      path.push(x, y);
    },
    lineTo(x: number, y: number) {
      path.push(x, y);
    },
    arc(x: number, y: number, r: number) {
      path.push(x, y, r);
    },
    stroke() {
      calls.push({
        op: path.length === 3 ? "circle" : "segment",
        hue: strokeStyle,
        alpha: state.alpha,
        numbers: [...path, lineWidth],
      });
    },
  };
  let path: number[] = [];
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
}

const HUES: Record<LaneId, string> = {
  drums: "#f23d4c",
  bass: "#ffb300",
  chords: "#35d07f",
  lead: "#4da6ff",
};

/** Sprite stub factory tagging each baked (hue, halo) pair. */
function stubBaker() {
  const baked: string[] = [];
  const bake = (hue: string, halo: number): { hueTag: string } => {
    const tag = `${hue}|${halo.toFixed(3)}`;
    baked.push(tag);
    return { hueTag: tag };
  };
  return { bake, baked };
}

/** A frame-info value (the renderer's per-frame facts, dpr 1). */
function frameOf(width: number, height: number) {
  return { index: 0, width, height, dpr: 1, time: 0 };
}

const hit = (over: Partial<VizNoteOn>): VizNoteOn => ({
  lane: "drums",
  pitch: 60,
  velocity: 1,
  audibleAt: 10,
  ...over,
});

/** Minimal hand-built node (resolved fields, the render-side shape). */
function nodeOf(
  kind: string,
  placement: Record<string, number | string>,
  params: Record<string, number | string> = {},
  motion: Record<string, number | string> = {},
): VizNode {
  return { id: `t#${kind}`, kind, placement, motion, params };
}

// ---------------------------------------------------------------------------
// oneShotEnvelope — the table
// ---------------------------------------------------------------------------

describe("oneShotEnvelope (vocabulary §ONE-SHOT)", () => {
  it("is exactly 0 before the window (never early — the law)", () => {
    expect(oneShotEnvelope(-1, 0.25, 0, 1)).toBe(0);
    expect(oneShotEnvelope(-1e-9, 0.25, 0, 1)).toBe(0);
  });

  it("peaks at amplitude the instant the window opens (rise 0)", () => {
    expect(oneShotEnvelope(0, 0.25, 0, 0.8)).toBeCloseTo(0.8, 12);
    expect(oneShotEnvelope(1e-9, 0.25, 0, 1)).toBeCloseTo(1, 6);
  });

  it("decays linearly to zero across the window", () => {
    expect(oneShotEnvelope(0.05, 0.2, 0, 1)).toBeCloseTo(0.75, 12);
    expect(oneShotEnvelope(0.1, 0.2, 0, 1)).toBeCloseTo(0.5, 12);
    expect(oneShotEnvelope(0.15, 0.2, 0, 1)).toBeCloseTo(0.25, 12);
    expect(oneShotEnvelope(0.199, 0.2, 0, 1)).toBeGreaterThan(0);
  });

  it("is EXACTLY 0 at and after the window end — no infinite pulse, any horizon", () => {
    for (const decay of [0.1, 0.2, 0.4]) {
      for (const over of [0, 1e-9, 0.001, 1, 10, 1e6]) {
        expect(oneShotEnvelope(decay + over, decay, 0, 1)).toBe(0);
        expect(oneShotEnvelope(decay + over, decay, 0.3, 1)).toBe(0);
        expect(oneShotEnvelope(decay + over, decay, 0, 0.5)).toBe(0);
      }
    }
  });

  it("rises linearly through the rise fraction, then decays", () => {
    // r = 0.25 of a 0.4 s window: peak 0.1 s in.
    expect(oneShotEnvelope(0.025, 0.4, 0.25, 1)).toBeCloseTo(0.25, 12); // quarter of the rise
    expect(oneShotEnvelope(0.05, 0.4, 0.25, 1)).toBeCloseTo(0.5, 12);
    expect(oneShotEnvelope(0.1, 0.4, 0.25, 1)).toBeCloseTo(1, 12); // peak at rise end
    // Decay spans the remaining 0.3 s: half-brightness at 0.1 + 0.15.
    expect(oneShotEnvelope(0.25, 0.4, 0.25, 1)).toBeCloseTo(0.5, 12);
  });

  it("clamps the amplitude into [0,1] (velocity's linear domain)", () => {
    expect(oneShotEnvelope(0, 0.2, 0, 1.7)).toBe(1);
    expect(oneShotEnvelope(0, 0.2, 0, -3)).toBe(0);
    expect(oneShotEnvelope(0, 0.2, 0, Number.NaN)).toBe(0);
  });

  it("reads 0 for degenerate windows and non-finite time", () => {
    expect(oneShotEnvelope(Number.NaN, 0.2, 0, 1)).toBe(0);
    expect(oneShotEnvelope(0.1, Number.NaN, 0, 1)).toBe(0);
    expect(oneShotEnvelope(0.1, 0, 0, 1)).toBe(0);
    expect(oneShotEnvelope(0.1, -1, 0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Decay window + canonical pitch + angles
// ---------------------------------------------------------------------------

describe("normalizeDecayWindow (R1 committed range)", () => {
  it("clamps into [0.1, 0.4] and passes in-range values through", () => {
    expect(normalizeDecayWindow(0.05)).toBe(VIZ_ENVELOPE_DECAY_MIN_SECONDS);
    expect(normalizeDecayWindow(5)).toBe(VIZ_ENVELOPE_DECAY_MAX_SECONDS);
    expect(normalizeDecayWindow(Number.NaN)).toBe(
      VIZ_ENVELOPE_DECAY_MIN_SECONDS,
    );
    expect(normalizeDecayWindow(0.22)).toBe(0.22);
    expect(normalizeDecayWindow(0.4)).toBe(0.4);
  });
});

describe("canonicalPitch (Lane Rivers discipline)", () => {
  it("maps each lane's window ends to 0/1 and the middle to 0.5", () => {
    expect(canonicalPitch("bass", 36)).toBe(0);
    expect(canonicalPitch("bass", 60)).toBe(1);
    expect(canonicalPitch("bass", 48)).toBeCloseTo(0.5, 12);
    expect(canonicalPitch("chords", 48)).toBe(0);
    expect(canonicalPitch("chords", 72)).toBe(1);
    expect(canonicalPitch("lead", 60)).toBe(0);
    expect(canonicalPitch("lead", 84)).toBe(1);
  });

  it("clamps outside the window and centers degenerate pitch", () => {
    expect(canonicalPitch("lead", 20)).toBe(0);
    expect(canonicalPitch("bass", 120)).toBe(1);
    expect(canonicalPitch("drums", Number.NaN)).toBe(0.5);
    expect(canonicalPitch("drums", Number.POSITIVE_INFINITY)).toBe(0.5);
  });

  it("covers the real engine registers (frozen windows)", () => {
    expect(VIZ_LANE_PITCH_WINDOWS.drums).toEqual([45, 120]);
    expect(VIZ_LANE_PITCH_WINDOWS.bass).toEqual([36, 60]);
    expect(VIZ_LANE_PITCH_WINDOWS.chords).toEqual([48, 72]);
    expect(VIZ_LANE_PITCH_WINDOWS.lead).toEqual([60, 84]);
    // The synth kit's spread lands inside the drums window.
    expect(canonicalPitch("drums", 52)).toBeGreaterThan(0); // kick ≈ 160 Hz
    expect(canonicalPitch("drums", 119)).toBeLessThan(1); // hat ≈ 8 kHz
  });
});

describe("degToUnitVector (0 = up, clockwise)", () => {
  const closeTo = (v: number, x: number, y: number) => {
    expect(v.x).toBeCloseTo(x, 12);
    expect(v.y).toBeCloseTo(y, 12);
  };
  it("hits the four cardinals and the diagonal (frozen)", () => {
    closeTo(degToUnitVector(0), 0, -1);
    closeTo(degToUnitVector(90), 1, 0);
    closeTo(degToUnitVector(180), 0, 1);
    closeTo(degToUnitVector(270), -1, 0);
    closeTo(degToUnitVector(45), Math.SQRT1_2, -Math.SQRT1_2);
  });
  it("reads the zero vector for degenerate angles", () => {
    closeTo(degToUnitVector(Number.NaN), 0, 0);
  });
});

// ---------------------------------------------------------------------------
// Per-kind param math (frozen cases)
// ---------------------------------------------------------------------------

const STAGE = stageOf(1280, 960); // unit = 960

describe("bloom pitch law", () => {
  const bloom = nodeOf(
    "bloom",
    { x: 0.5, y: 0.5, lane: "lead" },
    { radius: 0.15, halo: 0.6, decay: 0.25, pitchSpread: 0.1 },
  );
  it("displaces vertically by (0.5 − p) × pitchSpread; high pitch lights higher", () => {
    const mid = bloomIgnitionPoint(bloom, 0.5, STAGE);
    expect(mid.x).toBeCloseTo(640, 9);
    expect(mid.y).toBeCloseTo(480, 9);
    const high = bloomIgnitionPoint(bloom, 1, STAGE);
    expect(high.y).toBeCloseTo(480 - 48, 9); // (0.5−1)×0.1×960 = −48 (up)
    const low = bloomIgnitionPoint(bloom, 0, STAGE);
    expect(low.y).toBeCloseTo(480 + 48, 9); // +48 (down)
    expect(high.x).toBeCloseTo(640, 9);
  });
});

describe("spark fan law", () => {
  it("centers the fan at aim + (p − 0.5) × pitchSweep; shards divide the spread ±half", () => {
    const spark = nodeOf(
      "spark",
      { x: 0.5, y: 0.5, lane: "drums" },
      { shards: 5, spread: 50, aim: 0, pitchSweep: 90, reach: 0.22, decay: 0.16 },
    );
    // Fan center at p=1 is aim + half the sweep = 45°; 5 shards divide the
    // 50° spread evenly: center ± {25, 12.5, 0}.
    expect(sparkFanAngles(spark, 1)).toEqual([20, 32.5, 45, 57.5, 70]);
    expect(sparkFanAngles(spark, 0)).toEqual([-70, -57.5, -45, -32.5, -20]);
    expect(sparkFanAngles(spark, 0.5)).toEqual([-25, -12.5, 0, 12.5, 25]);
  });
  it("clamps shard counts into the documented 2..6 (1 reads 2 spread across)", () => {
    const one = nodeOf("spark", { x: 0.5, y: 0.5, lane: "any" }, {
      shards: 1, spread: 60, aim: 90, pitchSweep: 0, reach: 0.2, decay: 0.2,
    });
    expect(sparkFanAngles(one, 0.5)).toEqual([60, 120]); // 2 shards, ±30
    const wide = nodeOf("spark", { x: 0.5, y: 0.5, lane: "any" }, {
      shards: 99, spread: 100, aim: 0, pitchSweep: 0, reach: 0.2, decay: 0.2,
    });
    expect(sparkFanAngles(wide, 0.5)).toHaveLength(6);
    expect(sparkFanAngles(wide, 0.5)[0]).toBeCloseTo(-50, 9);
    expect(sparkFanAngles(wide, 0.5)[5]).toBeCloseTo(50, 9);
  });
});

describe("ripple law", () => {
  const ripple = nodeOf(
    "ripple",
    { x: 0.5, y: 0.5, lane: "chords" },
    { r0min: 0.03, r0max: 0.08, rEnd: 0.2, thickness: 0.01, decay: 0.3 },
  );
  it("starts at r0 = r0min + p × (r0max − r0min) and expands to rEnd", () => {
    expect(rippleGeometry(ripple, 0, 0).radius).toBeCloseTo(0.03, 12);
    expect(rippleGeometry(ripple, 1, 0).radius).toBeCloseTo(0.08, 12);
    expect(rippleGeometry(ripple, 0.5, 0).radius).toBeCloseTo(0.055, 12);
    expect(rippleGeometry(ripple, 0, 1).radius).toBeCloseTo(0.2, 12);
    expect(rippleGeometry(ripple, 0, 0.5).radius).toBeCloseTo(0.115, 12);
  });
  it("thins linearly to zero as it expands", () => {
    expect(rippleGeometry(ripple, 0, 0).thickness).toBeCloseTo(0.01, 12);
    expect(rippleGeometry(ripple, 0, 0.5).thickness).toBeCloseTo(0.005, 12);
    expect(rippleGeometry(ripple, 0, 1).thickness).toBeCloseTo(0, 12);
  });
});

describe("streak law", () => {
  const streak = nodeOf(
    "streak",
    { x: 0.5, y: 0.5, lane: "any" },
    { angle: 90, length: 0.8, width: 0.02, decay: 0.2 },
  );
  it("slides the start inside the span; the end is the positive-angle end", () => {
    const low = streakSpan(streak, 0, STAGE); // angle 90 = right
    expect(low.start.x).toBeCloseTo(640 - 384, 9); // −0.4 × 960
    expect(low.end.x).toBeCloseTo(640 + 384, 9);
    expect(low.start.y).toBeCloseTo(480, 9);
    const high = streakSpan(streak, 1, STAGE);
    expect(high.start.x).toBeCloseTo(1024, 9); // at the positive end
    expect(high.end.x).toBeCloseTo(1024, 9);
  });
  it("low pitch = long run, high pitch = short pop (run ∝ 1 − p)", () => {
    const mid = streakSpan(streak, 0.5, STAGE);
    expect(mid.end.x - mid.start.x).toBeCloseTo(384, 9); // 0.4 × 960
    const low = streakSpan(streak, 0, STAGE);
    expect(low.end.x - low.start.x).toBeCloseTo(768, 9); // 0.8 × 960
  });
});

describe("orbit law", () => {
  const orbit = nodeOf(
    "orbit",
    { x: 0.5, y: 0.5, lane: "bass" },
    { bodies: 2, radius: 0.2, size: 0.05, decay: 0.28 },
    { phase: 0, rate: 0.25 },
  );
  it("body turns = phase + rate × beats + k/bodies (the documented formula)", () => {
    expect(orbitBodyTurns(orbit, 0, 0)).toBeCloseTo(0, 12);
    expect(orbitBodyTurns(orbit, 1, 0)).toBeCloseTo(0.5, 12);
    expect(orbitBodyTurns(orbit, 0, 2)).toBeCloseTo(0.5, 12); // 0.25/beat × 2
    expect(orbitBodyTurns(orbit, 1, 2)).toBeCloseTo(1, 12);
  });
  it("places bodies on the revolution circle (0 = up, clockwise)", () => {
    const up = orbitBodyPoint(orbit, 0, 0, STAGE);
    expect(up.x).toBeCloseTo(640, 9);
    expect(up.y).toBeCloseTo(480 - 192, 9); // radius 0.2 × 960, straight up
    const down = orbitBodyPoint(orbit, 1, 0, STAGE);
    expect(down.y).toBeCloseTo(480 + 192, 9); // body 1 half a turn opposite
  });
  it("retrograde rates run backwards (negative = retrograde)", () => {
    const retro = nodeOf(
      "orbit",
      { x: 0.5, y: 0.5, lane: "chords" },
      { bodies: 1, radius: 0.2, size: 0.05, decay: 0.3 },
      { phase: 0, rate: -0.125 },
    );
    expect(orbitBodyTurns(retro, 0, 4)).toBeCloseTo(-0.5, 12);
  });
  it("pitch selects the body: k = min(bodies − 1, floor(p × bodies))", () => {
    expect(orbitBodyForPitch(orbit, 0)).toBe(0);
    expect(orbitBodyForPitch(orbit, 0.49)).toBe(0);
    expect(orbitBodyForPitch(orbit, 0.5)).toBe(1);
    expect(orbitBodyForPitch(orbit, 1)).toBe(1);
  });
});

describe("river law", () => {
  const river = nodeOf(
    "river",
    { x: 0.5, y: 0.5, lane: "chords" },
    { angle: 90, length: 0.9, width: 0.04, decay: 0.25 },
    { flow: 0.02 },
  );
  it("canonical position along the band: center + dir × (p − 0.5) × length", () => {
    const low = riverPitchPoint(river, 0, STAGE);
    expect(low.x).toBeCloseTo(640 - 432, 9); // −0.45 × 960
    const high = riverPitchPoint(river, 1, STAGE);
    expect(high.x).toBeCloseTo(640 + 432, 9);
    const mid = riverPitchPoint(river, 0.5, STAGE);
    expect(mid.x).toBeCloseTo(640, 9);
    expect(mid.y).toBeCloseTo(480, 9);
  });
});

// ---------------------------------------------------------------------------
// Vocabulary defaults + ignition enumeration
// ---------------------------------------------------------------------------

describe("vocabulary defaults are the fallback law", () => {
  it("resolves missing fields to the documented VIZ_KIND_DOCS defaults", () => {
    // Bloom with NO params at all: radius 0.15, halo 0.6, decay 0.25,
    // pitchSpread 0.1; placement defaults x 0.5 / y 0.5.
    const bare = nodeOf("bloom", { lane: "any" });
    const stage = stageOf(1000, 1000);
    const point = bloomIgnitionPoint(bare, 0.5, stage);
    expect(point.x).toBeCloseTo(500, 9); // default x = 0.5
    expect(point.y).toBeCloseTo(500, 9); // default y = 0.5
    const up = bloomIgnitionPoint(bare, 1, stage);
    expect(up.y).toBeCloseTo(500 - 50, 9); // default pitchSpread 0.1
    // Decay default feeds the clamped window.
    const seeds = enumerateIgnition(
      { presetId: "t", seed: 1, nodes: [bare] },
      hit({ velocity: 1 }),
    );
    expect(seeds[0]!.decay).toBe(0.25); // bloom's documented default
  });
  it("exposes every documented default through vizFieldDefault", () => {
    expect(vizFieldDefault("bloom", "halo")).toBe(0.6);
    expect(vizFieldDefault("spark", "shards")).toBe(4);
    expect(vizFieldDefault("ripple", "rEnd")).toBe(0.2);
    expect(vizFieldDefault("streak", "angle")).toBe(90);
    expect(vizFieldDefault("orbit", "rate")).toBe(0.125);
    expect(vizFieldDefault("river", "flow")).toBe(0);
    expect(vizFieldDefault("bloom", "nope")).toBeUndefined();
    expect(vizFieldDefault("nonsense", "x")).toBeUndefined();
  });
});

describe("enumerateIgnition (the spawn law)", () => {
  const bloom = nodeOf("bloom", { x: 0.25, y: 0.25, lane: "drums" }, { decay: 0.22 });
  const anyBloom = nodeOf("bloom", { x: 0.75, y: 0.25, lane: "any" }, { decay: 0.3 });
  const spark = nodeOf(
    "spark",
    { x: 0.5, y: 0.5, lane: "drums" },
    { shards: 5, spread: 50, aim: 0, pitchSweep: 90, reach: 0.22, decay: 0.16 },
  );
  const arrangement: VizArrangement = {
    presetId: "t",
    seed: 1,
    nodes: [bloom, anyBloom, spark],
  };

  it("ignites lane-bound nodes only on their lane, any-bound on every lane", () => {
    const drums = enumerateIgnition(arrangement, hit({ lane: "drums" }));
    expect(drums).toHaveLength(7); // bloom + any-bloom + 5 shards
    const bass = enumerateIgnition(arrangement, hit({ lane: "bass" }));
    expect(bass).toHaveLength(1); // only the any-bound node
    for (const lane of LANE_IDS) {
      for (const seed of enumerateIgnition(arrangement, hit({ lane }))) {
        expect(seed.lane).toBe(lane); // hue source is the HITTING lane
      }
    }
  });

  it("carries resolved spawn facts (birth, clamped decay, amplitude, pitch)", () => {
    const seeds = enumerateIgnition(arrangement, hit({
      lane: "drums",
      pitch: 96,
      velocity: 0.6,
      audibleAt: 12.5,
    }));
    expect(seeds[0]).toMatchObject({
      nodeIndex: 0,
      kind: "bloom",
      lane: "drums",
      birth: 12.5,
      decay: 0.22,
      // The bolder recalibration: velocity is remapped through the
      // visual-amplitude gamma (audio mixing band → light band).
      amplitude: visualAmplitudeOf(0.6),
      p: canonicalPitch("drums", 96),
    });
    expect(seeds[2]!.shardIndex).toBe(0);
    expect(seeds[6]!.shardIndex).toBe(4);
  });

  it("visualAmplitudeOf — the bolder calibration curve (pure, anchored)", () => {
    // Anchors preserved: zero velocity stays zero (VZ-HU-3's policy),
    // full velocity stays full light, strictly monotone between.
    expect(visualAmplitudeOf(0)).toBe(0);
    expect(visualAmplitudeOf(1)).toBe(1);
    expect(visualAmplitudeOf(Number.NaN)).toBe(0);
    expect(visualAmplitudeOf(-1)).toBe(0);
    // The songbook's honest mixing band (0.3–0.95, median ≈ 0.72) lifts
    // into the light band — the reason the recalibration exists.
    expect(visualAmplitudeOf(0.72)).toBeGreaterThan(0.72);
    expect(visualAmplitudeOf(0.3)).toBeGreaterThan(0.3);
    expect(visualAmplitudeOf(0.95)).toBeGreaterThan(0.95 - 0.001);
    expect(visualAmplitudeOf(0.95)).toBeLessThanOrEqual(1);
    for (let v = 0; v < 1; v += 0.05) {
      expect(visualAmplitudeOf(v + 0.05)).toBeGreaterThan(visualAmplitudeOf(v));
    }
    // Deterministic: same input, same output.
    expect(visualAmplitudeOf(0.6)).toBe(visualAmplitudeOf(0.6));
  });

  it("clamps decay windows into the committed range at spawn", () => {
    const wild = nodeOf("bloom", { x: 0.5, y: 0.5, lane: "any" }, { decay: 9 });
    expect(
      enumerateIgnition({ presetId: "t", seed: 1, nodes: [wild] }, hit({}))[0]!
        .decay,
    ).toBe(VIZ_ENVELOPE_DECAY_MAX_SECONDS);
    const tiny = nodeOf("bloom", { x: 0.5, y: 0.5, lane: "any" }, { decay: 0.001 });
    expect(
      enumerateIgnition({ presetId: "t", seed: 1, nodes: [tiny] }, hit({}))[0]!
        .decay,
    ).toBe(VIZ_ENVELOPE_DECAY_MIN_SECONDS);
  });

  it("enforces the per-lane burst cap (VIZ_MAX_HIT_OBJECTS_PER_LANE)", () => {
    const nodes = Array.from({ length: 6 }, (_, i) =>
      nodeOf("spark", { x: 0.1 * i, y: 0.5, lane: "drums" }, {
        shards: 6, spread: 60, aim: 0, pitchSweep: 0, reach: 0.2, decay: 0.2,
      }),
    );
    const seeds = enumerateIgnition(
      { presetId: "t", seed: 1, nodes },
      hit({ lane: "drums" }),
    );
    expect(seeds).toHaveLength(VIZ_MAX_HIT_OBJECTS_PER_LANE);
    // Truncation is deterministic: the first node's full fan + one shard.
    expect(seeds.filter((s) => s.nodeIndex === 0)).toHaveLength(6);
    expect(seeds.filter((s) => s.nodeIndex === 1)).toHaveLength(2);
  });

  it("still enumerates zero-velocity hits (VZ-HU-3 owns that policy)", () => {
    const seeds = enumerateIgnition(arrangement, hit({ velocity: 0 }));
    expect(seeds).toHaveLength(7);
    expect(seeds.every((s) => s.amplitude === 0)).toBe(true);
  });

  it("enumerates nothing for non-finite audible times", () => {
    expect(enumerateIgnition(arrangement, hit({ audibleAt: Number.NaN }))).toHaveLength(0);
  });

  it("is deterministic: the same (arrangement, hit) deep-equals", () => {
    const a = enumerateIgnition(arrangement, hit({ lane: "chords", pitch: 62 }));
    const b = enumerateIgnition(arrangement, hit({ lane: "chords", pitch: 62 }));
    expect(a).toEqual(b);
  });

  it("renders the library's real rigs without surprise (canary canaries)", () => {
    for (const presetId of VIZ_CANARY_PRESET_IDS) {
      const preset = VIZ_PRESETS.find((p) => p.id === presetId)!;
      const rig = generateArrangement(preset, 20260904);
      const seeds = enumerateIgnition(rig, hit({ lane: "lead", pitch: 72 }));
      expect(seeds.length).toBeGreaterThanOrEqual(1);
      expect(seeds.length).toBeLessThanOrEqual(VIZ_MAX_HIT_OBJECTS_PER_LANE);
    }
  });
});

// ---------------------------------------------------------------------------
// Engine discipline (registry, draw dispatch, state hygiene)
// ---------------------------------------------------------------------------

describe("createVizNodeEngine (injected seams, recorder ctx)", () => {
  function makeEngine(over: Partial<VizNodeEngineOptions> = {}) {
    const baker = stubBaker();
    const engine = createVizNodeEngine({
      arrangement: defaultBootArrangement(),
      hues: HUES,
      restHue: "#f5f2e9",
      dpr: 1,
      bakeSprite: (hue, halo) =>
        baker.bake(hue, halo) as unknown as CanvasImageSource,
      ...over,
    });
    return { engine, baker };
  }

  it("draws the static rest rig even before any audio (NaN now)", () => {
    const { engine } = makeEngine();
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), Number.NaN, Number.NaN);
    expect(rec.calls.length).toBeGreaterThan(0);
    // Static: the exact same call sequence on the second frame.
    const second = recorderContext();
    engine.onFrame(second.ctx, frameOf(1280, 960), Number.NaN, Number.NaN);
    expect(second.calls).toEqual(rec.calls);
    expect(rec.state.composite).toBe("source-over"); // restored
    expect(rec.state.alpha).toBe(1);
    expect(rec.state.dash).toEqual([]);
  });

  it("ignites drained hits: spawn + live draw in the hitting lane's hue", () => {
    const { engine } = makeEngine();
    engine.ignite(hit({ lane: "bass", pitch: 48, velocity: 1, audibleAt: 10 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 10.05, 4.2);
    const fresh = rec.calls.filter(
      (c) => c.hue.startsWith(HUES.bass) || c.hue === HUES.bass,
    );
    expect(fresh.length).toBeGreaterThan(0); // the bloom blits in amber
    const probe = engine.probe();
    expect(probe.ignited).toBe(1);
    // The bolder recalibration: First Light hangs TWO bass blooms, so one
    // bass hit spawns/lights both.
    expect(probe.spawned).toBe(2);
    expect(probe.live).toBe(2);
    expect(probe.sprites).toBeGreaterThan(0);
  });

  it("expires objects after the window (registry compacts, nothing pulses)", () => {
    const { engine } = makeEngine();
    engine.ignite(hit({ lane: "bass", audibleAt: 10, velocity: 1 }));
    const rec = recorderContext();
    // Bolder: the bass blooms' decay window is now 0.34 s (was 0.26) —
    // draw past the full window; nothing pulses.
    engine.onFrame(rec.ctx, frameOf(1280, 960), 10 + 0.41, 4.2);
    expect(engine.probe().live).toBe(0);
  });

  it("never draws a hit before its audible time (the never-early law)", () => {
    const { engine } = makeEngine();
    const before = recorderContext();
    engine.onFrame(before.ctx, frameOf(1280, 960), Number.NaN, 0);
    engine.ignite(hit({ lane: "bass", audibleAt: 10, velocity: 1 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 9.99, 4.2); // one tick early
    expect(rec.calls).toEqual(before.calls); // rest rig only — no live light
  });

  it("blits with integer-rounded coordinates only (the drawImage law)", () => {
    const { engine } = makeEngine();
    for (const lane of LANE_IDS) {
      engine.ignite(hit({ lane, audibleAt: 10, velocity: 1, pitch: 70 }));
    }
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1281, 961), 10.1, 4.3); // odd size → fractional centers
    const blits = rec.calls.filter((c) => c.op === "blit");
    expect(blits.length).toBeGreaterThan(0);
    for (const b of blits) {
      for (const n of b.numbers) expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("enforces the live cap at spawn, oldest-first (the VZ-HU-3 seam)", () => {
    const { engine } = makeEngine({ maxLiveObjects: 5 });
    for (let i = 0; i < 10; i++) {
      engine.ignite(hit({ lane: "bass", audibleAt: 100 + i, velocity: 1 }));
    }
    const probe = engine.probe();
    expect(probe.live).toBe(5);
    // Two objects per hit (First Light's paired bass blooms, bolder).
    expect(probe.evicted).toBe(15);
    expect(probe.spawned).toBe(20);
    expect(probe.peakLive).toBe(5);
    // The NEWEST survive: at now = 109.05 only late births are still lit.
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 109.02, 40);
    const lit = rec.calls.filter((c) => c.hue.includes(HUES.bass));
    expect(lit.length).toBeGreaterThan(0);
  });

  it("defaults the cap to R1's 192 (VZ-HU-3's FINAL policy, clamps.ts)", () => {
    expect(VIZ_PROVISIONAL_MAX_LIVE_OBJECTS).toBe(VIZ_MAX_LIVE_OBJECTS);
    expect(VIZ_MAX_LIVE_OBJECTS).toBe(192);
    const { engine } = makeEngine();
    for (let i = 0; i < 200; i++) {
      engine.ignite(hit({ lane: "bass", audibleAt: i, velocity: 1 }));
    }
    expect(engine.probe().live).toBe(192);
  });

  it("setArrangement is a full teardown between rigs (no state buildup)", () => {
    const { engine } = makeEngine();
    engine.ignite(hit({ lane: "bass", audibleAt: 10, velocity: 1 }));
    // Spark Fan (library entry 1) is stroke-only: its rebuilt sprite cache
    // is legitimately EMPTY — the cache discipline bakes exactly what the
    // rig can blit, nothing more.
    const preset = VIZ_PRESETS[1]!;
    expect(preset.id).toBe("spark-fan");
    engine.setArrangement(generateArrangement(preset, 777));
    const probe = engine.probe();
    expect(probe.live).toBe(0);
    expect(probe.spawned).toBe(0);
    expect(probe.ignited).toBe(0);
    expect(probe.sprites).toBe(0);
  });

  it("setRestLevel/setLiveGain expose the VZ-IM-6 calibration seams", () => {
    const { engine } = makeEngine();
    engine.setRestLevel(0.5);
    engine.setLiveGain(0.25);
    expect(engine.probe().restLevel).toBe(0.5);
    expect(engine.probe().liveGain).toBe(0.25);
    engine.setRestLevel(9); // clamped
    engine.setLiveGain(-1);
    expect(engine.probe().restLevel).toBe(1);
    expect(engine.probe().liveGain).toBe(0);
  });

  it("is deterministic: two engines, same rig + hits + frames, same draws", () => {
    const rig = defaultBootArrangement();
    const run = (): RecordedCall[] => {
      const baker = stubBaker();
      const engine = createVizNodeEngine({
        arrangement: rig,
        hues: HUES,
        restHue: "#f5f2e9",
        dpr: 1,
        bakeSprite: (hue, halo) =>
          baker.bake(hue, halo) as unknown as CanvasImageSource,
      });
      const rec = recorderContext();
      for (const lane of LANE_IDS) {
        engine.ignite(hit({ lane, audibleAt: 10, velocity: 0.8, pitch: 66 }));
      }
      engine.onFrame(rec.ctx, frameOf(1280, 960), 10.1, 4.25);
      engine.onFrame(rec.ctx, frameOf(1280, 960), 10.2, 4.3);
      return rec.calls;
    };
    expect(run()).toEqual(run());
  });

  it("dispose is terminal and idempotent", () => {
    const { engine } = makeEngine();
    engine.dispose();
    engine.dispose();
    engine.ignite(hit({ lane: "bass", audibleAt: 10 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 10.1, 4);
    expect(rec.calls).toHaveLength(0);
    expect(engine.probe().sprites).toBe(0);
  });

  it("skips drawing entirely on degenerate frames", () => {
    const { engine } = makeEngine();
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(0, 0), 10, 4);
    expect(rec.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Draw-law compliance (source assertions — the fence-test precedent)
// ---------------------------------------------------------------------------

describe("draw-law compliance (grep-asserted against src/viz/nodes.ts)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/viz/nodes.ts", import.meta.url)),
    "utf8",
  );

  it("bans shadowBlur/shadowColor USAGE on canvas (R1 A5; call-site grep)", () => {
    expect(source).not.toMatch(/\.shadowBlur\s*=/);
    expect(source).not.toMatch(/\.shadowColor\s*=/);
    expect(source).not.toMatch(/shadowBlur:/);
    expect(source).not.toMatch(/shadowColor:/);
  });

  it("constructs radial gradients exactly ONCE — inside the sprite baker (bake, don't build)", () => {
    // Call-site grep (the viz-library fence precedent): doc comments may
    // NAME the law; the code may construct the gradient only in the baker.
    expect(source.match(/createRadialGradient\s*\(/g)?.length ?? 0).toBe(1);
    expect(source).not.toMatch(/createLinearGradient\s*\(/);
    const afterBaker = source.split("createRadialGradient(")[1]!;
    expect(afterBaker).not.toMatch(/createRadialGradient\s*\(/);
  });

  it("uses additive glow composite and restores source-over", () => {
    expect(source).toContain('globalCompositeOperation = "lighter"');
    expect(source).toContain('globalCompositeOperation = "source-over"');
  });

  it("rounds every drawImage blit to integer coords/size (the blit law)", () => {
    const callSites = source.split("drawImage(").slice(1);
    expect(callSites.length).toBeGreaterThan(0);
    for (const rest of callSites) {
      const block = rest.slice(0, rest.indexOf(");"));
      expect(
        (block.match(/Math\.round\(/g) ?? []).length,
        `blit block must round all 4 args: ...${block.slice(0, 120)}`,
      ).toBe(4);
    }
  });

  it("bans Math.random calls (the determinism contract)", () => {
    expect(source).not.toMatch(/Math\.random\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Vocabulary↔renderer coherence (the spec IS the defaults table)
// ---------------------------------------------------------------------------

describe("VIZ_KIND_DOCS coherence", () => {
  it("documents all six kinds with their full field lists", () => {
    const kinds = VIZ_KIND_DOCS.map((d) => d.kind);
    expect(kinds).toEqual([
      "bloom",
      "spark",
      "ripple",
      "streak",
      "orbit",
      "river",
    ]);
    for (const doc of VIZ_KIND_DOCS) {
      expect(doc.fields.filter((f) => f.key === "x")).toHaveLength(1);
      expect(doc.fields.filter((f) => f.key === "y")).toHaveLength(1);
      expect(doc.fields.filter((f) => f.key === "lane")).toHaveLength(1);
    }
  });
});
