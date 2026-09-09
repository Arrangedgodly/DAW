/**
 * VZ-IM-3 — viz SESSION state: the ephemeral module signals for the
 * visualizer's deal (activePresetId + seed as one envelope), plus the
 * boot-restore and commit-persist wiring over src/viz/persist.ts.
 *
 * TWO-TIER STATE LAW (plan Preamble 7): viz state is ephemeral module
 * signals plus ONE localStorage key — the vizMode precedent (never
 * docStore, never schema, never undoable). Within a session the SIGNAL is
 * the truth; localStorage is only the cross-boot memory (write-through on
 * committed deals, read-once at boot, silent fallback when absent).
 *
 * THE SESSION-ONCE RESTORE: `restoreVizPrefs()` reads storage only the
 * FIRST time it runs per session (JS module lifetime). Rationale: after
 * the first restore, the signal outranks storage — if a later write
 * failed (quota), a re-read on VIZ remount would resurrect a STALE
 * envelope over the in-session truth. VizPage may mount/unmount freely;
 * every later call is a pure signal read.
 *
 * COMMIT = the only write path: VizPage wires the arrangement
 * controller's `subscribe` (one emission per COMMITTED deal — reroll
 * windows coalesce first, VZ-HU-2) straight into `commitVizEnvelope`.
 * Pending reroll requests never touch storage; boot never writes (a
 * fresh install stays keyless until the user's first committed deal —
 * no write amplification, no defaults churn).
 *
 * The chrome (VZ-DD-1) consumes `vizPrefs()` reactively for the preset
 * readout; cycle/reroll keep driving the controller, whose commits land
 * here. This module owns no DOM, draws nothing, knows no transport.
 */

import { createSignal } from "solid-js";
import {
  VIZ_DEFAULT_PRESET_ID,
  VIZ_PRESETS,
  generateArrangement,
  type VizArrangement,
  type VizArrangementEnvelope,
} from "./presets";
import { VIZ_DEFAULT_SEED } from "./nodes";
import {
  readVizPrefs,
  writeVizPrefs,
  type VizPrefsStorage,
} from "./persist";

/**
 * The no-memory boot envelope: the FIRST library preset (VIZ_DEFAULT_PRESET_ID
 * — presets.ts guarantees it is entry 0) under the fixed first-boot seed
 * (nodes.ts VIZ_DEFAULT_SEED — the deal the two-boot fingerprint gate pins).
 * This is what every fallback path lands on: absent, corrupt, stale or
 * unknown-version memory all mean "same as a fresh install".
 */
export function defaultVizPrefsEnvelope(): VizArrangementEnvelope {
  return {
    version: 1,
    presetId: VIZ_DEFAULT_PRESET_ID,
    seed: VIZ_DEFAULT_SEED,
  };
}

const [vizPrefsSignal, setVizPrefsSignal] = createSignal(
  defaultVizPrefsEnvelope(),
);

/** Whether the one-per-session storage restore has run yet. */
let restored = false;

/**
 * The session's current deal envelope (activePresetId + seed) — the
 * reactive read for chrome/readouts. Read-only outside this module.
 */
export function vizPrefs(): VizArrangementEnvelope {
  return vizPrefsSignal();
}

/**
 * BOOT RESTORE: read the persisted envelope from storage ONCE per session
 * and adopt it; absent/corrupt/stale storage silently leaves the default
 * (the fallback law — no throw, no toast, no console noise). Returns the
 * session's current envelope either way, so VizPage can boot the rig from
 * the result synchronously. Explicit storage argument is the test seam.
 */
export function restoreVizPrefs(
  storage?: VizPrefsStorage | null,
): VizArrangementEnvelope {
  if (!restored) {
    restored = true;
    const envelope = readVizPrefs(storage); // null on ANY failure mode
    if (envelope) setVizPrefsSignal(envelope);
  }
  return vizPrefsSignal();
}

/**
 * RECORD A COMMITTED DEAL (the controller's subscribe seam): update the
 * session signal FIRST (in-session truth must survive a failed write),
 * then persist through the silent-law store — quota/absent storage costs
 * continuity across boots, never the running session.
 */
export function commitVizEnvelope(
  envelope: VizArrangementEnvelope,
  storage?: VizPrefsStorage | null,
): void {
  setVizPrefsSignal(envelope);
  writeVizPrefs(envelope, storage);
}

/**
 * The arrangement a VIZ mount boots its rig from: the session envelope
 * re-dealt via the pure generator (restore once, then always the current
 * signal — remounts continue the session, they do not rewind it). The
 * unknown-preset guard already ran at read time; the `?? entry-0` lookup
 * only defends against library churn between read and deal (a removed
 * preset id degrades to the first library preset, never a crash).
 */
export function bootVizArrangementFromPrefs(): VizArrangement {
  const envelope = restoreVizPrefs();
  const preset =
    VIZ_PRESETS.find((p) => p.id === envelope.presetId) ?? VIZ_PRESETS[0]!;
  return generateArrangement(preset, envelope.seed);
}

/**
 * TEST-ONLY: reset the module session (signal → default envelope, restore
 * flag cleared) WITHOUT touching storage — unit tests re-run boot journeys
 * against injected storages inside one module instance.
 */
export function resetVizPrefsForTests(): void {
  restored = false;
  setVizPrefsSignal(defaultVizPrefsEnvelope());
}
