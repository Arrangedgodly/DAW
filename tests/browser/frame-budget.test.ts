/**
 * TH-1 + TH-4 browser frame-budget gates (REAL built app).
 *
 * Approach (recorded choice): the tester page's HTTP module path cannot run
 * the solid JSX transform on .tsx sources, so mounting App from source
 * in-page is not reliable. Instead the globalSetup builds the production
 * bundle and every test here loads the BUILT app (the exact code users get,
 * with the real Session/audio path, the rAF playhead loops of all four
 * LaneGrids, and the store → bridge → recompile pipeline driven through real
 * DOM cell clicks) inside a fresh same-origin iframe — same harness shape as
 * the journey tests, so the app's IndexedDB connections close on iframe
 * removal (R14 teardown; the outer-page mount previously left autosaved
 * toggle state in the shared-origin DB with no way to close its connections).
 *
 * Budgets (30 fps floor on CI hardware — the true 60 fps gate runs in e2e
 * later if needed; choice recorded in docs/dev/perf-budget.md):
 *   - ≥95% of frame intervals < 33.4 ms while playing + editing (HARD)
 *   - every toggle batch blocks the event loop < 50 ms (long-task guard)
 *
 * Load-robustness law (HW-4 deflake): the 33.4 ms frame bound stays hard;
 * only the playhead liveness COUNT is relaxed — under machine load rAF
 * itself slows (fewer, longer frames — which the budget ratio already
 * polices), so proving "the transport really ran" needs only ≥2 distinct
 * playhead transforms per second of measurement, not a per-frame cadence.
 *
 * TH-4 (iteration 2) extends the same harness with the quadrant-layout laws:
 *   (a) QUADRANT 60fps LAW — all 4 lanes playing in quadrant mode with dense
 *       4-bar patterns rendering in the three VIEW-ONLY quadrants (Hulk's
 *       mini-lane extreme), ≥16 sustained voices, an FX device on every
 *       lane, live playheads in all four quadrants; ≥95% frames < 33.4 ms.
 *   (b) DRAG POINTERMOVE BUDGETS — a pointermove storm (drag-create preview,
 *       edge resize, drums paint, rail cue sweep) DURING PLAYBACK keeps the
 *       frame budget, every dispatched move blocks < 50 ms, and mid-gesture
 *       DOM mutations are preview-only (commit-on-release law = no layout
 *       thrash: zero store writes while the pointer moves). Real browsers
 *       coalesce pointermove to rAF; the storm dispatches 4 moves per frame
 *       (~240/s) as the conservative un-coalesced worst case.
 *   (c) HELP MODE OFF = BASELINE — every measurement above runs with help
 *       mode OFF (the default state; asserted: no help surface mounted).
 *       HP-1's zero-cost clause is pinned here: when help mode lands it must
 *       keep these gates green with the mode off — no listeners, rAF loops,
 *       or reactive subscriptions while off (docs/dev/perf-budget.md §7).
 *   (d) LAZY-CONTENT BUDGET — with same-origin sample content (PS-2/PS-4,
 *       RES-10) the FIRST PAINT and PLAY must never await an asset fetch or
 *       decode. The gate simulates the content NOW: every audio-asset fetch
 *       and every decodeAudioData stalls CONTENT_STALL_MS; paint and PLAY
 *       must still land far inside the stall, and no audio-asset fetch may
 *       happen on the boot→play path at all (lazy = on explicit preset
 *       selection, and even then never blocking).
 *
 * MB-5 (mobile slice M17, town-hall m5 "performance at mobile scale
 * documented and gated") extends the same harness to the PHONE stage at
 * 390×844 (MB-1's single-lane stage: one lane floor, the lane switcher, the
 * condensed rail, sticky chrome — the page scrolls):
 *   (m-a) PHONE FRAME BUDGET — ≥95% of frames < 33.4 ms while ALL FOUR lanes
 *         play dense 4-bar chains (the audio state is viewport-independent)
 *         and the phone edits + scrolls: cell toggles, vertical page scroll
 *         under the sticky chrome (repaint law), and horizontal grid scroll
 *         (scroll is the phone law, so it is budgeted, not assumed), in the
 *         densest phone-realistic state — sample-backed sounds on, an FX
 *         device on every lane, sustained note-runs rendering, the euclid
 *         fill overlay REVEALED (the FILL toggle — phone/tablet only), help
 *         mode off.
 *   (m-b) DRAG STORMS AT PHONE WIDTH — the four TH-4 (b) gesture storms
 *         (drag-create preview, edge resize, drums paint, rail cue sweep)
 *         during playback at 390×844 keep the same laws: frame budget,
 *         per-move block + median budgets, zero non-preview DOM mutations
 *         mid-gesture (commit-on-release).
 *   (m-c) VOICE/LAZY-CONTENT AT MOBILE — selecting a sample-backed sound
 *         MID-PLAYBACK fires the lazy content chunk + fetch + decode OFF the
 *         critical path: the frame budget holds while the decode lands,
 *         playback never stops, and no audio-asset fetch happened before the
 *         selection (no eager fetch on the mobile path). Voice budget
 *         UNCHANGED by mobile: 8 voices/lane, 32 total (the sample host
 *         mirrors the worklet pool — asserted against the engine constants;
 *         the audio graph has no viewport branch).
 *
 * TH-5 (iteration 3) — the CONSOLIDATED PERF GATE FAMILY at the long-loop
 * scale (LP-1's browser-spike HARD laws folded here per its scope, plus the
 * FV-1 perf half and the XP-1 export ceiling; docs/dev/perf-budget.md §10):
 *   (a)  LONG-LANE PLAYBACK — all 4 lanes playing MIXED-length chains incl.
 *        a dense 128-bar lead (LP-1's denseLead128Doc shape, imported
 *        through the REAL OPEN FILE path): ≥95% frames < 33.4 ms pure
 *        rendering with every lane's playhead sweeping at its OWN cycle
 *        length (the LL-2 poly-loop visual under load), the register-window
 *        fling sweep on the 2048-column grid, and per-edit blocks < 50 ms
 *        (the long-task guard, re-pinned §10c). Phone twin at 390×844.
 *   (b)  VIRTUALIZATION LAWS — the DOM census stays window-bounded (< 10k
 *        cells; eager at this state is 38,208) while every long-pattern
 *        scroller keeps its PATTERN-WIDE native extent (the sizer), the
 *        census tracks the WINDOW not the pattern (a 4× pattern grow moves
 *        it ~0), and rewindows during the sweep re-tag the pool without
 *        churn (census constant, window origin moved). The bounded
 *        time-math's law is the per-toggle guard: the retired O(steps)
 *        scan measured 276-438 ms per edit at this state; the O(1) lookup
 *        sits at 10-21 ms — the < 50 ms assert IS the no-linear-scans gate.
 *   (c)  EXPORT-COST CEILING — the 64-bar gate render (musical density,
 *        the REAL offline pipeline) stays under the pinned wall-time
 *        ceiling (a regression ceiling from measured numbers, not a UX
 *        promise; XP-1's 128-bar worst case stays the recorded determinism
 *        probe in audio-determinism — CI-cost discipline). Source-mount
 *        block (the LP-1 (d) precedent — the render pipeline under test is
 *        the same source the globalSetup builds).
 *   (d)  WIDTH-UTILIZATION PERF — the densified 1920×1080 stage (FV-1's
 *        stage; the utilization law itself is viewport-utilization.test.ts)
 *        holds the frame budget while playing.
 *
 * FLING DE-FLAKE (the LP-1 verifier's flag: the fling sweep is the one
 * load-sensitive committed assert — 88.9% < 95% ONLY under a foreign
 * battery's full-parallel load, 99.2-100% in every quieter run): the ratio
 * stays HARD; the gates wait for a QUIET MACHINE before the measured sweep
 * (waitForQuietRaf — an idle calibration window must itself hold the frame
 * law at a sane cadence, else settle and re-poll). Never a threshold
 * loosening; if the machine never goes quiet the assert fails LOUD (the
 * MB-6 stance).
 *
 * HONESTY CAVEAT (reduced expectations, documented in perf-budget.md §9):
 * CI Chromium runs on desktop-class hardware EMULATING the 390×844 viewport.
 * These gates catch REGRESSIONS (layout thrash, reactive playheads, blocking
 * decodes at the phone paint load) — they are NOT a device-class verdict for
 * mid-tier Android Chrome; real-device verification stays with the user's
 * R12-style human session, and low-end Android perf stays on the Strange
 * risk register. Tolerances follow the TH-4 approach: the 33.4 ms ratio is
 * HARD, liveness counts are load-robust (≥2/s).
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
// MB-5 (m-c): the voice budget is UNCHANGED by mobile — pinned against the
// engine constants the app runs (8/lane on BOTH hosts → 32 total). The audio
// graph has no viewport branch (src/audio + engineBridge never read the
// stage mode), so this import is the engine's law, not a test-local copy.
import {
  SAMPLE_VOICES_PER_LANE,
  VOICES_PER_LANE,
} from "../../src/audio/voiceEngine";
// TH-5 (a)(b): the dense mixed-chain document (LP-1's committed builder)
// serialized through the REAL canonical codec, imported through the REAL
// OPEN FILE path — the built app itself owns the state under measurement.
// TH-5 (c): the real offline render pipeline (source-mount block — the
// LP-1 (d) precedent; globalSetup builds this exact source).
import { encode } from "../../src/document/codec";
import { renderProjectToBuffer } from "../../src/audio/render";
import { denseLead128Doc, longLoopDoc } from "../lp1-spike-harness";

const FRAME_BUDGET_MS = 33.4; // ~30 fps floor — HARD bound
const FRAME_PASS_RATIO = 0.95;
const TOGGLE_BLOCK_BUDGET_MS = 50;
const MEASURE_MS = 4000;
const TOGGLE_COUNT = 200;
// ≥2 distinct playhead transforms per second proves the audio clock drives
// the rAF playhead even on a heavily loaded runner (60 fps would give ~60/s).
const MIN_PLAYHEAD_MOVES_PER_SEC = 2;

// TH-4 (iteration 2) budgets — see the file header.
const VIEW_W = 1440; // the LY-1 quadrant viewport (one-page law)
const VIEW_H = 900;
const STORM_WINDOW_MS = 1500; // per-gesture storm window
const STORM_MOVES_PER_FRAME = 4; // ~240 synthetic moves/s at 60 fps
const MOVE_BLOCK_BUDGET_MS = 50; // long-task guard per dispatched pointermove
const MEDIAN_MOVE_BUDGET_MS = 8; // median dispatch must sit far below a frame
const CONTENT_STALL_MS = 4000; // simulated same-origin asset fetch/decode stall
const PAINT_BUDGET_MS = 3000; // first paint must beat the stall comfortably
const PLAY_BUDGET_MS = 3000; // PLAY → transport running must beat it too

// MB-5 (iteration-2 mobile slice) — the phone stage viewport (m1's committed
// Android-Chrome target; MB-1's responsive stage keys off it).
const PHONE_W = 390;
const PHONE_H = 844;
const PHONE_WINDOW_MS = 2000; // per-window measurement inside (m-a)

// TH-5 (iteration 3) — the long-loop-scale family (see the file header).
// The virtualization census law (LP-1 §10a as landed by LL-1): DOM cells
// stay window-bounded at any pattern size. Eager at the dense-128 state
// would be 6×1024 + 7×64 + 7×128 + 15×2048 = 38,208 (LL-1 measured the
// windowed production census at 1,616 = 4.2% of that).
const LONG_CENSUS_MAX = 10_000;
const EAGER_CENSUS_DENSE_128 = 38_208;
const LONG_SWEEP_MS = 2000; // the 2048-column fling window
// The 64-bar export gate render's wall-time ceiling (TH-5 (c)) — a
// REGRESSION ceiling pinned from the measured band with ~3× headroom
// (perf-budget.md §10d records the method + date; XP-1's through-app busy
// window measured 2.3-2.5 s, LP-1's musical-density offline renders
// 6.2-8.5 s; an algorithmic regression (e.g. the retired scan class) is
// 10-100×, far past this line).
const EXPORT64_CEILING_MS = 25_000;

// The production bundle built by tests/browser/globalSetup.ts. The glob is
// resolved by vite at transform time; the hashed name changes per build.
const bundle = import.meta.glob("/dist/assets/index-*.js");
const cssFiles = import.meta.glob("/dist/assets/index-*.css");

const LANES = ["drums", "bass", "chords", "lead"] as const;

interface FrameStats {
  intervals: number[];
  toggleBlocks: number[];
  playheadMoves: number;
  buttonLabel: string;
}

// ---------------------------------------------------------------------------
// Shared harness (extracted from the v0 test byte-for-byte in behavior)
// ---------------------------------------------------------------------------

type IframeWindow = Window & typeof globalThis;

function poll(
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

/**
 * Patch the IFRAME window's AudioContext so the built bundle's worklet
 * addModule (a plain /assets/... fetch that the vite dev server only serves
 * through the module pipeline) retries via a blob URL built from the
 * pipeline-served module — the worklet code is the exact built asset.
 * `protoHook` lets a test additionally instrument the context prototype
 * (TH-4 (d) stalls decodeAudioData).
 */
function installTestAudioContext(
  win: IframeWindow,
  protoHook?: (proto: Record<string, unknown>) => void,
): void {
  const OrigAudioContext = win.AudioContext;
  class TestAudioContext extends OrigAudioContext {
    constructor(...args: ConstructorParameters<typeof OrigAudioContext>) {
      super(...args);
      const aw = this.audioWorklet;
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
          if (text === null)
            throw new Error(`worklet module fetch failed: ${url}`);
          await origAddModule(
            win.URL.createObjectURL(
              new win.Blob([text], { type: "text/javascript" }),
            ),
          );
        }
      };
    }
  }
  if (protoHook)
    protoHook(TestAudioContext.prototype as unknown as Record<string, unknown>);
  win.AudioContext = TestAudioContext as unknown as typeof AudioContext;
}

interface BootResult {
  readonly iframe: HTMLIFrameElement;
  readonly win: IframeWindow;
  readonly doc: () => Document;
  /** performance.now() taken immediately before the module document write. */
  readonly writeStart: number;
  /** ms from the document write to `.booth` mounted (first paint of the app). */
  readonly bootMs: number;
  readonly playBtn: () => HTMLButtonElement;
  readonly teardown: () => Promise<void>;
}

/**
 * Boot the REAL built app in a fresh same-origin iframe (IDB wiped first —
 * deterministic first-run demo). `beforeWrite` patches the iframe window
 * before the app module is written (fetch instrumentation for TH-4 (d)).
 */
async function bootBuiltApp(opts: {
  readonly width: number;
  readonly height: number;
  readonly beforeWrite?: (win: IframeWindow) => void;
  readonly audioProtoHook?: (proto: Record<string, unknown>) => void;
}): Promise<BootResult> {
  const bundleKey = Object.keys(bundle)[0];
  const cssKey = Object.keys(cssFiles)[0];
  expect(
    bundleKey,
    "built bundle not found (globalSetup build failed?)",
  ).toBeTruthy();
  expect(cssKey).toBeTruthy();

  const iframe = document.createElement("iframe");
  iframe.style.width = `${opts.width}px`;
  iframe.style.height = `${opts.height}px`;
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;

  installTestAudioContext(win, opts.audioProtoHook);
  opts.beforeWrite?.(win);

  // R14 hygiene: wipe before boot (deterministic first-run demo) and in
  // teardown.
  await new Promise<void>((resolve) => {
    const req = win.indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

  const writeStart = performance.now();
  const doc0 = iframe.contentDocument!;
  doc0.open();
  doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey!.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey!.replace("/dist/", "/")}"></script>
</body></html>`);
  doc0.close();

  const doc = () => iframe.contentDocument!;
  await poll(() => !!doc().querySelector(".booth"), 15000, "app never mounted");
  const bootMs = performance.now() - writeStart;

  const playBtn = () =>
    doc().querySelector<HTMLButtonElement>(".booth-btn-play")!;

  const teardown = async () => {
    // Stop playback, remove the iframe (closing its open DB connections),
    // then wipe the shared-origin DB with retries so no autosaved state
    // leaks into later same-origin boots.
    try {
      playBtn().click();
    } catch {
      /* iframe may already be gone on failure paths */
    }
    iframe.remove();
    for (let attempt = 0; ; attempt++) {
      const deleted = await new Promise<boolean>((resolve) => {
        const req = indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(true);
        req.onblocked = () => resolve(false);
      });
      if (deleted || attempt >= 20) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  return { iframe, win, doc, writeStart, bootMs, playBtn, teardown };
}

/** PLAY via the real booth button; resolves once the transport runs. */
async function clickPlayAndWait(
  app: BootResult,
  budgetMs = 5000,
): Promise<number> {
  const t0 = performance.now();
  app.playBtn().click();
  await poll(
    () => app.playBtn().textContent === "STOP",
    budgetMs,
    "transport never started",
  );
  return performance.now() - t0;
}

// ---------------------------------------------------------------------------
// Shared gesture-storm machinery (TH-4 (b) at 1440×900; MB-5 (m-b) reuses the
// exact laws at 390×844 — one law, two viewports)
// ---------------------------------------------------------------------------

/**
 * Commit-on-release = no layout thrash: while the pointer MOVES, the
 * only legal DOM mutations are renderer-local previews (data-preview
 * attrs, the dashed preview bar, the resize width, cue-preview attrs)
 * plus the always-running non-gesture loops: playback UI (playhead
 * transform, trigger glow classes, the booth's direct-DOM readout —
 * textContent writes surface as childList on the LED spans) and the
 * debounced persistence UI (.save-indicator state, fired from earlier
 * legitimate RELEASE commits). Anything else — a store-driven sync
 * (aria-selected/data-on cell flips), a rail rebuild, a focus shuffle — is
 * a mid-gesture write and FAILS the gate.
 */
function allowedMutation(m: MutationRecord): boolean {
  const t = m.target as Element;
  if (m.type === "attributes") {
    const a = m.attributeName;
    if (a === "style")
      return (
        t.classList.contains("grid-playhead") ||
        t.classList.contains("note-run")
      );
    if (a === "class") return t.classList.contains("cell");
    if (a === "data-preview") return t.classList.contains("cell");
    if (a === "data-cue-preview") return t.classList.contains("rail-tile");
    if (a === "data-active") return t.classList.contains("booth-beat-led");
    if (a === "data-status" || a === "aria-label" || a === "title")
      return t.classList.contains("save-indicator");
    return false;
  }
  if (m.type === "childList") {
    if (t.classList?.contains("note-runs") === true) return true;
    // The booth rAF readout writes textContent (node replacement).
    return (
      t.classList?.contains("booth-led") === true ||
      t.classList?.contains("booth-sr") === true
    );
  }
  if (m.type === "characterData") {
    const p = (m.target as CharacterData).parentElement;
    return (
      p !== null &&
      (p.closest(".booth") !== null || p.closest(".save-indicator") !== null)
    );
  }
  return false;
}

function describeMutation(m: MutationRecord): string {
  const t = m.target as Element;
  const name =
    m.type === "attributes"
      ? `@${m.attributeName}`
      : m.type === "childList"
        ? "childList"
        : "text";
  const tag = t.tagName ? t.tagName.toLowerCase() : "#text";
  return `${m.type}${name} on ${tag}.${String(t.className ?? "").slice(0, 50)}`;
}

interface StormWindowResult {
  readonly intervals: number[];
  readonly moveBlocks: number[];
}

/**
 * One observed gesture window: MutationObserver over the whole app document
 * for the move phase (disconnected BEFORE the release — commits are legal),
 * STORM_MOVES_PER_FRAME un-coalesced synthetic moves per rAF frame, each
 * dispatch timed synchronously. `suite` only names the console line
 * ("TH-4" / "MB-5") — the laws are identical.
 */
async function runStormWindow(
  win: IframeWindow,
  doc: () => Document,
  violations: string[],
  suite: string,
  label: string,
  begin: () => void,
  move: (i: number) => PointerEvent,
  moveTarget: () => Element,
  finish: () => void,
  sample: () => void,
): Promise<StormWindowResult> {
  const observer = new win.MutationObserver((records) => {
    for (const m of records)
      if (!allowedMutation(m) && violations.length < 25)
        violations.push(describeMutation(m));
  });
  observer.observe(doc().documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });
  begin();
  const intervals: number[] = [];
  const moveBlocks: number[] = [];
  await new Promise<void>((resolve) => {
    let i = 0;
    let last = performance.now();
    const start = last;
    const frame = () => {
      const now = performance.now();
      intervals.push(now - last);
      last = now;
      for (let k = 0; k < STORM_MOVES_PER_FRAME; k++) {
        const t0 = performance.now();
        moveTarget().dispatchEvent(move(i++));
        moveBlocks.push(performance.now() - t0);
      }
      sample();
      if (now - start < STORM_WINDOW_MS) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  observer.disconnect(); // stop BEFORE the release: commits are legal
  finish();
  const sortedMoves = [...moveBlocks].sort((a, b) => a - b);
  console.log(
    `[${suite} storm ${label}] frames=${intervals.length} ` +
      `over33.4ms=${intervals.filter((d) => d >= FRAME_BUDGET_MS).length} ` +
      `moves=${moveBlocks.length} ` +
      `worstMove=${Math.max(...moveBlocks).toFixed(2)}ms ` +
      `medianMove=${sortedMoves[Math.floor(sortedMoves.length / 2)].toFixed(2)}ms`,
  );
  return { intervals, moveBlocks };
}

// ---------------------------------------------------------------------------
// TH-5 shared machinery (iteration-3 long-loop family)
// ---------------------------------------------------------------------------

/**
 * One full programmatic horizontal sweep of `el` over `ms` (rAF-driven) —
 * the fling worst case (LP-1 §10b: ~34.8k px in 2-2.5 s ≈ 13.6-17k px/s, far
 * past any realistic wheel cadence).
 */
function sweepScroll(el: HTMLElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const max = el.scrollWidth - el.clientWidth;
    const tick = () => {
      const t = (performance.now() - start) / ms;
      el.scrollLeft = max * Math.min(1, t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/**
 * FLING DE-FLAKE (the LP-1 verifier's flag — settle/poll, NEVER threshold
 * loosening): the sweep's ≥95% ratio law stays HARD, so the gate chooses
 * WHEN to measure. An idle calibration window (500 ms, warm-up sample
 * dropped) must itself hold the frame law at a sane cadence (≥20 frames ≈
 * 40 fps, zero intervals ≥ 33.4 ms) — else settle 400 ms and re-poll, up to
 * the deadline. This is the repo's quiet-fence discipline expressed in-test:
 * under the observed foreign-battery load waves (bare vitest's concurrent
 * unit+browser projects), a quiet slot appears within seconds; if the
 * machine never quiets down we return and the HARD assert fails LOUD (the
 * documented MB-6 stance — a red flake is honest, a green lie is not).
 */
async function waitForQuietRaf(deadlineMs = 20_000): Promise<void> {
  const t0 = performance.now();
  for (;;) {
    const quiet = await new Promise<boolean>((resolve) => {
      const intervals: number[] = [];
      let last = performance.now();
      const start = last;
      const frame = () => {
        const now = performance.now();
        const d = now - last;
        last = now;
        if (intervals.length > 0) intervals.push(d); // drop the warm-up tick
        if (now - start < 500) requestAnimationFrame(frame);
        else
          resolve(
            intervals.length >= 20 &&
              intervals.every((d) => d < FRAME_BUDGET_MS),
          );
      };
      requestAnimationFrame(frame);
    });
    if (quiet) return;
    if (performance.now() - t0 > deadlineMs) return; // measure anyway — LOUD
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * Import a project document through the REAL OPEN FILE path: the hidden
 * `.projects-input` (always mounted — the popover itself need not open)
 * receives a File via DataTransfer and fires the same change handler the
 * user's OPEN FILE click drives (importProjectFile → decode → new persisted
 * project → loadDocument). The text is `encode(doc)` from the REAL codec —
 * the built app parses exactly what a saved file would carry.
 */
function importDocFile(app: BootResult, docText: string, name: string): void {
  const win = app.win;
  const file = new win.File([docText], name, { type: "application/json" });
  const dt = new win.DataTransfer();
  dt.items.add(file);
  const input = app.doc().querySelector<HTMLInputElement>(".projects-input");
  if (!input) throw new Error("missing .projects-input (Projects mount)");
  input.files = dt.files;
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
}

/** Chromium heap probe (LP-1 (d) precedent; undefined where unavailable). */
function heapUsed(): number | undefined {
  return (performance as { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize;
}

/** The rail badge a lane's first tile carries ("<bars>B" — the LL-1 law). */
function railBadge(doc: () => Document, lane: string): string {
  return (
    doc()
      .querySelector(
        `.rail-row[data-lane="${lane}"] .rail-tile .rail-tile-bars`,
      )
      ?.textContent ?? ""
  );
}

// ---------------------------------------------------------------------------
// v0 baseline (TH-1) — unchanged law, refactored onto the shared harness
// ---------------------------------------------------------------------------

describe("frame budget (built app, playing + 200 toggles)", () => {
  it(
    "keeps ≥95% of frames under 33.4 ms and toggles block < 50 ms",
    { timeout: 90_000 },
    async () => {
      const app = await bootBuiltApp({ width: 1280, height: 960 });
      try {
        const doc = app.doc;
        expect(doc().querySelectorAll(".lane-grid").length).toBe(4);

        // PLAY via the real booth button (real gesture → ctx.resume path;
        // CI launches Chromium with --autoplay-policy=no-user-gesture-required).
        await clickPlayAndWait(app);

        const stats: FrameStats = await new Promise<FrameStats>((resolve) => {
          const intervals: number[] = [];
          const toggleBlocks: number[] = [];
          let playheadMoves = 0;
          let lastTransform = "";
          let toggles = 0;
          let last = performance.now();
          const start = last;

          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;

            const ph = doc().querySelector<HTMLElement>(".grid-playhead");
            if (ph) {
              const t = ph.style.transform;
              if (t !== lastTransform) {
                lastTransform = t;
                playheadMoves++;
              }
            }

            const cells =
              doc().querySelectorAll<HTMLElement>(".lane-grid .cell");
            if (toggles < TOGGLE_COUNT && cells.length > 0) {
              // Two real DOM cell clicks per frame: the realistic worst case
              // of a fast editor, through click delegation → store → bridge →
              // recompile → renderer.sync. Measured as a synchronous block.
              const t0 = performance.now();
              for (let k = 0; k < 2 && toggles < TOGGLE_COUNT; k++) {
                cells[(toggles * 37) % cells.length].click();
                toggles++;
              }
              toggleBlocks.push(performance.now() - t0);
            }

            if (now - start < MEASURE_MS) requestAnimationFrame(frame);
            else
              resolve({
                intervals,
                toggleBlocks,
                playheadMoves,
                buttonLabel: app.playBtn().textContent ?? "",
              });
          };
          requestAnimationFrame(frame);
        });

        // --- Reported measurements (production-log evidence) -----------------
        const sorted = [...stats.intervals].sort((a, b) => a - b);
        console.log(
          `[TH-1 frame budget] frames=${stats.intervals.length} ` +
            `over33.4ms=${stats.intervals.filter((d) => d >= FRAME_BUDGET_MS).length} ` +
            `max=${sorted[sorted.length - 1].toFixed(1)}ms ` +
            `median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms ` +
            `toggles=${stats.toggleBlocks.length} ` +
            `worstToggleBlock=${Math.max(...stats.toggleBlocks).toFixed(2)}ms ` +
            `playheadMoves=${stats.playheadMoves}`,
        );

        // --- Transport really ran (button shows STOP; playhead moved on rAF).
        // Load-robust COUNT: only ≥2 distinct transforms/second (see header) —
        // the frame-rate itself is policed by the hard budget below.
        expect(stats.buttonLabel).toBe("STOP");
        expect(
          stats.playheadMoves,
          `playhead moved only ${stats.playheadMoves}x in ${MEASURE_MS} ms`,
        ).toBeGreaterThanOrEqual(
          (MEASURE_MS / 1000) * MIN_PLAYHEAD_MOVES_PER_SEC,
        );

        // --- Frame budget (HARD: ≥95% of frames < 33.4 ms) -------------------
        expect(stats.intervals.length).toBeGreaterThan(MEASURE_MS / 50); // rAF alive
        const overBudget = stats.intervals.filter((d) => d >= FRAME_BUDGET_MS);
        const overRatio = overBudget.length / stats.intervals.length;
        expect(
          overRatio,
          `${overBudget.length}/${stats.intervals.length} frames ≥ ${FRAME_BUDGET_MS} ms ` +
            `(max ${sorted[sorted.length - 1].toFixed(1)} ms, median ` +
            `${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms)`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);

        // --- Long-task guard on toggling ------------------------------------
        expect(stats.toggleBlocks.length).toBeGreaterThanOrEqual(
          Math.ceil(TOGGLE_COUNT / 2),
        );
        const worstToggle = Math.max(...stats.toggleBlocks);
        expect(
          worstToggle,
          `worst toggle block ${worstToggle.toFixed(1)} ms`,
        ).toBeLessThan(TOGGLE_BLOCK_BUDGET_MS);
      } finally {
        await app.teardown();
      }
    },
    90_000,
  );
});

// ---------------------------------------------------------------------------
// TH-4 (a) + (c) — quadrant layout frame budget at 1440×900
// ---------------------------------------------------------------------------

describe("TH-4 (a) quadrant frame budget (built app, 1440×900, all 4 lanes playing)", () => {
  it(
    "≥95% frames < 33.4 ms with dense 4-bar quadrants (3 view-only, live playheads), ≥16 sustained voices, FX on every lane; help mode off (HP-1 baseline)",
    { timeout: 180_000 },
    async () => {
      const app = await bootBuiltApp({ width: VIEW_W, height: VIEW_H });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const floor = (lane: string): HTMLElement =>
          $(`.lane-floor[data-lane="${lane}"]`);
        const cellAt = (lane: string, row: number, step: number): HTMLElement =>
          $(
            `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        await poll(
          () =>
            [...doc().querySelectorAll(".rail-tile-cue")].some(
              (c) => c.textContent === "VERSE",
            ),
          5000,
          "demo cues",
        );

        // (c) HP-1 zero-cost baseline: every TH-4 measurement runs with help
        // mode OFF — the default state, asserted (no help surface mounted:
        // neither the KEYS overlay nor HP-1's info view).
        expect(
          doc().querySelector(".help-backdrop"),
          "help mode must be OFF during the measurement (HP-1 zero-cost baseline)",
        ).toBeNull();
        expect(
          doc().querySelector(".info-view"),
          "the HP-1 info region must NOT be mounted while help mode is off",
        ).toBeNull();

        /** Step width (px) inside one lane's grid, from two sibling cells. */
        const stepWidth = (lane: string): number => {
          const a = cellAt(lane, 0, 0).getBoundingClientRect();
          const b = cellAt(lane, 0, 1).getBoundingClientRect();
          return b.left - a.left;
        };

        /** Synthetic drag-create through the REAL gesture path (the IN-2 law:
         *  pointerdown → renderer-local preview moves → one commit on up). */
        const dragCreate = (
          lane: string,
          row: number,
          start: number,
          end: number,
        ): void => {
          const el = cellAt(lane, row, start);
          const r = el.getBoundingClientRect();
          const y = r.top + r.height / 2;
          const cells = el.parentElement!.getBoundingClientRect();
          const w = stepWidth(lane);
          const pe = (type: string, stepFloat: number): void => {
            el.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 1,
                isPrimary: true,
                button: 0,
                pointerType: "mouse",
                clientX: cells.left + (stepFloat + 0.5) * w,
                clientY: y,
                bubbles: true,
                cancelable: true,
              }),
            );
          };
          pe("pointerdown", start);
          for (let s = start + 2; s <= end; s += 3) pe("pointermove", s);
          pe("pointerup", end);
        };

        const selectLane = async (lane: string): Promise<void> => {
          (floor(lane).querySelector(".cell") as HTMLElement).click();
          await poll(
            () => floor(lane).dataset.editing === "true",
            2000,
            `${lane} quadrant selected`,
          );
        };
        const add4Bar = async (lane: string): Promise<void> => {
          // LL-1 journey delta: the +4B menu button retired with the LENGTH
          // stepper — create the blank via the rail `+` (1 bar, appended +
          // selected — BC-1), then grow it with the global `b` ladder ×2.
          // PX-4 re-base: the rail-`+` blank rides at the chain's end of a
          // DEMO whose chain length is per-lane (the poly-loop demo: drums
          // carry 8 tiles, the other lanes 4) — expect one MORE tile, not a
          // fixed count.
          const tilesBefore = doc().querySelectorAll(
            `.rail-row[data-lane="${lane}"] .rail-tile`,
          ).length;
          $(`.rail-row[data-lane="${lane}"] .rail-append`).click();
          await poll(
            () =>
              doc().querySelectorAll(
                `.rail-row[data-lane="${lane}"] .rail-tile`,
              ).length ===
              tilesBefore + 1,
            2_000,
            `${lane} blank appended`,
          );
          await selectLane(lane); // the ladder acts on the ACTIVE lane
          for (const k of ["b", "b"]) {
            doc().body.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: k,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
          await poll(
            () => {
              const n = floor(lane).querySelectorAll(".cell").length;
              return n > 0 && n % 64 === 0;
            },
            5_000,
            `${lane} 4-bar grid rendered`,
          );
          // BC-1 (I3-a): the rail "+" now creates a NEW blank pattern — it no
          // longer chains the selected one — so the dense pattern stays in
          // the POOL, selected, unchained. Chaining happens in
          // removeDemoPatterns below (the pool-removal law).
        };
        /**
         * BC-1 rework (I3-a): with `+` creating blanks, the dense 4-bar
         * pattern reaches the chain the drums-precedent way (the MB-6
         * gate-integrity fix): strip the demo patterns from the POOL (the
         * PAT menu's RM tool — tile Delete only edits the chain). Each
         * removal takes its chain occurrences with it, and removing the LAST
         * demo rebuilds the chain to the lane's one remaining pattern — the
         * dense 4-bar. Paint first (the dense pattern is the selection at
         * that point), then strip: the chain ends exactly [dense], so
         * playback AND rendering are dense for the whole measurement window.
         * PX-4 re-base: the demo's POOL is per-lane (drums 8 patterns, the
         * other lanes 4) — strip every tile except the appended blank,
         * counted from the rail itself.
         */
        const removeDemoPatterns = async (lane: string): Promise<void> => {
          const rmLabel = `Remove ${lane.toUpperCase()} selected pattern`;
          const tilesNow = (): number =>
            doc().querySelectorAll(
              `.rail-row[data-lane="${lane}"] .rail-tile`,
            ).length;
          const start = tilesNow(); // demo tiles + the rail-`+` blank
          for (let i = 0; i < start - 1; i++) {
            // Select the first (demo) tile, then remove it from the pool.
            (
              $(`.rail-row[data-lane="${lane}"] .rail-tile`) as HTMLElement
            ).click();
            await poll(
              () => tilesNow() === start - i,
              2_000,
              `${lane} demo pattern ${i} selected (chain untouched yet)`,
            );
            $(`.rail-row[data-lane="${lane}"] .rail-tools-trigger`).click();
            await poll(
              () =>
                $(
                  `.rail-row[data-lane="${lane}"] button[aria-label="${rmLabel}"]`,
                ) !== null,
              2_000,
              `${lane} PAT menu (pool remove)`,
            );
            (
              $(
                `.rail-row[data-lane="${lane}"] button[aria-label="${rmLabel}"]`,
              ) as HTMLButtonElement
            ).click();
            await poll(
              () =>
                doc().querySelector(
                  `.rail-row[data-lane="${lane}"] .rail-tools-menu`,
                ) === null,
              2_000,
              `${lane} PAT menu closes after pool remove`,
            );
          }
          await poll(
            () => tilesNow() === 1,
            2_000,
            `${lane} pool = the dense 4-bar alone (chain followed it)`,
          );
        };
        const clickCells = (
          lane: string,
          rows: readonly number[],
          steps: readonly number[],
        ): void => {
          for (const row of rows)
            for (const step of steps) cellAt(lane, row, step).click();
        };

        // --- Dense 4-bar content per lane (quadrant-by-quadrant) -----------
        // bass: 7 sustained long notes (rows 0..12) + spread clicks.
        await selectLane("bass");
        await add4Bar("bass");
        for (const row of [0, 2, 4, 6, 8, 10, 12])
          dragCreate("bass", row, 0, 31);
        await poll(
          () => floor("bass").querySelectorAll(".note-run").length >= 7,
          3000,
          "bass sustained notes committed",
        );
        clickCells("bass", [4, 6], [40, 48, 56]);
        await removeDemoPatterns("bass");

        // chords: 2 full-length notes — each sounds a 3-voice diatonic triad
        // (compileLaneEvents stack law) → 6 sustained voices, whole pattern.
        await selectLane("chords");
        await add4Bar("chords");
        dragCreate("chords", 0, 0, 63);
        dragCreate("chords", 2, 0, 63);
        await poll(
          () => floor("chords").querySelectorAll(".note-run").length >= 2,
          3000,
          "chords sustained notes committed",
        );
        await removeDemoPatterns("chords");

        // lead: 4 sustained long notes (rows 7..13).
        await selectLane("lead");
        await add4Bar("lead");
        for (const row of [7, 9, 11, 13]) dragCreate("lead", row, 0, 31);
        await poll(
          () => floor("lead").querySelectorAll(".note-run").length >= 4,
          3000,
          "lead sustained notes committed",
        );
        await removeDemoPatterns("lead");

        // drums: last (stays the editable quadrant); hits on every piece.
        // MB-6 setup-integrity fix (the MB-5 gate-integrity finding,
        // coordinator-assigned to this task): the v0 drums cell toggle is
        // POOL-WIDE (read = any pattern of the lane, write = EVERY pattern)
        // and a step write past a pattern's own length fails validateProject
        // (sparse-array holes → codec reject → the click throws and lands
        // NOTHING). With demo patterns still in the pool (1-bar at the
        // finding, the PX-4 poly-loop shapes today), the original
        // `clickCells` at out-of-demo-length steps threw silently and
        // in-length clicks obeyed the pool-wide read against demo hits. The
        // honest setup strips EVERY demo pattern from the POOL first (the
        // PAT menu's RM tool — tile Delete only edits the CHAIN; MB-5's own
        // phone-gate fix), leaving the fresh 4-bar as the lane's only
        // pattern: every click then lands ON, in-pattern, in-length. The gate now ASSERTS the intended density (48/48
        // painted hits), so the setup can never silently degrade again —
        // and the chain needs no separate strip (the pool removals take
        // the demo chain occurrences with them).
        await selectLane("drums");
        await add4Bar("drums");
        // BC-1 (I3-a): the dense pattern reaches the chain the same
        // pool-removal way as the other lanes now (see removeDemoPatterns —
        // the `+` button creates blanks and cannot chain the selected
        // pattern anymore; the drums RM flow was already doing exactly this).
        await removeDemoPatterns("drums");
        // The grid follows the pool: back to the dense 4-bar alone (6 rows
        // × 64) before the clicks — PX-4's demo drums are 4-bar too, so the
        // intermediate removals kept a 64-step grid throughout.
        await poll(
          () => floor("drums").querySelectorAll(".cell").length === 6 * 64,
          3_000,
          "drums 4-bar grid displayed again after the pool strip",
        );
        // Deterministic click semantics: the pool-wide read now sees ONE
        // pattern — the fresh 4-bar, empty except kick step 0 (the
        // quadrant-select click above toggled it OFF against the demo's
        // every-pattern kick[0] ON). Every one of the 48 clicks below
        // therefore turns a cell ON.
        clickCells("drums", [0, 1, 2, 3, 4, 5], [0, 8, 16, 24, 32, 40, 48, 56]);
        // The setup's own integrity tooth: 6 rows × 8 steps = 48 painted
        // hits on the only (empty, 64-step) pattern — the intended density,
        // self-checked (this is exactly what silently failed before).
        await poll(
          () =>
            floor("drums").querySelectorAll('.cell[data-on="true"]').length >=
            48,
          3_000,
          "drums dense hits committed (48/48 — the intended density)",
        );

        // all-FX law (v0 criterion 7): drums gets one device through the real
        // FX console (the demo ships bass/chords/lead chains).
        const drumsFx = $(
          `.lane-floor[data-lane="drums"] .head-fx`,
        ) as HTMLButtonElement;
        drumsFx.click();
        await poll(
          () => !!doc().querySelector('.fx-strip[data-lane="drums"]'),
          2000,
          "drums fx console",
        );
        ($(".fx-add-btn") as HTMLButtonElement).click();
        await poll(
          () => !!doc().querySelector(".fx-add-menu"),
          2000,
          "fx add menu",
        );
        (doc().querySelectorAll(".fx-add-item")[0] as HTMLElement).click();
        await poll(
          () =>
            doc().querySelectorAll('.fx-strip[data-lane="drums"] .fx-mod')
              .length === 1,
          2000,
          "drums fx device",
        );
        drumsFx.click(); // close — the measurement state has no open overlays

        // --- Structural preconditions --------------------------------------
        for (const lane of LANES) {
          const label =
            (
              $(`.lane-floor[data-lane="${lane}"] .head-fx`) as HTMLElement
            ).getAttribute("aria-label") ?? "";
          expect(label, `${lane} FX chain active`).toContain("device");
        }
        expect(doc().querySelectorAll(".lane-grid").length).toBe(4);
        expect(floor("drums").dataset.editing).toBe("true");
        expect(floor("bass").dataset.editing).toBe("false");
        expect(floor("chords").dataset.editing).toBe("false");
        expect(floor("lead").dataset.editing).toBe("false");
        const runCounts: Record<string, number> = {};
        for (const lane of LANES)
          runCounts[lane] = floor(lane).querySelectorAll(".note-run").length;
        expect(runCounts.bass).toBeGreaterThanOrEqual(7);
        expect(runCounts.chords).toBeGreaterThanOrEqual(2);
        expect(runCounts.lead).toBeGreaterThanOrEqual(4);

        // ≥16 SUSTAINED voices: note bars covering step 4; chords bars each
        // sound 3 voices (stack) — 7 bass + 2×3 chords + 4 lead = 17.
        let voices = 0;
        for (const edge of doc().querySelectorAll<HTMLElement>(
          ".lane-floor .note-edge",
        )) {
          const start = Number(edge.dataset.start);
          const length = Number(edge.dataset.length);
          if (start <= 4 && 4 < start + length) {
            const lane = (edge.closest(".lane-floor") as HTMLElement).dataset
              .lane;
            voices += lane === "chords" ? 3 : 1;
          }
        }
        expect(
          voices,
          `sustained voices at step 4 (got ${voices})`,
        ).toBeGreaterThanOrEqual(16);

        // --- PLAY + settle, then measure -----------------------------------
        await clickPlayAndWait(app);
        await sleep(700);

        const stats = await new Promise<{
          intervals: number[];
          moves: Record<string, number>;
        }>((resolve) => {
          const intervals: number[] = [];
          const moves: Record<string, number> = {
            drums: 0,
            bass: 0,
            chords: 0,
            lead: 0,
          };
          const lastT: Record<string, string> = {};
          let last = performance.now();
          const start = last;
          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            for (const lane of LANES) {
              const ph =
                floor(lane).querySelector<HTMLElement>(".grid-playhead");
              if (ph) {
                const t = ph.style.transform;
                if (t && t !== lastT[lane]) {
                  lastT[lane] = t;
                  moves[lane]++;
                }
              }
            }
            if (now - start < MEASURE_MS) requestAnimationFrame(frame);
            else resolve({ intervals, moves });
          };
          requestAnimationFrame(frame);
        });

        const sorted = [...stats.intervals].sort((a, b) => a - b);
        const over = stats.intervals.filter((d) => d >= FRAME_BUDGET_MS);
        console.log(
          `[TH-4 quadrant budget] frames=${stats.intervals.length} ` +
            `over33.4ms=${over.length} ` +
            `max=${sorted[sorted.length - 1].toFixed(1)}ms ` +
            `p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms ` +
            `median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms ` +
            `playheadMoves=${JSON.stringify(stats.moves)} ` +
            `noteRuns=${JSON.stringify(runCounts)} sustainedVoices=${voices}`,
        );

        expect(app.playBtn().textContent).toBe("STOP");
        for (const lane of LANES) {
          expect(
            stats.moves[lane],
            `${lane} playhead live (view-only quadrants included)`,
          ).toBeGreaterThanOrEqual(
            (MEASURE_MS / 1000) * MIN_PLAYHEAD_MOVES_PER_SEC,
          );
        }
        expect(stats.intervals.length).toBeGreaterThan(MEASURE_MS / 50);
        expect(
          over.length / stats.intervals.length,
          `${over.length}/${stats.intervals.length} frames ≥ ${FRAME_BUDGET_MS} ms ` +
            `(max ${sorted[sorted.length - 1].toFixed(1)} ms, median ` +
            `${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms)`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);
      } finally {
        await app.teardown();
      }
    },
    180_000,
  );
});

// ---------------------------------------------------------------------------
// TH-4 (b) — drag pointermove budgets (storm during playback)
// ---------------------------------------------------------------------------

describe("TH-4 (b) drag pointermove budgets (built app, playing, pointermove storm)", () => {
  it(
    "drag-create / edge-resize / drums-paint / rail-sweep storms keep ≥95% frames < 33.4 ms, move dispatches < 50 ms, zero non-preview mutations mid-gesture",
    { timeout: 180_000 },
    async () => {
      const app = await bootBuiltApp({ width: VIEW_W, height: VIEW_H });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const floor = (lane: string): HTMLElement =>
          $(`.lane-floor[data-lane="${lane}"]`);
        const cellAt = (lane: string, row: number, step: number): HTMLElement =>
          $(
            `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const center = (el: Element): { x: number; y: number } => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const pe = (type: string, x: number, y: number): PointerEvent =>
          new PointerEvent(type, {
            pointerId: 1,
            isPrimary: true,
            button: 0,
            pointerType: "mouse",
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
        const stepWidth = (lane: string): number => {
          const a = cellAt(lane, 0, 0).getBoundingClientRect();
          const b = cellAt(lane, 0, 1).getBoundingClientRect();
          return b.left - a.left;
        };

        await poll(
          () =>
            [...doc().querySelectorAll(".rail-tile-cue")].some(
              (c) => c.textContent === "VERSE",
            ),
          5000,
          "demo cues",
        );
        // (c) the storm also runs help-mode-off (the default; asserted —
        // HP-1's info view mounts NOTHING while the mode is off).
        expect(doc().querySelector(".help-backdrop")).toBeNull();
        expect(doc().querySelector(".info-view")).toBeNull();

        // --- setup: two long bass notes (resize targets), some drums hits ---
        (floor("bass").querySelector(".cell") as HTMLElement).click();
        await poll(
          () => floor("bass").dataset.editing === "true",
          2000,
          "bass quadrant selected",
        );
        for (const row of [0, 2] as const) {
          const el = cellAt("bass", row, 0);
          const c = center(el);
          const cells = el.parentElement!.getBoundingClientRect();
          const w = stepWidth("bass");
          el.dispatchEvent(pe("pointerdown", c.x, c.y));
          for (let s = 3; s <= 19; s += 4)
            el.dispatchEvent(
              pe("pointermove", cells.left + (s + 0.5) * w, c.y),
            );
          el.dispatchEvent(pe("pointerup", cells.left + 19.5 * w, c.y));
        }
        await poll(
          () => floor("bass").querySelectorAll(".note-run").length >= 2,
          3000,
          "bass resize-target notes committed",
        );

        // PLAY first: the storm must hold DURING PLAYBACK (plan law).
        await clickPlayAndWait(app);
        await sleep(500);

        // --- storm machinery (module-scope runStormWindow; MB-5 reuses it) --
        const allIntervals: number[] = [];
        const allMoveBlocks: number[] = [];
        const violations: string[] = [];
        const saw: Record<string, boolean> = {
          createPreviewBar: false,
          createPreviewCells: false,
          resizeWidthChanges: false,
          paintPreviewCells: false,
          cuePreview: false,
        };
        const storm = (
          label: string,
          begin: () => void,
          move: (i: number) => PointerEvent,
          moveTarget: () => Element,
          finish: () => void,
          sample: () => void,
        ): Promise<void> =>
          runStormWindow(
            app.win,
            doc,
            violations,
            "TH-4",
            label,
            begin,
            move,
            moveTarget,
            finish,
            sample,
          ).then((r) => {
            allIntervals.push(...r.intervals);
            allMoveBlocks.push(...r.moveBlocks);
          });

        // Storm 1 — drag-create preview (bass, editable quadrant).
        {
          const lane = "bass";
          const row = 4;
          const press = cellAt(lane, row, 0);
          const c = center(press);
          const cells = press.parentElement!.getBoundingClientRect();
          const w = stepWidth(lane);
          await storm(
            "drag-create preview",
            () => press.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const stepFloat = 2 + ((i * 3) % 40); // oscillate the live length
              return pe("pointermove", cells.left + (stepFloat + 0.5) * w, c.y);
            },
            () => press,
            () =>
              press.dispatchEvent(pe("pointerup", cells.left + 10.5 * w, c.y)),
            () => {
              if (doc().querySelector(".note-run.is-drag-preview"))
                saw.createPreviewBar = true;
              if (
                floor(lane).querySelector('.cell[data-preview="true"]') !== null
              )
                saw.createPreviewCells = true;
            },
          );
          await poll(
            () =>
              floor(lane).querySelector(`.note-edge[data-row="${row}"]`) !==
              null,
            2000,
            "storm-created note committed on release",
          );
        }

        // Storm 2 — edge resize (the row-0 note from setup).
        {
          const lane = "bass";
          const edge = $(
            `.lane-floor[data-lane="${lane}"] .note-edge[data-row="0"]`,
          );
          const c = center(edge);
          const cells = edge.closest(".row-cells")!.getBoundingClientRect();
          const w = stepWidth(lane);
          const noteStart = Number(edge.dataset.start);
          const runEl = edge.parentElement as HTMLElement;
          const widths = new Set<string>();
          await storm(
            "edge-resize",
            () => edge.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const endStep = noteStart + 4 + ((i * 2) % 22);
              return pe("pointermove", cells.left + (endStep + 0.5) * w, c.y);
            },
            () => edge,
            () =>
              edge.dispatchEvent(
                pe("pointerup", cells.left + (noteStart + 12 + 0.5) * w, c.y),
              ),
            () => {
              widths.add(runEl.style.width);
              if (widths.size >= 2) saw.resizeWidthChanges = true;
            },
          );
          await poll(
            () =>
              (
                floor(lane).querySelector(".note-length-live")?.textContent ??
                ""
              ).startsWith("LENGTH"),
            2000,
            "resize announcement after release commit",
          );
        }

        // Storm 3 — drums paint (select the drums quadrant first; selection
        // happens OUTSIDE any observed move window).
        {
          (floor("drums").querySelector(".cell") as HTMLElement).click();
          await poll(
            () => floor("drums").dataset.editing === "true",
            2000,
            "drums quadrant selected for paint",
          );
          const row = 1;
          const press = cellAt("drums", row, 2);
          const c = center(press);
          const cells = press.parentElement!.getBoundingClientRect();
          const w = stepWidth("drums");
          await storm(
            "drums paint",
            () => press.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const step = 2 + ((i * 2) % 12); // sweep 2..14 both directions
              return pe("pointermove", cells.left + (step + 0.5) * w, c.y);
            },
            () => press,
            () =>
              press.dispatchEvent(pe("pointerup", cells.left + 10.5 * w, c.y)),
            () => {
              if (
                floor("drums").querySelector('.cell[data-preview="true"]') !==
                null
              )
                saw.paintPreviewCells = true;
            },
          );
          await poll(
            () =>
              floor("drums").querySelectorAll<HTMLElement>(
                '.cell[data-row="1"][data-on="true"]',
              ).length >= 4,
            2000,
            "painted hits committed on release",
          );
        }

        // Storm 4 — rail cue sweep (across tiles and across lane rows).
        {
          const drumsRow = $('.rail-row[data-lane="drums"]');
          const bassRow = $('.rail-row[data-lane="bass"]');
          const drumsTiles = () =>
            Array.from(drumsRow.querySelectorAll(".rail-tile"));
          const bassTiles = () =>
            Array.from(bassRow.querySelectorAll(".rail-tile"));
          const t0 = drumsTiles()[0]!;
          const c0 = center(t0);
          await storm(
            "rail sweep",
            () => t0.dispatchEvent(pe("pointerdown", c0.x, c0.y)),
            (i) => {
              // Alternate rows; always aim at a REAL tile center so the
              // hit-test (elementFromPoint) resolves a tile, never a gap.
              const drums = i % 40 < 20;
              const tiles = drums ? drumsTiles() : bassTiles();
              const tile = tiles[(i * 3) % tiles.length]!;
              const c = center(tile);
              return pe("pointermove", c.x, c.y);
            },
            () => t0,
            () => {
              const target = bassTiles()[0]!;
              const c = center(target);
              t0.dispatchEvent(pe("pointerup", c.x, c.y));
            },
            () => {
              if (doc().querySelector("[data-cue-preview]") !== null)
                saw.cuePreview = true;
            },
          );
          await poll(
            () =>
              doc().querySelector('.rail-tile[data-state="pending"]') !== null,
            4000,
            "pending switch after sweep commit (quantized)",
          );
        }

        // --- Budgets ---------------------------------------------------------
        expect(allIntervals.length).toBeGreaterThan((STORM_WINDOW_MS / 50) * 3);
        const over = allIntervals.filter((d) => d >= FRAME_BUDGET_MS);
        expect(
          over.length / allIntervals.length,
          `${over.length}/${allIntervals.length} storm frames ≥ ${FRAME_BUDGET_MS} ms`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);

        const worstMove = Math.max(...allMoveBlocks);
        expect(
          worstMove,
          `worst pointermove dispatch ${worstMove.toFixed(1)} ms`,
        ).toBeLessThan(MOVE_BLOCK_BUDGET_MS);
        const sortedMoves = [...allMoveBlocks].sort((a, b) => a - b);
        const medianMove = sortedMoves[Math.floor(sortedMoves.length / 2)];
        expect(
          medianMove,
          `median pointermove dispatch ${medianMove.toFixed(2)} ms`,
        ).toBeLessThan(MEDIAN_MOVE_BUDGET_MS);
        console.log(
          `[TH-4 storm totals] frames=${allIntervals.length} ` +
            `over33.4ms=${over.length} moves=${allMoveBlocks.length} ` +
            `worstMove=${worstMove.toFixed(2)}ms medianMove=${medianMove.toFixed(2)}ms`,
        );

        // Commit-on-release (no layout thrash): zero non-preview mutations.
        expect(
          violations,
          `non-preview DOM mutations mid-gesture (store writes = layout thrash):\n${violations.join("\n")}`,
        ).toEqual([]);

        // The storms really exercised the preview paths.
        expect(saw.createPreviewBar, "drag-create preview bar rendered").toBe(
          true,
        );
        expect(
          saw.createPreviewCells,
          "drag-create preview cells rendered",
        ).toBe(true);
        expect(
          saw.resizeWidthChanges,
          "resize preview width updated live",
        ).toBe(true);
        expect(saw.paintPreviewCells, "paint preview cells rendered").toBe(
          true,
        );
        expect(saw.cuePreview, "rail sweep preview rendered").toBe(true);

        // Playback survived the whole storm.
        expect(app.playBtn().textContent).toBe("STOP");
      } finally {
        await app.teardown();
      }
    },
    180_000,
  );
});

// ---------------------------------------------------------------------------
// TH-4 (d) — lazy-content budget (first paint + PLAY never await content)
// ---------------------------------------------------------------------------

describe("TH-4 (d) lazy-content budget (built app, simulated asset stall)", () => {
  it(
    "first paint + PLAY never await content fetch/decode; zero audio-asset fetches before play",
    { timeout: 90_000 },
    async () => {
      // Same-origin sample content (PS-2/PS-4, RES-10) does not exist yet —
      // the gate simulates it so the budget cannot regress when it lands:
      // every audio-asset fetch and every decodeAudioData stalls 4 s. If the
      // boot or play path ever awaits one, the assertions below time out.
      const AUDIO_ASSET =
        /\/assets\/content[/-]|\.ogg(?:$|\?)|\.oga(?:$|\?)|\.mp3(?:$|\?)|\.wav(?:$|\?)|\.flac(?:$|\?)/i;
      const fetched: Array<{ url: string; tMs: number }> = [];
      let decodeCalls = 0;
      const t0 = performance.now();

      const app = await bootBuiltApp({
        width: VIEW_W,
        height: VIEW_H,
        beforeWrite: (win) => {
          const origFetch = win.fetch.bind(win);
          win.fetch = ((
            input: RequestInfo | URL,
            init?: RequestInit,
          ): Promise<Response> => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
            fetched.push({ url, tMs: performance.now() - t0 });
            if (!AUDIO_ASSET.test(url)) return origFetch(url, init);
            return new Promise<Response>((resolve) => {
              setTimeout(() => {
                void origFetch(url, init).then(
                  (res) => resolve(res),
                  () => resolve(new Response("", { status: 404 })),
                );
              }, CONTENT_STALL_MS);
            });
          }) as typeof win.fetch;
        },
        audioProtoHook: (proto) => {
          proto.decodeAudioData = function (
            this: AudioContext,
          ): Promise<AudioBuffer> {
            decodeCalls++;
            const sampleRate = this.sampleRate;
            return new Promise<AudioBuffer>((resolve) => {
              setTimeout(
                () => resolve(this.createBuffer(1, 128, sampleRate)),
                CONTENT_STALL_MS,
              );
            });
          };
        },
      });
      try {
        // First paint beats the stall by a wide margin.
        expect(
          app.bootMs,
          `first paint took ${app.bootMs.toFixed(0)} ms (budget ${PAINT_BUDGET_MS} ms; a blocking asset await would stall ${CONTENT_STALL_MS} ms)`,
        ).toBeLessThan(PAINT_BUDGET_MS);

        // PLAY beats the stall too (worklet module fetch + ctx.resume path).
        const playMs = await clickPlayAndWait(app);
        expect(
          playMs,
          `PLAY took ${playMs.toFixed(0)} ms (budget ${PLAY_BUDGET_MS} ms)`,
        ).toBeLessThan(PLAY_BUDGET_MS);
        expect(app.playBtn().textContent).toBe("STOP");

        // The transport really runs — the stall never reached the audio path.
        await poll(
          () => {
            const ph = app.doc().querySelector<HTMLElement>(".grid-playhead");
            return !!ph && ph.style.transform !== "";
          },
          3000,
          "playhead alive under the stall",
        );

        // Lazy law: NO audio-asset fetch on the boot→play path. Content may
        // only load on explicit preset selection (PS-2/PS-4) — never eagerly,
        // and never blocking paint or play.
        const eager = fetched.filter((f) => AUDIO_ASSET.test(f.url));
        expect(
          eager,
          `audio-asset fetches on the boot/play path: ${eager
            .map((e) => e.url)
            .join(", ")}`,
        ).toEqual([]);

        console.log(
          `[TH-4 lazy budget] paintMs=${app.bootMs.toFixed(0)} ` +
            `playMs=${playMs.toFixed(0)} decodeCalls=${decodeCalls} ` +
            `fetches=[${fetched.map((f) => f.url).join(" ")}]`,
        );
      } finally {
        await app.teardown();
      }
    },
    90_000,
  );
});

// ---------------------------------------------------------------------------
// MB-5 (m5) — mobile frame budget (built app, 390×844 phone stage)
//
// The TH-4 measurement approach at the committed phone viewport (MB-1's
// stage: ONE lane floor renders — the audio state is viewport-independent,
// so all four lanes still play). HONESTY CAVEAT (documented in perf-budget.md
// §9): CI Chromium on desktop-class hardware EMULATES the viewport; these
// gates catch REGRESSIONS, not device class — real mid-tier Android
// verification stays with the user's R12-style session.
// ---------------------------------------------------------------------------

describe("MB-5 mobile frame budget (built app, 390×844 phone stage)", () => {
  it(
    "(m-a) playing + editing + scroll keep ≥95% frames < 33.4 ms in the densest phone-realistic state (4-bar chains, sample sounds, FX on every lane, sustained runs, euclid fill overlay revealed); help off; voices as budgeted (≥16 sustained)",
    { timeout: 240_000 },
    async () => {
      const app = await bootBuiltApp({ width: PHONE_W, height: PHONE_H });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const floor = (lane: string): HTMLElement =>
          $(`.lane-floor[data-lane="${lane}"]`);
        const cellAt = (lane: string, row: number, step: number): HTMLElement =>
          $(
            `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
        const stepWidth = (lane: string): number => {
          const a = cellAt(lane, 0, 0).getBoundingClientRect();
          const b = cellAt(lane, 0, 1).getBoundingClientRect();
          return b.left - a.left;
        };

        // Phone stage preconditions (MB-1's law): switcher, ONE floor, the
        // demo chain, help mode OFF (the HP-1 zero-cost baseline, TH-4 (c)).
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone at 390×844",
        );
        await poll(
          () => doc().querySelectorAll(".rail-tile").length >= 2,
          5_000,
          "demo chain tiles (phone boot signal)",
        );
        expect(doc().querySelectorAll(".lane-switch-tab")).toHaveLength(4);
        expect(doc().querySelectorAll(".lane-grid")).toHaveLength(1);
        expect(doc().querySelector(".help-backdrop")).toBeNull();
        expect(doc().querySelector(".info-view")).toBeNull();

        /** Switch the phone stage to a lane (the switcher IS selection).
         * Poll conditions never throw (a throw inside the poll's setTimeout
         * strands the promise) — query, don't `$`. */
        const switchLane = async (lane: string): Promise<void> => {
          ($(`.lane-switch-tab[data-lane="${lane}"]`) as HTMLElement).click();
          await poll(
            () =>
              doc().querySelectorAll(".lane-grid").length === 1 &&
              doc().querySelector(".lane-floor")?.getAttribute("data-lane") ===
                lane &&
              doc().querySelector(
                `.lane-floor[data-lane="${lane}"] .cell[data-row="0"][data-step="0"]`,
              ) !== null,
            4_000,
            `${lane} phone stage (single floor + cells)`,
          );
        };

        /** Synthetic drag-create through the REAL gesture path (IN-2 law). */
        const dragCreate = (
          lane: string,
          row: number,
          start: number,
          end: number,
        ): void => {
          const el = cellAt(lane, row, start);
          const r = el.getBoundingClientRect();
          const y = r.top + r.height / 2;
          const cells = el.parentElement!.getBoundingClientRect();
          const w = stepWidth(lane);
          const pe = (type: string, stepFloat: number): void => {
            el.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 1,
                isPrimary: true,
                button: 0,
                pointerType: "mouse",
                clientX: cells.left + (stepFloat + 0.5) * w,
                clientY: y,
                bubbles: true,
                cancelable: true,
              }),
            );
          };
          pe("pointerdown", start);
          for (let s = start + 2; s <= end; s += 3) pe("pointermove", s);
          pe("pointerup", end);
        };

        /**
         * LL-1 journey delta: the +4B menu button retired with the LENGTH
         * stepper — the rail `+` creates the blank (1 bar, appended +
         * selected — BC-1), then the global `b` ladder ×2 grows it.
         */
        const add4Bar = async (lane: string): Promise<void> => {
          // PX-4 re-base: one MORE tile than the demo chain holds (the
          // poly-loop demo's chains are per-lane — drums 8 tiles, others 4).
          const tilesBefore = doc().querySelectorAll(
            `.rail-row[data-lane="${lane}"] .rail-tile`,
          ).length;
          ($(`.rail-row[data-lane="${lane}"] .rail-append`) as HTMLElement).click();
          await poll(
            () =>
              doc().querySelectorAll(
                `.rail-row[data-lane="${lane}"] .rail-tile`,
              ).length ===
              tilesBefore + 1,
            2_000,
            `${lane} blank appended`,
          );
          await switchLane(lane); // the ladder acts on the ACTIVE lane
          for (const k of ["b", "b"]) {
            doc().body.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: k,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
          await poll(
            () => {
              const n = floor(lane).querySelectorAll(".cell").length;
              return n > 0 && n % 64 === 0;
            },
            5_000,
            `${lane} 4-bar phone grid rendered`,
          );
          // BC-1 (I3-a): the rail "+" creates a NEW blank pattern now — the
          // dense pattern stays pool+selected, unchained. Chaining happens
          // in removeDemoPatterns (the pool-removal law, desktop twin).
        };

        /**
         * BC-1 rework (I3-a — phone twin of the desktop helper): strip the
         * four demo patterns from the POOL via the PAT menu's RM tool; the
         * chain follows the removals and the last one rebuilds it to exactly
         * [dense 4-bar] — the arrangement the whole measurement window plays.
         */
        const removeDemoPatterns = async (lane: string): Promise<void> => {
          const rmLabel = `Remove ${lane.toUpperCase()} selected pattern`;
          // PX-4 re-base: strip every tile except the appended blank (the
          // demo pool is per-lane now — drums carry 8 patterns, others 4).
          const start = doc().querySelectorAll(
            `.rail-row[data-lane="${lane}"] .rail-tile`,
          ).length;
          for (let i = 0; i < start - 1; i++) {
            // Select the first (demo) tile, then remove it from the pool.
            (
              $(`.rail-row[data-lane="${lane}"] .rail-tile`) as HTMLElement
            ).click();
            await poll(
              () =>
                doc().querySelectorAll(
                  `.rail-row[data-lane="${lane}"] .rail-tile`,
                ).length ===
                start - i, // LL-1: the rail-`+` blank rides at the chain's end
              2_000,
              `${lane} demo pattern ${i} selected (chain untouched yet)`,
            );
            $(".rail-tools-trigger").click();
            await poll(
              () => doc().querySelector(`button[aria-label="${rmLabel}"]`) !== null,
              2_000,
              `${lane} PAT menu (pool remove)`,
            );
            ($(`button[aria-label="${rmLabel}"]`) as HTMLElement).click();
            await poll(
              () => !doc().querySelector(".rail-tools-menu"),
              2_000,
              `${lane} PAT menu closes after pool remove`,
            );
          }
          await poll(
            () =>
              doc().querySelectorAll(`.rail-row[data-lane="${lane}"] .rail-tile`)
                .length === 1,
            2_000,
            `${lane} pool = the dense 4-bar alone (chain followed it)`,
          );
        };

        /** Sustained voices covering step 4 (chords stack 3 voices/note). */
        const voicesAt4 = (lane: string): number => {
          let voices = 0;
          for (const edge of doc().querySelectorAll<HTMLElement>(
            `.lane-floor[data-lane="${lane}"] .note-edge`,
          )) {
            const start = Number(edge.dataset.start);
            const length = Number(edge.dataset.length);
            if (start <= 4 && 4 < start + length)
              voices += lane === "chords" ? 3 : 1;
          }
          return voices;
        };

        /** Step the lane's sound (real stepper → audition + lazy prime).
         * Null-tolerant reads: the header settles with the lane swap. */
        const stepSoundTo = async (
          lane: string,
          kind: "preset" | "kit",
          target: string,
        ): Promise<void> => {
          const nextSel = `button[aria-label="Next ${kind} for ${lane.toUpperCase()}"]`;
          const valueSel = `[aria-label="${lane.toUpperCase()} sound"] .head-ctl-value`;
          for (let i = 0; i < 30; i++) {
            const value = doc().querySelector(valueSel);
            const next = doc().querySelector<HTMLButtonElement>(nextSel);
            if (value?.textContent?.trim() === target) return;
            if (next) next.click();
            await sleep(80);
          }
          throw new Error(`${lane} ${kind} never reached ${target}`);
        };

        // --- Dense 4-bar content per lane (the phone way: switch → edit) ----
        // bass: 7 sustained long notes.
        await switchLane("bass");
        await add4Bar("bass");
        for (const row of [0, 2, 4, 6, 8, 10, 12])
          dragCreate("bass", row, 0, 31);
        await poll(
          () => floor("bass").querySelectorAll(".note-run").length >= 7,
          3_000,
          "bass sustained notes committed",
        );
        await removeDemoPatterns("bass");
        await stepSoundTo("bass", "preset", "SUB DROP"); // PS-4 sample voice

        // chords: 2 full-length triads → 6 sustained voices.
        await switchLane("chords");
        await add4Bar("chords");
        dragCreate("chords", 0, 0, 63);
        dragCreate("chords", 2, 0, 63);
        await poll(
          () => floor("chords").querySelectorAll(".note-run").length >= 2,
          3_000,
          "chords sustained notes committed",
        );
        await removeDemoPatterns("chords");
        await stepSoundTo("chords", "preset", "PURE TONE");

        // lead: 4 sustained long notes (the densest phone grid: 14 rows).
        await switchLane("lead");
        await add4Bar("lead");
        for (const row of [7, 9, 11, 13]) dragCreate("lead", row, 0, 31);
        await poll(
          () => floor("lead").querySelectorAll(".note-run").length >= 4,
          3_000,
          "lead sustained notes committed",
        );
        await removeDemoPatterns("lead");
        await stepSoundTo("lead", "preset", "PHASER UP");

        // drums (stays reachable for window B): the densest realistic kit
        // load + one FX device through the real console (the demo ships the
        // other three).
        //
        // GATE-INTEGRITY NOTE (found live, recorded): the v0 drums cell
        // toggle is POOL-WIDE (read = ANY pattern of the lane, write = EVERY
        // pattern) and a step write past a pattern's own length fails
        // validateProject (sparse-array holes → codec reject → the click
        // throws and lands NOTHING). With the demo's shorter patterns in
        // the pool, clicks past their length throw and in-length clicks
        // obey the pool-wide read (a demo-hit cell reads "on" and the click
        // turns it OFF — an invisible no-op). The honest dense setup strips
        // every demo pattern from the POOL first (the PAT menu's RM tool — tile Delete
        // only edits the chain), leaving the fresh 4-bar as the lane's only
        // pattern: every click then lands ON, in-pattern, in-length.
        await switchLane("drums");
        await add4Bar("drums");
        // BC-1 (I3-a): the dense pattern reaches the chain the same
        // pool-removal way as the other lanes now (see removeDemoPatterns).
        await removeDemoPatterns("drums");
        for (const row of [0, 1, 2, 3, 4, 5])
          for (const step of [16, 24, 32, 40, 48, 56, 60])
            cellAt("drums", row, step).click();
        await poll(
          () =>
            floor("drums").querySelectorAll('.cell[data-on="true"]').length >=
            40,
          3_000,
          "drums dense hits committed",
        );
        // (No chain strip needed: the pool removals took the demo chain
        // occurrences with them — the chain IS the dense pattern.)
        await stepSoundTo("drums", "kit", "808 CLASSIC");
        const drumsFx = $(".head-fx") as HTMLElement;
        drumsFx.click();
        await poll(
          () => doc().querySelector('.fx-strip[data-lane="drums"]') !== null,
          2_000,
          "drums fx console",
        );
        ($(".fx-add-btn") as HTMLElement).click();
        await poll(
          () => doc().querySelector(".fx-add-menu") !== null,
          2_000,
          "fx add menu",
        );
        (doc().querySelectorAll(".fx-add-item")[0] as HTMLElement).click();
        await poll(
          () =>
            doc().querySelectorAll('.fx-strip[data-lane="drums"] .fx-mod')
              .length === 1,
          2_000,
          "drums fx device",
        );
        drumsFx.click(); // close — measurement state has no open overlays

        // --- Structural preconditions ---------------------------------------
        // FX on every lane (the demo ships bass/chords/lead; drums just got
        // one). At phone the header renders only for the ACTIVE lane, so the
        // per-lane check happens while that lane is displayed — the chain
        // lives in the document, so the state is lane-independent.
        const fxLanes: Record<string, boolean> = {
          bass: false,
          chords: false,
          lead: false,
          drums: false,
        };
        const voices: Record<string, number> = {};
        for (const lane of ["bass", "chords", "lead", "drums"] as const) {
          await switchLane(lane);
          const label =
            ($(".head-fx") as HTMLElement).getAttribute("aria-label") ?? "";
          fxLanes[lane] = label.includes("device");
          voices[lane] = voicesAt4(lane);
        }
        for (const [lane, ok] of Object.entries(fxLanes))
          expect(ok, `${lane} FX chain active`).toBe(true);
        expect(voices.bass, "bass sustained voices").toBeGreaterThanOrEqual(7);
        expect(voices.chords, "chords sustained voices").toBeGreaterThanOrEqual(
          6,
        );
        expect(voices.lead, "lead sustained voices").toBeGreaterThanOrEqual(4);
        expect(
          voices.bass + voices.chords + voices.lead,
          "total sustained voices at step 4 (m5: voices as budgeted)",
        ).toBeGreaterThanOrEqual(16);

        // --- Window A: LEAD displayed (densest grid + sustained runs) -------
        // Playing + editing (cell toggles away from the runs) + VERTICAL page
        // scroll under the sticky chrome (the repaint law).
        await clickPlayAndWait(app);
        await sleep(700);

        const measureWindow = (
          windowMs: number,
          editCells: () => HTMLElement[],
          scrollTick: (frameIdx: number) => void,
          probe: () => void,
        ): Promise<{
          intervals: number[];
          editBlocks: number[];
          playheadMoves: number;
        }> =>
          new Promise((resolve) => {
            const intervals: number[] = [];
            const editBlocks: number[] = [];
            let playheadMoves = 0;
            let lastTransform = "";
            let edits = 0;
            let last = performance.now();
            const start = last;
            let frameIdx = 0;
            const frame = () => {
              const now = performance.now();
              intervals.push(now - last);
              last = now;
              const cells = editCells();
              if (cells.length > 0) {
                // Two real DOM cell clicks per frame — the fast-editor worst
                // case through click delegation → store → bridge → recompile
                // → renderer.sync, measured as a synchronous block.
                const t0 = performance.now();
                for (let k = 0; k < 2; k++)
                  cells[(edits * 37) % cells.length]!.click();
                edits += 2;
                editBlocks.push(performance.now() - t0);
              }
              scrollTick(frameIdx++);
              const ph = doc().querySelector<HTMLElement>(".grid-playhead");
              if (ph) {
                const t = ph.style.transform;
                if (t && t !== lastTransform) {
                  lastTransform = t;
                  playheadMoves++;
                }
              }
              probe();
              if (now - start < windowMs) requestAnimationFrame(frame);
              else resolve({ intervals, editBlocks, playheadMoves });
            };
            requestAnimationFrame(frame);
          });

        const chromeTopMax = (): number =>
          Math.abs($(".phone-chrome").getBoundingClientRect().top);

        // LEAD: the document must scroll (rows are the phone law).
        await switchLane("lead");
        const de = () => doc().documentElement;
        const maxScrollY = () => Math.max(0, de().scrollHeight - PHONE_H);
        expect(
          maxScrollY(),
          "the tall lane document scrolls at 390×844 (scroll is budgeted, not assumed)",
        ).toBeGreaterThan(0);
        const runsA = () => floor("lead").querySelectorAll(".note-run").length;
        const runCountMin = { v: Infinity };
        // Re-queried per frame (the TH-1 convention): never hold stale
        // element references across store-driven re-renders. Rows 1/3/5 at
        // steps 40+ are the run-free zone — the sustained bars at rows
        // 7/9/11/13 stay untouched while edits land.
        const leadCells = (): HTMLElement[] => {
          const out: HTMLElement[] = [];
          for (const row of [1, 3, 5])
            for (const step of [40, 44, 48, 52, 56, 60])
              out.push(
                ...Array.from(
                  doc().querySelectorAll<HTMLElement>(
                    `.lane-floor[data-lane="lead"] .cell[data-row="${row}"][data-step="${step}"]`,
                  ),
                ),
              );
          return out;
        };
        let scrolledA = false;
        const winA = await measureWindow(
          PHONE_WINDOW_MS,
          () => leadCells(),
          (i) => {
            app.win.scrollTo(0, i % 50 < 25 ? maxScrollY() : 0);
            if (maxScrollY() > 0 && app.win.scrollY > 0) scrolledA = true;
          },
          () => {
            runCountMin.v = Math.min(runCountMin.v, runsA());
          },
        );
        const chromeDevA = chromeTopMax();
        console.log(
          `[MB-5 phone window A lead] frames=${winA.intervals.length} ` +
            `over33.4ms=${winA.intervals.filter((d) => d >= FRAME_BUDGET_MS).length} ` +
            `playheadMoves=${winA.playheadMoves} edits=${winA.editBlocks.length} ` +
            `noteRunsMin=${runCountMin.v === Infinity ? 0 : runCountMin.v} ` +
            `maxScrollY=${maxScrollY()} scrolled=${scrolledA} ` +
            `chromeTopDev=${chromeDevA.toFixed(2)}px`,
        );

        // --- Window B: DRUMS displayed + the euclid FILL overlay REVEALED ---
        // Playing + editing (drum hits) + HORIZONTAL grid scroll (4-bar law).
        await switchLane("drums");
        ($(".head-fill-toggle") as HTMLElement).click();
        await poll(
          () =>
            Number.parseFloat(
              getComputedStyle($(".row-fill.is-overlay")).opacity,
            ) >= 0.99,
          2_000,
          "euclid fill overlay revealed (FILL toggle)",
        );
        const gridScroll = (): HTMLElement =>
          $(".lane-grid-scroll") as HTMLElement;
        expect(
          gridScroll().scrollWidth,
          "4-bar drums h-scrolls INSIDE the grid (the phone law)",
        ).toBeGreaterThan(gridScroll().clientWidth);
        const fillOpacityMin = { v: Infinity };
        const drumCells = (): HTMLElement[] => {
          const out: HTMLElement[] = [];
          for (const row of [0, 1, 2, 3, 4, 5])
            for (const step of [40, 44, 48, 52, 56, 60])
              out.push(
                ...Array.from(
                  doc().querySelectorAll<HTMLElement>(
                    `.lane-floor[data-lane="drums"] .cell[data-row="${row}"][data-step="${step}"]`,
                  ),
                ),
              );
          return out;
        };
        let scrolledB = false;
        const winB = await measureWindow(
          PHONE_WINDOW_MS,
          () => drumCells(),
          (i) => {
            const g = gridScroll();
            const max = g.scrollWidth - g.clientWidth;
            g.scrollLeft = i % 50 < 25 ? max : 0;
            if (g.scrollLeft > 0) scrolledB = true;
          },
          () => {
            const o = Number.parseFloat(
              getComputedStyle($(".row-fill.is-overlay")).opacity,
            );
            fillOpacityMin.v = Math.min(fillOpacityMin.v, o);
          },
        );
        // The single-lane law held through the whole window (one snapshot is
        // the invariant — nothing at phone ever mounts a second grid).
        expect(doc().querySelectorAll(".lane-grid")).toHaveLength(1);
        const chromeDevB = chromeTopMax();
        console.log(
          `[MB-5 phone window B drums+fill] frames=${winB.intervals.length} ` +
            `over33.4ms=${winB.intervals.filter((d) => d >= FRAME_BUDGET_MS).length} ` +
            `playheadMoves=${winB.playheadMoves} edits=${winB.editBlocks.length} ` +
            `fillOpacityMin=${fillOpacityMin.v.toFixed(2)} ` +
            `hScrolled=${scrolledB} chromeTopDev=${chromeDevB.toFixed(2)}px`,
        );

        // --- Budgets (pooled across both windows — one law) ------------------
        const all = [...winA.intervals, ...winB.intervals];
        const sorted = [...all].sort((a, b) => a - b);
        const over = all.filter((d) => d >= FRAME_BUDGET_MS);
        const allEdits = [...winA.editBlocks, ...winB.editBlocks];
        const worstEdit = Math.max(...allEdits);
        console.log(
          `[MB-5 phone budget] frames=${all.length} over33.4ms=${over.length} ` +
            `max=${sorted[sorted.length - 1].toFixed(1)}ms ` +
            `p95=${sorted[Math.floor(all.length * 0.95)].toFixed(1)}ms ` +
            `median=${sorted[Math.floor(all.length / 2)].toFixed(1)}ms ` +
            `edits=${allEdits.length} worstEditBlock=${worstEdit.toFixed(2)}ms ` +
            `sustainedVoices=${JSON.stringify(voices)}`,
        );

        expect(app.playBtn().textContent).toBe("STOP");
        expect(all.length).toBeGreaterThan((2 * PHONE_WINDOW_MS) / 50); // rAF alive across both windows
        expect(
          over.length / all.length,
          `${over.length}/${all.length} phone frames ≥ ${FRAME_BUDGET_MS} ms ` +
            `(max ${sorted[sorted.length - 1].toFixed(1)} ms)`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);
        for (const w of [winA, winB])
          expect(w.playheadMoves).toBeGreaterThanOrEqual(
            (PHONE_WINDOW_MS / 1000) * MIN_PLAYHEAD_MOVES_PER_SEC,
          );
        expect(
          worstEdit,
          `worst phone edit block ${worstEdit.toFixed(1)} ms`,
        ).toBeLessThan(TOGGLE_BLOCK_BUDGET_MS);
        // The phone laws really exercised: scroll happened (both axes),
        // the runs kept rendering, the overlay stayed revealed, chrome pinned.
        expect(scrolledA, "vertical page scroll ran during playback").toBe(
          true,
        );
        expect(scrolledB, "horizontal grid scroll ran during playback").toBe(
          true,
        );
        expect(
          runCountMin.v,
          "sustained note-runs kept rendering through the edit window",
        ).toBeGreaterThanOrEqual(4);
        expect(
          fillOpacityMin.v,
          "the euclid fill overlay stayed revealed through window B",
        ).toBeGreaterThanOrEqual(0.99);
        expect(
          Math.max(chromeDevA, chromeDevB),
          "sticky chrome stayed pinned through every scroll",
        ).toBeLessThanOrEqual(1.5);
      } finally {
        await app.teardown();
      }
    },
    240_000,
  );

  it(
    "(m-b) drag storms at 390×844 during playback keep the TH-4 (b) laws: frame budget, move dispatch budgets, zero non-preview mutations mid-gesture",
    { timeout: 240_000 },
    async () => {
      const app = await bootBuiltApp({ width: PHONE_W, height: PHONE_H });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const floor = (lane: string): HTMLElement =>
          $(`.lane-floor[data-lane="${lane}"]`);
        const cellAt = (lane: string, row: number, step: number): HTMLElement =>
          $(
            `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const center = (el: Element): { x: number; y: number } => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const pe = (type: string, x: number, y: number): PointerEvent =>
          new PointerEvent(type, {
            pointerId: 1,
            isPrimary: true,
            button: 0,
            pointerType: "mouse",
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
        const stepWidth = (lane: string): number => {
          const a = cellAt(lane, 0, 0).getBoundingClientRect();
          const b = cellAt(lane, 0, 1).getBoundingClientRect();
          return b.left - a.left;
        };
        const switchLane = async (lane: string): Promise<void> => {
          ($(`.lane-switch-tab[data-lane="${lane}"]`) as HTMLElement).click();
          await poll(
            () =>
              doc().querySelector(".lane-floor")?.getAttribute("data-lane") ===
                lane &&
              doc().querySelector(
                `.lane-floor[data-lane="${lane}"] .cell[data-row="0"][data-step="0"]`,
              ) !== null,
            4_000,
            `${lane} phone stage`,
          );
        };

        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone",
        );
        await poll(
          () => doc().querySelectorAll(".rail-tile").length >= 2,
          5_000,
          "demo chain tiles",
        );
        expect(doc().querySelector(".help-backdrop")).toBeNull();
        expect(doc().querySelector(".info-view")).toBeNull();

        // --- setup: dense 4-bar bass grid + two resize-target notes ---------
        // LL-1 journey delta: +4B retired with the LENGTH stepper — the
        // rail `+` blank (1 bar) then the global `b` ladder ×2.
        await switchLane("bass");
        ($('.rail-row[data-lane="bass"] .rail-append') as HTMLElement).click();
        await poll(
          () =>
            doc().querySelectorAll(
              '.rail-row[data-lane="bass"] .rail-tile',
            ).length === 5,
          2_000,
          "bass blank appended",
        );
        for (const k of ["b", "b"]) {
          doc().body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        await poll(
          () =>
            floor("bass").querySelectorAll(".cell").length > 0 &&
            floor("bass").querySelectorAll(".cell").length % 64 === 0,
          5_000,
          "bass 4-bar grid",
        );
        for (const row of [0, 2] as const) {
          const el = cellAt("bass", row, 0);
          const c = center(el);
          const cells = el.parentElement!.getBoundingClientRect();
          const w = stepWidth("bass");
          el.dispatchEvent(pe("pointerdown", c.x, c.y));
          for (let s = 3; s <= 19; s += 4)
            el.dispatchEvent(
              pe("pointermove", cells.left + (s + 0.5) * w, c.y),
            );
          el.dispatchEvent(pe("pointerup", cells.left + 19.5 * w, c.y));
        }
        await poll(
          () => floor("bass").querySelectorAll(".note-run").length >= 2,
          3_000,
          "bass resize-target notes committed",
        );

        // PLAY first: the storms must hold DURING PLAYBACK (TH-4 (b) law).
        await clickPlayAndWait(app);
        await sleep(500);

        const allIntervals: number[] = [];
        const allMoveBlocks: number[] = [];
        const violations: string[] = [];
        const saw: Record<string, boolean> = {
          createPreviewBar: false,
          createPreviewCells: false,
          resizeWidthChanges: false,
          paintPreviewCells: false,
          cuePreview: false,
        };
        const storm = (
          label: string,
          begin: () => void,
          move: (i: number) => PointerEvent,
          moveTarget: () => Element,
          finish: () => void,
          sample: () => void,
        ): Promise<void> =>
          runStormWindow(
            app.win,
            doc,
            violations,
            "MB-5",
            label,
            begin,
            move,
            moveTarget,
            finish,
            sample,
          ).then((r) => {
            allIntervals.push(...r.intervals);
            allMoveBlocks.push(...r.moveBlocks);
          });

        // Storm 1 — drag-create preview (bass, the phone's editing lane).
        {
          const lane = "bass";
          const row = 4;
          const press = cellAt(lane, row, 0);
          const c = center(press);
          const cells = press.parentElement!.getBoundingClientRect();
          const w = stepWidth(lane);
          await storm(
            "drag-create preview @390",
            () => press.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const stepFloat = 2 + ((i * 3) % 40);
              return pe("pointermove", cells.left + (stepFloat + 0.5) * w, c.y);
            },
            () => press,
            () =>
              press.dispatchEvent(pe("pointerup", cells.left + 10.5 * w, c.y)),
            () => {
              if (doc().querySelector(".note-run.is-drag-preview"))
                saw.createPreviewBar = true;
              if (
                floor(lane).querySelector('.cell[data-preview="true"]') !== null
              )
                saw.createPreviewCells = true;
            },
          );
          await poll(
            () =>
              floor(lane).querySelector(`.note-edge[data-row="${row}"]`) !==
              null,
            2_000,
            "phone storm-created note committed on release",
          );
        }

        // Storm 2 — edge resize (the row-0 note from setup).
        {
          const lane = "bass";
          const edge = $(
            `.lane-floor[data-lane="${lane}"] .note-edge[data-row="0"]`,
          );
          const c = center(edge);
          const cells = edge.closest(".row-cells")!.getBoundingClientRect();
          const w = stepWidth(lane);
          const noteStart = Number(edge.dataset.start);
          const runEl = edge.parentElement as HTMLElement;
          const widths = new Set<string>();
          await storm(
            "edge-resize @390",
            () => edge.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const endStep = noteStart + 4 + ((i * 2) % 22);
              return pe("pointermove", cells.left + (endStep + 0.5) * w, c.y);
            },
            () => edge,
            () =>
              edge.dispatchEvent(
                pe("pointerup", cells.left + (noteStart + 12 + 0.5) * w, c.y),
              ),
            () => {
              widths.add(runEl.style.width);
              if (widths.size >= 2) saw.resizeWidthChanges = true;
            },
          );
          await poll(
            () =>
              (
                floor(lane).querySelector(".note-length-live")?.textContent ??
                ""
              ).startsWith("LENGTH"),
            2_000,
            "phone resize announcement after release commit",
          );
        }

        // Storm 3 — drums paint (switch OUTSIDE any observed move window).
        await switchLane("drums");
        {
          const row = 1;
          const press = cellAt("drums", row, 2);
          const c = center(press);
          const cells = press.parentElement!.getBoundingClientRect();
          const w = stepWidth("drums");
          await storm(
            "drums paint @390",
            () => press.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const step = 2 + ((i * 2) % 12);
              return pe("pointermove", cells.left + (step + 0.5) * w, c.y);
            },
            () => press,
            () =>
              press.dispatchEvent(pe("pointerup", cells.left + 10.5 * w, c.y)),
            () => {
              if (
                floor("drums").querySelector('.cell[data-preview="true"]') !==
                null
              )
                saw.paintPreviewCells = true;
            },
          );
          await poll(
            () =>
              floor("drums").querySelectorAll<HTMLElement>(
                '.cell[data-row="1"][data-on="true"]',
              ).length >= 4,
            2_000,
            "phone painted hits committed on release",
          );
        }

        // Storm 4 — rail cue sweep across the CONDENSED rail's tiles (the
        // phone rail is the active lane's single row, inside the sticky
        // chrome; aim at tiles visible in the strip so the hit-test resolves
        // a real tile, never a gap).
        {
          const row = $('.rail-row[data-lane="drums"]');
          const strip = row.parentElement as HTMLElement;
          const visibleTiles = (): HTMLElement[] => {
            const sr = strip.getBoundingClientRect();
            const list = Array.from(
              row.querySelectorAll<HTMLElement>(".rail-tile"),
            ).filter((t) => {
              const r = t.getBoundingClientRect();
              return r.left >= sr.left - 1 && r.right <= sr.right + 1;
            });
            return list.length >= 2
              ? list
              : [row.querySelector<HTMLElement>(".rail-tile")!];
          };
          const t0 = visibleTiles()[0]!;
          const c0 = center(t0);
          await storm(
            "rail sweep @390",
            () => t0.dispatchEvent(pe("pointerdown", c0.x, c0.y)),
            (i) => {
              const tiles = visibleTiles();
              const tile = tiles[(i * 3) % tiles.length]!;
              const c = center(tile);
              return pe("pointermove", c.x, c.y);
            },
            () => t0,
            () => {
              const target = visibleTiles()[0]!;
              const c = center(target);
              t0.dispatchEvent(pe("pointerup", c.x, c.y));
            },
            () => {
              if (doc().querySelector("[data-cue-preview]") !== null)
                saw.cuePreview = true;
            },
          );
          await poll(
            () =>
              doc().querySelector('.rail-tile[data-state="pending"]') !== null,
            4_000,
            "phone pending switch after sweep commit (quantized)",
          );
        }

        // --- Budgets (the TH-4 (b) laws, unchanged at phone width) ----------
        expect(allIntervals.length).toBeGreaterThan((STORM_WINDOW_MS / 50) * 3);
        const over = allIntervals.filter((d) => d >= FRAME_BUDGET_MS);
        const sorted = [...allIntervals].sort((a, b) => a - b);
        expect(
          over.length / allIntervals.length,
          `${over.length}/${allIntervals.length} phone storm frames ≥ ${FRAME_BUDGET_MS} ms`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);

        const worstMove = Math.max(...allMoveBlocks);
        expect(
          worstMove,
          `worst phone pointermove dispatch ${worstMove.toFixed(1)} ms`,
        ).toBeLessThan(MOVE_BLOCK_BUDGET_MS);
        const sortedMoves = [...allMoveBlocks].sort((a, b) => a - b);
        const medianMove = sortedMoves[Math.floor(sortedMoves.length / 2)];
        expect(
          medianMove,
          `median phone pointermove dispatch ${medianMove.toFixed(2)} ms`,
        ).toBeLessThan(MEDIAN_MOVE_BUDGET_MS);
        console.log(
          `[MB-5 storm totals @390] frames=${allIntervals.length} ` +
            `over33.4ms=${over.length} moves=${allMoveBlocks.length} ` +
            `max=${sorted[sorted.length - 1].toFixed(1)}ms ` +
            `worstMove=${worstMove.toFixed(2)}ms medianMove=${medianMove.toFixed(2)}ms`,
        );

        expect(
          violations,
          `non-preview DOM mutations mid-gesture at phone (store writes = layout thrash):\n${violations.join("\n")}`,
        ).toEqual([]);
        expect(saw.createPreviewBar, "phone drag-create preview bar").toBe(
          true,
        );
        expect(saw.createPreviewCells, "phone drag-create preview cells").toBe(
          true,
        );
        expect(saw.resizeWidthChanges, "phone resize preview width").toBe(true);
        expect(saw.paintPreviewCells, "phone paint preview cells").toBe(true);
        expect(saw.cuePreview, "phone rail sweep preview").toBe(true);
        expect(app.playBtn().textContent).toBe("STOP");
      } finally {
        await app.teardown();
      }
    },
    240_000,
  );

  it(
    "(m-c) lazy sample decode mid-playback stays off the critical path; zero eager audio-asset fetch at phone; voice budget unchanged (8/lane, 32 total)",
    { timeout: 120_000 },
    async () => {
      // Voice budget (m5 "voices as budgeted"): UNCHANGED by mobile — the
      // worklet pool and the native sample host both cap at 8/lane → 32
      // total across four lanes; the audio graph has no viewport branch
      // (verified: src/audio + engineBridge never read the stage mode), so
      // this is the whole law, pinned against the engine's own constants.
      expect(VOICES_PER_LANE).toBe(8);
      expect(SAMPLE_VOICES_PER_LANE).toBe(VOICES_PER_LANE);

      // Instrument (do NOT stall — real same-origin OGGs, real decodes): the
      // law under test is that the fetch/decode fired by a MID-PLAYBACK
      // sample-sound selection never blocks the frame loop or the transport.
      const AUDIO_ASSET =
        /\/assets\/content[/-]|\.ogg(?:$|\?)|\.oga(?:$|\?)|\.mp3(?:$|\?)|\.wav(?:$|\?)|\.flac(?:$|\?)/i;
      const fetched: string[] = [];
      let decodeCalls = 0;
      const app = await bootBuiltApp({
        width: PHONE_W,
        height: PHONE_H,
        beforeWrite: (win) => {
          const origFetch = win.fetch.bind(win);
          win.fetch = ((
            input: RequestInfo | URL,
            init?: RequestInit,
          ): Promise<Response> => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
            if (AUDIO_ASSET.test(url)) fetched.push(url);
            return origFetch(url, init);
          }) as typeof win.fetch;
        },
        audioProtoHook: (proto) => {
          // Count every decode, delegate to the real one (no stall — the
          // law under test is WHERE the decode runs, not how slow it is).
          const origDecode = proto.decodeAudioData as (
            this: unknown,
            ...args: unknown[]
          ) => Promise<AudioBuffer>;
          proto.decodeAudioData = function (
            this: unknown,
            ...args: unknown[]
          ): Promise<AudioBuffer> {
            decodeCalls++;
            return origDecode.apply(this, args);
          };
        },
      });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone",
        );
        await poll(
          () => doc().querySelectorAll(".rail-tile").length >= 2,
          5_000,
          "demo chain tiles",
        );
        expect(doc().querySelector(".help-backdrop")).toBeNull();

        // Switch to BASS (the editing lane), PLAY the synth demo.
        ($(`.lane-switch-tab[data-lane="bass"]`) as HTMLElement).click();
        await poll(
          () =>
            doc().querySelector(".lane-floor")?.getAttribute("data-lane") ===
            "bass",
          2_000,
          "bass phone stage",
        );
        await clickPlayAndWait(app);
        await new Promise((r) => setTimeout(r, 500));

        // Lazy law at phone: NOTHING fetched before the explicit selection.
        expect(
          fetched,
          "audio-asset fetches on the phone boot/play path (eager = regression)",
        ).toEqual([]);

        // Measure a 3 s window; ~10 frames in, step the bass preset to the
        // PS-4 sample voice (SUB DROP) — the lazy content chunk + fetch +
        // decode fire MID-PLAYBACK, all observed inside the window.
        const next = $(
          'button[aria-label="Next preset for BASS"]',
        ) as HTMLButtonElement;
        const value = $('[aria-label="BASS sound"] .head-ctl-value');
        const intervals: number[] = [];
        const clickBlocks: number[] = [];
        let playheadMoves = 0;
        let lastTransform = "";
        await new Promise<void>((resolve) => {
          let stepped = false;
          let last = performance.now();
          const start = last;
          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            if (!stepped) {
              const t0 = performance.now();
              if (value.textContent?.trim() === "SUB DROP") {
                stepped = true;
              } else {
                next.click(); // one real stepper click per frame
              }
              clickBlocks.push(performance.now() - t0);
            }
            const ph = doc().querySelector<HTMLElement>(".grid-playhead");
            if (ph) {
              const t = ph.style.transform;
              if (t && t !== lastTransform) {
                lastTransform = t;
                playheadMoves++;
              }
            }
            if (now - start < 3000) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });

        // The decode is async — it may land just after the window; poll.
        await poll(
          () => decodeCalls >= 1,
          5_000,
          "lazy decode fired after the mid-playback sample selection",
        );

        const sorted = [...intervals].sort((a, b) => a - b);
        const over = intervals.filter((d) => d >= FRAME_BUDGET_MS);
        console.log(
          `[MB-5 lazy decode @390] frames=${intervals.length} ` +
            `over33.4ms=${over.length} max=${sorted[sorted.length - 1].toFixed(1)}ms ` +
            `median=${sorted[Math.floor(intervals.length / 2)].toFixed(1)}ms ` +
            `stepperClicks=${clickBlocks.length} ` +
            `worstClickBlock=${Math.max(...clickBlocks).toFixed(2)}ms ` +
            `decodeCalls=${decodeCalls} audioFetches=${fetched.length} ` +
            `preset=${value.textContent?.trim()}`,
        );

        // Budgets: the decode fired mid-playback and the frames held.
        expect(value.textContent?.trim()).toBe("SUB DROP");
        expect(fetched.length, "the lazy fetch actually fired").toBeGreaterThan(
          0,
        );
        expect(app.playBtn().textContent).toBe("STOP"); // transport survived
        expect(intervals.length).toBeGreaterThan(3000 / 50);
        expect(
          over.length / intervals.length,
          `${over.length}/${intervals.length} frames ≥ ${FRAME_BUDGET_MS} ms while the lazy decode landed mid-playback`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);
        expect(playheadMoves).toBeGreaterThanOrEqual(
          3 * MIN_PLAYHEAD_MOVES_PER_SEC,
        );
        const worstClick = Math.max(...clickBlocks);
        expect(
          worstClick,
          `worst stepper click block ${worstClick.toFixed(1)} ms (a blocking decode would blow past 50 ms)`,
        ).toBeLessThan(TOGGLE_BLOCK_BUDGET_MS);
      } finally {
        await app.teardown();
      }
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// TH-5 (a)(b) — long-lane playback frame budget + virtualization laws at
// the dense mixed-chain state (desktop, 1440×900). The state is LP-1's
// denseLead128Doc (drums 64B + bass 4B + chords 8B + a dense 128-bar lead;
// LCM = one 128-bar cycle, per-lane cycles all different — the LL-2 poly-
// loop visual), imported through the REAL OPEN FILE path so the built app
// itself owns the document under measurement.
// ---------------------------------------------------------------------------

describe("TH-5 (a)(b) long-lane playback + virtualization (built app, 1440×900, dense mixed chains incl. a 128-bar lead)", () => {
  it(
    "mixed-length chains (64/16/8/128 bars) playing keep ≥95% frames < 33.4 ms with all four per-lane sweeps live; window census ≪ eager and pattern-independent; the 2048-column fling sweep holds; per-edit blocks < 50 ms",
    { timeout: 300_000 },
    async () => {
      const app = await bootBuiltApp({ width: VIEW_W, height: VIEW_H });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const floor = (lane: string): HTMLElement =>
          $(`.lane-floor[data-lane="${lane}"]`);
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        await poll(
          () =>
            [...doc().querySelectorAll(".rail-tile-cue")].some(
              (c) => c.textContent === "VERSE",
            ),
          5000,
          "demo cues",
        );
        // TH-4 (c) law carries: every TH-5 measurement runs help-mode-off.
        expect(doc().querySelector(".help-backdrop")).toBeNull();
        expect(doc().querySelector(".info-view")).toBeNull();

        // --- the dense long-loop state through the REAL OPEN FILE path ----
        importDocFile(
          app,
          encode(denseLead128Doc()),
          "th5-dense-long-loop.bitbounce.json",
        );
        await poll(
          () =>
            railBadge(doc, "drums") === "64B" &&
            railBadge(doc, "bass") === "4B" &&
            railBadge(doc, "chords") === "8B" &&
            railBadge(doc, "lead") === "128B",
          10_000,
          "imported dense long-loop doc (mixed chains 64/4/8/128 bars)",
        );

        // --- (b) the virtualization census law ----------------------------
        const census0 = doc().querySelectorAll(".cell").length;
        const runs0 = doc().querySelectorAll(".note-run").length;
        console.log(
          `[TH-5 census @dense-128, 1440×900] ${census0.toLocaleString()} cells (${runs0.toLocaleString()} note-runs) — eager ${EAGER_CENSUS_DENSE_128.toLocaleString()} (${((census0 / EAGER_CENSUS_DENSE_128) * 100).toFixed(1)}%)`,
        );
        expect(census0).toBeLessThan(LONG_CENSUS_MAX);
        // Pattern-wide native extents (the sizer) + the sticky layer on the
        // long-pattern scrollers; the ≤4-bar grid stays EAGER (the LL-1
        // byte-identity law).
        const leadH = floor("lead").querySelector<HTMLElement>(
          ".lane-grid-scroll .grid-hscroll",
        )!;
        expect(leadH.querySelector(".grid-col-sizer"), "lead sizer").toBeTruthy();
        expect(leadH.querySelector(".grid-col-layer"), "lead sticky layer").toBeTruthy();
        expect(leadH.scrollWidth).toBeGreaterThan(30_000); // 2048 steps × 17 px
        const drumsH = floor("drums").querySelector<HTMLElement>(
          ".lane-grid-scroll .grid-hscroll",
        )!;
        expect(drumsH.scrollWidth).toBeGreaterThan(15_000); // 1024 × 22 px
        expect(
          floor("bass").querySelector(".grid-col-sizer"),
          "the 4-bar grid stays EAGER",
        ).toBeNull();

        // --- (b) census vs PATTERN SIZE: grow bass 4→16 bars --------------
        // The census tracks the WINDOW, never the pattern: the bass pattern's
        // step count ×4s while its DOM census stays ~constant (an eager
        // 16-bar bass would be 7 rows × 256 = 1,792 cells).
        const bassBefore = floor("bass").querySelectorAll(".cell").length;
        // The ladder acts on the ACTIVE lane: select bass first (the click
        // also toggles that cell — a legitimate edit on the imported doc).
        (floor("bass").querySelector(".cell") as HTMLElement).click();
        await poll(
          () => floor("bass").dataset.editing === "true",
          2000,
          "bass quadrant selected",
        );
        for (const k of ["b", "b"]) {
          doc().body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        await poll(
          () =>
            floor("bass").querySelector(".grid-col-sizer") !== null &&
            railBadge(doc, "bass") === "16B",
          5_000,
          "bass grown 4→16 bars (virtualized)",
        );
        const bassAfter = floor("bass").querySelectorAll(".cell").length;
        console.log(
          `[TH-5 census-vs-pattern] bass 4B→16B (steps ×4): cells ${bassBefore}→${bassAfter} (eager 16-bar would be ${7 * 256})`,
        );
        expect(bassAfter).toBeLessThanOrEqual(bassBefore + 400);
        expect(doc().querySelectorAll(".cell").length).toBeLessThan(
          LONG_CENSUS_MAX,
        );

        // --- (a) PLAY, settle, wait for a quiet machine --------------------
        await clickPlayAndWait(app);
        // The imported doc's autosave flush (its canonical encode) + the
        // engine's first schedule generation are one-off costs, not per-frame
        // render cost (the LP-1 settle precedent).
        await sleep(1200);
        await waitForQuietRaf();

        const stats = await new Promise<{
          intervals: number[];
          moves: Record<string, number>;
        }>((resolve) => {
          const intervals: number[] = [];
          const moves: Record<string, number> = {
            drums: 0,
            bass: 0,
            chords: 0,
            lead: 0,
          };
          const lastT: Record<string, string> = {};
          let last = performance.now();
          const start = last;
          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            for (const lane of LANES) {
              const ph =
                floor(lane).querySelector<HTMLElement>(".grid-playhead");
              if (ph) {
                const t = ph.style.transform;
                if (t && t !== lastT[lane]) {
                  lastT[lane] = t;
                  moves[lane]++;
                }
              }
            }
            if (now - start < MEASURE_MS) requestAnimationFrame(frame);
            else resolve({ intervals, moves });
          };
          requestAnimationFrame(frame);
        });
        const sorted = [...stats.intervals].sort((a, b) => a - b);
        const over = stats.intervals.filter((d) => d >= FRAME_BUDGET_MS);
        console.log(
          `[TH-5 long-lane frames @dense-128, 4 s pure rendering] frames=${stats.intervals.length} over33.4ms=${over.length} max=${sorted[sorted.length - 1].toFixed(1)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms playheadMoves=${JSON.stringify(stats.moves)} (per-lane cycles 64/16/8/128 bars)`,
        );
        expect(app.playBtn().textContent).toBe("STOP");
        for (const lane of LANES) {
          expect(
            stats.moves[lane],
            `${lane} per-lane sweep live (its own cycle length)`,
          ).toBeGreaterThanOrEqual(
            (MEASURE_MS / 1000) * MIN_PLAYHEAD_MOVES_PER_SEC,
          );
        }
        expect(stats.intervals.length).toBeGreaterThan(MEASURE_MS / 50);
        expect(
          over.length / stats.intervals.length,
          `${over.length}/${stats.intervals.length} long-lane frames ≥ ${FRAME_BUDGET_MS} ms (max ${sorted[sorted.length - 1].toFixed(1)} ms, median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms)`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);

        // --- (a) register-window fling sweep on the 2048-column grid ------
        // (the LP-1 verifier's load-sensitive assert — quiet-poll first, the
        // ratio itself stays HARD)
        await waitForQuietRaf();
        const sweep = sweepScroll(leadH, LONG_SWEEP_MS);
        const sweepStats = await new Promise<{
          intervals: number[];
          maxFirstStep: number;
          censusMin: number;
          censusMax: number;
        }>((resolve) => {
          const intervals: number[] = [];
          let maxFirstStep = 0;
          let censusMin = Infinity;
          let censusMax = 0;
          let last = performance.now();
          const start = last;
          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            // Window observables (the virtualization laws, DOM-side): the
            // first rendered cell's PATTERN step (the window origin) and the
            // census (the pool size).
            const first = floor("lead").querySelector<HTMLElement>(
              ".row-cells .cell",
            );
            if (first)
              maxFirstStep = Math.max(maxFirstStep, Number(first.dataset.step));
            const c = floor("lead").querySelectorAll(".cell").length;
            censusMin = Math.min(censusMin, c);
            censusMax = Math.max(censusMax, c);
            if (now - start < LONG_SWEEP_MS) requestAnimationFrame(frame);
            else resolve({ intervals, maxFirstStep, censusMin, censusMax });
          };
          requestAnimationFrame(frame);
        });
        await sweep;
        const sSorted = [...sweepStats.intervals].sort((a, b) => a - b);
        const sOver = sweepStats.intervals.filter(
          (d) => d >= FRAME_BUDGET_MS,
        );
        console.log(
          `[TH-5 fling sweep @2048 cols] frames=${sweepStats.intervals.length} over33.4ms=${sOver.length} max=${sSorted[sSorted.length - 1].toFixed(1)}ms p95=${sSorted[Math.floor(sSorted.length * 0.95)].toFixed(1)}ms median=${sSorted[Math.floor(sSorted.length / 2)].toFixed(1)}ms | window first-step max ${sweepStats.maxFirstStep} | lead census ${sweepStats.censusMin}-${sweepStats.censusMax}`,
        );
        expect(
          sOver.length / sweepStats.intervals.length,
          `${sOver.length}/${sweepStats.intervals.length} fling frames ≥ ${FRAME_BUDGET_MS} ms (max ${sSorted[sSorted.length - 1].toFixed(1)} ms)`,
        ).toBeLessThan(1 - FRAME_PASS_RATIO);
        expect(
          sweepStats.maxFirstStep,
          "the window re-seated during the sweep (rewindows ran)",
        ).toBeGreaterThan(100);
        expect(
          sweepStats.censusMax - sweepStats.censusMin,
          "pool recycling: the census stayed constant through the rewindows",
        ).toBeLessThanOrEqual(200);

        leadH.scrollLeft = 0;
        await poll(
          () =>
            floor("lead").querySelector(
              '.cell[data-row="1"][data-step="16"]',
            ) !== null,
          2000,
          "window re-seated at column 0",
        );

        // --- (b) bounded time-math: the per-edit long-task guard ----------
        // The retired O(steps) scan measured 276-438 ms per toggle at this
        // state; the O(1) lookup sits at 10-21 ms. The < 50 ms assert IS the
        // no-per-frame-linear-scans law (the §10c re-pin).
        const blocks: number[] = [];
        for (let k = 0; k < 5; k++) {
          const cell = floor("lead").querySelector<HTMLElement>(
            `.cell[data-row="1"][data-step="${16 + k * 4}"]`,
          );
          if (!cell) throw new Error("missing lead toggle cell");
          const t0 = performance.now();
          cell.click();
          blocks.push(performance.now() - t0);
          await sleep(120);
        }
        console.log(
          `[TH-5 toggle blocks @128-bar lead] ${blocks.map((b) => b.toFixed(0)).join("/")} ms per toggle (store → validate → recompile → renderer sync on the O(1) step lookup)`,
        );
        for (const b of blocks)
          expect(
            b,
            `toggle block ${b.toFixed(1)} ms (the §10c re-pin: the 50 ms guard stays HARD)`,
          ).toBeLessThan(TOGGLE_BLOCK_BUDGET_MS);
      } finally {
        await app.teardown();
      }
    },
    300_000,
  );
});

// ---------------------------------------------------------------------------
// TH-5 (a′) — the long-lane phone window (390×844, the MB-5 stance: CI
// Chromium is desktop-class hardware emulating the viewport — a regression
// catch, not a device-class verdict).
// ---------------------------------------------------------------------------

describe("TH-5 (a′) long-lane phone window (built app, 390×844, dense 128-bar lead visible)", () => {
  it(
    "the phone stage playing the dense long-loop doc keeps ≥95% frames < 33.4 ms (pure render + the 2048-column register sweep); census window-bounded",
    { timeout: 240_000 },
    async () => {
      const app = await bootBuiltApp({ width: PHONE_W, height: PHONE_H });
      try {
        const doc = app.doc;
        const $ = <T extends Element>(sel: string): T => {
          const el = doc().querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const floor = (lane: string): HTMLElement =>
          $(`.lane-floor[data-lane="${lane}"]`);
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const switchLane = async (lane: string): Promise<void> => {
          ($(`.lane-switch-tab[data-lane="${lane}"]`) as HTMLElement).click();
          await poll(
            () =>
              doc().querySelectorAll(".lane-grid").length === 1 &&
              doc().querySelector(".lane-floor")?.getAttribute("data-lane") ===
                lane &&
              doc().querySelector(
                `.lane-floor[data-lane="${lane}"] .cell`,
              ) !== null,
            4_000,
            `${lane} phone stage (single floor + cells)`,
          );
        };

        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone at 390×844",
        );
        await poll(
          () => doc().querySelectorAll(".rail-tile").length >= 2,
          5_000,
          "demo chain tiles (phone boot signal)",
        );
        expect(doc().querySelector(".help-backdrop")).toBeNull();
        expect(doc().querySelector(".info-view")).toBeNull();

        // LEAD displayed, then the dense long-loop doc through OPEN FILE
        // (the audio state is viewport-independent — all four lanes play;
        // the phone renders the one 2048-step lead grid).
        await switchLane("lead");
        importDocFile(
          app,
          encode(denseLead128Doc()),
          "th5-dense-long-loop.bitbounce.json",
        );
        await poll(
          () =>
            doc().querySelectorAll(".lane-grid").length === 1 &&
            railBadge(doc, "lead") === "128B" &&
            floor("lead").querySelector(".cell") !== null,
          10_000,
          "imported dense long-loop doc on the phone stage (lead 128B)",
        );

        // Census: the phone's single 2048-step lead grid rides the same
        // column window (eager would be 15 × 2048 = 30,720 cells).
        const census = doc().querySelectorAll(".cell").length;
        console.log(
          `[TH-5 census @dense-128 lead, 390×844] ${census.toLocaleString()} cells (eager was ${(15 * 2048).toLocaleString()})`,
        );
        expect(census).toBeLessThan(LONG_CENSUS_MAX);
        const leadH = floor("lead").querySelector<HTMLElement>(
          ".lane-grid-scroll .grid-hscroll",
        )!;
        expect(leadH.scrollWidth).toBeGreaterThan(30_000);

        await clickPlayAndWait(app);
        await sleep(1000);
        await waitForQuietRaf();

        // Window 1 — pure render + the visible lane's sweep liveness.
        const win1 = await new Promise<{
          intervals: number[];
          moves: number;
        }>((resolve) => {
          const intervals: number[] = [];
          let moves = 0;
          let lastTransform = "";
          let last = performance.now();
          const start = last;
          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            const ph = doc().querySelector<HTMLElement>(".grid-playhead");
            if (ph) {
              const t = ph.style.transform;
              if (t && t !== lastTransform) {
                lastTransform = t;
                moves++;
              }
            }
            if (now - start < PHONE_WINDOW_MS) requestAnimationFrame(frame);
            else resolve({ intervals, moves });
          };
          requestAnimationFrame(frame);
        });

        // Window 2 — the register sweep (quiet-poll first; the ratio HARD).
        await waitForQuietRaf();
        const sweep = sweepScroll(leadH, LONG_SWEEP_MS);
        const win2 = await new Promise<number[]>((resolve) => {
          const intervals: number[] = [];
          let last = performance.now();
          const start = last;
          const frame = () => {
            const now = performance.now();
            intervals.push(now - last);
            last = now;
            if (now - start < LONG_SWEEP_MS) requestAnimationFrame(frame);
            else resolve(intervals);
          };
          requestAnimationFrame(frame);
        });
        await sweep;

        const report = (label: string, intervals: number[]): string => {
          const s = [...intervals].sort((a, b) => a - b);
          const o = intervals.filter((d) => d >= FRAME_BUDGET_MS).length;
          return `[TH-5 ${label} @390×844] frames=${intervals.length} over33.4ms=${o} max=${s[s.length - 1].toFixed(1)}ms median=${s[Math.floor(s.length / 2)].toFixed(1)}ms`;
        };
        console.log(report("phone pure render", win1.intervals));
        console.log(report("phone register sweep", win2));

        expect(app.playBtn().textContent).toBe("STOP");
        for (const intervals of [win1.intervals, win2]) {
          expect(intervals.length).toBeGreaterThan(PHONE_WINDOW_MS / 50);
          const o = intervals.filter((d) => d >= FRAME_BUDGET_MS).length;
          expect(
            o / intervals.length,
            `${o}/${intervals.length} phone frames ≥ ${FRAME_BUDGET_MS} ms`,
          ).toBeLessThan(1 - FRAME_PASS_RATIO);
        }
        expect(win1.moves).toBeGreaterThanOrEqual(
          (PHONE_WINDOW_MS / 1000) * MIN_PLAYHEAD_MOVES_PER_SEC,
        );
      } finally {
        await app.teardown();
      }
    },
    240_000,
  );
});

// ---------------------------------------------------------------------------
// TH-5 (c) — export-cost ceiling. Source-mount block (the LP-1 (d)
// precedent): the REAL offline render pipeline; globalSetup builds this
// exact source, and the render path owns its own OfflineAudioContext. The
// 128-bar worst case stays XP-1's RECORDED determinism probe
// (tests/browser/audio-determinism.test.ts — one ~9 s case per battery,
// CI-cost discipline); this gate pins the 64-bar render the export UI
// actually spans for the user's own poly-loop shape.
// ---------------------------------------------------------------------------

describe("TH-5 (c) export-cost ceiling (REAL offline render, 64-bar gate render)", () => {
  it(
    "the 64-bar musical-density LCM render stays under the pinned wall-time ceiling; loop buffer + heap delta recorded",
    { timeout: 120_000 },
    async () => {
      const heapBefore = heapUsed();
      const t0 = performance.now();
      const rendered = await renderProjectToBuffer(longLoopDoc("user64"));
      const wallMs = performance.now() - t0;
      const heapAfter = heapUsed();
      // 64 bars @120 BPM = 1024 steps × 0.125 s = 128 s of audio.
      expect(rendered.loopSteps).toBe(64 * 16);
      expect(rendered.loopSamples).toBe(Math.round(1024 * 0.125 * 44100));
      const mb = (rendered.loopSamples * 4 * 2) / (1024 * 1024);
      const audioSec = rendered.loopSamples / 44100;
      console.log(
        `[TH-5 export 64-bar ceiling] ${(wallMs / 1000).toFixed(2)} s wall for ${audioSec.toFixed(0)} s audio (x${(audioSec / (wallMs / 1000)).toFixed(0)} real-time) | loop buffer ${mb.toFixed(0)} MB | heap delta ${heapBefore !== undefined && heapAfter !== undefined ? ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(0) : "n/a"} MB | ceiling ${(EXPORT64_CEILING_MS / 1000).toFixed(0)} s`,
      );
      // Sanity: finite + non-silent (a ceiling on a silent render is a lie).
      const mono = rendered.channels[0]!;
      let peak = 0;
      for (let i = 0; i < mono.length; i += 997) {
        const v = Math.abs(mono[i]!);
        if (!Number.isFinite(v)) throw new Error("non-finite sample");
        if (v > peak) peak = v;
      }
      expect(peak).toBeGreaterThan(0.01);
      // THE ceiling — a regression bound from the measured band (perf-budget
      // §10d: method + date), not a UX promise.
      expect(
        wallMs,
        `64-bar gate render wall ${(wallMs / 1000).toFixed(2)} s (ceiling ${EXPORT64_CEILING_MS / 1000} s)`,
      ).toBeLessThan(EXPORT64_CEILING_MS);
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// TH-5 (d) — width-utilization perf (FV-1's perf half): the DENSIFIED
// 1920×1080 stage holds the frame budget while playing. The utilization +
// densification LAWS live in viewport-utilization.test.ts (assertions-only);
// this gate adds the frame-budget window FV-1 left uncovered.
// ---------------------------------------------------------------------------

describe("TH-5 (d) densified 1920×1080 stage frame budget (FV-1's perf half)", () => {
  it(
    "the demo + 4-bar lead playing at 1920×1080 keep ≥95% frames < 33.4 ms, all four playheads live (the wide quadrant, not a capped stage)",
    { timeout: 180_000 },
    async () => {
      await page.viewport(1920, 1080);
      try {
        const app = await bootBuiltApp({ width: 1920, height: 1080 });
        try {
          const doc = app.doc;
          const $ = <T extends Element>(sel: string): T => {
            const el = doc().querySelector<T>(sel);
            if (!el) throw new Error(`missing ${sel}`);
            return el;
          };
          const floor = (lane: string): HTMLElement =>
            $(`.lane-floor[data-lane="${lane}"]`);
          const sleep = (ms: number) =>
            new Promise((r) => setTimeout(r, ms));

          await poll(
            () =>
              [...doc().querySelectorAll(".rail-tile-cue")].some(
                (c) => c.textContent === "VERSE",
              ),
            5000,
            "demo cues",
          );
          expect(doc().querySelector(".help-backdrop")).toBeNull();
          expect(doc().querySelector(".info-view")).toBeNull();

          // FV-1's measurement shape: the lead demo pattern grown to 4 bars
          // (the ladder ×2 — the +4B button retired with the LENGTH stepper).
          floor("lead").click(); // select the quadrant (the ladder's lane)
          await sleep(150);
          for (const k of ["b", "b"]) {
            doc().body.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: k,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
          await poll(
            () =>
              (
                floor("lead").querySelector(".grid-row .row-cells")
                  ?.querySelectorAll(".cell").length ?? 0
              ) === 64,
            5_000,
            "4-bar lead pattern rendered (first row = 64 steps)",
          );
          // The measurement runs on the DENSIFIED stage, not a capped one:
          // at 1920 the quadrant spans ~944 px (FV-1's measured 704 at 1440;
          // the retired 1400 px cap would leave ~660).
          const leadW = floor("lead").getBoundingClientRect().width;
          expect(
            leadW,
            `the 1920 stage is densified (lead quadrant ${leadW.toFixed(0)} px wide)`,
          ).toBeGreaterThan(900);

          await clickPlayAndWait(app);
          await sleep(700);
          await waitForQuietRaf();

          const stats = await new Promise<{
            intervals: number[];
            moves: Record<string, number>;
          }>((resolve) => {
            const intervals: number[] = [];
            const moves: Record<string, number> = {
              drums: 0,
              bass: 0,
              chords: 0,
              lead: 0,
            };
            const lastT: Record<string, string> = {};
            let last = performance.now();
            const start = last;
            const frame = () => {
              const now = performance.now();
              intervals.push(now - last);
              last = now;
              for (const lane of LANES) {
                const ph =
                  floor(lane).querySelector<HTMLElement>(".grid-playhead");
                if (ph) {
                  const t = ph.style.transform;
                  if (t && t !== lastT[lane]) {
                    lastT[lane] = t;
                    moves[lane]++;
                  }
                }
              }
              if (now - start < MEASURE_MS) requestAnimationFrame(frame);
              else resolve({ intervals, moves });
            };
            requestAnimationFrame(frame);
          });
          const sorted = [...stats.intervals].sort((a, b) => a - b);
          const over = stats.intervals.filter((d) => d >= FRAME_BUDGET_MS);
          console.log(
            `[TH-5 densified stage @1920×1080, 4 s] frames=${stats.intervals.length} over33.4ms=${over.length} max=${sorted[sorted.length - 1].toFixed(1)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms playheadMoves=${JSON.stringify(stats.moves)} | lead quadrant ${leadW.toFixed(0)} px`,
          );
          expect(app.playBtn().textContent).toBe("STOP");
          for (const lane of LANES) {
            expect(
              stats.moves[lane],
              `${lane} playhead live at 1920×1080`,
            ).toBeGreaterThanOrEqual(
              (MEASURE_MS / 1000) * MIN_PLAYHEAD_MOVES_PER_SEC,
            );
          }
          expect(stats.intervals.length).toBeGreaterThan(MEASURE_MS / 50);
          expect(
            over.length / stats.intervals.length,
            `${over.length}/${stats.intervals.length} densified-stage frames ≥ ${FRAME_BUDGET_MS} ms (max ${sorted[sorted.length - 1].toFixed(1)} ms)`,
          ).toBeLessThan(1 - FRAME_PASS_RATIO);
        } finally {
          await app.teardown();
        }
      } finally {
        await page.viewport(1280, 800); // restore the harness viewport
      }
    },
    180_000,
  );
});
