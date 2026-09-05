/**
 * LP-1 (iteration 3) — long-loop perf spike, BROWSER half (Thor).
 *
 * Measures the DOM half of the 128-bar spike against the REAL app + session
 * (source-mount — the pattern-rail/pointer-edge-states precedent; frame
 * deltas are measured in-page exactly like the committed frame-budget
 * gates):
 *
 * (a) EAGER BASELINE — the real app at 1440×900 in the target state "a
 *     128-bar pattern visible on one lane while all four lanes play dense
 *     long chains" (drums 64B + bass 4B + chords 8B + the dense 128-bar
 *     lead, LCM = one 128-bar cycle): DOM cell count, 4 s of frame
 *     intervals while playing, per-quadrant playhead liveness, and the
 *     per-TOGGLE block (the store → validate → engineBridge recompile →
 *     renderer sync chain — where the O(steps) stepOfTime scan lands on
 *     every pitched edit today).
 * (a′) PHONE WINDOW — the same dense state at 390×844 (the single-lane
 *     stage shows the 30,720-cell lead grid). Honest caveat: CI Chromium is
 *     desktop-class hardware emulating the viewport (the MB-5 stance) — a
 *     regression catch, not a device-class verdict.
 * (a″) WINDOWED PROTOTYPE — the committed column-window approach
 *     (WindowedGridRenderer, tests/lp1-spike-harness.ts): the four eager
 *     grid DOM trees are detached (their renderer rAF loops keep running
 *     against detached nodes at compat-bars cost ≈ 0) and four windowed
 *     prototypes mount in a 2×2 stage fed by the same real session, playing
 *     the same dense chains. The HARD frame-budget law asserts HERE (the
 *     approach's proof — the number LL-1 builds against), plus the
 *     virtualization law (DOM cells ≪ 100k) and rewindowing during the
 *     scroll sweep.
 * (b) HORIZONTAL SCROLL — a full programmatic sweep of the 2048-column
 *     grid's scrollport during playback, eager vs windowed.
 * (d) EXPORT — the REAL offline render pipeline (renderProjectToBuffer):
 *     wall-time + memory for the user's 64-bar LCM cycle (drums 64B +
 *     bass 4B + chords 8B) AND the worst-case 128-bar cycle (every lane
 *     one 128-bar pattern, musical density), at 120 BPM.
 *
 * What is ASSERTED vs RECORDED: the windowed frame law, cell counts
 * (deterministic), sweep completion, rewindowing, and the export sanity are
 * HARD asserts (CI-stable — the TH-4 tolerance approach); the EAGER
 * baseline's frame ratio + toggle blocks are RECORDED `[LP-1 …]` lines
 * (the budget miss is the FINDING that motivates the approach, not a gate
 * to keep green) — numbers journaled into docs/dev/perf-budget.md §10.
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { loadDocument } from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { getSession } from "../../src/engine/session";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { renderProjectToBuffer } from "../../src/audio/render";
import {
  WindowedGridRenderer,
  denseLead128Doc,
  drumRowsFor,
  longLoopDoc,
  spansForPattern,
} from "../lp1-spike-harness";
// The committed stylesheet so the measured DOM paints under production CSS.
import "../../src/styles/base.css";

const FRAME_BUDGET_MS = 33.4; // ~30 fps floor — HARD bound (TH-1 law)
const FRAME_PASS_RATIO = 0.95;
const MEASURE_MS = 4000;
const MIN_PLAYHEAD_MOVES_PER_SEC = 2; // load-robust liveness (HW-4)

const session = getSession();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function mountApp(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      dispose();
      host.remove();
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  ms = 8000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

function playBtn(): HTMLButtonElement {
  const btn = document.querySelector<HTMLButtonElement>(".booth-btn-play");
  if (!btn) throw new Error("missing booth play button");
  return btn;
}

/**
 * Deterministic play: togglePlay is ASYNC (engine.unlock → ctx.resume
 * before the transport flips), so a previous test's stop may still be in
 * flight — a click on a stale-playing transport would STOP it. Ensure the
 * stopped state first, then start and wait for the snapshot.
 */
async function clickPlay(): Promise<void> {
  if (session.transport.snapshot.playing) {
    playBtn().click();
    await waitFor(
      () => !session.transport.snapshot.playing,
      15000,
      "previous transport stop",
    );
  }
  playBtn().click();
  await waitFor(
    () => session.transport.snapshot.playing,
    15000,
    "transport start",
  );
}

async function stopPlay(): Promise<void> {
  try {
    if (session.transport.snapshot.playing) {
      playBtn().click();
      await waitFor(
        () => !session.transport.snapshot.playing,
        15000,
        "transport stop",
      );
    }
  } catch {
    /* app may be gone on failure paths */
  }
}

interface FrameMeasurement {
  readonly intervals: number[];
  /** Distinct playhead style strings per second, per observed playhead. */
  readonly playheadMovesPerSec: number[];
}

function measureFrames(
  ms: number,
  playheads: readonly Element[],
): Promise<FrameMeasurement> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const moves = playheads.map(() => new Set<string>());
    let last = performance.now();
    const start = last;
    const tick = () => {
      const now = performance.now();
      intervals.push(now - last);
      last = now;
      playheads.forEach((el, i) =>
        moves[i]!.add(el.getAttribute("style") ?? ""),
      );
      if (now - start < ms) requestAnimationFrame(tick);
      else
        resolve({
          intervals,
          playheadMovesPerSec: moves.map((set) => set.size / (ms / 1000)),
        });
    };
    requestAnimationFrame(tick);
  });
}

function frameStats(intervals: number[]) {
  const sorted = [...intervals].sort((a, b) => a - b);
  const over = sorted.filter((d) => d >= FRAME_BUDGET_MS).length;
  return {
    n: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    max: sorted[sorted.length - 1]!,
    ratio: (sorted.length - over) / sorted.length,
  };
}

/** One full programmatic horizontal sweep of `el` over `ms` (rAF-driven). */
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

/** DB hygiene (pointer-edge-states precedent): snapshot → restore. */
async function snapshotDb(): Promise<{
  db: ProjectDb;
  rows: Awaited<ReturnType<ProjectDb["allRecords"]>>;
} | null> {
  try {
    const db = await openRawProjectDb("bitbounce");
    return { db, rows: await db.allRecords() };
  } catch {
    return null;
  }
}

async function restoreDb(
  snap: Awaited<ReturnType<typeof snapshotDb>>,
): Promise<void> {
  if (!snap) return;
  try {
    const ids = new Set(snap.rows.map((r) => r.id));
    const current = await snap.db.allRecords();
    for (const row of snap.rows) await snap.db.putRecord(row);
    for (const row of current)
      if (!ids.has(row.id)) await snap.db.deleteRecord(row.id);
  } catch {
    /* best-effort restore; the wiping suites clean the origin anyway */
  }
}

function quadrantScroll(lane: string, host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>(
    `.lane-floor[data-lane="${lane}"] .lane-grid-scroll`,
  );
  if (!el) throw new Error(`missing ${lane} scroll container`);
  return el;
}

const EAGER_CELLS = 6 * 1024 + 7 * 64 + 7 * 128 + 15 * 2048; // 38,208

// ---------------------------------------------------------------------------
// (a) EAGER BASELINE (RECORDED)
// ---------------------------------------------------------------------------

describe("LP-1 (a)(b): eager baseline at 128 bars (RECORDED)", () => {
  it("dense 128-bar lead + dense long chains: DOM census, frame deltas, playhead liveness, scroll sweep, per-toggle block",
    { timeout: 120_000 },
    async () => {
      await page.viewport(1440, 900);
      const { host, cleanup } = mountApp();
      const snap = await snapshotDb();
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        loadDocument(denseLead128Doc());
        selectLane("lead");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
              ?.getAttribute("aria-label")
              ?.startsWith("LEAD grid · EDITING") === true,
          8000,
          "lead quadrant editable",
        );

        // -- DOM census --------------------------------------------------
        const cells = host.querySelectorAll(".cell").length;
        const runs = host.querySelectorAll(".note-run").length;
        const allEls = host.querySelectorAll("*").length;
        // drums 6×1024 + bass 7×64 + chords 7×128 + lead 15×2048 (the
        // register window bounds VISIBLE rows only — the full manifest
        // stays in the DOM, RC-1's construction law).
        expect(cells).toBe(EAGER_CELLS);
        console.log(
          `[LP-1 (a) eager census @dense-128] ${cells.toLocaleString()} cells (${runs.toLocaleString()} note-runs, ${allEls.toLocaleString()} elements total) across the four quadrants`,
        );

        // -- 4 s pure-rendering frame window ------------------------------
        await clickPlay();
        const playheads = ["drums", "bass", "chords", "lead"].map((lane) =>
          host.querySelector(
            `.lane-floor[data-lane="${lane}"] .grid-playhead`,
          ),
        );
        expect(playheads.every(Boolean)).toBe(true);
        const idle = await measureFrames(MEASURE_MS, playheads as Element[]);
        const idleStats = frameStats(idle.intervals);
        console.log(
          `[LP-1 (a) eager frames @dense-128, 4 s pure rendering] ${idleStats.n} frames, median ${idleStats.median.toFixed(1)} ms, p95 ${idleStats.p95.toFixed(1)} ms, max ${idleStats.max.toFixed(1)} ms, ${(idleStats.ratio * 100).toFixed(1)}% < ${FRAME_BUDGET_MS} ms | playhead moves/s: ${idle.playheadMovesPerSec.map((m) => m.toFixed(0)).join("/")}`,
        );
        idle.playheadMovesPerSec.forEach((m) =>
          expect(m).toBeGreaterThanOrEqual(MIN_PLAYHEAD_MOVES_PER_SEC),
        );

        // -- (b) horizontal scroll sweep on the 2048-column lead grid -----
        const leadScroll = quadrantScroll("lead", host);
        const sweepPromise = sweepScroll(leadScroll, 2000);
        const scrollStats = frameStats(
          (await measureFrames(2000, [playheads[3]!])).intervals,
        );
        await sweepPromise;
        console.log(
          `[LP-1 (b) eager scroll sweep @2048 cols] ${scrollStats.n} frames, median ${scrollStats.median.toFixed(1)} ms, p95 ${scrollStats.p95.toFixed(1)} ms, max ${scrollStats.max.toFixed(1)} ms, ${(scrollStats.ratio * 100).toFixed(1)}% < ${FRAME_BUDGET_MS} ms`,
        );
        leadScroll.scrollLeft = 0;

        // -- per-TOGGLE block (the edit-recompile chain, today's scan) ----
        const blocks: number[] = [];
        for (let k = 0; k < 5; k++) {
          const cell = host.querySelector<HTMLElement>(
            `.lane-floor[data-lane="lead"] .cell[data-row="1"][data-step="${16 + k * 4}"]`,
          );
          if (!cell) throw new Error("missing lead toggle cell");
          const t0 = performance.now();
          cell.click();
          blocks.push(performance.now() - t0);
          await new Promise((r) => setTimeout(r, 120));
        }
        console.log(
          `[LP-1 (a) eager toggle blocks @128-bar lead] ${blocks.map((b) => b.toFixed(0)).join("/")} ms per toggle (store → validate → engineBridge recompile → renderer sync; the O(steps) stepOfTime scan path — TH-4's <50 ms long-task guard for scale)`,
        );
        await stopPlay();
      } finally {
        await stopPlay();
        cleanup();
        await restoreDb(snap);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// (a″) WINDOWED PROTOTYPE — the committed approach, HARD laws.
// ---------------------------------------------------------------------------

describe("LP-1 (a″)(b): column-windowed prototype at 128 bars (HARD frame law)", () => {
  it("four windowed grids on the real session keep ≥95% frames < 33.4 ms; DOM cells ≪ 100k; rewindowing during the sweep",
    { timeout: 120_000 },
    async () => {
      await page.viewport(1440, 900);
      const { host, cleanup } = mountApp();
      const snap = await snapshotDb();
      const prototypes: WindowedGridRenderer[] = [];
      const scrollers: HTMLElement[] = [];
      let stage: HTMLElement | null = null;
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        const doc = denseLead128Doc();
        loadDocument(doc);
        selectLane("lead");
        await waitFor(
          () => host.querySelectorAll(".lane-grid-scroll").length === 4,
          8000,
          "four quadrant scrollers",
        );

        // Detach the four eager grid DOM trees (their renderer rAF loops
        // keep running against detached nodes at compat-bars cost ≈ 0 — the
        // session, booth, rail, and audio stay fully real).
        for (const lane of ["drums", "bass", "chords", "lead"])
          quadrantScroll(lane, host).replaceChildren();

        // The prototype stage: 2×2, sized like the quadrant stage.
        stage = document.createElement("div");
        stage.style.cssText =
          "display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;height:720px;padding:8px;box-sizing:border-box;";
        host.append(stage);

        const geometry = {
          drums: { cellPx: 20, gapPx: 2, labelPx: 72, rowHeightPx: 20 },
          bass: { cellPx: 16, gapPx: 1, labelPx: 64, rowHeightPx: 16 },
          chords: { cellPx: 16, gapPx: 1, labelPx: 64, rowHeightPx: 16 },
          lead: { cellPx: 16, gapPx: 1, labelPx: 64, rowHeightPx: 16 },
        } as const;
        const labels = {
          drums: ["KICK", "SNARE", "HAT", "OPENHAT", "CLAP", "TOM"],
          bass: ["a", "b", "c", "d", "e", "f", "g"],
          chords: ["a", "b", "c", "d", "e", "f", "g"],
          lead: Array.from({ length: 15 }, (_, i) => `r${i}`),
        } as const;

        // The prototype's time basis: a wall-clock loop-time at the LANE's
        // own cycle length (the transport's compat basis wraps at ≤4 bars
        // until LL-2 lands; the render COST is basis-independent — the same
        // bounded math runs either way, journaled). Self-arming on the
        // first playing frame — no transport subscription to leak.
        let playWallStart = 0;

        for (const lane of ["drums", "bass", "chords", "lead"] as const) {
          const scroller = document.createElement("div");
          scroller.className = "lane-grid-scroll";
          scroller.style.height = "100%";
          scroller.style.overflowY = "hidden";
          stage.append(scroller);
          scrollers.push(scroller);
          const pattern = doc.patterns[lane][0]!;
          const steps = pattern.bars * 16;
          const renderer = new WindowedGridRenderer({
            container: scroller,
            laneLabel: lane.toUpperCase(),
            rowLabels: [...labels[lane]],
            steps,
            pitched: lane !== "drums",
            geometry: geometry[lane],
            readFrame: () => {
              const snapT = session.transport.snapshot;
              if (!snapT.playing) {
                playWallStart = 0;
                return null;
              }
              if (!playWallStart) playWallStart = performance.now() - 16;
              const loopSecs = steps * (60 / snapT.bpm / 4);
              const local =
                ((performance.now() - playWallStart) / 1000) % loopSecs;
              return {
                playing: true,
                loopTime: local,
                groove: { bpm: snapT.bpm, swing: snapT.swing },
                steps,
              };
            },
          });
          if (lane === "drums")
            renderer.sync({ drumRows: drumRowsFor(pattern) });
          else renderer.sync({ pitchedSpans: spansForPattern(pattern) });
          prototypes.push(renderer);
        }

        const totalCells = prototypes.reduce((n, r) => n + r.cellCount(), 0);
        console.log(
          `[LP-1 (a″) windowed census @dense-128] ${totalCells.toLocaleString()} cells in DOM (vs ${EAGER_CELLS.toLocaleString()} eager) | per-grid windows: ${prototypes.map((r) => r.cellCount()).join("/")}`,
        );
        // The virtualization law: bounded by the window, not the pattern.
        expect(totalCells).toBeLessThan(10_000);

        await clickPlay();
        const playheads = scrollers.map(
          (s) => s.querySelector(".grid-playhead")!,
        );
        expect(playheads.every(Boolean)).toBe(true);
        const win = await measureFrames(MEASURE_MS, playheads);
        const winStats = frameStats(win.intervals);
        console.log(
          `[LP-1 (a″) windowed frames @dense-128, 4 s pure rendering] ${winStats.n} frames, median ${winStats.median.toFixed(1)} ms, p95 ${winStats.p95.toFixed(1)} ms, max ${winStats.max.toFixed(1)} ms, ${(winStats.ratio * 100).toFixed(1)}% < ${FRAME_BUDGET_MS} ms | playhead moves/s: ${win.playheadMovesPerSec.map((m) => m.toFixed(0)).join("/")}`,
        );
        // THE LAW (the LL-1 build gate).
        expect(winStats.ratio).toBeGreaterThanOrEqual(FRAME_PASS_RATIO);
        win.playheadMovesPerSec.forEach((m) =>
          expect(m).toBeGreaterThanOrEqual(MIN_PLAYHEAD_MOVES_PER_SEC),
        );

        // (b) windowed: full 2048-column sweep with rewindowing.
        const leadScroller = scrollers[3]!;
        const sweepPromise = sweepScroll(leadScroller, 2500);
        const scrollStats = frameStats(
          (await measureFrames(2500, [playheads[3]!])).intervals,
        );
        await sweepPromise;
        const leadProto = prototypes[3]!;
        console.log(
          `[LP-1 (b) windowed scroll sweep @2048 cols] ${scrollStats.n} frames, median ${scrollStats.median.toFixed(1)} ms, p95 ${scrollStats.p95.toFixed(1)} ms, max ${scrollStats.max.toFixed(1)} ms, ${(scrollStats.ratio * 100).toFixed(1)}% < ${FRAME_BUDGET_MS} ms | rewindows ${leadProto.rewindows}, last rebuild ${leadProto.lastRewindowMs.toFixed(1)} ms`,
        );
        expect(scrollStats.ratio).toBeGreaterThanOrEqual(FRAME_PASS_RATIO);
        expect(leadProto.rewindows).toBeGreaterThan(0);
        await stopPlay();
      } finally {
        await stopPlay();
        for (const r of prototypes) r.dispose();
        stage?.remove();
        cleanup();
        await restoreDb(snap);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// (a′) PHONE WINDOW (RECORDED, emulation caveat)
// ---------------------------------------------------------------------------

describe("LP-1 (a′): phone window at 390×844 (RECORDED, emulation caveat)", () => {
  it("dense 128-bar lead on the phone stage: frame deltas while all four lanes play",
    { timeout: 90_000 },
    async () => {
      await page.viewport(390, 844);
      const { host, cleanup } = mountApp();
      const snap = await snapshotDb();
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        loadDocument(denseLead128Doc());
        selectLane("lead");
        await waitFor(
          () =>
            host.querySelector(
              '.app[data-stage="phone"] .lane-floor[data-lane="lead"] .cell',
            ) !== null,
          8000,
          "phone lead grid mounted",
        );
        const cells = host.querySelectorAll(".cell").length;
        // Phone stage renders ONE lane floor (lead, the selection) — its
        // full manifest (15 rows × 2048).
        expect(cells).toBe(15 * 2048);
        await clickPlay();
        const playheads = [
          host.querySelector('.app[data-stage="phone"] .grid-playhead'),
        ];
        expect(playheads[0]).toBeTruthy();
        const m = await measureFrames(2000, playheads as Element[]);
        const stats = frameStats(m.intervals);
        console.log(
          `[LP-1 (a′) phone eager frames @dense-128 lead, 2 s] ${stats.n} frames, median ${stats.median.toFixed(1)} ms, p95 ${stats.p95.toFixed(1)} ms, max ${stats.max.toFixed(1)} ms, ${(stats.ratio * 100).toFixed(1)}% < ${FRAME_BUDGET_MS} ms (desktop-class CI hardware emulating 390×844 — the MB-5 caveat)`,
        );
        await stopPlay();
      } finally {
        await stopPlay();
        cleanup();
        await restoreDb(snap);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// (d) EXPORT — the real offline render pipeline at the LCM cycles.
// ---------------------------------------------------------------------------

function heapUsed(): number | undefined {
  return (performance as { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize;
}

/** Spot-check a rendered channel: finite + non-silent. */
function assertRenderedSane(channels: readonly Float32Array[]): void {
  const mono = channels[0]!;
  let peak = 0;
  for (let i = 0; i < mono.length; i += 997) {
    const v = Math.abs(mono[i]!);
    if (!Number.isFinite(v)) throw new Error("non-finite sample");
    if (v > peak) peak = v;
  }
  expect(peak).toBeGreaterThan(0.01);
}

describe("LP-1 (d): export wall-time + memory at the LCM cycles (REAL pipeline)", () => {
  it("user's 64-bar LCM (drums 64B + bass 4B + chords 8B) renders; wall + memory recorded",
    { timeout: 180_000 },
    async () => {
      const doc = longLoopDoc("user64");
      const heapBefore = heapUsed();
      const t0 = performance.now();
      const rendered = await renderProjectToBuffer(doc);
      const wallMs = performance.now() - t0;
      const heapAfter = heapUsed();
      // 64 bars @120 BPM = 1024 steps × 0.125 s = 128 s of audio.
      expect(rendered.loopSteps).toBe(64 * 16);
      expect(rendered.loopSamples).toBe(Math.round(1024 * 0.125 * 44100));
      const mb = (rendered.loopSamples * 4 * 2) / (1024 * 1024);
      const audioSec = rendered.loopSamples / 44100;
      console.log(
        `[LP-1 (d) export 64-bar LCM] ${(wallMs / 1000).toFixed(2)} s wall for ${audioSec.toFixed(0)} s audio (x${(audioSec / (wallMs / 1000)).toFixed(0)} real-time) | loop buffer ${mb.toFixed(0)} MB | heap delta ${heapBefore !== undefined && heapAfter !== undefined ? ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(0) : "n/a"} MB`,
      );
      assertRenderedSane(rendered.channels);
    },
  );

  it("worst-case 128-bar LCM (every lane 128B, musical density) renders; wall + memory recorded",
    { timeout: 300_000 },
    async () => {
      const doc = longLoopDoc("all128");
      const heapBefore = heapUsed();
      const t0 = performance.now();
      const rendered = await renderProjectToBuffer(doc);
      const wallMs = performance.now() - t0;
      const heapAfter = heapUsed();
      // 128 bars @120 BPM = 2048 steps × 0.125 s = 256 s ≈ 4.27 min.
      expect(rendered.loopSteps).toBe(2048);
      expect(rendered.loopSamples).toBe(Math.round(2048 * 0.125 * 44100));
      const mb = (rendered.loopSamples * 4 * 2) / (1024 * 1024);
      const audioSec = rendered.loopSamples / 44100;
      console.log(
        `[LP-1 (d) export 128-bar LCM worst case] ${(wallMs / 1000).toFixed(2)} s wall for ${audioSec.toFixed(0)} s audio (x${(audioSec / (wallMs / 1000)).toFixed(0)} real-time) | loop buffer ${mb.toFixed(0)} MB | heap delta ${heapBefore !== undefined && heapAfter !== undefined ? ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(0) : "n/a"} MB`,
      );
      assertRenderedSane(rendered.channels);
      // Generous regression ceiling (the recorded wall sits 1-2 orders
      // under; TH-5 pins the honest ceiling from XP-1's numbers).
      expect(wallMs).toBeLessThan(120_000);
    },
  );
});
