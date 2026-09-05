/**
 * Lane event compiler (IM-3) — the seed of compileSong() (D2–D4).
 *
 * Pure function: Pattern + preset/kit + groove → a sorted list of absolute-
 * time VoiceNoteOnEvents (times are loop-relative seconds; the transport adds
 * its timeline offset). This is the ONLY way patterns become sound; the same
 * compiled list feeds online playback and offline renders (IM-5 parity).
 *
 * SC-2 (iteration 2): pitched note durations come from the v2 note model —
 * each note sounds `length × secondsPerStep(bpm)` (musical time, 0.25-step
 * grid). The lane `gate` no longer scales pitched holds; it is only the
 * single-click default length (and the drums one-shot gate). The voice's
 * per-sample ADSR releases exactly at the hold boundary (worklet v.hold),
 * so the release lands at the note-length boundary with sample accuracy.
 */

import { type GrooveOptions, secondsPerStep, timeAtStep } from "./time";
import {
  type DrumKit,
  type VoiceNoteOnEvent,
  type VoicePreset,
  noteParamsFor,
} from "./presets";
import { DRUM_PIECES, type LaneGate, type Pattern } from "../document/schema";
import { type EffectiveScale, degreeToMidi } from "../document/scales";

export interface LaneCompileInput {
  readonly pattern: Pattern;
  /** Pitched lanes: the lane preset. Drum pattern: the kit. */
  readonly preset: VoicePreset | DrumKit;
  /**
   * Drums: the one-shot gate. Pitched: the single-click default note length
   * only — durations come from `note.length` (SC-2 law), never from the gate.
   */
  readonly gate: LaneGate;
  readonly groove: GrooveOptions;
  /** Required for pitched patterns: resolves degree → midi. */
  readonly scale?: EffectiveScale;
  /**
   * Chords semantics: each row cell triggers the diatonic triad
   * [degree, degree+2, degree+4] instead of a single note.
   */
  readonly stackChord?: boolean;
  /**
   * RC-1 (v3, i3-2): the lane's register transpose in octaves (schema
   * PitchedLane.octave, −3..+3, 0 = absent). Applied as an OFFSET on the
   * preset's pitchRange.octaveBase — one law, shared verbatim by the live
   * session, the offline render and the MIDI exporter (export-reflected by
   * construction; parse-back asserted in tests/exportMidi). The final MIDI
   * number is clamped to 0..127 (the schema's consumer-side pitch law).
   */
  readonly octaveOffset?: number;
}

function gateSeconds(gate: LaneGate, groove: GrooveOptions): number {
  return gate.unit === "seconds"
    ? gate.value
    : gate.value * secondsPerStep(groove.bpm);
}

/** The absolute MIDI 0..127 clamp (schema's consumer-side pitch law, RC-1). */
function clampMidi(midi: number): number {
  return Math.min(127, Math.max(0, midi));
}

export function compileLaneEvents(input: LaneCompileInput): VoiceNoteOnEvent[] {
  const { pattern, preset, gate, groove } = input;
  const gateSec = gateSeconds(gate, groove);
  const stepSec = secondsPerStep(groove.bpm);
  const events: VoiceNoteOnEvent[] = [];

  if (pattern.kind === "drums") {
    const kit = preset as DrumKit;
    let pieceOrdinal = 0;
    // HW-4 finding: iterate the FIXED piece order, never Object.keys —
    // pieceOrdinal feeds the seeded-noise salt, and the canonical codec
    // key-sorts objects, so a reloaded document would otherwise compile
    // with different noise seeds than the live one (audibly different
    // export before vs after reload).
    for (const pieceName of DRUM_PIECES) {
      const piecePreset = kit.pieces[pieceName];
      if (!piecePreset) continue;
      const steps = pattern.steps[pieceName];
      pieceOrdinal++;
      for (let step = 0; step < steps.length; step++) {
        if (!steps[step]) continue;
        events.push(
          noteParamsFor(piecePreset, {
            time: timeAtStep(step, groove),
            holdSeconds: gateSec,
            seedSalt: step * 8 + pieceOrdinal,
          }),
        );
      }
    }
  } else {
    const p = preset as VoicePreset;
    const scale = input.scale;
    if (!scale) {
      throw new Error("compileLaneEvents: pitched pattern requires a scale");
    }
    // RC-1: the lane octave is an offset on the preset's base (0 = absent —
    // byte-identical compilation for every pre-v3 document; the clamp is
    // inert at offset 0, so render/export fingerprints cannot drift).
    const octaveBase =
      (p.pitchRange?.octaveBase ?? 4) + (input.octaveOffset ?? 0);
    const stack = input.stackChord === true;
    const degrees = stack ? [0, 2, 4] : [0];
    // SC-2: v2 notes are consumed NATIVELY — hold = note.length × step
    // seconds (musical time). The lane gate is ONLY the single-click default
    // length; changing it no longer changes how long existing notes sound.
    // The v0 sustain-marker walk is retired: a note's length IS its duration,
    // even when it runs past the pattern end (the v0 gate-overhang law).
    // Notes on degrees outside the pattern's row manifest stay unplayed
    // (v1: no row existed to carry them).
    const manifest = new Set(pattern.rowDegrees);
    for (const note of pattern.notes) {
      if (!manifest.has(note.degree)) continue;
      const hold = note.length * stepSec;
      for (const off of degrees) {
        const midi = clampMidi(degreeToMidi(scale, note.degree + off, octaveBase));
        events.push(
          noteParamsFor(p, {
            time: timeAtStep(note.start, groove),
            midi,
            holdSeconds: hold,
            // Same salt law as v0 (start/degree identifiers), so noise-carrying
            // presets keep their per-note seeds bit-identically.
            seedSalt: note.start * 16 + note.degree + off,
          }),
        );
      }
    }
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}
