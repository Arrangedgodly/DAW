/**
 * VIZ flash ceiling (VZ-DD-3) — the WCAG 2.3.1 three-flash law as PURE,
 * node-testable functions, consumed by the node engine (src/viz/nodes.ts)
 * in BOTH render modes: flash safety is not motion-optional. A music-driven
 * light show CAN strobe a hung node (one-shot windows span [0.1, 0.4] s, so
 * any lane sustaining repeats slower than its node's decay window — swung
 * 8ths at 200 BPM ≈ 6.7 Hz — lights that node as discrete rise-and-fall
 * events faster than the ceiling allows). This module is the governor that
 * holds the wall; the engine applies it per NODE (one screen region — the
 * rig hangs each node at one place, so per-node IS per-region here).
 *
 * MECHANISM (recorded production decision, VZ-DD-3):
 * - A DISCRETE flash = a node's light leaving rest (dark), rising, and
 *   returning to rest. Overlapping light — one-shot still lit when the next
 *   hit lands — never crosses rest, so a burst of overlapping hits is ONE
 *   flash, not many (the WCAG flash is a pair of OPPOSING transitions).
 * - ADMISSION: a node may BEGIN at most VIZ_FLASH_CEILING_HZ discrete
 *   flashes per trailing VIZ_FLASH_WINDOW_SECONDS (closed window
 *   [now − 1 s, now] — conservative vs the spec's "any one second period",
 *   so boundary-aligned flashes count against each other).
 * - MERGE (the denied hit's path): a hit denied by the admission window
 *   never spawns a fresh above-threshold flash. If the node's light is
 *   still lit, the hit MERGES into it — the light PINS at its level (no
 *   decay, no oscillation) until the trailing window frees (pin release =
 *   oldest admitted + 1 s), then decays once: the whole burst remains ONE
 *   flash. And EVERY denied hit lands its own visible reaction: a
 *   SUB-THRESHOLD COMPANION (one per node, refreshed — never stacked, so
 *   the deltas never sum past the bound) drawn at ≤
 *   VIZ_FLASH_MERGE_ALPHA, at/below the SC 2.3.1 general flash threshold
 *   (relative luminance change ≤ 0.1) — the criterion's explicit
 *   below-threshold branch: sub-threshold by law, not by luck.
 * - REDUCED MOTION holds derive from the same constant: a static held mark
 *   that refreshes on new hits can toggle at most once per hold, so
 *   VIZ_RM_HOLD_SECONDS = 1 / ceiling keeps static-mark cycles ≤ 3/s by
 *   construction (the grid's quantized-column precedent: instant on, hold,
 *   instant off — state changes, never animation).
 *
 * VZ-HU-3 — THE FINAL CLAMP POLICY (accept caps + engine-edge
 * normalization; magnitudes FIXED by R1 §3,
 * docs/ultron/research/r1r2-canvas-perf-dpr.md, retunable only through
 * VZ-TH-4's budget loop): this module is the ONE place the clamp
 * constants live with their rationale. The accept caps (64/s global +
 * 20/s per lane, trailing 1 s window in AUDIBLE time) sit BEFORE the
 * flash governor — the coarser whole-stage load gate first; a hit denied
 * by them takes the SAME path as a flash-denied hit (the merge: pin
 * still-lit light + the sub-threshold companion — DD-3's every-hit-a-
 * reaction law extends verbatim) and consumes NO flash admission, and
 * overs are COALESCED, never queued (a deferred hit would break the
 * audible-time one-frame law). The same-node retrigger window (120 ms)
 * lets an ADMITTED repeat hit on a still-live node REFRESH that node's
 * envelope instead of stacking a duplicate object set (the roll case —
 * one continuous decay, so it also supports the flash ceiling).
 * normalizeNoteOn is the tap-boundary policy (the pipeline consults it
 * BEFORE queue insert; the engine re-checks at ignite so every spawn
 * path sees clean hits): non-finite `audibleAt` DROPPED; zero/negative/
 * non-finite velocity → the recorded "no reaction" choice (dropped);
 * velocity above 1 clamped to 1; unknown lane dropped; pitch passes
 * through UNTOUCHED (the engine's canonicalPitch owns pitch
 * normalization: finite → clamped into the lane window, non-finite →
 * the neutral center 0.5 — the visual never breaks on degenerate data).
 *
 * Purity laws (offsetQueue/renderer/pipeline precedents): everything here is
 * pure functions + frozen constants — no DOM, no clock reads, no randomness
 * (determinism contract). Times are AUDIO-CLOCK seconds (the engine's
 * ignite/draw domain), supplied by the caller.
 */

import { ALL_LANE_IDS as LANE_IDS } from "../document/schema";
import type { VizNoteOn } from "../engine/session";

// ---------------------------------------------------------------------------
// Constants (each named after the law it serves)
// ---------------------------------------------------------------------------

/**
 * THE ceiling: at most three discrete flashes in any one-second period
 * (WCAG 2.3.1 Three Flashes or Below Threshold — the "or below" branch is
 * VIZ_FLASH_MERGE_ALPHA's job).
 */
export const VIZ_FLASH_CEILING_HZ = 3;

/** The trailing admission window, seconds (the "one second period"). */
export const VIZ_FLASH_WINDOW_SECONDS = 1;

/**
 * The sub-threshold response amplitude for denied hits on a dark node: a
 * relative-luminance change at/below 0.1 is below the SC 2.3.1 general
 * flash threshold, so it is not a flash — the criterion's alternative
 * branch, used for the one case where a denied hit cannot merge.
 */
export const VIZ_FLASH_MERGE_ALPHA = 0.1;

/**
 * The reduced-motion static-mark hold, seconds: a held mark refreshed by
 * hits toggles at most once per hold, so hold = 1 / ceiling bounds
 * static-mark cycles at ≤ VIZ_FLASH_CEILING_HZ per second by construction.
 */
export const VIZ_RM_HOLD_SECONDS = 1 / VIZ_FLASH_CEILING_HZ;

// ---------------------------------------------------------------------------
// The admission governor (pure; the engine keeps one window per node)
// ---------------------------------------------------------------------------

/**
 * Drop admitted-flash timestamps that have left the trailing one-second
 * window. The window is CLOSED at [now − 1, now]: an admission exactly one
 * second after another still counts against it (conservative under the
 * spec's "any one second period", which can close its interval on both
 * ends). Non-finite timestamps are garbage — dropped, never reinterpreted.
 */
export function pruneFlashAdmissions(
  admitted: readonly number[],
  now: number,
  windowSeconds: number = VIZ_FLASH_WINDOW_SECONDS,
): number[] {
  if (!Number.isFinite(now)) return [];
  return admitted.filter(
    (t) => Number.isFinite(t) && t >= now - windowSeconds,
  );
}

/** The governor's decision for a hit at `now` on one node. */
export interface VizFlashDecision {
  /**
   * True: this hit may BEGIN a discrete flash (fewer than the ceiling
   * admissions remain in the trailing window). False: MERGE (see module
   * doc) — never a fresh flash.
   */
  readonly admitted: boolean;
  /** The pruned trailing window INCLUDING this hit when admitted. */
  readonly window: readonly number[];
  /**
   * For merges: the audio-clock time the node's pinned light releases into
   * its single closing decay = the oldest admitted flash + one window (the
   * earliest a new discrete flash may legally begin). 0 when admitted.
   */
  readonly releaseAt: number;
}

/**
 * Decide one hit against the node's trailing admission window. PURE:
 * returns the decision + the next window; the caller owns storing it.
 */
export function governFlash(
  admitted: readonly number[],
  now: number,
  ceilingHz: number = VIZ_FLASH_CEILING_HZ,
  windowSeconds: number = VIZ_FLASH_WINDOW_SECONDS,
): VizFlashDecision {
  const window = pruneFlashAdmissions(admitted, now, windowSeconds);
  if (window.length < ceilingHz) {
    return { admitted: true, window: [...window, now], releaseAt: 0 };
  }
  const oldest = Math.min(...window);
  return {
    admitted: false,
    window,
    releaseAt: oldest + windowSeconds,
  };
}

/**
 * A denied hit on a node whose light is DARK spawns the below-threshold
 * response instead of merging: amplitude clamped to VIZ_FLASH_MERGE_ALPHA.
 * (A denied hit on a LIT node merges — pin, never a fresh flash.)
 */
export function mergeAmplitude(hitAmplitude: number): number {
  if (!Number.isFinite(hitAmplitude) || hitAmplitude <= 0) return 0;
  return Math.min(hitAmplitude, VIZ_FLASH_MERGE_ALPHA);
}

/**
 * The reduced-motion hold expiry for a mark lit/refreshed at `now`:
 * now + VIZ_RM_HOLD_SECONDS. Exported so the engine and its tests share
 * ONE derivation of the bounded hold (never a restated constant).
 */
export function rmHoldExpiry(now: number): number {
  return now + VIZ_RM_HOLD_SECONDS;
}

// ---------------------------------------------------------------------------
// VZ-HU-3 — the FINAL clamp policy (accept caps + engine-edge
// normalization). Rationale + magnitudes: R1 §3
// (docs/ultron/research/r1r2-canvas-perf-dpr.md) — retunable ONLY through
// VZ-TH-4's budget loop (tighten numbers before touching thresholds).
// ---------------------------------------------------------------------------

/**
 * The trailing rate window, seconds — the same closed [now − 1, now] law
 * as the flash window (an acceptance exactly one second after another
 * still counts against it: conservative under "any one second period").
 */
export const VIZ_ACCEPT_WINDOW_SECONDS = 1;

/**
 * Global hit-accept cap, events/second: the densest honest pattern is
 * 16ths @ 200 BPM × 4 lanes ≈ 53.33/s — 64 leaves 1.2× headroom, so the
 * cap NEVER bites honest play; it exists for pathological/engine-edge
 * streams. Overs are COALESCED (merged into live light), never queued.
 */
export const VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND = 64;

/**
 * Per-lane hit-accept cap, events/second: the densest honest single lane
 * is 13.33/s (16ths @ 200 BPM) — 20 leaves 1.5× headroom, same law.
 */
export const VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND = 20;

/**
 * THE hard live-object ceiling: ≥2× under the measured DPR-2 raster cliff
 * (~440 live objects, R1 §3 A10 — the low-end-honesty margin). Honest
 * worst-case steady state is ≈ 128–170 live (burst ≤ 8 × 53.33/s × ≤ 0.4 s
 * decay), so eviction is a safety net honest play never reaches. Final
 * home of the constant IM-5 shipped provisionally in nodes.ts.
 */
export const VIZ_MAX_LIVE_OBJECTS = 192;

/**
 * Same-node retrigger window, seconds: a repeat hit on a node whose
 * reaction is STILL LIVE and born within this window REFRESHES (re-births,
 * re-boosts) that envelope instead of spawning a duplicate object set —
 * the drum-roll case (R1 §3: also keeps node flash frequency structurally
 * low; a refresh is one continuous decay, never a rest crossing).
 */
export const VIZ_RETRIGGER_REFRESH_SECONDS = 0.12;

/**
 * Prune accepted-hit timestamps out of the trailing rate window — the
 * SAME closed-window law as pruneFlashAdmissions (one window semantics,
 * two gates: flash + rate).
 */
export function pruneAcceptWindow(
  admitted: readonly number[],
  now: number,
  windowSeconds: number = VIZ_ACCEPT_WINDOW_SECONDS,
): number[] {
  return pruneFlashAdmissions(admitted, now, windowSeconds);
}

/** The accept-cap governor's decision for one hit at `now`. */
export interface VizHitAcceptance {
  /**
   * True: the hit may ignite (both windows have room under their caps).
   * False: COALESCE — the DD-3 merge path (pin + sub-threshold
   * companion), never a fresh spawn, never queued, no flash admission.
   */
  readonly accepted: boolean;
  /** The pruned trailing GLOBAL window INCLUDING this hit when accepted. */
  readonly globalWindow: readonly number[];
  /** The pruned trailing LANE window INCLUDING this hit when accepted. */
  readonly laneWindow: readonly number[];
  /**
   * For denials: the audio-clock time the denying window(s) free = the
   * latest-freeing FULL window's oldest acceptance + one window (the pin
   * release for the coalesced light). 0 when accepted.
   */
  readonly releaseAt: number;
}

/**
 * Decide one hit against the global (64/s) and per-lane (20/s) trailing
 * accept windows. PURE: returns the decision + the next windows; the
 * caller owns storing them. A non-finite `now` is garbage — denied with
 * empty windows (never spawn on a degenerate clock read).
 */
export function governHitAcceptance(
  globalAdmitted: readonly number[],
  laneAdmitted: readonly number[],
  now: number,
  globalCapPerSecond: number = VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND,
  laneCapPerSecond: number = VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND,
  windowSeconds: number = VIZ_ACCEPT_WINDOW_SECONDS,
): VizHitAcceptance {
  if (!Number.isFinite(now)) {
    return {
      accepted: false,
      globalWindow: [],
      laneWindow: [],
      releaseAt: 0,
    };
  }
  const globalWindow = pruneAcceptWindow(globalAdmitted, now, windowSeconds);
  const laneWindow = pruneAcceptWindow(laneAdmitted, now, windowSeconds);
  const globalFull = globalWindow.length >= globalCapPerSecond;
  const laneFull = laneWindow.length >= laneCapPerSecond;
  if (globalFull || laneFull) {
    // Release = when the LAST denier frees: the pin holds until every
    // full window could have room (the next denied hit re-pins anyway).
    let releaseAt = 0;
    if (globalFull) {
      releaseAt = Math.max(releaseAt, Math.min(...globalWindow) + windowSeconds);
    }
    if (laneFull) {
      releaseAt = Math.max(releaseAt, Math.min(...laneWindow) + windowSeconds);
    }
    return { accepted: false, globalWindow, laneWindow, releaseAt };
  }
  return {
    accepted: true,
    globalWindow: [...globalWindow, now],
    laneWindow: [...laneWindow, now],
    releaseAt: 0,
  };
}

/**
 * The retrigger predicate: does a prior ignition at `birth`, still live
 * (level above dead-epsilon) at `now`, fall inside the 120 ms refresh
 * window? Then the new hit REFRESHES that envelope instead of spawning.
 * Non-finite clocks read false; the window is closed at 120 ms exactly.
 */
export function isRetriggerRefresh(
  stillLive: boolean,
  birth: number,
  now: number,
  windowSeconds: number = VIZ_RETRIGGER_REFRESH_SECONDS,
): boolean {
  if (!stillLive || !Number.isFinite(birth) || !Number.isFinite(now)) {
    return false;
  }
  const age = now - birth;
  return age >= 0 && age <= windowSeconds;
}

/**
 * The TAP-BOUNDARY engine-edge policy (VZ-HU-3, recorded decisions):
 * normalize one raw VizNoteOn into a clean one, or DROP it.
 *
 * Dropped classes — never queued, never ignited, never thrown:
 * - a null/undefined/garbage event (hostile runtime shapes);
 * - an unknown lane id (the schema type is a promise, not a guarantee);
 * - a non-finite `audibleAt` (no honest audible time to release at);
 * - zero, negative or non-finite velocity → the RECORDED choice "map to
 *   NO reaction": there is no light to show for a silent event.
 *
 * Normalized classes — carried, cleaned:
 * - velocity above 1 clamped to 1 (velocity's linear domain).
 *
 * Passed through UNTOUCHED: `pitch` (finite-but-absurd values are the
 * ENGINE's law — canonicalPitch clamps into the lane window; non-finite
 * reads the neutral center 0.5 — and finite past-dated `audibleAt`
 * values ride the queue's own stale rule; the tap re-decides nothing the
 * queue already owns). An already-clean event returns the SAME reference
 * (zero allocation on the honest hot path).
 */
export function normalizeNoteOn(hit: VizNoteOn): VizNoteOn | null {
  if (!hit) return null;
  if (!(LANE_IDS as readonly string[]).includes(hit.lane)) return null;
  if (!Number.isFinite(hit.audibleAt)) return null;
  if (!Number.isFinite(hit.velocity) || hit.velocity <= 0) return null;
  if (hit.velocity <= 1) return hit; // clean — same reference, no churn
  return { ...hit, velocity: 1 };
}
