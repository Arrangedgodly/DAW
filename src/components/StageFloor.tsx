/**
 * StageFloor (DES-4, DES-6, LY-1): the four lane QUADRANTS in the committed
 * 2×2 arrangement (town-hall I2-1 — user synthesis, not re-derived here):
 * drums top-left, bass top-right, chords bottom-left, lead bottom-right
 * (visual reading order = the lane-move order). One quadrant is editable
 * (selection.activeLane IS the quadrant selection); the other three render
 * view-only with live notes + playhead. Plus the one-time store→engine
 * bridge connection.
 *
 * The stage carries ONE role=status region (a11y §7 E1): every actual
 * quadrant-selection change announces `NOW EDITING <LANE>` from ANY input
 * path, and solo changes announce `SOLO <LANE>` / `SOLO OFF` — the same
 * region (keyboard.md v2).
 *
 * DES-6: the stage carries the view-mode attribute (selection.ts viewMode —
 * FOCUS enlarges the short grids, CHAIN shows them at editing size). The
 * pattern rail lives directly under the booth (App shell), this stays the
 * quadrants.
 */

import { createSignal, onCleanup, onMount } from "solid-js";
import type { LaneId } from "../document/schema";
import { connectStoreToEngine } from "../state/engineBridge";
import { EMPTY_HINT_LABEL, isProjectEmpty } from "../state/emptyProject";
import { stageStatus, viewMode } from "../state/selection";
import { docStore } from "../state/store";
import LaneGrid from "./LaneGrid";

const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

export default function StageFloor() {
  // HU-2 empty-project hint: pure predicate over the document — true while
  // every lane is silent and untouched, gone on the first edit by
  // construction (no hidden flags). A subtle in-world note, never a modal.
  const [empty, setEmpty] = createSignal(
    isProjectEmpty(docStore.getState().doc),
  );
  onMount(() => {
    const unsubscribeDoc = docStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return;
      setEmpty(isProjectEmpty(state.doc));
    });
    onCleanup(unsubscribeDoc);
  });
  onMount(() => {
    const disconnect = connectStoreToEngine();
    onCleanup(disconnect);
  });

  return (
    <div
      class="stage-floors"
      data-view={viewMode()}
      aria-label="Lane quadrants"
    >
      {LANES.map((lane) => (
        <LaneGrid lane={lane} />
      ))}
      {empty() && (
        <div class="stage-hint" role="note" aria-label="Empty project hint">
          {EMPTY_HINT_LABEL}
        </div>
      )}
      {/* LY-1 E1: the stage-level edit-target announcement region. */}
      <div
        class="head-sr stage-status"
        role="status"
        aria-live="polite"
        aria-label="Edit target announcements"
      >
        {stageStatus()}
      </div>
    </div>
  );
}
