import { COMPOSITION_KEY, type VisualComposition } from "../../src/viz/composition";
/**
 * VZ-HW-2 — the VIZ browser harness: the shared machinery every VIZ browser
 * test builds its journey on (plan.md §"VZ-HW-2"; consumed by VZ-TH-2's
 * thin-path timing probe, VZ-IM-5's fingerprint gate, VZ-HW-3's journeys and
 * VZ-TH-4's frame budget).
 *
 * WHAT THIS MODULE OWNS (all test-only; ZERO product-source changes):
 *
 * 1. BUILT-BUNDLE BOOT — page-object over the iframe law (the
 *    e2e-happy-path / frame-budget harness shape): globalSetup has already
 *    built dist/; the harness loads the exact hashed bundle users get in a
 *    fresh same-origin iframe with the IndexedDB wiped per boot (R14 law:
 *    deterministic FIRST-RUN demo — the "known pattern" every journey
 *    starts from), patches the iframe's AudioContext exactly like
 *    frame-budget's `installTestAudioContext` (worklet addModule blob-URL
 *    retry), and tears down with the R14 deleteDatabase retries.
 *
 * 2. DETERMINISTIC TRANSPORT DRIVE — `play()` / `stop()` click the REAL
 *    booth button and poll for the label law (PLAY ⇄ STOP), and `play()`
 *    returns a PlayAnchor: a BRACKETED [lo, hi] window for the transport's
 *    `timelineStart` audio-clock value, captured from window-level
 *    instrumentation only (ctx.currentTime at the click, at unlock()'s
 *    resume() resolve — hooked via the same AudioContext subclass — and at
 *    the button-flip MutationObserver microtask). `globalStepAudibleTime()`
 *    turns that anchor plus the demo's transport facts into the
 *    TRANSPORT-DERIVED AUDIBLE TIME of any global step, mirroring
 *    Transport.compileTicks' pass math (the pure time.ts laws do the
 *    per-step work). This is the deterministic seam VZ-TH-2's one-frame
 *    probe compares canvas reactions against — no wall-clock flake: every
 *    quantity lives in the audio-clock domain.
 *
 * 3. CANVAS ACTIVITY PROBE — `sampleCanvasActivity()` samples FIXED SMALL
 *    pixel regions (the plan's cost risk note) on the iframe's `.viz-canvas`
 *    at the IFRAME's own rAF cadence and timestamps every sample with BOTH
 *    the iframe's performance.now() AND a same-callback audio-clock read
 *    (the wall↔audio pairing that makes reaction-vs-audible comparisons
 *    frame-accurate). Region signatures are byte-diffed against the
 *    previous sample; a report lists change events with their regions.
 *
 * 4. MODULE ACTIVITY COUNTERS (inert, window-level — the frame-budget
 *    instrumentation class): the iframe's requestAnimationFrame is wrapped
 *    in a pure pass-through counter, so `rafCounts()` reports how many rAF
 *    callbacks the BUILT app actually fired — the open/closed DELTA is the
 *    viz renderer's loop activity, observable with no product probe needed
 *    (the in-page idiom reads `vizRendererProbes()` directly instead; see
 *    viz-mount.test.tsx). The AudioContext subclass likewise counts created
 *    contexts and resumes.
 *
 * 5. PRESET/SEED CONTROL SEAM — `bootVizApp({ vizPrefs })` seeds the REAL
 *    VZ-IM-3 memory (the product's own `writeVizPrefs` serializer + the
 *    product's own `bitbounce.viz.v1` key, imported from src/viz/persist)
 *    into the iframe's localStorage BEFORE the bundle module runs, so a
 *    seeded boot restores exactly that deal (the returning-user journey —
 *    VizPage reads the key at mount). UNSEEDED boots REMOVE the key first:
 *    same-origin localStorage is shared with every other test on this
 *    origin, so an unseeded boot must be deterministic-default no matter
 *    what an earlier file left behind.
 *
 * 6. EVIDENCE CONSOLE LINES — `vizHarnessLog()` emits machine-readable
 *    `[VZ-HW-2 <tag>] <json>` lines (the frame-budget `[TH-1 frame budget]`
 *    precedent) so CI output carries the measurements.
 *
 * SCOPE NOTE (recorded): the note-on tap (`session.subscribeNoteOns`,
 * VZ-IM-1) and the renderer's inert module probes live INSIDE the built
 * bundle's module registry and are unreachable from the tester page — by
 * design, this harness asserts only the OBSERVABLE BOUNDARY (DOM, canvas
 * pixels, window-level counters, the audio clock). Tests that need module
 * probes use the in-page mount idiom (viz-mount.test.tsx precedent) and
 * import the product modules directly.
 */

import { createDemoProject } from "../../src/document/demoSong";
import { computeLoopSteps } from "../../src/audio/render";
import { laneCycleSteps } from "../../src/audio/song";
import { LANE_IDS } from "../../src/document/schema";
import { secondsPerStep, timeAtStep } from "../../src/audio/time";
import {
  VIZ_PREFS_STORAGE_KEY,
  writeVizPrefs,
} from "../../src/viz/persist";

// ---------------------------------------------------------------------------
// Constants + shared small utilities
// ---------------------------------------------------------------------------

/**
 * The transport's play lead (src/audio/transport.ts TransportOptions
 * default — the app's shared session passes no override): timelineStart =
 * ctx.currentTime + 0.1 at play(). Exported so VZ-TH-2's probe shares ONE
 * number with the anchor math.
 */
export const TRANSPORT_START_DELAY_SECONDS = 0.1;

/**
 * The REAL VZ-IM-3 localStorage key for last-preset + last-seed memory
 * (plan.md §"VZ-IM-3"), re-exported from the product module
 * (src/viz/persist.ts) so the harness and the app can never drift apart —
 * the planned-name placeholder was retired when VZ-IM-3 shipped the key.
 */
export { VIZ_PREFS_STORAGE_KEY };

/** The app's IndexedDB name (R14 teardown law). */
const DB_NAME = "bitbounce";

type IframeWindow = Window & typeof globalThis;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until `cond` (50 ms cadence); rejects with `what` on timeout. */
export function poll(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      if (cond()) return resolve();
      if (performance.now() - t0 > timeoutMs)
        return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(check, 50);
    };
    check();
  });
}

/** Machine-readable evidence line (frame-budget console-line precedent). */
export function vizHarnessLog(
  tag: string,
  record: Record<string, unknown>,
): void {
  console.log(`[VZ-HW-2 ${tag}] ${JSON.stringify(record)}`);
}

// ---------------------------------------------------------------------------
// Deterministic transport math (pure; mirrors Transport.compileTicks)
// ---------------------------------------------------------------------------

/** The transport facts a booted first-run demo runs with. */
export interface VizTransportFacts {
  readonly bpm: number;
  readonly swing: number;
  /** Steps per scheduler pass = totalSteps(loopBars) — the tick grid. */
  readonly stepsPerPass: number;
  /** Straight 16th duration in seconds (secondsPerStep(bpm)). */
  readonly stepSeconds: number;
}

/**
 * The demo's transport facts, derived from the SAME source the built app
 * loads on first run (src/document/demoSong — deterministic after the IDB
 * wipe): bpm 112, swing 0.2; the pass grid is the LCM of lane chain totals
 * (computeLoopSteps over laneCycleSteps — the LL-2 re-basis that retired
 * deriveLoopBarsCompat; every demo lane is a 4-bar single, so this equals
 * the old 64-step pass for the demo).
 */
export function demoTransportFacts(): VizTransportFacts {
  const doc = createDemoProject();
  return {
    bpm: doc.transport.bpm,
    swing: doc.transport.swing,
    stepsPerPass: computeLoopSteps(
      LANE_IDS.map((lane) => laneCycleSteps(doc, lane)),
    ),
    stepSeconds: secondsPerStep(doc.transport.bpm),
  };
}

/**
 * A BRACKETED audio-clock window for the transport's `timelineStart`
 * (the absolute audio time at which global step 0 sounds): `lo` comes from
 * the last ctx.currentTime read at-or-before transport.play()'s own read —
 * at the click, synchronously after the click dispatch, or at unlock()'s
 * resume-resolve when it ran — and `hi` from the first observed play-button
 * flip, a MutationObserver microtask after `transport.play()` emitted, so
 * at most a few render quanta later. The true timelineStart lies within
 * [lo, hi] + TRANSPORT_START_DELAY.
 */
export interface PlayAnchor {
  /** ctx.currentTime read synchronously at the PLAY click (null if no context existed yet). */
  readonly ctxAtClick: number | null;
  /**
   * ctx.currentTime read synchronously AFTER the click dispatch returned —
   * still before the transport's play() microtask runs, so a true lower
   * bound even when the context was created DURING the dispatch (the
   * engine's lazy first getContext inside unlock()).
   */
  readonly ctxAfterClick: number | null;
  /** ctx.currentTime right after unlock()'s resume() resolved (null when the context was already running — CI's no-user-gesture autoplay flag makes fresh contexts start running, so unlock may skip resume entirely). */
  readonly ctxAfterResume: number | null;
  /** ctx.currentTime at the button-flip microtask (upper bound). */
  readonly ctxAtFlip: number;
  /** timelineStart lower bound (audio-clock seconds). */
  readonly timelineStartLo: number;
  /** timelineStart upper bound (audio-clock seconds). */
  readonly timelineStartHi: number;
}

/**
 * Transport-derived AUDIBLE TIME of a global step, as a bracketed window
 * (anchor uncertainty carried through). Mirrors Transport.compileTicks:
 * global step g sounds at timelineStart + passIndex·(stepsPerPass·stepDur)
 * + timeAtStep(stepInPass, groove) — the pure time.ts swing law does the
 * per-step work; the pass advance is the straight step duration (the
 * transport's own arithmetic, not a restatement of swing).
 */
export function globalStepAudibleTime(
  globalStep: number,
  facts: VizTransportFacts,
  anchor: PlayAnchor,
): { readonly lo: number; readonly hi: number } {
  const pass = Math.floor(globalStep / facts.stepsPerPass);
  const inPass = globalStep - pass * facts.stepsPerPass;
  const base =
    pass * facts.stepsPerPass * facts.stepSeconds +
    timeAtStep(inPass, { bpm: facts.bpm, swing: facts.swing });
  return {
    lo: anchor.timelineStartLo + base,
    hi: anchor.timelineStartHi + base,
  };
}

// ---------------------------------------------------------------------------
// Canvas activity probe (fixed small regions, iframe-rAF cadence)
// ---------------------------------------------------------------------------

/** A sampled region, positioned by FRACTION of the backing store. */
export interface CanvasRegionSpec {
  readonly name: string;
  readonly fx: number;
  readonly fy: number;
  /** Region edge in backing-store pixels (square). */
  readonly size: number;
}

/** Default regions: center + two diagonals — small, spread, cheap. */
export const DEFAULT_CANVAS_REGIONS: readonly CanvasRegionSpec[] = [
  { name: "center", fx: 0.5, fy: 0.5, size: 8 },
  { name: "low-left", fx: 0.25, fy: 0.75, size: 8 },
  { name: "high-right", fx: 0.75, fy: 0.25, size: 8 },
];

/** One rAF-timed sample: when it ran, the audio clock beside it, changes. */
export interface CanvasActivitySample {
  /** iframe performance.now() at the sample. */
  readonly t: number;
  /** Live ctx.currentTime read in the SAME rAF callback (null pre-audio). */
  readonly audio: number | null;
  /** Regions whose byte signature differs from the previous sample. */
  readonly regions: readonly string[];
}

export interface CanvasActivityReport {
  readonly samples: readonly CanvasActivitySample[];
  /** Samples with at least one changed region, in order. */
  readonly changes: readonly CanvasActivitySample[];
  /** Cumulative per-region change counts. */
  readonly regionChangeCounts: Readonly<Record<string, number>>;
  readonly regionCount: number;
  /** Backing pixels read per sample (cost evidence: regions × size²). */
  readonly pixelsPerSample: number;
  readonly durationMs: number;
  readonly sampleHz: number;
}

export interface CanvasActivityOptions {
  readonly durationMs?: number;
  readonly regions?: readonly CanvasRegionSpec[];
}

/** Byte signature of one region of the canvas backing store. */
function readRegionSignature(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  spec: CanvasRegionSpec,
): number[] | null {
  const x = Math.min(
    Math.max(0, Math.round(spec.fx * canvas.width) - (spec.size >> 1)),
    Math.max(0, canvas.width - spec.size),
  );
  const y = Math.min(
    Math.max(0, Math.round(spec.fy * canvas.height) - (spec.size >> 1)),
    Math.max(0, canvas.height - spec.size),
  );
  if (canvas.width < 1 || canvas.height < 1) return null;
  const w = Math.min(spec.size, canvas.width - x);
  const h = Math.min(spec.size, canvas.height - y);
  if (w < 1 || h < 1) return null;
  const data = ctx.getImageData(x, y, w, h).data;
  return Array.from(data);
}

// ---------------------------------------------------------------------------
// Window-level instrumentation (inert counters; the AudioContext subclass is
// frame-budget's installTestAudioContext extended with capture + resume hook)
// ---------------------------------------------------------------------------

interface IframeInstrumentation {
  /** Every real AudioContext the built app created, in creation order. */
  readonly contexts: AudioContext[];
  resumes: number;
  /** ctx.currentTime read right after the last resume() resolved. */
  ctxAfterResume: number | null;
  rafArms: number;
  rafCallbacks: number;
  rafCancels: number;
}

/**
 * Patch one context's worklet addModule (a plain /assets/... fetch the vite
 * pipeline only serves through the module path) so it retries via a blob
 * URL built from the pipeline-served module — the worklet code stays the
 * EXACT built asset. Byte-for-byte frame-budget's installTestAudioContext
 * retry, factored out per context.
 */
function retryWorkletModule(win: IframeWindow, ctx: AudioContext): void {
  const aw = ctx.audioWorklet;
  const origAddModule = aw.addModule.bind(aw);
  aw.addModule = async (url: string) => {
    try {
      await origAddModule(url);
    } catch {
      const candidates = [
        url,
        url.replace(/^([a-z]+:\/\/[^/]+)?\/assets\//, "$1/dist/assets/"),
      ];
      let text: string | null = null;
      for (const candidate of candidates) {
        const res = await win.fetch(
          `${candidate}${candidate.includes("?") ? "&" : "?"}import`,
        );
        if (
          res.ok &&
          (res.headers.get("content-type") ?? "").includes("javascript")
        ) {
          text = await res.text();
          break;
        }
      }
      if (text === null) throw new Error(`worklet module fetch failed: ${url}`);
      await origAddModule(
        win.URL.createObjectURL(
          new win.Blob([text], { type: "text/javascript" }),
        ),
      );
    }
  };
}

function instrumentIframeWindow(win: IframeWindow): IframeInstrumentation {
  const state: IframeInstrumentation = {
    contexts: [],
    resumes: 0,
    ctxAfterResume: null,
    rafArms: 0,
    rafCallbacks: 0,
    rafCancels: 0,
  };

  // (a) AudioContext subclass — frame-budget's installTestAudioContext
  // exactly (constructor-attached worklet blob-URL retry), EXTENDED with
  // instance capture (the audioNow seam) and a resume() hook (the play
  // anchor's tightest lower bound). No other semantics touched.
  const OrigAudioContext = win.AudioContext;
  class HarnessAudioContext extends OrigAudioContext {
    constructor(
      ...args: ConstructorParameters<typeof OrigAudioContext>
    ) {
      super(...args);
      state.contexts.push(this as unknown as AudioContext);
      retryWorkletModule(win, this as unknown as AudioContext);
    }

    override async resume(): Promise<void> {
      await super.resume();
      state.resumes++;
      state.ctxAfterResume = this.currentTime;
    }
  }
  win.AudioContext =
    HarnessAudioContext as unknown as typeof AudioContext;

  // (b) rAF pass-through counter (module activity counter for the BUILT
  // bundle: the viz loop's arms are invisible from outside otherwise).
  const origRaf = win.requestAnimationFrame.bind(win);
  win.requestAnimationFrame = ((
    cb: FrameRequestCallback,
  ): number => {
    state.rafArms++;
    return origRaf((t) => {
      state.rafCallbacks++;
      cb(t);
    });
  }) as typeof win.requestAnimationFrame;
  const origCancel = win.cancelAnimationFrame.bind(win);
  win.cancelAnimationFrame = ((id: number): void => {
    state.rafCancels++;
    origCancel(id);
  }) as typeof win.cancelAnimationFrame;

  return state;
}

// ---------------------------------------------------------------------------
// The page object
// ---------------------------------------------------------------------------

export interface VizPrefsSeed {
  readonly presetId: string;
  readonly seed: number;
}

export interface VizAppOptions {
  readonly composition?: VisualComposition;
  /** Iframe CSS size (default 1280×960, the e2e harness default). */
  readonly width?: number;
  readonly height?: number;
  /** Pre-boot preset/seed localStorage seam (the VZ-IM-3 restore journey). */
  readonly vizPrefs?: VizPrefsSeed;
}

export interface VizAppHarness {
  readonly iframe: HTMLIFrameElement;
  readonly win: IframeWindow;
  readonly facts: VizTransportFacts;
  doc(): Document;
  /** Query inside the iframe (throws with the selector on a miss). */
  $<El extends Element>(sel: string): El;
  $$<El extends Element>(sel: string): El[];
  /** Live ctx.currentTime of the app's audio clock (throws before play). */
  audioNow(): number;
  /** Same read, null-safe (for paired sampling pre-play). */
  audioNowOrNull(): number | null;
  /** Window-level activity counters (contexts/resumes/rAF arms+fires). */
  instrument(): {
    readonly contextCount: number;
    readonly resumes: number;
    readonly rafArms: number;
    readonly rafCallbacks: number;
    readonly rafCancels: number;
  };
  /** PLAY via the real booth button → PlayAnchor (throws if already playing). */
  play(): Promise<PlayAnchor>;
  /** STOP via the real booth button (throws if already stopped). */
  stop(): Promise<void>;
  /** Transport playing, by the button-label law (STOP = playing). */
  playing(): boolean;
  /** Open VIZ via the real booth button → the `.viz-canvas` element. */
  openViz(): Promise<HTMLCanvasElement>;
  /** Close VIZ via Escape into the iframe (VizPage's capture exit). */
  closeViz(): Promise<void>;
  /** VIZ mounted right now. */
  vizOpen(): boolean;
  /** The `.viz-canvas` (throws while closed). */
  canvas(): HTMLCanvasElement;
  /** rAF-cadence pixel probe over fixed small regions (see CanvasActivityReport). */
  sampleCanvasActivity(opts?: CanvasActivityOptions): Promise<CanvasActivityReport>;
  /** Synchronous region signatures (detector-sensitivity checks). */
  readCanvasRegions(
    regions?: readonly CanvasRegionSpec[],
  ): Record<string, number[] | null>;
  /** Dispatch Escape at the iframe's focused element (or body). */
  pressEscape(): void;
  /** Deterministic density shaping: toggle cells via real UI clicks. */
  clickCells(
    lane: string,
    rows: readonly number[],
    steps: readonly number[],
  ): void;
  /** R14 teardown: best-effort stop, unseed localStorage, remove iframe, wipe IDB. */
  teardown(): Promise<void>;
}

/** The production bundle built by tests/browser/globalSetup.ts (hashed). */
const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

/**
 * Boot the REAL built app in a fresh same-origin iframe with a wiped IDB
 * (deterministic first-run demo — the known pattern), instrumented for
 * audio-clock capture + rAF counting, optionally pre-seeding the VZ-IM-3
 * preset/seed localStorage key before the bundle module runs.
 */
export async function bootVizApp(
  opts: VizAppOptions = {},
): Promise<VizAppHarness> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  if (!bundleKey || !cssKey)
    throw new Error("built bundle missing (globalSetup build failed?)");

  const width = opts.width ?? 1280;
  const height = opts.height ?? 960;

  const iframe = document.createElement("iframe");
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;

  const state = instrumentIframeWindow(win);

  // Preset/seed seam (VZ-IM-3, LIVE): seeded boots simulate a previous
  // session's persisted envelope through the PRODUCT's own serializer +
  // key (byte-exact what the app writes); unseeded boots REMOVE the key so
  // the default deal is deterministic even when an earlier test on this
  // shared origin left one behind (VizPage reads it at mount).
  try {
    if(opts.composition) win.localStorage.setItem(COMPOSITION_KEY, JSON.stringify(opts.composition));
    else win.localStorage.removeItem(COMPOSITION_KEY);
    if (opts.vizPrefs) {
      writeVizPrefs(
        {
          version: 1,
          presetId: opts.vizPrefs.presetId,
          seed: opts.vizPrefs.seed,
        },
        win.localStorage,
      );
    } else {
      win.localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
    }
  } catch {
    /* storage unavailable — default boot, the app's own fallback law */
  }

  // R14 hygiene: wipe before boot (deterministic first-run demo).
  await new Promise<void>((resolve) => {
    const req = win.indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

  const doc0 = iframe.contentDocument!;
  doc0.open();
  doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
  doc0.close();

  const doc = (): Document => iframe.contentDocument!;
  const $ = <El extends Element>(sel: string): El => {
    const el = doc().querySelector<El>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  const $$ = <El extends Element>(sel: string): El[] =>
    Array.from(doc().querySelectorAll<El>(sel));

  // Boot + known-pattern signal: the demo rail (e2e law).
  await poll(() => !!doc().querySelector(".booth"), 15_000, "app to mount");
  await poll(
    // 2026-09-11: rail-free boot readiness — the chain moved to its own
          // SONG page, so cue labels no longer exist at boot. The drums KIT
          // readout is the stage-independent "demo loaded" signal.
          () =>
            $$(".head-ctl-value").some((v) =>
              (v as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() === "SOFT STEP",
            ),
    10_000,
    "demo cue labels in the rail (first-run demo)",
  );

  const audioCtx = (): AudioContext | null => state.contexts[0] ?? null;
  const audioNowOrNull = (): number | null =>
    audioCtx()?.currentTime ?? null;
  const audioNow = (): number => {
    const ctx = audioCtx();
    if (!ctx)
      throw new Error(
        "no AudioContext yet — call play() first (the engine creates it at first play)",
      );
    return ctx.currentTime;
  };

  const playBtn = (): HTMLButtonElement =>
    $<HTMLButtonElement>(".booth-btn-play");
  const vizBtn = (): HTMLButtonElement =>
    $<HTMLButtonElement>(".booth-btn-viz");

  const playing = (): boolean => playBtn().textContent?.trim() === "STOP";

  const play = async (): Promise<PlayAnchor> => {
    if (playing()) throw new Error("play(): transport already playing");
    const ctxAtClick = audioNowOrNull();
    // Flip observation at microtask tightness: the label change is the
    // transport's synchronous emit after play() read currentTime.
    let ctxAtFlip: number | null = null;
    const observer = new MutationObserver(() => {
      if (ctxAtFlip === null && playing()) ctxAtFlip = audioNowOrNull();
    });
    observer.observe(playBtn(), {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    playBtn().click();
    // Read BEFORE any await: the click dispatch returns before the
    // transport's play() microtask runs (togglePlay's first await hops a
    // microtask), so this is still a true lower bound of play()'s own
    // currentTime read — including the case where the lazy context was
    // created during the dispatch itself.
    const ctxAfterClick: number | null = audioNowOrNull();
    try {
      await poll(() => playing(), 5_000, "transport to start (button STOP)");
    } finally {
      observer.disconnect();
    }
    const flip = ctxAtFlip ?? audioNowOrNull();
    if (flip === null) throw new Error("play(): flip observed but no AudioContext");
    const afterResume = state.ctxAfterResume;
    // Lower bound: the LATEST of the click, post-dispatch and resume-resolve
    // reads that is still ≤ the flip read (monotonic audio clock).
    const candidates = [ctxAtClick, ctxAfterClick, afterResume].filter(
      (v): v is number =>
        v !== null && Number.isFinite(v) && v <= flip,
    );
    const lo = candidates.length > 0 ? Math.max(...candidates) : flip;
    return {
      ctxAtClick,
      ctxAfterClick,
      ctxAfterResume: afterResume,
      ctxAtFlip: flip,
      timelineStartLo: lo + TRANSPORT_START_DELAY_SECONDS,
      timelineStartHi: flip + TRANSPORT_START_DELAY_SECONDS,
    };
  };

  const stop = async (): Promise<void> => {
    if (!playing()) throw new Error("stop(): transport not playing");
    playBtn().click();
    await poll(
      () => !playing(),
      5_000,
      "transport to stop (button PLAY)",
    );
  };

  const vizOpen = (): boolean => doc().querySelector(".viz-page") !== null;
  const canvas = (): HTMLCanvasElement =>
    $<HTMLCanvasElement>(".viz-canvas");

  const openViz = async (): Promise<HTMLCanvasElement> => {
    if (vizOpen()) throw new Error("openViz(): VIZ already open");
    vizBtn().click();
    await poll(() => vizOpen(), 5_000, "viz page to mount");
    await poll(
      () => canvas().width > 1 && canvas().height > 1,
      5_000,
      "viz canvas backing store to size",
    );
    // The initial backing sizing is synchronous at start(), but the FIRST
    // PAINT happens at the renderer's first rAF callback (the viz-mount
    // `frames > 0` law) — the renderer armed before this await, so its
    // callback runs first and the ground has landed by the second tick.
    await new Promise<void>((resolve) => {
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()));
    });
    return canvas();
  };

  const pressEscape = (): void => {
    const d = doc();
    const target = d.activeElement ?? d.body;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const closeViz = async (): Promise<void> => {
    if (!vizOpen()) throw new Error("closeViz(): VIZ not open");
    pressEscape();
    await poll(() => !vizOpen(), 5_000, "viz page to unmount (Escape)");
  };

  const regionsOf = (
    regions?: readonly CanvasRegionSpec[],
  ): readonly CanvasRegionSpec[] =>
    regions && regions.length > 0 ? regions : DEFAULT_CANVAS_REGIONS;

  const readCanvasRegions = (
    regions?: readonly CanvasRegionSpec[],
  ): Record<string, number[] | null> => {
    const cnv = canvas();
    const ctx = cnv.getContext("2d");
    if (!ctx) throw new Error("viz canvas has no 2d context");
    const out: Record<string, number[] | null> = {};
    for (const spec of regionsOf(regions))
      out[spec.name] = readRegionSignature(ctx, cnv, spec);
    return out;
  };

  const sampleCanvasActivity = async (
    sOpts: CanvasActivityOptions = {},
  ): Promise<CanvasActivityReport> => {
    const cnv = canvas();
    const ctx = cnv.getContext("2d");
    if (!ctx) throw new Error("viz canvas has no 2d context");
    const regions = regionsOf(sOpts.regions);
    const durationMs = sOpts.durationMs ?? 1500;
    const samples: CanvasActivitySample[] = [];
    const regionChangeCounts: Record<string, number> = {};
    for (const r of regions) regionChangeCounts[r.name] = 0;
    let previous: Record<string, number[] | null> | null = null;
    // Sample on the IFRAME's rAF queue: same frame clock the renderer
    // re-arms on, so a draw at frame N is readable at N's sample pass.
    await new Promise<void>((resolve) => {
      const t0 = win.performance.now();
      const frame = (): void => {
        const t = win.performance.now();
        const audio = audioNowOrNull();
        const changed: string[] = [];
        const now: Record<string, number[] | null> = {};
        for (const spec of regions) {
          const sig = readRegionSignature(ctx, cnv, spec);
          now[spec.name] = sig;
          const prev = previous?.[spec.name];
          if (previous && sig !== null && prev !== null) {
            let diff = sig.length !== prev.length;
            if (!diff) {
              for (let i = 0; i < sig.length; i++) {
                if (sig[i] !== prev[i]) {
                  diff = true;
                  break;
                }
              }
            }
            if (diff) {
              changed.push(spec.name);
              regionChangeCounts[spec.name]!++;
            }
          }
        }
        previous = now;
        samples.push({ t, audio, regions: changed });
        if (t - t0 < durationMs) win.requestAnimationFrame(frame);
        else resolve();
      };
      win.requestAnimationFrame(frame);
    });
    const changes = samples.filter((s) => s.regions.length > 0);
    const span = samples.length > 1 ? samples[samples.length - 1]!.t - samples[0]!.t : 0;
    const pixelsPerSample = regions.reduce((n, r) => n + r.size * r.size, 0);
    return {
      samples,
      changes,
      regionChangeCounts,
      regionCount: regions.length,
      pixelsPerSample,
      durationMs: span,
      sampleHz: span > 0 ? (samples.length / span) * 1000 : 0,
    };
  };

  const clickCells = (
    lane: string,
    rows: readonly number[],
    steps: readonly number[],
  ): void => {
    for (const row of rows) {
      for (const step of steps) {
        $(
          `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
        ).click();
      }
    }
  };

  const teardown = async (): Promise<void> => {
    try {
      if (playing()) playBtn().click();
    } catch {
      /* iframe may already be gone on failure paths */
    }
    try {
      win.localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
      win.localStorage.removeItem(COMPOSITION_KEY);
    } catch {
      /* iframe may already be gone */
    }
    iframe.remove();
    for (let attempt = 0; ; attempt++) {
      const deleted = await new Promise<boolean>((resolve) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(true);
        req.onblocked = () => resolve(false);
      });
      if (deleted || attempt >= 20) break;
      await sleep(100);
    }
  };

  return {
    iframe,
    win,
    facts: demoTransportFacts(),
    doc,
    $,
    $$,
    audioNow,
    audioNowOrNull,
    instrument: () => ({
      contextCount: state.contexts.length,
      resumes: state.resumes,
      rafArms: state.rafArms,
      rafCallbacks: state.rafCallbacks,
      rafCancels: state.rafCancels,
    }),
    play,
    stop,
    playing,
    openViz,
    closeViz,
    vizOpen,
    canvas,
    sampleCanvasActivity,
    readCanvasRegions,
    pressEscape,
    clickCells,
    teardown,
  };
}
