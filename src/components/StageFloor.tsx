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

import { onCleanup, onMount } from "solid-js";
import type { LaneId } from "../document/schema";
import { connectStoreToEngine } from "../state/engineBridge";
import { viewMode } from "../state/selection";
import LaneGrid from "./LaneGrid";

const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

export default function StageFloor() {
  onMount(() => {
    const disconnect = connectStoreToEngine();
    onCleanup(disconnect);
  });

  return (
    <div class="stage-floors" data-view={viewMode()} aria-label="Lane floors">
      {LANES.map((lane) => (
        <LaneGrid lane={lane} />
      ))}
    </div>
  );
}
