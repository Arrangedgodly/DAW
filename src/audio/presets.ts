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
    noiseMix:
      preset.wave === "noise" ? Math.max(preset.noiseMix, 1) : preset.noiseMix,
    noiseShort: preset.noiseMode === "short",
    noiseRate: preset.noiseRate,
    attack: preset.envelope.attack,
    decay: preset.envelope.decay,
    sustain: preset.envelope.sustain,
    release: preset.envelope.release,
    holdSeconds: opts.holdSeconds,
    level: preset.level,
    seed: noteSeed(
      preset.seed,
      Math.round(opts.time * 1000),
      opts.seedSalt ?? 0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Library (PX-2) — chiptune-leaning sound-design content, pure data.
//
// Character commitments (PRODUCT.md, binding): pulse-family with varied duties
// (12.5/25/50%), NES 32-step triangles, LFSR noise textures. Bass = deep +
// gluey (50% duty fast decay, one sub-triangle); chords = warm long-release
// pads + one arp-ready pluck; lead = cutting pulses + one "vibrato" voice.
//
// NOTE (vibrato): the engine wire format has no periodic pitch modulation;
// the closest existing param is a one-shot linear `pitchSweep`, which
// preset-lead-3 ("VIBRA TRI") uses as a subtle per-note pitch drift. Real
// vibrato needs an engine feature (rejected here per PX-2 scope rule).
// ---------------------------------------------------------------------------

import * as v from "valibot";

const UnitInterval = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const Positive = v.pipe(v.number(), v.minValue(1e-9));

export const EnvelopeSchema = v.strictObject({
  attack: v.pipe(v.number(), v.minValue(0), v.maxValue(2)),
  decay: v.pipe(v.number(), v.minValue(0), v.maxValue(4)),
  sustain: UnitInterval,
  release: v.pipe(v.number(), v.minValue(0), v.maxValue(4)),
});

export const VoicePresetSchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(14)),
  wave: v.picklist(["pulse", "triangle", "noise"]),
  duty: v.pipe(v.number(), v.minValue(1e-9), v.maxValue(1)),
  envelope: EnvelopeSchema,
  noiseMix: UnitInterval,
  noiseMode: v.picklist(["long", "short"]),
  noiseRate: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
  level: v.pipe(v.number(), v.minValue(1e-9), v.maxValue(1)),
  baseFreq: v.optional(Positive),
  pitchSweep: v.optional(
    v.strictObject({ endRatio: Positive, seconds: Positive }),
  ),
  pitchRange: v.optional(
    v.strictObject({
      octaveBase: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(6)),
    }),
  ),
  seed: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32767)),
});

function preset(p: VoicePreset): VoicePreset {
  // Data validity is part of the library contract (PX-2): a record that
  // fails the schema throws at module load, not at first audition.
  v.parse(VoicePresetSchema, p);
  return p;
}

export const PRESET_LIBRARY: Readonly<Record<string, VoicePreset>> = {
  // --- BASS: deep, gluey, fast-decay staples (one sub-triangle) -------------
  "preset-bass-1": preset({
    id: "preset-bass-1",
    name: "THICK PULSE",
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
    name: "SUB TRI",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.006, decay: 0.1, sustain: 0.65, release: 0.05 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.85,
    pitchRange: { octaveBase: 1 },
    seed: 1021,
  }),
  "preset-bass-3": preset({
    id: "preset-bass-3",
    name: "GLUE P25",
    wave: "pulse",
    duty: 0.25,
    envelope: { attack: 0.004, decay: 0.06, sustain: 0.6, release: 0.04 },
    noiseMix: 0.03,
    noiseMode: "short",
    noiseRate: 6,
    level: 0.8,
    pitchRange: { octaveBase: 2 },
    seed: 1033,
  }),
  "preset-bass-4": preset({
    id: "preset-bass-4",
    name: "DIRTY 12.5",
    wave: "pulse",
    duty: 0.125,
    envelope: { attack: 0.002, decay: 0.12, sustain: 0.5, release: 0.05 },
    noiseMix: 0.08,
    noiseMode: "short",
    noiseRate: 8,
    level: 0.82,
    pitchRange: { octaveBase: 2 },
    seed: 1039,
  }),
  "preset-bass-5": preset({
    id: "preset-bass-5",
    name: "ROUND TRI",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.008, decay: 0.15, sustain: 0.55, release: 0.06 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.75,
    pitchRange: { octaveBase: 2 },
    seed: 1049,
  }),
  "preset-bass-6": preset({
    id: "preset-bass-6",
    name: "BITE P50",
    wave: "pulse",
    duty: 0.5,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0.75, release: 0.03 },
    noiseMix: 0.05,
    noiseMode: "short",
    noiseRate: 5,
    level: 0.78,
    pitchRange: { octaveBase: 3 },
    seed: 1057,
  }),

  // --- CHORDS: warm long-release pads + one arp-ready pluck -----------------
  "preset-chords-1": preset({
    id: "preset-chords-1",
    name: "WARM PAD",
    wave: "pulse",
    duty: 0.5,
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.65, release: 0.4 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.35,
    pitchRange: { octaveBase: 3 },
    seed: 2027,
  }),
  "preset-chords-2": preset({
    id: "preset-chords-2",
    name: "GLASS TRI",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.03, decay: 0.4, sustain: 0.6, release: 0.5 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.4,
    pitchRange: { octaveBase: 4 },
    seed: 2039,
  }),
  "preset-chords-3": preset({
    id: "preset-chords-3",
    name: "SOFT P25",
    wave: "pulse",
    duty: 0.25,
    envelope: { attack: 0.015, decay: 0.25, sustain: 0.6, release: 0.3 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.3,
    pitchRange: { octaveBase: 3 },
    seed: 2053,
  }),
  "preset-chords-4": preset({
    id: "preset-chords-4",
    name: "ARP PLUCK",
    wave: "pulse",
    duty: 0.125,
    envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.09 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.5,
    pitchRange: { octaveBase: 4 },
    seed: 2063,
  }),
  "preset-chords-5": preset({
    id: "preset-chords-5",
    name: "DUST PAD",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.04, decay: 0.5, sustain: 0.55, release: 0.45 },
    noiseMix: 0.12,
    noiseMode: "short",
    noiseRate: 10,
    level: 0.32,
    pitchRange: { octaveBase: 3 },
    seed: 2071,
  }),
  "preset-chords-6": preset({
    id: "preset-chords-6",
    name: "HOLLOW P25",
    wave: "pulse",
    duty: 0.25,
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.25 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.38,
    pitchRange: { octaveBase: 4 },
    seed: 2083,
  }),

  // --- LEAD: cutting pulses + one pitch-drift ("vibrato") voice -------------
  "preset-lead-1": preset({
    id: "preset-lead-1",
    name: "CUT P50",
    wave: "pulse",
    duty: 0.5,
    envelope: { attack: 0.001, decay: 0.06, sustain: 0.8, release: 0.05 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.6,
    pitchRange: { octaveBase: 4 },
    seed: 3011,
  }),
  "preset-lead-2": preset({
    id: "preset-lead-2",
    name: "BRIGHT TRI",
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
  "preset-lead-3": preset({
    id: "preset-lead-3",
    name: "VIBRA TRI",
    wave: "triangle",
    duty: 0.5,
    envelope: { attack: 0.003, decay: 0.1, sustain: 0.7, release: 0.08 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.62,
    // Closest available stand-in for vibrato (no periodic pitch modulation
    // in the engine): a subtle per-note upward drift, ~21 cents.
    pitchSweep: { endRatio: 1.0125, seconds: 0.35 },
    pitchRange: { octaveBase: 4 },
    seed: 3037,
  }),
  "preset-lead-4": preset({
    id: "preset-lead-4",
    name: "NEEDLE 12.5",
    wave: "pulse",
    duty: 0.125,
    envelope: { attack: 0.001, decay: 0.04, sustain: 0.7, release: 0.04 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.58,
    pitchRange: { octaveBase: 5 },
    seed: 3043,
  }),
  "preset-lead-5": preset({
    id: "preset-lead-5",
    name: "SQUARE SOLO",
    wave: "pulse",
    duty: 0.25,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0.75, release: 0.06 },
    noiseMix: 0,
    noiseMode: "long",
    noiseRate: 40,
    level: 0.65,
    pitchRange: { octaveBase: 4 },
    seed: 3053,
  }),
  "preset-lead-6": preset({
    id: "preset-lead-6",
    name: "GRIT LEAD",
    wave: "pulse",
    duty: 0.5,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0.7, release: 0.05 },
    noiseMix: 0.1,
    noiseMode: "short",
    noiseRate: 6,
    level: 0.6,
    pitchRange: { octaveBase: 4 },
    seed: 3061,
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

/**
 * Kit recipe (PX-2): every knob the character brief asks to vary — kick pitch
 * sweep + decay, snare tone/noise mix + rate, hat decay/rate. Pure data.
 */
interface KitSpec {
  readonly kick: {
    readonly start: number;
    readonly endRatio: number;
    readonly seconds: number;
    readonly decay: number;
    readonly level: number;
  };
  readonly snare: {
    readonly freq: number;
    readonly noiseMix: number;
    readonly noiseRate: number;
    readonly decay: number;
    readonly level: number;
  };
  readonly hat: {
    readonly rate: number;
    readonly decay: number;
    readonly level: number;
  };
  readonly openhat: {
    readonly rate: number;
    readonly decay: number;
    readonly sustain: number;
    readonly level: number;
  };
  readonly clap: {
    readonly rate: number;
    readonly decay: number;
    readonly level: number;
  };
  readonly tom: {
    readonly freq: number;
    readonly endRatio: number;
    readonly decay: number;
    readonly level: number;
  };
}

function kit(
  id: string,
  name: string,
  seedBase: number,
  spec: KitSpec,
): DrumKit {
  const s = (i: number) => seedBase + i;
  return {
    id,
    name,
    pieces: {
      kick: piece(id, "Kick", spec.kick.start, {
        pitchSweep: {
          endRatio: spec.kick.endRatio,
          seconds: spec.kick.seconds,
        },
        envelope: {
          attack: 0.001,
          decay: spec.kick.decay,
          sustain: 0,
          release: 0.02,
        },
        level: spec.kick.level,
        seed: s(1),
      }),
      snare: piece(id, "Snare", spec.snare.freq, {
        wave: "triangle",
        noiseMix: spec.snare.noiseMix,
        noiseRate: spec.snare.noiseRate,
        envelope: {
          attack: 0.001,
          decay: spec.snare.decay,
          sustain: 0,
          release: 0.03,
        },
        level: spec.snare.level,
        seed: s(2),
      }),
      hat: piece(id, "Hat", 8000, {
        wave: "noise",
        noiseMode: "short",
        noiseRate: spec.hat.rate,
        envelope: {
          attack: 0,
          decay: spec.hat.decay,
          sustain: 0,
          release: 0.005,
        },
        level: spec.hat.level,
        seed: s(3),
      }),
      openhat: piece(id, "Open Hat", 7000, {
        wave: "noise",
        noiseMode: "short",
        noiseRate: spec.openhat.rate,
        envelope: {
          attack: 0,
          decay: spec.openhat.decay,
          sustain: spec.openhat.sustain,
          release: 0.06,
        },
        level: spec.openhat.level,
        seed: s(4),
      }),
      clap: piece(id, "Clap", 1200, {
        wave: "noise",
        noiseMode: "long",
        noiseRate: spec.clap.rate,
        envelope: {
          attack: 0.001,
          decay: spec.clap.decay,
          sustain: 0.1,
          release: 0.08,
        },
        level: spec.clap.level,
        seed: s(5),
      }),
      tom: piece(id, "Tom", spec.tom.freq, {
        wave: "triangle",
        pitchSweep: { endRatio: spec.tom.endRatio, seconds: 0.12 },
        envelope: {
          attack: 0.001,
          decay: spec.tom.decay,
          sustain: 0.1,
          release: 0.04,
        },
        level: spec.tom.level,
        seed: s(6),
      }),
    },
  };
}

export const DRUM_KITS: Readonly<Record<string, DrumKit>> = {
  "kit-default": kit("kit-default", "8-BIT ROOM", 5000, {
    kick: {
      start: 160,
      endRatio: 0.28,
      seconds: 0.06,
      decay: 0.18,
      level: 0.9,
    },
    snare: {
      freq: 190,
      noiseMix: 0.7,
      noiseRate: 36,
      decay: 0.12,
      level: 0.75,
    },
    hat: { rate: 4, decay: 0.03, level: 0.4 },
    openhat: { rate: 4, decay: 0.22, sustain: 0.15, level: 0.35 },
    clap: { rate: 12, decay: 0.15, level: 0.6 },
    tom: { freq: 220, endRatio: 0.5, decay: 0.18, level: 0.7 },
  }),
  "kit-grit": kit("kit-grit", "NOISE PUNK", 6000, {
    kick: {
      start: 150,
      endRatio: 0.22,
      seconds: 0.06,
      decay: 0.22,
      level: 0.95,
    },
    snare: {
      freq: 175,
      noiseMix: 0.85,
      noiseRate: 20,
      decay: 0.18,
      level: 0.9,
    },
    hat: { rate: 6, decay: 0.04, level: 0.45 },
    openhat: { rate: 5, decay: 0.3, sustain: 0.2, level: 0.4 },
    clap: { rate: 18, decay: 0.12, level: 0.68 },
    tom: { freq: 200, endRatio: 0.45, decay: 0.2, level: 0.75 },
  }),
  "kit-metal": kit("kit-metal", "CHIP METAL", 6100, {
    kick: {
      start: 170,
      endRatio: 0.15,
      seconds: 0.05,
      decay: 0.15,
      level: 0.92,
    },
    snare: { freq: 200, noiseMix: 0.75, noiseRate: 28, decay: 0.1, level: 0.8 },
    hat: { rate: 2, decay: 0.025, level: 0.42 },
    openhat: { rate: 3, decay: 0.15, sustain: 0.1, level: 0.36 },
    clap: { rate: 10, decay: 0.1, level: 0.62 },
    tom: { freq: 260, endRatio: 0.6, decay: 0.14, level: 0.72 },
  }),
  "kit-soft": kit("kit-soft", "SOFT STEP", 6200, {
    kick: { start: 120, endRatio: 0.4, seconds: 0.09, decay: 0.25, level: 0.8 },
    snare: { freq: 160, noiseMix: 0.6, noiseRate: 48, decay: 0.14, level: 0.6 },
    hat: { rate: 8, decay: 0.05, level: 0.3 },
    openhat: { rate: 7, decay: 0.32, sustain: 0.2, level: 0.26 },
    clap: { rate: 24, decay: 0.2, level: 0.5 },
    tom: { freq: 180, endRatio: 0.55, decay: 0.22, level: 0.6 },
  }),
  "kit-dust": kit("kit-dust", "DUST ROOM", 6300, {
    kick: { start: 140, endRatio: 0.3, seconds: 0.07, decay: 0.2, level: 0.85 },
    snare: {
      freq: 185,
      noiseMix: 0.78,
      noiseRate: 16,
      decay: 0.16,
      level: 0.7,
    },
    hat: { rate: 10, decay: 0.06, level: 0.28 },
    openhat: { rate: 9, decay: 0.35, sustain: 0.18, level: 0.24 },
    clap: { rate: 30, decay: 0.18, level: 0.52 },
    tom: { freq: 210, endRatio: 0.5, decay: 0.2, level: 0.65 },
  }),
  "kit-lab": kit("kit-lab", "PULSE LAB", 6400, {
    kick: {
      start: 180,
      endRatio: 0.2,
      seconds: 0.04,
      decay: 0.12,
      level: 0.88,
    },
    snare: {
      freq: 210,
      noiseMix: 0.65,
      noiseRate: 40,
      decay: 0.09,
      level: 0.72,
    },
    hat: { rate: 5, decay: 0.02, level: 0.38 },
    openhat: { rate: 4, decay: 0.18, sustain: 0.12, level: 0.32 },
    clap: { rate: 8, decay: 0.12, level: 0.58 },
    tom: { freq: 300, endRatio: 0.62, decay: 0.12, level: 0.68 },
  }),
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
