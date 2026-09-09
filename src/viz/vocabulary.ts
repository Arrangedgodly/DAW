/**
 * VIZ effect-node vocabulary (VZ-MF-2) — the production decision the design
 * brief deliberately left open, now RECORDED here: the closed node-kind list
 * and the field semantics of every kind, so VZ-IM-5 can render each kind
 * without re-deciding anything. This module is documentation-as-data: pure
 * constants + tiny pure helpers, no DOM, no schema import, no randomness.
 *
 * Six kinds, six draw paths (kept small so VZ-IM-5 stays L-not-XL):
 *
 *   bloom  — soft anchored radial wash (the workhorse anchor light)
 *   spark  — pyro burst: a fan of shard streaks thrown outward (burst/trail
 *            grammar, the absorbed pyro seed)
 *   ripple — an expanding ring that thins to nothing
 *   streak — a run of light along a straight span (trail grammar)
 *   orbit  — orrery body revolving an anchor, transport-time-bound (the
 *            absorbed Orbit Clockwork family: motion binds to beats derived
 *            from the AUDIO clock, never wall time)
 *   river  — a straight light band where pitch reads as canonical position
 *            (the absorbed Lane Rivers discipline)
 *
 * SHARED LAWS (every kind, the VZ-IM-5 render contract):
 *
 * - IGNITION: a note-on on lane L ignites every node whose placement field
 *   `lane` is L or "any". The light is ALWAYS drawn in the HITTING lane's
 *   token hue (`--color-lane-<lane>`); the lane binding selects which hits
 *   ignite a node, never the color (House Lights: lane hue is identity).
 * - CANONICAL PITCH: the renderer supplies p ∈ [0,1] — the hit's pitch
 *   normalized within its lane's own range (Lane Rivers discipline). Each
 *   kind's `pitchLaw` below says how p positions the light.
 * - VELOCITY: velocity ∈ [0,1] scales the envelope amplitude, nothing else.
 * - ONE-SHOT ENVELOPE: with u = (t_audibleClock − audibleAt) / decay ∈ [0,1]
 *   and rise fraction r (default 0), brightness = velocity × (u < r ? u/r
 *   : 1 − (u − r)/(1 − r)); exactly 0 at u ≥ 1. decay ∈ [0.1, 0.4] s (the
 *   R1/HU-3 committed range). Nothing pulses forever; the WCAG three-flash
 *   ceiling stays a hard wall (VZ-HU-3 owns the live clamp).
 * - UNITS: placement x/y are [0,1] fractions of canvas width/height (x
 *   right, y down). Lengths, radii and widths are STAGE UNITS where 1.0 =
 *   the canvas SHORTER axis (resolution-independent; a 0.3-unit radius is
 *   ~270 px on a 900 px axis — the R1 anchor-size ceiling). Angles are
 *   degrees, 0 = up (toward stage top), increasing clockwise; turns are
 *   the same orientation normalized to [0,1] (0.25 = right). Motion rates
 *   are per BEAT (beats derived from the audio clock × BPM — transport
 *   time, never wall time).
 * - RESTING MARK: idle (transport stopped) each node renders its faint
 *   near-static `restMark` — the still diagram of the rig (VZ-IM-6 calibrates
 *   the exact rest brightness/motion).
 * - COST: worst-case draw objects a single note-on can ignite per lane are
 *   budgeted ≤ VIZ_MAX_HIT_OBJECTS_PER_LANE (R1's burst-≤8 law); the
 *   library is tested against `vizBlueprintHitCost` below.
 *
 * A blueprint expresses handcrafted determinism through the MF-1 model
 * without extending it: a CONSTANT field is a degenerate spec (range with
 * min === max, or a single-value enum — every seed resolves it identically),
 * while a WIDE spec is the designer's tolerance for what a reroll re-deals.
 */

import type { VizNodeBlueprint } from "./presets";

// ---------------------------------------------------------------------------
// Budget + envelope constants (the R1/HU-3 committed laws the library obeys)
// ---------------------------------------------------------------------------

/** One-shot decay window, floor (R1/HU-3 committed envelope range). */
export const VIZ_ENVELOPE_DECAY_MIN_SECONDS = 0.1;
/** One-shot decay window, ceiling (R1/HU-3 committed envelope range). */
export const VIZ_ENVELOPE_DECAY_MAX_SECONDS = 0.4;
/**
 * Anchor-size ceiling in stage units (R1: anchor blooms ≲ 300 px on a
 * ~900 px axis — anything larger needs the perf probe re-run before ship).
 * Applies to filled-area sizes (bloom radius, ripple rEnd, spark reach,
 * orbit radius); thin strokes (streak/river length) are fill-rate cheap.
 */
export const VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS = 0.3;
/**
 * Per-lane worst-case draw objects ignited by ONE note-on (R1's burst ≤ 8
 * objects/hit law; VZ-HU-3 enforces it live, the library obeys it by data).
 */
export const VIZ_MAX_HIT_OBJECTS_PER_LANE = 8;
/**
 * Library discipline on total hung nodes per preset (max-count sum). The
 * model's MAX_BLUEPRINT_NODES = 256 stays the generator's sanity ceiling;
 * practical rigs stay far smaller (the densest library preset deals ≤ 12).
 */
export const VIZ_MAX_RIG_NODES = 24;

/** Legal `placement.lane` values: the four real lanes (LANE_IDS strings) + any. */
export const VIZ_LANE_BINDINGS = [
  "drums",
  "bass",
  "chords",
  "lead",
  "any",
] as const;
export type VizLaneBinding = (typeof VIZ_LANE_BINDINGS)[number];

// ---------------------------------------------------------------------------
// Kind documentation table (documentation-as-data for VZ-IM-5/VZ-IM-6)
// ---------------------------------------------------------------------------

export interface VizKindFieldDoc {
  readonly key: string;
  readonly group: "placement" | "motion" | "params";
  /** Human unit name ("stage units", "seconds", "degrees", "turns", ...). */
  readonly unit: string;
  /** What the field means to the draw path. */
  readonly doc: string;
  /** Renderer default when a blueprint omits the field. */
  readonly default: number | string;
}

export interface VizKindDoc {
  readonly kind: string;
  /** What an ignition looks like (the draw path's visual intent). */
  readonly intent: string;
  /** The faint near-static idle mark (VZ-IM-6's still diagram). */
  readonly restMark: string;
  /** How canonical pitch p ∈ [0,1] positions the light. */
  readonly pitchLaw: string;
  /** Draw objects one ignited node contributes per hit (cost semantics). */
  readonly hitObjects: string;
  /** The kind's full field list (shared x/y/lane trio included per group). */
  readonly fields: readonly VizKindFieldDoc[];
}

/** The shared placement trio every kind carries (listed once, true for all). */
const SHARED_PLACEMENT: readonly VizKindFieldDoc[] = [
  {
    key: "x",
    group: "placement",
    unit: "width fraction [0,1]",
    doc: "Anchor x — fraction of canvas width (reroll band = hand's tolerance).",
    default: 0.5,
  },
  {
    key: "y",
    group: "placement",
    unit: "height fraction [0,1]",
    doc: "Anchor y — fraction of canvas height (0 = stage top).",
    default: 0.5,
  },
  {
    key: "lane",
    group: "placement",
    unit: "enum",
    doc: "Which lane's hits ignite this node (\"any\" = every lane, still drawn in the hitting lane's hue).",
    default: "any",
  },
];

export const VIZ_KIND_DOCS: readonly VizKindDoc[] = [
  {
    kind: "bloom",
    intent:
      "A soft round wash of light swells at the anchor and melts away — " +
      "the workhorse anchored fixture; wide halos make ambient wash rigs.",
    restMark: "A faint dot at the anchor.",
    pitchLaw:
      "The ignition point is the anchor displaced vertically by " +
      "(0.5 − p) × pitchSpread stage units — high pitch lights higher.",
    hitObjects: "1 per ignition (the glow is one sprite).",
    fields: [
      ...SHARED_PLACEMENT,
      {
        key: "radius",
        group: "params",
        unit: "stage units",
        doc: "Peak glow radius (≤ VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS).",
        default: 0.15,
      },
      {
        key: "halo",
        group: "params",
        unit: "0..1",
        doc: "Falloff softness: 1 = widest softest gradient, 0 = hard core.",
        default: 0.6,
      },
      {
        key: "decay",
        group: "params",
        unit: "seconds",
        doc: "One-shot envelope window ([0.1, 0.4]).",
        default: 0.25,
      },
      {
        key: "rise",
        group: "params",
        unit: "fraction 0..0.35",
        doc: "Optional attack fraction of the window before peak (slow swell).",
        default: 0,
      },
      {
        key: "pitchSpread",
        group: "params",
        unit: "stage units",
        doc: "Vertical displacement range the pitch sweeps (0 = always at anchor).",
        default: 0.1,
      },
    ],
  },
  {
    kind: "spark",
    intent:
      "Pyro burst: a hit throws a small fan of shard streaks outward from " +
      "the anchor; shards fly their reach and die together with the envelope.",
    restMark: "A faint asterisk at the anchor (the charge point).",
    pitchLaw:
      "The fan's center direction = aim + (p − 0.5) × pitchSweep degrees — " +
      "low pitch fans left of aim, high pitch right.",
    hitObjects:
      "`shards` per ignition (the ONLY multiplier kind — budget it against " +
      "VIZ_MAX_HIT_OBJECTS_PER_LANE).",
    fields: [
      ...SHARED_PLACEMENT,
      {
        key: "shards",
        group: "params",
        unit: "integer 2..6",
        doc: "Shards thrown per hit (step-1 range in data).",
        default: 4,
      },
      {
        key: "spread",
        group: "params",
        unit: "degrees",
        doc: "Total fan width the shards divide evenly across.",
        default: 50,
      },
      {
        key: "aim",
        group: "params",
        unit: "degrees",
        doc: "Fan-center direction (0 = up, clockwise).",
        default: 0,
      },
      {
        key: "pitchSweep",
        group: "params",
        unit: "degrees",
        doc: "How far pitch rotates the fan center (± half this, around aim).",
        default: 90,
      },
      {
        key: "reach",
        group: "params",
        unit: "stage units",
        doc: "Flight distance over the envelope (≤ VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS).",
        default: 0.2,
      },
      {
        key: "decay",
        group: "params",
        unit: "seconds",
        doc: "One-shot envelope window ([0.1, 0.4]).",
        default: 0.18,
      },
    ],
  },
  {
    kind: "ripple",
    intent:
      "A ring of light expands from the anchor, thinning to nothing at the " +
      "expansion limit — chord stabs stack rings at different radii.",
    restMark: "A faint thin circle at the mid radius.",
    pitchLaw:
      "Initial radius r0 = r0min + p × (r0max − r0min); the ring then expands " +
      "toward rEnd over the envelope.",
    hitObjects: "1 per ignition (one ring stroke).",
    fields: [
      ...SHARED_PLACEMENT,
      {
        key: "r0min",
        group: "params",
        unit: "stage units",
        doc: "Ring radius at ignition when p = 0.",
        default: 0.03,
      },
      {
        key: "r0max",
        group: "params",
        unit: "stage units",
        doc: "Ring radius at ignition when p = 1 (≥ r0min).",
        default: 0.08,
      },
      {
        key: "rEnd",
        group: "params",
        unit: "stage units",
        doc: "Expansion limit (≤ VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS).",
        default: 0.2,
      },
      {
        key: "thickness",
        group: "params",
        unit: "stage units",
        doc: "Stroke thickness at ignition, thinning as the ring expands.",
        default: 0.01,
      },
      {
        key: "decay",
        group: "params",
        unit: "seconds",
        doc: "One-shot envelope window ([0.1, 0.4]).",
        default: 0.3,
      },
    ],
  },
  {
    kind: "streak",
    intent:
      "A run of light travels along a straight span and dies at the far " +
      "end — comet traffic across the stage.",
    restMark: "A faint dashed line along the span.",
    pitchLaw:
      "The ignition start = span center + direction × (p − 0.5) × length; " +
      "the light runs from there to the span's positive-angle end (low " +
      "pitch = long run, high pitch = short pop at the end).",
    hitObjects: "1 per ignition (one moving stroke).",
    fields: [
      ...SHARED_PLACEMENT,
      {
        key: "angle",
        group: "params",
        unit: "degrees",
        doc: "Span direction and travel direction (0 = up, clockwise).",
        default: 90,
      },
      {
        key: "length",
        group: "params",
        unit: "stage units",
        doc: "Total span length (the ignition point slides inside it).",
        default: 0.7,
      },
      {
        key: "width",
        group: "params",
        unit: "stage units",
        doc: "Stroke thickness.",
        default: 0.02,
      },
      {
        key: "decay",
        group: "params",
        unit: "seconds",
        doc: "One-shot envelope window ([0.1, 0.4]).",
        default: 0.2,
      },
    ],
  },
  {
    kind: "orbit",
    intent:
      "Orrery: 1–3 bodies revolve the anchor center at a fixed rate — a hit " +
      "ignites the pitch-selected body AT ITS CURRENT position. Revolution " +
      "is bound to TRANSPORT time (beats = audio clock × BPM), never wall " +
      "time (the absorbed Orbit Clockwork discipline).",
    restMark: "A faint full-circle path ring with faint dots at the bodies.",
    pitchLaw:
      "Body index k = min(bodies − 1, floor(p × bodies)) — chord voicings " +
      "pick different bodies.",
    hitObjects:
      "1 per ignition (one body lights — bodies never multiply cost).",
    fields: [
      ...SHARED_PLACEMENT,
      {
        key: "bodies",
        group: "params",
        unit: "integer 1..3",
        doc: "Revolving bodies, evenly phased (body k at phase + k/bodies turns).",
        default: 1,
      },
      {
        key: "radius",
        group: "params",
        unit: "stage units",
        doc: "Revolution radius (≤ VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS).",
        default: 0.2,
      },
      {
        key: "size",
        group: "params",
        unit: "stage units",
        doc: "Body glow radius at ignition.",
        default: 0.05,
      },
      {
        key: "decay",
        group: "params",
        unit: "seconds",
        doc: "One-shot envelope window ([0.1, 0.4]).",
        default: 0.28,
      },
      {
        key: "phase",
        group: "motion",
        unit: "turns [0,1]",
        doc: "Body 0's starting angle (0 = up, clockwise); the reroll seed.",
        default: 0,
      },
      {
        key: "rate",
        group: "motion",
        unit: "revolutions per beat",
        doc: "Angular speed (negative = retrograde). Angle(t) = 2π × (phase + rate × beats(t)).",
        default: 0.125,
      },
    ],
  },
  {
    kind: "river",
    intent:
      "A straight band of light: every hit lights the band AT ITS PITCH " +
      "POSITION and the glow slides downstream while it decays — the " +
      "absorbed Lane Rivers discipline as a fixture.",
    restMark: "A faint continuous band along the segment.",
    pitchLaw:
      "Canonical position along the band: point = center + direction × " +
      "(p − 0.5) × length (p = 0 at the negative-angle end, 1 at the other).",
    hitObjects: "1 per ignition (one local glow on the band).",
    fields: [
      ...SHARED_PLACEMENT,
      {
        key: "angle",
        group: "params",
        unit: "degrees",
        doc: "Band direction (0 = up, clockwise); downstream = its positive end.",
        default: 90,
      },
      {
        key: "length",
        group: "params",
        unit: "stage units",
        doc: "Band length (pitch maps canonically along it).",
        default: 0.9,
      },
      {
        key: "width",
        group: "params",
        unit: "stage units",
        doc: "Band thickness.",
        default: 0.04,
      },
      {
        key: "decay",
        group: "params",
        unit: "seconds",
        doc: "One-shot envelope window ([0.1, 0.4]).",
        default: 0.25,
      },
      {
        key: "flow",
        group: "motion",
        unit: "stage units per beat",
        doc: "Downstream slide speed during the envelope (negative = upstream, 0 = static field).",
        default: 0,
      },
    ],
  },
];

/** The closed kind list (order = the library's first-use order). */
export const VIZ_NODE_KINDS: readonly string[] = VIZ_KIND_DOCS.map(
  (doc) => doc.kind,
);

/** Type guard for the closed kind list. */
export function isVizNodeKind(kind: string): boolean {
  return VIZ_NODE_KINDS.includes(kind);
}

/** The doc table entry for a kind (undefined for unknown kinds). */
export function vizKindDoc(kind: string): VizKindDoc | undefined {
  return VIZ_KIND_DOCS.find((doc) => doc.kind === kind);
}

/**
 * Worst-case draw objects ONE note-on can ignite through a blueprint:
 * max node count × per-hit objects of the kind (spark multiplies by its
 * `shards` ceiling; every other kind contributes 1 per node). The library
 * sums this per lane (bound + "any") against VIZ_MAX_HIT_OBJECTS_PER_LANE.
 */
export function vizBlueprintHitCost(blueprint: VizNodeBlueprint): number {
  const nodes = Math.max(1, blueprint.count?.max ?? 1);
  let perHit = 1;
  if (blueprint.kind === "spark") {
    const shards = blueprint.params?.find((f) => f.key === "shards");
    const ceiling =
      shards && shards.spec.type === "range" ? shards.spec.max : undefined;
    perHit = Number.isFinite(ceiling)
      ? Math.max(1, Math.min(6, Math.ceil(ceiling as number)))
      : 4; // the documented default
  }
  return Math.max(1, Math.round(nodes * perHit));
}
