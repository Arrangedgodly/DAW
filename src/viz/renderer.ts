/**
 * VizRenderer (VZ-IM-4) — the isolated canvas skeleton for the House Lights
 * surface (.impeccable/surfaces/viz.md): element ownership, DPR-correct
 * sizing, the rAF frame loop, and the explicit teardown contract every later
 * viz task extends. SKELETON ONLY — the frame body draws nothing beyond the
 * opaque ground fill (one `fillRect`); nodes are VZ-IM-5, the hit pipeline
 * VZ-TH-2, clamps VZ-HU-3.
 *
 * Laws fixed by research (docs/ultron/research/r1r2-canvas-perf-dpr.md §4,
 * committed 2026-09-04 — R2):
 * - SINGLE canvas layer, `getContext("2d", { alpha: false })` (the opaque
 *   optimization; also why the ground fill IS the clear).
 * - DPR capped at `min(devicePixelRatio, VIZ_DPR_CAP)` behind ONE constant
 *   (uncapped DPR 3 fails the frame gate at default load — A9).
 * - ResizeObserver → rAF-coalesced integer-backing swap, the LaneGrid.tsx
 *   `scheduleFit` pattern (src/components/LaneGrid.tsx:233–241): the RO
 *   callback only sets a dirty flag; the swap happens inside a rAF callback
 *   (this module's frame-loop head — the sanctioned "render loop (or a
 *   one-shot rAF)" variant), at most once per frame, NEVER as per-frame
 *   60 Hz work when nothing resized. Swap only when the INTEGER backing
 *   size changes (RO reports fractional rects; without the guard a drag
 *   reallocates the backing store on sub-pixel churn), and reapply
 *   `ctx.setTransform` after every swap (resizing resets context state).
 *
 * rAF law (src/grid/renderer.ts:1223–1256 precedent): the loop writes
 * DIRECTLY to the canvas only — never framework/reactive state, never the
 * DOM — and re-arms itself at the tail of each callback while running. A
 * `visibilitychange` to hidden PARKS the loop (cancel + flag); visible
 * re-arms it (the HIT policy while hidden is VZ-TH-3's, not this
 * module's — R3 decided drop-and-resync and it consumes this seam).
 *
 * Reduced-motion SEAM (VZ-DD-3 owns the alternative): the renderer holds
 * the `matchMedia("(prefers-reduced-motion: reduce)")` list, keeps its
 * current value on `probe()`, and notifies `opts.onReducedMotionChange` on
 * every change — but the skeleton does NOT branch drawing on it (the
 * alternative render mode is VZ-DD-3's scope).
 *
 * Teardown contract (extended by VZ-HU-1's state machine): `dispose()`
 * cancels the rAF, disconnects the ResizeObserver, removes the
 * visibilitychange and matchMedia listeners, and drops all refs/callbacks
 * — after dispose there are ZERO live rAF callbacks, observers or
 * listeners, provable via this module's inert probes. Terminal and
 * idempotent.
 *
 * Purity laws (src/viz/presets.ts + offsetQueue.ts precedents): the
 * sizing math and the loop-state machine below are PURE exported functions
 * (node-testable — no DOM); this module imports NO framework code (the
 * loop must never touch reactive state) and NO engine code (transport
 * isolation by construction — the audio clock is VZ-TH-2's pipeline's
 * concern, read inside `onFrame`). No randomness (determinism contract)
 * and no wall-clock reads: the only timestamp the skeleton touches is the
 * rAF callback's own `time` argument, handed to `onFrame`.
 */

// ---------------------------------------------------------------------------
// Pure sizing math (R2 §4 — node-testable, no DOM)
// ---------------------------------------------------------------------------

/**
 * THE DPR cap, as one constant (the plan's VZ-IM-4 risk note): effective
 * DPR is always `min(devicePixelRatio, VIZ_DPR_CAP)`. The original node
 * renderer passed at DPR 2, but the later multi-instrument composition
 * engine draws substantially richer geometry. Its dense 200 BPM gate uses
 * a 0.75× CSS-pixel backing store. The canvas contains abstract light and
 * line art rather than text, so browser interpolation preserves the intended
 * look while the smaller surface keeps dense four-lane motion responsive.
 */
export const VIZ_DPR_CAP = 0.75;

/**
 * Resolve the effective DPR for a raw `window.devicePixelRatio` reading:
 * capped at `cap` (default VIZ_DPR_CAP), with degenerate readings
 * (non-finite or ≤ 0 — never produced by real browsers) normalized to the
 * lesser of 1 and the cap. Values below the cap (zoomed-out) pass through:
 * raising them would add pixel load for no fidelity gain.
 */
export function resolveDpr(
  rawDevicePixelRatio: number,
  cap: number = VIZ_DPR_CAP,
): number {
  if (!Number.isFinite(rawDevicePixelRatio) || rawDevicePixelRatio <= 0)
    return Math.min(1, cap);
  return Math.min(rawDevicePixelRatio, cap);
}

/** An integer backing-store size (canvas.width / canvas.height). */
export interface VizBackingSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The integer backing store for a CSS-pixel element box at `dpr`:
 * `round(css × dpr)` per axis (integer-backing law), floored at 1 (a
 * 0-sized canvas is invalid; a hidden/unlaid-out element parks at 1×1
 * until the ResizeObserver delivers its real box).
 */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): VizBackingSize {
  const axis = (css: number): number => {
    // A non-finite box is garbage, not "1 css px" — park at the minimal
    // valid canvas regardless of dpr; finite sizes round, floored at 1.
    if (!Number.isFinite(css)) return 1;
    return Math.max(1, Math.round(css * dpr));
  };
  return { width: axis(cssWidth), height: axis(cssHeight) };
}

/**
 * The integer-change guard for the resize swap: true only when the
 * backing store must actually be reallocated. RO reports fractional
 * contentRects — sub-pixel churn that rounds to the same integer size
 * must NOT swap (each swap resets canvas state and reallocates memory).
 */
export function backingSizeChanged(
  current: VizBackingSize,
  next: VizBackingSize,
): boolean {
  return current.width !== next.width || current.height !== next.height;
}

// ---------------------------------------------------------------------------
// Pure loop state machine (visibility → park/resume; teardown terminal)
// ---------------------------------------------------------------------------

/**
 * Loop lifecycle: `idle` created-not-started · `running` rAF armed ·
 * `parked` page hidden (rAF cancelled, resume on visible) · `error` a
 * thrown draw parked the loop (VZ-HU-1 containment — NOT resumable by
 * show; only dispose closes it) · `stopped` disposed (terminal).
 */
export type VizLoopState = "idle" | "running" | "parked" | "error" | "stopped";

/** Lifecycle events: user start/stop, the visibility pair, the draw fault. */
export type VizLoopEvent = "start" | "hide" | "show" | "stop" | "error";

/**
 * The total transition table (VZ-IM-4 owns it; VZ-HU-1's state machine and
 * VZ-TH-3's hide policy consume it through the DOM wiring below, never a
 * restated copy): start arms only from `idle`; hide parks only while
 * `running`; show resumes only from `parked` (hide/show before start are
 * no-ops — nothing is armed to park); `error` (a thrown draw, VZ-HU-1)
 * parks only a `running` loop and is terminal until `stop` — visibility
 * flips never resume a faulted loop; stop is terminal from anywhere.
 */
export function nextVizLoopState(
  state: VizLoopState,
  event: VizLoopEvent,
): VizLoopState {
  switch (state) {
    case "idle":
      if (event === "start") return "running";
      if (event === "stop") return "stopped"; // dispose before start wins
      return "idle";
    case "running":
      if (event === "hide") return "parked";
      if (event === "error") return "error";
      if (event === "stop") return "stopped";
      return "running";
    case "parked":
      if (event === "show") return "running";
      if (event === "stop") return "stopped";
      return "parked";
    case "error":
      // Containment (VZ-HU-1): a faulted loop stays parked through every
      // visibility flip; only dispose (stop) leaves the state.
      if (event === "stop") return "stopped";
      return "error";
    case "stopped":
      return "stopped";
  }
}

// ---------------------------------------------------------------------------
// DOM lifecycle (the seams later tasks extend)
// ---------------------------------------------------------------------------

/** The media query for the reduced-motion seam (grid renderer precedent). */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The ground token the skeleton paints (tokens.css authority, no hex). */
const GROUND_TOKEN = "--color-ground";

/**
 * Per-frame facts handed to `onFrame`. Coordinates are CSS pixels — the
 * applied transform maps them onto the (possibly HiDPI) backing store —
 * and `time` is the rAF callback's own high-res timestamp (the skeleton's
 * ONLY clock; the audio clock is VZ-TH-2's pipeline's read).
 */
export interface VizFrameInfo {
  /** 0-based drawn-frame counter (advances once per loop callback). */
  readonly index: number;
  /** Draw-space width in CSS px (the element box measured at last swap). */
  readonly width: number;
  /** Draw-space height in CSS px. */
  readonly height: number;
  /** Effective (capped) DPR the current backing store was sized at. */
  readonly dpr: number;
  /** rAF high-res timestamp for this frame (ms). */
  readonly time: number;
}

export interface VizRendererOptions {
  /** The canvas element the renderer owns (`.viz-canvas`, full-bleed). */
  readonly canvas: HTMLCanvasElement;
  /**
   * Per-frame draw hook (VZ-TH-2's drain + VZ-IM-5's nodes land here):
   * called every frame with the ground already laid — write DIRECTLY to
   * the context, never to reactive/DOM state. Contract: it must not
   * throw — but if it does, VZ-HU-1's containment boundary (the loop's
   * try/catch) parks the loop into `error`, fires `onError` once, and
   * never lets the fault reach the engine or window.
   */
  readonly onFrame?: (
    ctx: CanvasRenderingContext2D,
    frame: VizFrameInfo,
  ) => void;
  /**
   * Reduced-motion seam (VZ-DD-3 owns the ALTERNATIVE): invoked on every
   * matchMedia change; the current value is always readable on probe().
   */
  readonly onReducedMotionChange?: (matches: boolean) => void;
  /**
   * Error containment seam (VZ-HU-1): invoked EXACTLY ONCE when a frame
   * draw throws — the loop is already parked (state `error`) by the time
   * this fires, the throw NEVER propagates out of the rAF callback toward
   * the engine or window, and dispose() stays fully functional. The host
   * surfaces its DOM error line here (a bounded chrome write — the rAF
   * law's own idiom, the announcer precedent).
   */
  readonly onError?: (err: unknown) => void;
}

/** Inert lifecycle snapshot (browser gates + the VZ-HW-2 harness probe). */
export interface VizRendererProbe {
  readonly state: VizLoopState;
  /** Drawn frames so far (frozen when parked/stopped — the leak probe). */
  readonly frames: number;
  /** Integer backing-store swaps performed (resize-coalescing probe). */
  readonly resizes: number;
  /** Effective (capped) DPR of the applied backing store. */
  readonly dpr: number;
  /** Applied integer backing size. */
  readonly backing: VizBackingSize;
  /** Last matchMedia reduced-motion reading (the DD-3 seam's value). */
  readonly reducedMotion: boolean;
}

export interface VizRenderer {
  /** Acquire the context, wire observers/listeners, size once, arm. */
  start(): void;
  /**
   * FULL teardown (the contract every later task extends — see the module
   * doc): zero live rAF/observers/listeners after. Terminal, idempotent.
   */
  dispose(): void;
  /** Inert snapshot — no behavior, no allocation pressure (one object). */
  probe(): VizRendererProbe;
}

// -- module-level probes (inert; the teardown browser gate reads these) -----

const liveRenderers = new Set<VizRenderer>();

/** Live renderer instances (0 after every dispose — the teardown probe). */
export function liveVizRendererCount(): number {
  return liveRenderers.size;
}

/** Snapshots of every live renderer (state/park/teardown browser gates). */
export function vizRendererProbes(): readonly VizRendererProbe[] {
  return [...liveRenderers].map((r) => r.probe());
}

/** Read a tokens.css custom property (trimmed) from the document root. */
function readToken(name: string): string {
  if (typeof window === "undefined" || !window.getComputedStyle) return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export function createVizRenderer(opts: VizRendererOptions): VizRenderer {
  const canvas = opts.canvas;
  let ctx: CanvasRenderingContext2D | null = null;
  let state: VizLoopState = "idle";
  let rafId = 0;
  let frames = 0;
  let resizes = 0;
  let dpr = 1;
  let backing: VizBackingSize = { width: 1, height: 1 };
  let cssWidth = 1;
  let cssHeight = 1;
  let resizeDirty = false;
  let groundFill = "";
  let resizeObserver: ResizeObserver | null = null;
  let reducedMotion: MediaQueryList | null = null;

  const arm = (): void => {
    rafId = requestAnimationFrame(loop);
  };

  /** Apply the pure transition + its one DOM side effect. */
  const apply = (event: VizLoopEvent): void => {
    const next = nextVizLoopState(state, event);
    if (next === state) return;
    if (next === "parked" || next === "error") cancelAnimationFrame(rafId);
    else if (next === "running") arm();
    // `stopped` cancels in dispose() (it owns the full teardown list).
    state = next;
  };

  /**
   * The resize swap itself — resize-time work only (guarded by the dirty
   * flag; one integer compare per idle frame). DPR is RE-READ here so a
   * zoom change (viewport CSS size moves → RO fires) re-sizes the backing
   * store correctly; a pure monitor move with an unchanged CSS box fires
   * nothing and re-syncs at the next real resize (accepted edge — the
   * backing store only mis-matches until then, never grows unbounded).
   */
  const applyPendingResize = (): void => {
    if (!resizeDirty || !ctx) return;
    resizeDirty = false;
    const rect = canvas.getBoundingClientRect();
    const nextDpr = resolveDpr(window.devicePixelRatio);
    const next = backingSize(rect.width, rect.height, nextDpr);
    if (!backingSizeChanged(backing, next)) {
      // No integer change: keep the current store, but a DPR-only shift
      // still needs the transform re-based so CSS px stay truthful.
      if (nextDpr !== dpr) {
        dpr = nextDpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return;
    }
    dpr = nextDpr;
    backing = next;
    cssWidth = Math.max(1, Number.isFinite(rect.width) ? rect.width : 1);
    cssHeight = Math.max(1, Number.isFinite(rect.height) ? rect.height : 1);
    canvas.width = backing.width;
    canvas.height = backing.height;
    // Resizing resets ALL context state — reapply the CSS-px transform
    // (R2 law) right here, never per frame.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resizes++;
  };

  /**
   * The frame loop (grid renderer loop precedent): pending resize FIRST
   * (before this frame's draw), then the one-`fillRect` ground (the clear
   * AND the ground in a single call — the context is opaque), then the
   * `onFrame` seam, then the unconditional re-arm at the tail while
   * running. A `dispose()` from inside `onFrame` (VZ-HU-1's teardown
   * paths) flips state to `stopped` before the tail, so no zombie rAF.
   */
  const loop = (time: number): void => {
    applyPendingResize();
    const c = ctx;
    if (c) {
      try {
        c.fillStyle = groundFill;
        c.fillRect(0, 0, cssWidth, cssHeight);
        opts.onFrame?.(c, {
          index: frames,
          width: cssWidth,
          height: cssHeight,
          dpr,
          time,
        });
        frames++;
      } catch (err) {
        // VZ-HU-1 error containment: a thrown draw parks the loop (the
        // pure table routes `error` out of `running` and apply() cancels
        // the armed rAF above), the fault NEVER propagates out of the rAF
        // callback toward the engine or window, and the tail re-arm below
        // is dead (state is no longer `running`). dispose() — EXIT's
        // teardown — remains fully functional from `error`.
        apply("error");
        opts.onError?.(err);
        return;
      }
    }
    if (state === "running") rafId = requestAnimationFrame(loop);
  };

  const onVisibilityChange = (): void => {
    apply(document.hidden ? "hide" : "show");
  };

  const onReducedMotionChange = (e: MediaQueryListEvent): void => {
    opts.onReducedMotionChange?.(e.matches);
  };

  const renderer: VizRenderer = {
    start() {
      if (state !== "idle") return;
      // Opaque context, single layer (R2; the `alpha:false` readback is
      // not introspectable — the token-ground pixel probe pins it).
      ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return; // unsupportable in practice; never arm nothing.
      // Token ground, read once (tokens never change at runtime); if the
      // sheet is absent the fallback is the opaque canvas's own default
      // black — never an invented palette value.
      groundFill = readToken(GROUND_TOKEN) || "#000";
      dpr = resolveDpr(window.devicePixelRatio);
      // Initial sizing is EXPLICIT (never relies on RO's first delivery
      // racing the first frame); every later change rides the RO → dirty
      // flag → frame-head swap path.
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, Number.isFinite(rect.width) ? rect.width : 1);
      cssHeight = Math.max(1, Number.isFinite(rect.height) ? rect.height : 1);
      backing = backingSize(cssWidth, cssHeight, dpr);
      canvas.width = backing.width;
      canvas.height = backing.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resizes++;
      if (typeof ResizeObserver !== "undefined") {
        // The LaneGrid scheduleFit law: the callback only marks dirty —
        // the swap happens inside the next frame callback (≤1/frame).
        resizeObserver = new ResizeObserver(() => {
          resizeDirty = true;
        });
        resizeObserver.observe(canvas);
      }
      document.addEventListener("visibilitychange", onVisibilityChange);
      if (typeof window.matchMedia === "function") {
        reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
        reducedMotion.addEventListener("change", onReducedMotionChange);
      }
      liveRenderers.add(renderer);
      apply("start");
    },
    dispose() {
      if (state === "stopped") return;
      state = nextVizLoopState(state, "stop");
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      resizeObserver = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion?.removeEventListener("change", onReducedMotionChange);
      reducedMotion = null;
      liveRenderers.delete(renderer);
      // Drop refs/callbacks — nothing may keep the canvas or the opts
      // closures alive after teardown (VZ-HU-1's checklist extends this).
      ctx = null;
      resizeDirty = false;
    },
    probe(): VizRendererProbe {
      return {
        state,
        frames,
        resizes,
        dpr,
        backing,
        reducedMotion: reducedMotion?.matches ?? false,
      };
    },
  };

  return renderer;
}
