/**
 * VIZ density phases + idle calm state (VZ-IM-6) — the House Lights play
 * arc (.impeccable/surfaces/viz.md): PLAYING raises the stage through
 * cyc-derived phases (rest → sparse → working → full) as the groove fills,
 * and a STOPPED transport is the IDLE state — the calm near-static
 * faintly-lit rig, the arrangement legible as a still diagram (the brief's
 * kept raise: "density as light phases, calm-dark to full-light, with
 * named text-equivalent state labels never color alone").
 *
 * MECHANISM (recorded production decisions — this task owns them, plan.md
 * §"Open production decisions" row "Idle-state exact form"):
 * - THE MEASUREMENT: phases derive from REAL hit rates — audible-time
 *   note-ons drained by the pipeline (VZ-TH-2's queue-drain stats) are
 *   counted over a trailing VIZ_PHASE_WINDOW_SECONDS (2 s) CLOSED window
 *   of the AUDIO clock and expressed as hits/second. Thresholds, tuned to
 *   the app's own songbook (the demo sustains ≈ 24 note-ons per 2.14 s
 *   bar ≈ 11 hits/s; the plan's worst case is 16ths @ 200 BPM × 4 lanes
 *   ≈ 53/s): SPARSE enters at 1.5/s, WORKING at 4.5/s, FULL at 9.5/s.
 * - HYSTERESIS (the AC's anti-flicker law): each phase LEAVES at half its
 *   enter rate (0.75 / 2.25 / 4.75) and the classifier moves ONE step per
 *   call, so a rate hovering at a boundary holds its phase — the label
 *   never flickers.
 * - THE ENGAGEMENT LAW (never early, by construction): the transport
 *   edge ALONE never moves the stage — the arc's level targets engage
 *   only once a hit has actually DRAINED (an audible-time note-on in the
 *   trailing window), so no pixel change can ever precede a hit's
 *   audible time (VZ-TH-2's Law A) and the pre-first-hit hush keeps the
 *   authored diagram byte-still (the thin-path gate's lead-up window).
 *   Symmetrically, a playing-but-silent transport (every note long gone
 *   from the window) drifts back to the idle diagram — the stage's light
 *   state derives from SOUND, not from the button (the calm law's
 *   near-static rest).
 * - LEVELS: each phase maps to (restLevel, liveGain) multipliers applied
 *   through the seams VZ-IM-5 exposed for exactly this task —
 *   `setRestLevel` scales the still diagram (the rest marks' 0.45 base
 *   alpha — the 2026-09-05 polish legibility floor, nodes.ts), `setLiveGain` scales live light. THE ARC LIVES IN LIVEGAIN
 *   ALONE (monotone calm-dark → full-light: 0.7 → 0.86 → 0.94 → 1 across
 *   rest → sparse → working → full — the light grows as the groove
 *   fills, "the song runs the rig"; the 2026-09-05 `bolder`
 *   recalibration raised rest/sparse/working from 0.6/0.8/0.9 so the
 *   arc's steps stay legible against the amplitude curve's own lift —
 *   full must read VISIBLY richer than sparse, not marginally); THE STILL DIAGRAM IS
 *   PHASE-INVARIANT (restLevel 1 in every phase and at idle) — the
 *   recorded decision, forced by the timing laws: a global diagram ease
 *   would move EVERY lane's rest marks the moment ANY lane's first hit
 *   engages the arc, and the songbook staggers its lanes by design (the
 *   demo's lead enters ≈ 0.9 s after the drums), so VZ-TH-2's per-lane
 *   NEVER-EARLY law would read the dim as early light; the two-boot
 *   fingerprint baseline and the stopped-settle window pin the diagram
 *   further. Idle equals the engine's authored (1, 1) defaults — the
 *   idle-form decision: the idle rig is the as-designed still diagram,
 *   untouched, and the tail decays at authored gain (a stop fades the
 *   stage, it never snaps it black — the pipeline's stop law). No level
 *   ever moves while idle — not at boot (where the device watch has
 *   already created the running AudioContext, so a differing idle target
 *   would ease inside the fingerprint gate's boot-idle window) and not
 *   after a stop.
 * - GRADUAL, NEVER STROBING: phase transitions EASE (exponential, τ =
 *   VIZ_PHASE_EASE_TAU_SECONDS = 0.18 s — the chrome glow law's own
 *   trigger-decay constant) and SNAP to exact targets, so a settled
 *   phase is pixel-static. Live-gain easing scales hit light per frame —
 *   it adds no NEW screen-region changes beyond the ignitions' own (any
 *   change still follows the hit that lit it, so the per-lane never-
 *   early law holds exactly), and phase changes are hysteresis-rare by
 *   construction — the three-flash ceiling (VZ-DD-3, src/viz/clamps.ts)
 *   governs regardless.
 * - REDUCED MOTION (VZ-DD-3's laws): phases degrade to MARK-INTENSITY —
 *   the held marks draw at the phase's liveGain (level changes STEP
 *   instantly: DD-3's "state changes, never animation") and phase labels
 *   speak (below); no new motion is introduced. A stepped gain change on
 *   hysteresis-rare crossings is a single transition, never a flash
 *   PAIR, and under threshold by magnitude.
 * - IDLE: a stopped transport enters idle IMMEDIATELY (never waits out
 *   the window): the hit ring clears and — once the tail has decayed
 *   (one-shots ≤ 0.4 s; pinned merges release ≤ 1 s + one 0.4 s decay)
 *   — the idle canvas is PIXEL-STATIC (no level moves at idle; the
 *   still-diagram law, pinned by the fingerprint gate and this task's
 *   browser journey).
 * - NO CLOCK, NO MOVE: before first play the audio clock is NaN (no
 *   AudioContext until the engine's first play — the lazy-context law) so
 *   the controller PARKS: the boot diagram keeps the engine's authored
 *   defaults, byte-identical to the two-boot fingerprint baseline.
 * - LABELS, NEVER COLOR ALONE: each density phase has a text-equivalent
 *   label (`vizPhaseLabel` — "VIZ LIGHTS — SPARSE", the INFO_MODE_* copy
 *   law). Labels ride the announcement path ONLY UNDER REDUCED MOTION:
 *   DD-2's VERIFIED full-motion contract is a closed list (entry/exit,
 *   preset, reroll, transport edges — "full motion announces state
 *   changes only … no per-hit narration", machine-pinned by the
 *   viz-announcements journey's full-motion-silence step), and this task
 *   adds no full-motion lines to it; under reduce the canvas is static so
 *   the label carries the phase (the DD-3 textual-equivalence law's
 *   sibling). IDLE never speaks here — the remote's idle line
 *   (VIZ_IDLE_LINE, VZ-DD-1/2) already owns the stopped state's words,
 *   and the transport edges speak both ways.
 *
 * Purity laws (offsetQueue/clamps/pipeline precedents): the rate window,
 * classifier, level table, label map and easing are PURE exported
 * functions — table-tested in tests/viz-phases.test.ts; the controller is
 * a wiring object with every effect INJECTED (transport subscribe, level
 * sink, label sink) and every time an ARGUMENT (the audio clock — no
 * Date.now, no performance.now, no Math.random: the determinism
 * contract). The same (hits, clock) script always produces the
 * deep-equal same phase/level/label sequence. The module-level registry
 * (activeVizPhaseControllers) follows the nodes/renderers/summarizers
 * precedent so VZ-HW-3's journey assertions can read the mounted page's
 * phase without reaching into VizPage's closures.
 */

// ---------------------------------------------------------------------------
// Constants (each named after the law it serves)
// ---------------------------------------------------------------------------

/** Trailing hit-rate window, AUDIO-CLOCK seconds (the measurement). */
export const VIZ_PHASE_WINDOW_SECONDS = 2;

/** Hit-timestamp ring cap (belt+braces: 53/s worst × window ≈ 106). */
export const VIZ_PHASE_RING_CAP = 512;

/** Enter SPARSE from rest at ≥ this many hits/second. */
export const VIZ_PHASE_SPARSE_ENTER_HPS = 1.5;

/** SPARSE holds while ≥ this rate (leaves to rest below it — hysteresis). */
export const VIZ_PHASE_SPARSE_STAY_HPS = 0.75;

/** Enter WORKING from sparse at ≥ this many hits/second. */
export const VIZ_PHASE_WORKING_ENTER_HPS = 4.5;

/** WORKING holds while ≥ this rate (leaves to sparse below it). */
export const VIZ_PHASE_WORKING_STAY_HPS = 2.25;

/** Enter FULL from working at ≥ this many hits/second (demo ≈ 11/s). */
export const VIZ_PHASE_FULL_ENTER_HPS = 9.5;

/** FULL holds while ≥ this rate (leaves to working below it). */
export const VIZ_PHASE_FULL_STAY_HPS = 4.75;

/**
 * Level-ease time constant, seconds: 0.18 = the chrome glow law's own
 * trigger-decay constant (tokens.css law carried in viz.md) — gradual to
 * the eye (never a strobe on phase change), quick enough that a settled
 * phase SNAPS exact within a few hundred ms.
 */
export const VIZ_PHASE_EASE_TAU_SECONDS = 0.18;

/**
 * Per-update dt clamp (seconds): a parked rAF loop (hidden page) gaps the
 * audio clock by whole seconds; the ease advances at most this much per
 * update, so resuming catches up over a few frames instead of stepping.
 */
export const VIZ_PHASE_EASE_MAX_DT_SECONDS = 0.25;

/**
 * Snap-to-target epsilon in level units: once within 1 % of the target
 * the level SNAPS exact (residual alpha < 0.003 — under any 8-bit pixel
 * quantum), so a settled phase/idle is pixel-static, not asymptotic.
 */
export const VIZ_PHASE_EASE_SNAP = 0.01;

// ---------------------------------------------------------------------------
// Phases, levels, labels (pure data)
// ---------------------------------------------------------------------------

/** The density phases, in arc order (rest → sparse → working → full). */
export type VizDensityPhase = "rest" | "sparse" | "working" | "full";

/** The stage phase: a density phase while playing, `idle` when stopped. */
export type VizStagePhase = VizDensityPhase | "idle";

/** The engine-level calibration one phase maps to (VZ-IM-5's seams). */
export interface VizPhaseLevels {
  /** Rest-mark brightness multiplier (engine `setRestLevel`). */
  readonly restLevel: number;
  /** Live-light gain multiplier (engine `setLiveGain`). */
  readonly liveGain: number;
}

/**
 * THE calibration table (the recorded production decision): the arc is
 * monotone calm-dark → full-light in LIVEGAIN alone (the light grows as
 * the groove fills); THE STILL DIAGRAM IS PHASE-INVARIANT (restLevel 1
 * everywhere — the per-lane never-early law pins it, see module doc) and
 * IDLE EQUALS THE ENGINE'S AUTHORED DEFAULTS — no level ever moves while
 * idle.
 */
export const VIZ_PHASE_LEVELS: Readonly<
  Record<VizStagePhase, VizPhaseLevels>
> = Object.freeze({
  idle: Object.freeze({ restLevel: 1, liveGain: 1 }),
  rest: Object.freeze({ restLevel: 1, liveGain: 0.7 }),
  sparse: Object.freeze({ restLevel: 1, liveGain: 0.86 }),
  working: Object.freeze({ restLevel: 1, liveGain: 0.94 }),
  full: Object.freeze({ restLevel: 1, liveGain: 1 }),
});

/** The levels one stage phase maps to (pure accessor, never restated). */
export function vizPhaseLevels(phase: VizStagePhase): VizPhaseLevels {
  return VIZ_PHASE_LEVELS[phase] ?? VIZ_PHASE_LEVELS.rest!;
}

/**
 * THE ENGAGEMENT LAW, pure: the level targets while the transport is
 * `playing` are the density phase's levels ONLY when the trailing window
 * holds at least one drained hit (`windowCount > 0`) — otherwise (pre-
 * first-hit hush, or every note long decayed out of the window) the
 * stage keeps the IDLE/authored diagram. Stopped transports are idle
 * regardless. PURE: the update loop and the unit table share ONE law.
 */
export function vizPhaseTargets(
  playing: boolean,
  windowCount: number,
  density: VizDensityPhase,
): VizPhaseLevels {
  return playing && windowCount > 0
    ? vizPhaseLevels(density)
    : vizPhaseLevels("idle");
}

/** The label prefix (the INFO_MODE_* constants' uppercase em-dash law). */
export const VIZ_PHASE_LABEL_PREFIX = "VIZ LIGHTS";

/**
 * The text-equivalent label of a DENSITY phase ("never color alone").
 * Idle is deliberately excluded: its spoken line is the remote's
 * VIZ_IDLE_LINE, owned where it renders (one string, never duplicated).
 */
export function vizPhaseLabel(phase: VizDensityPhase): string {
  return `${VIZ_PHASE_LABEL_PREFIX} — ${phase.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// The measurement + the classifier (pure)
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Hits/second over the trailing CLOSED window [now − window, now] (the
 * boundary is inclusive on both ends — conservative, the flash window's
 * own convention). Non-finite timestamps are garbage and never counted; a
 * non-finite `now` (no audio clock yet) reads 0.
 */
export function trailingHitRate(
  audibleAts: readonly number[],
  now: number,
  windowSeconds: number = VIZ_PHASE_WINDOW_SECONDS,
): number {
  if (!Number.isFinite(now) || !Number.isFinite(windowSeconds) || windowSeconds <= 0)
    return 0;
  const cutoff = now - windowSeconds;
  let count = 0;
  for (const t of audibleAts) {
    if (Number.isFinite(t) && t >= cutoff && t <= now) count++;
  }
  return count / windowSeconds;
}

/**
 * THE classifier: density → phase, with hysteresis. Moves at most ONE
 * step per call (up on the enter thresholds, down below the stay
 * thresholds) — a boundary-hovering rate holds its phase, so neither the
 * stage level nor the label flickers. Non-finite or negative rates read 0.
 * PURE: a total function of (rate, previous).
 */
export function classifyVizPhase(
  rate: number,
  previous: VizDensityPhase,
): VizDensityPhase {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 0;
  switch (previous) {
    case "rest":
      return r >= VIZ_PHASE_SPARSE_ENTER_HPS ? "sparse" : "rest";
    case "sparse":
      if (r >= VIZ_PHASE_WORKING_ENTER_HPS) return "working";
      return r < VIZ_PHASE_SPARSE_STAY_HPS ? "rest" : "sparse";
    case "working":
      if (r >= VIZ_PHASE_FULL_ENTER_HPS) return "full";
      return r < VIZ_PHASE_WORKING_STAY_HPS ? "sparse" : "working";
    case "full":
      return r < VIZ_PHASE_FULL_STAY_HPS ? "working" : "full";
    default:
      return "rest"; // unknown strings degrade to the arc's floor
  }
}

/**
 * The level ease: exponential approach to `target` over `dtSeconds`, with
 * an exact SNAP inside VIZ_PHASE_EASE_SNAP (settled means pixel-exact).
 * `reduced` STEPS instantly (VZ-DD-3: state changes, never animation); a
 * non-positive/non-finite dt parks at `current` (the no-clock law). The
 * per-update dt is clamped at VIZ_PHASE_EASE_MAX_DT_SECONDS so a parked
 * loop resumes gracefully. Never overshoots; result always ∈ [0, 1].
 */
export function easeLevelToward(
  current: number,
  target: number,
  dtSeconds: number,
  reduced: boolean,
): number {
  const cur = clamp01(current);
  const tgt = clamp01(target);
  if (reduced) return tgt;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return cur;
  const dt = Math.min(dtSeconds, VIZ_PHASE_EASE_MAX_DT_SECONDS);
  const delta = tgt - cur;
  if (Math.abs(delta) <= VIZ_PHASE_EASE_SNAP) return tgt;
  return cur + delta * (1 - Math.exp(-dt / VIZ_PHASE_EASE_TAU_SECONDS));
}

// ---------------------------------------------------------------------------
// The controller (wiring object; every effect an injected seam)
// ---------------------------------------------------------------------------

export interface VizPhaseControllerOptions {
  /**
   * Coarse transport observer (session.subscribe shape — the pipeline's
   * structural subset): the stopped edge IS the idle state; the running
   * edge re-arms the arc from `rest`.
   */
  readonly subscribeTransport: (
    listener: (snapshot: { readonly playing: boolean }) => void,
  ) => () => void;
  /** Transport state at mount (entry-while-playing boots the arc at rest). */
  readonly initialPlaying: boolean;
  /**
   * The level sink — called ONLY when a level value actually changes
   * (post-snap settles go silent), with both values atomically. VizPage
   * wires this to the engine's setRestLevel/setLiveGain seams.
   */
  readonly onLevels: (restLevel: number, liveGain: number) => void;
  /**
   * The label sink — fired on each density-phase change, REDUCED MOTION
   * ONLY (DD-2's verified full-motion silence law; see module doc).
   * VizPage wires this to the announcer's generic announce(text).
   */
  readonly onPhaseLabel?: (text: string) => void;
  /** Reduced-motion preference at mount (live flips ride setReducedMotion). */
  readonly reducedMotion?: boolean;
}

/** Inert snapshot — the phase signal VZ-HW-3's journeys assert against. */
export interface VizPhaseProbe {
  /** The stage phase right now (a density phase while playing, else idle). */
  readonly phase: VizStagePhase;
  /** Last computed trailing hit rate, hits/second (0 while parked/idle). */
  readonly rate: number;
  /** Current eased restLevel multiplier (exact target once settled). */
  readonly restLevel: number;
  /** Current eased liveGain multiplier (exact target once settled). */
  readonly liveGain: number;
  /** Phase labels emitted so far (the bounded-announcement ledger). */
  readonly labelAnnouncements: number;
  /** The last emitted label (null before the first). */
  readonly lastLabel: string | null;
  /** Reduced-motion mode (levels step; labels speak). */
  readonly reducedMotion: boolean;
  /** Hits noted into the rate window since creation (evidence). */
  readonly noted: number;
}

export interface VizPhaseController {
  /** Note one drained (audible-time) hit's `audibleAt` into the rate ring */
  note(audibleAt: number): void;
  /**
   * Per-frame step at the AUDIO clock: prune + measure the window,
   * classify (while playing), ease the levels toward the current phase's
   * targets and emit sink calls on change. A non-finite `now` parks
   * everything (no clock yet — levels keep the engine defaults).
   */
  update(now: number): void;
  /** Reduced-motion mode swap (live; steps future level changes). */
  setReducedMotion(on: boolean): void;
  /** Inert snapshot. */
  probe(): VizPhaseProbe;
  /** Unsubscribe the transport seam, drop the ring. Terminal, idempotent. */
  dispose(): void;
}

// -- module-level registry (inert; the controllers/renderers precedent) -----

const livePhaseControllers = new Set<VizPhaseController>();

/**
 * Live phase controllers, oldest first (0 after every dispose — the
 * teardown probe). The browser gates read the mounted page's phase signal
 * (VZ-HW-3's journey assertions) without reaching into VizPage.
 */
export function activeVizPhaseControllers(): readonly VizPhaseController[] {
  return [...livePhaseControllers];
}

/**
 * Create the controller. Created once per wide-stage engine boot in
 * VizPage; disposed with them (the phone gate tears the stack down).
 */
export function createVizPhaseController(
  opts: VizPhaseControllerOptions,
): VizPhaseController {
  let density: VizDensityPhase = "rest";
  let playing = !!opts.initialPlaying;
  let reduced = !!opts.reducedMotion;
  let restLevel = 1; // the engine's authored defaults — no move until a
  let liveGain = 1; // clock exists and a target differs (park law)
  let rate = 0;
  let lastNow: number | null = null;
  let labelAnnouncements = 0;
  let lastLabel: string | null = null;
  let noted = 0;
  let disposed = false;
  const ring: number[] = [];

  const unsubscribe = opts.subscribeTransport((snapshot) => {
    if (disposed) return;
    const next = !!snapshot.playing;
    if (next === playing) return;
    playing = next;
    if (!next) {
      // The stopped edge IS the idle state — immediate, never windowed:
      // the ring clears (a restart re-fills it from zero) and the arc
      // re-arms from rest. Edges never speak here — the remote owns both
      // transport-edge lines (VIZ_PLAYBACK_STARTED_ANNOUNCEMENT and the
      // idle line's own words).
      ring.length = 0;
      density = "rest";
      rate = 0;
    }
  });

  const controller: VizPhaseController = {
    note(audibleAt) {
      if (disposed || !Number.isFinite(audibleAt)) return;
      ring.push(audibleAt);
      noted++;
      if (ring.length > VIZ_PHASE_RING_CAP) ring.shift();
    },
    update(now) {
      if (disposed || !Number.isFinite(now)) return; // parked (no clock)
      // Prune to the closed trailing window while counting (in place —
      // the drain-side stale rule already bounds how old entries get).
      const cutoff = now - VIZ_PHASE_WINDOW_SECONDS;
      let write = 0;
      let count = 0;
      for (let read = 0; read < ring.length; read++) {
        const t = ring[read]!;
        if (t >= cutoff && t <= now) {
          ring[write++] = t;
          count++;
        }
      }
      ring.length = write;
      rate = count / VIZ_PHASE_WINDOW_SECONDS;
      // Classify only while playing — the stopped phase IS idle.
      if (playing) {
        const next = classifyVizPhase(rate, density);
        if (next !== density) {
          density = next;
          if (reduced && opts.onPhaseLabel) {
            // Labels speak under reduce only (the module doc's law); the
            // counter runs regardless so the ledger is mode-truthful.
            lastLabel = vizPhaseLabel(next);
            labelAnnouncements++;
            opts.onPhaseLabel(lastLabel);
          }
        }
      }
      // Ease both levels toward the CURRENT stage targets — the
      // ENGAGEMENT LAW: the transport edge alone never moves the stage;
      // targets engage only with drained hits in the window (count > 0).
      // The first ever update only records `now` (dt 0 — no jump from an
      // unbounded first delta).
      const dt = lastNow === null ? 0 : now - lastNow;
      lastNow = now;
      const target = vizPhaseTargets(playing, count, density);
      const nextRest = easeLevelToward(restLevel, target.restLevel, dt, reduced);
      const nextGain = easeLevelToward(liveGain, target.liveGain, dt, reduced);
      if (nextRest !== restLevel || nextGain !== liveGain) {
        restLevel = nextRest;
        liveGain = nextGain;
        opts.onLevels(restLevel, liveGain);
      }
    },
    setReducedMotion(on) {
      reduced = !!on; // the next update steps to targets (DD-3 law)
    },
    probe() {
      return {
        phase: playing ? density : "idle",
        rate,
        restLevel,
        liveGain,
        labelAnnouncements,
        lastLabel,
        reducedMotion: reduced,
        noted,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      ring.length = 0;
      livePhaseControllers.delete(controller);
    },
  };

  livePhaseControllers.add(controller);
  return controller;
}
