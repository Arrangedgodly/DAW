/**
 * VizPipeline (VZ-TH-2) — the thin end-to-end hit path, the M1 proof:
 * note-on tap (VZ-IM-1, schedule-time delivery) → offset queue (VZ-TH-1,
 * audible-time release) → the renderer's onFrame seam (VZ-IM-4) → a minimal
 * lane-hue flash on the near-black ground. Placeholder visuals, REAL timing:
 * this is the path every later renderer task (VZ-IM-5 nodes, VZ-HU-2 states,
 * VZ-DD-3 reduced motion) inherits and the wiring the M1 timing probe runs
 * against (tests/browser/viz-thin-path.test.ts).
 *
 * THE ONE-FRAME LAW, mechanically: the ONLY clock this pipeline reads is the
 * AUDIO clock (`opts.audioTime` — VizPage passes `engine.getContext()
 * .currentTime`, the Booth.tsx playhead-loop precedent), read FRESH inside
 * every onFrame call; the queue drains against that read, so a hit released
 * at its audible time draws on the first frame whose audio clock has crossed
 * it — never before (the queue holds future events) and never as a burst
 * (stale arrivals past VIZ_STALE_GRACE_SECONDS drop at drain, R3). The rAF
 * `time` argument is never used for release decisions — it is wall clock.
 *
 * MINIMAL BY CONTRACT (plan VZ-TH-2: "a due hit draws a minimal lane-hue
 * flash (fixed position, bounded decay)"): four FIXED per-lane bands, each
 * flashed as one lane-hued rectangle whose peak alpha carries the hit's
 * velocity (the House Lights direction's intensity shaping) and whose decay
 * is a bounded one-shot — no nodes, no pitch mapping (VZ-IM-5 owns the rig),
 * no randomness (determinism contract), no shadowBlur (R2: plain fills; the
 * DOM chrome's glow law never crosses onto the canvas). Lane hues come from
 * tokens.css ONLY (`--color-lane-<lane>`, read once at creation like the
 * renderer's ground token); a missing token skips that lane's draw — never
 * an invented palette value.
 *
 * Stop law: a transport snapshot with `playing: false` clears the queue
 * (events already tapped but not yet audible never fire after the stop) —
 * observation-only, the engine is otherwise untouched (plan Preamble 8).
 * Already-lit flashes keep decaying naturally: a stop fades the stage, it
 * does not snap it black.
 *
 * HIDDEN-PAGE HIT POLICY (VZ-TH-3 — R3 confirmed drop-and-resync refined,
 * docs/ultron/research/r3-hidden-page-policy.md §3/§6): the page-hidden
 * state rides ONE injected seam (`subscribeVisibility`) with exactly one
 * action — HIDE CLEARS THE QUEUE (`queue.clear()`, hygiene + deterministic
 * tests). NOTHING gates inserts: the tap keeps delivering future-dated
 * events while hidden (audio tabs are timer-throttle-exempt, so the
 * scheduler's refill — and therefore the tap — keeps running), bounded by
 * the queue's capacity. The SHOW side has NO action here: the renderer
 * resumes the loop (VZ-IM-4) and the first visible frame recomputes
 * everything from the audio clock — position (the engine's `f(nowAudio −
 * birth)` envelopes), phase (the trailing window prunes on `now`) and the
 * drain, whose stale rule (shouldFireAtDrain / VIZ_STALE_GRACE_SECONDS,
 * VZ-TH-1's single exported rule — imported through the queue's drain,
 * never restated here) silently drops every event whose audible time fell
 * inside the hidden window while the next FUTURE event fires within one
 * frame of its audible time. NO catch-up, NO replay, ever: perf-budget.md
 * §6's refocus contract ("no time jump, no drift, no replayed animation")
 * extended from the playhead to hits. Correctness never DEPENDS on the
 * hide listener — even if `visibilitychange` never fires, the drain-side
 * stale rule alone prevents any burst (the listener only optimizes
 * memory; R3 §5's browser-variance risk).
 *
 * EXPLICIT NON-ADOPTION (R3 §6.5): the grid renderer's `stepsCrossed`
 * catch-up-glow behavior (src/grid/renderer.ts — the first visible frame
 * fires every crossed step at once) is NOT imported here. The two loops'
 * differing refocus contracts are intentional: a bounded silent catch-up
 * is acceptable for a small DOM element in a lit UI, never for a
 * full-screen near-black canvas under the three-flash ceiling.
 *
 * Tap law (VZ-HU-3): every tapped event is NORMALIZED at this boundary,
 * BEFORE queue insert (`normalizeNoteOn`, src/viz/clamps.ts — the engine
 * re-checks the same policy at ignite, so both feed paths share one law):
 * zero/negative/non-finite velocity → no reaction (dropped, the recorded
 * choice), non-finite `audibleAt` dropped, unknown lane dropped, velocity
 * above 1 clamped to 1; clean events pass through as the SAME object.
 * Insert itself stays NEVER gated (R3) — normalization is an edge policy,
 * not a visibility/transport condition.
 *
 * Purity split (offsetQueue/renderer precedents): the flash math
 * (`flashIntensity`, `laneBand`) is PURE and node-tested
 * (tests/viz-pipeline.test.ts); the wiring object is DOM/audio-adjacent by
 * design and takes every effect as an INJECTED seam (subscriptions, clock,
 * hues, queue) so the unit suite drives it with stubs and the browser probe
 * drives the real ones through VizPage.
 */

import { LANE_IDS, type LaneId } from "../document/schema";
import type { VizNoteOn } from "../engine/session";
import { normalizeNoteOn } from "./clamps";
import { createOffsetQueue, type OffsetQueue } from "./offsetQueue";
import type { VizFrameInfo } from "./renderer";

// ---------------------------------------------------------------------------
// Pure flash math (node-testable, no DOM)
// ---------------------------------------------------------------------------

/**
 * One-shot flash decay, in AUDIO-CLOCK seconds. 100 ms sits at the floor of
 * the House Lights one-shot envelope range (~100–400 ms): short enough that
 * consecutive swung 16ths on one lane (min gap ≈ 107 ms at the demo's
 * 112 BPM / swing 0.2) each ignite from a settled field, so every hit lands
 * an observable reaction for the timing probe; long enough to read as light
 * decaying, not a strobe (the WCAG three-flash ceiling stays a hard wall —
 * VZ-IM-5/HU-3 own the real rig and its ceilings).
 */
export const VIZ_FLASH_DECAY_SECONDS = 0.1;

/**
 * The one-shot envelope: `peak` scaled by the linear decay from `at`, in the
 * audio-clock domain. PURE function of its arguments — the pipeline never
 * mutates intensity per frame, it RE-COMPUTES it from (at, peak, now), so
 * the visual is frame-rate-independent and provably bounded: exactly 0
 * before `at` (the never-early law, even by one frame), `peak` at `at`,
 * linear to 0 at `at + decaySeconds`, 0 forever after. `peak` is clamped to
 * [0, 1] (velocity's linear domain); any non-finite argument reads 0.
 */
export function flashIntensity(
  at: number,
  peak: number,
  now: number,
  decaySeconds: number = VIZ_FLASH_DECAY_SECONDS,
): number {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return 0;
  if (now < at) return 0; // never early — the law, not a tolerance
  if (!Number.isFinite(peak)) return 0;
  const p = Math.min(1, Math.max(0, peak));
  if (!Number.isFinite(decaySeconds) || decaySeconds <= 0) return 0;
  const remaining = 1 - (now - at) / decaySeconds;
  // The 1e-6 floor treats the envelope's float-quantized last instant as
  // gone (10.1 − 10 < 0.1): an alpha of 3e-15 would draw nothing visible
  // but still issue the fill call — expired means expired (cost law).
  if (remaining <= 1e-6) return 0;
  return p * Math.min(1, remaining);
}

/** A fixed flash field in draw-space (CSS px; the renderer's transform maps it). */
export interface VizLaneBand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The FIXED per-lane field (placeholder geometry, VZ-IM-5 re-hangs the real
 * rig): lane `i` of LANE_IDS owns the i-th horizontal quarter of the canvas
 * (drums top — the DAW's own lane stacking), flashed as a centered core
 * rect covering 40% of the width and 60% of the band height — enough light
 * to read, small enough to stay inside the three-flash ceiling. Degenerate
 * boxes (non-finite or sub-pixel) collapse to 0 and the draw is skipped.
 */
export function laneBand(
  laneIndex: number,
  width: number,
  height: number,
): VizLaneBand {
  const axis = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  const w = axis(width);
  const h = axis(height);
  if (w < 1 || h < 1) return { x: 0, y: 0, width: 0, height: 0 };
  const bandHeight = h / LANE_IDS.length;
  const top = laneIndex * bandHeight;
  return {
    x: w * 0.3,
    y: top + bandHeight * 0.2,
    width: w * 0.4,
    height: bandHeight * 0.6,
  };
}

// ---------------------------------------------------------------------------
// The wiring object (injected seams; VizPage provides the real ones)
// ---------------------------------------------------------------------------

/** One lane's live ignition: when it sounded (audio clock) and how hard. */
interface FlashState {
  at: number;
  peak: number;
}

export interface VizPipelineOptions {
  /** The VZ-IM-1 tap (session.subscribeNoteOns). Never gated, never throws. */
  readonly subscribeNoteOns: (
    listener: (noteOn: VizNoteOn) => void,
  ) => () => void;
  /**
   * Coarse transport observer (session.subscribe / transport.subscribe):
   * `playing: false` clears the queue. Structural subset — the pipeline
   * reads nothing else off the snapshot.
   */
  readonly subscribeTransport: (
    listener: (snapshot: { readonly playing: boolean }) => void,
  ) => () => void;
  /**
   * VZ-TH-3's hidden-page seam (R3): document-visibility observer.
   * `hidden: true` clears the queue (the policy's ONLY hide action);
   * `hidden: false` needs none — the drain-side stale rule is the
   * enforcement (see the module doc). Optional so non-DOM wirings (tests,
   * probes) can omit it: correctness never depends on the listener.
   */
  readonly subscribeVisibility?: (
    listener: (hidden: boolean) => void,
  ) => () => void;
  /**
   * THE clock: audio-clock seconds, read fresh per frame (ctx.currentTime).
   * A non-finite read (no AudioContext yet — the engine creates it at first
   * play) parks both the drain and the drawing: nothing fires, nothing is
   * lost (the queue keeps holding).
   */
  readonly audioTime: () => number;
  /**
   * Lane fill styles (tokens.css lane hues). Omitted → read once from the
   * document root (`--color-lane-<lane>`); a lane with no token never draws.
   */
  readonly laneHues?: Readonly<Record<LaneId, string>>;
  /**
   * VZ-IM-5 seam (the inheritance this module was built for): when present,
   * every DRAINED due hit is handed to the consumer (the node engine's
   * ignite) with the drain's audio-clock `now`, and the PLACEHOLDER band
   * flash is suppressed — the rig replaces the minimal flash exactly as the
   * plan's VZ-TH-2 → VZ-IM-5 handoff intends. Timing laws are unchanged:
   * the drain, the stale rule and the probe counters keep running here.
   */
  readonly onDueHits?: (hits: readonly VizNoteOn[], now: number) => void;
  /** Queue override (tests); default createOffsetQueue(). */
  readonly queue?: OffsetQueue;
  /** Decay override (tests); default VIZ_FLASH_DECAY_SECONDS. */
  readonly decaySeconds?: number;
}

/** Inert counters (evidence + later tasks' probes; no behavior). */
export interface VizPipelineProbe {
  /** Events currently held awaiting their audible time. */
  readonly queued: number;
  /** Note-ons released by drains so far (post stale-drop). */
  readonly drained: number;
  /** Ignitions per lane (a stacked chord counts its events). */
  readonly ignitions: Readonly<Record<LaneId, number>>;
}

export interface VizPipeline {
  /**
   * The renderer's per-frame seam: drain at the audio clock, ignite due
   * hits, draw every lane whose flash is still lit. Must not throw (the
   * renderer's re-arm contract); writes canvas pixels only.
   */
  onFrame(ctx: CanvasRenderingContext2D, frame: VizFrameInfo): void;
  /** Unsubscribe every seam (notes, transport, visibility). Terminal, idempotent. */
  dispose(): void;
  probe(): VizPipelineProbe;
}

// -- module-level registry (inert; the renderers/engines/controllers -------
//    precedent) — VZ-TH-3's browser gate reads the mounted page's queue state
//    through it (the hidden-period insert ledger), without reaching into
//    VizPage's closures.

const livePipelines = new Set<VizPipeline>();

/**
 * Live viz pipelines, oldest first (0 after every dispose — the teardown
 * probe; the viz-mount/viz-phases in-page idiom consumes it).
 */
export function activeVizPipelines(): readonly VizPipeline[] {
  return [...livePipelines];
}

/** Tokens.css lane hue custom property for a lane (the naming law). */
function laneHueToken(lane: LaneId): string {
  return `--color-lane-${lane}`;
}

/** Read the lane hues from the document root, once, at creation. */
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

export function createVizPipeline(opts: VizPipelineOptions): VizPipeline {
  const queue = opts.queue ?? createOffsetQueue();
  const decaySeconds =
    Number.isFinite(opts.decaySeconds) && opts.decaySeconds! > 0
      ? opts.decaySeconds!
      : VIZ_FLASH_DECAY_SECONDS;
  const hues = opts.laneHues ?? readLaneHuesFromTokens();
  // Per-lane ignition state (at/peak pairs — the intensity itself is always
  // recomputed from the clock, never accumulated: zero state buildup).
  const flashes: FlashState[] = LANE_IDS.map(() => ({
    at: Number.NaN,
    peak: 0,
  }));
  const ignitions = Object.fromEntries(
    LANE_IDS.map((lane) => [lane, 0]),
  ) as Record<LaneId, number>;
  let drained = 0;

  const unsubscribers: Array<() => void> = [
    opts.subscribeNoteOns((rawNoteOn) => {
      // VZ-HU-3 tap boundary: normalize BEFORE queue insert (the engine
      // re-checks at ignite — every spawn path consults the same policy).
      // Dropped classes never queue (zero-velocity → no reaction, the
      // recorded choice; non-finite audibleAt; unknown lane); insert
      // itself stays NEVER gated (R3: no visibility/transport condition —
      // events keep arriving while the page is hidden).
      const noteOn = normalizeNoteOn(rawNoteOn);
      if (noteOn) queue.insert(noteOn);
    }),
    opts.subscribeTransport((snapshot) => {
      if (!snapshot.playing) queue.clear();
    }),
  ];
  if (opts.subscribeVisibility) {
    // VZ-TH-3 (R3 drop-and-resync): HIDE clears — the single hide action.
    // SHOW is intentionally empty: the drain-side stale rule plus the
    // audio-clock recompute on the first visible frame are the whole
    // resync (see the module doc — no catch-up, no replay, ever).
    unsubscribers.push(
      opts.subscribeVisibility((hidden) => {
        if (hidden) queue.clear();
      }),
    );
  }

  /** The injected audio clock, read fresh (NaN parks everything safely). */
  const audioNow = (): number => opts.audioTime();

  /** Ignite a lane: a louder-or-settled hit replaces a decaying one. */
  const ignite = (lane: LaneId, at: number, peak: number): void => {
    const index = LANE_IDS.indexOf(lane);
    if (index < 0) return;
    const state = flashes[index]!;
    const current = flashIntensity(
      state.at,
      state.peak,
      audioNow(),
      decaySeconds,
    );
    // A softer hit under a louder decay is kept (VZ-HU-3 owns the overlap
    // policy; at the 100 ms decay same-lane hits virtually never overlap).
    if (peak < current) return;
    state.at = at;
    state.peak = peak;
    ignitions[lane]++;
  };

  const pipeline: VizPipeline = {
    onFrame(ctx, frame) {
      const now = audioNow();
      const due = queue.drain(now);
      drained += due.length;
      // VZ-IM-5 seam: the node engine consumes the drained hits and owns
      // the drawing; the placeholder flash below is the no-sink fallback
      // (and the unit-probed mechanism tests/viz-pipeline.test.ts pins).
      if (opts.onDueHits) {
        if (due.length > 0) opts.onDueHits(due, now);
        ctx.globalAlpha = 1;
        return;
      }
      for (const hit of due) ignite(hit.lane, hit.audibleAt, hit.velocity);
      for (let i = 0; i < LANE_IDS.length; i++) {
        const hue = hues[LANE_IDS[i]!];
        if (!hue) continue; // no token → no draw, never an invented color
        const state = flashes[i]!;
        const intensity = flashIntensity(
          state.at,
          state.peak,
          now,
          decaySeconds,
        );
        if (intensity <= 0) continue;
        const band = laneBand(i, frame.width, frame.height);
        if (band.width < 1 || band.height < 1) continue;
        // Plain fill, no shadowBlur (R2 law); integer coords keep the rect
        // off anti-aliasing edges so pixel probes diff exactly.
        ctx.globalAlpha = intensity;
        ctx.fillStyle = hue;
        ctx.fillRect(
          Math.round(band.x),
          Math.round(band.y),
          Math.round(band.width),
          Math.round(band.height),
        );
      }
      // State hygiene (the renderer re-fills the ground next frame with its
      // own fillStyle but not alpha — never leak a decayed alpha into it).
      ctx.globalAlpha = 1;
    },
    dispose() {
      // Terminal + idempotent (the renderer's teardown contract): the
      // unsubs run exactly once however often dispose is called.
      while (unsubscribers.length > 0) unsubscribers.pop()!();
      livePipelines.delete(pipeline);
    },
    probe(): VizPipelineProbe {
      return { queued: queue.size, drained, ignitions: { ...ignitions } };
    },
  };

  livePipelines.add(pipeline);
  return pipeline;
}
