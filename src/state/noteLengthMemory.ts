/**
 * Note-length memory (user call, 2026-09-11): when a note is DRAG-CREATED
 * at a custom length, that length becomes the lane's next single-press
 * placement length (pointer click or keyboard Enter), so a run of notes can
 * be laid down at one size without dragging each. Per lane, session-only
 * (never persisted).
 *
 * The lane's gate stays the explicit default: editing the gate after a drag
 * clears that lane's memory (the remembered length is tagged with the gate
 * it was made under), and a whole-document replacement (load / new project)
 * clears every lane.
 */

import type { LaneGate, LaneId } from "../document/schema";
import { docStore, onDocumentReplaced } from "./store";

interface Remembered {
  readonly length: number;
  readonly gate: LaneGate;
}

const remembered = new Map<LaneId, Remembered>();

onDocumentReplaced(() => remembered.clear());

function laneGate(lane: LaneId): LaneGate | undefined {
  return docStore.getState().doc.lanes.find((l) => l.id === lane)?.gate;
}

const sameGate = (a: LaneGate, b: LaneGate): boolean =>
  a.unit === b.unit && a.value === b.value;

/** Record a drag-created note's length as the lane's next placement length. */
export function rememberNoteLength(lane: LaneId, length: number): void {
  const gate = laneGate(lane);
  if (gate) remembered.set(lane, { length, gate });
}

/**
 * The length a single press places on `lane`: the remembered drag length
 * while the lane's gate is unchanged since the drag, else `gateSteps`.
 */
export function placementLength(lane: LaneId, gateSteps: number): number {
  const r = remembered.get(lane);
  if (!r) return gateSteps;
  const gate = laneGate(lane);
  if (!gate || !sameGate(gate, r.gate)) {
    remembered.delete(lane);
    return gateSteps;
  }
  return r.length;
}
