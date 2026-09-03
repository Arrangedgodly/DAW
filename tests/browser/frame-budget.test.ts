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
 */

import { describe, expect, it } from "vitest";

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
          if (text === null) throw new Error(`worklet module fetch failed: ${url}`);
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
async function clickPlayAndWait(app: BootResult, budgetMs = 5000): Promise<number> {
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

            const cells = doc().querySelectorAll<HTMLElement>(
              ".lane-grid .cell",
            );
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
        const cellAt = (
          lane: string,
          row: number,
          step: number,
        ): HTMLElement =>
          $(
            `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
        const key = (el: Element, k: string): void => {
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
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
          const label = `Add 4-bar pattern to ${lane.toUpperCase()}`;
          (
            $(
              `.rail-row[data-lane="${lane}"] button[aria-label="${label}"]`,
            ) as HTMLButtonElement
          ).click();
          await poll(
            () => {
              const n = floor(lane).querySelectorAll(".cell").length;
              return n > 0 && n % 64 === 0;
            },
            5000,
            `${lane} 4-bar grid rendered`,
          );
          // The tool adds the pattern to the POOL + selects it; the rail "+"
          // button appends the SELECTED pattern to the lane's chain (the
          // arrangement the engine plays).
          (
            $(
              `.rail-row[data-lane="${lane}"] button[aria-label="Append ${lane.toUpperCase()} selected pattern to chain"]`,
            ) as HTMLButtonElement
          ).click();
          await poll(
            () =>
              doc().querySelectorAll(`.rail-row[data-lane="${lane}"] .rail-tile`)
                .length === 5,
            2000,
            `${lane} dense pattern appended to the chain`,
          );
        };
        /** Drop the four demo chain slots: the lane's chain becomes exactly
         *  its dense 4-bar pattern, so playback AND rendering are dense for
         *  the whole measurement window (poly-loop: the chain is the
         *  arrangement; loopBars stays transport semantics). */
        const stripDemoSlots = async (lane: string): Promise<void> => {
          for (let i = 0; i < 4; i++) {
            const tile = $(`.rail-row[data-lane="${lane}"] .rail-tile`);
            (tile as HTMLElement).focus();
            key(tile, "Delete");
            await poll(
              () =>
                doc().querySelectorAll(`.rail-row[data-lane="${lane}"] .rail-tile`)
                  .length ===
                4 - i,
              2000,
              `${lane} demo chain slot ${i} removed`,
            );
          }
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
        for (const row of [0, 2, 4, 6, 8, 10, 12]) dragCreate("bass", row, 0, 31);
        await poll(
          () => floor("bass").querySelectorAll(".note-run").length >= 7,
          3000,
          "bass sustained notes committed",
        );
        clickCells("bass", [4, 6], [40, 48, 56]);
        await stripDemoSlots("bass");

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
        await stripDemoSlots("chords");

        // lead: 4 sustained long notes (rows 7..13).
        await selectLane("lead");
        await add4Bar("lead");
        for (const row of [7, 9, 11, 13]) dragCreate("lead", row, 0, 31);
        await poll(
          () => floor("lead").querySelectorAll(".note-run").length >= 4,
          3000,
          "lead sustained notes committed",
        );
        await stripDemoSlots("lead");

        // drums: last (stays the editable quadrant); hits on every piece.
        await selectLane("drums");
        await add4Bar("drums");
        clickCells("drums", [0, 1, 2, 3, 4, 5], [0, 8, 16, 24, 32, 40, 48, 56]);
        await stripDemoSlots("drums");

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
        (
          doc().querySelectorAll(".fx-add-item")[0] as HTMLElement
        ).click();
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
            ($(`.lane-floor[data-lane="${lane}"] .head-fx`) as HTMLElement)
              .getAttribute("aria-label") ?? "";
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
              const ph = floor(lane).querySelector<HTMLElement>(
                ".grid-playhead",
              );
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
        const cellAt = (
          lane: string,
          row: number,
          step: number,
        ): HTMLElement =>
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

        // --- storm machinery -------------------------------------------------
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

        /**
         * Commit-on-release = no layout thrash: while the pointer MOVES, the
         * only legal DOM mutations are renderer-local previews (data-preview
         * attrs, the dashed preview bar, the resize width, cue-preview attrs)
         * plus the always-running non-gesture loops: playback UI (playhead
         * transform, trigger glow classes, the booth's direct-DOM readout —
         * textContent writes surface as childList on the LED spans) and the
         * debounced persistence UI (.save-indicator state, fired from earlier
         * legitimate RELEASE commits). Anything else — a store-driven sync
         * (aria-selected/data-on flips), a rail rebuild, a focus shuffle — is
         * a mid-gesture write and FAILS the gate.
         */
        const allowedMutation = (m: MutationRecord): boolean => {
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
            if (a === "data-cue-preview")
              return t.classList.contains("rail-tile");
            if (a === "data-active")
              return t.classList.contains("booth-beat-led");
            if (
              a === "data-status" ||
              a === "aria-label" ||
              a === "title"
            )
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
              (p.closest(".booth") !== null ||
                p.closest(".save-indicator") !== null)
            );
          }
          return false;
        };
        const describeMutation = (m: MutationRecord): string => {
          const t = m.target as Element;
          const name =
            m.type === "attributes"
              ? `@${m.attributeName}`
              : m.type === "childList"
                ? "childList"
                : "text";
          const tag = t.tagName ? t.tagName.toLowerCase() : "#text";
          return `${m.type}${name} on ${tag}.${String(t.className ?? "").slice(0, 50)}`;
        };

        const runStormWindow = async (
          label: string,
          begin: () => void,
          move: (i: number) => PointerEvent,
          moveTarget: () => Element,
          finish: () => void,
          sample: () => void,
        ): Promise<void> => {
          const observer = new app.win.MutationObserver((records) => {
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
          allIntervals.push(...intervals);
          allMoveBlocks.push(...moveBlocks);
          const sortedMoves = [...moveBlocks].sort((a, b) => a - b);
          console.log(
            `[TH-4 storm ${label}] frames=${intervals.length} ` +
              `over33.4ms=${intervals.filter((d) => d >= FRAME_BUDGET_MS).length} ` +
              `moves=${moveBlocks.length} ` +
              `worstMove=${Math.max(...moveBlocks).toFixed(2)}ms ` +
              `medianMove=${sortedMoves[Math.floor(sortedMoves.length / 2)].toFixed(2)}ms`,
          );
        };

        // Storm 1 — drag-create preview (bass, editable quadrant).
        {
          const lane = "bass";
          const row = 4;
          const press = cellAt(lane, row, 0);
          const c = center(press);
          const cells = press.parentElement!.getBoundingClientRect();
          const w = stepWidth(lane);
          await runStormWindow(
            "drag-create preview",
            () => press.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const stepFloat = 2 + ((i * 3) % 40); // oscillate the live length
              return pe(
                "pointermove",
                cells.left + (stepFloat + 0.5) * w,
                c.y,
              );
            },
            () => press,
            () =>
              press.dispatchEvent(
                pe("pointerup", cells.left + 10.5 * w, c.y),
              ),
            () => {
              if (doc().querySelector(".note-run.is-drag-preview"))
                saw.createPreviewBar = true;
              if (
                floor(lane).querySelector('.cell[data-preview="true"]') !==
                null
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
          const cells = edge
            .closest(".row-cells")!
            .getBoundingClientRect();
          const w = stepWidth(lane);
          const noteStart = Number(edge.dataset.start);
          const runEl = edge.parentElement as HTMLElement;
          const widths = new Set<string>();
          await runStormWindow(
            "edge-resize",
            () => edge.dispatchEvent(pe("pointerdown", c.x, c.y)),
            (i) => {
              const endStep = noteStart + 4 + ((i * 2) % 22);
              return pe(
                "pointermove",
                cells.left + (endStep + 0.5) * w,
                c.y,
              );
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
              (floor(lane).querySelector(".note-length-live")?.textContent ?? "")
                .startsWith("LENGTH"),
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
          await runStormWindow(
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
              floor("drums")
                .querySelectorAll<HTMLElement>(
                  '.cell[data-row="1"][data-on="true"]',
                )
                .length >= 4,
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
          await runStormWindow(
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
        expect(allIntervals.length).toBeGreaterThan(
          (STORM_WINDOW_MS / 50) * 3,
        );
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
                () =>
                  resolve(this.createBuffer(1, 128, sampleRate)),
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
