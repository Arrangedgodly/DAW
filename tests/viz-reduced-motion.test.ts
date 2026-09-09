/**
 * VZ-DD-3 unit tests — the flash ceiling (src/viz/clamps.ts), the
 * reduced-motion alternative in the node engine (src/viz/nodes.ts), the
 * textual-equivalence seam (src/viz/textEquivalence.ts), and the BOTH-gates
 * law's CSS half. Node-driven pure logic + the engine with every DOM
 * effect injected (the viz-nodes-math recorder precedent); the built-bundle
 * journey under EMULATED reduced motion lives in
 * tests/browser/viz-reduced-motion.test.tsx.
 *
 * What is pinned here mechanically:
 * - THE CEILING PROOF (the acceptance criterion "no repeat rate can exceed
 *   the SC 2.3.1-derived bound"): hostile hit streams (13 Hz dense, 10 Hz,
 *   6.7 Hz swung-8ths-at-200-BPM, 3.5 Hz, 0.26 s discrete spacing, jittered
 *   tables) driven through the REAL governFlash policy + the REAL
 *   oneShotEnvelope windows — the discrete flashes that begin in ANY
 *   closed one-second window never exceed VIZ_FLASH_CEILING_HZ (3).
 * - The governor's window semantics: CLOSED trailing [now − 1 s, now]
 *   (boundary admissions count against each other — conservative under the
 *   spec's "any one second period"), non-finite garbage dropped, admitted
 *   windows carry the new admission, releaseAt = oldest + 1 s.
 * - The merge branches: denied-and-LIT pins/refreshes (never a fresh
 *   flash), denied-and-DARK draws at ≤ VIZ_FLASH_MERGE_ALPHA (SC 2.3.1's
 *   below-threshold branch).
 * - THE ALTERNATIVE MODE: setReducedMotion clears motion instantly (no
 *   fade), held marks draw STATIC (byte-identical calls across frames — no
 *   animated decay), bounded hold + refresh (toggle rate ≤ ceiling by
 *   construction), pitch-placed geometry (river/bloom pinned against the
 *   pure functions), lane-hue identity on refresh, expiry drops, mode
 *   survives setArrangement, mode flip back resumes one-shots, probe
 *   fields, dispose cleans the live-engine registry.
 * - FULL-MOTION pinning: a dense burst admits ≤3 then merges into CONSTANT
 *   light (same recorded alpha across frames straddling the pin), the
 *   single closing decay after release, sub-threshold spawn when dark.
 * - TEXTUAL EQUIVALENCE: bounded emission rate (2 s floor), trailing
 *   per-lane counts, deterministic uppercase copy, current()/emissions
 *   ledger, degenerate clock reads never emit, registry lifecycle.
 * - FENCES (real-source greps, the viz-preset-model precedent): no
 *   Math.random / Date.now in the new modules; viz.css carries the
 *   prefers-reduced-motion media gate (the BOTH-gates law's CSS half).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANE_IDS, type LaneId } from "../src/document/schema";
import type { VizNoteOn } from "../src/engine/session";
import type { VizArrangement, VizNode } from "../src/viz/presets";
import {
  VIZ_FLASH_CEILING_HZ,
  VIZ_FLASH_MERGE_ALPHA,
  VIZ_FLASH_WINDOW_SECONDS,
  VIZ_RM_HOLD_SECONDS,
  governFlash,
  mergeAmplitude,
  pruneFlashAdmissions,
  rmHoldExpiry,
} from "../src/viz/clamps";
import {
  VIZ_ENVELOPE_SHAPE_GAMMA,
  VIZ_LIVE_BRIGHTNESS_GAIN,
  VIZ_LIVE_TAIL_FLOOR,
  laneLuminanceEqualizer,
  canonicalPitch,
  createVizNodeEngine,
  oneShotEnvelope,
  riverPitchPoint,
  stageOf,
  activeVizNodeEngines,
  visualAmplitudeOf,
  type VizNodeEngineOptions,
} from "../src/viz/nodes";
import {
  VIZ_ACTIVITY_MIN_INTERVAL_SECONDS,
  VIZ_ACTIVITY_PREFIX,
  activeVizActivitySummarizers,
  createVizActivitySummarizer,
  formatVizActivitySummary,
  releaseVizActivitySummarizer,
} from "../src/viz/textEquivalence";

// ---------------------------------------------------------------------------
// Test doubles (the viz-nodes-math recorder precedent, verbatim idiom)
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly op: "blit" | "segment" | "circle";
  readonly hue: string;
  readonly alpha: number;
  readonly numbers: readonly number[];
}

function recorderContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  state: { composite: string; alpha: number; dash: readonly number[] };
} {
  const calls: RecordedCall[] = [];
  const state = { composite: "source-over", alpha: 1, dash: [] as number[] };
  let strokeStyle = "";
  let lineWidth = 0;
  let path: number[] = [];
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
}

const HUES: Record<LaneId, string> = {
  drums: "#f23d4c",
  bass: "#ffb300",
  chords: "#35d07f",
  lead: "#4da6ff",
};

function stubBaker() {
  const bake = (hue: string, halo: number): { hueTag: string } => ({
    hueTag: `${hue}|${halo.toFixed(3)}`,
  });
  return { bake };
}

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

function nodeOf(
  kind: string,
  placement: Record<string, number | string>,
  params: Record<string, number | string> = {},
  motion: Record<string, number | string> = {},
): VizNode {
  return { id: `t#${kind}`, kind, placement, motion, params };
}

function makeEngine(
  arrangement: VizArrangement,
  over: Partial<VizNodeEngineOptions> = {},
) {
  const baker = stubBaker();
  const engine = createVizNodeEngine({
    arrangement,
    hues: HUES,
    restHue: "#f5f2e9",
    dpr: 1,
    bakeSprite: (hue, halo) =>
      baker.bake(hue, halo) as unknown as CanvasImageSource,
    ...over,
  });
  return { engine, baker };
}

// ---------------------------------------------------------------------------
// The pure governor (window semantics + decision table)
// ---------------------------------------------------------------------------

describe("pruneFlashAdmissions (closed trailing window)", () => {
  it("keeps [now − 1 s, now]: the boundary admission COUNTS (conservative)", () => {
    const now = 10;
    expect(pruneFlashAdmissions([9, 9.5, 10], now)).toEqual([9, 9.5, 10]);
    // 9 − ε has left the window.
    expect(pruneFlashAdmissions([8.999, 9, 9.5], now)).toEqual([9, 9.5]);
    expect(pruneFlashAdmissions([8, 9], now)).toEqual([9]);
  });

  it("drops non-finite garbage and reads empty for a non-finite now", () => {
    expect(pruneFlashAdmissions([Number.NaN, 9.5, Infinity], 10)).toEqual([
      9.5,
    ]);
    expect(pruneFlashAdmissions([1, 2, 3], Number.NaN)).toEqual([]);
  });
});

describe("governFlash (the admission decision)", () => {
  it("admits while fewer than the ceiling sit in the trailing window", () => {
    const d1 = governFlash([], 10);
    expect(d1.admitted).toBe(true);
    expect(d1.window).toEqual([10]);
    const d2 = governFlash(d1.window, 10.2);
    expect(d2.admitted).toBe(true);
    expect(d2.window).toEqual([10, 10.2]);
    const d3 = governFlash(d2.window, 10.4);
    expect(d3.admitted).toBe(true);
    expect(d3.window).toEqual([10, 10.2, 10.4]);
  });

  it("denies the 4th inside one second and releases at oldest + 1 s", () => {
    const denied = governFlash([10, 10.2, 10.4], 10.6);
    expect(denied.admitted).toBe(false);
    expect(denied.releaseAt).toBeCloseTo(11, 12); // oldest (10) + window
    // The denied decision's window is unchanged (the merge added nothing).
    expect(denied.window).toEqual([10, 10.2, 10.4]);
    // At release the oldest has left the CLOSED window only past 11:
    expect(governFlash([10, 10.2, 10.4], 11).admitted).toBe(false);
    const after = governFlash([10, 10.2, 10.4], 11.001);
    expect(after.admitted).toBe(true);
    expect(after.window).toEqual([10.2, 10.4, 11.001]);
  });

  it("denies boundary-aligned admissions against each other (closed window)", () => {
    // 1 s spacing is safe by construction (any closed 1 s window holds at
    // most 2 of them) — the binding case is denser-than-1 s spacing:
    expect(governFlash([10, 11, 12], 13).admitted).toBe(true);
    // 0, 0.45, 0.9 admitted; the hit at EXACTLY 1.0 still sees the 0
    // admission inside the closed window [0, 1.0] → denied; past it, free.
    expect(governFlash([0, 0.45, 0.9], 1).admitted).toBe(false);
    expect(governFlash([0, 0.45, 0.9], 1.001).admitted).toBe(true);
  });
});

describe("mergeAmplitude + rmHoldExpiry (the derived constants)", () => {
  it("clamps the denied-dark response to the sub-threshold amplitude", () => {
    expect(mergeAmplitude(1)).toBe(VIZ_FLASH_MERGE_ALPHA);
    expect(mergeAmplitude(0.05)).toBeCloseTo(0.05, 12);
    expect(mergeAmplitude(0)).toBe(0);
    expect(mergeAmplitude(Number.NaN)).toBe(0);
  });

  it("derives the reduced-motion hold from the ceiling (toggle rate law)", () => {
    expect(VIZ_RM_HOLD_SECONDS * VIZ_FLASH_CEILING_HZ).toBeCloseTo(1, 12);
    expect(rmHoldExpiry(10)).toBeCloseTo(10 + 1 / 3, 12);
    expect(VIZ_FLASH_WINDOW_SECONDS).toBe(1);
    expect(VIZ_FLASH_CEILING_HZ).toBe(3); // WCAG 2.3.1
  });
});

// ---------------------------------------------------------------------------
// THE CEILING PROOF — hostile streams through the REAL policy
// ---------------------------------------------------------------------------

/**
 * The discrete-flash ledger of one node under the engine's exact policy:
 * admitted hits BEGIN a flash only when the node's above-threshold light
 * is at rest; denied hits merge (lit → pin extends the span to release +
 * decay; dark → the sub-threshold response, which is exempt BY THRESHOLD,
 * so it neither counts nor extends the above-threshold span).
 */
function discreteFlashStarts(hits: readonly number[], decay: number): number[] {
  let admitted: readonly number[] = [];
  let spanEnd = Number.NEGATIVE_INFINITY; // end of above-threshold light
  const starts: number[] = [];
  for (const t of [...hits].sort((a, b) => a - b)) {
    const decision = governFlash(admitted, t);
    admitted = decision.window;
    if (decision.admitted) {
      if (t >= spanEnd) starts.push(t); // node was dark — a flash begins
      spanEnd = Math.max(spanEnd, t + decay);
    } else if (t < spanEnd) {
      // Merged into live light: pin holds it past the window's release,
      // then ONE closing decay — still the same single flash.
      spanEnd = Math.max(spanEnd, decision.releaseAt + decay);
    }
    // Denied + dark: sub-threshold (≤ 0.1 delta) — exempt, not a flash.
  }
  return starts;
}

/** Max discrete flashes inside any CLOSED one-second window. */
function maxFlashesPerSecond(starts: readonly number[]): number {
  let max = 0;
  for (let i = 0; i < starts.length; i++) {
    let count = 0;
    for (let j = i; j < starts.length; j++) {
      if (starts[j]! <= starts[i]! + VIZ_FLASH_WINDOW_SECONDS) count++;
    }
    max = Math.max(max, count);
  }
  return max;
}

describe("the flash ceiling (SC 2.3.1 — no repeat rate can exceed the bound)", () => {
  const streams: ReadonlyArray<{ name: string; hits: number[]; decay: number }> = [
    {
      name: "16ths @ 200 BPM sustained (13.3 Hz, overlapping windows)",
      hits: Array.from({ length: 134 }, (_, i) => i * 0.075),
      decay: 0.25,
    },
    {
      name: "10 Hz at the 0.1 s decay floor (rest exactly at each next hit)",
      hits: Array.from({ length: 101 }, (_, i) => i * 0.1),
      decay: 0.1,
    },
    {
      name: "swung 8ths @ 200 BPM (6.67 Hz, discrete gaps)",
      hits: Array.from({ length: 67 }, (_, i) => i * 0.15),
      decay: 0.1,
    },
    {
      name: "3.5 Hz — just over the ceiling",
      hits: Array.from({ length: 29 }, (_, i) => i * 0.2857),
      decay: 0.1,
    },
    {
      name: "0.26 s spacing (discrete every hit until the wall)",
      hits: Array.from({ length: 40 }, (_, i) => i * 0.26),
      decay: 0.1,
    },
    {
      name: "1 Hz slow (admits everything, far under)",
      hits: Array.from({ length: 15 }, (_, i) => i),
      decay: 0.4,
    },
    {
      name: "deterministic jitter table",
      hits: [
        0, 0.05, 0.4, 0.75, 0.9, 1.2, 1.5, 1.95, 2.02, 2.5, 2.61, 3.0, 3.4,
        3.65, 4.1, 4.5, 4.98, 5.5, 5.6, 6.3, 7.05, 7.6, 8.2, 9.05, 9.7,
      ],
      decay: 0.3,
    },
    {
      name: "burst-then-quiet-then-burst",
      hits: [
        ...Array.from({ length: 8 }, (_, i) => i * 0.12),
        2.5, 2.62, 2.74, 2.86, 2.98,
        ...Array.from({ length: 6 }, (_, i) => 5 + i * 0.09),
      ],
      decay: 0.2,
    },
  ];

  for (const stream of streams) {
    it(`holds ≤ ${VIZ_FLASH_CEILING_HZ} discrete flashes per second — ${stream.name}`, () => {
      const starts = discreteFlashStarts(stream.hits, stream.decay);
      expect(starts.length).toBeGreaterThan(0); // the stream really lights
      expect(maxFlashesPerSecond(starts)).toBeLessThanOrEqual(
        VIZ_FLASH_CEILING_HZ,
      );
    });
  }

  it("the densest stream collapses into ONE continuous flash (merge, not skip)", () => {
    const hits = Array.from({ length: 134 }, (_, i) => i * 0.075);
    // 13.3 Hz with 0.25 s windows: overlapping light never rests — the
    // whole 10 s stream is a SINGLE discrete flash (later admissions land
    // on already-lit light; denials pin it through).
    const starts = discreteFlashStarts(hits, 0.25);
    expect(starts.length).toBe(1);
  });

  it("every hit still lands light: denied hits never shrink the span they merge into", () => {
    // 13.3 Hz from t=0: the light must still be above-threshold at t=5 s
    // (pinned through the burst), long past any single 0.25 s window.
    const hits = Array.from({ length: 134 }, (_, i) => i * 0.075);
    let admitted: readonly number[] = [];
    let spanEnd = Number.NEGATIVE_INFINITY;
    for (const t of hits) {
      const decision = governFlash(admitted, t);
      admitted = decision.window;
      if (decision.admitted) spanEnd = Math.max(spanEnd, t + 0.25);
      else if (t < spanEnd)
        spanEnd = Math.max(spanEnd, decision.releaseAt + 0.25);
    }
    expect(spanEnd).toBeGreaterThan(9); // pinned past the last hit + window
  });
});

// ---------------------------------------------------------------------------
// Full-motion engine gating (admission + pin + sub-threshold)
// ---------------------------------------------------------------------------

describe("engine flash gating (full motion)", () => {
  const rig: VizArrangement = {
    presetId: "t",
    seed: 1,
    nodes: [nodeOf("bloom", { x: 0.5, y: 0.5, lane: "drums" }, { decay: 0.25 })],
  };

  /**
   * The LIGHT calls (not the rest rig): the bloom's ignition blit is two
   * radii wide (default radius 0.15 → 94–288 px at this stage) while its
   * rest dot is 0.02 units (~19 px) — diameter separates them cleanly.
   */
  const lightCalls = (calls: readonly RecordedCall[]): readonly RecordedCall[] =>
    calls.filter((c) => c.op === "blit" && c.numbers[2]! > 50);

  it("denies the 4th discrete hit in a second (dark node → sub-threshold)", () => {
    // Discrete flashes need gaps > decay: the 0.1 s floor with 0.35 s
    // spacing rests fully between hits, so every hit wants a fresh flash.
    const engine = makeEngine({
      presetId: "t",
      seed: 1,
      nodes: [
        nodeOf("bloom", { x: 0.5, y: 0.5, lane: "drums" }, { decay: 0.1 }),
      ],
    }).engine;
    // 0, 0.3, 0.6 admitted; the 4th at 11.0 still sees all three in the
    // CLOSED window [10, 11.0] → denied, and the node is DARK (the last
    // flash rested at 10.7) → the below-threshold response.
    for (const t of [10, 10.3, 10.6, 11.0]) {
      engine.ignite(hit({ audibleAt: t, velocity: 1 }));
    }
    const probe = engine.probe();
    expect(probe.flashAdmits).toBe(3);
    expect(probe.flashMerges).toBe(1);
    // The denied hit still draws — at/below the sub-threshold amplitude.
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 11.01, 4);
    const light = lightCalls(rec.calls);
    expect(light.length).toBe(1); // exactly the denied response
    expect(light[0]!.alpha).toBeGreaterThan(0); // a visible reaction
    expect(light[0]!.alpha).toBeLessThanOrEqual(VIZ_FLASH_MERGE_ALPHA);
    engine.dispose();
  });

  it("pins a lit node CONSTANT through a dense burst (no oscillation)", () => {
    const { engine } = makeEngine(rig);
    // 13.3 Hz, decay 0.25, span 1.5 s: 6 admissions (≤ 3/s — the pure
    // block proves the rate law), 14 merges pin the light through.
    for (let i = 0; i < 20; i++) {
      engine.ignite(hit({ audibleAt: 10 + i * 0.075, velocity: 1 }));
    }
    const probe = engine.probe();
    expect(probe.flashAdmits).toBe(6);
    expect(probe.flashMerges).toBe(14);
    // Two frames straddling the pin (both before release): the MAIN
    // (above-threshold) light holds CONSTANT — no decay, no strobe.
    const mains = (calls: readonly RecordedCall[]): readonly number[] =>
      lightCalls(calls)
        .filter((c) => c.alpha > VIZ_FLASH_MERGE_ALPHA)
        .map((c) => c.alpha);
    const a = recorderContext();
    engine.onFrame(a.ctx, frameOf(1280, 960), 10.5, 4);
    const b = recorderContext();
    engine.onFrame(b.ctx, frameOf(1280, 960), 10.9, 4);
    expect(mains(a.calls).length).toBeGreaterThan(0);
    expect(mains(b.calls)).toEqual(mains(a.calls)); // the pin law
    engine.dispose();
  });

  it("every DENIED hit still lands a visible sub-threshold companion (one per node, never stacked)", () => {
    const { engine } = makeEngine(rig);
    // Interleaved like real frames: ignite then draw, so a deny's
    // companion is observed at its own audible moment (the batch-ignite
    // idiom would leave only the LAST refresh's birth observable).
    let companionAt: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = 10 + i * 0.075;
      engine.ignite(hit({ audibleAt: t, velocity: 1 }));
      const r = recorderContext();
      engine.onFrame(r.ctx, frameOf(1280, 960), t + 0.001, 4);
      const comps = lightCalls(r.calls).filter(
        (c) => c.alpha <= VIZ_FLASH_MERGE_ALPHA,
      );
      companionAt = comps.map((c) => c.alpha);
    }
    // After the 4th hit (i = 3, the first denial at 10.225) EVERY frame
    // shows exactly one companion at a visible sub-threshold level.
    expect(companionAt.length).toBe(1);
    expect(companionAt[0]!).toBeGreaterThan(0.05);
    expect(companionAt[0]!).toBeLessThanOrEqual(VIZ_FLASH_MERGE_ALPHA);
    // And after the burst's last light: nothing left (no pulse).
    const after = recorderContext();
    engine.onFrame(after.ctx, frameOf(1280, 960), 12.4, 4);
    expect(lightCalls(after.calls)).toEqual([]);
    engine.dispose();
  });

  it("the pinned light decays exactly once after release, from the pinned level", () => {
    const { engine } = makeEngine(rig);
    for (let i = 0; i < 20; i++) {
      engine.ignite(hit({ audibleAt: 10 + i * 0.075, velocity: 0.8 }));
    }
    // Pin level = max(current, hit amplitude) = 0.8; release = 11. (The
    // later re-admissions at 11.05–11.2 land on still-lit light.)
    const mid = recorderContext();
    engine.onFrame(mid.ctx, frameOf(1280, 960), 11.05, 4); // 0.05 past release
    const alpha = lightCalls(mid.calls)[0]!.alpha;
    // The bolder calibration: pin level derives from the visual amplitude
    // curve, and the draw applies the envelope-shape gamma + live
    // brightness gain (not a sub — companions are never companded), then
    // the colorize tail floor over the admitted draw.
    expect(alpha).toBeCloseTo(
      Math.min(
        1,
        laneLuminanceEqualizer(HUES).drums! *
          (VIZ_LIVE_TAIL_FLOOR +
            (1 - VIZ_LIVE_TAIL_FLOOR) *
              Math.min(
                1,
                Math.pow(
                  oneShotEnvelope(0.05, 0.25, 0, visualAmplitudeOf(0.8)),
                  VIZ_ENVELOPE_SHAPE_GAMMA,
                ) * VIZ_LIVE_BRIGHTNESS_GAIN,
              )),
      ),
      6,
    );
    // Fully expired after the last light (the final deniers pin the late
    // re-admissions until 11.05 + 1 s, + 0.25 decay = 12.3): rest rig
    // only, registry compacted.
    const after = recorderContext();
    engine.onFrame(after.ctx, frameOf(1280, 960), 12.4, 4);
    expect(lightCalls(after.calls)).toEqual([]);
    expect(engine.probe().live).toBe(0);
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// The reduced-motion alternative (static placed marks + bounded hold)
// ---------------------------------------------------------------------------

describe("engine reduced-motion alternative", () => {
  const rig: VizArrangement = {
    presetId: "t",
    seed: 1,
    nodes: [
      nodeOf(
        "river",
        { x: 0.5, y: 0.5, lane: "any" },
        { angle: 90, length: 0.9, width: 0.04, decay: 0.25 },
      ),
    ],
  };

  it("setReducedMotion kills motion instantly (live objects cleared, no fade)", () => {
    const { engine } = makeEngine(rig);
    engine.ignite(hit({ audibleAt: 10, velocity: 1 }));
    expect(engine.probe().live).toBe(1);
    engine.setReducedMotion(true);
    const probe = engine.probe();
    expect(probe.reducedMotion).toBe(true);
    expect(probe.live).toBe(0); // motion dies as a state change
    expect(probe.heldMarks).toBe(0); // nothing held yet
  });

  it("held marks draw STATIC: byte-identical calls across frames (no decay)", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    engine.ignite(hit({ lane: "lead", pitch: 90, velocity: 1, audibleAt: 10 }));
    const a = recorderContext();
    engine.onFrame(a.ctx, frameOf(1280, 960), 10.05, 4.2);
    const b = recorderContext();
    engine.onFrame(b.ctx, frameOf(1280, 960), 10.18, 4.35); // beats move — must not matter
    const liveA = a.calls.filter((c) => c.alpha >= 1); // full-level mark
    const liveB = b.calls.filter((c) => c.alpha >= 1);
    expect(liveA.length).toBeGreaterThan(0);
    expect(liveB).toEqual(liveA); // identical pose AND alpha — static
    expect(engine.probe().heldMarks).toBe(1);
  });

  it("the held mark sits at the pitch position (river canonical point)", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    engine.ignite(hit({ lane: "lead", pitch: 90, velocity: 1, audibleAt: 10 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 10.05, 4.2);
    const mark = rec.calls.find((c) => c.alpha >= 1)!;
    const stage = stageOf(1280, 960);
    const point = riverPitchPoint(
      rig.nodes[0]!,
      canonicalPitch("lead", 90),
      stage,
    );
    expect(mark.op).toBe("blit");
    // The recorder's blit numbers are [x − d/2, y − d/2, d, d], all
    // integer-rounded (the drawImage law) — ±1 px of the pure point.
    const [, , d] = mark.numbers;
    expect(Math.abs(mark.numbers[0]! + d / 2 - point.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(mark.numbers[1]! + d / 2 - point.y)).toBeLessThanOrEqual(1);
  });

  it("bounded hold: expired marks drop; refreshes keep one continuous mark", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    engine.ignite(hit({ lane: "lead", audibleAt: 10, velocity: 1 }));
    expect(engine.probe().heldMarks).toBe(1);
    const late = recorderContext();
    engine.onFrame(late.ctx, frameOf(1280, 960), 10 + VIZ_RM_HOLD_SECONDS + 0.01, 4);
    expect(engine.probe().heldMarks).toBe(0); // lazily dropped
    expect(late.calls.find((c) => c.alpha >= 1)).toBeUndefined();
    // Refresh inside the hold: same mark, latest lane's hue, max level.
    engine.ignite(hit({ lane: "bass", audibleAt: 12, velocity: 0.4 }));
    engine.ignite(hit({ lane: "drums", audibleAt: 12.1, velocity: 0.9 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 12.15, 4);
    expect(engine.probe().heldMarks).toBe(1); // ONE continuous mark
    const mark = rec.calls.find((c) => c.alpha >= 0.9)!;
    expect(mark.hue).toContain(HUES.drums); // the HITTING lane's hue
  });

  it("reduced-motion ignitions pass the SAME ceiling (deny → refresh, not toggle)", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    // Admits at 10, 10.3, 10.6 (each refreshing the held mark — gaps 0.3
    // < hold 1/3); the 4th at 11.0 is DENIED inside the closed window and
    // finds the mark DARK (10.6 + 1/3 < 11.0) → the sub-threshold response.
    for (const t of [10, 10.3, 10.6, 11.0]) {
      engine.ignite(hit({ audibleAt: t, velocity: 1 }));
    }
    const probe = engine.probe();
    expect(probe.flashAdmits).toBe(3);
    expect(probe.flashMerges).toBe(1);
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), 11.01, 4);
    const marked = rec.calls.find(
      (c) => c.alpha > 0 && c.hue.includes(HUES.drums) && c.alpha < 0.9,
    );
    expect(marked).toBeTruthy();
    expect(marked!.alpha).toBeLessThanOrEqual(VIZ_FLASH_MERGE_ALPHA);
    // And a burst inside the hold refreshes: 13 Hz holds ONE full-level
    // mark (6 admissions ≤ 3/s over the 1.5 s span, 14 refresh merges).
    const dense = makeEngine(rig);
    dense.engine.setReducedMotion(true);
    for (let i = 0; i < 20; i++) {
      dense.engine.ignite(hit({ audibleAt: 20 + i * 0.075, velocity: 1 }));
    }
    const p = dense.engine.probe();
    expect(p.flashAdmits).toBe(6);
    expect(p.flashMerges).toBe(14);
    expect(p.heldMarks).toBe(1); // never toggled off mid-burst
    const rec2 = recorderContext();
    dense.engine.onFrame(rec2.ctx, frameOf(1280, 960), 21.4, 4);
    expect(rec2.calls.find((c) => c.alpha >= 1)).toBeTruthy();
  });

  it("mode survives setArrangement; the rig re-hangs with fresh ledgers", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    engine.ignite(hit({ audibleAt: 10, velocity: 1 }));
    engine.setArrangement({
      presetId: "t2",
      seed: 2,
      nodes: [
        nodeOf("bloom", { x: 0.25, y: 0.25, lane: "drums" }, { decay: 0.2 }),
      ],
    });
    const probe = engine.probe();
    expect(probe.reducedMotion).toBe(true); // the preference persists
    expect(probe.heldMarks).toBe(0); // held marks are rig state — dropped
    expect(probe.flashAdmits).toBe(0);
    expect(probe.flashMerges).toBe(0);
  });

  it("flipping back resumes the animated one-shot path (no remount)", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    engine.ignite(hit({ audibleAt: 10, velocity: 1 }));
    engine.setReducedMotion(false);
    expect(engine.probe().reducedMotion).toBe(false);
    expect(engine.probe().heldMarks).toBe(0); // marks die with the mode
    engine.ignite(hit({ audibleAt: 10.2, velocity: 1 }));
    expect(engine.probe().live).toBe(1); // one-shots are back
    // And they animate: two frames differ (the decay runs again).
    const a = recorderContext();
    engine.onFrame(a.ctx, frameOf(1280, 960), 10.25, 4);
    const b = recorderContext();
    // Sample deeper into the window than the original 10.32: the colorize
    // equalizer saturates the drum lane's EARLY decay at full brightness
    // (min(1, eq × alpha) clamps), so the visible decay begins later.
    engine.onFrame(b.ctx, frameOf(1280, 960), 10.42, 4);
    expect(a.calls).not.toEqual(b.calls);
  });

  it("the rest rig still draws under reduce (the still diagram)", () => {
    const { engine } = makeEngine(rig);
    engine.setReducedMotion(true);
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(1280, 960), Number.NaN, Number.NaN);
    expect(rec.calls.length).toBeGreaterThan(0);
  });

  it("joins/leaves the live-engine registry (the browser probe seam)", () => {
    const before = activeVizNodeEngines().length;
    const { engine } = makeEngine(rig);
    expect(activeVizNodeEngines().length).toBe(before + 1);
    expect(activeVizNodeEngines()).toContain(engine);
    engine.dispose();
    expect(activeVizNodeEngines().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Textual equivalence (bounded, summary-level, DD-2's payload)
// ---------------------------------------------------------------------------

describe("textual event equivalence (src/viz/textEquivalence.ts)", () => {
  it("emits at most once per rate floor — suppressed notes still count", () => {
    const s = createVizActivitySummarizer();
    const first = s.note({ lane: "drums", audibleAt: 10 }, 10);
    expect(first).toBeTruthy(); // first emission is due immediately
    expect(s.note({ lane: "bass", audibleAt: 10.5 }, 10.5)).toBeNull();
    expect(s.note({ lane: "lead", audibleAt: 11.9 }, 11.99)).toBeNull();
    const due = s.note({ lane: "chords", audibleAt: 12.1 }, 12);
    expect(due).toBeTruthy();
    // The suppressed hits were counted: 1 drums + 1 bass + 1 lead + 1 chords.
    expect(due).toBe(
      formatVizActivitySummary({ drums: 1, bass: 1, chords: 1, lead: 1 }),
    );
    expect(s.emissions).toBe(2);
  });

  it("counts only the trailing window, in LANE_IDS order, uppercase", () => {
    const s = createVizActivitySummarizer();
    s.note({ lane: "drums", audibleAt: 1 }, 1);
    const line = s.note({ lane: "lead", audibleAt: 3.1 }, 3.1);
    expect(line).toBe(
      `${VIZ_ACTIVITY_PREFIX} — DRUMS 0 · BASS 0 · CHORDS 0 · LEAD 1`,
    );
    expect(formatVizActivitySummary({
      drums: 2,
      bass: 0,
      chords: 4,
      lead: 1,
    })).toBe(`${VIZ_ACTIVITY_PREFIX} — DRUMS 2 · BASS 0 · CHORDS 4 · LEAD 1`);
    expect(LANE_IDS.join(",")).toBe("drums,bass,chords,lead"); // frozen order
  });

  it("current() carries the last emission; degenerate clocks never emit", () => {
    const s = createVizActivitySummarizer();
    expect(s.current()).toBeNull();
    const line = s.note({ lane: "bass", audibleAt: 5 }, 5);
    expect(s.current()).toBe(line);
    expect(s.note({ lane: "bass", audibleAt: Number.NaN }, 6)).toBeNull();
    expect(s.note({ lane: "bass", audibleAt: 7 }, Number.NaN)).toBeNull();
  });

  it("determinism: the same (hit, now) script reproduces the same lines", () => {
    const script: ReadonlyArray<[LaneId, number, number]> = [
      ["drums", 0, 0],
      ["drums", 0.1, 0.1],
      ["bass", 2.5, 2.5],
      ["lead", 4.0, 4.0],
      ["chords", 6.5, 6.5],
    ];
    const run = (): string[] => {
      const s = createVizActivitySummarizer();
      const out: string[] = [];
      for (const [lane, at, now] of script) {
        const line = s.note({ lane, audibleAt: at }, now);
        if (line !== null) out.push(line);
      }
      releaseVizActivitySummarizer(s);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("registry lifecycle (DD-2's seam + the teardown probe)", () => {
    const s = createVizActivitySummarizer();
    expect(activeVizActivitySummarizers()).toContain(s);
    releaseVizActivitySummarizer(s);
    expect(activeVizActivitySummarizers()).not.toContain(s);
  });

  it("the rate floor is the recorded bound (2 s)", () => {
    expect(VIZ_ACTIVITY_MIN_INTERVAL_SECONDS).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fences (real-source greps — the viz-preset-model precedent)
// ---------------------------------------------------------------------------

describe("VZ-DD-3 fences", () => {
  it("no Math.random / Date.now in the new viz modules (determinism + clock laws)", () => {
    for (const file of [
      "../src/viz/clamps.ts",
      "../src/viz/textEquivalence.ts",
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(file, import.meta.url)),
        "utf8",
      );
      // Call-site greps (the viz-nodes-math fence precedent): doc
      // comments may NAME the law; the code may never call it.
      expect(source).not.toMatch(/Math\.random\s*\(/);
      expect(source).not.toMatch(/Date\.now\s*\(/);
      expect(source).not.toMatch(/performance\.now\s*\(/);
    }
  });

  it("the flash ceiling is enforced in the ENGINE source (both modes share it)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/viz/nodes.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/governFlash/); // the ignite path gates
    expect(source).toMatch(/setReducedMotion/); // the mode seam
    expect(source).not.toMatch(/Math\.random\s*\(/);
  });

  it("viz.css carries the prefers-reduced-motion media gate (the BOTH-gates law)", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../src/styles/viz.css", import.meta.url)),
      "utf8",
    );
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const tokens = readFileSync(
      fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
      "utf8",
    );
    expect(tokens).toMatch(/prefers-reduced-motion/); // the law text stands
  });
});
