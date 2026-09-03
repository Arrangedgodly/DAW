/**
 * InfoView (HP-1) — the Ableton-style info view in the world's vocabulary:
 * a fixed bottom status bar that names and explains whichever registered
 * control the pointer hovers or keyboard focus rests on (town-hall I2-6).
 * Mounted by App ONLY while help mode is on — zero DOM, zero listeners,
 * zero per-frame cost while off (TH-4 c / docs/dev/perf-budget.md §8).
 *
 * Semantics (a11y §7 E6): role="status" aria-live="polite", NOT focusable,
 * NOT in the tab order (a non-interactive status region cannot trap);
 * updates on keyboard FOCUS of any registered control, not just hover.
 *
 * Pointer pass-through (HP-1's recorded production decision, per the plan
 * risk note): the bar is pointer-events:none and the listeners only OBSERVE
 * (never preventDefault/stopPropagation), so every control keeps working
 * while the mode is on — Ableton behavior — and toggling the mode mid-gesture
 * can never corrupt an active drag (the IN-4 contract; nothing here touches
 * the gesture framework).
 *
 * Escape (while on) exits the mode FIRST (cancel-first, keyboard.md v2)
 * without moving focus. The KEYS overlay dialog — a true modal — keeps its
 * own Escape handling while it is open.
 */

import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { getHelp, type HelpEntry } from "../help/registry";
import { helpOpen } from "../state/helpOverlay";
import { helpMode, setHelpMode } from "../state/helpMode";
import "../styles/info-view.css";

const DEFAULT_TITLE = "INFO MODE";
const DEFAULT_TEXT = "POINT AT OR FOCUS A CONTROL TO READ WHAT IT DOES";

export default function InfoView(): JSX.Element {
  const [entry, setEntry] = createSignal<HelpEntry | null>(null);

  onMount(() => {
    /** The registered entry covering an event target (null = unregistered). */
    const resolve = (target: EventTarget | null): HelpEntry | null => {
      if (!(target instanceof Element)) return null;
      const host = target.closest("[data-help]");
      if (!host) return null;
      return getHelp(host.getAttribute("data-help") ?? "") ?? null;
    };

    // The toggle button (or the `i` key's focus context) often HAS focus at
    // the instant the mode turns on — explain that control immediately
    // instead of showing only the generic prompt.
    setEntry(resolve(document.activeElement));

    // Observers attach ONLY while mounted (the zero-cost clause). focusin
    // drives the keyboard path (E6 law: focus, not just hover); pointerover
    // drives hover. Both KEEP the last entry when the pointer/focus moves to
    // unregistered ground — the text persists (Ableton behavior), and a
    // signal set of an identical entry is a no-op, so nothing re-announces
    // while focus rests (E6: "no repetition while focus rests").
    const onFocusIn = (e: FocusEvent): void => {
      const next = resolve(e.target);
      if (next) setEntry(next);
    };
    const onPointerOver = (e: PointerEvent): void => {
      const next = resolve(e.target);
      if (next) setEntry(next);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerover", onPointerOver);

    // Escape-exits-first: window CAPTURE so it runs before every other
    // Escape consumer (grid region-head pops, popover close handlers) and
    // swallows the keystroke once; focus stays exactly where it was.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || helpOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setHelpMode(false);
    };
    window.addEventListener("keydown", onKeyDown, true);

    onCleanup(() => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerover", onPointerOver);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  // The signal read keeps this subtree reactive even though the component is
  // only mounted while the mode is on (App's <Show>).
  void helpMode();

  return (
    <div
      class="info-view"
      role="status"
      aria-live="polite"
      aria-label="Control information"
      data-help-surface="info-view"
    >
      <span class="info-view-tag" aria-hidden="true">
        ?
      </span>
      <span class="info-view-title">{entry()?.title ?? DEFAULT_TITLE}</span>
      <span class="info-view-text">{entry()?.text ?? DEFAULT_TEXT}</span>
      <span class="info-view-hint" aria-hidden="true">
        ESC EXITS · I
      </span>
    </div>
  );
}
