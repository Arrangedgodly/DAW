/** Shared lane display names (silkscreen labels, DES-3/DES-4). */

import type { LaneId } from "../document/schema";

export const LANE_NAMES: Record<LaneId, string> = {
  drums: "DRUMS",
  bass: "BASS",
  chords: "CHORDS",
  lead: "LEAD",
};

// --- Sound options (DES-3, pure — node-testable) -----------------------------

import { DRUM_KITS, PRESET_LIBRARY } from "../audio/presets";

export interface SoundOption {
  readonly id: string;
  readonly name: string;
}

/** The lane's available sounds: drum kits for drums, lane presets otherwise. */
export function soundOptionsFor(lane: LaneId): SoundOption[] {
  if (lane === "drums") {
    return Object.values(DRUM_KITS).map((k) => ({ id: k.id, name: k.name }));
  }
  const prefix = `preset-${lane}-`;
  return Object.values(PRESET_LIBRARY)
    .filter((p) => p.id.startsWith(prefix))
    .map((p) => ({ id: p.id, name: p.name }));
}
