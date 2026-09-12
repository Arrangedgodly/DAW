import type { LaneId } from "../../src/document/schema";
import { pitchDomain } from "../../src/document/pitchWindow";
import { docStore } from "../../src/state/store";
import {
  getOrCreateRegisterWindow,
  setRegisterWindowStart,
} from "../../src/state/selection";

/** Locate a fixture's musical degree in the full MIDI editor, seating it
 * when necessary. Drum fixtures continue to use their six piece indices. */
export function rowForDegree(lane: string, degree: number): number {
  if (lane === "drums") return degree;
  const pitchedLane = lane as Exclude<LaneId, "drums">;
  const domain = pitchDomain(docStore.getState().doc, pitchedLane);
  const row = domain.degrees.indexOf(degree);
  if (row < 0)
    throw new Error(`${lane} degree ${degree} is outside MIDI range`);
  const start = getOrCreateRegisterWindow(pitchedLane, domain.windowRows);
  if (row < start || row >= start + domain.windowRows) {
    setRegisterWindowStart(
      pitchedLane,
      Math.max(0, row - domain.windowRows + 1),
    );
  }
  return row;
}
