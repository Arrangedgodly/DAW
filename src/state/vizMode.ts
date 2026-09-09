/**
 * VIZ-mode UI state (VZ-IM-2): ONE ephemeral Solid signal — never document
 * state, never persisted, never undoable (the selection.ts two-tier law).
 * The VIZ page (House Lights brief, .impeccable/surfaces/viz.md) is a MODE
 * of the app, not a route: App mounts <VizPage> only while this signal is
 * true — the helpMode/InfoView precedent (App.tsx <Show>) — so VIZ closed
 * means zero VIZ DOM, listeners or subscriptions (the HP-1 zero-cost
 * clause, docs/dev/perf-budget.md §8).
 *
 * Recorded: the page starts CLOSED on every boot — `open` is never
 * persisted (VZ-IM-3 persists only last preset + last seed, later, under
 * its own versioned localStorage key).
 *
 * Transport isolation law (plan Preamble 8): flipping this signal never
 * touches the audio engine; opening/closing VIZ must never stop or alter
 * playback. This module is pure UI state.
 *
 * VZ-DD-1 — the INVOKER SEAM (the helpOverlay focus-return precedent):
 * `openViz(from)` remembers the control that opened the surface (booth
 * button click, or — under the global `v` key — the synthesized invoker:
 * focused element → last focused stage control → booth VIZ toggle);
 * `closeViz()` flips the signal off and RETURNS FOCUS to that invoker. The
 * refocus is deferred one microtask: closeViz runs inside a Solid batch
 * whose effects (the stage's `inert` removal, the page unmount) flush
 * synchronously at batch end — focusing an inert/covered element before
 * that flush would silently no-op.
 *
 * VZ-DD-2 — the exit ANNOUNCEMENT rides this same funnel: `closeViz`
 * speaks `VIZ OFF` through the ONE stage-level status region
 * (announceStage), deferred the same microtask so the stage's `inert`
 * removal has flushed and the region is back in the accessibility tree
 * (the stage goes inert under the full-bleed page, so the stage region
 * cannot carry the message earlier). This page's own region cannot
 * announce its departure — it unmounts with the page — the exact
 * reasoning state/helpMode.ts records for INFO MODE OFF. The entry
 * announcement, the preset/reroll/transport lines and the focus-INTO-
 * remote-on-entry choreography live with the page (VizPage/VizRemote).
 */

import { createSignal } from "solid-js";
import { announceStage } from "./selection";
import { VIZ_OFF_ANNOUNCEMENT } from "../viz/announcements";

const [vizMode, setVizModeSignal] = createSignal(false);

/** The control that opened the surface (null after close — one shot). */
let opener: HTMLElement | null = null;

export { vizMode };

/** Set the mode; identical sets are no-ops (nothing re-mounts). */
export function setVizMode(next: boolean): void {
  if (vizMode() === next) return;
  setVizModeSignal(next);
}

/**
 * Open the VIZ surface, remembering the invoking control for the exit's
 * focus return (helpOverlay's openHelp law). `from` is optional — the
 * booth button passes itself; the global `v` key passes the focused
 * element, the LAST focused stage control, or the booth VIZ toggle (the
 * VZ-DD-1 hardening synthesis in KeyboardShortcuts, so a `v` pressed at
 * body focus never exits onto <body>); a programmatic open (tests) may
 * pass nothing.
 */
export function openViz(from?: HTMLElement): void {
  if (from) opener = from;
  setVizMode(true);
}

/**
 * Close the VIZ surface and return focus to the invoking control (deferred
 * one microtask so the stage's `inert` removal has flushed — see the header
 * law). Clearing the opener makes every close one-shot. VZ-DD-2: the exit
 * announcement rides the same funnel + deferment through the stage status
 * region (the INFO MODE OFF precedent — the page's own region is gone with
 * the page, and the stage region was inert until this flush).
 */
export function closeViz(): void {
  setVizMode(false);
  const target = opener;
  opener = null;
  queueMicrotask(() => announceStage(VIZ_OFF_ANNOUNCEMENT));
  // Hardening: an invoker removed from the DOM while the surface was open
  // (e.g. its pattern row re-rendered away) cannot take focus — skip the
  // dead node rather than silently no-op into ambiguity.
  if (target?.isConnected) queueMicrotask(() => target.focus());
}
