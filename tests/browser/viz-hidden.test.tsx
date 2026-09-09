/**
 * VZ-TH-3 browser gate — the HIDDEN-PAGE POLICY JOURNEY on the real
 * mounted app (in-page JSX mount, the viz-phases/viz-mount precedents;
 * synthetic visibilitychange per the standing TH-3 convention —
 * tests/browser/background-tab.test.ts and viz-mount §6).
 *
 * HONESTY CAVEAT (the standing one): a synthetic visibilitychange flips
 * document.hidden and fires the app's listeners, but headless Chromium
 * does NOT genuinely suspend rAF or throttle timers for it. That is
 * exactly the honest shape for THIS gate: the policy's mechanisms are the
 * app's own (the renderer cancels its rAF at hide — viz-mount proves the
 * park — and the pipeline clears + keeps ingesting), and the drain-side
 * stale rule is clock-math the unit suite pins at 30 s gaps. Real
 * browser-level rAF parking in a genuinely hidden tab stays on the
 * human-session protocol (recorded in docs/ultron/production-log.md).
 *
 * The journey (Thor lens — prove with evidence):
 * 1. STEADY STATE: viz open over the playing demo — hits draining through
 *    the real tap → queue → drain path (pipeline `drained` advancing).
 * 2. HIDE: the renderer parks (state "parked", frames FROZEN while
 *    hidden), the queue CLEARS synchronously with the event, inserts are
 *    NEVER gated — the tap keeps delivering while hidden so `queued`
 *    re-grows into a real backlog — and `drained` stays FROZEN (drains
 *    only ever happen inside onFrame; a parked loop drains nothing).
 * 3. SHOW (drop-and-resync): the loop resumes and the return frames fire
 *    ONLY the fresh trickle — the whole hidden-window backlog drops
 *    silently at the drain (max per-interval `drained` step and the
 *    window total are bounded far below the backlog; a replay burst would
 *    fire the entire backlog in one frame), the phase state is SANE
 *    (valid phase, finite clock-derived rate), and the show continues in
 *    sync with what is audible NOW.
 * 4. TEARDOWN: closing the page leaves ZERO live renderers/pipelines
 *    (no leaked listeners/loops) and the transport is STILL PLAYING
 *    (audio inviolate — the viz never touches it).
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { setVizMode } from "../../src/state/vizMode";
import { setHelpMode } from "../../src/state/helpMode";
import { closeHelp } from "../../src/state/helpOverlay";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { activeVizNodeEngines } from "../../src/viz/nodes";
import { activeVizPhaseControllers } from "../../src/viz/phases";
import {
  liveVizRendererCount,
  vizRendererProbes,
} from "../../src/viz/renderer";
import { activeVizPipelines } from "../../src/viz/pipeline";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
// DA-3 precedent: App imports component CSS but NOT the token sheet —
// main.tsx owns it in the real bundle; load the deployed base here.
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VIZ memory hygiene (the viz-phases precedent): deterministic default
  // deal per mount regardless of file order on this shared origin.
  localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      setVizMode(false);
      setHelpMode(false);
      closeHelp();
      dispose();
      host.remove();
      localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  ms = 6000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Synthetic visibility flip — the standing TH-3 convention (viz-mount §6). */
function setVisibility(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function restoreVisibility(): void {
  delete (document as unknown as { hidden?: boolean }).hidden;
}

describe("VZ-TH-3 hidden-page policy — drop-and-resync on the real mounted app", () => {
  it(
    "hide parks + clears + keeps ingesting (never gated) · return drops the backlog without a burst and resyncs from the audio clock · close leaks nothing · transport never stops",
    { timeout: 240_000 },
    async () => {
      const { host, cleanup } = mount();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const vizBtn = (): HTMLButtonElement =>
          $<HTMLButtonElement>(".booth-btn-viz");
        const pipeline = () => activeVizPipelines()[0]!;
        const rendererProbe = () => vizRendererProbes()[0]!;
        const engine = () => activeVizNodeEngines()[0]!;
        const phase = () => activeVizPhaseControllers()[0]!;

        // Deterministic content: the demo groove (≈11 drained hits/s).
        loadDocument(createDemoProject());
        session.setLoop(true);

        // --- 1. STEADY STATE: open VIZ over a PLAYING transport ----------
        vizBtn().click();
        await waitFor(
          () =>
            host.querySelector(".viz-page") !== null &&
            activeVizPipelines().length === 1 &&
            vizRendererProbes().length === 1,
          5000,
          "viz page + pipeline + renderer mounted",
        );
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing",
        );
        await waitFor(
          () => pipeline().probe().drained > 8,
          20_000,
          "hits draining through the real tap → queue → drain path",
        );

        // --- 2. HIDE: park + clear + never-gated inserts -----------------
        setVisibility(true);
        // The renderer parks itself (its own visibilitychange listener).
        expect(rendererProbe().state).toBe("parked");
        // The queue cleared SYNCHRONOUSLY with the event (the hide action).
        expect(pipeline().probe().queued).toBe(0);
        const drainedAtHide = pipeline().probe().drained;
        const framesAtHide = rendererProbe().frames;
        const ignitedAtHide = engine().probe().ignited;

        // Stay hidden ~2.6 s: the tap keeps delivering (synthetic hidden
        // does not throttle the scheduler — and per R3 the policy must not
        // depend on delivery anyway), so the queue re-grows a backlog.
        const hiddenSamples: number[] = [];
        const hiddenStart = Date.now();
        while (Date.now() - hiddenStart < 2600) {
          hiddenSamples.push(pipeline().probe().queued);
          await sleep(100);
        }
        const backlog = pipeline().probe().queued;
        const maxQueued = Math.max(...hiddenSamples);
        console.log(
          `[VZ-TH-3 hidden] ${JSON.stringify({
            backlog,
            maxQueued,
            drainedFrozen: pipeline().probe().drained,
            framesFrozen: rendererProbe().frames,
          })}`,
        );
        // Inserts were NEVER gated: a real backlog accrued while hidden.
        expect(backlog).toBeGreaterThanOrEqual(10);
        // The parked loop drew ZERO frames and drained NOTHING.
        expect(rendererProbe().frames).toBe(framesAtHide);
        expect(pipeline().probe().drained).toBe(drainedAtHide);
        expect(engine().probe().ignited).toBe(ignitedAtHide);

        // --- 3. SHOW: drop-and-resync, never a burst ----------------------
        setVisibility(false);
        expect(rendererProbe().state).toBe("running");
        await waitFor(
          () => rendererProbe().frames > framesAtHide,
          4000,
          "loop resumed and drew the first visible frame",
        );
        // Densely sample the return window: per-interval `drained` steps
        // and the total must be the FRESH TRICKLE (grace + the demo's
        // ~11/s due hits) — a replay burst would fire the whole backlog
        // (≥ 6) in ONE interval.
        const steps: number[] = [];
        let prev = pipeline().probe().drained;
        const returnStart = Date.now();
        while (Date.now() - returnStart < 800) {
          await sleep(40);
          const d = pipeline().probe().drained;
          steps.push(d - prev);
          prev = d;
        }
        const total = steps.reduce((a, b) => a + b, 0);
        const maxStep = Math.max(...steps);
        const ignitedDelta = engine().probe().ignited - ignitedAtHide;
        const phaseProbe = phase().probe();
        console.log(
          `[VZ-TH-3 return] ${JSON.stringify({
            backlog,
            steps,
            total,
            maxStep,
            ignitedDelta,
            phase: phaseProbe.phase,
            rate: Number(phaseProbe.rate.toFixed(2)),
            live: engine().probe().live,
          })}`,
        );
        // NO BURST: every interval trickle-sized (a stacked chord + the
        // grace edge is the honest ceiling), the window total far below
        // the backlog, and the backlog itself never fired.
        expect(maxStep).toBeLessThanOrEqual(5);
        expect(total).toBeLessThan(backlog);
        expect(total).toBeLessThanOrEqual(14);
        // The show RESUMED IN SYNC: fresh hits keep firing after return.
        expect(total).toBeGreaterThanOrEqual(2);
        // Phase state SANE after the gap: a valid phase, finite rate
        // re-derived from the audio clock, levels inside [0, 1].
        expect(["idle", "rest", "sparse", "working", "full"]).toContain(
          phaseProbe.phase,
        );
        expect(Number.isFinite(phaseProbe.rate)).toBe(true);
        expect(phaseProbe.rate).toBeGreaterThanOrEqual(0);
        expect(phaseProbe.restLevel).toBeGreaterThanOrEqual(0);
        expect(phaseProbe.restLevel).toBeLessThanOrEqual(1);
        expect(phaseProbe.liveGain).toBeGreaterThanOrEqual(0);
        expect(phaseProbe.liveGain).toBeLessThanOrEqual(1);
        // Engine ledgers stayed lawful (clamp ceiling + registry cap).
        expect(engine().probe().live).toBeLessThanOrEqual(192);
        expect(ignitedDelta).toBeGreaterThanOrEqual(total); // nothing extra
        expect(ignitedDelta).toBeLessThanOrEqual(total + 4); // nothing replayed

        // The loop keeps drawing and the transport NEVER stopped.
        await waitFor(
          () => rendererProbe().frames > framesAtHide + 30,
          6000,
          "the show keeps drawing after the return",
        );
        expect(session.transport.snapshot.playing).toBe(true);

        // --- 4. TEARDOWN: close leaks nothing, audio untouched ------------
        setVizMode(false);
        await waitFor(
          () => host.querySelector(".viz-page") === null,
          5000,
          "viz page unmounted",
        );
        expect(liveVizRendererCount()).toBe(0);
        expect(vizRendererProbes()).toEqual([]);
        expect(activeVizPipelines()).toHaveLength(0);
        await sleep(200);
        expect(liveVizRendererCount()).toBe(0); // no zombie re-arm
        expect(session.transport.snapshot.playing).toBe(true); // inviolate
      } finally {
        restoreVisibility();
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        setVizMode(false);
        cleanup();
        try {
          await getAutosaveController()?.stop();
          if (bootDb) {
            const ids = new Set(snapshotRows.map((r) => r.id));
            const current = await bootDb.allRecords();
            for (const row of snapshotRows) await bootDb.putRecord(row);
            for (const row of current) {
              if (!ids.has(row.id)) await bootDb.deleteRecord(row);
            }
          }
        } catch {
          /* best-effort restore */
        }
      }
    },
  );
});
