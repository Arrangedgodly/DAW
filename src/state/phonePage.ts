/**
 * Stage page (2026-09-11, user call — the session/arrangement split): EDIT is
 * the note grid (one lane on the phone, the quadrants on desktop/tablet);
 * SONG is the dedicated sequencer — every lane's chain as tiles (cue, ⟲/→,
 * add, labels, pattern tools). View state, never document.
 *
 * 2026-09-11 (second user call): the split is now stage-WIDE. Desktop and
 * tablet used to wear the chain as a permanent bar above the quadrants,
 * which the user rejected — the arrangement is a PLACE you go to, on every
 * stage, not a strip that steals height from the grids. The identifiers keep
 * their `phonePage` spelling (a rename would churn a dozen committed gates
 * for no behavior); read them as "stage page".
 */

import { createSignal } from "solid-js";

export type PhonePage = "edit" | "song";

const [phonePage, setPhonePage] = createSignal<PhonePage>("edit");

export { phonePage };

export function showPhonePage(page: PhonePage): void {
  setPhonePage(page);
  scrollPageTop();
}

/** Flip EDIT ⇄ SONG; returns the page now showing. */
export function togglePhonePage(): PhonePage {
  const next: PhonePage = phonePage() === "edit" ? "song" : "edit";
  setPhonePage(next);
  scrollPageTop();
  return next;
}

/**
 * A page switch lands at the TOP of the page it opens (2026-09-11 user
 * report: "when you click on song, it doesn't scroll you to the song
 * section"). The phone stage scrolls the DOCUMENT, so a switch made from
 * halfway down the grid would otherwise open the new page mid-scroll. The
 * hidden page keeps its own internal scroll place — this moves the window,
 * not the grids.
 */
function scrollPageTop(): void {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior: "auto" });
}
