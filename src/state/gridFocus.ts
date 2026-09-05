/**
 * Cross-quadrant grid focus coordination (DA-1 → LY-1 quadrant law): grids
 * are per-lane renderers with no knowledge of their siblings, so the
 * quadrant-selection keys (PageUp/PageDown, Ctrl+↑/↓, [ ]) publish a focus
 * REQUEST here and each LaneGrid surface consumes the requests addressed to
 * its lane. Pure UI state — Solid signals, never the document store (D1
 * two-tier law).
 *
 * LY-1: the lane-move family BECAME quadrant selection (the one deliberate
 * v0 journey change — docs/dev/keyboard.md §journey-change ledger). The
 * focus-movement law lives here: selecting a quadrant never moves focus by
 * itself EXCEPT when focus rests inside the grid that is becoming view-only
 * — then it is CARRIED into the newly selected grid at the same row index +
 * step, clamped (the v0 carryCellTo law, verbatim). When focus is on a
 * control strip / booth / rail / overlay, selection leaves focus exactly
 * where it is — the announcement carries the change instead.
 */

import { createSignal } from "solid-js";
import type { LaneId } from "../document/schema";
import { LANE_ORDER, laneMoveIndex } from "../grid/keynav";
import { activeLane, selectLane } from "./selection";

export interface GridFocusRequest {
  readonly lane: LaneId;
  readonly row: number;
  readonly step: number;
  /**
   * "cell" = carry to (row, step) clamped; "roving" = land on the target
   * grid's CURRENT roving cell (each grid remembers its editing place — the
   * strip `]`/`[` escape hatch).
   */
  readonly mode: "cell" | "roving";
  /** Monotonic sequence — consumers compare, never store. */
  readonly seq: number;
}

const [focusRequest, setFocusRequest] = createSignal<GridFocusRequest | null>(
  null,
);
let seq = 0;

export { focusRequest };

/**
 * Select the next/previous quadrant (visual reading order drums → bass →
 * chords → lead), carrying row + step into the target grid (clamped by the
 * receiving renderer). Clamps at the first/last quadrant — never wraps.
 * This is the grid-key path (PageUp/PageDown, Ctrl+↑/↓): focus IS inside a
 * grid, so the carry law applies by construction.
 */
export function requestLaneFocus(
  from: LaneId,
  dir: -1 | 1,
  row: number,
  step: number,
): void {
  const i = LANE_ORDER.indexOf(from as (typeof LANE_ORDER)[number]);
  if (i < 0) return;
  const next = laneMoveIndex(i, LANE_ORDER.length, dir);
  const lane = LANE_ORDER[next];
  if (lane === from) return; // already at the edge — stay, no wrap
  selectLane(lane);
  setFocusRequest({ lane, row, step, mode: "cell", seq: ++seq });
}

/**
 * Select a quadrant and land focus on its grid's CURRENT roving cell — the
 * `]`/`[` escape hatch from the strips ("focus is on a view-only lane's
 * VOLUME, now I want to edit its grid"). Never resets the grid's cursor.
 */
export function focusLaneRoving(lane: LaneId): void {
  if (lane === activeLane()) return;
  selectLane(lane);
  setFocusRequest({ lane, row: 0, step: 0, mode: "roving", seq: ++seq });
}

/** Adjacent quadrant id in reading order (clamped; null at the edges). */
export function adjacentQuadrant(from: LaneId, dir: -1 | 1): LaneId | null {
  const i = LANE_ORDER.indexOf(from as (typeof LANE_ORDER)[number]);
  if (i < 0) return null;
  const next = laneMoveIndex(i, LANE_ORDER.length, dir);
  return next === i ? null : LANE_ORDER[next];
}

/**
 * POINTER selection law (keyboard.md v2): a click on any part of a view-only
 * quadrant selects it. Focus moves ONLY when it currently rests inside the
 * grid that is becoming view-only (focus may never live in a view-only
 * grid) — otherwise the clicked control keeps focus (a mid-tweak is never
 * yanked); the stage announcement carries the change.
 */
export function selectQuadrantFromPointer(lane: LaneId): void {
  const from = activeLane();
  if (from === lane) return;
  if (typeof document !== "undefined") {
    const el = document.activeElement;
    if (
      el instanceof HTMLElement &&
      el.classList.contains("cell") &&
      el.closest(".lane-floor")?.getAttribute("data-lane") === from
    ) {
      selectLane(lane);
      setFocusRequest({
        lane,
        row: Number(el.dataset.row ?? 0),
        step: Number(el.dataset.step ?? 0),
        mode: "cell",
        seq: ++seq,
      });
      return;
    }
  }
  selectLane(lane);
}

/** Focus a cell within one lane (used by tests + future SR jump links). */
export function requestCellFocus(
  lane: LaneId,
  row: number,
  step: number,
): void {
  selectLane(lane);
  setFocusRequest({ lane, row, step, mode: "cell", seq: ++seq });
}

/* ---------------------------------------------------------------------------
 * LL-1 (iteration 3, keyboard.md v3 §"Pattern resize"): the RESIZE REMOUNT
 * carry. A resize rebuilds the grid at the new extent (the G9 remount key);
 * when focus was IN that grid, the new mount lands it on the CARRIED cell —
 * same row, step clamped to the new extent's last step (the v0 carry-clamp
 * law). Focus anywhere else never moves (the no-yank law): the dying
 * surface records the carry ONLY while it holds DOM focus.
 * ------------------------------------------------------------------------- */

/** The one-shot carry (lane + cursor); consumed by the next mount. */
let resizeCarry: { lane: LaneId; row: number; step: number } | null = null;

/**
 * Record the carry as a grid unmounts UNDER FOCUS (call from the surface's
 * cleanup — activeElement is still inside `container` there only when the
 * grid held focus; the remount then lands focus instead of dropping to
 * <body>).
 */
export function carryGridFocusOnUnmount(
  lane: LaneId,
  container: HTMLElement,
  cursor: { row: number; step: number } | null,
): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (!active || !container.contains(active) || !cursor) return;
  resizeCarry = { lane, row: cursor.row, step: cursor.step };
}

/** Consume the carry for `lane`'s fresh mount (null when none applies). */
export function takeCarriedGridFocus(
  lane: LaneId,
): { row: number; step: number } | null {
  if (!resizeCarry || resizeCarry.lane !== lane) return null;
  const carry = resizeCarry;
  resizeCarry = null;
  return carry;
}
