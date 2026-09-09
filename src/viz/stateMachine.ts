/**
 * VizPage lifecycle state machine + teardown checklist (VZ-HU-1) — the ONE
 * consolidated contract artifact for the page-level lifecycle. The
 * SUBSTANCE was built distributed and verified across the run:
 *
 *   - the zero-cost closed mount ............ VZ-IM-2 (App's <Show>, HP-1)
 *   - the loop machine (idle/running/parked/
 *     error/stopped) + dispose contract ..... VZ-IM-4 + VZ-HU-1 (renderer.ts)
 *   - arranger-FIRST teardown order ......... VZ-HU-2 (exit-while-arranging)
 *   - the stage-mode effect teardown ........ VZ-DD-4 (phone gate = full
 *                                             teardown + re-boot on wide)
 *   - hidden-state entry/exit (R3) .......... VZ-TH-3 (queue clear, loop
 *                                             parks, subscription STAYS)
 *
 * This module does NOT re-implement any of that (no restated copy, no
 * rewiring of verified code). It does exactly two things:
 *
 * 1. Re-export the loop machine from renderer.ts as THE single source —
 *    every control path and test imports the table from one place.
 * 2. Formalize the PAGE-level machine (`nextVizPageState`) as pure data:
 *    the closed → open-idle → open-playing → hidden → phone-gate → error
 *    → disposed arc, derived 1:1 from the verified wiring in
 *    src/components/VizPage.tsx, plus the ordered TEARDOWN CHECKLIST
 *    (`VIZ_TEARDOWN_CHECKLIST`) — the invariant that after EVERY exit
 *    path (close, stage flip to phone, draw fault + close, unmount) all
 *    six module registries are empty, the entry timer is dead, no
 *    teardown step writes after an earlier dispose, and no pending reroll
 *    window can fire into a torn-down stack.
 *
 * Purity laws (presets.ts / renderer.ts precedents): pure data + functions
 * only — no DOM, no framework, no engine imports, no randomness, no wall
 * clock. Node-testable (tests/viz-state-machine.test.ts is the pin).
 */

// The LOOP machine re-exported — renderer.ts stays the single source; the
// 5×5 table (start/hide/show/stop/error × idle/running/parked/error/
// stopped) is pinned in tests/viz-renderer-lifecycle.test.ts.
export {
  nextVizLoopState,
  type VizLoopEvent,
  type VizLoopState,
} from "./renderer";

// ---------------------------------------------------------------------------
// The PAGE-level machine (pure contract data)
// ---------------------------------------------------------------------------

/**
 * Page lifecycle states. `open-*`/`hidden-*` split on the TRANSPORT fact
 * (idle vs playing — the phase arc's own idle state, VZ-IM-6); `hidden-*`
 * is the R3 hidden page (loop parked, queue cleared, subscription STAYS —
 * no teardown on hide, VZ-TH-3); `phone-*` is the VZ-DD-4 gate (the full
 * engine teardown ran at flip-in, the transport fact is REMEMBERED so a
 * flip back to wide re-boots into the truthful arc); `error` is the
 * VZ-HU-1 containment state (loop parked by a thrown draw, EXIT only).
 */
export type VizPageState =
  | "closed" // vizMode off — ZERO viz DOM/engines (HP-1 zero-cost clause)
  | "open-idle" // mounted, transport stopped — the rest diagram
  | "open-playing" // mounted, transport playing — the full arc
  | "hidden-idle" // R3 hidden: loop parked, subscription stays
  | "hidden-playing" // hidden while playing: drop-and-resync on show
  | "phone-idle" // VZ-DD-4 gate: engines torn down, idle remembered
  | "phone-playing" // gate while playing: audio keeps running (isolation)
  | "error"; // draw fault: loop parked, DOM error line, EXIT functional

/** Page lifecycle events (every control path funnels through these). */
export type VizPageEvent =
  | "open" // booth button / `v` — the page mounts
  | "close" // Escape / EXIT / `v` — the one closeViz funnel
  | "play" // transport start edge (observation-only, never caused by viz)
  | "stop" // transport stop edge (queue clears — VZ-TH-2)
  | "hide" // visibilitychange hidden (R3 entry)
  | "show" // visibilitychange visible (R3 exit — resync, no replay)
  | "phone" // stage-mode flip into the gate (full teardown)
  | "wide" // stage-mode flip back (engine re-boot, envelope continues)
  | "fault"; // a thrown draw reached the containment boundary

/**
 * The total page transition table. Every row is the verified wiring, not
 * an aspiration — see the module doc for the task that pinned each seam:
 * - `close` exits EVERY mounted state back to `closed` (unmount = full
 *   teardown; from `error` too — EXIT stays functional past a fault).
 * - `fault` fires only where a loop is actually drawing (`open-*`); a
 *   hidden loop is parked (no draw to throw) and the phone gate has no
 *   engine at all — both are no-ops, R3/DD-4 law.
 * - `show` never resumes a faulted loop (containment is terminal until
 *   close) and never replays hidden hits (drop-and-resync).
 * - `phone`/`wide` flip the surface WITHOUT closing it — the stage-mode
 *   effect's teardown/re-boot is the SAME checklist as unmount (VZ-DD-4
 *   verified "the stage-mode effect's returned teardown is the full
 *   VZ-HU-1 contract"), and the transport fact rides through the gate.
 */
export function nextVizPageState(
  state: VizPageState,
  event: VizPageEvent,
): VizPageState {
  switch (state) {
    case "closed":
      return event === "open" ? "open-idle" : "closed";
    case "open-idle":
      if (event === "play") return "open-playing";
      if (event === "hide") return "hidden-idle";
      if (event === "phone") return "phone-idle";
      if (event === "close") return "closed";
      if (event === "fault") return "error";
      return "open-idle";
    case "open-playing":
      if (event === "stop") return "open-idle";
      if (event === "hide") return "hidden-playing";
      if (event === "phone") return "phone-playing";
      if (event === "close") return "closed";
      if (event === "fault") return "error";
      return "open-playing";
    case "hidden-idle":
      if (event === "show") return "open-idle";
      if (event === "play") return "hidden-playing";
      if (event === "stop") return "hidden-idle";
      if (event === "phone") return "phone-idle";
      if (event === "close") return "closed";
      return "hidden-idle";
    case "hidden-playing":
      if (event === "show") return "open-playing";
      if (event === "stop") return "hidden-idle";
      if (event === "phone") return "phone-playing";
      if (event === "close") return "closed";
      return "hidden-playing";
    case "phone-idle":
      if (event === "play") return "phone-playing";
      if (event === "stop") return "phone-idle";
      if (event === "wide") return "open-idle";
      if (event === "close") return "closed";
      return "phone-idle";
    case "phone-playing":
      if (event === "stop") return "phone-idle";
      if (event === "play") return "phone-playing";
      if (event === "wide") return "open-playing";
      if (event === "close") return "closed";
      return "phone-playing";
    case "error":
      // Containment is terminal: every event except `close` is a no-op —
      // visibility flips never resume a faulted loop (the loop machine's
      // own `error` row), and only EXIT closes the surface.
      return event === "close" ? "closed" : "error";
  }
}

// ---------------------------------------------------------------------------
// The teardown checklist (ordered contract data)
// ---------------------------------------------------------------------------

/** One step of the ordered teardown every exit path executes. */
export interface VizTeardownStep {
  /** The step's identity (unique; the unit pin asserts uniqueness). */
  readonly id: string;
  /** What the step does (one line, for humans reading the contract). */
  readonly law: string;
  /** The module registry that must be EMPTY after this step (or null). */
  readonly registryProbe: string | null;
}

/**
 * THE teardown checklist, in the exact order VizPage's teardown runs
 * (source-pinned by tests/viz-state-machine.test.ts against
 * src/components/VizPage.tsx). Order is load-bearing:
 * - the ARRANGER dies FIRST — a reroll window pending at exit dies with
 *   it, so no setArrangement can fire into the teardown below it
 *   (VZ-HU-2's exit-while-arranging law);
 * - the RENDERER dies BEFORE the pipeline/engine it drives each frame;
 * - the phase controller dies before the engine whose seams it writes;
 * - the entry timer is cleared at the page level (a pending entry line
 *   never speaks into a dead page).
 */
export const VIZ_TEARDOWN_CHECKLIST: readonly VizTeardownStep[] = [
  {
    id: "clear-entry-timer",
    law: "the pending DD-2 entry announcement timer dies (no speak into a dead page)",
    registryProbe: null,
  },
  {
    id: "unsubscribe-bpm",
    law: "the doc-store BPM subscription dies (no reactive write into closures)",
    registryProbe: null,
  },
  {
    id: "stop-persistence",
    law: "the controller subscribe seam stops BEFORE the arranger dies (no write-after-dispose)",
    registryProbe: null,
  },
  {
    id: "release-summarizer",
    law: "the DD-3 textual-equivalence summarizer leaves its registry",
    registryProbe: "activeVizActivitySummarizers",
  },
  {
    id: "dispose-arranger",
    law: "ARRANGER FIRST — a pending reroll window dies here, never fires into the teardown below",
    registryProbe: "activeVizArrangementControllers",
  },
  {
    id: "dispose-renderer",
    law: "rAF cancelled, ResizeObserver disconnected, visibility + matchMedia listeners removed, refs dropped",
    registryProbe: "liveVizRendererCount",
  },
  {
    id: "dispose-pipeline",
    law: "note-on tap + transport + visibility subscriptions removed, queue dead",
    registryProbe: "activeVizPipelines",
  },
  {
    id: "dispose-phase-controller",
    law: "the IM-6 phase controller's transport subscription + eased sink die",
    registryProbe: "activeVizPhaseControllers",
  },
  {
    id: "dispose-node-engine",
    law: "the node engine's live registry + sprite cache freed",
    registryProbe: "activeVizNodeEngines",
  },
  {
    id: "dispose-announcer",
    law: "the DD-2 announcer is disposed (the region itself dies with the page)",
    registryProbe: "activeVizAnnouncers",
  },
];

/**
 * The post-exit invariant, as data: after ANY path through `close` (or a
 * phone flip, or unmount), every registry probe below reads 0 and stays 0
 * (no zombie re-arm, no pending timer firing late). `liveVizRendererCount`
 * returns a NUMBER; the rest return arrays.
 */
export const VIZ_TEARDOWN_REGISTRY_PROBES: readonly string[] = [
  "liveVizRendererCount",
  "activeVizArrangementControllers",
  "activeVizPipelines",
  "activeVizNodeEngines",
  "activeVizPhaseControllers",
  "activeVizActivitySummarizers",
  "activeVizAnnouncers",
];
