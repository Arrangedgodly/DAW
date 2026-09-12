/**
 * VZ-HU-1 unit tests — the CONSOLIDATED page-lifecycle contract (the
 * substance was built + verified distributed; this file pins it as ONE
 * artifact, src/viz/stateMachine.ts):
 *
 * - `nextVizPageState`: the total page transition table (8 states × 9
 *   events, every cell pinned) — closed → open-idle → open-playing →
 *   hidden → phone-gate → error → closed, with the laws that matter:
 *   `close` exits every mounted state, `fault` fires only where a loop
 *   is drawing, `show` never resumes a faulted loop, phone/wide carry
 *   the transport fact through the gate.
 * - The loop machine re-export is the renderer's OWN function (single
 *   source — no restated copy can drift).
 * - `VIZ_TEARDOWN_CHECKLIST` / `VIZ_TEARDOWN_REGISTRY_PROBES`: the
 *   post-exit invariant as data — unique steps, arranger FIRST, every
 *   registry probe names a REAL export of its module.
 * - Source fence on VizPage.tsx: the engine teardown block executes the
 *   checklist in the pinned ORDER (positions in comment-stripped source)
 *   and every step is present exactly where the checklist says.
 * - Module fence on stateMachine.ts: pure data/functions only (no DOM,
 *   no framework, no engine, no Math.random — the presets/renderer
 *   precedents).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  nextVizLoopState,
  nextVizPageState,
  VIZ_TEARDOWN_CHECKLIST,
  VIZ_TEARDOWN_REGISTRY_PROBES,
  type VizPageEvent,
  type VizPageState,
} from "../src/viz/stateMachine";
import * as rendererMod from "../src/viz/renderer";
import { activeVizArrangementControllers } from "../src/viz/arrangement";
import { activeVizPipelines } from "../src/viz/pipeline";
import { activeVizNodeEngines } from "../src/viz/nodes";
import { activeVizPhaseControllers } from "../src/viz/phases";
import { activeVizActivitySummarizers } from "../src/viz/textEquivalence";
import { activeVizAnnouncers } from "../src/viz/announcements";

// ---------------------------------------------------------------------------
// Single source — the re-export IS the renderer's table
// ---------------------------------------------------------------------------

describe("stateMachine re-export — renderer.ts stays the single source", () => {
  it("nextVizLoopState is the same function the renderer wires (no restated copy)", () => {
    expect(nextVizLoopState).toBe(rendererMod.nextVizLoopState);
  });

  it("the error cells the containment wrapper rides: fault parks running, is terminal until stop", () => {
    expect(rendererMod.nextVizLoopState("running", "error")).toBe("error");
    expect(rendererMod.nextVizLoopState("error", "show")).toBe("error");
    expect(rendererMod.nextVizLoopState("error", "hide")).toBe("error");
    expect(rendererMod.nextVizLoopState("error", "start")).toBe("error");
    expect(rendererMod.nextVizLoopState("error", "error")).toBe("error");
    expect(rendererMod.nextVizLoopState("error", "stop")).toBe("stopped");
    // A fault can only originate inside a drawing loop; elsewhere no-op.
    expect(rendererMod.nextVizLoopState("idle", "error")).toBe("idle");
    expect(rendererMod.nextVizLoopState("parked", "error")).toBe("parked");
    expect(rendererMod.nextVizLoopState("stopped", "error")).toBe("stopped");
  });
});

// ---------------------------------------------------------------------------
// nextVizPageState — the total page transition table
// ---------------------------------------------------------------------------

describe("nextVizPageState — the total page transition table", () => {
  const STATES: readonly VizPageState[] = [
    "closed",
    "open-idle",
    "open-playing",
    "hidden-idle",
    "hidden-playing",
    "phone-idle",
    "phone-playing",
    "error",
  ];
  const EVENTS: readonly VizPageEvent[] = [
    "open",
    "close",
    "play",
    "stop",
    "hide",
    "show",
    "phone",
    "wide",
    "fault",
  ];

  // The full 8×9 table, one row per (state, event) — pinned explicitly so
  // any wiring change that moves a cell moves THIS file too.
  const TABLE: Record<VizPageState, Record<VizPageEvent, VizPageState>> = {
    closed: {
      open: "open-idle",
      close: "closed",
      play: "closed",
      stop: "closed",
      hide: "closed",
      show: "closed",
      phone: "closed",
      wide: "closed",
      fault: "closed",
    },
    "open-idle": {
      open: "open-idle",
      close: "closed",
      play: "open-playing",
      stop: "open-idle",
      hide: "hidden-idle",
      show: "open-idle",
      phone: "phone-idle",
      wide: "open-idle",
      fault: "error",
    },
    "open-playing": {
      open: "open-playing",
      close: "closed",
      play: "open-playing",
      stop: "open-idle",
      hide: "hidden-playing",
      show: "open-playing",
      phone: "phone-playing",
      wide: "open-playing",
      fault: "error",
    },
    "hidden-idle": {
      open: "hidden-idle",
      close: "closed",
      play: "hidden-playing",
      stop: "hidden-idle",
      hide: "hidden-idle",
      show: "open-idle",
      phone: "phone-idle",
      wide: "hidden-idle",
      // R3: the hidden loop is PARKED — nothing draws, nothing can throw.
      fault: "hidden-idle",
    },
    "hidden-playing": {
      open: "hidden-playing",
      close: "closed",
      play: "hidden-playing",
      stop: "hidden-idle",
      hide: "hidden-playing",
      show: "open-playing",
      phone: "phone-playing",
      wide: "hidden-playing",
      fault: "hidden-playing",
    },
    "phone-idle": {
      open: "phone-idle",
      close: "closed",
      play: "phone-playing",
      stop: "phone-idle",
      hide: "phone-idle",
      show: "phone-idle",
      phone: "phone-idle",
      wide: "open-idle",
      // DD-4: no engine exists at the gate — no draw, no fault.
      fault: "phone-idle",
    },
    "phone-playing": {
      open: "phone-playing",
      close: "closed",
      play: "phone-playing",
      stop: "phone-idle",
      hide: "phone-playing",
      show: "phone-playing",
      phone: "phone-playing",
      wide: "open-playing",
      fault: "phone-playing",
    },
    error: {
      open: "error",
      close: "closed",
      play: "error",
      stop: "error",
      hide: "error",
      show: "error",
      phone: "error",
      wide: "error",
      fault: "error",
    },
  };

  it("the table is total: 8 states × 9 events, every cell pinned", () => {
    expect(STATES.length).toBe(8);
    expect(EVENTS.length).toBe(9);
  });

  it.each(STATES)("state %s: every event routes exactly as pinned", (s) => {
    for (const e of EVENTS) {
      expect(nextVizPageState(s, e)).toBe(TABLE[s][e]);
    }
  });

  it("CLOSE exits every mounted state — the one funnel, even past a fault (EXIT stays functional)", () => {
    for (const s of STATES) {
      if (s === "closed") continue;
      expect(nextVizPageState(s, "close")).toBe("closed");
    }
  });

  it("the Hulk journey arcs: closed→idle→playing→hidden→playing→gate→wide-playing→fault→close", () => {
    let s: VizPageState = "closed";
    const step = (e: VizPageEvent, want: VizPageState): void => {
      s = nextVizPageState(s, e);
      expect(s).toBe(want);
    };
    step("open", "open-idle");
    step("play", "open-playing");
    step("hide", "hidden-playing"); // R3: parked, subscription stays
    step("show", "open-playing"); // resync, no replay
    step("stop", "open-idle");
    step("phone", "phone-idle"); // full teardown, transport remembered
    step("play", "phone-playing"); // audio runs under the gate (isolation)
    step("wide", "open-playing"); // re-boot into the truthful arc
    step("fault", "error"); // containment parks the loop
    step("show", "error"); // visibility never resumes a fault
  });

  it("double-exit and double-open are no-ops (closed is sticky until `open`, error until `close`)", () => {
    expect(nextVizPageState("closed", "close")).toBe("closed");
    expect(nextVizPageState("closed", "stop")).toBe("closed");
    expect(nextVizPageState("error", "fault")).toBe("error");
    expect(nextVizPageState("open-idle", "open")).toBe("open-idle");
  });
});

// ---------------------------------------------------------------------------
// The teardown checklist — invariant data + the real VizPage order
// ---------------------------------------------------------------------------

describe("VIZ_TEARDOWN_CHECKLIST — the ordered post-exit invariant", () => {
  it("every step id is unique and every named registry probe is real module state", () => {
    const ids = VIZ_TEARDOWN_CHECKLIST.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const probes = new Set(VIZ_TEARDOWN_CHECKLIST.map((s) => s.registryProbe));
    for (const p of probes) {
      if (p !== null) expect(VIZ_TEARDOWN_REGISTRY_PROBES).toContain(p);
    }
    expect(new Set(VIZ_TEARDOWN_REGISTRY_PROBES).size).toBe(
      VIZ_TEARDOWN_REGISTRY_PROBES.length,
    );
  });

  it("ARRANGER dies FIRST among the engine stack (pending reroll never fires into the teardown below)", () => {
    const engineIds = [
      "unsubscribe-bpm",
      "stop-persistence",
      "release-summarizer",
      "dispose-arranger",
      "dispose-renderer",
      "dispose-pipeline",
      "dispose-phase-controller",
      "dispose-node-engine",
    ];
    const order = VIZ_TEARDOWN_CHECKLIST.map((s) => s.id);
    const positions = engineIds.map((id) => order.indexOf(id));
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("every registry probe resolves to a REAL export of its module (the invariant is checkable)", () => {
    const real: Record<string, unknown> = {
      liveVizRendererCount: rendererMod.liveVizRendererCount,
      activeVizArrangementControllers,
      activeVizPipelines,
      activeVizNodeEngines,
      activeVizPhaseControllers,
      activeVizActivitySummarizers,
      activeVizAnnouncers,
    };
    for (const name of VIZ_TEARDOWN_REGISTRY_PROBES) {
      expect(typeof real[name], name).toBe("function");
    }
    // And a bare-node read of each is a count/empty (no DOM needed).
    expect(rendererMod.liveVizRendererCount()).toBe(0);
    expect(activeVizArrangementControllers()).toEqual([]);
    expect(activeVizPipelines()).toEqual([]);
    expect(activeVizNodeEngines()).toEqual([]);
    expect(activeVizPhaseControllers()).toEqual([]);
    expect(activeVizActivitySummarizers()).toEqual([]);
    expect(activeVizAnnouncers()).toEqual([]);
  });
});

// The former VizPage source-regex fence was replaced by mounted disposal
// and failure-containment tests in tests/browser/viz-composition.test.tsx.

// ---------------------------------------------------------------------------
// Module fence — stateMachine.ts is pure contract data
// ---------------------------------------------------------------------------

describe("stateMachine module fence (purity, the presets/renderer precedents)", () => {
  const SOURCE = readFileSync("src/viz/stateMachine.ts", "utf8");
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  );

  it("no Math.random, no wall clock (determinism contract)", () => {
    expect(CODE).not.toMatch(/Math\.random\s*\(/);
    expect(CODE).not.toMatch(/Date\.now|performance\.now|new Date\s*\(/);
  });

  it("imports no framework, no engine, no DOM-touching module (pure data + the renderer re-export)", () => {
    expect(CODE).not.toMatch(/from\s+"solid-js"/);
    expect(CODE).toMatch(/from\s+"\.\/renderer"/);
    expect(CODE.match(/from\s+"/g)?.length).toBe(1);
  });
});
