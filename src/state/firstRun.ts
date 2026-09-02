/**
 * First-run nudge (PX-1): on the FIRST run only (no projects ever existed in
 * IDB — boot.ts arms this when it creates the WELCOME SONG demo), the booth
 * carries a subtle in-world pulse on PLAY until the first play. A nudge, not
 * a modal: no focus steal, no blocking surface, purely additive styling.
 *
 * Ephemeral UI state (D1 two-tier): Solid signal, never in the document or
 * undo history. Dismissed by the first play; if the user reloads without
 * playing, the next boot is no longer a first run, so the nudge does not
 * return (the first-run moment passed).
 */

import { createSignal } from "solid-js";

const [nudge, setNudge] = createSignal(false);

/** Boot calls this when the first-run demo project was just created. */
export function armFirstRunNudge(): void {
  setNudge(true);
}

/** The first PLAY press consumes the nudge (Booth). */
export function dismissFirstRunNudge(): void {
  setNudge(false);
}

/** True while the first-run PLAY pulse should show. */
export function firstRunNudge(): boolean {
  return nudge();
}
