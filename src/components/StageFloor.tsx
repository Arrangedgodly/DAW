/**
 * StageFloor (DES-4, DES-6): the four lane floors stacked below the booth,
 * plus the one-time store→engine bridge connection. Lane hue comes from the
 * lane-* data attribute (tokens.css palette); DES-3 adds the header strips
 * above these.
 *
 * DES-6: the stage carries the view-mode attribute (selection.ts viewMode —
 * FOCUS enlarges the grids, CHAIN shows them at editing size). The pattern
 * rail lives directly under the booth (App shell), this stays the floors.
 */

import { createSignal, onCleanup, onMount } from "solid-js";
import type { LaneId } from "../document/schema";
import { connectStoreToEngine } from "../state/engineBridge";
import { EMPTY_HINT_LABEL, isProjectEmpty } from "../state/emptyProject";
import { viewMode } from "../state/selection";
import { docStore } from "../state/store";
import LaneGrid from "./LaneGrid";

const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

export default function StageFloor() {
  // HU-2 empty-project hint: pure predicate over the document — true while
  // every lane is silent and untouched, gone on the first edit by
  // construction (no hidden flags). A subtle in-world note, never a modal.
  const [empty, setEmpty] = createSignal(isProjectEmpty(docStore.getState().doc));
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
    <div class="stage-floors" data-view={viewMode()} aria-label="Lane floors">
      {LANES.map((lane) => (
        <LaneGrid lane={lane} />
      ))}
      {empty() && (
        <div class="stage-hint" role="note" aria-label="Empty project hint">
          {EMPTY_HINT_LABEL}
        </div>
      )}
    </div>
  );
}
