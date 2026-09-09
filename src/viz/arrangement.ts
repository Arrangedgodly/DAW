/**
 * VizArrangementController (VZ-HU-2) — the re-deal orchestrator: reroll and
 * preset cycling as CONTROL SEMANTICS, the surface the chrome (VZ-DD-1)
 * binds to. This module owns no DOM and draws nothing — it decides WHEN a
 * new arrangement is dealt, WHICH seed deals it, and drives the engine's
 * `setArrangement` (the full teardown-and-mount the engine already
 * guarantees: live objects cleared, counters reset, sprite cache rebuilt
 * for exactly the new rig's keys — zero buildup across spam by
 * construction).
 *
 * THE COALESCING LAW (plan VZ-HU-2: "last-wins, ONE regeneration per
 * commit, no queued backlog"):
 * - `reroll()` REQUESTS a re-deal. Requests within the coalescing window
 *   re-arm ONE timer — at most one pending intent EXISTS at any moment
 *   (there is no queue to drain). The window is trailing-edge (last-wins):
 *   a burst of N rapid requests commits EXACTLY ONE regeneration when the
 *   window closes after the final request.
 * - The window is `VIZ_REROLL_COALESCE_MS` = 150 ms: tight enough that a
 *   patient single click re-deals inside the perceptual-immediacy budget
 *   (Professor X advisory; well under the ~200 ms "felt instant" line),
 *   wide enough to swallow honest spam (inter-click gaps ~60–120 ms).
 *   RECORDED production constant — tunable here, one number.
 * - `cycle(delta)` (preset prev/next through `cycleVizPreset`, wrapping
 *   both directions) commits IMMEDIATELY and synchronously: preset
 *   browsing steps must land (one deal per committed switch, teardown each
 *   — the engine's setArrangement), and a cycle SUPERSEDES any pending
 *   reroll (the latest control wins; the uncommitted intent dies — it
 *   consumed nothing). RECORDED: cycling is deliberately NOT debounced;
 *   each browse step is a distinct user-visible rig.
 *
 * THE SEED LAW (determinism contract — no Math.random, xorshift32 only):
 * every committed deal — reroll OR cycle — draws the NEXT seed from ONE
 * seeded xorshift32 stream (`VIZ_REROLL_STREAM_SEED`, overridable for
 * tests), never the current arrangement's seed (`nextRerollSeed` redraws
 * past a collision, so a reroll ALWAYS visibly re-deals). Consequence: the
 * same (stream seed, initial deal, request script) triple always produces
 * the same sequence of envelopes and deep-equal arrangements — the joy
 * loop is reproducible by construction, and VZ-IM-3 can persist the
 * readable envelope (`envelope()` / `subscribe` — fired once per COMMIT)
 * without this module knowing storage exists.
 *
 * THE TRANSITION DECISION (plan open-decisions table, owned here —
 * RECORDED): **CUT**. A committed switch swaps the whole rig on the next
 * frame with full teardown between arrangements — the fence-lean default;
 * a dissolve would carry cross-rig state through the swap (exactly the
 * buildup this task exists to prevent) and spends frames VZ-TH-4 has not
 * budgeted yet. `engine.setArrangement` IS the cut; revisit only if the
 * M2 joy review says otherwise (then budget-gated by VZ-TH-4).
 *
 * Hulk-lens paths held by construction: spam → one commit; switch
 * mid-burst → pending dies, cycle lands; stop-while-rerolling → transport
 * is not this module's concern (the pipeline clears its own queue) and the
 * pending window is transport-independent; exit-while-arranging →
 * `dispose()` cancels the armed timer and drops every ref, so NO set-
 * Arrangement can fire after teardown (and the engine would ignore it
 * anyway — its own disposed guard). Listeners are contained: a throwing
 * subscriber never breaks a commit (the session tap precedent).
 */

import { xorshift32 } from "../audio/fx";
import type { VizNodeEngineProbe } from "./nodes";
import {
  arrangementEnvelope,
  cycleVizPreset,
  generateArrangement,
  type VizArrangement,
  type VizArrangementEnvelope,
  type VizPreset,
} from "./presets";

// ---------------------------------------------------------------------------
// Constants (each named after the law it serves)
// ---------------------------------------------------------------------------

/**
 * The reroll coalescing window, milliseconds (trailing-edge, last-wins).
 * 150 ms commits a patient click within the perceptual-immediacy budget
 * while collapsing any honest spam burst into one regeneration. RECORDED
 * production decision (VZ-HU-2); tests inject the timer, never shrink the
 * law itself.
 */
export const VIZ_REROLL_COALESCE_MS = 150;

/**
 * The boot seed of the reroll seed STREAM — NOT an arrangement seed: the
 * stream exists so that "same session script ⇒ same sequence of deals"
 * holds across boots (deterministic rerolls are a feature the fingerprint
 * gates can pin, never a weakness). Non-zero u32 (xorshift32's only fixed
 * point); overridable per-controller for tests.
 */
export const VIZ_REROLL_STREAM_SEED = 0x5eed1234;

// ---------------------------------------------------------------------------
// Pure seed math (node-testable, no DOM)
// ---------------------------------------------------------------------------

/**
 * Draw the next reroll seed from a raw xorshift32 stream, skipping the
 * current arrangement's seed (a reroll must always visibly re-deal) and
 * the degenerate 0. Bounded redraw (4 tries — collision odds ~2⁻³² per
 * try) with a total fallback of current+1: deterministic for ANY stream,
 * never loops forever, never returns the seed it was given. PURE.
 */
export function nextRerollSeed(
  rand: () => number,
  currentSeed: number,
): number {
  const current = currentSeed >>> 0;
  for (let i = 0; i < 4; i++) {
    const candidate = rand() >>> 0;
    if (candidate !== 0 && candidate !== current) return candidate;
  }
  return (current + 1) >>> 0; // unreachable in practice; total by law
}

// ---------------------------------------------------------------------------
// The controller (every effect an injected seam; timer included)
// ---------------------------------------------------------------------------

/** Cancellation handle for a scheduled commit (the timer seam). */
export type VizScheduleCancel = () => void;

/** Timer seam: default the real setTimeout; unit tests drive a manual clock. */
export type VizSchedule = (fn: () => void, ms: number) => VizScheduleCancel;

const realSchedule: VizSchedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/**
 * What the orchestrator drives: the node engine's swap surface. Structural
 * so unit tests mount recorders and VizPage mounts the real engine; the
 * optional `probe` passthrough feeds the bounded-node evidence browsers
 * read (HW-3's spam journey ledger).
 */
export interface VizArrangementMount {
  /** FULL teardown between arrangements + mount of the new rig (the CUT). */
  setArrangement(arrangement: VizArrangement): void;
  probe?(): VizNodeEngineProbe;
}

export interface VizArrangementControllerOptions {
  /** The engine whose rig this controller re-deals. */
  readonly engine: VizArrangementMount;
  /**
   * The boot deal the engine was constructed with (VizPage passes the SAME
   * object it handed createVizNodeEngine — one deal, and the controller's
   * envelope derives from it, so no teardown happens at boot: commits are
   * the only setArrangement calls it ever issues).
   */
  readonly initial: VizArrangement;
  /** Seed-stream boot (default VIZ_REROLL_STREAM_SEED; tests pin/differ it). */
  readonly streamSeed?: number;
  /** Coalescing window override (default VIZ_REROLL_COALESCE_MS). */
  readonly coalesceMs?: number;
  /** Timer seam (default setTimeout/clearTimeout). */
  readonly schedule?: VizSchedule;
}

/** Inert snapshot — no behavior, no allocation pressure. */
export interface VizArrangementControllerProbe {
  /** Current deal's envelope facts (the VZ-IM-3 readable seam). */
  readonly presetId: string;
  readonly seed: number;
  /** A coalesced reroll is armed (request accepted, not yet committed). */
  readonly pendingReroll: boolean;
  /** Raw reroll() calls since boot — the spam ledger (≫ commits = coalesced). */
  readonly rerollRequests: number;
  /** Committed re-deals since boot (reroll + cycle; boot excluded). */
  readonly commits: number;
  /** Committed re-deals from coalesced reroll windows. */
  readonly rerollCommits: number;
  /** Committed preset switches (immediate, one per cycle() call). */
  readonly cycleCommits: number;
  /** Timers currently armed (the no-backlog law: 0 or 1, never more). */
  readonly armedTimers: number;
  /** The mounted engine's own probe (null post-dispose or if it has none). */
  readonly engine: VizNodeEngineProbe | null;
}

export interface VizArrangementController {
  /**
   * Request a re-deal of the CURRENT preset's arrangement (coalesced:
   * rapid requests collapse into ONE committed regeneration, last-wins,
   * when the window closes after the final request).
   */
  reroll(): void;
  /**
   * Switch preset by `delta` steps through library order (wraps both
   * directions) — an IMMEDIATE committed switch with full teardown, which
   * also supersedes any pending reroll.
   */
  cycle(delta: number): void;
  /** The current deal's envelope — the VZ-IM-3 persistence seam (read-only). */
  envelope(): VizArrangementEnvelope;
  /** The current library preset (name + id — the chrome's readout source). */
  preset(): VizPreset;
  /** The current deal (null after dispose). */
  arrangement(): VizArrangement | null;
  /**
   * Fired once per COMMITTED deal with the new envelope (never for
   * requests). Contained: a throwing listener never breaks the commit.
   */
  subscribe(
    listener: (envelope: VizArrangementEnvelope) => void,
  ): () => void;
  /** Inert snapshot. */
  probe(): VizArrangementControllerProbe;
  /**
   * Cancel any pending reroll, drop every ref (engine, deal, listeners).
   * No commit can fire after. Terminal, idempotent; probe stays readable.
   */
  dispose(): void;
}

// -- module-level registry (inert; the in-page browser idiom drives it) ------

const liveControllers = new Set<VizArrangementController>();

/**
 * Live controllers, oldest first (0 after every dispose — the teardown
 * probe; the renderer's liveVizRendererCount precedent). The in-page
 * browser idiom (viz-mount/fingerprint precedents) grabs the mounted
 * page's controller from here to drive reroll/cycle until VZ-DD-1's
 * chrome ships the buttons/keys that call the same methods.
 */
export function activeVizArrangementControllers(): readonly VizArrangementController[] {
  return [...liveControllers];
}

export function createVizArrangementController(
  opts: VizArrangementControllerOptions,
): VizArrangementController {
  const schedule = opts.schedule ?? realSchedule;
  const coalesceMs =
    Number.isFinite(opts.coalesceMs) && opts.coalesceMs! >= 0
      ? opts.coalesceMs!
      : VIZ_REROLL_COALESCE_MS;
  // The seed stream — one xorshift32 draw per committed deal, in commit
  // order: the sequence of arrangements is a pure function of (streamSeed,
  // initial deal, request script). xorshift32 normalizes 0 itself.
  const rand = xorshift32((opts.streamSeed ?? VIZ_REROLL_STREAM_SEED) >>> 0);

  let engine: VizArrangementMount | null = opts.engine;
  let deal: VizArrangement | null = opts.initial;
  let envelope: VizArrangementEnvelope = arrangementEnvelope(opts.initial);
  let pendingCancel: VizScheduleCancel | null = null;
  let pendingReroll = false;
  let rerollRequests = 0;
  let commits = 0;
  let rerollCommits = 0;
  let cycleCommits = 0;
  let disposed = false;
  const listeners = new Set<(envelope: VizArrangementEnvelope) => void>();

  /** Cancel the armed window (re-arm or teardown — the only timer path). */
  const cancelPending = (): void => {
    pendingCancel?.();
    pendingCancel = null;
    pendingReroll = false;
  };

  /** ONE regeneration: fresh seed → deal → engine cut → envelope → notify. */
  const commitDeal = (preset: VizPreset, kind: "reroll" | "cycle"): void => {
    const seed = nextRerollSeed(rand, envelope.seed);
    const next = generateArrangement(preset, seed);
    engine?.setArrangement(next); // full teardown + mount (the recorded CUT)
    deal = next;
    envelope = { version: 1, presetId: preset.id, seed };
    commits++;
    if (kind === "reroll") rerollCommits++;
    else cycleCommits++;
    // Contained notification (the session tap's listener law): iterate a
    // snapshot so a subscribe/unsubscribe mid-emit cannot skew delivery,
    // and one listener's throw never breaks the commit or the others.
    for (const listener of [...listeners]) {
      try {
        listener(envelope);
      } catch {
        /* contained — the deal is committed regardless */
      }
    }
  };

  const controller: VizArrangementController = {
    reroll() {
      if (disposed) return;
      rerollRequests++;
      cancelPending(); // last-wins re-arm: at most ONE timer ever exists
      pendingReroll = true;
      // The staleness guard makes the one-commit law hold even under a
      // hostile timer seam: only the NEWEST window's callback may commit
      // (an older, properly canceled timer that fired anyway reads as
      // stale and stands down without touching the newer handle).
      let cancel: VizScheduleCancel = () => {};
      cancel = schedule(() => {
        if (pendingCancel !== cancel) return; // stale — a newer window won
        pendingCancel = null;
        pendingReroll = false;
        if (disposed) return;
        commitDeal(
          cycleVizPreset(envelope.presetId, 0), // same preset; unknown → 0
          "reroll",
        );
      }, coalesceMs);
      pendingCancel = cancel;
    },
    cycle(delta) {
      if (disposed || !Number.isFinite(delta)) return;
      cancelPending(); // the switch supersedes any pending re-deal
      commitDeal(cycleVizPreset(envelope.presetId, Math.trunc(delta)), "cycle");
    },
    envelope() {
      return { ...envelope };
    },
    preset() {
      return cycleVizPreset(envelope.presetId, 0);
    },
    arrangement() {
      return deal;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    probe() {
      return {
        presetId: envelope.presetId,
        seed: envelope.seed,
        pendingReroll,
        rerollRequests,
        commits,
        rerollCommits,
        cycleCommits,
        armedTimers: pendingCancel !== null ? 1 : 0,
        engine: engine?.probe?.() ?? null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPending(); // exit-while-arranging: no commit after teardown
      listeners.clear();
      liveControllers.delete(controller);
      engine = null; // drop refs — nothing of the rig survives the page
      deal = null;
    },
  };

  liveControllers.add(controller);
  return controller;
}
