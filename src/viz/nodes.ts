/**
 * VizNodeEngine (VZ-IM-5) — the node rendering engine: arrangement nodes
 * become canvas light. Per-kind draw paths for the six vocabulary kinds
 * (src/viz/vocabulary.ts is the RENDER SPEC — this module renders what it
 * documents, it re-decides nothing), lane-hue identity, canonical-pitch
 * positioning, velocity→amplitude one-shot envelopes, and the live-object
 * registry that carries AGE so VZ-HU-3's cap lands cleanly.
 *
 * DRAW-MODEL LAWS (R1, docs/ultron/research/r1r2-canvas-perf-dpr.md §3 —
 * acceptance constraints for this module, asserted in
 * tests/viz-nodes-math.test.ts):
 * - Per-lane-hue glow sprites PRE-RENDERED ONCE to offscreen canvases at the
 *   capped DPR (`bakeGlowSprite`; `createRadialGradient` appears exactly
 *   once in this file, inside the baker — never per frame: bake, don't
 *   build). Sprites are blitted with `drawImage` only, at integer-rounded
 *   coords/size.
 * - `globalCompositeOperation = "lighter"` for every glow/stroke the engine
 *   paints, restored to `"source-over"` at frame end (the renderer's next
 *   ground fill must never inherit additive state — same hygiene law as the
 *   pipeline's globalAlpha restore).
 * - `shadowBlur` BANNED on canvas (A5; the DOM chrome's glow law never
 *   crosses onto the canvas).
 * - Ground stays the renderer's ONE `fillRect`; this engine only adds light.
 * - Thin geometry (spark shards, ripple rings, streak runs, river bands)
 *   draws as strokes — fill-rate cheap per the vocabulary's size law.
 *
 * HOUSE-LIGHTS LAWS (vocabulary §SHARED LAWS — the render contract):
 * - IGNITION: a note-on on lane L ignites every node whose placement `lane`
 *   is L or "any"; the light is ALWAYS drawn in the HITTING lane's token hue
 *   (`--color-lane-<lane>`, read once at creation like the renderer's ground
 *   token — a lane with no token never draws, never an invented color).
 * - CANONICAL PITCH: p ∈ [0,1] from `canonicalPitch` (the lane's own MIDI
 *   window); each kind's documented pitchLaw positions the light.
 * - VELOCITY scales the envelope amplitude, nothing else.
 * - ONE-SHOT: `oneShotEnvelope` — rise fraction then linear decay, exactly 0
 *   at/after the window end; decay windows clamped into the committed R1
 *   range [0.1, 0.4] s. Nothing pulses forever.
 * - UNITS: placement fractions; lengths/radii/widths in STAGE UNITS (1.0 =
 *   the canvas SHORTER axis); angles degrees (0 = up, clockwise); rates per
 *   BEAT supplied by the caller as `beats` derived from the AUDIO clock ×
 *   BPM (transport time, never wall time — VizPage composes that seam).
 * - RESTING MARKS: each node renders its faint near-static `restMark` every
 *   frame (static geometry — a function of the arrangement only, so the idle
 *   canvas is a deterministic still diagram and the calm law holds by
 *   construction; VZ-IM-6 calibrates exact levels through the
 *   `setRestLevel`/`setLiveGain` seams this engine exposes).
 *
 * LIVE-OBJECT POLICY (VZ-HU-3 FINAL — src/viz/clamps.ts is the law
 * module): the registry tracks every live object's birth (audio-clock)
 * and enforces the hard cap AT SPAWN — VIZ_MAX_LIVE_OBJECTS 192, ≥2×
 * under the measured ~440-live DPR-2 cliff (R1 §3) — evicting
 * FADE-AND-KILL: already-faded (dead-epsilon) objects go first (killing
 * the invisible is never a visible pop), then the OLDEST live birth (the
 * furthest into its decay = the faintest light). Honest worst-case
 * steady state is ≈ 128–170 live, so eviction is a safety net honest
 * play never reaches. The per-hit spawn count is capped at
 * VIZ_MAX_HIT_OBJECTS_PER_LANE (the vocabulary's burst law) counting the
 * lane-bound and "any"-bound nodes in ONE combined enumeration. Hits
 * arrive pre-normalized (normalizeNoteOn at the tap; ignite re-checks —
 * every spawn path consults the clamp layer), pass the accept caps
 * (64/s global + 20/s per lane, trailing 1 s) BEFORE the flash governor
 * — the coarser whole-stage load gate first — and an ADMITTED repeat hit
 * on a still-live node born within the 120 ms retrigger window REFRESHES
 * that node's envelope instead of stacking a duplicate object set; a
 * rate-denied hit takes the DD-3 merge path (pin + companion): every hit
 * lands a visible reaction, overs coalesced never queued.
 *
 * Zero-velocity hits map to NO reaction (VZ-HU-3's recorded choice,
 * enforced by normalizeNoteOn at the tap and re-checked at ignite).
 *
 * FLASH CEILING (VZ-DD-3 — src/viz/clamps.ts is the law module): every
 * ignition passes the per-NODE admission governor (WCAG 2.3.1: ≤3 discrete
 * flashes per trailing second, in BOTH render modes — flash safety is not
 * motion-optional). Admitted hits spawn the normal one-shot; DENIED hits
 * MERGE — a lit node's light PINS at its level (geometry frozen at the pin
 * pose, luminance constant) until the trailing window frees, then decays
 * once (a whole burst stays ONE flash) — and EVERY denied hit lands its
 * own visible reaction through a SUB-THRESHOLD COMPANION (one per node,
 * refreshed: amplitude ≤ VIZ_FLASH_MERGE_ALPHA — SC 2.3.1's
 * below-threshold branch, exempt from the count by magnitude). Every hit
 * still lands a visible reaction.
 *
 * REDUCED-MOTION ALTERNATIVE (VZ-DD-3, the brief's law + the grid's
 * quantized-column precedent src/grid/renderer.ts): `setReducedMotion`
 * swaps the draw mode LIVE (no remount — the renderer's matchMedia seam
 * feeds it). Under reduce, the animated one-shot path is OFF: hits light
 * STATIC PLACED MARKS at the vocabulary's per-kind pitched geometry
 * (bloom's displaced point, spark's fan at mid-flight, ripple's r0 ring,
 * streak's full run, orbit's phase-frozen body, river's pitch position) —
 * instant on, a bounded hold (VIZ_RM_HOLD_SECONDS = 1/ceiling — toggle
 * rate ≤3/s by construction), instant off, refreshed by later hits (a
 * burst holds ONE mark continuously). The still rig (rest marks) stays.
 * Textual event equivalence is NOT drawn here — it rides the announcement
 * path (src/viz/textEquivalence.ts, VZ-DD-2's live region).
 *
 * PURITY SPLIT (offsetQueue/renderer/pipeline precedents): every number the
 * engine renders flows through PURE exported functions below
 * (node-testable, no DOM); the engine object is DOM-adjacent by design
 * (offscreen sprite canvases) and takes every effect as an INJECTED seam
 * (hues, sprite baker, DPR) so the unit suite drives it with stubs. No
 * `Math.random` (determinism contract), no wall-clock reads: `now`/`beats`
 * are onFrame ARGUMENTS — the caller's injected clock, read fresh per frame.
 */

import { LANE_IDS, type LaneId } from "../document/schema";
import type { VizNoteOn } from "../engine/session";
import {
  generateArrangement,
  VIZ_DEFAULT_PRESET_ID,
  VIZ_PRESETS,
  type VizArrangement,
  type VizNode,
} from "./presets";
import {
  VIZ_ENVELOPE_DECAY_MAX_SECONDS,
  VIZ_ENVELOPE_DECAY_MIN_SECONDS,
  VIZ_KIND_DOCS,
  VIZ_LANE_BINDINGS,
  VIZ_MAX_HIT_OBJECTS_PER_LANE,
  type VizLaneBinding,
} from "./vocabulary";
import { resolveDpr, type VizFrameInfo } from "./renderer";
import {
  governFlash,
  governHitAcceptance,
  isRetriggerRefresh,
  mergeAmplitude,
  normalizeNoteOn,
  rmHoldExpiry,
  VIZ_FLASH_MERGE_ALPHA,
  VIZ_MAX_LIVE_OBJECTS,
} from "./clamps";

// ---------------------------------------------------------------------------
// Constants (each named after the law it serves)
// ---------------------------------------------------------------------------

/**
 * The live-object ceiling — FINAL home of the constant is src/viz/clamps
 * (VZ-HU-3): ≥2× under the measured DPR-2 cliff (~440 live, R1 §3 A10).
 * Re-exported here only for the engine's own default and the probes'
 * imports; the documented rationale lives with the law module.
 */
export const VIZ_PROVISIONAL_MAX_LIVE_OBJECTS = VIZ_MAX_LIVE_OBJECTS;

/**
 * Resting-mark alpha multiplier baseline — the still-diagram law's LEGIBLE
 * floor (the 2026-09-05 `polish` recalibration): the critique's P1 showed
 * 0.22 rendering the idle rig as "four faint dots in a near-black field",
 * failing the brief's "the arrangement legible as a still diagram". The
 * authored baseline rises to 0.36 — the critique's readable lane-hue band
 * (~25–35%) plus margin for the radial sprite's fade-to-transparent edge,
 * which eats apparent coverage at small blit sizes — and the first lift
 * (0.36) still read as "barely-visible faint dots" on the re-shot idle
 * capture, so the final floor sits at 0.45 — above it, the rest mark's additive contribution at a lit anchor starts clamping the green lane's wash toward cyan (the first-light nearest-hue gate's own margin law: lane-hue identity is exact, never bleached) —
 * while the diagram stays CALM and PIXEL-STATIC by construction:
 * geometry is arrangement-only, alpha is a constant, so the
 * fingerprint/thin-path determinism gates pin the same byte-still
 * frames, just brighter. VZ-IM-6 calibrates phase/idle multipliers
 * through `setRestLevel` on TOP of this base (the arc keeps restLevel 1
 * everywhere — phase-invariant by law).
 */
export const VIZ_REST_MARK_ALPHA = 0.45;

/**
 * THE visual-amplitude curve exponent (the 2026-09-05 `bolder`
 * recalibration): hit velocity is the AUDIO voice preset's mixing level
 * (the songbook's honest band ≈ 0.3–0.95, median ≈ 0.72 — gain staging
 * for the speakers, NOT a brightness intent), and pre-recalibration it
 * passed STRAIGHT THROUGH as the visual envelope amplitude, so the show
 * inherited the mixer's timid headroom and every peak landed ≤ ~0.7 of
 * full light. `visualAmplitudeOf` (below) applies this gamma to lift the
 * mixing band into the light band while preserving the anchors: 0 → 0
 * (VZ-HU-3's zero-velocity policy), 1 → 1 (full velocity = full light),
 * strictly monotone, PURE. 0.72 → ≈ 0.83; 0.3 → ≈ 0.53.
 */
export const VIZ_AMPLITUDE_GAMMA = 0.55;

/**
 * The live brightness gain (same recalibration): after the amplitude
 * curve, admitted live light draws at `level × liveGain × this` (clamped
 * ≤ 1) so a full-phase dense groove holds the stage near peak light
 * (median-velocity hits reach ≈ 1.0 at full phase) while the rest arc
 * stays visibly calmer. Sub-threshold companions and below-threshold
 * held marks are EXEMPT by law: their ≤ VIZ_FLASH_MERGE_ALPHA luminance
 * delta is the SC 2.3.1 below-threshold branch and must never be
 * amplified past 0.1 (the flash governor binds regardless of this gain).
 */
export const VIZ_LIVE_BRIGHTNESS_GAIN = 1.35;

/**
 * THE envelope-shape gamma (same recalibration, the "envelope shaping"
 * lever): the vocabulary's one-shot is LINEAR peak→0, so a light spends
 * most of its window below half brightness — the eye reads the whole rig
 * as dimmer than the same energy concentrated near peak. Drawing applies
 * `level ** this` (concave lift; 0.6 ≈ perceptual companding): 0 → 0,
 * 1 → 1, monotone — the never-early law, the exactly-zero expiry, the
 * pin hold and the ONE-clean-decay merge law are all shape-invariant and
 * hold exactly. Sub-threshold companions are EXEMPT: their ≤
 * VIZ_FLASH_MERGE_ALPHA luminance delta is the SC 2.3.1 below-threshold
 * branch and a gamma would push it past 0.1 (0.1 ** 0.6 ≈ 0.25).
 * Applied at the DRAW site only — `levelOf` (eviction, pin levels,
 * retrigger liveness) keeps the linear domain.
 */
export const VIZ_ENVELOPE_SHAPE_GAMMA = 0.6;

/**
 * THE live-light tail floor (the 2026-09-05 `colorize` refinement): the
 * critique's P2 — under River Glass, signal red (drums) merges with the
 * ground at low envelope values, "lane identity reads as dark". The cause
 * is luminance physics, not hue: the token red (#f23d4c) carries the least
 * luminance weight of the four lane hues, and the one-shot's linear decay
 * spends its tail at alphas the near-black ground simply absorbs — measured
 * on the built bundle, a drum hit's mid/tail region reads at red-channel
 * 22–40 vs ground ~12 (the "dim red" band), and at decay valleys the live
 * contribution vanishes to the static rest-rig baseline entirely. The fix
 * is a RENDERING floor, never a palette change: the lane-identity law
 * (hue always the hitting lane's --color-lane-* token) is binding, so the
 * token VALUES stay untouched and the DRAW site instead remaps admitted
 * live light as `floor + (1 − floor) × shaped(level × gain)` — the decay
 * tail now sustains at the floor until the envelope's own exactly-zero
 * expiry drops the object, instead of sinking into the ground. Anchors
 * preserved: full light → 1 exactly (the peak is untouched), strictly
 * monotone in level (the never-early/one-decay laws are shape-invariant),
 * PURE (same-seed determinism byte-identical by construction). EXEMPT by
 * law, unchanged: sub-threshold companions (their ≤ VIZ_FLASH_MERGE_ALPHA
 * delta is the SC 2.3.1 below-threshold branch and must never be lifted
 * past 0.1) and the phase-invariant rest marks (the still-diagram law —
 * VIZ_REST_MARK_ALPHA is calibrated separately). Hue-preserving by
 * construction: alpha-only remap over the same baked lane-hue sprite, so
 * the fingerprint gate's nearest-hue assertion still pins exact lane
 * identity. All four lanes take the same floor — blue/green/amber tails
 * lift identically (they suffer the same ground-swallow to a lesser
 * degree), so no lane regresses. The expiry step (floor → 0 in one frame)
 * is a LUMINANCE DROP, not a flash: the three-flash ceiling counts
 * discrete starts, which this never adds.
 */
export const VIZ_LIVE_TAIL_FLOOR = 0.12;

/**
 * THE lane-luminance equalizer cap (same refinement, the critique's own
 * fix direction: "canvas-side brightness floor/compensation for RED
 * events — red's luminance is closest of the four hues to ground"). The
 * four lane tokens do not carry equal perceptual weight: computed from
 * the tokens themselves (#f23d4c ≈ 101, #ffb300 ≈ 182, #35d07f ≈ 169,
 * #4da6ff ≈ 154 on the 0–255 relative-luminance scale), the drum red is
 * ~45% dimmer than amber at the SAME alpha — so an honest red wash reads
 * as the "dark lane" while the palette law (hue always the hitting lane's
 * token, VALUES untouched) stays binding. The draw site therefore applies
 * a per-lane ALPHA equalizer: each admitted live light's drawn alpha is
 * scaled by `min(cap, laneMean / laneLuminance)` — lanes at or above the
 * four-lane mean keep 1 (no dimming, ever — equalization only lifts), and
 * red lifts toward perceptual parity (≈ 1.5 at the committed tokens),
 * capped here so a future darker token cannot runaway-amplify. Alpha-only
 * and hue-exact by construction (same baked sprite, no channel mixing),
 * so the fingerprint nearest-hue law still pins lane identity; PURE and
 * token-derived, so same-seed determinism is byte-identical. EXEMPT
 * unchanged: sub-threshold companions (the ≤ VIZ_FLASH_MERGE_ALPHA law
 * binds at the drawn alpha — an equalizer would push it past 0.1) and the
 * rest/held marks (the still diagram's own calibrated baseline).
 */
export const VIZ_LANE_LUMINANCE_EQ_CAP = 1.5;

/**
 * Relative luminance (0–255 scale, the WCAG coefficients) of a CSS hex
 * color — `#rgb` / `rrggbb`. Non-hex/unparseable → null (never a guess).
 */
export function cssHexLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let r: number, g: number, b: number;
  if (m[1]!.length === 3) {
    r = parseInt(m[1]![0]! + m[1]![0]!, 16);
    g = parseInt(m[1]![1]! + m[1]![1]!, 16);
    b = parseInt(m[1]![2]! + m[1]![2]!, 16);
  } else {
    r = parseInt(m[1]!.slice(0, 2), 16);
    g = parseInt(m[1]!.slice(2, 4), 16);
    b = parseInt(m[1]!.slice(4, 6), 16);
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The per-lane alpha equalizer (colorize): `min(cap, mean / lane)` per
 * lane over the parsable lane hues — 1 for every lane at/above the mean
 * (equalization only lifts, never dims), up to the cap below it. Lanes
 * with unparsable hues get 1 (no invented compensation).
 */
export function laneLuminanceEqualizer(
  hues: Readonly<Record<LaneId, string>>,
): Record<LaneId, number> {
  const lums = LANE_IDS.map((lane) => cssHexLuminance(hues[lane] ?? ""));
  const known = lums.filter((v): v is number => v !== null);
  const mean =
    known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const eq = {} as Record<LaneId, number>;
  LANE_IDS.forEach((lane, i) => {
    const lum = lums[i]!;
    eq[lane] =
      mean !== null && lum !== null && lum > 0
        ? Math.min(VIZ_LANE_LUMINANCE_EQ_CAP, Math.max(1, mean / lum))
        : 1;
  });
  return eq;
}

/**
 * The wash additive passes (same recalibration, the sprite-brightness
 * lever): the baked glow fades linearly to transparent, so a wash's mid
 * and tail region sits at low alpha where the near-black ground swallows
 * it — the critique's "dim output". ADMITTED glow blits (bloom/orbit/
 * river — the sprite washes; never strokes, never rest marks, never
 * sub-threshold companions) draw a SECOND additive pass at
 * alpha × (1 − alpha) under the engine's `lighter` composite: the
 * mid/tail wash compounds (0.3 → 0.45, 0.5 → 0.63) while full cores
 * never overdraw — the LANE-HUE IDENTITY law stays exact (a clamped
 * 2× hue would bleach green toward pale cyan and read as the wrong
 * lane; the fingerprint gate's nearest-hue assertion pins this). The
 * flash COUNT law is untouched (three-flash ceiling counts discrete
 * flashes, not magnitude; sub-threshold deltas are exempt by never
 * taking the second pass). Cost: one extra sprite drawImage per
 * admitted wash — the R1 bake-once law unchanged, the frame-budget
 * gate re-ran green.
 */
export const VIZ_WASH_ADDITIVE_PASSES = 2;

/**
 * Velocity → visual envelope amplitude (the bolder calibration, PURE):
 * clamp01(velocity) ** VIZ_AMPLITUDE_GAMMA. Non-finite reads 0.
 */
export function visualAmplitudeOf(velocity: number): number {
  if (!Number.isFinite(velocity) || velocity <= 0) return 0;
  return clamp01(Math.pow(velocity, VIZ_AMPLITUDE_GAMMA));
}

/**
 * Dead-envelope epsilon: brightness at or below this is "expired" (the
 * pipeline's 1e-6 law — an alpha of 3e-15 would draw nothing visible but
 * still issue the draw call; expired means expired, cost law).
 */
const ENV_DEAD_EPSILON = 1e-6;

/** Glow sprite logical size (CSS px) — baked at × dpr, blitted scaled. */
const SPRITE_LOGICAL_SIZE = 64;

/** Sprite falloff for kinds without a `halo` field (orbit bodies, river glow). */
const ORBIT_HALO = 0.6;
const RIVER_HALO = 0.7;

/** Spark shard stroke width + tail fraction of reach (vocabulary: shards are thin). */
const SHARD_WIDTH_STAGE_UNITS = 0.006;
const SHARD_TAIL_FRACTION = 0.25;

/** Bloom swell floor: the glow never shrinks below this fraction of radius. */
const BLOOM_MIN_SIZE_FRACTION = 0.25;

/** Resting mark sizes (stage units / px) — the legible rig (polish lift). */
const REST_DOT_DIAMETER_STAGE_UNITS = 0.05;
const REST_STROKE_PX = 1;
const REST_SPARK_ARM_FRACTION = 0.35; // of reach, per asterisk arm half-length
const REST_RIVER_WIDTH_FRACTION = 0.5; // of the band width

/**
 * The fixed first-boot deal (VizPage boots this until VZ-IM-3 restores a
 * persisted seed and VZ-HU-2 adds cycle/reroll): default preset, fixed seed
 * — deterministic across boots by construction, which is exactly what the
 * two-boot canvas-fingerprint gate pins.
 */
export const VIZ_DEFAULT_SEED = 20260904;

/** The arrangement a fresh VIZ mount renders (one source of truth for tests). */
export function defaultBootArrangement(): VizArrangement {
  const preset =
    VIZ_PRESETS.find((p) => p.id === VIZ_DEFAULT_PRESET_ID) ?? VIZ_PRESETS[0]!;
  return generateArrangement(preset, VIZ_DEFAULT_SEED);
}

// ---------------------------------------------------------------------------
// Pure shared math (node-testable, no DOM)
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Clamp a blueprint-resolved decay into the committed one-shot window
 * [0.1, 0.4] s (R1/HU-3 range). The library obeys by data
 * (viz-library.test); the renderer enforces by law — a degenerate or
 * out-of-window value can never invent an unbounded pulse.
 */
export function normalizeDecayWindow(seconds: number): number {
  if (!Number.isFinite(seconds)) return VIZ_ENVELOPE_DECAY_MIN_SECONDS;
  return Math.min(
    VIZ_ENVELOPE_DECAY_MAX_SECONDS,
    Math.max(VIZ_ENVELOPE_DECAY_MIN_SECONDS, seconds),
  );
}

/**
 * THE one-shot envelope (vocabulary §ONE-SHOT): with
 * u = elapsed / decay ∈ [0,1] and rise fraction r (default 0),
 * brightness = amplitude × (u < r ? u/r : 1 − (u − r)/(1 − r)) — exactly 0
 * before 0 (never early), at peak amplitude at u = r, linear to exactly 0
 * at u = 1, and 0 forever after (nothing pulses forever). `amplitude` is
 * clamped to [0,1] (velocity's linear domain); any non-finite argument
 * reads 0. PURE — frame-rate-independent by re-computation, never mutated.
 */
export function oneShotEnvelope(
  elapsedSeconds: number,
  decaySeconds: number,
  riseFraction = 0,
  amplitude = 1,
): number {
  if (
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(decaySeconds) ||
    decaySeconds <= 0
  )
    return 0;
  if (elapsedSeconds < 0) return 0; // never early — the law, not a tolerance
  const amp = clamp01(amplitude);
  if (amp <= 0) return 0;
  const u = elapsedSeconds / decaySeconds;
  if (u >= 1) return 0; // expired — exactly zero, forever
  const r = clamp01(Number.isFinite(riseFraction) ? riseFraction : 0);
  const shape = u < r && r > 0 ? u / r : 1 - (u - r) / (1 - r);
  const value = amp * Math.min(1, Math.max(0, shape));
  return value <= ENV_DEAD_EPSILON ? 0 : value;
}

/**
 * Per-lane canonical pitch windows (MIDI), the renderer-owned Lane Rivers
 * discipline: p ∈ [0,1] = the hit's pitch normalized within ITS LANE's own
 * register, clamped at the ends. Windows follow the app's own lane
 * registers (LANE_OCTAVE_FALLBACK: bass 2 / chords 3 / lead 4, two octaves
 * each; drums span the kit pieces' fundamentals — synth kick ≈ 52 to hat ≈
 * 119; sample kits collapse to 220 Hz ≈ 57, the window's middle). A
 * non-finite pitch reads the neutral center 0.5 (the visual never breaks on
 * degenerate engine data).
 */
export const VIZ_LANE_PITCH_WINDOWS: Readonly<Record<LaneId, readonly [number, number]>> = {
  drums: [45, 120],
  bass: [36, 60],
  chords: [48, 72],
  lead: [60, 84],
};

/** Canonical pitch p ∈ [0,1] for a lane's MIDI pitch (clamped). */
export function canonicalPitch(lane: LaneId, midi: number): number {
  if (!Number.isFinite(midi)) return 0.5;
  const [lo, hi] = VIZ_LANE_PITCH_WINDOWS[lane] ?? [0, 127];
  if (hi <= lo) return 0.5;
  return clamp01((midi - lo) / (hi - lo));
}

/**
 * Direction unit vector for a vocabulary angle: degrees, 0 = up (toward
 * stage top), increasing CLOCKWISE — in canvas space (x right, y down)
 * that is (sin θ, −cos θ).
 */
export function degToUnitVector(degrees: number): {
  readonly x: number;
  readonly y: number;
} {
  if (!Number.isFinite(degrees)) return { x: 0, y: 0 };
  const rad = (degrees * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

// -- resolved-field access (the vocabulary's defaults are the fallback law) --

/** The kind's documented renderer default for a field (undefined if unknown). */
export function vizFieldDefault(
  kind: string,
  key: string,
): number | string | undefined {
  const doc = VIZ_KIND_DOCS.find((d) => d.kind === kind);
  return doc?.fields.find((f) => f.key === key)?.default;
}

/**
 * A resolved numeric field, with the documented default as fallback:
 * non-finite resolved values (a degenerate spec) fall back too; 0 is the
 * last resort when even the table has no number (never happens for the
 * closed vocabulary — the guard only keeps the draw paths total).
 */
function numField(
  record: Readonly<Record<string, number | string>> | undefined,
  kind: string,
  key: string,
): number {
  const raw = record?.[key];
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  if (value !== null) return value;
  const fallback = vizFieldDefault(kind, key);
  if (typeof fallback === "number" && Number.isFinite(fallback))
    return fallback;
  return 0;
}

/** The node's validated lane binding ("any" for anything off the closed list). */
export function laneBindingOf(node: VizNode): VizLaneBinding {
  const lane = node.placement.lane;
  return typeof lane === "string" &&
    (VIZ_LANE_BINDINGS as readonly string[]).includes(lane)
    ? (lane as VizLaneBinding)
    : "any";
}

/** Spark shard count: integer, clamped to the documented 2..6. */
function shardCountOf(node: VizNode): number {
  const raw = numField(node.params, node.kind, "shards");
  return Math.min(6, Math.max(2, Math.round(raw)));
}

/** Orbit body count: integer, clamped to the documented 1..3. */
function bodyCountOf(node: VizNode): number {
  const raw = numField(node.params, node.kind, "bodies");
  return Math.min(3, Math.max(1, Math.round(raw)));
}

// -- stage geometry -----------------------------------------------------------

/** Draw-space facts: CSS px width/height + the stage-unit scale. */
export interface VizStage {
  readonly width: number;
  readonly height: number;
  /** Stage-unit scale: 1.0 unit = the SHORTER axis, in CSS px (0 = degenerate). */
  readonly unit: number;
}

/** The stage for a draw-space box (unit = min(w,h); degenerate boxes park at 0). */
export function stageOf(width: number, height: number): VizStage {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  return { width: w, height: h, unit: Math.min(w, h) };
}

/** The node's anchor in CSS px (placement fractions of width/height). */
export function anchorOf(node: VizNode, stage: VizStage): {
  readonly x: number;
  readonly y: number;
} {
  return {
    x: clamp01(numField(node.placement, node.kind, "x")) * stage.width,
    y: clamp01(numField(node.placement, node.kind, "y")) * stage.height,
  };
}

// -- per-kind pure geometry (the vocabulary pitchLaws, exactly) ---------------

/**
 * bloom — ignition point: the anchor displaced vertically by
 * (0.5 − p) × pitchSpread stage units (high pitch lights HIGHER = smaller y).
 */
export function bloomIgnitionPoint(
  node: VizNode,
  p: number,
  stage: VizStage,
): { readonly x: number; readonly y: number } {
  const anchor = anchorOf(node, stage);
  const spread = numField(node.params, node.kind, "pitchSpread");
  return {
    x: anchor.x,
    y: anchor.y + (0.5 - clamp01(p)) * spread * stage.unit,
  };
}

/**
 * spark — the fan: center = aim + (p − 0.5) × pitchSweep degrees; `shards`
 * shard angles divide the `spread` evenly across the fan (a single shard
 * fires at the center).
 */
export function sparkFanAngles(node: VizNode, p: number): readonly number[] {
  const aim = numField(node.params, node.kind, "aim");
  const sweep = numField(node.params, node.kind, "pitchSweep");
  const spread = numField(node.params, node.kind, "spread");
  const center = aim + (clamp01(p) - 0.5) * sweep;
  const n = shardCountOf(node);
  const angles: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    angles.push(center + spread * t);
  }
  return angles;
}

/**
 * ripple — ring geometry at envelope progress u ∈ [0,1]: initial radius
 * r0 = r0min + p × (r0max − r0min), expanding to rEnd; thickness thins
 * linearly to 0 as the ring expands (all stage units).
 */
export function rippleGeometry(
  node: VizNode,
  p: number,
  u: number,
): { readonly radius: number; readonly thickness: number } {
  const r0min = numField(node.params, node.kind, "r0min");
  const r0max = Math.max(
    r0min,
    numField(node.params, node.kind, "r0max"),
  );
  const rEnd = Math.max(
    r0max,
    numField(node.params, node.kind, "rEnd"),
  );
  const thickness = numField(node.params, node.kind, "thickness");
  const uu = clamp01(u);
  const r0 = r0min + clamp01(p) * (r0max - r0min);
  return {
    radius: r0 + (rEnd - r0) * uu,
    thickness: thickness * (1 - uu),
  };
}

/**
 * streak — the run's span: start = span center + direction × (p − 0.5) ×
 * length, end = the span's positive-angle end. The light runs start → end
 * over the envelope (low pitch = long run, high pitch = short pop at the
 * end — the run distance is length × (1 − p)).
 */
export function streakSpan(
  node: VizNode,
  p: number,
  stage: VizStage,
): {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
} {
  const anchor = anchorOf(node, stage);
  const angle = numField(node.params, node.kind, "angle");
  const length = numField(node.params, node.kind, "length");
  const dir = degToUnitVector(angle);
  const along = (d: number) => ({
    x: anchor.x + dir.x * d,
    y: anchor.y + dir.y * d,
  });
  const half = (length / 2) * stage.unit;
  return {
    start: along(((clamp01(p) - 0.5) * length) * stage.unit),
    end: along(half),
  };
}

/**
 * orbit — body k's angle in TURNS at transport `beats`:
 * phase + rate × beats + k / bodies (the vocabulary's documented formula;
 * bodies evenly phased). Body selection from pitch:
 * k = min(bodies − 1, floor(p × bodies)).
 */
export function orbitBodyTurns(
  node: VizNode,
  bodyIndex: number,
  beats: number,
): number {
  const phase = numField(node.motion, node.kind, "phase");
  const rate = numField(node.motion, node.kind, "rate");
  const bodies = bodyCountOf(node);
  const k = Math.min(bodies - 1, Math.max(0, Math.round(bodyIndex)));
  return phase + rate * beats + k / bodies;
}

/** Body position: anchor + unit-vector(turns×360°) × radius (stage units). */
export function orbitBodyPoint(
  node: VizNode,
  bodyIndex: number,
  beats: number,
  stage: VizStage,
): { readonly x: number; readonly y: number } {
  const anchor = anchorOf(node, stage);
  const radius = numField(node.params, node.kind, "radius");
  const dir = degToUnitVector(orbitBodyTurns(node, bodyIndex, beats) * 360);
  return {
    x: anchor.x + dir.x * radius * stage.unit,
    y: anchor.y + dir.y * radius * stage.unit,
  };
}

/** The pitch-selected body index for a hit (chord voicings pick bodies). */
export function orbitBodyForPitch(node: VizNode, p: number): number {
  const bodies = bodyCountOf(node);
  return Math.min(bodies - 1, Math.floor(clamp01(p) * bodies));
}

/**
 * river — canonical pitch position along the band:
 * center + direction × (p − 0.5) × length (p = 0 at the negative-angle
 * end, 1 at the other).
 */
export function riverPitchPoint(
  node: VizNode,
  p: number,
  stage: VizStage,
): { readonly x: number; readonly y: number } {
  const anchor = anchorOf(node, stage);
  const angle = numField(node.params, node.kind, "angle");
  const length = numField(node.params, node.kind, "length");
  const dir = degToUnitVector(angle);
  const d = ((clamp01(p) - 0.5) * length) * stage.unit;
  return { x: anchor.x + dir.x * d, y: anchor.y + dir.y * d };
}

/** Downstream slide distance (stage units × unit) over a beats delta. */
export function riverFlowOffsetPx(
  node: VizNode,
  beatsDelta: number,
  stage: VizStage,
): number {
  const flow = numField(node.motion, node.kind, "flow");
  return flow * beatsDelta * stage.unit;
}

/** The band direction unit vector (rivers/streaks share the angle law). */
export function riverDirection(node: VizNode): {
  readonly x: number;
  readonly y: number;
} {
  return degToUnitVector(numField(node.params, node.kind, "angle"));
}

// ---------------------------------------------------------------------------
// Pure ignition enumeration (what one drained hit spawns)
// ---------------------------------------------------------------------------

/** One live object's spawn facts (all numbers resolved at ignition). */
export interface VizIgnitionSeed {
  /** Index into the arrangement's node list (geometry source). */
  readonly nodeIndex: number;
  readonly kind: string;
  /** The HITTING lane — the hue source (identity law), never the binding. */
  readonly lane: LaneId;
  /** Audio-clock seconds the light ignited (the hit's audibleAt). */
  readonly birth: number;
  /** Clamped one-shot window [0.1, 0.4] s. */
  readonly decay: number;
  /** Visual envelope amplitude ∈ [0,1] — `visualAmplitudeOf(velocity)`. */
  readonly amplitude: number;
  /** Canonical pitch p ∈ [0,1]. */
  readonly p: number;
  /** Spark shard ordinal (0 for every non-spark object). */
  readonly shardIndex: number;
}

/**
 * Enumerate the live objects ONE drained note-on ignites: every node whose
 * lane binding matches the hitting lane (or "any"), in arrangement order,
 * spark fans multiplying by their shard count — truncated at
 * VIZ_MAX_HIT_OBJECTS_PER_LANE (the vocabulary's per-lane burst law,
 * enforced live at spawn). PURE and deterministic: the same
 * (arrangement, hit) pair always enumerates the deep-equal same list.
 * Zero-velocity hits still enumerate (VZ-HU-3 owns that degenerate-note
 * policy); amplitude-0 objects simply draw nothing and age out.
 */
export function enumerateIgnition(
  arrangement: VizArrangement,
  hit: VizNoteOn,
): readonly VizIgnitionSeed[] {
  if (!arrangement || !Number.isFinite(hit.audibleAt)) return [];
  const amplitude = visualAmplitudeOf(hit.velocity);
  const p = canonicalPitch(hit.lane, hit.pitch);
  const seeds: VizIgnitionSeed[] = [];
  arrangement.nodes.forEach((node, nodeIndex) => {
    if (seeds.length >= VIZ_MAX_HIT_OBJECTS_PER_LANE) return;
    const binding = laneBindingOf(node);
    if (binding !== "any" && binding !== hit.lane) return;
    const decay = normalizeDecayWindow(
      numField(node.params, node.kind, "decay"),
    );
    const base = {
      nodeIndex,
      kind: node.kind,
      lane: hit.lane,
      birth: hit.audibleAt,
      decay,
      amplitude,
      p,
      shardIndex: 0,
    };
    if (node.kind === "spark") {
      const count = shardCountOf(node);
      for (let s = 0; s < count; s++) {
        if (seeds.length >= VIZ_MAX_HIT_OBJECTS_PER_LANE) break;
        seeds.push({ ...base, shardIndex: s });
      }
    } else {
      seeds.push(base);
    }
  });
  return seeds;
}

// ---------------------------------------------------------------------------
// The engine (DOM-adjacent; every effect an injected seam)
// ---------------------------------------------------------------------------

/** Sprite baker seam: hue + halo → a pre-rendered glow (null = skip blits). */
export type VizSpriteBaker = (
  hue: string,
  halo: number,
  dpr: number,
) => CanvasImageSource | null;

export interface VizNodeEngineOptions {
  /** The rig to render (VizPage boots defaultBootArrangement()). */
  readonly arrangement: VizArrangement;
  /**
   * Lane hues (tokens.css `--color-lane-<lane>`), injection seam for tests.
   * Omitted → read once from the document root (empty string lanes never
   * draw — never an invented palette value).
   */
  readonly hues?: Readonly<Record<LaneId, string>>;
  /**
   * The neutral resting hue for "any"-bound nodes (their light has no lane
   * until a hit names one). Omitted → the warm-white ink token
   * (`--color-ink`), read once; empty → those rest marks skip.
   */
  readonly restHue?: string;
  /** Sprite bake DPR (default: resolveDpr(window.devicePixelRatio)). */
  readonly dpr?: number;
  /**
   * Live-object cap AT SPAWN (oldest-first eviction). Default: R1's
   * PROVISIONAL 192 — VZ-HU-3 owns the final clamp policy through this seam.
   */
  readonly maxLiveObjects?: number;
  /** Sprite baker seam (tests inject stubs; default bakes offscreen canvases). */
  readonly bakeSprite?: VizSpriteBaker;
}

/** Inert counters (evidence + the VZ-HU-3/VZ-IM-6 policy seams). */
export interface VizNodeEngineProbe {
  /** Live objects right now (birth-tracked, age-visible to the HU-3 policy). */
  readonly live: number;
  /** High-water live count since arrangement set (R1 budget evidence). */
  readonly peakLive: number;
  /** Objects spawned since arrangement set. */
  readonly spawned: number;
  /** Objects evicted oldest-first by the spawn cap (HU-3's clamp ledger). */
  readonly evicted: number;
  /** Hits ignited since arrangement set. */
  readonly ignited: number;
  /** Baked glow sprites in the cache (per (hue, halo) key). */
  readonly sprites: number;
  /** The rest-level calibration seam's current value (VZ-IM-6). */
  readonly restLevel: number;
  /** The live-gain calibration seam's current value (VZ-IM-6). */
  readonly liveGain: number;
  /** Reduced-motion draw mode is ON (VZ-DD-3; static marks, no animation). */
  readonly reducedMotion: boolean;
  /** Static held marks lit right now under reduce (the alternative's rig). */
  readonly heldMarks: number;
  /** Ignitions ADMITTED as discrete flashes since arrangement set (ceiling). */
  readonly flashAdmits: number;
  /** Ignitions merged into held light instead (the ceiling ledger, VZ-DD-3). */
  readonly flashMerges: number;
  /** Hits with ignitable seeds DENIED by the accept caps (VZ-HU-3 ledger). */
  readonly rateDenied: number;
  /** Admitted hits that REFRESHED a still-live node instead of spawning. */
  readonly retriggers: number;
}

export interface VizNodeEngine {
  /**
   * Swap the rig (reroll/cycle — VZ-HU-2's controls): FULL teardown between
   * arrangements (live objects cleared, sprite cache rebuilt for exactly
   * the new rig's keys — zero state buildup across reroll spam).
   */
  setArrangement(arrangement: VizArrangement): void;
  /** Ignite one drained (audible-time) hit. Never gated, never throws. */
  ignite(hit: VizNoteOn): void;
  /**
   * Draw one frame: static rest marks + live one-shots, additively. `now`
   * and `beats` are the caller's injected AUDIO-clock reads (NaN `now`
   * parks the live pass; rest marks still draw — the rig is legible before
   * first play). Restores composite/alpha/dash state before returning.
   */
  onFrame(
    ctx: CanvasRenderingContext2D,
    frame: VizFrameInfo,
    now: number,
    beats: number,
  ): void;
  /**
   * VZ-DD-3 seam: swap the draw mode LIVE (the renderer's matchMedia
   * `onReducedMotionChange` feeds this — mid-session preference flips swap
   * modes without remount damage). ON kills the animated one-shot path and
   * lights static held marks instead; the mode survives setArrangement.
   */
  setReducedMotion(on: boolean): void;
  /** VZ-IM-6 seam: rest-mark brightness multiplier (clamped [0,1]). */
  setRestLevel(level: number): void;
  /** VZ-IM-6 seam: live-light gain multiplier (clamped [0,1]). */
  setLiveGain(gain: number): void;
  /** Inert snapshot — no behavior, no allocation pressure. */
  probe(): VizNodeEngineProbe;
  /** Drop all refs (registry, sprites, arrangement). Terminal, idempotent. */
  dispose(): void;
}

/** Tokens.css lane hue custom property for a lane (the naming law). */
function laneHueToken(lane: LaneId): string {
  return `--color-lane-${lane}`;
}

const REST_HUE_TOKEN = "--color-ink";

/** Read the lane hues from the document root, once (empty when untokensable). */
function readLaneHuesFromTokens(): Record<LaneId, string> {
  const out = {} as Record<LaneId, string>;
  for (const lane of LANE_IDS) {
    let value = "";
    if (
      typeof document !== "undefined" &&
      typeof getComputedStyle === "function"
    ) {
      value = getComputedStyle(document.documentElement)
        .getPropertyValue(laneHueToken(lane))
        .trim();
    }
    out[lane] = value;
  }
  return out;
}

function readRestHueFromTokens(): string {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  )
    return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(REST_HUE_TOKEN)
    .trim();
}

/**
 * The DEFAULT sprite baker: a (hue, halo) radial glow pre-rendered ONCE to
 * an offscreen canvas at × dpr — the R1 "bake, don't build" law. Falloff:
 * a flat core of fraction 0.5 × (1 − halo) (halo 1 = softest, fades from
 * the center; 0 = hard core to mid-radius) then a linear alpha fade to
 * transparent. Premultiplied gradient interpolation makes the
 * hue → transparent fade chromatically clean for any CSS color string.
 * Returns null when the hue is not a color (addColorStop would throw) or
 * canvases are unavailable — the blit skips, never crashes the frame loop.
 */
function bakeGlowSprite(
  hue: string,
  halo: number,
  dpr: number,
): CanvasImageSource | null {
  if (typeof document === "undefined" || !hue) return null;
  const size = Math.max(
    16,
    Math.round(SPRITE_LOGICAL_SIZE * (Number.isFinite(dpr) && dpr > 0 ? dpr : 1)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const half = size / 2;
  try {
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, hue);
    const core = 0.5 * (1 - clamp01(halo));
    if (core > 0) gradient.addColorStop(core, hue);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  } catch {
    return null; // invalid color string — degrade to skipped blits
  }
}

interface VizLiveObject {
  readonly seed: VizIgnitionSeed;
  /** Beats at birth (audio-clock-derived; NaN-safe 0) for flow deltas. */
  readonly beatsAtBirth: number;
  /**
   * VZ-DD-3 flash-ceiling pin: set when a DENIED hit merges into this
   * object — luminance holds `level` until `until` (the trailing window's
   * release), then ONE clean decay; geometry freezes at the `setAt` pose
   * for the object's remaining life (a merged burst reads as held light).
   */
  pin?: { level: number; until: number; setAt: number };
  /**
   * VZ-DD-3 sub-threshold companion: the denied hit's own visible
   * reaction. Its whole luminance delta is ≤ VIZ_FLASH_MERGE_ALPHA —
   * BELOW the SC 2.3.1 general flash threshold — so it is exempt from
   * the flash count while keeping every hit observable (one per node,
   * refreshed — never stacked, so the deltas never sum past threshold).
   */
  sub?: boolean;
}

/**
 * VZ-DD-3 — one static held mark under reduced motion: the node's pitched
 * geometry at the LAST hitting lane's hue (identity law), a fixed level,
 * and a bounded hold refreshed by later hits (rmHoldExpiry — the module
 * doc's toggle-rate law).
 */
interface VizHeldMark {
  lane: LaneId;
  level: number;
  p: number;
  expiresAt: number;
}

// -- module-level registry (inert; the in-page browser idiom reads probes) ---

const liveEngines = new Set<VizNodeEngine>();

/**
 * Live node engines, oldest first (0 after every dispose — the renderer's
 * liveVizRendererCount precedent). The in-page browser gates read the
 * mounted page's probe (reducedMotion, heldMarks, the flash ledger) without
 * reaching into VizPage's closures.
 */
export function activeVizNodeEngines(): readonly VizNodeEngine[] {
  return [...liveEngines];
}

const EMPTY_DASH: number[] = [];
const REST_DASH: number[] = [4, 6];

/**
 * Create the node engine. The registry holds live objects in spawn order
 * with their audio-clock births — the age VZ-HU-3's oldest-first policy
 * reads; the cap evicts at SPAWN (ignite), never mid-draw.
 */
export function createVizNodeEngine(
  opts: VizNodeEngineOptions,
): VizNodeEngine {
  const hues = opts.hues ?? readLaneHuesFromTokens();
  const laneEq = laneLuminanceEqualizer(hues);
  const restHue = opts.restHue ?? readRestHueFromTokens();
  const dpr =
    opts.dpr !== undefined && Number.isFinite(opts.dpr) && opts.dpr > 0
      ? opts.dpr
      : typeof window !== "undefined"
        ? resolveDpr(window.devicePixelRatio)
        : 1;
  const maxLiveObjects =
    Number.isFinite(opts.maxLiveObjects) && opts.maxLiveObjects! >= 1
      ? Math.floor(opts.maxLiveObjects!)
      : VIZ_MAX_LIVE_OBJECTS;
  const bake = opts.bakeSprite ?? bakeGlowSprite;

  let arrangement: VizArrangement | null = opts.arrangement ?? null;
  let live: VizLiveObject[] = [];
  let sprites = new Map<string, CanvasImageSource>();
  let peakLive = 0;
  let spawned = 0;
  let evicted = 0;
  let ignited = 0;
  let restLevel = 1;
  let liveGain = 1;
  let disposed = false;
  // VZ-DD-3 state: the draw mode + the flash-ceiling ledger (one trailing
  // admission window PER NODE — a node is one screen region).
  let reducedMotion = false;
  let flashWindows: number[][] = (opts.arrangement?.nodes ?? []).map(
    () => [],
  );
  const held = new Map<number, VizHeldMark>();
  let flashAdmits = 0;
  let flashMerges = 0;
  // VZ-HU-3 accept-cap state: trailing 1 s windows of ACCEPTED hit
  // audible-times, global + per lane (audible-clock domain, like the
  // flash windows — the caps are rate decisions on the same stream).
  let acceptGlobal: number[] = [];
  let acceptByLane: Record<string, number[]> = {};
  let rateDenied = 0;
  let retriggers = 0;

  const spriteKey = (hue: string, halo: number): string =>
    `${hue}|${halo.toFixed(3)}`;

  /** Bake exactly the (hue, halo) keys this rig can ever blit. */
  const rebuildSpriteCache = (): void => {
    sprites = new Map<string, CanvasImageSource>();
    if (!arrangement) return;
    const wanted = new Set<string>();
    for (const node of arrangement.nodes) {
      const binding = laneBindingOf(node);
      // Live hues: the hitting lane's — every lane for "any"-bound nodes.
      const liveHues =
        binding === "any"
          ? LANE_IDS.map((lane) => hues[lane])
          : [hues[binding as LaneId]];
      // Rest hue: the binding lane's hue, or the neutral ink for "any".
      const restHues =
        binding === "any" ? [restHue] : [hues[binding as LaneId]];
      if (node.kind === "bloom") {
        const halo = numField(node.params, node.kind, "halo");
        for (const hue of [...liveHues, ...restHues])
          if (hue) wanted.add(spriteKey(hue, halo));
      } else if (node.kind === "orbit") {
        for (const hue of [...liveHues, ...restHues])
          if (hue) wanted.add(spriteKey(hue, ORBIT_HALO));
      } else if (node.kind === "river") {
        for (const hue of [...liveHues, ...restHues])
          if (hue) wanted.add(spriteKey(hue, RIVER_HALO));
      }
    }
    for (const key of wanted) {
      const [hue, halo] = key.split("|")!;
      const sprite = bake(hue, Number(halo), dpr);
      if (sprite) sprites.set(key, sprite);
    }
  };

  /**
   * FADE-AND-KILL eviction to make room at spawn (VZ-HU-3, R1 §3
   * "never a visible pop"): objects whose light has ALREADY faded to
   * dead-epsilon die first (killing the invisible is a non-event), then
   * the OLDEST live birth — the furthest into its decay, i.e. the
   * faintest light on stage. Ties fall to the earlier registry slot.
   */
  const evictOldest = (now: number): void => {
    let fadedPick = -1;
    let fadedBirth = Infinity;
    let livePick = -1;
    let liveBirth = Infinity;
    for (let i = 0; i < live.length; i++) {
      const obj = live[i]!;
      const faded =
        levelOf(obj, arrangement!.nodes[obj.seed.nodeIndex], now) <=
        ENV_DEAD_EPSILON;
      if (faded) {
        if (obj.seed.birth < fadedBirth) {
          fadedBirth = obj.seed.birth;
          fadedPick = i;
        }
      } else if (obj.seed.birth < liveBirth) {
        liveBirth = obj.seed.birth;
        livePick = i;
      }
    }
    const victim = fadedPick >= 0 ? fadedPick : livePick;
    if (victim < 0) return; // unreachable (caller guarantees a full registry)
    live.splice(victim, 1);
    evicted++;
  };

  // -- draw helpers (integer blits; strokes for thin geometry) ---------------

  const blit = (
    ctx: CanvasRenderingContext2D,
    hue: string,
    halo: number,
    alpha: number,
    x: number,
    y: number,
    diameter: number,
  ): void => {
    if (alpha <= ENV_DEAD_EPSILON || diameter <= 0) return;
    const sprite = sprites.get(spriteKey(hue, halo));
    if (!sprite) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(
      sprite,
      Math.round(x - diameter / 2),
      Math.round(y - diameter / 2),
      Math.round(diameter),
      Math.round(diameter),
    );
  };

  /**
   * The bolder wash: an ADMITTED glow blit drawn VIZ_WASH_ADDITIVE_PASSES
   * times under `lighter` (see the constant's law note). Sub-threshold
   * companions (`sub`, the SC 2.3.1 below-threshold branch) and rest
   * marks keep the single-pass `blit` — their luminance deltas are law.
   */
  const washBlit = (
    ctx: CanvasRenderingContext2D,
    hue: string,
    halo: number,
    alpha: number,
    x: number,
    y: number,
    diameter: number,
    sub: boolean,
  ): void => {
    if (sub || alpha <= ENV_DEAD_EPSILON || diameter <= 0) {
      blit(ctx, hue, halo, alpha, x, y, diameter);
      return;
    }
    blit(ctx, hue, halo, alpha, x, y, diameter);
    // The HUE-IDENTITY law: the extra pass draws at alpha × (1 − alpha) —
    // zero at full alpha (a lit core never overdraws into channel clamp,
    // which would bleach the lane hue into its neighbor) and zero at
    // dead, lifting only the mid/tail wash the ground swallows. Combined
    // coverage 1−(1−a)(1−a(1−a)) < 1 always: same hue, fuller wash.
    blit(ctx, hue, halo, alpha * (1 - alpha), x, y, diameter);
  };

  const strokeSegment = (
    ctx: CanvasRenderingContext2D,
    hue: string,
    alpha: number,
    widthPx: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void => {
    if (alpha <= ENV_DEAD_EPSILON || widthPx <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.strokeStyle = hue;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1), Math.round(y1));
    ctx.lineTo(Math.round(x2), Math.round(y2));
    ctx.stroke();
  };

  const strokeCircle = (
    ctx: CanvasRenderingContext2D,
    hue: string,
    alpha: number,
    widthPx: number,
    x: number,
    y: number,
    radius: number,
  ): void => {
    if (alpha <= ENV_DEAD_EPSILON || widthPx <= 0 || radius <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.strokeStyle = hue;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), radius, 0, Math.PI * 2);
    ctx.stroke();
  };

  /** The hue a node's REST mark draws in (binding lane, neutral for any). */
  const restHueFor = (node: VizNode): string => {
    const binding = laneBindingOf(node);
    return binding === "any" ? restHue : hues[binding as LaneId];
  };

  /** Static resting marks — the still diagram (arrangement-only geometry). */
  const drawRestMarks = (
    ctx: CanvasRenderingContext2D,
    stage: VizStage,
  ): void => {
    if (!arrangement || restLevel <= 0) return;
    for (const node of arrangement.nodes) {
      const hue = restHueFor(node);
      if (!hue) continue; // no token → no mark, never an invented color
      // Colorize: the lane-luminance equalizer applies to LANE-BOUND rest
      // marks too (the critique's dim "red bar" IS the drums river's rest
      // band — red's token luminance is ~45% below amber's, so the same
      // VIZ_REST_MARK_ALPHA reads as the dark lane). Neutral any-bound ink
      // (warm white) is never compensated — it is the info voice, not a
      // lane. Alpha-only, hue-exact, CONSTANT per arrangement (geometry
      // and alpha are arrangement-derived) — the pixel-static still-
      // diagram law and the same-seed fingerprint hold byte-exact.
      const binding = laneBindingOf(node);
      const alpha =
        clamp01(
          (binding === "any" ? 1 : laneEq[binding as LaneId]) *
            VIZ_REST_MARK_ALPHA,
        ) * clamp01(restLevel);
      const anchor = anchorOf(node, stage);
      switch (node.kind) {
        case "bloom":
          // "A faint dot at the anchor."
          blit(ctx, hue, numField(node.params, node.kind, "halo"), alpha,
            anchor.x, anchor.y, REST_DOT_DIAMETER_STAGE_UNITS * stage.unit);
          break;
        case "spark": {
          // "A faint asterisk at the anchor (the charge point)."
          const aim = numField(node.params, node.kind, "aim");
          const reach = numField(node.params, node.kind, "reach");
          const arm = reach * REST_SPARK_ARM_FRACTION * stage.unit;
          for (const offset of [0, 60, 120]) {
            const dir = degToUnitVector(aim + offset);
            strokeSegment(ctx, hue, alpha, REST_STROKE_PX,
              anchor.x - dir.x * arm, anchor.y - dir.y * arm,
              anchor.x + dir.x * arm, anchor.y + dir.y * arm);
          }
          break;
        }
        case "ripple": {
          // "A faint thin circle at the mid radius."
          const r0min = numField(node.params, node.kind, "r0min");
          const r0max = numField(node.params, node.kind, "r0max");
          const rEnd = numField(node.params, node.kind, "rEnd");
          const mid = ((r0min + r0max) / 2 + rEnd) / 2;
          strokeCircle(ctx, hue, alpha, REST_STROKE_PX,
            anchor.x, anchor.y, mid * stage.unit);
          break;
        }
        case "streak": {
          // "A faint dashed line along the span."
          const angle = numField(node.params, node.kind, "angle");
          const length = numField(node.params, node.kind, "length");
          const dir = degToUnitVector(angle);
          const half = (length / 2) * stage.unit;
          ctx.setLineDash(REST_DASH);
          strokeSegment(ctx, hue, alpha, REST_STROKE_PX,
            anchor.x - dir.x * half, anchor.y - dir.y * half,
            anchor.x + dir.x * half, anchor.y + dir.y * half);
          ctx.setLineDash(EMPTY_DASH);
          break;
        }
        case "orbit": {
          // "A faint full-circle path ring with faint dots at the bodies"
          // (phase-only positions — static by construction).
          const radius = numField(node.params, node.kind, "radius");
          strokeCircle(ctx, hue, alpha, REST_STROKE_PX,
            anchor.x, anchor.y, radius * stage.unit);
          const bodies = bodyCountOf(node);
          for (let k = 0; k < bodies; k++) {
            const point = orbitBodyPoint(node, k, 0, stage);
            blit(ctx, hue, ORBIT_HALO, alpha, point.x, point.y,
              REST_DOT_DIAMETER_STAGE_UNITS * stage.unit);
          }
          break;
        }
        case "river": {
          // "A faint continuous band along the segment."
          const length = numField(node.params, node.kind, "length");
          const width = numField(node.params, node.kind, "width");
          const dir = riverDirection(node);
          const half = (length / 2) * stage.unit;
          strokeSegment(ctx, hue, alpha,
            Math.max(REST_STROKE_PX, width * REST_RIVER_WIDTH_FRACTION * stage.unit),
            anchor.x - dir.x * half, anchor.y - dir.y * half,
            anchor.x + dir.x * half, anchor.y + dir.y * half);
          break;
        }
        default:
          break; // unknown kind: no rest mark (the closed list is tested)
      }
    }
  };

  /**
   * VZ-DD-3 — ONE static held mark under reduce: the kind's vocabulary
   * geometry at its PITCHED position, frozen (no envelope, no beats-driven
   * motion — orbit bodies sit at their phase-frozen spots), in the HITTING
   * lane's hue at a fixed level. The vocabulary's rest-mark tables were
   * written for exactly this: static marks show the rig; the hold + refresh
   * law (clamps.ts) bounds toggle rate ≤ VIZ_FLASH_CEILING_HZ.
   */
  const drawHeldMark = (
    ctx: CanvasRenderingContext2D,
    node: VizNode,
    mark: VizHeldMark,
    stage: VizStage,
  ): void => {
    const hue = hues[mark.lane];
    if (!hue) return; // no token → no mark, never an invented color
    // Below-threshold marks (level ≤ VIZ_FLASH_MERGE_ALPHA) are EXEMPT
    // from the brightness gain AND the colorize equalizer — their
    // sub-threshold delta is law, not calibration (see
    // VIZ_LIVE_BRIGHTNESS_GAIN's doc); above-threshold held light takes
    // the same lane-luminance equalization as live light (alpha-only).
    const gain =
      clamp01(liveGain) *
      (mark.level <= VIZ_FLASH_MERGE_ALPHA ? 1 : VIZ_LIVE_BRIGHTNESS_GAIN);
    const eq =
      mark.level <= VIZ_FLASH_MERGE_ALPHA ? 1 : laneEq[mark.lane];
    const alpha = clamp01(mark.level * gain * eq);
    if (alpha <= ENV_DEAD_EPSILON) return;
    const anchor = anchorOf(node, stage);
    switch (node.kind) {
      case "bloom": {
        // Static wash at the pitch-displaced ignition point, at peak size.
        const radius = numField(node.params, node.kind, "radius");
        const point = bloomIgnitionPoint(node, mark.p, stage);
        blit(ctx, hue, numField(node.params, node.kind, "halo"), alpha,
          point.x, point.y, 2 * radius * stage.unit);
        break;
      }
      case "spark": {
        // The fan snapshot: shards frozen at mid-flight.
        const reach = numField(node.params, node.kind, "reach");
        const arm = reach * 0.5 * stage.unit;
        for (const angle of sparkFanAngles(node, mark.p)) {
          const dir = degToUnitVector(angle);
          strokeSegment(ctx, hue, alpha,
            Math.max(REST_STROKE_PX, SHARD_WIDTH_STAGE_UNITS * stage.unit),
            anchor.x, anchor.y,
            anchor.x + dir.x * arm, anchor.y + dir.y * arm);
        }
        break;
      }
      case "ripple": {
        // The ring at its pitch-selected ignition radius, full thickness.
        const ring = rippleGeometry(node, mark.p, 0);
        strokeCircle(ctx, hue, alpha,
          Math.max(REST_STROKE_PX, ring.thickness * stage.unit),
          anchor.x, anchor.y, ring.radius * stage.unit);
        break;
      }
      case "streak": {
        // The run's full path, lit end to end.
        const span = streakSpan(node, mark.p, stage);
        const width = numField(node.params, node.kind, "width");
        strokeSegment(ctx, hue, alpha,
          Math.max(REST_STROKE_PX, width * stage.unit),
          span.start.x, span.start.y, span.end.x, span.end.y);
        break;
      }
      case "orbit": {
        // The pitch-selected body at its phase-frozen position (beats 0).
        const size = numField(node.params, node.kind, "size");
        const point = orbitBodyPoint(
          node, orbitBodyForPitch(node, mark.p), 0, stage);
        blit(ctx, hue, ORBIT_HALO, alpha, point.x, point.y,
          2 * size * stage.unit);
        break;
      }
      case "river": {
        // The local glow at the pitch position on the band (no slide).
        const width = numField(node.params, node.kind, "width");
        const point = riverPitchPoint(node, mark.p, stage);
        blit(ctx, hue, RIVER_HALO, alpha, point.x, point.y,
          width * 2 * stage.unit);
        break;
      }
      default:
        break; // unknown kinds hold nothing (closed list, tested)
    }
  };

  /** Draw every unexpired held mark; expired entries drop lazily. */
  const drawHeldMarks = (
    ctx: CanvasRenderingContext2D,
    stage: VizStage,
    now: number,
  ): void => {
    if (!arrangement) return;
    for (const [nodeIndex, mark] of held) {
      if (!(now < mark.expiresAt)) {
        held.delete(nodeIndex);
        continue;
      }
      const node = arrangement.nodes[nodeIndex];
      if (node) drawHeldMark(ctx, node, mark, stage);
    }
  };

  /**
   * The level one object draws at `now` — the VZ-DD-3 pin law first (a
   * merged object holds constant until release, then ONE clean decay from
   * exactly that level), else the vocabulary one-shot. PURE per object.
   */
  const levelOf = (
    obj: VizLiveObject,
    node: VizNode | undefined,
    now: number,
  ): number => {
    const pin = obj.pin;
    if (pin) {
      if (now < pin.until) return pin.level;
      return oneShotEnvelope(now - pin.until, obj.seed.decay, 0, pin.level);
    }
    const rise =
      node?.kind === "bloom"
        ? numField(node.params, node.kind, "rise")
        : 0;
    return oneShotEnvelope(
      now - obj.seed.birth,
      obj.seed.decay,
      rise,
      obj.seed.amplitude,
    );
  };

  /** Live one-shots — every kind's ignition draw path (vocabulary intent). */
  const drawLive = (
    ctx: CanvasRenderingContext2D,
    stage: VizStage,
    now: number,
    beats: number,
  ): void => {
    if (!arrangement) return;
    const nodes = arrangement.nodes;
    const baseGain = clamp01(liveGain);
    let write = 0;
    for (let read = 0; read < live.length; read++) {
      const obj = live[read]!;
      const node = nodes[obj.seed.nodeIndex];
      const hue = hues[obj.seed.lane];
      // Pinned objects: geometry frozen at the pin pose (the module doc's
      // merge law); luminance = levelOf above. Unpinned: the one-shot.
      const pin = obj.pin;
      const elapsed = pin
        ? pin.setAt - obj.seed.birth
        : now - obj.seed.birth;
      const rise =
        node?.kind === "bloom"
          ? numField(node.params, node.kind, "rise")
          : 0;
      // The bolder brightness calibration: admitted live light draws at
      // shaped(level) × liveGain × VIZ_LIVE_BRIGHTNESS_GAIN (≤ 1), where
      // shaped = level ** VIZ_ENVELOPE_SHAPE_GAMMA (the concave lift);
      // sub-threshold companions keep their ungained, UNSHAPED draw — the
      // ≤ 0.1 luminance delta is the SC 2.3.1 below-threshold branch and
      // is never amplified or companded. Admitted light then takes the
      // tail floor (colorize): floor + (1 − floor) × that, so the decay
      // tail never sinks into the ground before its exactly-zero expiry.
      const gain = baseGain * (obj.sub ? 1 : VIZ_LIVE_BRIGHTNESS_GAIN);
      const level = levelOf(obj, node, now);
      const raw = Math.min(
        1,
        (obj.sub ? level : Math.pow(level, VIZ_ENVELOPE_SHAPE_GAMMA)) * gain,
      );
      // The colorize calibration composes: tail floor, then the per-lane
      // luminance equalizer (alpha-only, token-derived — see the law docs
      // at VIZ_LIVE_TAIL_FLOOR / VIZ_LANE_LUMINANCE_EQ_CAP), clamped ≤ 1.
      // Floor and equalizer apply ONLY inside the live window
      // (level > 0): before the audible time the envelope is exactly 0 and
      // the NEVER-EARLY law keeps the object dark — a floor on zero would
      // light it one frame early. Sub-threshold companions stay exempt.
      const brightness =
        obj.sub || level <= ENV_DEAD_EPSILON
          ? raw
          : Math.min(
              1,
              laneEq[obj.seed.lane] *
                (VIZ_LIVE_TAIL_FLOOR + (1 - VIZ_LIVE_TAIL_FLOOR) * raw),
            );
      const u = clamp01(elapsed / obj.seed.decay);
      const shape = oneShotEnvelope(elapsed, obj.seed.decay, rise, 1);
      const expired = pin
        ? now >= pin.until + obj.seed.decay
        : u >= 1;
      // Compact survivors in place; expired objects drop here.
      if (!expired && node && hue && brightness > ENV_DEAD_EPSILON) {
        live[write++] = obj;
        switch (node.kind) {
          case "bloom": {
            // Soft wash swells at the pitch-displaced point and melts away.
            // `radius` is the vocabulary's PEAK GLOW RADIUS → the blit's
            // full diameter is 2 × radius (stage units → px via the unit).
            const radius = numField(node.params, node.kind, "radius");
            const halo = numField(node.params, node.kind, "halo");
            const point = bloomIgnitionPoint(node, obj.seed.p, stage);
            washBlit(ctx, hue, halo, brightness, point.x, point.y,
              2 * radius * stage.unit *
                (BLOOM_MIN_SIZE_FRACTION +
                  (1 - BLOOM_MIN_SIZE_FRACTION) * shape),
              !!obj.sub);
            break;
          }
          case "spark": {
            // Shard streaks fly their reach linearly while the fan fades.
            const angles = sparkFanAngles(node, obj.seed.p);
            const reach = numField(node.params, node.kind, "reach");
            const angle = angles[
              Math.min(angles.length - 1, obj.seed.shardIndex)
            ]!;
            const dir = degToUnitVector(angle);
            const anchor = anchorOf(node, stage);
            const headDist = reach * u * stage.unit;
            const tailDist = Math.max(
              0,
              headDist - reach * SHARD_TAIL_FRACTION * stage.unit,
            );
            strokeSegment(ctx, hue, brightness,
              Math.max(REST_STROKE_PX, SHARD_WIDTH_STAGE_UNITS * stage.unit),
              anchor.x + dir.x * tailDist,
              anchor.y + dir.y * tailDist,
              anchor.x + dir.x * headDist,
              anchor.y + dir.y * headDist);
            break;
          }
          case "ripple": {
            // The ring expands and thins to nothing.
            const ring = rippleGeometry(node, obj.seed.p, u);
            const anchor = anchorOf(node, stage);
            strokeCircle(ctx, hue, brightness,
              Math.max(REST_STROKE_PX, ring.thickness * stage.unit),
              anchor.x, anchor.y, ring.radius * stage.unit);
            break;
          }
          case "streak": {
            // The run of light travels start → positive end, dying as it goes.
            const span = streakSpan(node, obj.seed.p, stage);
            const dx = span.end.x - span.start.x;
            const dy = span.end.y - span.start.y;
            const head = {
              x: span.start.x + dx * u,
              y: span.start.y + dy * u,
            };
            const width = numField(node.params, node.kind, "width");
            strokeSegment(ctx, hue, brightness,
              Math.max(REST_STROKE_PX, width * stage.unit),
              span.start.x, span.start.y, head.x, head.y);
            break;
          }
          case "orbit": {
            // The pitch-selected body lights AT ITS CURRENT (moving) position
            // (`size` is the body's glow radius → 2× diameter).
            const size = numField(node.params, node.kind, "size");
            const bodyIndex = orbitBodyForPitch(node, obj.seed.p);
            const point = orbitBodyPoint(node, bodyIndex, beats, stage);
            washBlit(ctx, hue, ORBIT_HALO, brightness, point.x, point.y,
              2 * size * stage.unit, !!obj.sub);
            break;
          }
          case "river": {
            // The local glow lights at the pitch position and slides downstream
            // (a round glow spanning the band: 2× its width).
            const width = numField(node.params, node.kind, "width");
            const dir = riverDirection(node);
            const flow = riverFlowOffsetPx(
              node,
              beats - obj.beatsAtBirth,
              stage,
            );
            const point = riverPitchPoint(node, obj.seed.p, stage);
            washBlit(ctx, hue, RIVER_HALO, brightness,
              point.x + dir.x * flow, point.y + dir.y * flow,
              width * 2 * stage.unit, !!obj.sub);
            break;
          }
          default:
            break; // unknown kinds ignite nothing (closed list, tested)
        }
      } else if (!expired && node) {
        // Alive but sub-epsilon bright (or hueless): keep, draw nothing.
        live[write++] = obj;
      }
    }
    live.length = write;
  };

  rebuildSpriteCache();

  // The beats read of the LAST frame — river flow deltas need beats-at-
  // birth even when ignite() arrives between frames (drain then draw).
  let lastBeats = 0;

  /**
   * VZ-HU-3 retrigger refresh: an ADMITTED hit on a node whose reaction
   * is still live and born within the 120 ms window re-births that
   * node's live objects (amplitude the max; lane/pitch the NEW hit's
   * identity — the light never rests, so the burst stays one flash)
   * instead of stacking a duplicate object set. True when anything
   * refreshed (the caller then skips spawning for this node).
   */
  const refreshRetrigger = (
    nodeIndex: number,
    nodeSeeds: readonly VizIgnitionSeed[],
    t: number,
    beatsNow: number,
  ): boolean => {
    if (!arrangement) return false;
    const first = nodeSeeds[0]!;
    const node = arrangement.nodes[nodeIndex];
    let refreshed = false;
    for (let i = 0; i < live.length; i++) {
      const obj = live[i]!;
      if (obj.seed.nodeIndex !== nodeIndex || obj.sub) continue;
      const stillLive = levelOf(obj, node, t) > ENV_DEAD_EPSILON;
      if (!isRetriggerRefresh(stillLive, obj.seed.birth, t)) continue;
      live[i] = {
        seed: {
          ...obj.seed,
          birth: t,
          lane: first.lane,
          p: first.p,
          amplitude: Math.max(obj.seed.amplitude, first.amplitude),
        },
        beatsAtBirth: beatsNow,
      };
      refreshed = true;
    }
    return refreshed;
  };

  /**
   * The DENIED path shared by BOTH deniers — VZ-DD-3's flash ceiling and
   * VZ-HU-3's accept caps: the hit never begins a fresh flash. Under
   * reduce it refreshes/lights the held mark at merge amplitude; in full
   * motion it (a) PINs every still-lit object of the node until
   * `releaseAt` (when the denying window frees — one continuous light,
   * then ONE closing decay) and (b) lands its own visible reaction as
   * the refreshed sub-threshold companion (one per node, never stacked).
   */
  const mergeHit = (
    nodeIndex: number,
    nodeSeeds: readonly VizIgnitionSeed[],
    t: number,
    beatsNow: number,
    releaseAt: number,
  ): void => {
    if (!arrangement) return;
    const first = nodeSeeds[0]!;
    if (reducedMotion) {
      const existing = held.get(nodeIndex);
      if (existing && existing.expiresAt > t) {
        // Lit: refresh the hold — one continuous mark, no toggle.
        existing.level = Math.max(existing.level, first.amplitude);
        existing.lane = first.lane;
        existing.p = first.p;
        existing.expiresAt = rmHoldExpiry(t);
      } else {
        // Dark: the below-threshold response (SC 2.3.1's branch).
        held.set(nodeIndex, {
          lane: first.lane,
          level: mergeAmplitude(first.amplitude),
          p: first.p,
          expiresAt: rmHoldExpiry(t),
        });
      }
      return;
    }
    // (a) THE MERGE: pin every live above-threshold object of the node —
    // the light holds through the burst (one flash), never a fresh one.
    // Only LIVE light merges: an object whose window already ended
    // (registry compaction is draw-time, so expired objects can still sit
    // here between frames) is dark — pinning it would resurrect an
    // above-threshold flash. Companions are never pinned: their decay IS
    // the per-hit reaction.
    for (const obj of live) {
      if (obj.seed.nodeIndex !== nodeIndex || obj.sub) continue;
      const current = levelOf(
        obj,
        arrangement.nodes[obj.seed.nodeIndex],
        t,
      );
      if (current <= ENV_DEAD_EPSILON) continue;
      obj.pin = {
        level: Math.max(current, obj.pin?.level ?? 0, first.amplitude),
        until: Math.max(obj.pin?.until ?? -Infinity, releaseAt),
        setAt: t,
      };
    }
    // (b) THE PER-HIT REACTION at/below the threshold: one sub-threshold
    // companion per node, refreshed (re-born, never stacked) or spawned —
    // every denied hit stays observable and exempt from the flash count
    // by magnitude.
    const amp = mergeAmplitude(first.amplitude);
    if (amp > 0) {
      let companionIndex = -1;
      for (let ci = 0; ci < live.length; ci++) {
        const obj = live[ci]!;
        if (obj.seed.nodeIndex !== nodeIndex || !obj.sub) continue;
        if (
          levelOf(obj, arrangement.nodes[obj.seed.nodeIndex], t) <=
          ENV_DEAD_EPSILON
        )
          continue;
        companionIndex = ci;
        break;
      }
      if (companionIndex >= 0) {
        live[companionIndex] = {
          seed: { ...first, amplitude: amp },
          beatsAtBirth: beatsNow,
          sub: true,
        };
      } else {
        while (live.length >= maxLiveObjects) evictOldest(t);
        live.push({
          seed: { ...first, amplitude: amp },
          beatsAtBirth: beatsNow,
          sub: true,
        });
        spawned++;
      }
    }
  };

  const engine: VizNodeEngine = {
    setArrangement(next) {
      if (disposed) return;
      arrangement = next ?? null;
      live = [];
      peakLive = 0;
      spawned = 0;
      evicted = 0;
      ignited = 0;
      // Full teardown between rigs (VZ-HU-2's CUT) extends to the VZ-DD-3
      // + VZ-HU-3 ledgers: fresh admission/rate windows, held marks
      // dropped — but the REDUCED-MOTION MODE persists (it is a
      // preference, not rig state).
      flashWindows = (arrangement?.nodes ?? []).map(() => []);
      held.clear();
      flashAdmits = 0;
      flashMerges = 0;
      acceptGlobal = [];
      acceptByLane = {};
      rateDenied = 0;
      retriggers = 0;
      rebuildSpriteCache();
    },
    ignite(rawHit) {
      if (disposed || !arrangement) return;
      // VZ-HU-3: EVERY spawn path consults the tap-boundary policy — the
      // pipeline already normalized at insert; direct callers are covered
      // here. Degenerate events normalize or drop, never throw.
      const hit = normalizeNoteOn(rawHit);
      if (!hit) return;
      const seeds = enumerateIgnition(arrangement, hit);
      if (seeds.length === 0) return;
      ignited++;
      const t = hit.audibleAt;
      const beatsNow = Number.isFinite(lastBeats) ? lastBeats : 0;
      // Group by node: the flash ceiling governs the NODE (one screen
      // region) — a spark's shards and every seed of one node share fate.
      const byNode = new Map<number, VizIgnitionSeed[]>();
      for (const seed of seeds) {
        const group = byNode.get(seed.nodeIndex);
        if (group) group.push(seed);
        else byNode.set(seed.nodeIndex, [seed]);
      }
      // VZ-HU-3 ACCEPT CAPS — BEFORE the flash governor (the coarser
      // whole-stage load gate first; 64/s global + 20/s per lane never
      // bite honest play at 53.33/s): a denied hit COALESCES through the
      // DD-3 merge path (pin + companion — every hit a reaction, overs
      // never queued) and consumes no flash admission.
      const acceptance = governHitAcceptance(
        acceptGlobal,
        acceptByLane[hit.lane] ?? [],
        t,
      );
      if (!acceptance.accepted) {
        rateDenied++;
        for (const [nodeIndex, nodeSeeds] of byNode) {
          mergeHit(nodeIndex, nodeSeeds, t, beatsNow, acceptance.releaseAt);
        }
        return;
      }
      acceptGlobal = [...acceptance.globalWindow];
      acceptByLane[hit.lane] = [...acceptance.laneWindow];
      for (const [nodeIndex, nodeSeeds] of byNode) {
        const first = nodeSeeds[0]!;
        while (flashWindows.length <= nodeIndex) flashWindows.push([]);
        const decision = governFlash(flashWindows[nodeIndex]!, t);
        flashWindows[nodeIndex] = [...decision.window];
        if (decision.admitted) {
          flashAdmits++;
          if (reducedMotion) {
            // Static placed mark: instant on, bounded hold (clamps.ts).
            held.set(nodeIndex, {
              lane: first.lane,
              level: first.amplitude,
              p: first.p,
              expiresAt: rmHoldExpiry(t),
            });
          } else if (refreshRetrigger(nodeIndex, nodeSeeds, t, beatsNow)) {
            // VZ-HU-3: a repeat hit on a still-live node (≤ 120 ms)
            // REFRESHES the envelope instead of spawning a duplicate set.
            retriggers++;
          } else {
            for (const seed of nodeSeeds) {
              while (live.length >= maxLiveObjects) evictOldest(t);
              live.push({ seed, beatsAtBirth: beatsNow });
              spawned++;
            }
          }
        } else {
          // DENIED by the flash ceiling: merge, never a fresh flash (the
          // ceiling's mechanism — VZ-DD-3).
          flashMerges++;
          mergeHit(nodeIndex, nodeSeeds, t, beatsNow, decision.releaseAt);
        }
      }
      if (live.length > peakLive) peakLive = live.length;
    },
    onFrame(ctx, frame, now, beats) {
      lastBeats = beats;
      const stage = stageOf(frame.width, frame.height);
      if (!arrangement || stage.unit <= 0) return;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      drawRestMarks(ctx, stage);
      // VZ-DD-3: the draw-mode swap — static held marks under reduce, the
      // animated one-shot path otherwise. Same additive/rest hygiene law.
      if (Number.isFinite(now)) {
        if (reducedMotion) drawHeldMarks(ctx, stage, now);
        else drawLive(ctx, stage, now, beats);
      }
      // State hygiene: the renderer's next ground fill must never inherit
      // additive glow, a decayed alpha or a rest dash (the pipeline's
      // restore law, extended to the composite + dash).
      ctx.setLineDash(EMPTY_DASH);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
    setReducedMotion(on) {
      const next = !!on;
      if (next === reducedMotion) return;
      reducedMotion = next;
      // Mid-session swap without remount damage: motion dies instantly (a
      // state change, never a fade-in of the alternative), held marks die
      // with the mode that drew them. The rig (rest marks) is untouched.
      live = [];
      held.clear();
    },
    setRestLevel(level) {
      restLevel = clamp01(level);
    },
    setLiveGain(gain) {
      liveGain = clamp01(gain);
    },
    probe() {
      return {
        live: live.length,
        peakLive,
        spawned,
        evicted,
        ignited,
        sprites: sprites.size,
        restLevel,
        liveGain,
        reducedMotion,
        heldMarks: held.size,
        flashAdmits,
        flashMerges,
        rateDenied,
        retriggers,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      arrangement = null;
      live = [];
      sprites = new Map<string, CanvasImageSource>();
      held.clear();
      flashWindows = [];
      acceptGlobal = [];
      acceptByLane = {};
      liveEngines.delete(engine);
    },
  };

  liveEngines.add(engine);
  return engine;
}
