import { createSignal, onCleanup } from "solid-js";
import { docStore } from "./store";
import { laneDisplayName } from "../components/laneMeta";
import type { LaneId } from "../document/schema";

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
