/**
 * Cross-lane grid focus coordination (DA-1): grids are per-lane renderers
 * with no knowledge of their siblings, so lane-move keys (PageUp/PageDown,
 * Ctrl+↑/↓, [ ]) publish a focus REQUEST here and each LaneGrid surface
 * consumes the requests addressed to its lane. Pure UI state — Solid
 * signals, never the document store (D1 two-tier law).
 */

import { createSignal } from "solid-js";
import type { LaneId } from "../document/schema";
import { LANE_ORDER } from "../grid/keynav";
import { selectLane } from "./selection";

export interface GridFocusRequest {
  readonly lane: LaneId;
  readonly row: number;
  readonly step: number;
  /** Monotonic sequence — consumers compare, never store. */
  readonly seq: number;
}

const [focusRequest, setFocusRequest] = createSignal<GridFocusRequest | null>(null);
let seq = 0;

export { focusRequest };

/**
 * Move focus from one lane's grid toward `dir` (-1 up / +1 down), carrying
 * row index + step (clamped by the receiving grid). Clamps at the first/
 * last lane — never wraps (spec). Also makes the target lane active.
 */
export function requestLaneFocus(from: LaneId, dir: -1 | 1, row: number, step: number): void {
  const i = LANE_ORDER.indexOf(from as (typeof LANE_ORDER)[number]);
  if (i < 0) return;
  const next = Math.min(Math.max(i + dir, 0), LANE_ORDER.length - 1);
  const lane = LANE_ORDER[next];
  if (lane === from) return; // already at the edge — stay, no wrap
  selectLane(lane);
  setFocusRequest({ lane, row, step, seq: ++seq });
}

/** Focus a cell within one lane (used by tests + future SR jump links). */
export function requestCellFocus(lane: LaneId, row: number, step: number): void {
  selectLane(lane);
  setFocusRequest({ lane, row, step, seq: ++seq });
}
