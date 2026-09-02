/**
 * Bitbounce project document — versioned, JSON-safe by construction.
 *
 * Design rules (MF-1, decisions from docs/ultron/research/res-5-6):
 * - Every value is JSON-serializable: no Date, Map, class instances, undefined-only
 *   fields, or functions. Optional absence is expressed via missing key or `null`
 *   where the field is semantically nullable (lane scale overrides).
 * - `version` is the doc-level schema version; migrations (migrate.ts) key off it
 *   before validation ever runs. The persistence envelope
 *   `{id, schemaVersion, updatedAt, json}` (MF-2) wraps this document as `json`.
 * - Validation strictness: STRICT — unknown keys anywhere are rejected (see
 *   validate.ts). Malformed docs never reach the engine.
 */

import * as v from "valibot";
import { MAX_BPM, MIN_BPM, type LoopBars } from "../audio/time";
import type { ModeName } from "./scales";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;

export const PITCH_CLASS_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const PitchClassSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(11));

/** Fixed lane order is part of the schema: drums, bass, chords, lead. */
export const LANE_IDS = ["drums", "bass", "chords", "lead"] as const;
export type LaneId = (typeof LANE_IDS)[number];
export const LaneIdSchema = v.picklist(LANE_IDS);

/** Drum pieces (minimum set; engine may add more via schemaVersion bump). */
export const DRUM_PIECES = ["kick", "snare", "hat", "openhat", "clap", "tom"] as const;
export type DrumPiece = (typeof DRUM_PIECES)[number];

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

export interface ScaleConfig {
  readonly root: PitchClass;
  readonly mode: ModeName;
}
export const ScaleConfigSchema = v.strictObject({
  root: PitchClassSchema,
  mode: v.string(), // narrowed semantically against MODE_INTERVALS (avoids schema<->scales circular import)
});

/**
 * Per-lane scale overrides. `null` = no lane overrides at all. Each value is a
 * full ScaleConfig (a lane with an override replaces the project default;
 * absent key = follow the project default).
 */
export type LaneOverrides = Readonly<Partial<Record<LaneId, ScaleConfig>>>;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface Transport {
  readonly bpm: number;
  readonly swing: number;
  readonly loopBars: LoopBars;
  readonly metronome: boolean;
}
export const TransportSchema = v.strictObject({
  bpm: v.pipe(v.number(), v.minValue(MIN_BPM), v.maxValue(MAX_BPM)),
  swing: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  loopBars: v.picklist([1, 2, 4]),
  metronome: v.boolean(),
});

// ---------------------------------------------------------------------------
// FX devices (0–3 per lane)
// ---------------------------------------------------------------------------

export type FxDevice =
  | {
      readonly type: "filter";
      readonly bypassed: boolean;
      readonly params: {
        readonly kind?: "lowpass" | "highpass" | "bandpass";
        readonly cutoffHz: number;
        readonly q: number;
      };
    }
  | {
      readonly type: "drive";
      readonly bypassed: boolean;
      readonly params: { readonly amount: number };
    }
  | {
      readonly type: "bitcrusher";
      readonly bypassed: boolean;
      readonly params: { readonly bits: number; readonly downsample: number };
    }
  | {
      readonly type: "delay";
      readonly bypassed: boolean;
      readonly params: { readonly timeSteps: number; readonly feedback: number; readonly mix: number };
    }
  | {
      readonly type: "reverb";
      readonly bypassed: boolean;
      readonly params: { readonly size: number; readonly mix: number };
    };

export const MAX_FX_PER_LANE = 3;

const UnitInterval = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

export const FxDeviceSchema = v.variant("type", [
  v.strictObject({
    type: v.literal("filter"),
    bypassed: v.boolean(),
    params: v.strictObject({
      // IM-4: response kind; omitted = lowpass (v1 documents written before
      // the field existed stay valid — MF-1 schema stays backward compatible).
      kind: v.optional(v.picklist(["lowpass", "highpass", "bandpass"])),
      cutoffHz: v.pipe(v.number(), v.minValue(20), v.maxValue(20000)),
      q: v.pipe(v.number(), v.minValue(0.1), v.maxValue(18)),
    }),
  }),
  v.strictObject({
    type: v.literal("drive"),
    bypassed: v.boolean(),
    params: v.strictObject({ amount: UnitInterval }),
  }),
  v.strictObject({
    type: v.literal("bitcrusher"),
    bypassed: v.boolean(),
    params: v.strictObject({
      bits: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
      downsample: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
    }),
  }),
  v.strictObject({
    type: v.literal("delay"),
    bypassed: v.boolean(),
    params: v.strictObject({
      timeSteps: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
      feedback: v.pipe(v.number(), v.minValue(0), v.maxValue(0.95)),
      mix: UnitInterval,
    }),
  }),
  v.strictObject({
    type: v.literal("reverb"),
    bypassed: v.boolean(),
    params: v.strictObject({ size: UnitInterval, mix: UnitInterval }),
  }),
]);

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** Gate length: either absolute seconds or a count of 16th steps. */
export type LaneGate =
  | { readonly unit: "seconds"; readonly value: number }
  | { readonly unit: "steps"; readonly value: number };
export const LaneGateSchema = v.variant("unit", [
  v.strictObject({ unit: v.literal("seconds"), value: v.pipe(v.number(), v.minValue(0.005), v.maxValue(4)) }),
  v.strictObject({ unit: v.literal("steps"), value: v.pipe(v.number(), v.minValue(0.25), v.maxValue(64)) }),
]);

export interface DrumsLane {
  readonly id: "drums";
  readonly kitId: string;
  readonly gate: LaneGate;
  readonly fxChain: readonly FxDevice[];
}

export interface PitchedLane {
  readonly id: Exclude<LaneId, "drums">;
  readonly presetId: string;
  readonly gate: LaneGate;
  readonly fxChain: readonly FxDevice[];
}

export type Lane = DrumsLane | PitchedLane;

const LaneCommon = {
  gate: LaneGateSchema,
  fxChain: v.pipe(v.array(FxDeviceSchema), v.maxLength(MAX_FX_PER_LANE)),
};

export const LaneSchema = v.variant("id", [
  v.strictObject({ id: v.literal("drums"), kitId: v.string(), ...LaneCommon }),
  v.strictObject({ id: v.literal("bass"), presetId: v.string(), ...LaneCommon }),
  v.strictObject({ id: v.literal("chords"), presetId: v.string(), ...LaneCommon }),
  v.strictObject({ id: v.literal("lead"), presetId: v.string(), ...LaneCommon }),
]);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Pitched step cell (compact, JSON-safe): 0 = off, 1 = note-on,
 * 2 = note-on + sustain marker (extends the note past its gate).
 */
export type PitchedCell = 0 | 1 | 2;
export const PitchedCellSchema = v.picklist([0, 1, 2]);

/** A pitched grid row: one scale-degree lane across all steps of the pattern. */
export interface PitchedRow {
  /** Scale-degree index (0-based; may exceed the mode size → wraps up octaves). */
  readonly degree: number;
  readonly steps: readonly PitchedCell[];
}

export type PatternBars = 1 | 2 | 4;
const PatternBarsSchema = v.picklist([1, 2, 4]);

export interface DrumPattern {
  readonly kind: "drums";
  readonly id: string;
  readonly name: string;
  readonly bars: PatternBars;
  /** drum piece → on/off per step (length = 16 * bars). */
  readonly steps: Readonly<Record<DrumPiece, readonly boolean[]>>;
}

export interface PitchedPattern {
  readonly kind: "pitched";
  readonly id: string;
  readonly name: string;
  readonly bars: PatternBars;
  readonly rows: readonly PitchedRow[];
}

export type Pattern = DrumPattern | PitchedPattern;

export const PatternSchema = v.variant("kind", [
  v.strictObject({
    kind: v.literal("drums"),
    id: v.string(),
    name: v.string(),
    bars: PatternBarsSchema,
    steps: v.record(v.picklist(DRUM_PIECES), v.array(v.boolean())),
  }),
  v.strictObject({
    kind: v.literal("pitched"),
    id: v.string(),
    name: v.string(),
    bars: PatternBarsSchema,
    rows: v.array(
      v.strictObject({
        degree: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(23)),
        steps: v.array(PitchedCellSchema),
      }),
    ),
  }),
]);

/** Patterns per lane, keyed by lane id. */
export type LanePatterns = Readonly<Record<LaneId, readonly Pattern[]>>;

/** Per-lane linear chain of pattern ids (ids may repeat). */
export type SongChain = Readonly<Record<LaneId, readonly string[]>>;

const PatternsSchema = v.strictObject({
  drums: v.array(PatternSchema),
  bass: v.array(PatternSchema),
  chords: v.array(PatternSchema),
  lead: v.array(PatternSchema),
});

const SongChainSchema = v.strictObject({
  drums: v.array(v.string()),
  bass: v.array(v.string()),
  chords: v.array(v.string()),
  lead: v.array(v.string()),
});

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface ProjectDocument {
  readonly name: string;
  /** Doc-level schema version — migrate.ts keys off this. */
  readonly version: typeof SCHEMA_VERSION;
  readonly transport: Transport;
  readonly scale: ScaleConfig;
  /** Per-lane scale override, or null when the project default rules everywhere. */
  readonly laneOverrides: LaneOverrides | null;
  readonly lanes: readonly Lane[];
  readonly patterns: LanePatterns;
  readonly songChain: SongChain;
}

export const ProjectDocumentSchema = v.pipe(
  v.strictObject({
    name: v.string(),
    version: v.literal(SCHEMA_VERSION),
    transport: TransportSchema,
    scale: ScaleConfigSchema,
    laneOverrides: v.nullable(
      v.strictObject({
        drums: v.optional(v.nullable(ScaleConfigSchema)),
        bass: v.optional(v.nullable(ScaleConfigSchema)),
        chords: v.optional(v.nullable(ScaleConfigSchema)),
        lead: v.optional(v.nullable(ScaleConfigSchema)),
      }),
    ),
    lanes: v.pipe(v.array(LaneSchema), v.length(4)),
    patterns: PatternsSchema,
    songChain: SongChainSchema,
  }),
);

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

function emptyDrumSteps(bars: PatternBars): Record<DrumPiece, boolean[]> {
  const out = {} as Record<DrumPiece, boolean[]>;
  for (const piece of DRUM_PIECES) out[piece] = new Array(16 * bars).fill(false);
  return out;
}

function emptyPitchedPattern(id: string, name: string, bars: PatternBars, degrees: number[]): PitchedPattern {
  return {
    kind: "pitched",
    id,
    name,
    bars,
    rows: degrees.map((degree) => ({ degree, steps: new Array(16 * bars).fill(0) as PitchedCell[] })),
  };
}

/** A sane empty project: 4 lanes, one 1-bar pattern each, chained once. */
export function createDefaultProject(): ProjectDocument {
  return {
    name: "Untitled",
    version: SCHEMA_VERSION,
    // loopBars 1 matches the default single-bar patterns (IM-6: the persisted
    // loopBars is now authoritative in the engine bridge, so it must agree
    // with the shipped grid extent).
    transport: { bpm: 120, swing: 0, loopBars: 1, metronome: false },
    scale: { root: 0, mode: "minor" },
    laneOverrides: null,
    lanes: [
      { id: "drums", kitId: "kit-default", gate: { unit: "steps", value: 1 }, fxChain: [] },
      { id: "bass", presetId: "preset-bass-1", gate: { unit: "steps", value: 2 }, fxChain: [] },
      { id: "chords", presetId: "preset-chords-1", gate: { unit: "steps", value: 4 }, fxChain: [] },
      { id: "lead", presetId: "preset-lead-1", gate: { unit: "steps", value: 2 }, fxChain: [] },
    ],
    patterns: {
      drums: [{ kind: "drums", id: "drums-1", name: "A", bars: 1, steps: emptyDrumSteps(1) }],
      bass: [emptyPitchedPattern("bass-1", "A", 1, [0, 1, 2, 3, 4, 5, 6])],
      chords: [
        {
          kind: "pitched",
          id: "chords-1",
          name: "A",
          bars: 1,
          rows: [0, 1, 2, 3, 4, 5, 6].map((chordDegree) => ({
            degree: chordDegree,
            steps: new Array(16).fill(0) as PitchedCell[],
          })),
        },
      ],
      lead: [emptyPitchedPattern("lead-1", "A", 1, [0, 1, 2, 3, 4, 5, 6])],
    },
    songChain: {
      drums: ["drums-1"],
      bass: ["bass-1"],
      chords: ["chords-1"],
      lead: ["lead-1"],
    },
  };
}
