import { getPreset } from "../audio/presets";
import type { ProjectDocument } from "./schema";
import { degreeToMidi, effectiveScale, modeSize } from "./scales";

export type PitchedLane = "bass" | "chords" | "lead";
export const MIN_EDIT_DEGREE = -128;
export const MAX_EDIT_DEGREE = 128;

/** Editing rows are a view of MIDI pitch space, independent of saved row lists. */
export function pitchDomain(doc: ProjectDocument, lane: PitchedLane) {
  const config = doc.lanes.find((item) => item.id === lane);
  const preset =
    config && "presetId" in config ? getPreset(config.presetId) : undefined;
  const octaveBase =
    (preset?.pitchRange?.octaveBase ?? 4) +
    (config && "octave" in config ? (config.octave ?? 0) : 0);
  const scale = effectiveScale(doc, lane);
  const degrees: number[] = [];
  const pitches: number[] = [];
  for (let degree = MIN_EDIT_DEGREE; degree <= MAX_EDIT_DEGREE; degree++) {
    const midi = degreeToMidi(scale, degree, octaveBase);
    if (midi >= 0 && midi <= 127) {
      degrees.push(degree);
      pitches.push(midi);
    }
  }
  degrees.reverse();
  pitches.reverse();
  const windowRows = modeSize(scale.mode);
  const maxStart = Math.max(0, degrees.length - windowRows);
  return {
    degrees,
    pitches,
    windowRows,
    maxStart,
    maxOrigin: pitches[windowRows - 1] ?? 0,
  };
}

export function pitchWindowStart(
  pitches: readonly number[],
  origin: number,
  windowRows: number,
) {
  const index = pitches.findIndex((pitch) => pitch <= origin + 11);
  return Math.min(
    Math.max(0, pitches.length - windowRows),
    Math.max(0, index < 0 ? pitches.length - 1 : index),
  );
}

export function midiLabel(midi: number): string {
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
