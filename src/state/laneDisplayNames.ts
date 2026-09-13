import { createSignal, onCleanup } from "solid-js";
import { docStore } from "./store";
import { laneDisplayName } from "../components/laneMeta";
import { ALL_LANE_IDS, type LaneId } from "../document/schema";

/** Labels follow preset changes without changing a track's stable identity. */
export function createLaneDisplayNames() {
  const [lanes, setLanes] = createSignal(docStore.getState().doc.lanes);
  onCleanup(docStore.subscribe((state) => setLanes(state.doc.lanes)));
  return (id: LaneId) => {
    const lane = lanes().find((lane) => lane.id === id);
    return laneDisplayName(
      id,
      lane && lane.id !== "drums" ? lane.presetId : undefined,
    );
  };
}

/** Category first; stable track number distinguishes matching presets. */
export function createLaneAccessibleNames() {
  const displayName = createLaneDisplayNames();
  return (id: LaneId) =>
    `${displayName(id)}, track ${ALL_LANE_IDS.indexOf(id) + 1}`;
}
