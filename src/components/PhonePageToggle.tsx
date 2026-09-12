/**
 * The EDIT ⇄ SONG page key (2026-09-11).
 *
 * Phone: rides the pinned transport row's right edge column (the M-4
 * 1fr-auto-1fr grid keeps PLAY exactly centered), so switching pages costs
 * zero chrome height.
 *
 * Desktop/tablet (2026-09-11, second user call): the SAME control rides the
 * booth's playback group — the chain stopped being a permanent bar on the
 * stage, so every stage now reaches the arrangement through one key. One
 * component, one handler, one help entry: the two mounts differ only by the
 * chassis class they wear.
 *
 * Lit (aria-pressed) while the SONG page is showing.
 */

import type { JSX } from "solid-js";
import { registerHelp } from "../help/registry";
import { phonePage, togglePhonePage } from "../state/phonePage";

registerHelp([
  {
    id: "phone.page",
    title: "SONG PAGE",
    text: "Switches between the note grid (EDIT) and the SONG page — every lane's chain of patterns as tiles, all four lanes at once. Tap a tile while playing to jump that lane to it; tap a tile's arrow to choose what it does when it ends: ⟲ loops it until you pick another, → plays it once and moves on.",
  },
]);

/** The shared key; `class` picks the chassis (phone strap vs booth). */
export function SongPageButton(props: { class: string }): JSX.Element {
  return (
    <button
      type="button"
      class={props.class}
      data-help="phone.page"
      aria-pressed={phonePage() === "song"}
      onClick={() => togglePhonePage()}
    >
      SONG
    </button>
  );
}

export default function PhonePageToggle(): JSX.Element {
  return <SongPageButton class="phone-page-toggle" />;
}
