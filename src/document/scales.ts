/**
 * Scale system: mode definitions, effective-scale resolution, diatonic chord-row
 * derivation, and scale-degree → MIDI note math. Pure functions, no DOM/audio.
 *
 * Pitch classes are integers 0–11 (C = 0, C#/Db = 1, …). Intervals are semitone
 * offsets from the root, always starting at 0.
 */

import type { LaneId, ProjectDocument, ScaleConfig } from "./schema";

export const MODE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonicMinor: [0, 3, 5, 7, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
} as const satisfies Record<string, readonly number[]>;

export type ModeName = keyof typeof MODE_INTERVALS;
export const MODE_NAMES = Object.keys(MODE_INTERVALS) as ModeName[];

export function isModeName(value: string): value is ModeName {
  return value in MODE_INTERVALS;
}

/** Number of distinct notes in the mode (7 for heptatonic, 5 for pentatonic). */
export function modeSize(mode: ModeName): number {
  return MODE_INTERVALS[mode].length;
}

/** A concrete scale: root pitch class plus resolved interval set. */
export interface EffectiveScale {
  readonly root: number;
  readonly mode: ModeName;
  readonly intervals: readonly number[];
}

/** Resolve the effective scale for a lane: lane override wins, else project default. */
export function effectiveScale(
  project: ProjectDocument,
  laneId: LaneId,
): EffectiveScale {
  const override = project.laneOverrides?.[laneId];
  return toEffectiveScale(override ?? project.scale);
}

export function toEffectiveScale(config: ScaleConfig): EffectiveScale {
  return {
    root: config.root,
    mode: config.mode,
    intervals: MODE_INTERVALS[config.mode],
  };
}

/**
 * Scale-degree index → MIDI note number.
 * `degree` may be negative or exceed the mode size: each full wrap
 * of the mode moves one octave.
 * `octaveBase` is the octave of degree 0 in scientific pitch notation
 * (e.g. octaveBase 4 → degree 0 of C major is C4 = MIDI 60).
 */
export function degreeToMidi(
  scale: EffectiveScale,
  degree: number,
  octaveBase: number,
): number {
  const size = scale.intervals.length;
  const octave = Math.floor(degree / size);
  const index = ((degree % size) + size) % size;
  return (
    12 * (octaveBase + 1) + scale.root + scale.intervals[index] + 12 * octave
  );
}

/**
 * Diatonic chord rows for the chords lane: chord shapes as scale-degree stacks.
 * Row i is the triad built on scale degree i: degrees [i, i+2, i+4], each taken
 * diatonically in the mode (wrapping adds an octave via degreeToMidi).
 */
export interface ChordRow {
  /** Scale degree the triad is built on (0-based, the row's "root degree"). */
  readonly degree: number;
  /** Stack of scale degrees sounding together: [degree, degree+2, degree+4]. */
  readonly degrees: readonly [number, number, number];
  /** MIDI notes for the stack at `octaveBase` (convenience for engine/audition). */
  readonly midi: readonly [number, number, number];
}

export function chordRows(
  scale: EffectiveScale,
  octaveBase: number,
): ChordRow[] {
  const rows: ChordRow[] = [];
  for (let i = 0; i < scale.intervals.length; i++) {
    const degrees = [i, i + 2, i + 4] as const;
    rows.push({
      degree: i,
      degrees,
      midi: degrees.map((d) => degreeToMidi(scale, d, octaveBase)) as [
        number,
        number,
        number,
      ],
    });
  }
  return rows;
}
