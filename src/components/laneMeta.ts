/** Shared lane display names (silkscreen labels, DES-3/DES-4). */

import type { LaneId } from "../document/schema";

export const LANE_NAMES: Record<LaneId, string> = {
  drums: "DRUMS",
  bass: "BASS",
  chords: "CHORDS",
  lead: "LEAD",
  extra1: "INSTRUMENT 5",
  extra2: "INSTRUMENT 6",
  extra3: "INSTRUMENT 7",
  extra4: "INSTRUMENT 8",
};

// --- Sound options (DES-3, pure — node-testable) -----------------------------

import { DRUM_KITS, PRESET_LIBRARY } from "../audio/presets";

export interface SoundOption {
  readonly id: string;
  readonly name: string;
  readonly family: string;
}

export function soundFamily(id: string): string {
  const family = id.split("-")[1];
  return (
    (
      {
        bass: "Bass",
        chords: "Pads & chords",
        lead: "Leads",
        bells: "Bells",
        brass: "Brass",
        fx: "Sound effects",
        keys: "Keys",
        strings: "Plucked strings",
        pads: "Pads & chords",
      } as Record<string, string>
    )[family] ?? "Other"
  );
}

/** The lane's available sounds: drum kits for drums, lane presets otherwise. */
export function soundOptionsFor(lane: LaneId): SoundOption[] {
  if (lane === "drums") {
    return Object.values(DRUM_KITS).map((k) => ({
      id: k.id,
      name: k.name,
      family: "Drum kits",
    }));
  }
  return Object.values(PRESET_LIBRARY)
    .filter((p) => p.pitchRange !== undefined)
    .map((p) => ({ id: p.id, name: p.name, family: soundFamily(p.id) }))
    .sort(
      (a, b) =>
        a.family.localeCompare(b.family) || a.name.localeCompare(b.name),
    );
}

/** Keep the default identities; optional tracks take their preset's category. */
export function laneDisplayName(lane: LaneId, presetId?: string): string {
  if (!lane.startsWith("extra")) return lane[0]!.toUpperCase() + lane.slice(1);
  const family = presetId ? soundFamily(presetId) : "Instrument";
  if (family === "Plucked strings") return "Plucks";
  if (family === "Sound effects") return "FX";
  return family;
}
