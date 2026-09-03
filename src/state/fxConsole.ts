/**
 * FX console open-state (refinement-1 — critique P1-1): WHICH lane's FX
 * console overlay is open, as a page-level signal instead of LaneHeader-
 * local state.
 *
 * Why page-level: the console is a non-modal overlay the user can leave
 * open while working anywhere else, so its CLOSE paths need cross-component
 * knowledge — exactly the KeyboardShortcuts grain. Refinement-1 adds the
 * pointer/keyboard exits the critique found missing (the console used to be
 * closable only by clicking another quadrant):
 *   - the console's own CLOSE button (title strip, outside the occluded
 *     zone — never covered by the chassis itself), and the strip's FX
 *     toggle (un-occluded now that the chassis starts below the strip);
 *   - page-level ESCAPE (keyboard.md v2 Escape order: the KEYS modal and
 *     help mode win first, then inline edits/popovers/menus cancel, then
 *     the console closes, then region-head pops apply).
 *
 * Invariants kept: at most ONE console open (only the selected quadrant
 * renders the FX entry); LaneHeader's focus law still closes it the
 * instant its quadrant goes view-only; ephemeral UI state — never document.
 */

import { createSignal } from "solid-js";
import type { LaneId } from "../document/schema";

const [fxConsoleLane, setFxConsoleLane] = createSignal<LaneId | null>(null);

/** Close whichever console is open (no-op when none is). */
function closeFxConsole(): void {
  setFxConsoleLane(null);
}

export { closeFxConsole, fxConsoleLane, setFxConsoleLane };
