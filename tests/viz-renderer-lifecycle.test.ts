/**
 * VZ-IM-4 unit tests — the canvas skeleton's PURE lifecycle logic (the
 * DOM side — RO/rAF/visibility wiring — is the browser gate in
 * tests/browser/viz-mount.test.tsx; canvas skeleton in a real browser is
 * the honest gate for DPR/resize behavior, this file covers the
 * node-testable math and the loop state machine the wiring consumes):
 *
 * - resolveDpr: the ONE-constant cap law `min(dpr, VIZ_DPR_CAP)` with
 *   degenerate-read normalization (R2, r1r2-canvas-perf-dpr.md §4).
 * - backingSize / backingSizeChanged: integer-backing-store sizing and
 *   the integer-change swap guard (fractional RO rects never churn).
 * - nextVizLoopState: the total park/resume/teardown transition table.
 * - Module fence (source-pinned, VZ-MF-1/TH-1 pattern): the renderer
 *   module never calls Math.random, never reads a wall clock, imports no
 *   framework (reactive state) and no engine module (transport
 *   isolation), and pins the R2 context laws ({alpha:false}, setTransform
 *   reapply, single layer, no shadowBlur).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VIZ_DPR_CAP,
  backingSize,
  backingSizeChanged,
  nextVizLoopState,
  resolveDpr,
  type VizLoopEvent,
  type VizLoopState,
} from "../src/viz/renderer";

// ---------------------------------------------------------------------------
// resolveDpr — the cap law (R2 §4)
// ---------------------------------------------------------------------------

describe("resolveDpr — min(devicePixelRatio, VIZ_DPR_CAP), one constant", () => {
  it("VIZ_DPR_CAP is exactly 0.75 (the multi-instrument engine's abstract-canvas performance balance)", () => {
    expect(VIZ_DPR_CAP).toBe(0.75);
  });

  it.each([
    [1, 0.75],
    [1.25, 0.75],
    [1.5, 0.75],
    [2, 0.75],
    [2.5, 0.75],
    [3, 0.75],
    [8, 0.75],
  ])(
    "dpr %s → %s (at or below the cap passes, above caps to 0.75)",
    (raw, want) => {
      expect(resolveDpr(raw)).toBe(want);
    },
  );

  it("sub-1 readings pass through (no floor: zoomed-out stays honest — flooring would double the pixel load)", () => {
    expect(resolveDpr(0.5)).toBe(0.5);
    expect(resolveDpr(0.75)).toBe(0.75);
  });

  it("degenerate readings (never produced by real browsers) normalize to the safe cap, never 0/NaN/negative", () => {
    for (const raw of [0, -1, -2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveDpr(raw)).toBe(0.75);
    }
  });

  it("the cap parameter is honored (the constant is the default, not the law's only value)", () => {
    expect(resolveDpr(3, 1)).toBe(1);
    expect(resolveDpr(1.5, 1.5)).toBe(1.5);
    expect(resolveDpr(0.5, 1)).toBe(0.5); // cap never raises a low dpr
  });
});

// ---------------------------------------------------------------------------
// backingSize — integer backing stores
// ---------------------------------------------------------------------------

describe("backingSize — integer backing store = round(css × dpr), floored at 1", () => {
  it.each([
    [390, 844, 2, 780, 1688],
    [768, 900, 1, 768, 900],
    [1440, 900, 2, 2880, 1800],
  ])("committed viewport %s×%s at dpr %s → %s×%s", (w, h, dpr, bw, bh) => {
    expect(backingSize(w, h, dpr)).toEqual({ width: bw, height: bh });
  });

  it("fractional CSS boxes round to the nearest integer backing pixel", () => {
    expect(backingSize(390.4, 844.6, 2)).toEqual({ width: 781, height: 1689 });
    expect(backingSize(333.5, 200.25, 1.5)).toEqual({
      width: 500, // round(500.25)
      height: 300, // round(300.375)
    });
  });

  it("fractional DPRs keep integer products (100 @ 1.25 → 125)", () => {
    expect(backingSize(100, 100, 1.25)).toEqual({ width: 125, height: 125 });
  });

  it("floors every axis at 1 — a 0/negative/non-finite box parks at 1×1, never an invalid canvas", () => {
    expect(backingSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
    expect(backingSize(-10, 40, 2)).toEqual({ width: 1, height: 80 });
    expect(backingSize(Number.NaN, 50, 2)).toEqual({
      width: 1,
      height: 100,
    });
  });
});

describe("backingSizeChanged — the integer-change swap guard", () => {
  it("identical integer sizes swap nothing", () => {
    expect(
      backingSizeChanged(
        { width: 2880, height: 1800 },
        { width: 2880, height: 1800 },
      ),
    ).toBe(false);
  });

  it("any one-axis integer difference forces the swap (sub-pixel churn that rounds equal does not)", () => {
    expect(
      backingSizeChanged(
        { width: 2880, height: 1800 },
        { width: 2881, height: 1800 },
      ),
    ).toBe(true);
    expect(
      backingSizeChanged(
        { width: 2880, height: 1800 },
        { width: 2880, height: 1801 },
      ),
    ).toBe(true);
    expect(
      backingSizeChanged(
        { width: 2880, height: 1800 },
        { width: 2880, height: 1800 },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nextVizLoopState — the park/resume/teardown table
// ---------------------------------------------------------------------------

describe("nextVizLoopState — visibility parks, visible resumes, stop is terminal", () => {
  const TABLE: readonly [VizLoopState, VizLoopEvent, VizLoopState][] = [
    // start arms only from idle
    ["idle", "start", "running"],
    ["running", "start", "running"],
    ["parked", "start", "parked"],
    ["error", "start", "error"],
    ["stopped", "start", "stopped"],
    // hide parks only a running loop
    ["running", "hide", "parked"],
    ["idle", "hide", "idle"],
    ["parked", "hide", "parked"],
    ["error", "hide", "error"],
    ["stopped", "hide", "stopped"],
    // show resumes only a parked loop
    ["parked", "show", "running"],
    ["idle", "show", "idle"],
    ["running", "show", "running"],
    ["error", "show", "error"],
    ["stopped", "show", "stopped"],
    // VZ-HU-1: a thrown draw (error) parks only a RUNNING loop, and the
    // fault state is terminal until stop — visibility never resumes it.
    ["running", "error", "error"],
    ["idle", "error", "idle"],
    ["parked", "error", "parked"],
    ["error", "error", "error"],
    ["stopped", "error", "stopped"],
    // stop is terminal from every state
    ["idle", "stop", "stopped"],
    ["running", "stop", "stopped"],
    ["parked", "stop", "stopped"],
    ["error", "stop", "stopped"],
    ["stopped", "stop", "stopped"],
  ];

  it.each(TABLE)("%s --%s--> %s", (from, event, want) => {
    expect(nextVizLoopState(from, event)).toBe(want);
  });

  it("the table is total: every (state, event) pair is pinned exactly once", () => {
    expect(TABLE.length).toBe(5 * 5);
    const keys = new Set(TABLE.map(([s, e]) => `${s}|${e}`));
    expect(keys.size).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Module fence — the skeleton's own laws, source-pinned
// ---------------------------------------------------------------------------

describe("module fence (VZ-IM-4 acceptance: rAF law, isolation, R2 context)", () => {
  const SOURCE = readFileSync("src/viz/renderer.ts", "utf8");
  // Comments stripped so the fence counts CODE, not the doc prose that
  // cites the same laws (the module header quotes e.g. the getContext call).
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  );

  it("never calls Math.random (determinism contract)", () => {
    expect(CODE).not.toMatch(/Math\.random\s*\(/);
  });

  it("never reads a wall clock — the rAF timestamp is the only time the skeleton touches", () => {
    expect(CODE).not.toMatch(/Date\.now|performance\.now|new Date\s*\(/);
  });

  it("imports no framework (loop writes canvas only, never reactive state) and no engine (transport isolation)", () => {
    expect(CODE).not.toMatch(/from\s+"solid-js"/);
    expect(CODE).not.toMatch(/from\s+"[^"]*\/engine\/|from\s+"\.\.\/engine\//);
    expect(CODE).not.toMatch(/from\s+"[^"]*\/state\//);
  });

  it("pins the R2 context laws: opaque context, single layer, setTransform reapply, no shadowBlur", () => {
    expect(CODE).toMatch(/getContext\("2d", \{ alpha: false \}\)/);
    // Exactly ONE context acquisition — no layered/offscreen split.
    expect(CODE.match(/getContext\(/g)?.length).toBe(1);
    expect(CODE.match(/setTransform\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(CODE).not.toMatch(/shadowBlur/);
  });

  it("the module is importable in node — top level never touches the DOM (purity separation, presets/offsetQueue precedent)", async () => {
    const mod = await import("../src/viz/renderer");
    expect(typeof mod.createVizRenderer).toBe("function");
    expect(typeof mod.liveVizRendererCount).toBe("function");
  });
});
