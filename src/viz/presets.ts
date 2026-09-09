/**
 * VIZ preset/node data model + seeded arrangement generator (VZ-MF-1, pure —
 * no DOM, no store, no schema import).
 *
 * House Lights data foundation: a preset is a RIG of hung effect nodes and a
 * reroll re-deals the current arrangement from a fresh seed. This module owns
 * only the SHAPE — the node vocabulary (the closed kind list, which fields
 * each kind carries) is VZ-MF-2's production decision, so every randomizable
 * field is a generic spec (numeric range or string enum), never a per-kind
 * class. The vocabulary module can layer kinds + field tables on top without
 * this file changing.
 *
 * Determinism law: every random draw flows through the shared `xorshift32`
 * (src/audio/fx.ts) — `Math.random` is banned. `generateArrangement`
 * consumes one seeded stream in a FIXED order (blueprint by blueprint:
 * count first, then per dealt node: placement fields, motion fields, param
 * fields, each in listed order), so an identical (preset, seed) pair always
 * produces a deep-equal arrangement, and the persisted envelope
 * `{ version: 1, presetId, seed }` is sufficient to re-deal the exact rig
 * later (VZ-IM-3 persists exactly that shape).
 *
 * Everything here is plain JSON data — no functions, classes, Maps or Sets —
 * so persistence could adopt it later without any document/schema change
 * (two-tier state law: module state, never docStore/schema v3).
 */

import { noise01, xorshift32 } from "../audio/fx";

// ---------------------------------------------------------------------------
// Field specs (generic: the vocabulary decides keys, the model decides laws)
// ---------------------------------------------------------------------------

/** A randomizable numeric field: resolved uniform in [min, max]. */
export interface VizRangeSpec {
  readonly type: "range";
  readonly min: number;
  readonly max: number;
  /**
   * Optional quantization: the resolved value is rounded onto a multiple of
   * `step`, still clamped inside [min, max]. Omit for continuous fields.
   */
  readonly step?: number;
}

/** A randomizable discrete field: resolved to one of `values`, uniformly. */
export interface VizEnumSpec {
  readonly type: "enum";
  readonly values: readonly string[];
}

export type VizFieldSpec = VizRangeSpec | VizEnumSpec;

/** One named randomizable field of a blueprint. */
export interface VizField {
  readonly key: string;
  readonly spec: VizFieldSpec;
}

/** A resolved field value: number for ranges, string for enums. */
export type VizFieldValue = number | string;

// ---------------------------------------------------------------------------
// Preset → blueprint (pure data; VZ-MF-2 fills the vocabulary + library)
// ---------------------------------------------------------------------------

/** Node kind — opaque here; VZ-MF-2's vocabulary owns the closed set. */
export type VizNodeKind = string;

/** How many concrete nodes one blueprint deals (resolved from the seed). */
export interface VizCountSpec {
  readonly min: number;
  readonly max: number;
}

export interface VizNodeBlueprint {
  readonly kind: VizNodeKind;
  /**
   * Nodes dealt per reroll (default 1): resolved as an integer from the
   * seed, clamped to [1, MAX_BLUEPRINT_NODES].
   */
  readonly count?: VizCountSpec;
  /** Where the node hangs (e.g. x/y in normalized stage units). */
  readonly placement?: readonly VizField[];
  /** How it moves when lit (speeds, directions, transport bindings). */
  readonly motion?: readonly VizField[];
  /** Per-kind behavior knobs (sizes, envelope shapes, spread...). */
  readonly params?: readonly VizField[];
}

export interface VizPreset {
  readonly id: string;
  readonly name: string;
  readonly nodeBlueprints: readonly VizNodeBlueprint[];
}

// ---------------------------------------------------------------------------
// Arrangement (resolved nodes — plain JSON, the render-side contract)
// ---------------------------------------------------------------------------

export interface VizNode {
  /** Deterministic identity: stable for a given (preset, seed, slot). */
  readonly id: string;
  readonly kind: VizNodeKind;
  readonly placement: Readonly<Record<string, VizFieldValue>>;
  readonly motion: Readonly<Record<string, VizFieldValue>>;
  readonly params: Readonly<Record<string, VizFieldValue>>;
}

export interface VizArrangement {
  readonly presetId: string;
  /** The seed this rig was dealt from (normalized u32). */
  readonly seed: number;
  readonly nodes: readonly VizNode[];
}

/** Envelope version — bump only on a breaking persistence-shape change. */
export const VIZ_ARRANGEMENT_VERSION = 1;

/**
 * Generator-owned sanity clamp — NOT the live-node budget (that is VZ-HU-3's
 * render-time policy): a single blueprint can never deal more nodes than
 * this, and every resolved range value stays inside its declared [min, max].
 */
export const MAX_BLUEPRINT_NODES = 256;

/**
 * The persistence envelope: `{ version, presetId, seed }` is everything
 * needed to re-deal this exact arrangement (nodes are never persisted —
 * they are recomputed from the preset + seed).
 */
export interface VizArrangementEnvelope {
  readonly version: 1;
  readonly presetId: string;
  readonly seed: number;
}

/** Build the persistence envelope for a dealt arrangement. */
export function arrangementEnvelope(
  arrangement: VizArrangement,
): VizArrangementEnvelope {
  return {
    version: VIZ_ARRANGEMENT_VERSION,
    presetId: arrangement.presetId,
    seed: arrangement.seed,
  };
}

// ---------------------------------------------------------------------------
// Resolution (seeded, pure)
// ---------------------------------------------------------------------------

/** Normalize degenerate range bounds: non-finite → 0, reversed → swapped. */
function rangeBounds(spec: VizRangeSpec): readonly [number, number] {
  let min = Number.isFinite(spec.min) ? spec.min : 0;
  let max = Number.isFinite(spec.max) ? spec.max : 0;
  if (min > max) [min, max] = [max, min];
  return [min, max];
}

/** Resolve a range field: uniform draw, optional step quantize, clamped. */
function resolveRange(spec: VizRangeSpec, u: number): number {
  const [min, max] = rangeBounds(spec);
  const step =
    spec.step !== undefined && spec.step > 0 && Number.isFinite(spec.step)
      ? spec.step
      : null;
  let value = min + u * (max - min);
  if (step) value = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, value));
}

/** Resolve an enum field: uniform pick ("" for a degenerate empty list). */
function resolveEnum(spec: VizEnumSpec, u: number): string {
  const n = spec.values.length;
  if (n === 0) return "";
  const index = Math.min(n - 1, Math.floor(u * n));
  return spec.values[index] ?? "";
}

/** Resolve a blueprint's node count: integer in [1, MAX_BLUEPRINT_NODES]. */
function resolveCount(spec: VizCountSpec | undefined, u: number): number {
  if (!spec) return 1;
  const min = Number.isFinite(spec.min) ? spec.min : 1;
  const max = Number.isFinite(spec.max) ? spec.max : min;
  const value = Math.round(min + u * (Math.max(min, max) - min));
  return Math.min(MAX_BLUEPRINT_NODES, Math.max(1, value));
}

function resolveFields(
  fields: readonly VizField[] | undefined,
  rand: () => number,
): Record<string, VizFieldValue> {
  const out: Record<string, VizFieldValue> = {};
  for (const field of fields ?? []) {
    out[field.key] =
      field.spec.type === "range"
        ? resolveRange(field.spec, noise01(rand))
        : resolveEnum(field.spec, noise01(rand));
  }
  return out;
}

/**
 * Deal a preset's rig from a seed. Draw order is the frozen determinism
 * contract: for each blueprint in listed order — one count draw, then per
 * dealt node its placement fields, motion fields and param fields in listed
 * order, one draw each. Duplicate keys inside a group keep the last value.
 */
export function generateArrangement(
  preset: VizPreset,
  seed: number,
): VizArrangement {
  const normalized = seed >>> 0;
  const rand = xorshift32(normalized);
  const nodes: VizNode[] = [];
  preset.nodeBlueprints.forEach((blueprint, blueprintIndex) => {
    const count = resolveCount(blueprint.count, noise01(rand));
    for (let i = 0; i < count; i++) {
      nodes.push({
        id: `${preset.id}#${blueprintIndex}.${i}`,
        kind: blueprint.kind,
        placement: resolveFields(blueprint.placement, rand),
        motion: resolveFields(blueprint.motion, rand),
        params: resolveFields(blueprint.params, rand),
      });
    }
  });
  return { presetId: preset.id, seed: normalized, nodes };
}

// ---------------------------------------------------------------------------
// VZ-MF-2: the built-in preset library (pure data — the kinds' semantics live
// in ./vocabulary.ts, the recorded production decision)
// ---------------------------------------------------------------------------

/**
 * Authoring helpers for handcrafted library data. A CONSTANT field (min ===
 * max, or a single-value enum) resolves identically for every seed — the
 * hand's fixed choice; a WIDE spec is the tolerance a reroll re-deals.
 * Narrow position bands + fixed behavior constants = curated feel, reroll
 * re-HANGS the rig (the House Lights joy), never re-designs it.
 */
const at = (value: number): VizRangeSpec => ({
  type: "range",
  min: value,
  max: value,
});
const roll = (min: number, max: number, step?: number): VizRangeSpec =>
  step === undefined
    ? { type: "range", min, max }
    : { type: "range", min, max, step };
const oneOf = (value: string): VizEnumSpec => ({
  type: "enum",
  values: [value],
});
/** Shared placement trio, in the vocabulary's documented field order. */
const spot = (
  x: readonly [number, number],
  y: readonly [number, number],
  lane: string,
): readonly VizField[] => [
  { key: "x", spec: roll(x[0], x[1]) },
  { key: "y", spec: roll(y[0], y[1]) },
  { key: "lane", spec: oneOf(lane) },
];

/**
 * The library. ARRAY ORDER IS THE CYCLE ORDER (prev/next wrap, VZ-HU-2/DD-1).
 * Ten presets, every one distinct in feel; the first three are the VZ-IM-5
 * canary set (one anchor light, one burst grammar, one transport-bound motion
 * path — the draw-path families in miniature).
 *
 * 2026-09-05 `bolder` recalibration (critique P1 "show never reaches its
 * recorded full phase"): the sparse single-node rigs doubled up —
 * first-light (the DEFAULT the demo shows) now hangs TWO blooms per lane
 * with fuller radii and paired x-bands kept apart (the lane-anchor hue
 * identity law), and halo-rings/lighthouse pair their lone rings — so a
 * dense four-lane groove HOLDS the stage at full phase instead of
 * flickering four anchors. Placement bands stay narrow (curated feel);
 * positions still mid-field (full-bleed widening is the layout entry's
 * lever, deliberately not taken here). Determinism law unchanged: the
 * same (preset, seed) still re-deals the identical rig — the library's
 * canonical-seed digest pins are DATA pins and were updated deliberately
 * per their own test's instruction ("data changed ⇒ new pin").
 *
 * 2026-09-05 `layout` widening (critique P2 "composition under-uses the
 * full bleed — mid-band clusters, dead margins"): the placement blueprints
 * now hang rigs across the WHOLE stage — corner quadrants (first-light,
 * spark-fan), true edges (comet-run traffic rails, halo-rings bass/chords
 * in opposite corners, kit-fires pops full-bleed), vertical extremes with
 * high-hung rigs (river-glass top stratum at y 0.08, slow-tide lead swell
 * high, lighthouse spark top-right) — while orrery KEEPS the center as
 * the deliberate corners-vs-center contrast the library plays against.
 * Bands stay narrow (curated feel — reroll re-hangs within a region);
 * anchor centers keep a clear channel above the bottom-anchored remote
 * (y ≤ 0.88). Optical correction: orrery's revolutions sit at y 0.47
 * (stage-center reads low under the remote). Determinism law unchanged;
 * digest pins updated deliberately again ("data changed ⇒ new pin").
 */
export const VIZ_PRESETS: readonly VizPreset[] = [
  {
    // The hello-world rig: one balanced bloom per lane, quadrants of the
    // stage, calm mid-length envelopes. Canary #1 (the bloom draw path).
    id: "first-light",
    name: "First Light",
    nodeBlueprints: [
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.07, 0.28], [0.1, 0.3], "drums"),
        params: [
          { key: "radius", spec: at(0.16) },
          { key: "halo", spec: at(0.4) },
          { key: "decay", spec: at(0.22) },
          { key: "pitchSpread", spec: at(0.1) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.72, 0.93], [0.08, 0.28], "bass"),
        params: [
          { key: "radius", spec: at(0.19) },
          { key: "halo", spec: at(0.45) },
          { key: "decay", spec: at(0.26) },
          { key: "pitchSpread", spec: at(0.12) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.07, 0.28], [0.6, 0.82], "chords"),
        params: [
          { key: "radius", spec: at(0.2) },
          { key: "halo", spec: at(0.5) },
          { key: "decay", spec: at(0.3) },
          { key: "pitchSpread", spec: at(0.14) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.72, 0.93], [0.62, 0.84], "lead"),
        params: [
          { key: "radius", spec: at(0.15) },
          { key: "halo", spec: at(0.4) },
          { key: "decay", spec: at(0.24) },
          { key: "pitchSpread", spec: at(0.1) },
        ],
      },
    ],
  },
  {
    // Pure pyro: one spark fan per lane, aimed at the stage's four winds.
    // Canary #2 (the burst grammar + the shards cost multiplier).
    id: "spark-fan",
    name: "Spark Fan",
    nodeBlueprints: [
      {
        kind: "spark",
        placement: spot([0.08, 0.22], [0.08, 0.24], "drums"),
        params: [
          { key: "shards", spec: at(5) },
          { key: "spread", spec: at(50) },
          { key: "aim", spec: at(0) },
          { key: "pitchSweep", spec: at(90) },
          { key: "reach", spec: at(0.22) },
          { key: "decay", spec: at(0.16) },
        ],
      },
      {
        kind: "spark",
        placement: spot([0.78, 0.92], [0.6, 0.76], "bass"),
        params: [
          { key: "shards", spec: at(4) },
          { key: "spread", spec: at(40) },
          { key: "aim", spec: at(180) },
          { key: "pitchSweep", spec: at(60) },
          { key: "reach", spec: at(0.2) },
          { key: "decay", spec: at(0.2) },
        ],
      },
      {
        kind: "spark",
        placement: spot([0.08, 0.22], [0.6, 0.76], "chords"),
        params: [
          { key: "shards", spec: at(4) },
          { key: "spread", spec: at(70) },
          { key: "aim", spec: at(90) },
          { key: "pitchSweep", spec: at(120) },
          { key: "reach", spec: at(0.18) },
          { key: "decay", spec: at(0.24) },
        ],
      },
      {
        kind: "spark",
        placement: spot([0.78, 0.92], [0.08, 0.24], "lead"),
        params: [
          { key: "shards", spec: at(4) },
          { key: "spread", spec: at(55) },
          { key: "aim", spec: at(270) },
          { key: "pitchSweep", spec: at(90) },
          { key: "reach", spec: at(0.24) },
          { key: "decay", spec: at(0.18) },
        ],
      },
    ],
  },
  {
    // The absorbed Orbit Clockwork family: four concentric revolutions on
    // one center, inner fast / outer slow, chords retrograde. Reroll re-
    // phases the clockwork. Canary #3 (transport-bound motion).
    id: "orrery",
    name: "Orrery",
    nodeBlueprints: [
      {
        kind: "orbit",
        placement: spot([0.5, 0.5], [0.47, 0.47], "drums"),
        motion: [
          { key: "phase", spec: roll(0, 1) },
          { key: "rate", spec: at(0.25) },
        ],
        params: [
          { key: "bodies", spec: at(2) },
          { key: "radius", spec: at(0.12) },
          { key: "size", spec: roll(0.04, 0.06) },
          { key: "decay", spec: at(0.26) },
        ],
      },
      {
        kind: "orbit",
        placement: spot([0.5, 0.5], [0.47, 0.47], "bass"),
        motion: [
          { key: "phase", spec: roll(0, 1) },
          { key: "rate", spec: at(0.125) },
        ],
        params: [
          { key: "bodies", spec: at(1) },
          { key: "radius", spec: at(0.18) },
          { key: "size", spec: roll(0.05, 0.07) },
          { key: "decay", spec: at(0.3) },
        ],
      },
      {
        kind: "orbit",
        placement: spot([0.5, 0.5], [0.47, 0.47], "chords"),
        motion: [
          { key: "phase", spec: roll(0, 1) },
          { key: "rate", spec: at(-0.125) },
        ],
        params: [
          { key: "bodies", spec: at(2) },
          { key: "radius", spec: at(0.24) },
          { key: "size", spec: roll(0.04, 0.06) },
          { key: "decay", spec: at(0.32) },
        ],
      },
      {
        kind: "orbit",
        placement: spot([0.5, 0.5], [0.47, 0.47], "lead"),
        motion: [
          { key: "phase", spec: roll(0, 1) },
          { key: "rate", spec: at(0.0625) },
        ],
        params: [
          { key: "bodies", spec: at(1) },
          { key: "radius", spec: at(0.3) },
          { key: "size", spec: roll(0.05, 0.07) },
          { key: "decay", spec: at(0.28) },
        ],
      },
    ],
  },
  {
    // The absorbed Lane Rivers discipline: four stacked glass bands, one per
    // lane, gently flowing downstream at their own speeds.
    id: "river-glass",
    name: "River Glass",
    nodeBlueprints: [
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.8, 0.88], "drums"),
        motion: [{ key: "flow", spec: at(0.02) }],
        params: [
          { key: "angle", spec: at(90) },
          { key: "length", spec: at(0.9) },
          { key: "width", spec: at(0.045) },
          { key: "decay", spec: at(0.22) },
        ],
      },
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.58, 0.68], "bass"),
        motion: [{ key: "flow", spec: at(0.015) }],
        params: [
          { key: "angle", spec: at(90) },
          { key: "length", spec: at(0.8) },
          { key: "width", spec: at(0.05) },
          { key: "decay", spec: at(0.26) },
        ],
      },
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.08, 0.18], "chords"),
        motion: [{ key: "flow", spec: at(0.03) }],
        params: [
          { key: "angle", spec: at(78) },
          { key: "length", spec: at(0.85) },
          { key: "width", spec: at(0.04) },
          { key: "decay", spec: at(0.3) },
        ],
      },
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.36, 0.5], "lead"),
        motion: [{ key: "flow", spec: at(0.04) }],
        params: [
          { key: "angle", spec: at(102) },
          { key: "length", spec: at(0.7) },
          { key: "width", spec: at(0.035) },
          { key: "decay", spec: at(0.24) },
        ],
      },
    ],
  },
  {
    // Rings: drums throw tight fast halos center-stage, bass breathes one
    // big slow ring, chords stack two, lead answers off to the corner.
    id: "halo-rings",
    name: "Halo Rings",
    nodeBlueprints: [
      {
        kind: "ripple",
        count: { min: 2, max: 2 },
        placement: spot([0.34, 0.62], [0.3, 0.66], "drums"),
        params: [
          { key: "r0min", spec: at(0.02) },
          { key: "r0max", spec: at(0.05) },
          { key: "rEnd", spec: at(0.14) },
          { key: "thickness", spec: at(0.012) },
          { key: "decay", spec: at(0.14) },
        ],
      },
      {
        kind: "ripple",
        count: { min: 2, max: 2 },
        placement: spot([0.05, 0.22], [0.6, 0.84], "bass"),
        params: [
          { key: "r0min", spec: at(0.06) },
          { key: "r0max", spec: at(0.12) },
          { key: "rEnd", spec: at(0.3) },
          { key: "thickness", spec: at(0.016) },
          { key: "decay", spec: at(0.4) },
        ],
      },
      {
        kind: "ripple",
        count: { min: 2, max: 2 },
        placement: spot([0.78, 0.95], [0.16, 0.42], "chords"),
        params: [
          { key: "r0min", spec: at(0.03) },
          { key: "r0max", spec: at(0.08) },
          { key: "rEnd", spec: at(0.2) },
          { key: "thickness", spec: at(0.012) },
          { key: "decay", spec: at(0.32) },
        ],
      },
      {
        kind: "ripple",
        count: { min: 2, max: 2 },
        placement: spot([0.62, 0.88], [0.58, 0.8], "lead"),
        params: [
          { key: "r0min", spec: at(0.04) },
          { key: "r0max", spec: at(0.1) },
          { key: "rEnd", spec: at(0.24) },
          { key: "thickness", spec: at(0.014) },
          { key: "decay", spec: at(0.26) },
        ],
      },
    ],
  },
  {
    // Comet traffic: four any-lane spans crossing the stage — right, left,
    // up, down; every lane's hits launch comets from their pitch position.
    id: "comet-run",
    name: "Comet Run",
    nodeBlueprints: [
      {
        kind: "streak",
        placement: spot([0.05, 0.18], [0.25, 0.75], "any"),
        params: [
          { key: "angle", spec: at(90) },
          { key: "length", spec: at(0.9) },
          { key: "width", spec: at(0.02) },
          { key: "decay", spec: at(0.24) },
        ],
      },
      {
        kind: "streak",
        placement: spot([0.82, 0.95], [0.25, 0.75], "any"),
        params: [
          { key: "angle", spec: at(270) },
          { key: "length", spec: at(0.9) },
          { key: "width", spec: at(0.02) },
          { key: "decay", spec: at(0.2) },
        ],
      },
      {
        kind: "streak",
        placement: spot([0.2, 0.8], [0.72, 0.86], "any"),
        params: [
          { key: "angle", spec: at(0) },
          { key: "length", spec: at(0.7) },
          { key: "width", spec: at(0.018) },
          { key: "decay", spec: at(0.18) },
        ],
      },
      {
        kind: "streak",
        placement: spot([0.2, 0.8], [0.08, 0.22], "any"),
        params: [
          { key: "angle", spec: at(180) },
          { key: "length", spec: at(0.7) },
          { key: "width", spec: at(0.018) },
          { key: "decay", spec: at(0.22) },
        ],
      },
    ],
  },
  {
    // Ambient strata: two wide soft washes per lane stacked as horizontal
    // floors (drums lowest, lead highest) + two small any-lane accents that
    // pop bright and die fast against the long wash.
    id: "wash-field",
    name: "Wash Field",
    nodeBlueprints: [
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.05, 0.95], [0.74, 0.9], "drums"),
        params: [
          { key: "radius", spec: at(0.2) },
          { key: "halo", spec: at(0.8) },
          { key: "decay", spec: at(0.36) },
          { key: "pitchSpread", spec: at(0.12) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.05, 0.95], [0.55, 0.72], "bass"),
        params: [
          { key: "radius", spec: at(0.23) },
          { key: "halo", spec: at(0.85) },
          { key: "decay", spec: at(0.4) },
          { key: "pitchSpread", spec: at(0.14) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.05, 0.95], [0.28, 0.52], "chords"),
        params: [
          { key: "radius", spec: at(0.18) },
          { key: "halo", spec: at(0.75) },
          { key: "decay", spec: at(0.34) },
          { key: "pitchSpread", spec: at(0.12) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.05, 0.95], [0.08, 0.3], "lead"),
        params: [
          { key: "radius", spec: at(0.15) },
          { key: "halo", spec: at(0.7) },
          { key: "decay", spec: at(0.3) },
          { key: "pitchSpread", spec: at(0.1) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 2, max: 2 },
        placement: spot([0.06, 0.94], [0.08, 0.9], "any"),
        params: [
          { key: "radius", spec: at(0.08) },
          { key: "halo", spec: at(0.5) },
          { key: "decay", spec: at(0.12) },
          { key: "pitchSpread", spec: at(0.05) },
        ],
      },
    ],
  },
  {
    // The sampler rig: four kinds, one per lane — a sweeping beacon ring
    // (drums), a slow central revolution (bass), a wide flowing river
    // (chords), a fountaining fan (lead).
    id: "lighthouse",
    name: "Lighthouse",
    nodeBlueprints: [
      {
        kind: "ripple",
        count: { min: 2, max: 2 },
        placement: spot([0.12, 0.3], [0.35, 0.62], "drums"),
        params: [
          { key: "r0min", spec: at(0.05) },
          { key: "r0max", spec: at(0.1) },
          { key: "rEnd", spec: at(0.3) },
          { key: "thickness", spec: at(0.015) },
          { key: "decay", spec: at(0.38) },
        ],
      },
      {
        kind: "orbit",
        placement: spot([0.46, 0.54], [0.46, 0.54], "bass"),
        motion: [
          { key: "phase", spec: roll(0, 1) },
          { key: "rate", spec: at(0.125) },
        ],
        params: [
          { key: "bodies", spec: at(1) },
          { key: "radius", spec: at(0.22) },
          { key: "size", spec: at(0.06) },
          { key: "decay", spec: at(0.3) },
        ],
      },
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.48, 0.6], "chords"),
        motion: [{ key: "flow", spec: at(0.02) }],
        params: [
          { key: "angle", spec: at(90) },
          { key: "length", spec: at(0.95) },
          { key: "width", spec: at(0.055) },
          { key: "decay", spec: at(0.3) },
        ],
      },
      {
        kind: "spark",
        placement: spot([0.8, 0.94], [0.08, 0.22], "lead"),
        params: [
          { key: "shards", spec: at(4) },
          { key: "spread", spec: at(55) },
          { key: "aim", spec: at(0) },
          { key: "pitchSweep", spec: at(120) },
          { key: "reach", spec: at(0.22) },
          { key: "decay", spec: at(0.2) },
        ],
      },
    ],
  },
  {
    // The heavy calm: everything at the 0.4 s ceiling with near-still flow —
    // two slow tide rings, two long rivers, one vast swell for the lead.
    id: "slow-tide",
    name: "Slow Tide",
    nodeBlueprints: [
      {
        kind: "ripple",
        count: { min: 2, max: 2 },
        placement: spot([0.06, 0.94], [0.6, 0.88], "drums"),
        params: [
          { key: "r0min", spec: at(0.04) },
          { key: "r0max", spec: at(0.09) },
          { key: "rEnd", spec: at(0.26) },
          { key: "thickness", spec: at(0.014) },
          { key: "decay", spec: at(0.4) },
        ],
      },
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.62, 0.74], "bass"),
        motion: [{ key: "flow", spec: at(0.008) }],
        params: [
          { key: "angle", spec: at(90) },
          { key: "length", spec: at(0.9) },
          { key: "width", spec: at(0.07) },
          { key: "decay", spec: at(0.4) },
        ],
      },
      {
        kind: "river",
        placement: spot([0.5, 0.5], [0.24, 0.36], "chords"),
        motion: [{ key: "flow", spec: at(0.012) }],
        params: [
          { key: "angle", spec: at(90) },
          { key: "length", spec: at(0.85) },
          { key: "width", spec: at(0.06) },
          { key: "decay", spec: at(0.4) },
        ],
      },
      {
        kind: "bloom",
        placement: spot([0.2, 0.8], [0.08, 0.24], "lead"),
        params: [
          { key: "radius", spec: at(0.26) },
          { key: "halo", spec: at(0.9) },
          { key: "decay", spec: at(0.4) },
          { key: "rise", spec: at(0.25) },
          { key: "pitchSpread", spec: at(0.2) },
        ],
      },
    ],
  },
  {
    // Kit-forward and quick: the drums get a five-shard fan plus three tight
    // pops at the 0.1 s floor (the lane's full 8-object budget), the other
    // lanes a single fast accent each. Reroll re-aims the fan.
    id: "kit-fires",
    name: "Kit Fires",
    nodeBlueprints: [
      {
        kind: "spark",
        placement: spot([0.3, 0.6], [0.35, 0.65], "drums"),
        params: [
          { key: "shards", spec: at(5) },
          { key: "spread", spec: at(60) },
          { key: "aim", spec: roll(0, 360, 15) },
          { key: "pitchSweep", spec: at(120) },
          { key: "reach", spec: at(0.2) },
          { key: "decay", spec: at(0.14) },
        ],
      },
      {
        kind: "bloom",
        count: { min: 3, max: 3 },
        placement: spot([0.06, 0.94], [0.12, 0.85], "drums"),
        params: [
          { key: "radius", spec: at(0.08) },
          { key: "halo", spec: at(0.45) },
          { key: "decay", spec: at(0.1) },
          { key: "pitchSpread", spec: at(0.06) },
        ],
      },
      {
        kind: "bloom",
        placement: spot([0.15, 0.85], [0.5, 0.8], "bass"),
        params: [
          { key: "radius", spec: at(0.1) },
          { key: "halo", spec: at(0.5) },
          { key: "decay", spec: at(0.12) },
          { key: "pitchSpread", spec: at(0.08) },
        ],
      },
      {
        kind: "bloom",
        placement: spot([0.15, 0.85], [0.12, 0.45], "chords"),
        params: [
          { key: "radius", spec: at(0.09) },
          { key: "halo", spec: at(0.5) },
          { key: "decay", spec: at(0.13) },
          { key: "pitchSpread", spec: at(0.08) },
        ],
      },
      {
        kind: "streak",
        placement: spot([0.2, 0.8], [0.06, 0.4], "lead"),
        params: [
          { key: "angle", spec: roll(0, 359, 45) },
          { key: "length", spec: at(0.5) },
          { key: "width", spec: at(0.015) },
          { key: "decay", spec: at(0.12) },
        ],
      },
    ],
  },
];

/** The boot/restore default (VZ-IM-3's unknown-preset fallback = entry 0). */
export const VIZ_DEFAULT_PRESET_ID: string = VIZ_PRESETS[0]!.id;

/**
 * The VZ-IM-5 canary set (plan VZ-MF-2: three presets land first so M2
 * rendering starts before the full library): the first three cycle entries,
 * one per draw-path family — bloom anchor, spark burst, orbit motion.
 */
export const VIZ_CANARY_PRESET_IDS: readonly string[] = VIZ_PRESETS.slice(
  0,
  3,
).map((preset) => preset.id);

/**
 * Cycle the library (VZ-HU-2 semantics, pure): step `delta` entries through
 * VIZ_PRESETS order, wrapping both directions; delta 0 returns the same
 * preset; an unknown id starts from the default (entry 0).
 */
export function cycleVizPreset(currentId: string, delta: number): VizPreset {
  const length = VIZ_PRESETS.length;
  const index = Math.max(
    0,
    VIZ_PRESETS.findIndex((preset) => preset.id === currentId),
  );
  const next = (((index + delta) % length) + length) % length;
  return VIZ_PRESETS[next]!;
}
