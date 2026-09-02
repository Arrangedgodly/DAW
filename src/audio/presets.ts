/**
 * Preset layer (IM-3, D2/D3): a preset is pure JSON data that drives the
 * worklet voice params — wave, duty, ADSR envelope, noise mode/rate, pitch
 * range, level, sweep. The engine never hard-codes a sound; everything it
 * renders comes from one of these records (or a user preset of the same
 * shape, PX-2).
 *
 * preset → per-note flat params happens in noteParamsFor() below; the result
 * is what travels over the worklet MessagePort (see VoiceNoteOnEvent in
 * compile.ts).
 */

import { MAX_VOICE_FREQ, midiToFreq, noteSeed } from "./dsp";
import type { DrumPiece } from "../document/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WaveKind = "pulse" | "triangle" | "noise";
export type NoiseMode = "long" | "short";

export interface Envelope {
  /** Linear attack, seconds. */
  readonly attack: number;
  /** Linear decay 1 → sustain, seconds. */
  readonly decay: number;
  /** Sustain level 0..1. */
  readonly sustain: number;
  /** Linear release sustain → 0, seconds. */
  readonly release: number;
}

/** Where a pitched lane's degrees live (D2/D3 pitch range). */
export interface PitchRange {
  /** Scientific octave of scale degree 0 (e.g. 2 → degree 0 of C = C2). */
  readonly octaveBase: number;
}

export interface VoicePreset {
  readonly id: string;
  readonly name: string;
  readonly wave: WaveKind;
  /** Pulse duty cycle 0..1 (chiptune staples: 0.125, 0.25, 0.5). */
  readonly duty: number;
  readonly envelope: Envelope;
  /**
   * Portion of seeded LFSR noise mixed into the oscillator (0 = pure osc,
   * 1 = pure noise). Drum voices lean on this heavily (RES-3).
   */
  readonly noiseMix: number;
  readonly noiseMode: NoiseMode;
  /** LFSR clock period in samples (smaller = brighter/hissier). */
  readonly noiseRate: number;
  /** Output level 0..1. */
  readonly level: number;
  /** Fixed base frequency in Hz (drum voices); pitched lanes derive from midi. */
  readonly baseFreq?: number;
  /** Linear pitch sweep (kick/tom glides): target = freq * endRatio. */
  readonly pitchSweep?: { readonly endRatio: number; readonly seconds: number };
  /** Pitched lanes only: which octave degree 0 sits in. */
  readonly pitchRange?: PitchRange;
  /** Deterministic LFSR seed base (per-note seeds derive from it). */
  readonly seed: number;
}

/** A drum kit is just a drum-piece → preset map (D2/D3). */
export interface DrumKit {
  readonly id: string;
  readonly name: string;
  readonly pieces: Readonly<Record<DrumPiece, VoicePreset>>;
}

// ---------------------------------------------------------------------------
// Flat per-note event payload (the worklet wire format; all primitives)
// ---------------------------------------------------------------------------

/** Wave discriminator as a small int (keeps the worklet monomorphic). */
export const WAVE_CODE = { pulse: 0, triangle: 1, noise: 2 } as const;

export interface VoiceNoteOnEvent {
  readonly type: "note-on";
  /** Absolute audio-clock time in seconds (keyed to ctx.currentTime). */
  readonly time: number;
  readonly wave: number;
  readonly freq: number;
  readonly freqEnd: number;
  readonly sweepSeconds: number;
  readonly duty: number;
  readonly noiseMix: number;
  readonly noiseShort: boolean;
  readonly noiseRate: number;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  /** Gate length in seconds (sustain phase ends here). */
  readonly holdSeconds: number;
  readonly level: number;
  /** LFSR seed 1..32767 for this note. */
  readonly seed: number;
}

/** Resolve a preset + note coordinates into the flat worklet payload. */
export function noteParamsFor(
  preset: VoicePreset,
  opts: {
    readonly time: number;
    /** MIDI note; ignored when the preset has baseFreq. */
    readonly midi?: number;
    readonly holdSeconds: number;
    /** Extra per-note seed salt (step index, piece ordinal...). */
    readonly seedSalt?: number;
  },
): VoiceNoteOnEvent {
  const base = preset.baseFreq ?? midiToFreq(opts.midi ?? 69);
  const freq = Math.min(base, MAX_VOICE_FREQ);
  const sweep = preset.pitchSweep;
  const freqEnd = Math.min(
    sweep ? base * sweep.endRatio : base,
    MAX_VOICE_FREQ,
  );
  const sweepSeconds = sweep && sweep.seconds > 0 ? sweep.seconds : 0;
  return {
    type: "note-on",
    time: opts.time,
    wave: WAVE_CODE[preset.wave],
    freq,
    freqEnd,
    sweepSeconds: sweepSeconds > 0 ? sweepSeconds : 0,
    duty: preset.duty,
    noiseMix: preset.wave === "noise" ? Math.max(preset.noiseMix, 1) : preset.noiseMix,
    noiseShort: preset.noiseMode === "short",
    noiseRate: preset.noiseRate,
    attack: preset.envelope.attack,
    decay: preset.envelope.decay,
    sustain: preset.envelope.sustain,
    release: preset.envelope.release,
    holdSeconds: opts.holdSeconds,
    level: preset.level,
    seed: noteSeed(preset.seed, Math.round(opts.time * 1000), opts.seedSalt ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Starter library — engine-validation presets (full library is PX-2)
// ---------------------------------------------------------------------------

function preset(p: VoicePreset): VoicePreset {
  return p;
}

export const PRESET_LIBRARY: Readonly<Record<string, VoicePreset>> = {
  "preset-bass-1": preset({
    id: "preset-bass-1",
    name: "Bass P50",
    wave: "pulse",
    duty: 0.5,
    envelope: { attack: 0.002, decay: 0.08, sustain: 0.7, release: 0.03 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.8,
    pitchRange: { octaveBase: 2 },
    seed: 1013,
  }),
  "preset-bass-2": preset({
    id: "preset-bass-2",
    name: "Bass P12.5 Sub",
    wave: "pulse",
    duty: 0.125,
    envelope: { attack: 0.004, decay: 0.12, sustain: 0.55, release: 0.05 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.85,
    pitchRange: { octaveBase: 1 },
    seed: 1021,
  }),
  "preset-chords-1": preset({
    id: "preset-chords-1",
    name: "Chords Tri",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.006, decay: 0.15, sustain: 0.6, release: 0.08 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.45,
    pitchRange: { octaveBase: 3 },
    seed: 2027,
  }),
  "preset-chords-2": preset({
    id: "preset-chords-2",
    name: "Chords P25 Pad",
    wave: "pulse",
    duty: 0.25,
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.65, release: 0.15 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.35,
    pitchRange: { octaveBase: 3 },
    seed: 2039,
  }),
  "preset-lead-1": preset({
    id: "preset-lead-1",
    name: "Lead P25",
    wave: "pulse",
    duty: 0.25,
    envelope: { attack: 0.001, decay: 0.06, sustain: 0.8, release: 0.04 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.6,
    pitchRange: { octaveBase: 4 },
    seed: 3011,
  }),
  "preset-lead-2": preset({
    id: "preset-lead-2",
    name: "Lead Tri Bright",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.001, decay: 0.2, sustain: 0.4, release: 0.06 },
    noiseMix: 0.04,
    noiseMode: "short",
    noiseRate: 8,
    level: 0.7,
    pitchRange: { octaveBase: 5 },
    seed: 3023,
  }),
};

function piece(
  kitId: string,
  name: string,
  baseFreq: number,
  over: Partial<VoicePreset>,
): VoicePreset {
  return preset({
    id: `${kitId}-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    wave: "pulse",
    duty: 0.5,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.8,
    ...over,
    baseFreq,
    seed: over.seed ?? 7,
    pitchRange: undefined,
  });
}

function kit(
  id: string,
  name: string,
  seedBase: number,
  flavor: "clean" | "grit",
): DrumKit {
  const s = (i: number) => seedBase + i;
  const grit = flavor === "grit";
  return {
    id,
    name,
    pieces: {
      kick: piece(id, "Kick", grit ? 150 : 160, {
        pitchSweep: { endRatio: grit ? 0.22 : 0.28, seconds: 0.06 },
        envelope: { attack: 0.001, decay: grit ? 0.22 : 0.18, sustain: 0, release: 0.02 },
        level: grit ? 0.95 : 0.9,
        seed: s(1),
      }),
      snare: piece(id, "Snare", grit ? 175 : 190, {
        wave: "triangle",
        noiseMix: grit ? 0.8 : 0.7,
        noiseRate: grit ? 24 : 36,
        envelope: { attack: 0.001, decay: grit ? 0.16 : 0.12, sustain: 0, release: 0.03 },
        level: grit ? 0.85 : 0.75,
        seed: s(2),
      }),
      hat: piece(id, "Hat", 8000, {
        wave: "noise",
        noiseMode: "short",
        noiseRate: 4,
        envelope: { attack: 0, decay: 0.03, sustain: 0, release: 0.005 },
        level: 0.4,
        seed: s(3),
      }),
      openhat: piece(id, "Open Hat", 7000, {
        wave: "noise",
        noiseMode: "short",
        noiseRate: 4,
        envelope: { attack: 0, decay: 0.22, sustain: 0.15, release: 0.06 },
        level: 0.35,
        seed: s(4),
      }),
      clap: piece(id, "Clap", 1200, {
        wave: "noise",
        noiseMode: "long",
        noiseRate: 12,
        envelope: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.08 },
        level: 0.6,
        seed: s(5),
      }),
      tom: piece(id, "Tom", grit ? 200 : 220, {
        wave: "triangle",
        pitchSweep: { endRatio: 0.5, seconds: 0.12 },
        envelope: { attack: 0.001, decay: 0.18, sustain: 0.1, release: 0.04 },
        level: 0.7,
        seed: s(6),
      }),
    },
  };
}

export const DRUM_KITS: Readonly<Record<string, DrumKit>> = {
  "kit-default": kit("kit-default", "Stage Clean", 5000, "clean"),
  "kit-grit": kit("kit-grit", "Arcade Grit", 6000, "grit"),
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getPreset(id: string): VoicePreset | undefined {
  return PRESET_LIBRARY[id];
}

export function getDrumKit(id: string): DrumKit | undefined {
  return DRUM_KITS[id];
}
