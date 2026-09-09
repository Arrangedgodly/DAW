/**
 * VZ-IM-6 unit tests — the density-phase classifier and idle calm state
 * (src/viz/phases.ts): the trailing hit-rate window, the HYSTERESIS
 * classifier (density windows → phase, the AC's "label doesn't flicker"),
 * the frozen level table + label map, the gradual/steady easing law, the
 * controller wiring object (every effect injected, every time an
 * argument — the offsetQueue/pipeline purity precedents), and the
 * ENGINE-LEVEL MAPPING through the seams VZ-IM-5 exposed for exactly
 * this task (setRestLevel/setLiveGain read back through the engine's
 * probe). The built-app journey (arc + idle near-static pixels + labels
 * on the real announcement path) lives in
 * tests/browser/viz-phases.test.tsx.
 *
 * What is pinned here mechanically:
 * - THE MEASUREMENT: the closed trailing window [now−2 s, now] counts
 *   both boundary instants, drops non-finite garbage, reads 0 without a
 *   clock; the ring cap bounds pathological bursts.
 * - THE CLASSIFIER TABLE: enter thresholds are INCLUSIVE (≥ 1.5 / 4.5 /
 *   9.5 hits/s), stay thresholds hold AT the rate (leave strictly below
 *   0.75 / 2.25 / 4.75), ONE step per call in both directions, and a
 *   rate oscillating INSIDE a hysteresis gap never toggles the phase —
 *   the anti-flicker law.
 * - THE CALIBRATION (the recorded production decision): exact frozen
 *   (restLevel, liveGain) numbers — the arc raises LIVEGAIN monotonically
 *   (calm-dark → full-light), the still diagram is PHASE-INVARIANT
 *   (restLevel 1 everywhere: a global diagram ease would move every
 *   lane's rest marks when any lane's first hit engages the arc, and the
 *   songbook staggers its lanes — the per-lane never-early law pins it),
 *   and IDLE = the engine's authored (1, 1) defaults — no level ever
 *   moves while idle (the two-boot fingerprint baseline holds by
 *   construction; a stop eases liveGain back to authored so the tail
 *   decays at full brightness).
 * - THE ENGAGEMENT LAW: the transport edge alone never moves the stage —
 *   arc targets apply only once a hit has DRAINED (Law A: no pixel
 *   change may precede a hit's audible time).
 * - THE EASE: exponential approach with exact SNAP (settled = exact, so
 *   a settled idle is pixel-static), dt parks at zero/non-finite,
 *   reduced STEPS instantly (DD-3: state changes, never animation),
 *   per-update dt clamped, never overshoots.
 * - THE CONTROLLER: parked on NaN clock (levels keep the engine's
 *   authored defaults until a clock exists), the stopped transport edge
 *   IS idle (ring cleared, arc re-armed from rest), full motion NEVER
 *   announces (DD-2's verified silence law — labels speak under reduce
 *   only, exactly once per change), onLevels fires only on change, and
 *   the same script is deterministic across two controllers.
 * - FENCES (real-source greps, the viz-reduced-motion precedent): no
 *   Math.random / Date.now / performance.now in the module; the module
 *   never touches DOM globals (pure by construction).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  activeVizPhaseControllers,
  classifyVizPhase,
  createVizPhaseController,
  easeLevelToward,
  trailingHitRate,
  vizPhaseLabel,
  vizPhaseLevels,
  vizPhaseTargets,
  VIZ_PHASE_EASE_MAX_DT_SECONDS,
  VIZ_PHASE_EASE_SNAP,
  VIZ_PHASE_EASE_TAU_SECONDS,
  VIZ_PHASE_FULL_ENTER_HPS,
  VIZ_PHASE_FULL_STAY_HPS,
  VIZ_PHASE_LEVELS,
  VIZ_PHASE_LABEL_PREFIX,
  VIZ_PHASE_RING_CAP,
  VIZ_PHASE_SPARSE_ENTER_HPS,
  VIZ_PHASE_SPARSE_STAY_HPS,
  VIZ_PHASE_WINDOW_SECONDS,
  VIZ_PHASE_WORKING_ENTER_HPS,
  VIZ_PHASE_WORKING_STAY_HPS,
  type VizDensityPhase,
  type VizPhaseControllerOptions,
} from "../src/viz/phases";
import {
  createVizNodeEngine,
  defaultBootArrangement,
  activeVizNodeEngines,
} from "../src/viz/nodes";

// ---------------------------------------------------------------------------
// Recorded seams (the pipeline/summarizer test idiom)
// ---------------------------------------------------------------------------

interface Harness {
  readonly controller: ReturnType<typeof createVizPhaseController>;
  readonly levels: Array<{ readonly restLevel: number; readonly liveGain: number }>;
  readonly labels: string[];
  readonly unsubscribed: () => number;
  /** Test-side transport push (the real seam is session.subscribe). */
  push(playing: boolean): void;
}

function createHarness(
  opts: Partial<VizPhaseControllerOptions> & { initialPlaying?: boolean } = {},
): Harness {
  const levels: Harness["levels"] = [];
  const labels: string[] = [];
  const listeners: Array<(snapshot: { readonly playing: boolean }) => void> = [];
  let unsubs = 0;
  const controller = createVizPhaseController({
    subscribeTransport: (listener) => {
      listeners.push(listener); // runs synchronously at creation
      return () => {
        unsubs++;
      };
    },
    initialPlaying: opts.initialPlaying ?? false,
    onLevels:
      opts.onLevels ??
      ((restLevel, liveGain) => levels.push({ restLevel, liveGain })),
    onPhaseLabel: opts.onPhaseLabel ?? ((text) => labels.push(text)),
    reducedMotion: opts.reducedMotion,
  });
  return {
    controller,
    levels,
    labels,
    unsubscribed: () => unsubs,
    push(playing: boolean): void {
      for (const l of listeners) l({ playing });
    },
  };
}

/**
 * The demo-shaped climb script: 60 fps frames, one hit every 5th frame
 * (12 hits/s — the demo's sustained groove class), driven through
 * note+update pairs; returns the phase-per-update sequence and the final
 * audio clock (so follow-up steps continue the timeline exactly).
 */
function driveClimb(
  h: Harness,
  opts: { seconds?: number; startAt?: number } = {},
): { phases: VizDensityPhase[]; t: number } {
  const seconds = opts.seconds ?? 4;
  const startAt = opts.startAt ?? 100; // an arbitrary finite audio clock
  const phases: VizDensityPhase[] = [];
  let t = startAt;
  h.push(true); // the running edge
  h.controller.update(t); // first update records `now` (dt 0, no move)
  const dt = 1 / 60;
  for (let frame = 1; frame <= Math.round(seconds / dt); frame++) {
    t += dt;
    if (frame % 5 === 0) h.controller.note(t); // 12 hits/s
    h.controller.update(t);
    phases.push(h.controller.probe().phase as VizDensityPhase);
  }
  return { phases, t };
}

// ---------------------------------------------------------------------------
// The measurement: trailingHitRate
// ---------------------------------------------------------------------------

describe("VZ-IM-6 trailingHitRate (the measurement)", () => {
  it("counts hits inside the closed window, both boundaries inclusive", () => {
    const now = 100;
    const ats = [now - VIZ_PHASE_WINDOW_SECONDS, now, now - 1, now - 3];
    // Closed [98, 100]: 98 and 100 both count, 97 (i.e. now−3) does not.
    expect(trailingHitRate(ats, now)).toBe(3 / VIZ_PHASE_WINDOW_SECONDS);
  });

  it("reads 0 for an empty window, a non-finite clock, or garbage entries", () => {
    expect(trailingHitRate([], 10)).toBe(0);
    expect(trailingHitRate([1, 2, 3], Number.NaN)).toBe(0);
    expect(trailingHitRate([Number.NaN, Infinity, -Infinity], 10)).toBe(0);
    expect(trailingHitRate([1, 2], 10, 0)).toBe(0); // degenerate window
  });

  it("honors a custom window and expresses the rate per second", () => {
    // 3 hits over a 0.5 s window = 6 hits/s.
    expect(trailingHitRate([10, 10.2, 10.4], 10.5, 0.5)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// The classifier: density windows → phase, with hysteresis
// ---------------------------------------------------------------------------

describe("VZ-IM-6 classifyVizPhase (pure, table-tested)", () => {
  it("enters are inclusive at the threshold", () => {
    expect(classifyVizPhase(VIZ_PHASE_SPARSE_ENTER_HPS, "rest")).toBe("sparse");
    expect(classifyVizPhase(VIZ_PHASE_WORKING_ENTER_HPS, "sparse")).toBe("working");
    expect(classifyVizPhase(VIZ_PHASE_FULL_ENTER_HPS, "working")).toBe("full");
  });

  it("holds just under the enter thresholds", () => {
    expect(classifyVizPhase(VIZ_PHASE_SPARSE_ENTER_HPS - 0.01, "rest")).toBe("rest");
    expect(classifyVizPhase(VIZ_PHASE_WORKING_ENTER_HPS - 0.01, "sparse")).toBe("sparse");
    expect(classifyVizPhase(VIZ_PHASE_FULL_ENTER_HPS - 0.01, "working")).toBe("working");
  });

  it("stays AT the stay rate and leaves strictly below it", () => {
    expect(classifyVizPhase(VIZ_PHASE_SPARSE_STAY_HPS, "sparse")).toBe("sparse");
    expect(classifyVizPhase(VIZ_PHASE_WORKING_STAY_HPS, "working")).toBe("working");
    expect(classifyVizPhase(VIZ_PHASE_FULL_STAY_HPS, "full")).toBe("full");
    expect(classifyVizPhase(VIZ_PHASE_SPARSE_STAY_HPS - 0.01, "sparse")).toBe("rest");
    expect(classifyVizPhase(VIZ_PHASE_WORKING_STAY_HPS - 0.01, "working")).toBe("sparse");
    expect(classifyVizPhase(VIZ_PHASE_FULL_STAY_HPS - 0.01, "full")).toBe("working");
  });

  it("moves at most ONE step per call, in both directions", () => {
    // A cliff jump never skips phases (the label walks, never leaps).
    expect(classifyVizPhase(50, "rest")).toBe("sparse");
    expect(classifyVizPhase(50, "sparse")).toBe("working");
    expect(classifyVizPhase(50, "working")).toBe("full");
    expect(classifyVizPhase(0, "full")).toBe("working");
    expect(classifyVizPhase(0, "working")).toBe("sparse");
    expect(classifyVizPhase(0, "sparse")).toBe("rest");
  });

  it("a rate oscillating INSIDE a hysteresis gap never toggles the phase", () => {
    // The sparse gap is [0.75, 1.5): oscillate 0.9 ↔ 1.3 forever.
    let fromRest: VizDensityPhase = "rest";
    let fromSparse: VizDensityPhase = "sparse";
    for (const r of [0.9, 1.3, 0.9, 1.3, 0.9, 1.3]) {
      fromRest = classifyVizPhase(r, fromRest);
      fromSparse = classifyVizPhase(r, fromSparse);
    }
    expect(fromRest).toBe("rest"); // never entered (enter needs ≥ 1.5)
    expect(fromSparse).toBe("sparse"); // never left (leave needs < 0.75)
  });

  it("degenerate rates read 0 (never garbage phases)", () => {
    expect(classifyVizPhase(Number.NaN, "sparse")).toBe("rest");
    expect(classifyVizPhase(-5, "full")).toBe("working"); // one step toward rest
  });
});

// ---------------------------------------------------------------------------
// The calibration + labels (frozen data)
// ---------------------------------------------------------------------------

describe("VZ-IM-6 phase levels + labels (the recorded calibration)", () => {
  it("the frozen table is exactly the recorded decision", () => {
    expect(VIZ_PHASE_LEVELS.idle).toEqual({ restLevel: 1, liveGain: 1 });
    expect(VIZ_PHASE_LEVELS.rest).toEqual({ restLevel: 1, liveGain: 0.7 });
    expect(VIZ_PHASE_LEVELS.sparse).toEqual({ restLevel: 1, liveGain: 0.86 });
    expect(VIZ_PHASE_LEVELS.working).toEqual({ restLevel: 1, liveGain: 0.94 });
    expect(VIZ_PHASE_LEVELS.full).toEqual({ restLevel: 1, liveGain: 1 });
  });

  it("the arc raises LIVEGAIN monotonically; the diagram is phase-INVARIANT", () => {
    const arc: readonly VizDensityPhase[] = ["rest", "sparse", "working", "full"];
    for (let i = 1; i < arc.length; i++) {
      expect(vizPhaseLevels(arc[i]!).liveGain).toBeGreaterThanOrEqual(
        vizPhaseLevels(arc[i - 1]!).liveGain,
      );
    }
    // The still diagram never moves with the phase — the per-lane
    // never-early law (a global diagram ease would move every lane's
    // rest marks when ANY lane's first hit engages the arc, and the
    // songbook staggers its lanes by design).
    for (const phase of ["idle", ...arc] as const) {
      expect(vizPhaseLevels(phase).restLevel).toBe(1);
    }
    // The idle-form decision: idle IS the as-designed still diagram — the
    // engine's authored (1, 1) defaults, never moved (the two-boot
    // fingerprint baseline holds by construction); the tail decays at
    // authored gain.
    expect(vizPhaseLevels("idle")).toEqual({ restLevel: 1, liveGain: 1 });
    expect(vizPhaseLevels("full").liveGain).toBe(1);
    for (const phase of ["idle", ...arc] as const) {
      const { restLevel, liveGain } = vizPhaseLevels(phase);
      expect(restLevel).toBeGreaterThan(0);
      expect(restLevel).toBeLessThanOrEqual(1);
      expect(liveGain).toBeGreaterThan(0);
      expect(liveGain).toBeLessThanOrEqual(1);
    }
  });

  it("every density phase has a text-equivalent label (never color alone)", () => {
    expect(vizPhaseLabel("rest")).toBe(`${VIZ_PHASE_LABEL_PREFIX} — REST`);
    expect(vizPhaseLabel("sparse")).toBe(`${VIZ_PHASE_LABEL_PREFIX} — SPARSE`);
    expect(vizPhaseLabel("working")).toBe(`${VIZ_PHASE_LABEL_PREFIX} — WORKING`);
    expect(vizPhaseLabel("full")).toBe(`${VIZ_PHASE_LABEL_PREFIX} — FULL`);
  });

  it("the ENGAGEMENT LAW: no drained hits → the idle diagram, playing or not", () => {
    // Stopped: idle regardless.
    expect(vizPhaseTargets(false, 0, "full")).toEqual(VIZ_PHASE_LEVELS.idle);
    expect(vizPhaseTargets(false, 99, "full")).toEqual(VIZ_PHASE_LEVELS.idle);
    // Playing with an empty window (pre-first-hit hush, or every note
    // long decayed): still the authored diagram — the transport edge
    // alone never moves the stage (TH-2 Law A's corollary).
    expect(vizPhaseTargets(true, 0, "full")).toEqual(VIZ_PHASE_LEVELS.idle);
    // The first drained hit engages the arc's floor.
    expect(vizPhaseTargets(true, 1, "rest")).toEqual(VIZ_PHASE_LEVELS.rest);
    expect(vizPhaseTargets(true, 24, "full")).toEqual(VIZ_PHASE_LEVELS.full);
  });
});

// ---------------------------------------------------------------------------
// The easing law (gradual, never strobing; exact snap)
// ---------------------------------------------------------------------------

describe("VZ-IM-6 easeLevelToward", () => {
  it("eases exponentially toward the target (the exact formula)", () => {
    const dt = VIZ_PHASE_EASE_TAU_SECONDS; // one time constant
    const moved = easeLevelToward(1, 0.7, dt, false);
    // One time constant covers 1 − 1/e of the GAP: from 1 toward 0.7.
    expect(moved).toBeCloseTo(1 - 0.3 * (1 - Math.exp(-1)), 12);
  });

  it("SNAPS exactly within the epsilon — settled means exact, not asymptotic", () => {
    expect(easeLevelToward(0.705, 0.7, 1 / 60, false)).toBe(0.7);
    expect(easeLevelToward(0.7, 0.705, 1 / 60, false)).toBe(0.705);
    expect(Math.abs(0.705 - 0.7)).toBeLessThanOrEqual(VIZ_PHASE_EASE_SNAP);
  });

  it("reduced motion STEPS instantly (DD-3: state changes, never animation)", () => {
    expect(easeLevelToward(1, 0.7, 0, true)).toBe(0.7);
    expect(easeLevelToward(0.6, 1, Number.NaN, true)).toBe(1);
  });

  it("parks at the current level on a degenerate dt (no clock, no move)", () => {
    expect(easeLevelToward(0.9, 0.7, 0, false)).toBe(0.9);
    expect(easeLevelToward(0.9, 0.7, Number.NaN, false)).toBe(0.9);
    expect(easeLevelToward(0.9, 0.7, -1, false)).toBe(0.9);
  });

  it("clamps the per-update dt (a parked loop resumes gracefully)", () => {
    expect(easeLevelToward(1, 0.7, 10, false)).toBe(
      easeLevelToward(1, 0.7, VIZ_PHASE_EASE_MAX_DT_SECONDS, false),
    );
  });

  it("never overshoots, and degenerate inputs stay in [0, 1]", () => {
    const up = easeLevelToward(0.2, 0.9, 5, false);
    const down = easeLevelToward(0.9, 0.2, 5, false);
    expect(up).toBeLessThanOrEqual(0.9);
    expect(down).toBeGreaterThanOrEqual(0.2);
    expect(easeLevelToward(Number.NaN, 0.5, 0.1, false)).toBeGreaterThanOrEqual(0);
    expect(easeLevelToward(2, -5, 0.1, false)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// The controller (injected seams; the wiring the product rides)
// ---------------------------------------------------------------------------

describe("VZ-IM-6 controller", () => {
  it("registry lifecycle: created → live, disposed → gone (idempotent)", () => {
    const h = createHarness();
    expect(activeVizPhaseControllers()).toContain(h.controller);
    h.controller.dispose();
    h.controller.dispose();
    expect(activeVizPhaseControllers()).not.toContain(h.controller);
  });

  it("parks without a clock: NaN now never moves levels or classifies", () => {
    const h = createHarness({ initialPlaying: true });
    h.controller.note(1);
    h.controller.note(2);
    h.controller.update(Number.NaN);
    const probe = h.controller.probe();
    expect(probe.phase).toBe("rest"); // untouched density floor
    expect(probe.restLevel).toBe(1); // the engine's authored defaults
    expect(probe.liveGain).toBe(1);
    expect(h.levels).toHaveLength(0); // no sink call before a clock exists
  });

  it("the first update records the clock only (no first-frame jump)", () => {
    const h = createHarness({ initialPlaying: true }); // rest targets differ
    h.controller.update(50);
    h.controller.note(50); // the engagement key: a drained hit
    expect(h.levels).toHaveLength(0);
    h.controller.update(50 + 1 / 60);
    expect(h.levels.length).toBeGreaterThan(0); // motion begins frame two
  });

  it("playing with NO drained hits never moves a level (Law A corollary)", () => {
    const h = createHarness({ initialPlaying: true });
    let t = 30;
    h.controller.update(t);
    for (let i = 0; i < 300; i++) {
      t += 1 / 60;
      h.controller.update(t);
    }
    const probe = h.controller.probe();
    expect(probe.phase).toBe("rest"); // the phase SIGNAL is transport-truthful
    expect(probe.restLevel).toBe(1); // but the stage keeps the authored diagram
    expect(probe.liveGain).toBe(1);
    expect(h.levels).toHaveLength(0); // zero sink calls — pixel-still hush
    // The first hit engages the arc.
    h.controller.note(t + 1 / 60);
    h.controller.update(t + 1 / 60);
    h.controller.update(t + 2 / 60);
    expect(h.levels.length).toBeGreaterThan(0);
  });

  it("idle NEVER moves a level: the authored (1, 1) diagram, untouched", () => {
    const h = createHarness({ initialPlaying: false });
    let t = 10;
    h.controller.update(t);
    for (let i = 0; i < 240; i++) {
      t += 1 / 60;
      h.controller.update(t);
    }
    const probe = h.controller.probe();
    expect(probe.phase).toBe("idle");
    expect(probe.restLevel).toBe(1); // the engine's authored defaults
    expect(probe.liveGain).toBe(1);
    // The idle-form decision's fingerprint corollary: ZERO sink calls —
    // the boot/stopped diagram is byte-stable by construction.
    expect(h.levels).toHaveLength(0);
  });

  it("the demo-shaped climb walks the full arc and settles at (1, 1)", () => {
    const h = createHarness();
    const { phases } = driveClimb(h, { seconds: 4 });
    const first = (p: VizDensityPhase): number => phases.indexOf(p);
    expect(phases).toContain("sparse");
    expect(phases).toContain("working");
    expect(phases).toContain("full");
    // The arc is ORDERED: sparse before working before full.
    expect(first("sparse")).toBeLessThan(first("working"));
    expect(first("working")).toBeLessThan(first("full"));
    expect(phases.at(-1)).toBe("full");
    const probe = h.controller.probe();
    expect(probe.rate).toBeGreaterThan(VIZ_PHASE_FULL_ENTER_HPS);
    expect(probe.restLevel).toBe(1);
    expect(probe.liveGain).toBe(1);
  });

  it("FULL MOTION NEVER ANNOUNCES (DD-2's verified silence law)", () => {
    const h = createHarness(); // reducedMotion defaults false
    driveClimb(h, { seconds: 4 });
    expect(h.labels).toHaveLength(0);
    expect(h.controller.probe().labelAnnouncements).toBe(0);
    expect(h.controller.probe().lastLabel).toBeNull();
  });

  it("under reduce the labels speak, once per change, in arc order", () => {
    const h = createHarness({ reducedMotion: true });
    const { t: climbEnd } = driveClimb(h, { seconds: 4 });
    expect(h.labels).toEqual([
      `${VIZ_PHASE_LABEL_PREFIX} — SPARSE`,
      `${VIZ_PHASE_LABEL_PREFIX} — WORKING`,
      `${VIZ_PHASE_LABEL_PREFIX} — FULL`,
    ]);
    expect(h.controller.probe().labelAnnouncements).toBe(3);
    // The label counter is mode-truthful: flipping to full motion stops
    // future labels (a later phase drop re-enters silence).
    h.controller.setReducedMotion(false);
    let t = climbEnd;
    for (let frame = 0; frame < 60 * 5; frame++) {
      t += 1 / 60;
      h.controller.update(t); // window drains → full → working → sparse → rest
    }
    expect(h.controller.probe().labelAnnouncements).toBe(3);
  });

  it("under reduce the levels STEP to the new phase's targets instantly", () => {
    const h = createHarness({ reducedMotion: true });
    let t = 10;
    h.push(true);
    h.controller.update(t);
    t += 1 / 60;
    h.controller.note(t); // engage the arc (the transport edge moves nothing)
    h.controller.update(t);
    // dt > 0 with reduce ON: already snapped to the rest-phase targets.
    expect(h.controller.probe().restLevel).toBe(VIZ_PHASE_LEVELS.rest.restLevel);
    expect(h.controller.probe().liveGain).toBe(VIZ_PHASE_LEVELS.rest.liveGain);
    // The first phase flip applies its targets in the SAME update.
    for (let frame = 0; frame < 60; frame++) {
      t += 1 / 60;
      if (frame % 5 === 0) h.controller.note(t);
      h.controller.update(t);
      const probe = h.controller.probe();
      if (probe.phase === "sparse") {
        expect(probe.restLevel).toBe(VIZ_PHASE_LEVELS.sparse.restLevel);
        expect(probe.liveGain).toBe(VIZ_PHASE_LEVELS.sparse.liveGain);
        break;
      }
    }
  });

  it("the stopped edge IS idle: immediate, ring cleared, arc re-armed from rest", () => {
    const h = createHarness();
    driveClimb(h, { seconds: 2.5 }); // reaches full
    expect(h.controller.probe().phase).toBe("full");
    h.push(false);
    expect(h.controller.probe().phase).toBe("idle"); // never waits the window
    h.controller.update(100 + 3);
    expect(h.controller.probe().rate).toBe(0); // the ring died with the stop
    h.push(true);
    expect(h.controller.probe().phase).toBe("rest"); // re-armed from rest
  });

  it("a stop from engaged play eases liveGain back to authored, gradually", () => {
    const h = createHarness();
    // A sparse trickle engages the arc and settles liveGain at the
    // rest-phase target (one hit per 2 s: provably below sparse's enter).
    let t = 20;
    h.push(true);
    h.controller.update(t);
    for (let i = 0; i < 600; i++) {
      t += 1 / 60;
      if (i % 120 === 0) h.controller.note(t); // 0.5 hits/s trickle
      h.controller.update(t);
    }
    const quiet = h.controller.probe();
    expect(quiet.phase).toBe("rest");
    expect(quiet.restLevel).toBe(1); // the diagram never moved
    expect(quiet.liveGain).toBe(VIZ_PHASE_LEVELS.rest.liveGain);
    // The stop: the tail decays at AUTHORED gain — liveGain eases back to
    // 1, a FRACTION of the gap per frame (never the whole jump at once).
    h.push(false);
    const callsBefore = h.levels.length;
    h.controller.update(t + 1 / 60);
    expect(h.levels.length).toBe(callsBefore + 1);
    const first = h.levels.at(-1)!;
    expect(first.liveGain).toBeGreaterThan(VIZ_PHASE_LEVELS.rest.liveGain);
    expect(first.liveGain).toBeLessThan(VIZ_PHASE_LEVELS.idle.liveGain);
    expect(first.restLevel).toBe(1); // still invariant through the stop
    for (let i = 0; i < 240; i++) {
      t += 1 / 60;
      h.controller.update(t);
    }
    const idle = h.controller.probe();
    expect(idle.phase).toBe("idle");
    expect(idle.restLevel).toBe(1);
    expect(idle.liveGain).toBe(VIZ_PHASE_LEVELS.idle.liveGain);
  });

  it("the ring cap bounds pathological bursts", () => {
    const h = createHarness({ initialPlaying: true });
    const t = 500;
    h.controller.update(t);
    for (let i = 0; i < VIZ_PHASE_RING_CAP + 40; i++) h.controller.note(t - i * 1e-4);
    h.controller.update(t);
    expect(h.controller.probe().rate).toBe(VIZ_PHASE_RING_CAP / VIZ_PHASE_WINDOW_SECONDS);
  });

  it("non-finite hits are never noted", () => {
    const h = createHarness({ initialPlaying: true });
    h.controller.note(Number.NaN);
    h.controller.note(Infinity);
    h.controller.note(10);
    expect(h.controller.probe().noted).toBe(1);
  });

  it("deterministic: the same script drives two controllers identically", () => {
    const run = (): { phases: string[]; levels: number[][]; labels: string[] } => {
      const h = createHarness({ reducedMotion: true });
      const phases: string[] = [];
      const levels: number[][] = [];
      let t = 42;
      h.push(true);
      h.controller.update(t);
      for (let frame = 1; frame <= 60 * 5; frame++) {
        t += 1 / 60;
        if (frame % 5 === 0) h.controller.note(t);
        if (frame === 60 * 2) h.push(false); // stop mid-script
        if (frame === 60 * 3) h.push(true); // and restart
        h.controller.update(t);
        const p = h.controller.probe();
        phases.push(p.phase);
        levels.push([p.restLevel, p.liveGain]);
      }
      return { phases, levels, labels: [...h.labels] };
    };
    expect(run()).toEqual(run());
  });

  it("dispose unsubscribes the transport seam exactly once", () => {
    const h = createHarness();
    expect(h.unsubscribed()).toBe(0);
    h.controller.dispose();
    expect(h.unsubscribed()).toBe(1);
    h.controller.dispose();
    expect(h.unsubscribed()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The engine-level mapping (VZ-IM-5's setRestLevel/setLiveGain seams)
// ---------------------------------------------------------------------------

describe("VZ-IM-6 engine-level mapping (the IM-5 handoff consumed)", () => {
  it("phase levels land in the REAL engine and read back through its probe", () => {
    const engine = createVizNodeEngine({
      arrangement: defaultBootArrangement(),
      bakeSprite: () => null, // no blits needed — this pins the level seams
    });
    try {
      expect(engine.probe().restLevel).toBe(1); // authored defaults first
      expect(engine.probe().liveGain).toBe(1);
      const h = createHarness({
        // THE PRODUCT WIRING (VizPage): the level sink drives the seams.
        onLevels: (restLevel, liveGain) => {
          engine.setRestLevel(restLevel);
          engine.setLiveGain(liveGain);
        },
      });
      let t = 7;
      h.push(true);
      h.controller.update(t);
      // Parked-clock / first-frame law preserved: engine untouched yet.
      expect(engine.probe().restLevel).toBe(1);
      for (let frame = 1; frame <= 60 * 4; frame++) {
        t += 1 / 60;
        if (frame % 5 === 0) h.controller.note(t);
        h.controller.update(t);
        // The engine's probe mirrors the controller's levels at every
        // step (the seam is lossless).
        const probe = h.controller.probe();
        expect(engine.probe().restLevel).toBe(probe.restLevel);
        expect(engine.probe().liveGain).toBe(probe.liveGain);
      }
      const final = h.controller.probe();
      expect(final.phase).toBe("full");
      expect(engine.probe().restLevel).toBe(VIZ_PHASE_LEVELS.full.restLevel);
      expect(engine.probe().liveGain).toBe(VIZ_PHASE_LEVELS.full.liveGain);
      // The stop: idle equals the authored defaults, so the engine's
      // diagram is NEVER disturbed at idle (the fingerprint corollary).
      h.push(false);
      const idleCalls = h.levels.length;
      for (let frame = 0; frame < 60 * 4; frame++) {
        t += 1 / 60;
        h.controller.update(t);
      }
      expect(h.levels.length).toBe(idleCalls); // zero sink calls while idle
      expect(engine.probe().restLevel).toBe(1);
      expect(engine.probe().liveGain).toBe(1);
    } finally {
      engine.dispose();
      expect(activeVizNodeEngines()).not.toContain(engine);
    }
  });
});

// ---------------------------------------------------------------------------
// Fences (real-source greps, the viz-reduced-motion precedent)
// ---------------------------------------------------------------------------

describe("VZ-IM-6 fences", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/viz/phases.ts", import.meta.url)),
    "utf8",
  );

  it("no Math.random / Date.now / performance.now (determinism contract)", () => {
    // Call-site greps (the viz-reduced-motion fence precedent): doc
    // comments may NAME the law; the code may never call it.
    expect(source).not.toMatch(/Math\.random\s*\(/);
    expect(source).not.toMatch(/Date\.now\s*\(/);
    expect(source).not.toMatch(/performance\.now\s*\(/);
  });

  it("the module never touches DOM globals (pure by construction)", () => {
    expect(source).not.toMatch(/\bdocument\./);
    expect(source).not.toMatch(/\bwindow\./);
    expect(source).not.toMatch(/getComputedStyle\s*\(/);
  });
});
