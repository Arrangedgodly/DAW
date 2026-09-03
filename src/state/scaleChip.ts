/**
 * Scale-chip logic (DES-3, pure — the R6 risk discharger).
 *
 * The lane header's effective-scale chip must answer one question without
 * ambiguity: WHICH scale is this lane actually playing, and WHERE does it come
 * from (project default vs lane override)? Everything the chip renders and
 * everything the popover commits funnels through these pure functions so the
 * label semantics and the one-action detach/return contract are testable
 * without a DOM.
 *
 * Label law: "PROJECT · C MIN" when the lane follows the project scale,
 * "LANE · D DOR" when an override is active. The popover's actions are
 * explicit: "USE PROJECT SCALE" (detach / return — exactly one action) and
 * "OVERRIDE LANE" (apply the picked root+mode as this lane's override).
 */

import {
  type LaneId,
  type ProjectDocument,
  PITCH_CLASS_NAMES,
  type ScaleConfig,
} from "../document/schema";
import { type ModeName, MODE_NAMES } from "../document/scales";

/** Silkscreen-short mode names (uppercase, ≤5 chars where possible). */
export const MODE_SHORT: Readonly<Record<ModeName, string>> = {
  major: "MAJ",
  minor: "MIN",
  dorian: "DOR",
  phrygian: "PHR",
  lydian: "LYD",
  mixolydian: "MIX",
  harmonicMinor: "H.MIN",
  pentatonicMinor: "P.MIN",
  pentatonicMajor: "P.MAJ",
};

/** Long mode names for the popover list + announcements (lowercase, spoken). */
export const MODE_LONG: Readonly<Record<ModeName, string>> = {
  major: "major",
  minor: "minor",
  dorian: "dorian",
  phrygian: "phrygian",
  lydian: "lydian",
  mixolydian: "mixolydian",
  harmonicMinor: "harmonic minor",
  pentatonicMinor: "minor pentatonic",
  pentatonicMajor: "major pentatonic",
};

/** Ordered mode list for the popover (scales.ts order). */
export const MODE_LIST: readonly ModeName[] = MODE_NAMES;

export function rootName(root: number): string {
  return (
    PITCH_CLASS_NAMES[
      root as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
    ] ?? "?"
  );
}

/** "C MIN" — the scale half of the chip label. */
export function formatScale(root: number, mode: ModeName): string {
  return `${rootName(root)} ${MODE_SHORT[mode]}`;
}

export interface ScaleChipLabel {
  /** Where the effective scale comes from — the affordance the chip states. */
  readonly source: "PROJECT" | "LANE";
  readonly root: number;
  readonly mode: ModeName;
  /** Full chip text, e.g. "PROJECT · C MIN" or "LANE · D DOR". */
  readonly text: string;
  /** True when a lane override is active (lane chips only; project chips: false). */
  readonly overridden: boolean;
}

/** Resolve one lane's chip label from the document (override wins). */
export function laneScaleChipLabel(
  doc: ProjectDocument,
  lane: LaneId,
): ScaleChipLabel {
  const override = doc.laneOverrides?.[lane];
  if (override) {
    return {
      source: "LANE",
      root: override.root,
      mode: override.mode,
      text: `LANE · ${formatScale(override.root, override.mode)}`,
      overridden: true,
    };
  }
  const { scale } = doc;
  return {
    source: "PROJECT",
    root: scale.root,
    mode: scale.mode,
    text: `PROJECT · ${formatScale(scale.root, scale.mode)}`,
    overridden: false,
  };
}

/** The booth's project-scale chip label (never has an override source). */
export function projectScaleChipLabel(doc: ProjectDocument): ScaleChipLabel {
  const { scale } = doc;
  return {
    source: "PROJECT",
    root: scale.root,
    mode: scale.mode,
    text: formatScale(scale.root, scale.mode),
    overridden: false,
  };
}

/**
 * The store seam the popover commits through. The real app passes the store's
 * own actions; tests pass fakes. Purely structural — no logic lives here.
 */
export interface ScaleStoreSeam {
  setProjectScale(scale: ScaleConfig): void;
  setLaneScaleOverride(lane: LaneId, scale: ScaleConfig | null): void;
}

/** Popover "OVERRIDE LANE": one action applies root+mode as the lane's scale. */
export function applyLaneOverride(
  seam: ScaleStoreSeam,
  lane: LaneId,
  root: number,
  mode: ModeName,
): ScaleConfig {
  const scale: ScaleConfig = { root: root as ScaleConfig["root"], mode };
  seam.setLaneScaleOverride(lane, scale);
  return scale;
}

/**
 * Popover "USE PROJECT SCALE": one action detaches the override / keeps the
 * lane following the project default. Idempotent — clearing an absent
 * override is a no-op commit-wise.
 */
export function returnToProjectScale(seam: ScaleStoreSeam, lane: LaneId): void {
  seam.setLaneScaleOverride(lane, null);
}

/** Popover "SET PROJECT SCALE" (booth chip only — no override options there). */
export function applyProjectScale(
  seam: ScaleStoreSeam,
  root: number,
  mode: ModeName,
): ScaleConfig {
  const scale: ScaleConfig = { root: root as ScaleConfig["root"], mode };
  seam.setProjectScale(scale);
  return scale;
}

/** aria-live confirmation text after an effective-scale change. */
export function announceScale(label: ScaleChipLabel, laneName: string): string {
  const origin = label.source === "LANE" ? "lane override" : "project scale";
  return `${laneName} scale: ${rootName(label.root)} ${MODE_LONG[label.mode]} — ${origin}`;
}
