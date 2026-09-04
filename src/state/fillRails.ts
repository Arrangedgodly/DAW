/**
 * MB-2 (mobile slice): the fill-rails REVEAL — ephemeral view state (the
 * selection.ts two-tier law: Solid signals, never document state, never
 * undo history). On NARROW stages (phone + tablet) the drums fill rail is
 * the MB-1 focus-revealed OVERLAY over the rows' cells; hover does not
 * exist on touch, so this toggle is the touch/mouse reveal path (the strip
 * FILL button, LaneHeader — drums lane, narrow stages only). Keyboard
 * reachability stays by construction: the steppers were ALWAYS tab stops;
 * focusing one reveals its row through the same :focus-within law.
 *
 * ONE global toggle (not per-row): the phone stage renders exactly one
 * lane, and the drums lane is the only lane with fill rails — a single
 * aria-pressed control with one law ("E rails shown over the rows") reads
 * cleaner than six per-row chips competing with the cells' hit area.
 */

import { createSignal } from "solid-js";

const [fillRailsOpen, setFillRailsOpen] = createSignal(false);

export { fillRailsOpen };

/** The FILL strip toggle's one action. Returns the new state. */
export function toggleFillRails(): boolean {
  setFillRailsOpen((open) => !open);
  return fillRailsOpen();
}

/**
 * Close the reveal (Escape from the grid — the innermost-surface-first
 * Escape order: fill rails sit in the rows, under the FX console).
 */
export function closeFillRails(): void {
  setFillRailsOpen(false);
}
