/**
 * KeyboardShortcuts (DA-1): the app-level shortcut map — the bindings that
 * need cross-component knowledge (help overlay, undo/redo, transport space,
 * pattern ops on the ACTIVE lane). Grid-internal keys live in the renderer
 * (src/grid/renderer.ts); pure math in src/grid/keynav.ts; the spec in
 * docs/dev/keyboard.md.
 *
 * Law (exclusions): these never fire while typing in a text entry (inline
 * rename/cue fields, the tempo input) and never swallow Tab or
 * browser/screen-reader keys.
 */

import { onCleanup, onMount, type JSX } from "solid-js";
import { getSession } from "../engine/session";
import {
  addPattern,
  docStore,
  duplicatePattern,
  redo,
  undo,
} from "../state/store";
import { activeLane, activePatterns, announceDrumsNoOctave, selectPattern, stepLaneOctave } from "../state/selection";
import { helpOpen, openHelp } from "../state/helpOverlay";
import { toggleHelp } from "../state/helpMode";
import HelpOverlay from "./HelpOverlay";

const session = getSession();

/** True when the event target is a text entry — letter shortcuts stand down. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return (
      type !== "checkbox" &&
      type !== "radio" &&
      type !== "range" &&
      type !== "button"
    );
  }
  return false;
}

export default function KeyboardShortcuts(): JSX.Element {
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;

    // Help overlay open: everything except its own handling stands down.
    if (helpOpen()) return;

    // ? opens help (never while typing; Shift+/ produces "?").
    if (e.key === "?" && !isTextEntry(target)) {
      e.preventDefault();
      openHelp(target ?? undefined);
      return;
    }

    // Undo / redo — Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl/⌘+Y. Skipped in text
    // entries so native text undo survives.
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      (e.key === "z" || e.key === "y")
    ) {
      if (isTextEntry(target)) return;
      e.preventDefault();
      if (e.key === "y" || e.shiftKey) redo();
      else undo();
      return;
    }

    // Space = play/stop ONLY at body/document level (an interactive target
    // — button, cell, range — keeps its native Space meaning; inside grids
    // Space toggles the cell per the APG contract).
    if (
      e.key === " " &&
      (target === document.body ||
        target === null ||
        target === document.documentElement)
    ) {
      e.preventDefault();
      void session.togglePlay();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Pattern ops on the active lane (single letters, never in text fields).
    if (isTextEntry(target)) return;
    const lane = activeLane();
    if (e.key === "n") {
      e.preventDefault();
      const n = docStore.getState().doc.patterns[lane].length;
      const name = n < 26 ? String.fromCharCode(65 + n) : `P${n + 1}`;
      const id = addPattern(lane, 1, name);
      selectPattern(lane, id);
    } else if (e.key === "d") {
      e.preventDefault();
      const id = duplicatePattern(lane, activePatterns()[lane]);
      if (id) selectPattern(lane, id);
    } else if (e.key === "r") {
      // Rename via rail focus (spec): focus the active lane's REN control;
      // the inline field takes over from there. Refinement-6: REN lives in
      // the row's pattern-tools menu — when it is not rendered, open the
      // menu (the trigger click lands focus on REN itself).
      e.preventDefault();
      const rail = document.querySelector(`.rail-row[data-lane="${lane}"]`);
      const ren = rail?.querySelector<HTMLElement>('[data-help="rail.rename"]');
      if (ren) ren.focus();
      else rail?.querySelector<HTMLElement>(".rail-tools-trigger")?.click();
    } else if (e.key === "i") {
      // HP-1 (keyboard.md v2): toggle help mode (the info view) — the same
      // guards as n/d/r (never in text entries, never with an AT/browser
      // modifier held). While ON, Escape exits the mode first (InfoView's
      // capture handler owns that keystroke).
      e.preventDefault();
      toggleHelp();
    } else if (e.key === "o" || e.key === "O") {
      // RC-1 (v3, i3-2): OCTAVE transpose of the ACTIVE lane — `o` +1,
      // Shift+`o` −1. Pitched lanes only: drums answers with the refusal
      // announcement (the drum voice model has no pitch resolution). Same
      // guards as the pattern-ops family (text-entry + AT-modifier skips
      // happened above). ONE funnel with the strip buttons (E8); the press
      // never auditions and never scrolls the register window (E9 fence).
      e.preventDefault();
      if (lane === "drums") announceDrumsNoOctave();
      else stepLaneOctave(lane, e.shiftKey ? -1 : 1);
    }
  };

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return <HelpOverlay />;
}
