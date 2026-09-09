/**
 * VZ-HU-2 browser journey — THE M2-EXIT JOY LOOP on the real mounted app
 * (in-page JSX mount, the viz-mount precedent): play → watch → reroll →
 * watch, plus the Hulk spam set the task's lens demands. The transport is
 * the REAL session transport with the demo song looping; the canvas is
 * the real renderer's; reroll/cycle are driven through the controller's
 * module registry (`activeVizArrangementControllers` — the renderer's
 * module-probe precedent) so the ORCHESTRATOR stays the journey's subject
 * (the remote chrome VZ-DD-1 shipped binds the same methods; its own
 * keyboard/pointer paths are pinned in viz-remote.test.tsx).
 *
 * What the journey pins mechanically:
 * 1. JOY LOOP: while playing, canvas regions show activity (watching);
 *    a 15-request reroll burst coalesces to EXACTLY ONE committed deal
 *    (envelope listener received ONE emission), the seed changes, and
 *    the canvas keeps showing activity after the re-deal (still watching
 *    — no dead frames, no ghost state).
 * 2. CYCLE: next/prev switch presets IMMEDIATELY (presetId tracks the
 *    library order, wrapping), each commit a full teardown + mount with
 *    BOUNDED engine ledgers (peakLive under the provisional cap, sprites
 *    rebuilt > 0).
 * 3. SWITCH MID-BURST: a cycle during a pending reroll burst lands as
 *    the one and only deal (the pending window dies uncommitted).
 * 4. STOP-WHILE-REROLLING: the transport stops mid-window; the deal
 *    still commits (the rig re-dresses silently — reroll is transport-
 *    independent), playback stays stopped, and playing again still works
 *    (the audio graph was never touched).
 * 5. EXIT-WHILE-ARRANGING: closing the page with a window pending leaves
 *    ZERO live controllers/renderers and NO late commit fires afterward
 *    (dispose canceled the timer); the transport keeps playing across
 *    the exit (isolation, plan Preamble 8).
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { setVizMode } from "../../src/state/vizMode";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { liveVizRendererCount } from "../../src/viz/renderer";
import {
  activeVizArrangementControllers,
  VIZ_REROLL_COALESCE_MS,
  type VizArrangementController,
  type VizArrangementEnvelope,
} from "../../src/viz/arrangement";
import {
  VIZ_DEFAULT_PRESET_ID,
  VIZ_PRESETS,
} from "../../src/viz/presets";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
import {
  VIZ_DEFAULT_SEED,
  VIZ_PROVISIONAL_MAX_LIVE_OBJECTS,
} from "../../src/viz/nodes";
// Token base exactly as deployed (the viz-mount precedent): without it
// every var(--color-*) invalidates and the engine's token reads come back
// empty — hues would skip and the stage would never light.
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VZ-IM-3 memory hygiene: this journey asserts the DEFAULT boot deal
  // (VIZ_DEFAULT_SEED below) and its commits PERSIST — so clear the viz
  // memory key before mount (deterministic boot regardless of file order
  // on this shared origin) and again after cleanup (its reroll/cycle
  // commits wrote it; later files mount VizPage too).
  localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      setVizMode(false);
      dispose();
      host.remove();
      localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  ms = 4000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

function keyAtActive(k: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    }),
  );
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Sample fixed small canvas regions at rAF cadence (the harness's
 * byte-diff idiom, in-page) → the number of sampled frames on which ANY
 * region changed. > 0 while the stage is live (playing hits or a fresh
 * deal settling); the still-diagram rest state reads 0.
 */
async function countActiveFrames(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<number> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("viz canvas has no 2d context");
  const size = 16;
  const fractions: readonly (readonly [number, number])[] = [
    [0.5, 0.5],
    [0.37, 0.36],
    [0.63, 0.33],
    [0.39, 0.65],
    [0.62, 0.67],
    [0.25, 0.75],
    [0.75, 0.25],
  ];
  const read = (): (number[] | null)[] =>
    fractions.map(([fx, fy]) => {
      const x = Math.round(fx * canvas.width) - (size >> 1);
      const y = Math.round(fy * canvas.height) - (size >> 1);
      if (x < 0 || y < 0 || x + size > canvas.width || y + size > canvas.height)
        return null;
      return Array.from(ctx.getImageData(x, y, size, size).data);
    });
  let previous: (number[] | null)[] | null = null;
  let activeFrames = 0;
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const frame = (): void => {
      const now = read();
      if (previous) {
        const changed = now.some((sig, i) => {
          const prev = previous![i]!;
          return (
            sig !== null &&
            prev !== null &&
            (sig.length !== prev.length ||
              sig.some((v, j) => v !== prev[j]))
          );
        });
        if (changed) activeFrames++;
      }
      previous = now;
      if (performance.now() - t0 < durationMs) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  return activeFrames;
}

describe("VZ-HU-2 joy loop — reroll coalescing + preset cycling (M2 exit)", () => {
  it(
    "play → watch → reroll(spam, coalesced) → watch · cycle wraps · switch mid-burst · stop-while-rerolling · exit-while-arranging · transport isolated throughout",
    { timeout: 180_000 },
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

        // --- PLAY (the real transport, demo song looping) ----------------
        loadDocument(createDemoProject());
        session.setLoop(true);
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );

        // --- OPEN VIZ (the real booth toggle) ----------------------------
        expect(activeVizArrangementControllers().length).toBe(0);
        vizBtn().click();
        await waitFor(() => host.querySelector(".viz-page") !== null);
        const canvas = $<HTMLCanvasElement>(".viz-canvas");
        await waitFor(
          () => canvas.width > 1 && canvas.height > 1,
          4000,
          "viz canvas backing store to size",
        );
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });

        // VZ-DD-1 shipped the chrome: the page mounts the canvas + the
        // remote toolbar + the VZ-DD-2 announcement region + the VZ-HU-1
        // error line (empty :until-fault, always mounted) — four children
        // (this journey still drives the controller directly — the
        // remote's own keyboard/pointer paths are pinned in
        // viz-remote.test.tsx; the announcement texts in
        // viz-announcements.test.tsx).
        expect($(".viz-page").childElementCount).toBe(4);

        const controllers = activeVizArrangementControllers();
        expect(controllers.length).toBe(1);
        const controller: VizArrangementController = controllers[0]!;
        expect(controller.probe()).toMatchObject({
          presetId: VIZ_DEFAULT_PRESET_ID,
          seed: VIZ_DEFAULT_SEED,
          commits: 0,
          pendingReroll: false,
        });

        // --- WATCH 1 (playing: the stage is live) ------------------------
        const watching1 = await countActiveFrames(canvas, 700);
        expect(watching1, "canvas reacts while playing").toBeGreaterThan(0);

        const envelopes: VizArrangementEnvelope[] = [];
        controller.subscribe((e) => envelopes.push({ ...e }));

        // --- REROLL SPAM → ONE coalesced commit --------------------------
        for (let i = 0; i < 15; i++) controller.reroll();
        expect(controller.probe()).toMatchObject({
          pendingReroll: true,
          commits: 0,
          rerollRequests: 15,
        });
        await sleep(VIZ_REROLL_COALESCE_MS + 300);
        const afterSpam = controller.probe();
        expect(afterSpam.commits).toBe(1);
        expect(afterSpam.rerollCommits).toBe(1);
        expect(afterSpam.pendingReroll).toBe(false);
        expect(afterSpam.rerollRequests).toBe(15);
        expect(afterSpam.seed).not.toBe(VIZ_DEFAULT_SEED);
        expect(afterSpam.presetId).toBe(VIZ_DEFAULT_PRESET_ID); // same rig re-dealt
        expect(envelopes.length).toBe(1); // ONE emission for the whole burst
        // Engine ledgers bounded, rig re-baked: full teardown, no buildup.
        expect(afterSpam.engine).not.toBeNull();
        expect(afterSpam.engine!.peakLive).toBeLessThanOrEqual(
          VIZ_PROVISIONAL_MAX_LIVE_OBJECTS,
        );
        expect(afterSpam.engine!.sprites).toBeGreaterThan(0);

        // --- WATCH 2 (the re-dealt stage keeps playing — joy loop holds) -
        const watching2 = await countActiveFrames(canvas, 700);
        expect(
          watching2,
          "canvas still reacts after the re-deal",
        ).toBeGreaterThan(0);
        expect(session.transport.snapshot.playing).toBe(true);

        // --- CYCLE: immediate, wrapping ----------------------------------
        controller.cycle(1);
        expect(controller.probe()).toMatchObject({
          commits: 2,
          cycleCommits: 1,
          presetId: VIZ_PRESETS[1]!.id,
          pendingReroll: false,
        });
        expect(envelopes.length).toBe(2);
        controller.cycle(-1);
        expect(controller.probe().presetId).toBe(VIZ_PRESETS[0]!.id);
        expect(controller.probe().commits).toBe(3);

        // --- SWITCH MID-BURST: the cycle supersedes the pending reroll ---
        for (let i = 0; i < 6; i++) controller.reroll();
        expect(controller.probe().pendingReroll).toBe(true);
        controller.cycle(1);
        await sleep(VIZ_REROLL_COALESCE_MS + 300);
        const afterMidBurst = controller.probe();
        expect(afterMidBurst.commits).toBe(4); // the cycle ONLY
        expect(afterMidBurst.cycleCommits).toBe(3);
        expect(afterMidBurst.rerollCommits).toBe(1); // still just the first burst
        expect(afterMidBurst.presetId).toBe(VIZ_PRESETS[1]!.id);

        // --- STOP-WHILE-REROLLING: deal lands silently, audio untouched --
        for (let i = 0; i < 3; i++) controller.reroll();
        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "transport stopped",
        );
        await sleep(VIZ_REROLL_COALESCE_MS + 300);
        const afterStop = controller.probe();
        expect(afterStop.commits).toBe(5); // the window was transport-independent
        expect(session.transport.snapshot.playing).toBe(false);
        // Playback still works after every re-deal (the graph was untouched).
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing again",
        );

        // --- EXIT-WHILE-ARRANGING: no late commit, nothing leaks ---------
        controller.reroll();
        expect(controller.probe().pendingReroll).toBe(true);
        const commitsAtExit = controller.probe().commits;
        keyAtActive("Escape");
        await waitFor(
          () => host.querySelector(".viz-page") === null,
          4000,
          "viz page unmounted (Escape)",
        );
        expect(activeVizArrangementControllers().length).toBe(0);
        expect(liveVizRendererCount()).toBe(0);
        await sleep(VIZ_REROLL_COALESCE_MS + 350);
        // The held controller's frozen probe: the pending window DIED with
        // the page — no setArrangement ever fired after teardown.
        expect(controller.probe()).toMatchObject({
          commits: commitsAtExit,
          pendingReroll: false,
          armedTimers: 0,
          engine: null,
        });
        expect(session.transport.snapshot.playing).toBe(true); // isolation
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        // Restore the shared-origin project rows (loadDocument autosaves;
        // the viz-mount teardown precedent).
        try {
          await getAutosaveController()?.stop();
          if (bootDb) {
            const ids = new Set(snapshotRows.map((r) => r.id));
            const current = await bootDb.allRecords();
            for (const row of snapshotRows) await bootDb.putRecord(row);
            for (const row of current) {
              if (!ids.has(row.id)) await bootDb.deleteRecord(row.id);
            }
          }
        } catch {
          /* best-effort restore */
        }
      }
    },
  );
});
