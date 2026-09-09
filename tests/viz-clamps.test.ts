/**
 * VZ-HU-3 unit tests — the FINAL clamp policy (accept caps + engine-edge
 * normalization), node-driven at both layers: the PURE law functions in
 * src/viz/clamps.ts (hostile tables + honest-play properties) and the
 * ENGINE integration (src/viz/nodes.ts ignite consults the policy before
 * the flash governor; the pipeline tap normalizes before queue insert).
 *
 * What is pinned here mechanically:
 * - THE CONSTANTS: the committed R1 §3 table
 *   (docs/ultron/research/r1r2-canvas-perf-dpr.md) — 64/s global + 20/s
 *   per-lane accept caps over a closed trailing 1 s window, burst ≤ 8
 *   (combined lane+any enumeration — folding the MF-2 P3 note's combined
 *   sum), MAX_LIVE_OBJECTS 192, 120 ms retrigger window — defined in ONE
 *   place (a grep fence reads the real sources) with the R1 citation.
 * - THE ACCEPT GOVERNOR: honest worst-case play (16ths @ 200 BPM × 4
 *   lanes = 53.33/s, 13.33/s per lane) NEVER bites — pure property loop
 *   + engine property (rateDenied 0, evicted 0, peakLive under the
 *   honest steady-state bound ≈ 170); hostile rates coalesce (per-lane
 *   ≤ 20/s, global ≤ 64/s counted via probes) and every DENIED hit
 *   still lands a visible reaction (pin + sub-threshold companion —
 *   DD-3's law extended).
 * - THE RETRIGGER REFRESH: an admitted repeat within 120 ms refreshes
 *   (re-births, re-boosts, adopts the new hit's identity) instead of
 *   spawning a duplicate set; boundary closed at exactly 120 ms.
 * - FADE-AND-KILL EVICTION: already-faded objects die first (killing the
 *   invisible is never a visible pop), then the oldest live birth.
 * - THE TAP BOUNDARY (normalizeNoteOn): every degenerate input class is
 *   normalized or dropped — NEVER thrown: zero/negative/non-finite
 *   velocity → the recorded "no reaction" drop, non-finite audibleAt →
 *   dropped, unknown lane → dropped, velocity > 1 → clamped, clean
 *   events pass through as the SAME reference; hostile pitch classes
 *   flow to the engine's canonicalPitch (finite → clamped, non-finite →
 *   the neutral center) and never throw or leak non-finite geometry.
 * - CONTAINMENT: nothing here (or in the engine paths it drives) may
 *   reach the audio side — the policy is pure math on the viz stream.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LANE_IDS, type LaneId } from "../src/document/schema";
import type { VizNoteOn } from "../src/engine/session";
import {
  VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND,
  VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND,
  VIZ_ACCEPT_WINDOW_SECONDS,
  VIZ_FLASH_CEILING_HZ,
  VIZ_FLASH_MERGE_ALPHA,
  VIZ_MAX_LIVE_OBJECTS,
  VIZ_RETRIGGER_REFRESH_SECONDS,
  governHitAcceptance,
  isRetriggerRefresh,
  normalizeNoteOn,
  pruneAcceptWindow,
} from "../src/viz/clamps";
import {
  VIZ_ENVELOPE_SHAPE_GAMMA,
  VIZ_LIVE_BRIGHTNESS_GAIN,
  VIZ_LIVE_TAIL_FLOOR,
  laneLuminanceEqualizer,
  createVizNodeEngine,
  defaultBootArrangement,
  enumerateIgnition,
  visualAmplitudeOf,
  type VizNodeEngineOptions,
} from "../src/viz/nodes";
import type { VizArrangement, VizNode } from "../src/viz/presets";
import { VIZ_MAX_HIT_OBJECTS_PER_LANE } from "../src/viz/vocabulary";
import { createVizPipeline } from "../src/viz/pipeline";

// ---------------------------------------------------------------------------
// Test doubles (the viz-nodes-math precedents, minimal copies)
// ---------------------------------------------------------------------------

const HUES: Record<LaneId, string> = {
  drums: "#f23d4c",
  bass: "#ffb300",
  chords: "#35d07f",
  lead: "#4da6ff",
};

// The colorize equalizer over the committed token hues (drums lifts to the cap).
const EQ = laneLuminanceEqualizer(HUES);

interface RecordedCall {
  readonly op: "blit" | "segment" | "circle";
  readonly hue: string;
  readonly alpha: number;
  readonly numbers: readonly number[];
}

function recorderContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const state = { alpha: 1 };
  let strokeStyle = "";
  let lineWidth = 0;
  let path: number[] = [];
  const ctx = {
    set globalCompositeOperation(_v: string) {
      /* restored by the engine's hygiene law */
    },
    get globalCompositeOperation() {
      return "source-over";
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
      /* implicit */
    },
    set fillStyle(_v: string) {
      /* the pipeline's placeholder band path records nothing */
    },
    setLineDash() {
      /* implicit */
    },
    fillRect() {
      /* implicit */
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function frameOf(width = 1280, height = 960) {
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
): VizNode {
  return {
    id: `t#${kind}#${placement.lane ?? "any"}#${params.decay ?? "d"}`,
    kind,
    placement,
    motion: {},
    params,
  };
}

function makeEngine(
  arrangement: VizArrangement = defaultBootArrangement(),
  over: Partial<VizNodeEngineOptions> = {},
) {
  return createVizNodeEngine({
    arrangement,
    hues: HUES,
    restHue: "#f5f2e9",
    dpr: 1,
    bakeSprite: (hue, halo) => ({ hueTag: `${hue}|${halo.toFixed(3)}` }),
    ...over,
  });
}

/** A single-bloom rig on one lane: exactly ONE object per spawned hit. */
function bloomRig(lane: LaneId | "any", decay = 0.25): VizArrangement {
  return {
    presetId: "t",
    seed: 1,
    nodes: [nodeOf("bloom", { x: 0.5, y: 0.5, lane }, { decay })],
  };
}

// ---------------------------------------------------------------------------
// The committed R1 §3 table + the one-place fence
// ---------------------------------------------------------------------------

describe("VZ-HU-3 constants (R1 §3 — one documented home)", () => {
  it("pins the committed magnitudes", () => {
    expect(VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND).toBe(64);
    expect(VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND).toBe(20);
    expect(VIZ_ACCEPT_WINDOW_SECONDS).toBe(1);
    expect(VIZ_MAX_LIVE_OBJECTS).toBe(192);
    expect(VIZ_RETRIGGER_REFRESH_SECONDS).toBe(0.12);
    // The DD-3 ceiling laws are untouched by this task (regression pin).
    expect(VIZ_FLASH_CEILING_HZ).toBe(3);
    expect(VIZ_FLASH_MERGE_ALPHA).toBe(0.1);
  });

  it("fence: the clamp constants are DEFINED once, in clamps.ts, citing R1", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/viz");
    for (const name of [
      "VIZ_MAX_LIVE_OBJECTS",
      "VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND",
      "VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND",
      "VIZ_RETRIGGER_REFRESH_SECONDS",
    ]) {
      const definers: string[] = [];
      for (const file of [
        "clamps.ts",
        "nodes.ts",
        "pipeline.ts",
        "renderer.ts",
        "vocabulary.ts",
        "presets.ts",
      ]) {
        const src = readFileSync(join(dir, file), "utf8");
        if (src.includes(`export const ${name} =`)) definers.push(file);
      }
      expect(definers).toEqual(["clamps.ts"]); // one place, one rationale
    }
    const clamps = readFileSync(join(dir, "clamps.ts"), "utf8");
    expect(clamps).toContain("r1r2-canvas-perf-dpr.md"); // the citation
    expect(clamps).not.toContain("Math.random"); // determinism contract
  });

  it("burst ≤ 8 counts lane-bound + any-bound nodes COMBINED (the MF-2 P3 fold)", () => {
    // 6 drums-bound + 5 any-bound blooms: 11 candidates, ONE enumeration
    // truncated at the combined cap — the live clamp the P3 note wanted.
    const arrangement: VizArrangement = {
      presetId: "t",
      seed: 1,
      nodes: [
        ...Array.from({ length: 6 }, (_, i) =>
          nodeOf("bloom", { x: 0.1 + i * 0.05, y: 0.5, lane: "drums" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          nodeOf("bloom", { x: 0.6 + i * 0.05, y: 0.5, lane: "any" }),
        ),
      ],
    };
    const seeds = enumerateIgnition(arrangement, hit({ lane: "drums" }));
    expect(seeds.length).toBe(VIZ_MAX_HIT_OBJECTS_PER_LANE); // 8, combined
  });
});

// ---------------------------------------------------------------------------
// governHitAcceptance — the accept-cap governor (pure)
// ---------------------------------------------------------------------------

describe("governHitAcceptance (VZ-HU-3 accept caps, pure)", () => {
  it("accepts into empty windows and records both windows", () => {
    const d = governHitAcceptance([], [], 10);
    expect(d.accepted).toBe(true);
    expect(d.globalWindow).toEqual([10]);
    expect(d.laneWindow).toEqual([10]);
    expect(d.releaseAt).toBe(0);
  });

  it("denies when the GLOBAL window is full (64 in the trailing second)", () => {
    const now = 100;
    const globalWindow = Array.from(
      { length: VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND },
      (_, i) => now - 0.9 + i * 0.001,
    );
    const d = governHitAcceptance(globalWindow, [], now);
    expect(d.accepted).toBe(false);
    expect(d.globalWindow.length).toBe(64);
    expect(d.releaseAt).toBeCloseTo(Math.min(...globalWindow) + 1, 9);
  });

  it("denies when the LANE window is full even with global room", () => {
    const now = 100;
    // 30 accepted globally (room at 64) but ALL 30 on one lane (full at 20).
    const both = Array.from({ length: 30 }, (_, i) => now - 0.9 + i * 0.01);
    const d = governHitAcceptance(both, both, now);
    expect(d.accepted).toBe(false);
    expect(d.releaseAt).toBeCloseTo(Math.min(...both) + 1, 9);
  });

  it("releaseAt = the LATEST-freeing full window when both deny", () => {
    const now = 100;
    const globalWindow = Array.from(
      { length: 64 },
      (_, i) => now - 0.95 + i * 0.001, // oldest ≈ 99.05 → frees 100.05
    );
    const laneWindow = Array.from(
      { length: 20 },
      (_, i) => now - 0.5 + i * 0.001, // oldest ≈ 99.5 → frees 100.5 (later)
    );
    const d = governHitAcceptance(globalWindow, laneWindow, now);
    expect(d.accepted).toBe(false);
    expect(d.releaseAt).toBeCloseTo(100.5, 6);
  });

  it("the closed window: an acceptance EXACTLY one second old still counts", () => {
    const now = 100;
    // 20 lane acceptances, oldest exactly now − 1 → pruned keeps all → full.
    const laneWindow = Array.from(
      { length: VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND },
      (_, i) => now - 1 + i * 0.001,
    );
    expect(governHitAcceptance([], laneWindow, now).accepted).toBe(false);
    // One epsilon older: the window frees (19 remain) → accepted.
    const freed = laneWindow.map((t, i) => (i === 0 ? t - 1e-9 : t));
    expect(governHitAcceptance([], freed, now).accepted).toBe(true);
  });

  it("a non-finite clock read denies with empty windows (never spawns)", () => {
    const d = governHitAcceptance([1, 2], [1], Number.NaN);
    expect(d.accepted).toBe(false);
    expect(d.globalWindow).toEqual([]);
    expect(d.laneWindow).toEqual([]);
    expect(d.releaseAt).toBe(0);
  });

  it("PROPERTY: honest worst-case play (53.33/s global, 13.33/s per lane) NEVER bites", () => {
    // 16ths @ 200 BPM across 4 lanes: a hit every 75 ms, round-robin lanes.
    let global: readonly number[] = [];
    const lanes: Record<string, readonly number[]> = {};
    const step = 0.075;
    for (let k = 0; k < Math.round(60 / step); k++) {
      // 60 s of the densest honest pattern — far past steady state.
      const lane = LANE_IDS[k % LANE_IDS.length]!;
      const t = k * step;
      const d = governHitAcceptance(global, lanes[lane] ?? [], t);
      expect(d.accepted).toBe(true); // the cap never bites honest play
      global = d.globalWindow;
      lanes[lane] = d.laneWindow;
    }
  });
});

describe("pruneAcceptWindow (the shared closed-window law)", () => {
  it("keeps the closed edge, drops expired + non-finite entries, and empties on garbage clocks", () => {
    expect(pruneAcceptWindow([9, 9.5, 10, Number.NaN], 10)).toEqual([
      9,
      9.5,
      10,
    ]);
    expect(pruneAcceptWindow([9, 9.5], 10)).toEqual([9, 9.5]); // 9 === now−1 kept
    expect(pruneAcceptWindow([8.999], 10)).toEqual([]); // just older — gone
    expect(pruneAcceptWindow([1, 2], Number.NaN)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isRetriggerRefresh — the 120 ms same-node window (pure)
// ---------------------------------------------------------------------------

describe("isRetriggerRefresh (the retrigger window, pure)", () => {
  it("accepts a live reaction aged ≤ 120 ms (closed at exactly 120)", () => {
    expect(isRetriggerRefresh(true, 10, 10.119)).toBe(true);
    expect(isRetriggerRefresh(true, 10, 10.12)).toBe(true); // closed window
    expect(isRetriggerRefresh(true, 10, 10.121)).toBe(false);
    expect(isRetriggerRefresh(true, 10, 10)).toBe(true); // age 0 (same tick)
  });

  it("rejects dead light, future births and non-finite clocks", () => {
    expect(isRetriggerRefresh(false, 10, 10.05)).toBe(false); // not live
    expect(isRetriggerRefresh(true, 10, 9.99)).toBe(false); // birth in the future
    expect(isRetriggerRefresh(true, Number.NaN, 10)).toBe(false);
    expect(isRetriggerRefresh(true, 10, Number.NaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeNoteOn — the tap-boundary engine-edge policy (pure)
// ---------------------------------------------------------------------------

describe("normalizeNoteOn (tap-boundary normalization, pure)", () => {
  it("drops the recorded degenerate classes — never queues, never reacts", () => {
    expect(normalizeNoteOn(hit({ velocity: 0 }))).toBeNull(); // the recorded choice
    expect(normalizeNoteOn(hit({ velocity: -0.5 }))).toBeNull();
    expect(normalizeNoteOn(hit({ velocity: Number.NaN }))).toBeNull();
    expect(normalizeNoteOn(hit({ velocity: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(normalizeNoteOn(hit({ audibleAt: Number.NaN }))).toBeNull();
    expect(normalizeNoteOn(hit({ audibleAt: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(normalizeNoteOn(hit({ audibleAt: Number.NEGATIVE_INFINITY }))).toBeNull();
    expect(normalizeNoteOn(hit({ lane: "zebra" as LaneId }))).toBeNull();
    expect(normalizeNoteOn(null as unknown as VizNoteOn)).toBeNull();
    expect(normalizeNoteOn(undefined as unknown as VizNoteOn)).toBeNull();
  });

  it("normalizes over-range velocity and passes clean events as the SAME reference", () => {
    const clamped = normalizeNoteOn(hit({ velocity: 2.5 }));
    expect(clamped).toEqual(hit({ velocity: 1 }));
    const clean = hit({ velocity: 0.03 });
    expect(normalizeNoteOn(clean)).toBe(clean); // zero hot-path allocation
    // Pitch passes through UNTOUCHED (the engine's canonicalPitch owns it).
    const weird = hit({ pitch: Number.NaN });
    expect(normalizeNoteOn(weird)!.pitch).toBe(Number.NaN);
  });
});

// ---------------------------------------------------------------------------
// Engine integration — accept caps before the flash governor
// ---------------------------------------------------------------------------

describe("engine accept caps (VZ-HU-3, ignite consults the policy first)", () => {
  it("PROPERTY: honest worst-case play never exceeds the caps (probes)", () => {
    const engine = makeEngine(); // the default boot rig
    const step = 0.075; // 16ths @ 200 BPM; 4 lanes round-robin = 53.33/s
    let beats = 0;
    for (let k = 0; k < Math.round(8 / step); k++) {
      const t = k * step;
      engine.ignite(
        hit({ lane: LANE_IDS[k % LANE_IDS.length]!, audibleAt: t, pitch: 40 + (k % 50) }),
      );
      if (k % 2 === 0) {
        // Interleave draws like real frames so expired light compacts.
        const rec = recorderContext();
        beats += step * 2;
        engine.onFrame(rec.ctx, frameOf(), t, beats);
      }
    }
    const probe = engine.probe();
    expect(probe.rateDenied).toBe(0); // the caps never bite honest play
    expect(probe.evicted).toBe(0); // 192 unreachable: steady state ≈ 128–170
    expect(probe.peakLive).toBeGreaterThan(0); // activity is real
    // Honest steady-state bound: one-shots ≤ rate 53.34 × burst ≤ 8 ×
    // decay ≤ 0.4 ≈ 171 (the R1 formula) + at most one companion per node.
    expect(probe.peakLive).toBeLessThanOrEqual(
      171 + defaultBootArrangement().nodes.length,
    );
    engine.dispose();
  });

  it("HOSTILE single-lane rate coalesces at the 20/s per-lane cap", () => {
    const engine = makeEngine(bloomRig("drums"));
    for (let k = 0; k < 200; k++) {
      engine.ignite(hit({ audibleAt: 10 + k * 0.01 })); // 100/s for 2 s
    }
    const probe = engine.probe();
    expect(probe.ignited).toBe(200);
    const accepted = probe.ignited - probe.rateDenied;
    expect(probe.rateDenied).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(
      VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND * 2 +
        VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND,
    );
    expect(probe.peakLive).toBeLessThanOrEqual(VIZ_MAX_LIVE_OBJECTS);
    engine.dispose();
  });

  it("HOSTILE 4-lane rate coalesces at the 64/s global cap", () => {
    const engine = makeEngine(bloomRig("any")); // every lane ignites it
    for (let k = 0; k < 800; k++) {
      engine.ignite(
        hit({
          lane: LANE_IDS[k % LANE_IDS.length]!,
          audibleAt: 10 + k * 0.0025, // 400/s global, 2 s span
        }),
      );
    }
    const probe = engine.probe();
    const accepted = probe.ignited - probe.rateDenied;
    expect(probe.rateDenied).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(
      VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND * 2 + VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND,
    );
    expect(probe.live).toBeLessThanOrEqual(VIZ_MAX_LIVE_OBJECTS);
    engine.dispose();
  });

  it("every rate-DENIED hit still lands a visible reaction (pin + companion)", () => {
    const engine = makeEngine(bloomRig("drums"));
    for (let k = 0; k < 100; k++) {
      engine.ignite(hit({ audibleAt: 10 + k * 0.01 })); // 100/s: 20/s accepted
    }
    const probe = engine.probe();
    expect(probe.rateDenied).toBeGreaterThan(0);
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(), 11.001, 4);
    const light = rec.calls.filter((c) => c.alpha > 0 && c.numbers[2]! > 50);
    expect(light.length).toBeGreaterThan(0); // a visible reaction exists
    // The companion: at/below the sub-threshold amplitude (DD-3's branch).
    expect(light.some((c) => c.alpha <= VIZ_FLASH_MERGE_ALPHA)).toBe(true);
    engine.dispose();
  });

  it("a rate-denied hit consumes NO flash admission (the ledgers split)", () => {
    const engine = makeEngine(bloomRig("drums"));
    for (let k = 0; k < 100; k++) {
      engine.ignite(hit({ audibleAt: 10 + k * 0.01 }));
    }
    const probe = engine.probe();
    // With the flash ceiling at 3/s and the rate cap at 20/s, every
    // flash-governed hit was rate-ACCEPTED first: the rate-denied mass
    // coalesced below the governor, so admits + merges counts exactly
    // the rate-accepted hits — the two deniers' ledgers are disjoint.
    expect(probe.flashAdmits + probe.flashMerges).toBe(
      probe.ignited - probe.rateDenied,
    );
    expect(probe.flashAdmits).toBeLessThanOrEqual(6); // ≤ 3/s × 2 s
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Engine integration — the 120 ms retrigger refresh
// ---------------------------------------------------------------------------

describe("engine retrigger refresh (VZ-HU-3, admitted repeats re-birth)", () => {
  it("a roll refreshes ONE object set instead of stacking duplicates", () => {
    const engine = makeEngine(bloomRig("drums")); // 1 object per spawn
    for (let i = 0; i < 10; i++) {
      engine.ignite(hit({ audibleAt: 10 + i * 0.06 })); // 16.7/s, 60 ms apart
    }
    const probe = engine.probe();
    // Flash admits at 10, 10.06, 10.12 (≤ 3/s); the later 7 merge. The
    // 2nd + 3rd admits land within 120 ms of live light → REFRESH.
    expect(probe.flashAdmits).toBe(3);
    expect(probe.flashMerges).toBe(7);
    // ONE rolled object (never stacked) + the denials' ONE companion.
    expect(probe.spawned).toBe(2);
    expect(probe.retriggers).toBe(2);
    expect(probe.live).toBe(2); // the object + the denied companion
    engine.dispose();
  });

  it("boundary: 120 ms exactly refreshes; 121 ms spawns fresh", () => {
    const closed = makeEngine(bloomRig("drums"));
    closed.ignite(hit({ audibleAt: 10 }));
    closed.ignite(hit({ audibleAt: 10.12 }));
    expect(closed.probe().retriggers).toBe(1);
    expect(closed.probe().spawned).toBe(1);
    closed.dispose();

    const open = makeEngine(bloomRig("drums"));
    open.ignite(hit({ audibleAt: 10 }));
    open.ignite(hit({ audibleAt: 10.121 }));
    expect(open.probe().retriggers).toBe(0);
    expect(open.probe().spawned).toBe(2);
    open.dispose();
  });

  it("refresh re-boosts to the max amplitude and adopts the new hit", () => {
    const engine = makeEngine(bloomRig("drums"));
    engine.ignite(hit({ audibleAt: 10, velocity: 0.3, pitch: 45 }));
    engine.ignite(hit({ audibleAt: 10.06, velocity: 0.9, pitch: 119 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(), 10.07, 4);
    const light = rec.calls.find((c) => c.alpha > 0 && c.numbers[2]! > 50);
    expect(light).toBeTruthy();
    // Re-birthed at 10.06 with amplitude max over the visual curve
    // (velocity 0.9 → visualAmplitudeOf(0.9)): linear decay to 0 across
    // the 0.25 s window at 10.07, then the bolder brightness gain —
    // min(1, amp × decayShape × VIZ_LIVE_BRIGHTNESS_GAIN) — and the
    // colorize tail floor over that (floor + (1 − floor) × raw).
    const expected = Math.min(
      1,
      EQ.drums *
        (VIZ_LIVE_TAIL_FLOOR +
          (1 - VIZ_LIVE_TAIL_FLOOR) *
            Math.min(
              1,
              Math.pow(
                visualAmplitudeOf(0.9) * (1 - 0.01 / 0.25),
                VIZ_ENVELOPE_SHAPE_GAMMA,
              ) * VIZ_LIVE_BRIGHTNESS_GAIN,
            )),
    );
    expect(light!.alpha).toBeCloseTo(expected, 6);
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Engine integration — degenerate inputs at the spawn path (hostile table)
// ---------------------------------------------------------------------------

describe("engine engine-edge table (normalize or drop — never throw)", () => {
  const dropped: readonly Partial<VizNoteOn>[] = [
    { velocity: 0 },
    { velocity: -1 },
    { velocity: Number.NaN },
    { velocity: Number.POSITIVE_INFINITY },
    { audibleAt: Number.NaN },
    { audibleAt: Number.POSITIVE_INFINITY },
    { audibleAt: Number.NEGATIVE_INFINITY },
    { lane: "zebra" as LaneId },
  ];

  it.each(dropped)("drops %o with NO reaction", (over) => {
    const engine = makeEngine(bloomRig("any"));
    expect(() => engine.ignite(hit(over))).not.toThrow();
    const probe = engine.probe();
    expect(probe.ignited).toBe(0);
    expect(probe.live).toBe(0);
    expect(probe.spawned).toBe(0);
    engine.dispose();
  });

  it("ignores a null/garbage event object entirely", () => {
    const engine = makeEngine(bloomRig("any"));
    expect(() =>
      engine.ignite(null as unknown as VizNoteOn),
    ).not.toThrow();
    expect(engine.probe().ignited).toBe(0);
    engine.dispose();
  });

  it("normalizes over-range velocity to a full-amplitude reaction", () => {
    const engine = makeEngine(bloomRig("drums"));
    engine.ignite(hit({ velocity: 1e9 }));
    const probe = engine.probe();
    expect(probe.ignited).toBe(1);
    expect(probe.live).toBe(1);
    engine.dispose();
  });

  it("hostile PITCH classes never throw and never leak non-finite geometry", () => {
    const pitches = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1e9,
      -1e9,
      60.5,
    ];
    for (const pitch of pitches) {
      const engine = makeEngine(bloomRig("drums"));
      expect(() => engine.ignite(hit({ pitch }))).not.toThrow();
      expect(engine.probe().ignited).toBe(1);
      const rec = recorderContext();
      expect(() => engine.onFrame(rec.ctx, frameOf(), 10.01, 4)).not.toThrow();
      const light = rec.calls.filter((c) => c.numbers[2]! > 50);
      // The bolder wash: full-alpha cores take ONE blit (the hue-identity
      // law zeroes the second pass at alpha 1); mid-alpha washes take two.
      expect(light.length).toBeGreaterThanOrEqual(1); // the neutral-center/clamped position
      for (const n of light[0]!.numbers) {
        expect(Number.isFinite(n)).toBe(true);
        expect(Number.isInteger(n)).toBe(true); // the drawImage integer law
      }
      engine.dispose();
    }
  });

  it("duplicate audibleAt events coalesce through the retrigger window", () => {
    // Overlapping/duplicate events (same tick, same lane): the second is
    // a still-live same-node repeat at age 0 → REFRESH, never a stack.
    const engine = makeEngine(bloomRig("drums"));
    engine.ignite(hit({ audibleAt: 10, velocity: 0.5 }));
    engine.ignite(hit({ audibleAt: 10, velocity: 0.8 }));
    const probe = engine.probe();
    expect(probe.ignited).toBe(2);
    expect(probe.spawned).toBe(1);
    expect(probe.retriggers).toBe(1);
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Engine integration — fade-and-kill eviction (the safety net)
// ---------------------------------------------------------------------------

describe("engine fade-and-kill eviction (VZ-HU-3)", () => {
  it("kills the ALREADY-FADED object before the older-but-live one", () => {
    // Two blooms on one lane, decay 0.4 (long) + 0.1 (short): the short
    // one's light is expired at 10.15 while the long one is still lit.
    const rig: VizArrangement = {
      presetId: "t",
      seed: 1,
      nodes: [
        nodeOf("bloom", { x: 0.3, y: 0.5, lane: "drums" }, { decay: 0.4 }),
        nodeOf("bloom", { x: 0.7, y: 0.5, lane: "drums" }, { decay: 0.1 }),
      ],
    };
    const engine = makeEngine(rig, { maxLiveObjects: 3 });
    engine.ignite(hit({ audibleAt: 10 })); // 2 objects (both nodes)
    engine.ignite(hit({ audibleAt: 10.15 })); // room for 1: the FADED dies
    const probe = engine.probe();
    expect(probe.evicted).toBe(1);
    // The long-decay survivor + the two fresh spawns are ALL still lit.
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(), 10.16, 4);
    const light = rec.calls.filter((c) => c.alpha > 0 && c.numbers[2]! > 50);
    // All 3 admitted washes still lit (1 blit each at full alpha, 2 while
    // mid-decay — the bolder wash's hue-identity second pass).
    expect(light.length).toBeGreaterThanOrEqual(3); // oldest-first alone would have left 2
    engine.dispose();
  });

  it("sustained overload holds the registry at the 192 hard cap", () => {
    const engine = makeEngine(bloomRig("any")); // ignites from every lane
    // 4 lanes × 100/s for 4 s: accepted ≤ 64/s, every spawn evicts as
    // needed — the registry can never exceed VIZ_MAX_LIVE_OBJECTS.
    for (let k = 0; k < 1600; k++) {
      engine.ignite(
        hit({ lane: LANE_IDS[k % LANE_IDS.length]!, audibleAt: 10 + k * 0.0025 }),
      );
    }
    const probe = engine.probe();
    expect(probe.rateDenied).toBeGreaterThan(0);
    expect(probe.peakLive).toBeLessThanOrEqual(VIZ_MAX_LIVE_OBJECTS);
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// The tap boundary — pipeline normalizes BEFORE queue insert
// ---------------------------------------------------------------------------

describe("pipeline tap boundary (VZ-HU-3 wiring)", () => {
  function tapped() {
    let noteListener: ((noteOn: VizNoteOn) => void) | null = null;
    const pipeline = createVizPipeline({
      subscribeNoteOns: (l) => {
        noteListener = l;
        return () => undefined;
      },
      subscribeTransport: () => () => undefined,
      audioTime: () => 0,
      laneHues: HUES,
    });
    const tap = (over: Partial<VizNoteOn>) =>
      noteListener!(hit({ audibleAt: 100, ...over }));
    return { pipeline, tap };
  }

  it("degenerate taps never reach the queue", () => {
    const { pipeline, tap } = tapped();
    tap({ velocity: 0 });
    tap({ velocity: Number.NaN });
    tap({ audibleAt: Number.NaN });
    tap({ audibleAt: Number.POSITIVE_INFINITY });
    tap({ lane: "zebra" as LaneId });
    expect(pipeline.probe().queued).toBe(0);
    tap({ velocity: 5 }); // over-range: normalized, kept
    expect(pipeline.probe().queued).toBe(1);
    tap({ velocity: 0.5, audibleAt: 101 });
    expect(pipeline.probe().queued).toBe(2);
    pipeline.dispose();
  });

  it("a normalized over-range tap drains with velocity clamped to 1", () => {
    const { pipeline, tap } = tapped();
    tap({ velocity: 7, audibleAt: 0 }); // due immediately at clock 0
    const rec = recorderContext();
    pipeline.onFrame(rec.ctx, frameOf(800, 600));
    expect(pipeline.probe().drained).toBe(1);
    pipeline.dispose();
  });
});

// ---------------------------------------------------------------------------
// The colorize tail floor (2026-09-05 refinement entry 5)
// ---------------------------------------------------------------------------

describe("the colorize live tail floor — red never sinks into the ground", () => {
  it("admitted light at full peak still draws at exactly 1 (the peak anchor)", () => {
    const engine = makeEngine(bloomRig("drums"));
    engine.ignite(hit({ audibleAt: 10, velocity: 1 }));
    const rec = recorderContext();
    engine.onFrame(rec.ctx, frameOf(), 10.001, 4);
    // The live bloom (big diameter) — not the lane-hued static rest mark.
    const light = rec.calls.find((c) => c.alpha > 0 && c.numbers[2]! > 50);
    expect(light).toBeTruthy();
    expect(light!.alpha).toBeCloseTo(1, 9);
    engine.dispose();
  });

  it("the decay tail sustains at the floor until the exactly-zero expiry", () => {
    const engine = makeEngine(bloomRig("drums"));
    engine.ignite(hit({ audibleAt: 10, velocity: 0.9 }));
    // Deep tail: 0.24 s into a 0.25 s window — pre-floor this drew at
    // shaped(≈0.027) ≈ 0.14 × gain; the floor keeps the minimum above it.
    const mid = recorderContext();
    engine.onFrame(mid.ctx, frameOf(), 10.24, 4);
    const alpha = mid.calls.find((c) => c.alpha > 0 && c.numbers[2]! > 50)!.alpha;
    expect(alpha).toBeGreaterThanOrEqual(VIZ_LIVE_TAIL_FLOOR);
    // Exact law: floor + (1 − floor) × shaped(level) × gain (clamped ≤ 1).
    const expected = Math.min(
      1,
      EQ.drums *
        (VIZ_LIVE_TAIL_FLOOR +
          (1 - VIZ_LIVE_TAIL_FLOOR) *
            Math.min(
              1,
              Math.pow(
                visualAmplitudeOf(0.9) * (1 - 0.24 / 0.25),
                VIZ_ENVELOPE_SHAPE_GAMMA,
              ) * VIZ_LIVE_BRIGHTNESS_GAIN,
            )),
    );
    expect(alpha).toBeCloseTo(expected, 6);
    // Past the window: exactly-zero expiry still drops the object (the
    // floor LIFTS the tail, never the lifetime).
    const after = recorderContext();
    engine.onFrame(after.ctx, frameOf(), 10.26, 4);
    expect(after.calls.filter((c) => c.alpha > 0 && c.numbers[2]! > 50)).toHaveLength(0);
    engine.dispose();
  });

  it("every lane's tail takes the same floor (no lane regresses)", () => {
    for (const lane of ["drums", "bass", "chords", "lead"] as const) {
      const engine = makeEngine(bloomRig(lane));
      engine.ignite(hit({ lane, audibleAt: 10, velocity: 0.4 }));
      const rec = recorderContext();
      engine.onFrame(rec.ctx, frameOf(), 10.24, 4);
      const light = rec.calls.find(
        (c) => c.alpha > 0 && c.hue.startsWith(HUES[lane]) && c.numbers[2]! > 50,
      );
      expect(light, `${lane} drew in its token hue`).toBeTruthy();
      expect(light!.alpha).toBeGreaterThanOrEqual(
        EQ[lane] * VIZ_LIVE_TAIL_FLOOR,
      );
      engine.dispose();
    }
  });
});
