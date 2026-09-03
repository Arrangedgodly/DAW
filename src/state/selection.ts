/**
 * Selection/focus state (IM-6/IM-7, D1 two-tier law): ephemeral UI state lives in
 * Solid signals and NEVER in the document store or undo history. Active lane,
 * the active pattern per lane, and the focused grid cell are pure view state —
 * they change at interaction speed, are not persisted, and are not part of the
 * project document (two users could focus different cells in the same doc).
 *
 * IM-7 model (documented): the CHAIN is document state (songChain); the ACTIVE
 * pattern for playback is ENGINE state (Session), fed from this selection via
 * engineBridge.requestPatternSwitch — which quantizes the switch to the lane's
 * next pattern boundary and exposes the pending state for the DES-6 rail.
 *
 * Signal accessors are named getSomething/setSomething (plus the bare signals
 * for JSX use) so call sites read clearly outside JSX.
 */

import { createSignal } from "solid-js";
import type { DrumPiece, LaneId, Pattern } from "../document/schema";
import { LANE_NAMES } from "../components/laneMeta";
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
  const first = (lane: LaneId) =>
    doc.songChain[lane][0] ?? doc.patterns[lane][0]!.id;
  return {
    drums: first("drums"),
    bass: first("bass"),
    chords: first("chords"),
    lead: first("lead"),
  };
}

const [activeLane, setActiveLane] = createSignal<LaneId>("drums");
const [activePatterns, setActivePatterns] = createSignal<
  Record<LaneId, string>
>(defaultActivePatterns());
const [focusedCell, setFocusedCell] = createSignal<FocusedCell | null>(null);

/**
 * DES-6 view mode — the collapse/expand raise. FOCUS = collapse-to-pattern
 * (rail slim, grids larger); CHAIN = expand-to-chain (rail prominent).
 * Toggling NEVER clears selection (the raise's law): activeLane,
 * activePatterns and focusedCell are independent signals, so the editing
 * place survives both directions.
 */
export type ViewMode = "focus" | "chain";
const [viewMode, setViewMode] = createSignal<ViewMode>("chain");

/** The lane selection follows the latest grid interaction. */
export { activeLane, focusedCell, activePatterns, viewMode, stageStatus };

export function toggleViewMode(): ViewMode {
  setViewMode((m) => (m === "chain" ? "focus" : "chain"));
  return viewMode();
}

/**
 * LY-1 (a11y gate E1): the ONE stage-level announcement text. Every actual
 * quadrant-selection change speaks `NOW EDITING <LANE>` through the stage
 * role=status region (StageFloor renders it); solo changes speak through the
 * same region (keyboard.md v2). HP-1: the help-mode toggle announcements
 * (`INFO MODE ON …` / `INFO MODE OFF`, state/helpMode.ts) also ride this
 * region — the info region itself is unmounted the instant the mode turns
 * off, so it cannot announce its own departure. Pure ephemeral text — never
 * a document.
 */
const [stageStatus, setStageStatus] = createSignal("");

/** Write the stage status region (selection/solo announcements). */
export function announceStage(text: string): void {
  setStageStatus(text);
}

export function selectLane(lane: LaneId): void {
  if (activeLane() === lane) return;
  setActiveLane(lane);
  setStageStatus(`NOW EDITING ${LANE_NAMES[lane]}`);
}

export function selectPattern(lane: LaneId, patternId: string): void {
  setActivePatterns((prev) => ({ ...prev, [lane]: patternId }));
}

export function getActivePattern(lane: LaneId): string {
  return activePatterns()[lane];
}

/**
 * The pattern a lane's grid is editing (IM-6/DES-6, PX-3 reuse): the
 * ephemeral selection if it still exists, else the chain's first slot, else
 * the lane's first pattern. Pure read over the current store snapshot.
 */
export function currentPatternFor(lane: LaneId): Pattern | undefined {
  const doc = docStore.getState().doc;
  const selected = activePatterns()[lane];
  if (selected) {
    const byId = doc.patterns[lane].find((p) => p.id === selected);
    if (byId) return byId;
  }
  const id = doc.songChain[lane][0];
  return doc.patterns[lane].find((p) => p.id === id) ?? doc.patterns[lane][0];
}

/** Focus a cell (keyboard navigation / pointer hover per DES-5). */
export function focusCell(cell: FocusedCell): void {
  setFocusedCell(cell);
}

export function clearFocus(): void {
  setFocusedCell(null);
}
