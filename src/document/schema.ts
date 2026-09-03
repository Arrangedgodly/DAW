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
import { MAX_BPM, MIN_BPM, type LoopBars, secondsPerStep } from "../audio/time";
import type { ModeName } from "./scales";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * SCHEMA v2 (SC-1, iteration 2): pitched-lane patterns moved from cell rows
 * (`PitchedRow.steps` of 0/1/2) to explicit notes `{degree, start, length}`
 * (I2-3/I2-4). Drums patterns stay row-step booleans. v1 documents migrate
 * losslessly through the ONE parse path (codec → migrate → validate).
 *
 * NOTE-MODEL DECISION (production-owned, per the town-hall iteration-2
 * disposition table — recorded here as the plan requires):
 * - Length unit = STEPS at 0.25-step granularity (`NOTE_LENGTH_GRANULARITY`).
 *   A note sounds for `length × secondsPerStep(bpm)` — musical time, so notes
 *   keep their grid shape when BPM changes (the v1 seconds-gate did not).
 * - Migration law (duration-preserving): a v1 run of note-on(1)+sustain(2)
 *   cells becomes ONE note whose length is `gateSteps + sustainCount` — the
 *   exact duration v1's engine played (`gate + k steps`) — NOT the raw cell
 *   span (1 + k): the span reading would audibly shorten every sustained note
 *   on a lane with gate > 1 (e.g. the demo's 6-step chord pads: 15 steps
 *   played, 10 cells spanned). Duration is the lossless reading; the lane
 *   gate still rules single clicks (a lone note-on migrates to
 *   length = gateSteps, and remains the single-click default in v2 UI).
 * - The one documented quantization corner: v1 seconds-unit gates resolve to
 *   steps at migration (`gate seconds / secondsPerStep`, rounded to the 0.25
 *   grid). The shipped UI only ever wrote integer-step gates (LaneHeader
 *   GATE stepper 1–16 whole steps; seconds gates coerce to 1 step on edit),
 *   so every UI-reachable project migrates EXACTLY. Hand-authored imports
 *   with seconds gates can drift by at most half a quantum (±0.125 step) on
 *   lone hits — sub-perceptual, recorded here per the plan's risk note.
 * - Orphan sustain markers (a v1 `2` cell whose note-on head was deleted;
 *   audio-dead, only reachable by head-clicking a demo run — the UI could
 *   never create them) do not survive migration: v2 notes cannot represent a
 *   sustain without a note, and v1's engine ignored them. Audio-identical.
 * - The v1 cell model is retained BELOW as a compatibility VIEW
 *   (`pitchedPatternView`) so the not-yet-migrated engine/UI consumers
 *   (compile.ts, exportMidi.ts, renderer, store toggles) keep behaving
 *   byte-identically until SC-2 consumes notes natively.
 */
export const SCHEMA_VERSION = 2;

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

export const PitchClassSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(11),
);

/** Fixed lane order is part of the schema: drums, bass, chords, lead. */
export const LANE_IDS = ["drums", "bass", "chords", "lead"] as const;
export type LaneId = (typeof LANE_IDS)[number];
export const LaneIdSchema = v.picklist(LANE_IDS);

/** Drum pieces (minimum set; engine may add more via schemaVersion bump). */
export const DRUM_PIECES = [
  "kick",
  "snare",
  "hat",
  "openhat",
  "clap",
  "tom",
] as const;
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
      readonly params: {
        readonly timeSteps: number;
        readonly feedback: number;
        readonly mix: number;
      };
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
      downsample: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(1),
        v.maxValue(64),
      ),
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
  v.strictObject({
    unit: v.literal("seconds"),
    value: v.pipe(v.number(), v.minValue(0.005), v.maxValue(4)),
  }),
  v.strictObject({
    unit: v.literal("steps"),
    value: v.pipe(v.number(), v.minValue(0.25), v.maxValue(64)),
  }),
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
  v.strictObject({
    id: v.literal("bass"),
    presetId: v.string(),
    ...LaneCommon,
  }),
  v.strictObject({
    id: v.literal("chords"),
    presetId: v.string(),
    ...LaneCommon,
  }),
  v.strictObject({
    id: v.literal("lead"),
    presetId: v.string(),
    ...LaneCommon,
  }),
]);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * v1 pitched step cell — RETAINED (SC-1) only as the compatibility view the
 * not-yet-migrated consumers derive from v2 notes (`pitchedPatternView`):
 * 0 = off, 1 = note-on, 2 = note-on + sustain marker (extends past the gate).
 * The on-disk schema no longer stores these (see the SCHEMA v2 note above).
 */
export type PitchedCell = 0 | 1 | 2;
export const PitchedCellSchema = v.picklist([0, 1, 2]);

/**
 * A v1-shaped grid row (one scale-degree lane across the pattern), produced
 * by `pitchedPatternView` for compile.ts / exportMidi.ts / the grid renderer.
 */
export interface PitchedRow {
  /** Scale-degree index (0-based; may exceed the mode size → wraps up octaves). */
  readonly degree: number;
  readonly steps: readonly PitchedCell[];
}

// ---------------------------------------------------------------------------
// Notes (v2) — the persisted pitched-pattern content
// ---------------------------------------------------------------------------

/** Smallest representable note: one quarter of a 16th step. */
export const NOTE_LENGTH_GRANULARITY = 0.25;
export const MIN_NOTE_LENGTH = 0.25;
/**
 * Longest note. The worst v1 case is a max steps-gate (64) plus every
 * remaining cell as sustain (63) on a 4-bar pattern = 127; 128 bounds it.
 */
export const MAX_NOTE_LENGTH = 128;

/**
 * One pitched note (v2): a scale-degree voice sounding from `start` for
 * `length` steps. `length` is on the 0.25-step grid (enforced by validation);
 * `start` is a whole step inside the pattern; `start + length` MAY run past
 * the pattern end exactly like a v1 gate overhang did (loops wrap). Overlaps
 * (same degree or not) are legal — v1 allowed audible overlap via long gates,
 * and drag-created sustained notes (IN-2) rely on it.
 */
export interface Note {
  readonly degree: number;
  readonly start: number;
  readonly length: number;
}

const NoteDegree = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(23),
);
export const NoteSchema = v.strictObject({
  degree: NoteDegree,
  start: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(63)),
  length: v.pipe(
    v.number(),
    v.minValue(MIN_NOTE_LENGTH),
    v.maxValue(MAX_NOTE_LENGTH),
  ),
});

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

/**
 * A v2 pitched pattern: explicit notes plus the (unchanged) manifest of
 * degree rows the editing grid shows (`rowDegrees` is exactly the degree list
 * v1's `rows` carried — the visible row extent is pattern data, so behavior
 * like "rows created under a 7-note mode keep their extent after a mode
 * change" is preserved verbatim). Notes are kept sorted by (degree, start)
 * by every writer; validation does not depend on the order, canonical bytes do.
 */
export interface PitchedPattern {
  readonly kind: "pitched";
  readonly id: string;
  readonly name: string;
  readonly bars: PatternBars;
  readonly rowDegrees: readonly number[];
  readonly notes: readonly Note[];
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
    rowDegrees: v.array(NoteDegree),
    notes: v.array(NoteSchema),
  }),
]);

// ---------------------------------------------------------------------------
// v1 ↔ v2 pitched representations (SC-1 bridge — pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Resolve a lane gate into steps on the 0.25 grid (the migration/toggle law;
 * see the SCHEMA v2 header). Steps-unit gates pass through (quantized to the
 * grid if a hand-authored file is off it); seconds-unit gates convert at the
 * given BPM and round to the nearest quarter step. Never below one quantum.
 */
export function resolveGateSteps(gate: LaneGate, bpm: number): number {
  const raw =
    gate.unit === "steps" ? gate.value : gate.value / secondsPerStep(bpm);
  return Math.max(
    MIN_NOTE_LENGTH,
    Math.round(raw / NOTE_LENGTH_GRANULARITY) * NOTE_LENGTH_GRANULARITY,
  );
}

/**
 * v1 rows → v2 notes: the migration law core (also the authoring path for
 * the demo song, so its v2 bytes ARE its migration result). For each note-on
 * cell, one note of length `gateSteps + sustainCount`. Cells past `maxSteps`
 * (v1 normalize used to truncate them) and orphan sustain markers (audio-dead
 * v1 artifacts — see schema header) are dropped. Throws on cells outside
 * {0,1,2} so previously-invalid documents stay rejected (never silently
 * laundered into valid v2). Returns notes sorted by (degree, start).
 */
export function notesFromRowCells(
  rows: readonly PitchedRow[],
  gateSteps: number,
  maxSteps: number,
): Note[] {
  const notes: Note[] = [];
  for (const row of rows) {
    const steps = row.steps;
    for (let i = 0; i < steps.length; i++) {
      const cell = steps[i];
      if (cell !== 0 && cell !== 1 && cell !== 2) {
        throw new Error(
          `notesFromRowCells: invalid pitched cell ${String(cell)} at step ${i} (degree ${row.degree}) — not a v1 pattern`,
        );
      }
      if (cell !== 1 || i >= maxSteps) continue;
      let sustain = 0;
      while (
        i + 1 + sustain < steps.length &&
        i + 1 + sustain < maxSteps &&
        steps[i + 1 + sustain] === 2
      ) {
        sustain++;
      }
      notes.push({ degree: row.degree, start: i, length: gateSteps + sustain });
    }
  }
  notes.sort((a, b) => a.degree - b.degree || a.start - b.start);
  return notes;
}

/**
 * The v1-shaped view of a v2 pitched pattern (SC-1 compatibility: the
 * engine/compiler, MIDI exporter, and grid renderer keep consuming exactly
 * the cell model v0 consumed — byte-identical behavior for every document
 * whose notes were produced by the laws above). The sustain-marker count for
 * a note is `length - gateSteps` (the inverse of the migration law).
 */
export interface PitchedPatternView {
  readonly kind: "pitched";
  readonly id: string;
  readonly name: string;
  readonly bars: PatternBars;
  readonly rows: readonly PitchedRow[];
}

export function pitchedPatternView(
  pattern: PitchedPattern,
  gateSteps: number,
): PitchedPatternView {
  const width = pattern.bars * 16;
  // One cell array per manifest degree (duplicate degrees each get their own
  // row, all written identically — v0's per-degree writes hit every match).
  const cells = new Map<number, PitchedCell[]>();
  const rows: PitchedRow[] = pattern.rowDegrees.map((degree) => {
    const arr = new Array<PitchedCell>(width).fill(0);
    cells.set(degree, arr);
    return { degree, steps: arr };
  });
  for (const note of pattern.notes) {
    const targets = cells.get(note.degree);
    if (!targets) continue; // degree outside the manifest: unplayed (v1: no row)
    if (note.start >= width) continue; // defensive; validation rejects this
    const sustain = Math.max(0, Math.round(note.length - gateSteps));
    if (targets[note.start] === 0) targets[note.start] = 1;
    for (let i = note.start + 1; i <= note.start + sustain && i < width; i++) {
      if (targets[i] === 0) targets[i] = 2;
    }
  }
  return {
    kind: "pitched",
    id: pattern.id,
    name: pattern.name,
    bars: pattern.bars,
    rows,
  };
}

/**
 * The v1 cell at (degree, step) of a v2 pattern — the read side of the
 * compatibility bridge (store toggles). Same law as `pitchedPatternView`.
 */
export function pitchedCellAt(
  pattern: PitchedPattern,
  gateSteps: number,
  degree: number,
  step: number,
): PitchedCell {
  for (const note of pattern.notes) {
    if (note.degree !== degree) continue;
    if (note.start === step) return 1;
    const sustain = Math.max(0, Math.round(note.length - gateSteps));
    if (step > note.start && step <= note.start + sustain) return 2;
  }
  return 0;
}

/**
 * The v0 toggle law applied to v2 notes: returns the pattern with the cell at
 * (degree, step) flipped exactly as `withPitchedCell` did in v0 —
 * off → note-on (a fresh note of gate-step length: the single-click default),
 * note-on head → note removed (its orphan sustain markers, audio-dead in v1,
 * go with it), sustain marker → the covering note shortened to the gate plus
 * the sustains before `step` (v1's truncated run). `turnedOn` mirrors v0.
 */
export function togglePitchedNote(
  pattern: PitchedPattern,
  gateSteps: number,
  degree: number,
  step: number,
): { readonly pattern: PitchedPattern; readonly turnedOn: boolean } {
  const cell = pitchedCellAt(pattern, gateSteps, degree, step);
  if (cell === 0) {
    const note: Note = { degree, start: step, length: gateSteps };
    const notes = [...pattern.notes, note].sort(
      (a, b) => a.degree - b.degree || a.start - b.start,
    );
    return { pattern: { ...pattern, notes }, turnedOn: true };
  }
  const notes = pattern.notes
    .filter((note) => {
      if (note.degree !== degree) return true;
      if (cell === 1) return note.start !== step;
      // cell === 2: drop only the covering note (re-added shortened below).
      const sustain = Math.max(0, Math.round(note.length - gateSteps));
      return !(note.start < step && step <= note.start + sustain);
    })
    .map((note) => {
      if (note.degree !== degree || cell !== 2) return note;
      const sustain = Math.max(0, Math.round(note.length - gateSteps));
      const covering = note.start < step && step <= note.start + sustain;
      if (!covering) return note;
      // Run truncated at `step`: gate + the sustains that remain before it.
      return { ...note, length: gateSteps + (step - note.start - 1) };
    });
  return { pattern: { ...pattern, notes }, turnedOn: false };
}

/** Patterns per lane, keyed by lane id. */
export type LanePatterns = Readonly<Record<LaneId, readonly Pattern[]>>;

/** Per-lane linear chain of pattern ids (ids may repeat). */
export type SongChain = Readonly<Record<LaneId, readonly string[]>>;

/**
 * DES-6 named cue states: per-lane text labels on chain POSITIONS (parallel to
 * songChain — slot i of the chain may carry a section label like "VERSE"; a
 * repeat of the same pattern is a distinct slot, so the second A can be the
 * "DROP"). `null` = no cue anywhere (canonical empty form). Migration-safe:
 * the field is optional+nullable, so v1 docs written before DES-6 stay valid.
 */
export const CUE_MAX_CHARS = 12;
export type LaneCues = Readonly<Record<LaneId, readonly (string | null)[]>>;

// Empty-after-trim strings pass the SCHEMA and are canonicalized to null by
// validate.ts (keeps "clear label" writes single-path in the store).
const CueLabel = v.pipe(v.string(), v.trim(), v.maxLength(CUE_MAX_CHARS));

const ChainCuesSchema = v.nullable(
  v.strictObject({
    drums: v.array(v.nullable(CueLabel)),
    bass: v.array(v.nullable(CueLabel)),
    chords: v.array(v.nullable(CueLabel)),
    lead: v.array(v.nullable(CueLabel)),
  }),
);

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
  /** Optional per-slot section labels (DES-6); absent/null = no cues. */
  readonly chainCues?: LaneCues | null;
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
    // Optional (backward compatible): pre-DES-6 docs omit it entirely.
    chainCues: v.optional(ChainCuesSchema),
  }),
);

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

function emptyDrumSteps(bars: PatternBars): Record<DrumPiece, boolean[]> {
  const out = {} as Record<DrumPiece, boolean[]>;
  for (const piece of DRUM_PIECES)
    out[piece] = new Array(16 * bars).fill(false);
  return out;
}

function emptyPitchedPattern(
  id: string,
  name: string,
  bars: PatternBars,
  degrees: number[],
): PitchedPattern {
  return {
    kind: "pitched",
    id,
    name,
    bars,
    rowDegrees: degrees,
    notes: [],
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
      {
        id: "drums",
        kitId: "kit-default",
        gate: { unit: "steps", value: 1 },
        fxChain: [],
      },
      {
        id: "bass",
        presetId: "preset-bass-1",
        gate: { unit: "steps", value: 2 },
        fxChain: [],
      },
      {
        id: "chords",
        presetId: "preset-chords-1",
        gate: { unit: "steps", value: 4 },
        fxChain: [],
      },
      {
        id: "lead",
        presetId: "preset-lead-1",
        gate: { unit: "steps", value: 2 },
        fxChain: [],
      },
    ],
    patterns: {
      drums: [
        {
          kind: "drums",
          id: "drums-1",
          name: "A",
          bars: 1,
          steps: emptyDrumSteps(1),
        },
      ],
      bass: [emptyPitchedPattern("bass-1", "A", 1, [0, 1, 2, 3, 4, 5, 6])],
      chords: [emptyPitchedPattern("chords-1", "A", 1, [0, 1, 2, 3, 4, 5, 6])],
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
