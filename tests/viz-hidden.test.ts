/**
 * VZ-TH-3 unit tests — the HIDDEN-PAGE HIT POLICY (R3's confirmed
 * drop-and-resync refined, docs/ultron/research/r3-hidden-page-policy.md):
 * clear the queue on hide, NEVER gate inserts, drain-side stale-drop with
 * the shared GRACE (VIZ_STALE_GRACE_SECONDS, VZ-TH-1's constant), first
 * visible frame recomputes from the audio clock — no catch-up, no replay,
 * ever (perf-budget.md §6's refocus contract extended to hits).
 *
 * Every mechanism is driven PURE: the clock is the test's fake, the
 * visibility seam is a captured listener (the viz-pipeline.test.ts
 * injected-seam idiom), and the derived-state modules (phase controller,
 * node engine) are stepped across synthetic 30 s gaps — the parked rAF
 * loop is exactly "no onFrame calls for a while", which is all a hidden
 * page is to these modules. The BUILT-app journey with synthetic
 * visibilitychange is tests/browser/viz-hidden.test.tsx (honesty caveat:
 * real browser-level rAF parking in a genuinely hidden tab is
 * human-session verified, the standing TH-3 convention).
 *
 * What is pinned here mechanically:
 * - HIDE CLEARS: a visibilitychange → hidden empties the queue — events
 *   pending at the hide never fire after the return.
 * - INSERTS NEVER GATED: future-dated events keep queueing while hidden,
 *   bounded oldest-first by the queue's capacity, and the queue still
 *   fires them correctly after the return.
 * - NO BURST ON RETURN: a 30 s hidden gap at the worst-case 53⅓ events/s
 *   delivers ~1600 events into the queue; the first visible frame fires
 *   ZERO of them, and the next FUTURE event fires within GRACE of its
 *   audible time. The fast tab-flap edge (an event delivered just before
 *   a brief hide) is covered by the same grace.
 * - LISTENER INDEPENDENCE: with NO visibility seam at all (the
 *   visibilitychange-never-fired risk, R3 §5), the drain-side stale rule
 *   alone still prevents any burst — correctness never depends on the
 *   hide listener.
 * - PHASE RESYNC: the controller's trailing window prunes on the first
 *   post-gap update (audio-clock domain), the hysteresis classifier decays
 *   ONE step per update toward rest, and the level ease advances at most
 *   VIZ_PHASE_EASE_MAX_DT_SECONDS worth per update — no level jump at the
 *   gap, exact snap after.
 * - ENVELOPE RESYNC: node envelopes are f(nowAudio − birth) — after a gap
 *   exceeding every decay window the first frame back culls the expired
 *   objects (registry compacts) and draws ONLY the still diagram, never a
 *   replayed end-state.
 * - FENCES: the grace literal lives in offsetQueue only (never restated
 *   in the pipeline), the grid renderer's stepsCrossed catch-up glow is
 *   documented as NOT imported, no clock reads, no Math.random, dispose
 *   unsubscribes the visibility seam exactly once.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { LaneId } from "../src/document/schema";
import type { VizNoteOn } from "../src/engine/session";
import {
  activeVizPipelines,
  createVizPipeline,
} from "../src/viz/pipeline";
import { VIZ_STALE_GRACE_SECONDS } from "../src/viz/offsetQueue";
import {
  createVizPhaseController,
  VIZ_PHASE_EASE_MAX_DT_SECONDS,
  VIZ_PHASE_EASE_TAU_SECONDS,
  VIZ_PHASE_LEVELS,
  type VizPhaseController,
} from "../src/viz/phases";
import {
  createVizNodeEngine,
  defaultBootArrangement,
  type VizNodeEngine,
  type VizNodeEngineOptions,
} from "../src/viz/nodes";
import type { VizFrameInfo } from "../src/viz/renderer";

// ---------------------------------------------------------------------------
// Test doubles (plain objects — node env, no DOM/Web Audio)
// ---------------------------------------------------------------------------

const HUES: Record<LaneId, string> = {
  drums: "#f23d4c",
  bass: "#ffb300",
  chords: "#35d07f",
  lead: "#4da6ff",
};

/** A recording 2d-context stub for the pipeline's flash draw path. */
function flashRecorder(): {
  ctx: CanvasRenderingContext2D;
  fills: { style: string; alpha: number }[];
} {
  const fills: { style: string; alpha: number }[] = [];
  let alpha = 1;
  let style = "";
  const ctx = {
    set globalAlpha(v: number) {
      alpha = v;
    },
    get globalAlpha() {
      return alpha;
    },
    set fillStyle(v: string) {
      style = v;
    },
    get fillStyle() {
      return style;
    },
    fillRect() {
      fills.push({ style, alpha });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

/** The full injected-seam harness: captured listeners + fake audio clock. */
function wired(withVisibility = true) {
  let noteListener: ((n: VizNoteOn) => void) | null = null;
  let visibilityListener: ((hidden: boolean) => void) | null = null;
  const unsubNotes = vi.fn();
  const unsubTransport = vi.fn();
  const unsubVisibility = vi.fn();
  const clock = { now: Number.NaN };
  const pipeline = createVizPipeline({
    subscribeNoteOns: (l) => {
      noteListener = l;
      return unsubNotes;
    },
    subscribeTransport: () => unsubTransport,
    ...(withVisibility
      ? {
          subscribeVisibility: (l: (hidden: boolean) => void) => {
            visibilityListener = l;
            return unsubVisibility;
          },
        }
      : {}),
    audioTime: () => clock.now,
    laneHues: HUES,
  });
  const { ctx, fills } = flashRecorder();
  const frame = (): VizFrameInfo => ({
    index: 0,
    width: 800,
    height: 600,
    dpr: 1,
    time: 0,
  });
  return {
    pipeline,
    clock,
    fills,
    draw: () => pipeline.onFrame(ctx, frame()),
    tap: (lane: LaneId, audibleAt: number, velocity = 0.8): void =>
      noteListener!({ lane, pitch: 60, velocity, audibleAt }),
    hide: () => visibilityListener?.(true),
    show: () => visibilityListener?.(false),
    unsubNotes,
    unsubTransport,
    unsubVisibility,
  };
}

/** The worst-case dense rate: 16ths @ 200 BPM × 4 lanes = 53⅓ events/s. */
const DENSE_STEP_SECONDS = 0.01875;

// ---------------------------------------------------------------------------
// Hide clears — the policy's single hide action
// ---------------------------------------------------------------------------

describe("VZ-TH-3 hide clears the queue (never fires the pre-hide pending)", () => {
  it("a visibilitychange → hidden empties pending future events; they never fire after the return", () => {
    const t = wired();
    t.clock.now = 10;
    t.tap("drums", 11);
    t.tap("bass", 11.5);
    t.tap("lead", 12);
    expect(t.pipeline.probe().queued).toBe(3);
    t.hide(); // the HIDE entry action: clear, synchronously with the event
    expect(t.pipeline.probe().queued).toBe(0);
    t.show();
    t.clock.now = 12;
    t.draw();
    expect(t.fills).toHaveLength(0);
    expect(t.pipeline.probe().drained).toBe(0);
  });

  it("hide with an empty queue is a no-op; show never clears (post-show inserts stay held)", () => {
    const t = wired();
    t.clock.now = 10;
    t.hide();
    expect(t.pipeline.probe().queued).toBe(0); // no throw, nothing to do
    t.show();
    t.tap("drums", 11);
    t.tap("chords", 11.2);
    expect(t.pipeline.probe().queued).toBe(2); // show has NO clear action
    t.clock.now = 11;
    t.draw();
    expect(t.pipeline.probe().drained).toBe(1); // queue still functional
  });

  it("the visibility seam unsubscribes exactly once at dispose (no leaked listener); the registry empties", () => {
    // Earlier tests in this file wired pipelines without disposing — clear
    // the registry's leftovers so this test asserts ITS instance only.
    for (const p of activeVizPipelines()) p.dispose();
    expect(activeVizPipelines()).toHaveLength(0);
    const t = wired();
    expect(activeVizPipelines()).toHaveLength(1);
    expect(activeVizPipelines()[0]).toBe(t.pipeline);
    t.pipeline.dispose();
    t.pipeline.dispose(); // idempotent
    expect(t.unsubVisibility).toHaveBeenCalledTimes(1);
    expect(t.unsubNotes).toHaveBeenCalledTimes(1);
    expect(t.unsubTransport).toHaveBeenCalledTimes(1);
    expect(activeVizPipelines()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Inserts are never gated while hidden
// ---------------------------------------------------------------------------

describe("VZ-TH-3 inserts are NEVER gated while hidden (bounded by the queue's capacity)", () => {
  it("future-dated events keep queueing while hidden, oldest-first bounded, and fire correctly after the return", () => {
    const t = wired();
    t.clock.now = 10;
    t.hide();
    // The audible-tab delivery shape: the tap keeps emitting at schedule
    // time while hidden (audio tabs are timer-throttle-exempt).
    for (let i = 0; i < 200; i++) {
      t.tap("drums", 10 + i * DENSE_STEP_SECONDS, 0.5);
    }
    expect(t.pipeline.probe().queued).toBe(96); // capacity bound holds
    t.show();
    // The retained (newest 96) events still fire at their audible times:
    // the oldest retained is index 104 (audibleAt 10 + 104 × 18.75 ms).
    t.clock.now = 10 + 104 * DENSE_STEP_SECONDS;
    t.draw();
    expect(t.pipeline.probe().drained).toBe(1);
    expect(t.fills).toHaveLength(1);
    expect(t.fills[0]!.style).toBe(HUES.drums);
  });
});

// ---------------------------------------------------------------------------
// The return: drop-and-resync, no burst, no catch-up
// ---------------------------------------------------------------------------

describe("VZ-TH-3 visible resync — stale drops, never bursts (the 30 s gap at 53⅓ events/s)", () => {
  it("zero fires from the gap; the next FUTURE event fires within GRACE of its audible time", () => {
    const t = wired();
    const HIDE_AT = 100;
    const RETURN_AT = 130; // a 30 s hidden window
    t.clock.now = HIDE_AT;
    t.hide(); // clears (hygiene) — the enforcement is below
    // ~1595 events delivered while hidden (audible times strictly inside
    // the gap, all more than GRACE behind the return clock).
    const count = Math.floor((RETURN_AT - HIDE_AT - 0.1) / DENSE_STEP_SECONDS);
    expect(count).toBeGreaterThan(1500); // honest worst-case density
    for (let i = 0; i < count; i++) {
      t.tap("lead", HIDE_AT + i * DENSE_STEP_SECONDS, 0.6);
    }
    expect(t.pipeline.probe().queued).toBe(96); // held, bounded, ungated
    // The first visible frame: recomputes from ctx.currentTime (RETURN_AT)
    // and drops EVERY gap event as stale — zero fires, zero fills.
    t.show();
    t.clock.now = RETURN_AT;
    t.draw();
    expect(t.fills).toHaveLength(0);
    expect(t.pipeline.probe().drained).toBe(0);
    expect(t.pipeline.probe().queued).toBe(0); // stale mass removed at drain
    // The resync: the show resumes in sync with what is audible NOW — the
    // next future event fires exactly at its crossing, never before.
    t.tap("bass", RETURN_AT + 0.05);
    t.clock.now = RETURN_AT + 0.049;
    t.draw();
    expect(t.pipeline.probe().drained).toBe(0); // never early — the law
    t.clock.now = RETURN_AT + 0.05;
    t.draw();
    expect(t.pipeline.probe().drained).toBe(1); // exactly at the crossing
    expect(t.fills).toHaveLength(1);
    expect(t.fills[0]!.style).toBe(HUES.bass);
  });

  it("the grace boundaries on the return drain: just-inside fires, just-outside drops", () => {
    const t = wired();
    t.clock.now = 10;
    t.hide();
    t.tap("drums", 10.02); // delivered while hidden, due just after the flap
    t.show();
    t.clock.now = 10.02 + VIZ_STALE_GRACE_SECONDS - 0.001;
    t.draw();
    expect(t.pipeline.probe().drained).toBe(1); // inside GRACE → fires
    t.hide();
    t.tap("chords", 10.5);
    t.show();
    t.clock.now = 10.5 + VIZ_STALE_GRACE_SECONDS + 0.001;
    t.draw();
    expect(t.pipeline.probe().drained).toBe(1); // outside GRACE → dropped
    expect(t.fills).toHaveLength(1); // only the first (in-grace) event drew
  });

  it("correctness never depends on the hide listener: with NO visibility seam a whole-gap backlog still never bursts", () => {
    const t = wired(false); // the visibilitychange-never-fired risk (R3 §5)
    const HIDE_AT = 100;
    const RETURN_AT = 130;
    t.clock.now = HIDE_AT;
    const count = Math.floor((RETURN_AT - HIDE_AT - 0.1) / DENSE_STEP_SECONDS);
    for (let i = 0; i < count; i++) {
      t.tap("drums", HIDE_AT + i * DENSE_STEP_SECONDS, 0.6);
    }
    expect(t.pipeline.probe().queued).toBe(96); // nothing cleared — held
    t.clock.now = RETURN_AT;
    t.draw(); // the drain-side stale rule alone enforces the policy
    expect(t.fills).toHaveLength(0);
    expect(t.pipeline.probe().drained).toBe(0);
    expect(t.pipeline.probe().queued).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase resync — the trailing window is audio-clock-derived, never accumulated
// ---------------------------------------------------------------------------

describe("VZ-TH-3 phase state across a long hidden gap (derived, not replayed)", () => {
  function phaseCtl(initialPlaying = true): {
    ctl: VizPhaseController;
    levels: Array<[number, number]>;
  } {
    const levels: Array<[number, number]> = [];
    const ctl = createVizPhaseController({
      subscribeTransport: () => () => {},
      initialPlaying,
      onLevels: (restLevel, liveGain) => levels.push([restLevel, liveGain]),
    });
    return { ctl, levels };
  }

  it("the window prunes on the first post-gap update; hysteresis decays ONE step per update toward rest", () => {
    const { ctl } = phaseCtl();
    // Drive to `full`: 11 hits/s sustained (the demo's density) over 4.5 s,
    // one controller update per hit — the classifier climbs one step at a
    // time as the trailing rate ramps through the enter thresholds.
    for (let i = 0; i < 50; i++) {
      const now = i * 0.09;
      ctl.note(now);
      ctl.update(now);
    }
    expect(ctl.probe().phase).toBe("full");
    // The 30 s gap: no note(), no update() — a parked rAF loop.
    // First visible update at now = 34.5: the ring prunes to the EMPTY
    // trailing window (audio-clock domain), rate reads 0, and the
    // classifier steps DOWN exactly one phase (full → working).
    ctl.update(34.5);
    expect(ctl.probe().rate).toBe(0); // recomputed from the clock, not stale
    expect(ctl.probe().phase).toBe("working");
    ctl.update(34.6);
    expect(ctl.probe().phase).toBe("sparse");
    ctl.update(34.7);
    expect(ctl.probe().phase).toBe("rest");
    ctl.update(34.8);
    expect(ctl.probe().phase).toBe("rest"); // clamped at the arc's floor
    // The noted ledger survives the gap (evidence, never reset by time).
    expect(ctl.probe().noted).toBe(50);
  });

  it("no level jump at the gap: the ease advances at most MAX_DT worth, then snaps exact", () => {
    const { ctl, levels } = phaseCtl();
    // Drive to `sparse` (2.5 hits/s) and settle: liveGain snaps to its target.
    for (let i = 0; i < 40; i++) {
      const now = i * 0.4;
      ctl.note(now);
      ctl.update(now);
    }
    expect(ctl.probe().phase).toBe("sparse");
    const settled = VIZ_PHASE_LEVELS.sparse.liveGain; // 0.86 (bolder recalibration)
    expect(ctl.probe().liveGain).toBe(settled); // settled exact (snap law)
    // The 30 s gap: first update has dt = 30 s but the ease is CLAMPED at
    // VIZ_PHASE_EASE_MAX_DT_SECONDS — the level moves one clamped step
    // toward the (empty-window → idle) targets, never a jump to them.
    ctl.update(16 + 30);
    const expected =
      settled + (1 - settled) * (1 - Math.exp(-VIZ_PHASE_EASE_MAX_DT_SECONDS / VIZ_PHASE_EASE_TAU_SECONDS));
    expect(ctl.probe().liveGain).toBeCloseTo(expected, 12);
    expect(ctl.probe().liveGain).toBeLessThan(1); // no jump across the gap
    expect(ctl.probe().restLevel).toBe(1); // phase-invariant still diagram
    // Successive post-gap frames complete the ease and SNAP exact.
    for (let f = 1; f <= 40; f++) ctl.update(46 + f / 60);
    expect(ctl.probe().liveGain).toBe(1);
    const last = levels[levels.length - 1]!;
    expect(Number.isFinite(last[0])).toBe(true);
    expect(Number.isFinite(last[1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Envelope resync — expired objects cull, nothing replays
// ---------------------------------------------------------------------------

describe("VZ-TH-3 node envelopes across a long hidden gap (f(now − birth), no replayed end-states)", () => {
  /** Minimal engine harness: stub baker + recording ctx (node env). */
  function makeEngine(over: Partial<VizNodeEngineOptions> = {}): VizNodeEngine {
    return createVizNodeEngine({
      arrangement: defaultBootArrangement(),
      hues: HUES,
      restHue: "#f5f2e9",
      dpr: 1,
      bakeSprite: (hue, halo) =>
        ({ hueTag: `${hue}|${halo.toFixed(3)}` }) as unknown as CanvasImageSource,
      ...over,
    });
  }

  /** A recording 2d-context stub covering the engine's draw surface. */
  function recorderContext(): {
    ctx: CanvasRenderingContext2D;
    calls: { op: string; hue: string; alpha: number; numbers: number[] }[];
  } {
    const calls: { op: string; hue: string; alpha: number; numbers: number[] }[] =
      [];
    const state = { alpha: 1 };
    let strokeStyle = "";
    let lineWidth = 0;
    let path: number[] = [];
    const ctx = {
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
      setLineDash() {
        /* restored-state hygiene call; nothing to record */
      },
      drawImage(sprite: unknown, x: number, y: number, w: number, h: number) {
        calls.push({
          op: "blit",
          hue: (sprite as { hueTag: string }).hueTag,
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
          op: "segment",
          hue: strokeStyle,
          alpha: state.alpha,
          numbers: [...path, lineWidth],
        });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  const frameOf = (width = 1280, height = 960): VizFrameInfo => ({
    index: 0,
    width,
    height,
    dpr: 1,
    time: 0,
  });

  it("live light before the gap; the first frame 30 s later draws ONLY the still diagram (expired culled)", () => {
    const engine = makeEngine();
    engine.ignite({ lane: "bass", pitch: 48, velocity: 1, audibleAt: 100 });
    const lit = recorderContext();
    engine.onFrame(lit.ctx, frameOf(), 100.05, 4.2); // 50 ms into the decay
    expect(engine.probe().live).toBeGreaterThan(0);
    expect(lit.calls.length).toBeGreaterThan(0);
    // The gap: 30 s with no frames. Envelopes are f(nowAudio − birth): the
    // first visible frame culls every expired object (registry compacts)
    // and draws exactly the still diagram — never their end-states.
    const gap = recorderContext();
    engine.onFrame(gap.ctx, frameOf(), 130, 55);
    expect(engine.probe().live).toBe(0);
    const restOnly = recorderContext();
    makeEngine().onFrame(restOnly.ctx, frameOf(), 130, 55); // never ignited
    expect(gap.calls).toEqual(restOnly.calls); // rest rig, byte-identical
  });

  it("a held (pinned) object outlasted by the gap is culled the same way — no resurrected flash", () => {
    const engine = makeEngine();
    // Sustain a node with hits every 60 ms (all within the 120 ms
    // retrigger window — one rolling object)…
    for (let k = 0; k < 10; k++) {
      engine.ignite({ lane: "bass", pitch: 48, velocity: 1, audibleAt: 100 + k * 0.06 });
    }
    expect(engine.probe().live).toBeGreaterThan(0);
    // …then hide past every possible pin + decay window (max decay 0.4 s,
    // pin release ≤ the 1 s trailing window + one decay).
    const gap = recorderContext();
    engine.onFrame(gap.ctx, frameOf(), 130, 55);
    expect(engine.probe().live).toBe(0);
    const restOnly = recorderContext();
    makeEngine().onFrame(restOnly.ctx, frameOf(), 130, 55);
    expect(gap.calls).toEqual(restOnly.calls);
  });
});

// ---------------------------------------------------------------------------
// Module fences (source-pinned — the VZ-TH-1/VZ-MF-1 pattern)
// ---------------------------------------------------------------------------

describe("VZ-TH-3 module fences (one policy, explicitly bounded)", () => {
  const SOURCE = readFileSync("src/viz/pipeline.ts", "utf8");
  const PAGE_SOURCE = readFileSync("src/components/VizPage.tsx", "utf8");

  it("documents the grid stepsCrossed catch-up glow as NOT imported (the intentional divergence)", () => {
    expect(SOURCE).toMatch(/stepsCrossed/);
    expect(SOURCE).toMatch(/NOT imported/);
    expect(SOURCE).not.toMatch(/from\s+"\.\.\/grid/); // and truly not imported
  });

  it("never restates the grace constant — 0.032 lives in offsetQueue only, imported through the drain", () => {
    expect(SOURCE).not.toMatch(/0\.032/);
    expect(SOURCE).toMatch(/VIZ_STALE_GRACE_SECONDS/);
  });

  it("the product wiring passes the visibility seam (VizPage → document.visibilitychange)", () => {
    expect(PAGE_SOURCE).toMatch(/subscribeVisibility/);
    expect(PAGE_SOURCE).toMatch(/visibilitychange/);
  });

  it("no clock reads, no Math.random (the determinism contract)", () => {
    for (const src of [SOURCE, PAGE_SOURCE]) {
      expect(src).not.toMatch(/Math\.random\s*\(/);
      expect(src).not.toMatch(/Date\.now|performance\.now|new Date\s*\(/);
    }
  });
});
