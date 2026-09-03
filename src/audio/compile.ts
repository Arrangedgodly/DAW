/**
 * Lane event compiler (IM-3) — the seed of compileSong() (D2–D4).
 *
 * Pure function: Pattern + preset/kit + groove → a sorted list of absolute-
 * time VoiceNoteOnEvents (times are loop-relative seconds; the transport adds
 * its timeline offset). This is the ONLY way patterns become sound; the same
 * compiled list feeds online playback and offline renders (IM-5 parity).
 */

import {
  type GrooveOptions,
  secondsPerStep,
  timeAtStep,
} from "./time";
import {
  type DrumKit,
  type VoiceNoteOnEvent,
  type VoicePreset,
  noteParamsFor,
} from "./presets";
import {
  DRUM_PIECES,
  type LaneGate,
  type Pattern,
  type PitchedCell,
  type PitchedPattern,
} from "../document/schema";
import { type EffectiveScale, degreeToMidi } from "../document/scales";

export interface LaneCompileInput {
  readonly pattern: Pattern;
  /** Pitched lanes: the lane preset. Drum pattern: the kit. */
  readonly preset: VoicePreset | DrumKit;
  readonly gate: LaneGate;
  readonly groove: GrooveOptions;
  /** Required for pitched patterns: resolves degree → midi. */
  readonly scale?: EffectiveScale;
  /**
   * Chords semantics: each row cell triggers the diatonic triad
   * [degree, degree+2, degree+4] instead of a single note.
   */
  readonly stackChord?: boolean;
}

function gateSeconds(gate: LaneGate, groove: GrooveOptions): number {
  return gate.unit === "seconds"
    ? gate.value
    : gate.value * secondsPerStep(groove.bpm);
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
    const octaveBase = p.pitchRange?.octaveBase ?? 4;
    const stack = input.stackChord === true;
    const degrees = stack ? [0, 2, 4] : [0];
    for (const row of (pattern as PitchedPattern).rows) {
      const steps = row.steps;
      for (let step = 0; step < steps.length; step++) {
        const cell: PitchedCell = steps[step];
        if (cell !== 1) continue;
        // gate + one extra step per following sustain marker (cell 2)
        let sustain = 0;
        while (step + 1 + sustain < steps.length && steps[step + 1 + sustain] === 2) {
          sustain++;
        }
        const hold = gateSec + sustain * stepSec;
        for (const off of degrees) {
          const midi = degreeToMidi(scale, row.degree + off, octaveBase);
          events.push(
            noteParamsFor(p, {
              time: timeAtStep(step, groove),
              midi,
              holdSeconds: hold,
              seedSalt: step * 16 + row.degree + off,
            }),
          );
        }
      }
    }
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}
