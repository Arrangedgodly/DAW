/**
 * StageFloor (DES-4): the four lane floors stacked below the booth, plus the
 * one-time store→engine bridge connection. Lane hue comes from the lane-* data
 * attribute (tokens.css palette); DES-3 adds the header strips above these.
 */

import { onCleanup, onMount } from "solid-js";
import type { LaneId } from "../document/schema";
import { connectStoreToEngine } from "../state/engineBridge";
import LaneGrid from "./LaneGrid";

const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

export default function StageFloor() {
  onMount(() => {
    const disconnect = connectStoreToEngine();
    onCleanup(disconnect);
  });

  return (
    <div class="stage-floors" aria-label="Lane floors">
      {LANES.map((lane) => (
        <LaneGrid lane={lane} />
      ))}
    </div>
  );
}
