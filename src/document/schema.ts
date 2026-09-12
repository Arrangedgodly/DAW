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
import { MAX_BPM, MIN_BPM, secondsPerStep } from "../audio/time";
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
 * SCHEMA v3 (SV-1, iteration 3 — the long-loop world, I3-d):
 * - The pattern-bars vocabulary widens from [1,2,4] to the powers-of-two
 *   picklist [1,2,4,8,16,32,64,128] (`PATTERN_BAR_VOCABULARY`). Purely
 *   additive: every v2 document validates unchanged.
 * - NOTE-BOUND LAW (the exact bound law, per the SC-1 header precedent):
 *   `Note.start ≤ 2047` and `Note.length ≤ 2048` bound notes to the full
 *   128-bar step space (2048 sixteenth steps); per-pattern placement is still
 *   bound SEMANTICALLY by the pattern's own width (`start < bars × 16`,
 *   validate.ts — the two-layer law: schema bounds the space, the pattern
 *   bounds the placement). `start + length` may overrun the pattern end
 *   exactly as v1 gate overhang did (loops wrap).
 * - NEW optional per-lane `octave` register transpose on PITCHED lanes only
 *   (i3-2; integer −3..+3, canonical-empty at 0 — omitted, the lane-mix
 *   law). Drums carry no octave: the drum voice model has no pitch
 *   resolution (`noteParamsFor` takes no midi). The absolute MIDI 0..127
 *   clamp is the CONSUMER's law (RC-1's OCT −/+ writes + compile-side
 *   clamping at degree/pitch limits) — the schema cannot know the preset's
 *   `pitchRange.octaveBase`, so it bounds only the offset domain.
 * - The persisted `transport.loopBars` field RETIRES (no UI writer ever
 *   existed). v3 documents must NOT carry it (strict). Through the compat
 *   window the engine derived the transport basis engine-side (the SV-1
 *   derivation, retired at LL-2 — see the retirement note below); LL-1/LL-2
 *   replace it with the two independent laws — grid extent = the edited
 *   pattern's real bars, playhead/one-shot basis = per-lane chain totals /
 *   one LCM cycle.
 * - Migration v2→v3 (migrate.ts) is lossless by construction: bars widening
 *   is a no-op (v2's [1,2,4] ⊂ the v3 vocabulary — permissive-widen, no
 *   rejection class) and the loopBars drop has a defined re-derive rule
 *   (the compat derivation). Goldens committed BEFORE any UI depends on v3.
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
export const SCHEMA_VERSION = 3;

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
export type DefaultLaneId = (typeof LANE_IDS)[number];
export const EXTRA_LANE_IDS = ["extra1", "extra2", "extra3", "extra4"] as const;
export const ALL_LANE_IDS = [...LANE_IDS, ...EXTRA_LANE_IDS] as const;
export type LaneId = (typeof ALL_LANE_IDS)[number];
export type LaneMap<T> = Record<DefaultLaneId, T> &
  Partial<Record<(typeof EXTRA_LANE_IDS)[number], T>>;
export function isDefaultLane(id: LaneId): id is DefaultLaneId {
  return (LANE_IDS as readonly string[]).includes(id);
}
export const LaneIdSchema = v.picklist(ALL_LANE_IDS);

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
  readonly metronome: boolean;
}
export const TransportSchema = v.strictObject({
  bpm: v.pipe(v.number(), v.minValue(MIN_BPM), v.maxValue(MAX_BPM)),
  swing: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  metronome: v.boolean(),
  // v3 (SV-1): `loopBars` RETIRED. A v3 document carrying it is rejected
  // (strict) — migrate v2→v3 drops it. LL-2 (landed): the engine basis is
  // the LCM of lane chain totals, derived engine-side (engineBridge →
  // Transport.setCycleSteps; per-lane sweeps on each lane's own total).
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
  /** LY-1 quadrant mix (optional, canonical-empty when default — see LaneMix). */
  readonly volume?: number;
  readonly mute?: boolean;
  readonly solo?: boolean;
}

export interface PitchedLane {
  readonly id: Exclude<LaneId, "drums">;
  readonly presetId: string;
  readonly gate: LaneGate;
  readonly fxChain: readonly FxDevice[];
  /** LY-1 quadrant mix (optional, canonical-empty when default — see LaneMix). */
  readonly volume?: number;
  readonly mute?: boolean;
  readonly solo?: boolean;
  /**
   * v3 (i3-2, SV-1): per-lane register transpose in octaves, integer
   * MIN_LANE_OCTAVE..MAX_LANE_OCTAVE. Canonical-empty at 0 (omitted — the
   * lane-mix law; every pre-v3 document stays byte-identical). PITCHED lanes
   * only: the drum voice model has no pitch resolution. The absolute MIDI
   * 0..127 clamp is the consumer's law (RC-1 writes/compiles clamped at
   * degree/pitch limits); the schema bounds the offset domain.
   */
  readonly octave?: number;
}

export type Lane = DrumsLane | PitchedLane;

/**
 * LY-1 lane mix (the chainCues precedent): optional additive fields, NO schema
 * version bump — docs written before the quadrant layout stay valid. Canonical
 * empty form OMITS all three (volume 1, mute false, solo false); the store's
 * mix action writes them only away from defaults so default documents stay
 * byte-stable (golden codec law).
 */
export interface LaneMix {
  /** Linear 0..1 gain multiplier (default 1). */
  readonly volume: number;
  readonly mute: boolean;
  readonly solo: boolean;
}

export const DEFAULT_LANE_MIX: LaneMix = {
  volume: 1,
  mute: false,
  solo: false,
};

/** Effective mix of a lane config: explicit values over the defaults. */
export function effectiveLaneMix(lane: Lane): LaneMix {
  return {
    volume: lane.volume ?? DEFAULT_LANE_MIX.volume,
    mute: lane.mute ?? DEFAULT_LANE_MIX.mute,
    solo: lane.solo ?? DEFAULT_LANE_MIX.solo,
  };
}

/**
 * The ONE effective-gain law of the lane mix (LY-1 live monitoring; HW-5
 * export — the coordinator resolution recorded at LY-1 verification): mute
 * silences the lane; if ANY lane is soloed, every non-solo lane silences too
 * (mute still wins on the solo lane itself — silence is silence); otherwise
 * the lane's linear volume applies. Pure and shared verbatim by the live
 * Session and the offline render (render.ts), so the exported WAV is exactly
 * what monitoring plays.
 */
export function laneMixGain(mixes: readonly LaneMix[], index: number): number {
  const anySolo = mixes.some((m) => m.solo);
  const mix = mixes[index] ?? DEFAULT_LANE_MIX;
  if (mix.mute) return 0;
  if (anySolo && !mix.solo) return 0;
  return mix.volume;
}

/**
 * Every lane's effective gain of a document, in LANE_IDS order — the render
 * path's mix vector (HW-5). A canonical-empty mix (all defaults) is all 1s,
 * so pre-mix documents render through unity gains and stay byte-stable.
 */
export function documentLaneMixGains(doc: ProjectDocument): number[] {
  const mixes = doc.lanes.map(effectiveLaneMix);
  return mixes.map((_, i) => laneMixGain(mixes, i));
}

/**
 * RETIRED at LL-2 (the boundary SV-1's comments named): the v3 compat
 * derivation `deriveLoopBarsCompat(doc)` = min(4, max pattern bars) bridged
 * the loopBars retirement through the SV-1→LL-2 window, reproducing v0.1
 * engine values byte-identically. LL-2 re-based the playhead/position/
 * one-shot basis to the LCM OF LANE CHAIN TOTALS (engineBridge →
 * Transport.setCycleSteps, consuming render.ts's computeLoopSteps — the
 * same LCM the export renders) with per-lane sweeps on each lane's OWN
 * chain total (song.ts laneCycleSteps). The derivation has NO consumers
 * left and is deleted; the historical record (divergence class, migration
 * re-derive rule) lives in the SV-1/LL-2 production-log entries and in
 * migrate.ts's drop note.
 */

const LaneCommon = {
  gate: LaneGateSchema,
  fxChain: v.pipe(v.array(FxDeviceSchema), v.maxLength(MAX_FX_PER_LANE)),
  volume: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  mute: v.optional(v.boolean()),
  solo: v.optional(v.boolean()),
};

/** v3 lane `octave` register-offset domain (i3-2; see PitchedLane.octave). */
export const MIN_LANE_OCTAVE = -3;
export const MAX_LANE_OCTAVE = 3;
export const LaneOctaveSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(MIN_LANE_OCTAVE),
  v.maxValue(MAX_LANE_OCTAVE),
);

export const LaneSchema = v.variant("id", [
  ...EXTRA_LANE_IDS.map((id) =>
    v.strictObject({
      id: v.literal(id),
      presetId: v.string(),
      octave: v.optional(LaneOctaveSchema),
      ...LaneCommon,
    }),
  ),
  v.strictObject({ id: v.literal("drums"), kitId: v.string(), ...LaneCommon }),
  v.strictObject({
    id: v.literal("bass"),
    presetId: v.string(),
    octave: v.optional(LaneOctaveSchema),
    ...LaneCommon,
  }),
  v.strictObject({
    id: v.literal("chords"),
    presetId: v.string(),
    octave: v.optional(LaneOctaveSchema),
    ...LaneCommon,
  }),
  v.strictObject({
    id: v.literal("lead"),
    presetId: v.string(),
    octave: v.optional(LaneOctaveSchema),
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
 * Longest note (v3, SV-1): the full 128-bar step space — one note may span
 * the entire widened pattern space (2048 steps; start ≤ 2047 + overhang law
 * below). v2's 128 bounded the worst 4-bar case (max steps-gate 64 + 63
 * sustains); v3 bounds it at the vocabulary ceiling instead. Per-pattern
 * placement stays the semantic layer's law (start < bars × 16, validate.ts).
 */
export const MAX_NOTE_LENGTH = 2048;

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
  v.minValue(-128),
  v.maxValue(128),
);
export const NoteSchema = v.strictObject({
  degree: NoteDegree,
  // v3 (SV-1): the start bound lifts to the 128-bar step space (2048 steps,
  // indices 0..2047). The two-layer law: this bounds the SPACE; the pattern's
  // own width (start < bars × 16) still binds placement semantically.
  start: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2047)),
  length: v.pipe(
    v.number(),
    v.minValue(MIN_NOTE_LENGTH),
    v.maxValue(MAX_NOTE_LENGTH),
  ),
});

/**
 * v3 (SV-1, I3-d): pattern length vocabulary — powers of two, 1..128 bars
 * (STEPS_PER_BAR = 16 ⇒ up to 2048 steps per pattern). Purely additive over
 * v2's [1,2,4]; the picklist IS the type (a resize may only walk this list).
 */
export const PATTERN_BAR_VOCABULARY = [1, 2, 4, 8, 16, 32, 64, 128] as const;
export type PatternBars = (typeof PATTERN_BAR_VOCABULARY)[number];
const PatternBarsSchema = v.picklist(PATTERN_BAR_VOCABULARY);

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
export type LanePatterns = Readonly<LaneMap<readonly Pattern[]>>;

/** Per-lane linear chain of pattern ids (ids may repeat). */
export type SongChain = Readonly<LaneMap<readonly string[]>>;

/**
 * DES-6 named cue states: per-lane text labels on chain POSITIONS (parallel to
 * songChain — slot i of the chain may carry a section label like "VERSE"; a
 * repeat of the same pattern is a distinct slot, so the second A can be the
 * "DROP"). `null` = no cue anywhere (canonical empty form). Migration-safe:
 * the field is optional+nullable, so v1 docs written before DES-6 stay valid.
 */
export const CUE_MAX_CHARS = 12;
export type LaneCues = Readonly<LaneMap<readonly (string | null)[]>>;

// Empty-after-trim strings pass the SCHEMA and are canonicalized to null by
// validate.ts (keeps "clear label" writes single-path in the store).
const CueLabel = v.pipe(v.string(), v.trim(), v.maxLength(CUE_MAX_CHARS));

const ChainCuesSchema = v.nullable(
  v.strictObject({
    drums: v.array(v.nullable(CueLabel)),
    bass: v.array(v.nullable(CueLabel)),
    chords: v.array(v.nullable(CueLabel)),
    lead: v.array(v.nullable(CueLabel)),
    extra1: v.optional(v.array(v.nullable(CueLabel))),
    extra2: v.optional(v.array(v.nullable(CueLabel))),
    extra3: v.optional(v.array(v.nullable(CueLabel))),
    extra4: v.optional(v.array(v.nullable(CueLabel))),
  }),
);

/**
 * Slot follow modes (2026-09-11, user call): what a chain POSITION does when
 * its pattern ends — "loop" (⟲) replays it until another slot is cued,
 * "next" (→) plays it once and moves to the next slot (the last slot wraps to
 * the first). Parallel to songChain like chainCues. Canonical empty form =
 * the key ABSENT (every slot "next" — the pre-2026-09-11 behavior), so
 * existing documents stay byte-identical.
 */
export type ChainSlotMode = "loop" | "next";
export type LaneChainModes = Readonly<LaneMap<readonly ChainSlotMode[]>>;

const ChainSlotModeSchema = v.picklist(["loop", "next"]);

const ChainModesSchema = v.nullable(
  v.strictObject({
    drums: v.array(ChainSlotModeSchema),
    bass: v.array(ChainSlotModeSchema),
    chords: v.array(ChainSlotModeSchema),
    lead: v.array(ChainSlotModeSchema),
    extra1: v.optional(v.array(ChainSlotModeSchema)),
    extra2: v.optional(v.array(ChainSlotModeSchema)),
    extra3: v.optional(v.array(ChainSlotModeSchema)),
    extra4: v.optional(v.array(ChainSlotModeSchema)),
  }),
);

// ---------------------------------------------------------------------------
// Sample-voice provenance (PS-3, RES-10 committed fields)
// ---------------------------------------------------------------------------

/**
 * Asset-id grammar for committed sample content (PS-3): dotted lowercase
 * segments, e.g. "drums.808.kick" / "voice.bass.lowtone" — every committed
 * CONTENT_ASSETS id (PS-2) matches it. The preset field `sampleRef`
 * (src/audio/presets.ts) and the `sampleProvenance` keys below share this
 * grammar, defined HERE so the audio preset layer and the document layer
 * cannot drift apart (Mr. Fantastic connective tissue; presets.ts imports
 * it, keeping the document layer free of any content/asset import — the
 * lazy loader stays out of the app's initial JS graph, PS-2 law).
 *
 * Ids (not vite-hashed URLs) are the stable cross-build reference: the app
 * resolves id → same-origin URL through the content manifest at
 * selection/play time (PS-4), while documents carry only the id.
 */
export const SAMPLE_REF_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
export const SampleRefSchema = v.pipe(
  v.string(),
  v.minLength(3),
  v.maxLength(64),
  v.regex(SAMPLE_REF_PATTERN),
);

/** MIDI note number 0..127 (PS-3 `rootMidi`; integer by construction). */
export const MidiNoteSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(127),
);

/**
 * Provenance echo limits, sized to the committed manifest (PS-2: longest
 * license "CC0", longest author 27 chars, longest sourceUrl 161 chars) with
 * headroom for future CC0/MIT-class rows — bounded so a hostile document
 * cannot stuff megabytes of "provenance" past the codec's 4 MB text cap
 * (SV-1's measured raise; CA-2 defense in depth — the codec cap bounds the
 * TOTAL, these bound per-entry strings).
 */
export const PROVENANCE_LICENSE_MAX = 32;
export const PROVENANCE_SOURCE_MAX = 256;
export const PROVENANCE_AUTHOR_MAX = 64;

/**
 * A real project can reference at most a handful of assets (3 pitched lanes
 * × 1 preset + 1 drum kit of 6–9 pieces ≈ 12; stale entries are pruned by
 * the writer when a lane moves off a sample voice). 64 bounds a hostile map
 * while never constraining a real one.
 */
export const MAX_SAMPLE_PROVENANCE_ENTRIES = 64;

/** One sample asset's license echo (mirrors a CONTENT_ASSETS manifest row). */
export interface SampleProvenanceEntry {
  /** License short name as recorded in the content manifest (e.g. "CC0"). */
  readonly license: string;
  /** Where the asset came from (manifest sourceUrl echo; https only). */
  readonly sourceUrl: string;
  /** Attribution line (manifest author echo). */
  readonly author: string;
}

/**
 * PS-3 in-project provenance: asset id (`sampleRef`) → license echo. Recorded
 * by the store when a lane selects a sample-backed voice (the echo is copied
 * from the content manifest row at selection time); pruned when the last lane
 * using an asset moves off it. Exported/shared projects stay self-describing
 * — a recipient sees exactly which sample assets the song uses and under
 * which license, without our manifest.
 */
export type SampleProvenance = Readonly<Record<string, SampleProvenanceEntry>>;

export const SampleProvenanceEntrySchema = v.strictObject({
  license: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(PROVENANCE_LICENSE_MAX),
  ),
  sourceUrl: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(PROVENANCE_SOURCE_MAX),
    v.regex(/^https:\/\/\S+$/, "must be an https URL"),
  ),
  author: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(PROVENANCE_AUTHOR_MAX),
  ),
});

export const SampleProvenanceSchema = v.pipe(
  v.record(SampleRefSchema, SampleProvenanceEntrySchema),
  v.check(
    (map) => Object.keys(map).length <= MAX_SAMPLE_PROVENANCE_ENTRIES,
    `more than ${MAX_SAMPLE_PROVENANCE_ENTRIES} sample-provenance entries`,
  ),
);

const PatternsSchema = v.strictObject({
  drums: v.array(PatternSchema),
  bass: v.array(PatternSchema),
  chords: v.array(PatternSchema),
  lead: v.array(PatternSchema),
  extra1: v.optional(v.array(PatternSchema)),
  extra2: v.optional(v.array(PatternSchema)),
  extra3: v.optional(v.array(PatternSchema)),
  extra4: v.optional(v.array(PatternSchema)),
});

const SongChainSchema = v.strictObject({
  drums: v.array(v.string()),
  bass: v.array(v.string()),
  chords: v.array(v.string()),
  lead: v.array(v.string()),
  extra1: v.optional(v.array(v.string())),
  extra2: v.optional(v.array(v.string())),
  extra3: v.optional(v.array(v.string())),
  extra4: v.optional(v.array(v.string())),
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
  /** Optional per-slot ⟲/→ follow modes; absent = every slot "next". */
  readonly chainModes?: LaneChainModes | null;
  /**
   * PS-3 sample-voice provenance; absent (canonical-empty) when no lane uses
   * a sample-backed voice — synth-only projects, including every v2 document
   * written before PS-3, stay byte-identical (purely additive field, no
   * migration, no codec bump).
   */
  readonly sampleProvenance?: SampleProvenance;
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
        extra1: v.optional(v.optional(v.nullable(ScaleConfigSchema))),
        extra2: v.optional(v.optional(v.nullable(ScaleConfigSchema))),
        extra3: v.optional(v.optional(v.nullable(ScaleConfigSchema))),
        extra4: v.optional(v.optional(v.nullable(ScaleConfigSchema))),
      }),
    ),
    lanes: v.pipe(v.array(LaneSchema), v.minLength(4), v.maxLength(8)),
    patterns: PatternsSchema,
    songChain: SongChainSchema,
    // Optional (backward compatible): pre-DES-6 docs omit it entirely.
    chainCues: v.optional(ChainCuesSchema),
    // Optional (backward compatible): docs without ⟲ slots omit it entirely.
    chainModes: v.optional(ChainModesSchema),
    // Optional (backward compatible): pre-PS-3 docs omit it entirely.
    sampleProvenance: v.optional(SampleProvenanceSchema),
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
    // v3 (SV-1): no loopBars — the IM-6 "agrees with the grid extent"
    // invariant is replaced by two independent laws: grid extent follows the
    // edited pattern's real bars (LL-1) and the playhead/one-shot basis
    // follows per-lane chain totals / one LCM cycle (LL-2). The default's
    // four 1-bar chains give LCM 16 steps = 1 bar — v0.1 behavior exactly.
    transport: { bpm: 120, swing: 0, metronome: false },
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
