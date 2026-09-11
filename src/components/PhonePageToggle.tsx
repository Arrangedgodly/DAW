/**
 * PhonePageToggle — the phone's EDIT ⇄ SONG key (2026-09-11). Rides the
 * pinned transport row's right edge column (the M-4 1fr-auto-1fr grid keeps
 * PLAY exactly centered), so switching pages costs zero chrome height. Lit
 * (aria-pressed) while the SONG sequencer page is showing.
 */

import type { JSX } from "solid-js";
import { registerHelp } from "../help/registry";
import { phonePage, togglePhonePage } from "../state/phonePage";

registerHelp([
  {
    id: "phone.page",
    title: "SONG PAGE",
    text: "Switches between the note grid (EDIT) and the SONG page — every lane's chain of patterns as big tiles. Tap a tile while playing to jump that lane to it; tap a tile's arrow to choose what it does when it ends: ⟲ loops it until you pick another, → plays it once and moves on.",
  },
]);

export default function PhonePageToggle(): JSX.Element {
  return (
    <button
      type="button"
      class="phone-page-toggle"
      data-help="phone.page"
      aria-pressed={phonePage() === "song"}
      onClick={() => togglePhonePage()}
    >
      SONG
    </button>
  );
}
