/**
 * VZ-IM-6 browser journey — DENSITY PHASES + THE IDLE CALM STATE on the
 * real mounted app (in-page JSX mount, the viz-reduced-motion /
 * viz-announcements precedents; the plan's likely-file note names the
 * renderer, but the renderer's frame loop is untouched — the phase step
 * rides VizPage's existing onFrame composition, and this gate walks the
 * BEHAVIOR end to end).
 *
 * The task's AC, walked on the real product path:
 * 1. THE PLAY ARC (J1 sustained): playing the demo raises the stage
 *    rest → sparse → working → full IN ORDER, derived from REAL drained
 *    hit rates (the probe's rate ledger is the evidence) — observed as a
 *    consecutive-deduped subsequence of the arc, never a flicker.
 * 2. THE LEVEL MAPPING lands in the REAL engine (IM-5's seams): at full,
 *    controller and engine probes both read the exact settled (1, 1).
 * 3. FULL MOTION STAYS SILENT through the whole climb (DD-2's verified
 *    law — zero label announcements while the phase walks the arc).
 * 4. REDUCED MOTION: the labels speak through the page's REAL live
 *    region ("VIZ LIGHTS — …" — never color alone), and the levels STEP
 *    to their targets exactly (DD-3: state changes, never animation).
 * 5. THE IDLE STATE (J2 — never a dead screen): a stopped transport is
 *    `idle` IMMEDIATELY, the remote's idle line is visible, the loop
 *    keeps drawing (frames advance), and — after the settle allowance
 *    (one-shot tail ≤ 1.4 s worst, level ease snap ≤ 0.7 s) — the canvas
 *    is PIXEL-STATIC over a probe window (zero changed samples).
 * 6. THE ARC RE-ARMS: playing again after idle re-climbs to full.
 */

import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
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
import {
  activeVizPhaseControllers,
  VIZ_PHASE_FULL_ENTER_HPS,
  VIZ_PHASE_LABEL_PREFIX,
  vizPhaseLevels,
} from "../../src/viz/phases";
import { vizRendererProbes } from "../../src/viz/renderer";
import { activeVizAnnouncers } from "../../src/viz/announcements";
import { VIZ_IDLE_LINE } from "../../src/components/VizRemote";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VIZ memory hygiene (the joy-loop precedent): deterministic default
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

/** Browser-level preference emulation (CDP; restored in finally). */
async function emulateReducedMotion(
  value: "reduce" | "no-preference",
): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
}

/**
 * Collect the mounted page's phase probe every ~15 ms for `ms`
 * milliseconds; returns the consecutive-deduped phase sequence + the max
 * observed rate (the REAL hit-rate ledger).
 */
async function collectArc(
  ms: number,
): Promise<{ sequence: string[]; maxRate: number }> {
  const controller = () => activeVizPhaseControllers()[0];
  const sequence: string[] = [];
  let maxRate = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const probe = controller()?.probe();
    if (probe) {
      maxRate = Math.max(maxRate, probe.rate);
      if (sequence.at(-1) !== probe.phase) sequence.push(probe.phase);
    }
    await sleep(15);
  }
  return { sequence, maxRate };
}

/** rAF-cadence pixel stability probe: samples fixed regions, counts changed samples. */
const REGIONS: ReadonlyArray<{
  readonly name: string;
  readonly fx: number;
  readonly fy: number;
  readonly size: number;
}> = [
  { name: "center", fx: 0.5, fy: 0.5, size: 8 },
  { name: "low-left", fx: 0.25, fy: 0.75, size: 8 },
  { name: "high-right", fx: 0.75, fy: 0.25, size: 8 },
  { name: "q-tl", fx: 0.3, fy: 0.3, size: 8 },
  { name: "q-br", fx: 0.7, fy: 0.7, size: 8 },
];

async function sampleChangedSamples(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<{ samples: number; changedSamples: number }> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("viz canvas has no 2d context");
  const read = (): string[] => {
    const out: string[] = [];
    for (const spec of REGIONS) {
      const x = Math.min(
        Math.max(0, Math.round(spec.fx * canvas.width) - (spec.size >> 1)),
        Math.max(0, canvas.width - spec.size),
      );
      const y = Math.min(
        Math.max(0, Math.round(spec.fy * canvas.height) - (spec.size >> 1)),
        Math.max(0, canvas.height - spec.size),
      );
      out.push(
        JSON.stringify(Array.from(ctx.getImageData(x, y, spec.size, spec.size).data)),
      );
    }
    return out;
  };
  let samples = 0;
  let changedSamples = 0;
  await new Promise<void>((resolve) => {
    let previous: string[] | null = null;
    const t0 = performance.now();
    const frame = (): void => {
      const now = read();
      if (previous !== null && now.some((sig, i) => sig !== previous![i])) {
        changedSamples++;
      }
      previous = now;
      samples++;
      if (performance.now() - t0 < durationMs) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  return { samples, changedSamples };
}

describe("VZ-IM-6 density phases + idle calm state", () => {
  it(
    "idle on entry · play arc rest→sparse→working→full from real rates · levels land in the engine · full-motion silence · labels + steps under reduce · idle pixel-static · arc re-arms",
    { timeout: 240_000 },
    async () => {
      await emulateReducedMotion("no-preference");
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
        const regionText = (): string =>
          $<HTMLElement>(".viz-announce").textContent?.trim() ?? "";
        const probe = () => activeVizPhaseControllers()[0]?.probe();

        // Deterministic content for the hit-flow phases.
        loadDocument(createDemoProject());
        session.setLoop(true);

        // --- 1. ENTRY WHILE STOPPED: the idle state --------------------
        vizBtn().click();
        await waitFor(
          () => host.querySelector(".viz-page") !== null,
          5000,
          "viz mounted",
        );
        await waitFor(
          () => activeVizPhaseControllers().length === 1,
          5000,
          "phase controller mounted",
        );
        expect(probe()!.phase).toBe("idle");
        // J2's chrome half: the remote names the way back while stopped.
        expect($<HTMLElement>(".viz-remote-idle").textContent?.trim()).toBe(
          VIZ_IDLE_LINE,
        );

        // --- 2. THE PLAY ARC from REAL drained hit rates ---------------
        // The entry line (idle copy — stopped at entry) has spoken once;
        // the running edge will add PLAYBACK STARTED and NOTHING else.
        await waitFor(
          () => activeVizAnnouncers()[0]!.probe().emissions === 1,
          4000,
          "entry line spoken exactly once",
        );
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing",
        );
        const arc = await collectArc(5000);
        console.log(
          `[VZ-IM-6 arc] ${JSON.stringify({
            sequence: arc.sequence,
            maxRate: Number(arc.maxRate.toFixed(2)),
          })}`,
        );
        // Ordered subsequence of the arc, ALL FOUR phases observed, and
        // the deduped walk never moves backwards during the climb.
        const order = ["rest", "sparse", "working", "full"];
        const compact = arc.sequence.filter((p) => order.includes(p));
        expect(compact).toEqual(order);
        // The REAL rate evidence: the demo's groove clears the FULL enter
        // threshold with margin.
        expect(arc.maxRate).toBeGreaterThan(VIZ_PHASE_FULL_ENTER_HPS);

        // --- 3. THE LEVEL MAPPING lands in the real engine -------------
        await waitFor(
          () => probe()!.phase === "full",
          5000,
          "phase settles at full",
        );
        const settled = probe()!;
        expect(settled.restLevel).toBe(vizPhaseLevels("full").restLevel);
        expect(settled.liveGain).toBe(vizPhaseLevels("full").liveGain);
        const engine = activeVizNodeEngines()[0]!;
        expect(engine.probe().restLevel).toBe(vizPhaseLevels("full").restLevel);
        expect(engine.probe().liveGain).toBe(vizPhaseLevels("full").liveGain);
        expect(engine.probe().ignited).toBeGreaterThan(0);

        // --- 4. FULL MOTION STAYS SILENT through the climb (DD-2 law) --
        // Exactly TWO lines total: the entry line + PLAYBACK STARTED (the
        // transport edge — the remote's own twin); the arc added NOTHING.
        expect(probe()!.labelAnnouncements).toBe(0);
        expect(activeVizAnnouncers()[0]!.probe().emissions).toBe(2);

        // --- 5. REDUCED MOTION: labels speak, levels STEP --------------
        await emulateReducedMotion("reduce");
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().reducedMotion === true,
          5000,
          "engine swapped to reduced motion",
        );
        // Stop → idle; under reduce the levels STEP to the idle targets
        // exactly (no ease — DD-3's state-change law).
        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          5000,
          "transport stopped",
        );
        await waitFor(
          () =>
            probe()!.phase === "idle" &&
            probe()!.restLevel === vizPhaseLevels("idle").restLevel &&
            probe()!.liveGain === vizPhaseLevels("idle").liveGain,
          3000,
          "idle levels stepped exactly under reduce",
        );
        // Play again UNDER REDUCE: the labels ride the real live region.
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing (reduce)",
        );
        await waitFor(
          () => probe()!.labelAnnouncements >= 3,
          8000,
          "the arc spoke its three labels under reduce",
        );
        expect(probe()!.lastLabel).toBe(`${VIZ_PHASE_LABEL_PREFIX} — FULL`);
        await waitFor(
          () => /^VIZ LIGHTS — /.test(regionText()),
          8000,
          "a phase label rode the page's live region",
        );
        await emulateReducedMotion("no-preference");
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().reducedMotion === false,
          5000,
          "engine back at full motion",
        );

        // --- 6. THE IDLE STATE: pixel-static after the settle ----------
        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          5000,
          "transport stopped (idle probe)",
        );
        await waitFor(
          () => probe()!.phase === "idle",
          3000,
          "idle phase immediate on the stop edge",
        );
        // The settle allowance: one-shot tail (pins release ≤ 1 s + ≤ 0.4 s
        // decay) and the level ease snap (≤ 0.7 s) both die inside 1.6 s.
        await sleep(1600);
        const framesBefore = vizRendererProbes()[0]!.frames;
        const canvas = $<HTMLCanvasElement>(".viz-canvas");
        const still = await sampleChangedSamples(canvas, 1500);
        console.log(
          `[VZ-IM-6 idle-static] ${JSON.stringify(still)}`,
        );
        // PIXEL-STATIC: zero changed samples over the probe window.
        expect(still.samples).toBeGreaterThan(30); // the loop genuinely sampled
        expect(still.changedSamples).toBe(0);
        // NEVER A DEAD SCREEN: the loop keeps drawing through the idle.
        expect(vizRendererProbes()[0]!.frames).toBeGreaterThan(framesBefore);
        expect($<HTMLElement>(".viz-remote-idle").textContent?.trim()).toBe(
          VIZ_IDLE_LINE,
        );

        // --- 7. THE ARC RE-ARMS after idle -----------------------------
        await session.togglePlay();
        await waitFor(
          () => probe()!.phase === "full",
          8000,
          "the arc re-climbs to full after idle",
        );
      } finally {
        await emulateReducedMotion("no-preference");
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
