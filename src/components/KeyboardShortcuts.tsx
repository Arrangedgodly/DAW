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
import { activeLane, activePatterns, selectPattern } from "../state/selection";
import { helpOpen, openHelp } from "../state/helpOverlay";
import { toggleHelp } from "../state/helpMode";
import { closeViz, openViz, vizMode } from "../state/vizMode";
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

/**
 * The LAST-FOCUS ledger (VZ-DD-1 hardening — the `v`-entry invoker seam):
 * the exit funnel's help copy promises "focus lands back where you left
 * it", but a `v` pressed while focus rests on <body> (mouse users, fresh
 * boots) used to open with NO invoker, so every exit landed nowhere. The
 * focusin ledger below remembers the last focusable stage control, and the
 * `v` handler synthesizes the entry invoker as: the focused element →
 * else the last focused stage control (while connected) → else the booth
 * VIZ toggle ("returns to the booth" — the same fallback the EXIT help
 * copy names). Never recorded: focus inside the VIZ page itself (the
 * surface is full-bleed and unmounts at exit — a viz-page invoker would
 * focus a dead node), and <body> itself (that IS the nowhere case).
 */
let lastStageFocus: HTMLElement | null = null;

export default function KeyboardShortcuts(): JSX.Element {
  const onFocusIn = (e: FocusEvent) => {
    if (vizMode()) return; // focus inside the surface is no return target
    const t = e.target;
    if (t instanceof HTMLElement && t !== document.body) lastStageFocus = t;
  };

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
    // entries so native text undo survives; and VZ-DD-1: skipped while the
    // VIZ surface is on (an invisible history edit under the full-bleed
    // page is the same keystroke lie as n/d/r).
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      (e.key === "z" || e.key === "y")
    ) {
      if (isTextEntry(target)) return;
      if (vizMode()) return;
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
    // VZ-DD-1 (keyboard.md §"VIZ page"): `v` toggles the visualizer
    // surface from anywhere — the entry key with no v2-region collision
    // (the `i` help-mode twin). Opening remembers the focused element as
    // the invoker so the exit returns focus there; closing rides the same
    // closeViz funnel as Escape and the remote's EXIT.
    if (e.key === "v") {
      e.preventDefault();
      if (vizMode()) closeViz();
      else {
        // VZ-DD-1 hardening: synthesize the invoker so the exit NEVER
        // lands on <body> — the focused element, else the last focused
        // stage control (the focusin ledger above), else the booth VIZ
        // toggle (the copy's "returns to the booth").
        const focused =
          target instanceof HTMLElement && target !== document.body
            ? target
            : null;
        const last =
          lastStageFocus?.isConnected === true ? lastStageFocus : null;
        openViz(
          focused ?? last ?? document.querySelector<HTMLElement>(".booth-btn-viz") ?? undefined,
        );
      }
      return;
    }
    // While the VIZ surface is on, the covered stage's edit keys (n/d/r)
    // stand down — the remote owns the keyboard (the stage is inert, and
    // an invisible pattern edit is a keystroke lie). `i` stays live: help
    // mode outranks VIZ in the Escape order and must stay reachable on the
    // surface.
    if (vizMode() && e.key !== "i") return;
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
    }
  };

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focusin", onFocusIn);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focusin", onFocusIn);
    });
  });

  return <HelpOverlay />;
}
