/**
 * Selection/focus state (IM-6, D1 two-tier law): ephemeral UI state lives in
 * Solid signals and NEVER in the document store or undo history. Active lane,
 * the active pattern per lane, and the focused grid cell are pure view state —
 * they change at interaction speed, are not persisted, and are not part of the
 * project document (two users could focus different cells in the same doc).
 *
 * Signal accessors are named getSomething/setSomething (plus the bare signals
 * for JSX use) so call sites read clearly outside JSX.
 */

import { createSignal } from "solid-js";
import type { DrumPiece, LaneId } from "../document/schema";
import { docStore } from "./store";

/** A focused grid cell: lane + row identity + step column. */
export interface FocusedCell {
  readonly lane: LaneId;
  /** Drum piece for the drums lane; scale degree for pitched lanes. */
  readonly row: DrumPiece | number;
  readonly step: number;
}

function defaultActivePatterns(): Record<LaneId, string> {
  const doc = docStore.getState().doc;
  const first = (lane: LaneId) => doc.songChain[lane][0] ?? doc.patterns[lane][0]!.id;
  return { drums: first("drums"), bass: first("bass"), chords: first("chords"), lead: first("lead") };
}

const [activeLane, setActiveLane] = createSignal<LaneId>("drums");
const [activePatterns, setActivePatterns] = createSignal<Record<LaneId, string>>(
  defaultActivePatterns(),
);
const [focusedCell, setFocusedCell] = createSignal<FocusedCell | null>(null);

/** The lane selection follows the latest grid interaction. */
export { activeLane, focusedCell, activePatterns };

export function selectLane(lane: LaneId): void {
  setActiveLane(lane);
}

export function selectPattern(lane: LaneId, patternId: string): void {
  setActivePatterns((prev) => ({ ...prev, [lane]: patternId }));
}

export function getActivePattern(lane: LaneId): string {
  return activePatterns()[lane];
}

/** Focus a cell (keyboard navigation / pointer hover per DES-5). */
export function focusCell(cell: FocusedCell): void {
  setFocusedCell(cell);
}

export function clearFocus(): void {
  setFocusedCell(null);
}
