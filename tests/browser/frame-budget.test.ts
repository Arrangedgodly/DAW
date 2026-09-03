/**
 * TH-1 browser test 3 — frame-budget smoke (REAL built app).
 *
 * Approach (recorded choice): the tester page's HTTP module path cannot run
 * the solid JSX transform on .tsx sources, so mounting App from source
 * in-page is not reliable. Instead the globalSetup builds the production
 * bundle and this test loads the BUILT app (the exact code users get, with
 * the real Session/audio path, the rAF playhead loops of all four LaneGrids,
 * and the store → bridge → recompile pipeline driven through real DOM cell
 * clicks) inside a fresh same-origin iframe — same harness shape as the
 * journey tests, so the app's IndexedDB connections close on iframe removal
 * (R14 teardown; the outer-page mount previously left autosaved toggle
 * state in the shared-origin DB with no way to close its connections).
 *
 * Budget (30 fps floor on CI hardware — the true 60 fps gate runs in e2e
 * later if needed; choice recorded in docs/dev/perf-budget.md):
 *   - ≥95% of frame intervals < 33.4 ms while playing + editing (HARD)
 *   - every toggle batch blocks the event loop < 50 ms (long-task guard)
 *
 * Load-robustness law (HW-4 deflake): the 33.4 ms frame bound stays hard;
 * only the playhead liveness COUNT is relaxed — under machine load rAF
 * itself slows (fewer, longer frames — which the budget ratio already
 * polices), so proving "the transport really ran" needs only ≥2 distinct
 * playhead transforms per second of measurement, not a per-frame cadence.
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

// The production bundle built by tests/browser/globalSetup.ts. The glob is
// resolved by vite at transform time; the hashed name changes per build.
const bundle = import.meta.glob("/dist/assets/index-*.js");
const cssFiles = import.meta.glob("/dist/assets/index-*.css");

interface FrameStats {
  intervals: number[];
  toggleBlocks: number[];
  playheadMoves: number;
  buttonLabel: string;
}

describe("frame budget (built app, playing + 200 toggles)", () => {
  it(
    "keeps ≥95% of frames under 33.4 ms and toggles block < 50 ms",
    { timeout: 90_000 },
    async () => {
      const bundleKey = Object.keys(bundle)[0];
      const cssKey = Object.keys(cssFiles)[0];
      expect(
        bundleKey,
        "built bundle not found (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      const iframe = document.createElement("iframe");
      iframe.style.width = "1280px";
      iframe.style.height = "960px";
      document.body.appendChild(iframe);
      const win = iframe.contentWindow!;

      // The built bundle's worklet asset URL (/assets/...) is served by
      // the vite dev server only through the module pipeline (`?import`);
      // a plain addModule fetch hits the SPA fallback. Patch the IFRAME
      // window's AudioContext (the app lives there) so addModule retries
      // via a blob URL built from the pipeline-served module — the worklet
      // code is the exact built asset.
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
                url.replace(
                  /^([a-z]+:\/\/[^/]+)?\/assets\//,
                  "$1/dist/assets/",
                ),
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
      win.AudioContext = TestAudioContext as unknown as typeof AudioContext;

      // R14 hygiene: the 200 toggles autosave through the real boot path
      // into the shared-origin IndexedDB — wipe before boot (deterministic
      // first-run demo) and in teardown.
      await new Promise<void>((resolve) => {
        const req = win.indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

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

      // Module script mounts on import — poll for the app.
      await new Promise<void>((resolve, reject) => {
        const t0 = performance.now();
        const check = () => {
          if (doc().querySelector(".booth")) return resolve();
          if (performance.now() - t0 > 15000)
            return reject(new Error("app never mounted"));
          setTimeout(check, 50);
        };
        check();
      });
      expect(doc().querySelectorAll(".lane-grid").length).toBe(4);

      // PLAY via the real booth button (real gesture → ctx.resume path;
      // CI launches Chromium with --autoplay-policy=no-user-gesture-required).
      const playBtn = () =>
        doc().querySelector<HTMLButtonElement>(".booth-btn-play")!;
      playBtn().click();

      // Wait until the transport is actually playing.
      await new Promise<void>((resolve, reject) => {
        const t0 = performance.now();
        const check = () => {
          if (playBtn().textContent === "STOP") return resolve();
          if (performance.now() - t0 > 5000)
            return reject(new Error("transport never started"));
          setTimeout(check, 50);
        };
        check();
      });

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

          const cells = doc().querySelectorAll<HTMLElement>(".lane-grid .cell");
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
              buttonLabel: playBtn().textContent ?? "",
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

      // R14 teardown: stop playback, remove the iframe (closing its open DB
      // connections), then wipe the shared-origin DB with retries so no
      // autosaved toggle state leaks into later same-origin boots.
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
    },
    90_000,
  );
});
