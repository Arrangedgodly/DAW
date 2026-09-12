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
import { phonePage, showPhonePage, togglePhonePage } from "../state/phonePage";

export function DesktopPageNavigation(): JSX.Element {
  return (
    <nav
      class="desktop-page-nav"
      aria-label="Workspace view"
      data-help="workspace.pages"
    >
      <button
        type="button"
        data-page="edit"
        aria-pressed={phonePage() === "edit"}
        onClick={() => showPhonePage("edit")}
      >
        Instruments 1–4
      </button>
      <button
        type="button"
        data-page="instruments"
        aria-pressed={phonePage() === "instruments"}
        onClick={() => showPhonePage("instruments")}
      >
        Instruments 5–8
      </button>
      <button
        type="button"
        data-page="song"
        aria-pressed={phonePage() === "song"}
        onClick={() => showPhonePage("song")}
      >
        Song arrangement
      </button>
    </nav>
  );
}

registerHelp([
  {
    id: "workspace.pages",
    title: "WORKSPACE PAGES",
    text: "Instruments 1–4 opens the default note editors. Instruments 5–8 opens four optional instrument slots. Song arrangement shows the pattern chains for every instrument in the project. Playback continues when you change pages.",
  },
  {
    id: "phone.page",
    title: "SONG PAGE",
    text: "Switches between editing notes and the song arrangement for all instruments in the project. Tap a pattern while playing to cue it. Each pattern can loop until you choose another, or play once and advance to the next pattern.",
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
  return (
    <button
      type="button"
      class="phone-page-toggle"
      aria-label={phonePage() === "song" ? "Edit notes" : "Song arrangement"}
      data-help="phone.page"
      onClick={() => togglePhonePage()}
    >
      {phonePage() === "song" ? "NOTES" : "SONG"}
    </button>
  );
}
