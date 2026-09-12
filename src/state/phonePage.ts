/**
 * Phone page (2026-09-11, user call — the session/arrangement split, phone
 * only): EDIT is the single-lane note grid; SONG is the dedicated sequencer —
 * every lane's chain as large tiles (cue, ⟲/→, add, labels, pattern tools).
 * View state, never document; desktop and tablet ignore it (their rail and
 * quadrants are always on screen together).
 */

import { createSignal } from "solid-js";

export type PhonePage = "edit" | "song";

const [phonePage, setPhonePage] = createSignal<PhonePage>("edit");

export { phonePage };

export function showPhonePage(page: PhonePage): void {
  setPhonePage(page);
}

/** Flip EDIT ⇄ SONG; returns the page now showing. */
export function togglePhonePage(): PhonePage {
  const next: PhonePage = phonePage() === "edit" ? "song" : "edit";
  setPhonePage(next);
  return next;
}
