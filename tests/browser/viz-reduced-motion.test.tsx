/**
 * VZ-DD-3 browser gate — the reduced-motion alternative on the REAL
 * mounted app under EMULATED prefers-reduced-motion (the in-page JSX-mount
 * idiom, viz-mount.test.tsx precedent; the plan names viz-journeys.test.tsx
 * but that file is VZ-HW-3's pending scope — this gate lives in its own
 * file until HW-3 folds it into the consolidated journey suite).
 *
 * The emulation is BROWSER-LEVEL (CDP Emulation.setEmulatedMedia, the
 * help-touch/mobile-resilience precedent — the same mechanism Playwright's
 * page.emulateMedia drives): the media query, its CHANGE EVENTS and every
 * matchMedia list in the page are the real browser's, so this gate
 * exercises the LIVE preference flip exactly as an OS setting toggled
 * mid-session.
 *
 * What is pinned here mechanically:
 * 1. THE LIVE SWAP (the seam VZ-IM-4 exposed): flipping the preference
 *    with VIZ OPEN and the transport PLAYING swaps the draw mode through
 *    the renderer's matchMedia `onReducedMotionChange` → the engine's
 *    `setReducedMotion` — SAME engine instance (registry identity across
 *    the flip: no remount damage), probe.reducedMotion tracks, held marks
 *    appear.
 * 2. STATIC MARKS RENDER, PIXEL DELTA BOUNDED (the AC's "no animated
 *    decay"): rAF-cadence region sampling while playing under reduce —
 *    changes come only as discrete mark appear/vanish instants (runs of
 *    consecutive changed samples ≤ 3), never the every-frame decay of the
 *    full-motion mode (which the same sampler pins at runs ≥ 5 after the
 *    flip back — the machine-checked contrast).
 * 3. TEXTUAL EQUIVALENCE SEAM (DD-2's fence held): the mounted page's
 *    summarizer emits bounded activity summaries under reduce — no live
 *    region ships (DD-2's announcements read this seam).
 * 4. THE FLASH CEILING IS LIVE IN THE PRODUCT PATH: back at full motion,
 *    the demo's dense patterns drive real admission denials through the
 *    engine's governor (probe.flashMerges > 0).
 * 5. CONTROLS FULLY USABLE under reduce: preset cycle changes the readout,
 *    REROLL commits, Escape exits with focus back on the invoker.
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
import { activeVizActivitySummarizers } from "../../src/viz/textEquivalence";
import {
  activeVizArrangementControllers,
} from "../../src/viz/arrangement";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VZ-IM-3 memory hygiene: deterministic default deal per mount.
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

/** Browser-level preference emulation (CDP; restored in finally). */
async function emulateReducedMotion(
  value: "reduce" | "no-preference",
): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
}

// -- rAF-cadence region sampling (the harness probe's in-page twin) --------


interface RegionSpec {
  readonly name: string;
  readonly fx: number;
  readonly fy: number;
  readonly size: number;
}

const REGIONS: readonly RegionSpec[] = [
  { name: "center", fx: 0.5, fy: 0.5, size: 8 },
  { name: "low-left", fx: 0.25, fy: 0.75, size: 8 },
  { name: "high-right", fx: 0.75, fy: 0.25, size: 8 },
  // A 3×3 spread (the harness trio + the quadrant centers): rigs hang
  // marks where the preset deals them — the grid makes the "light reached
  // SOME region" law robust to any dealt layout.
  { name: "q-tl", fx: 0.3, fy: 0.3, size: 8 },
  { name: "q-tr", fx: 0.7, fy: 0.3, size: 8 },
  { name: "q-bl", fx: 0.3, fy: 0.7, size: 8 },
  { name: "q-br", fx: 0.7, fy: 0.7, size: 8 },
  { name: "mid-top", fx: 0.5, fy: 0.2, size: 8 },
  { name: "mid-bot", fx: 0.5, fy: 0.8, size: 8 },
];

function regionSignature(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  spec: RegionSpec,
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
  return Array.from(ctx.getImageData(x, y, w, h).data);
}

function signaturesDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

interface SampleReport {
  readonly samples: number;
  readonly changes: number;
  /** Longest run of CONSECUTIVE changed samples, per region. */
  readonly maxRun: Readonly<Record<string, number>>;
}

async function sampleRuns(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<SampleReport> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("viz canvas has no 2d context");
  let previous: Record<string, number[] | null> | null = null;
  const maxRun: Record<string, number> = {};
  const runNow: Record<string, number> = {};
  let samples = 0;
  let changes = 0;
  for (const r of REGIONS) {
    maxRun[r.name] = 0;
    runNow[r.name] = 0;
  }
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const frame = (): void => {
      const nowSig: Record<string, number[] | null> = {};
      let changed = false;
      for (const spec of REGIONS) {
        const sig = regionSignature(ctx, canvas, spec);
        nowSig[spec.name] = sig;
        const prev = previous?.[spec.name];
        const isChange =
          previous !== null &&
          sig !== null &&
          prev !== null &&
          signaturesDiffer(sig, prev);
        if (isChange) {
          changed = true;
          runNow[spec.name]!++;
          maxRun[spec.name] = Math.max(maxRun[spec.name]!, runNow[spec.name]!);
        } else {
          runNow[spec.name] = 0;
        }
      }
      if (changed) changes++;
      previous = nowSig;
      samples++;
      if (performance.now() - t0 < durationMs)
        requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  return { samples, changes, maxRun };
}

describe("VZ-DD-3 reduced-motion alternative + flash ceiling", () => {
  it(
    "live preference swap mid-play: static marks render with bounded pixel delta, textual equivalence emits, controls stay usable, the flash governor runs at full motion",
    { timeout: 240_000 },
    async () => {
      // Start from the app's real default (CI Chromium: no-preference).
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

        // --- 1. PLAY THE DEMO, OPEN VIZ (full motion) --------------------
        loadDocument(createDemoProject());
        session.setLoop(true);
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing",
        );
        vizBtn().click();
        await waitFor(
          () => host.querySelector(".viz-page") !== null,
          5000,
          "viz mounted",
        );
        await waitFor(
          () => activeVizNodeEngines().length === 1,
          5000,
          "engine mounted",
        );
        const engineRef = activeVizNodeEngines()[0]!;
        expect(engineRef.probe().reducedMotion).toBe(false);
        expect(
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ).toBe(false);

        // --- 2. THE LIVE SWAP (preference flips mid-play) ----------------
        await emulateReducedMotion("reduce");
        await waitFor(
          () =>
            window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          5000,
          "emulated media applied",
        );
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().reducedMotion === true,
          5000,
          "engine swapped to reduced motion (the matchMedia seam)",
        );
        // NO REMOUNT DAMAGE: the same engine instance across the flip.
        expect(activeVizNodeEngines()[0]).toBe(engineRef);
        // The transport never noticed (Preamble 8).
        expect(session.transport.snapshot.playing).toBe(true);

        // --- 3. STATIC MARKS: held marks render, pixel delta bounded -----
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().heldMarks > 0,
          8000,
          "held marks lit while playing",
        );
        const canvas = $<HTMLCanvasElement>(".viz-canvas");
        const rmReport = await sampleRuns(canvas, 2500);
        // Marks appear/vanish as discrete instants: no long runs of
        // consecutive change (animated decay would run the full window).
        expect(rmReport.samples).toBeGreaterThan(60);
        for (const region of REGIONS) {
          expect(
            rmReport.maxRun[region.name],
            `${region.name} run under reduce`,
          ).toBeLessThanOrEqual(3);
        }
        // The stage is ALIVE (marks appear at hits — J1 holds statically).
        expect(rmReport.changes).toBeGreaterThan(0);
        console.log(
          `[VZ-DD-3 rm-sampling] ${JSON.stringify({
            samples: rmReport.samples,
            changes: rmReport.changes,
            maxRun: rmReport.maxRun,
          })}`,
        );

        // --- 4. TEXTUAL EQUIVALENCE (DD-2's seam, no live region ships) --
        const summarizers = activeVizActivitySummarizers();
        expect(summarizers.length).toBe(1);
        await waitFor(
          () => summarizers[0]!.current() !== null,
          10_000,
          "a bounded activity summary emitted under reduce",
        );
        expect(summarizers[0]!.current()!).toMatch(/^VIZ ACTIVITY — /);

        // --- 5. CONTROLS FULLY USABLE under reduce -----------------------
        const readout = (): string =>
          $<HTMLElement>(".viz-remote-name").textContent?.trim() ?? "";
        const before = readout();
        $<HTMLButtonElement>('[aria-label="Next preset"]').click();
        await waitFor(
          () => readout() !== before,
          5000,
          "preset cycle changes the readout",
        );
        const rerollsBefore =
          activeVizArrangementControllers()[0]?.probe().rerollCommits ?? 0;
        $<HTMLButtonElement>(".viz-remote-reroll").click();
        await waitFor(
          () =>
            (activeVizArrangementControllers()[0]?.probe()
              .rerollCommits ?? 0) > rerollsBefore,
          5000,
          "reroll commits under reduce",
        );

        // --- 6. EXIT under reduce: Escape closes, focus returns ----------
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => host.querySelector(".viz-page") === null,
          5000,
          "viz unmounted (Escape under reduce)",
        );
        await waitFor(
          () => document.activeElement === vizBtn(),
          5000,
          "focus returned to the invoker",
        );

        // --- 7. FULL MOTION: the flash governor runs in the real path ---
        await emulateReducedMotion("no-preference");
        vizBtn().click();
        await waitFor(
          () =>
            host.querySelector(".viz-page") !== null &&
            activeVizNodeEngines().length === 1,
          5000,
          "viz remounted at full motion",
        );
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().reducedMotion === false,
          5000,
          "engine back at full motion",
        );
        // Hits must be flowing before the contrast sample (the transport
        // looped through the exit/remount — Preamble 8). Step 5's NEXT put
        // the session on the SECOND library preset — its rig binds few
        // lanes (sparse ignitions); cycle BACK to the first so the pixel
        // contrast samples the same preset shape the reduce phase sampled.
        // (The session-once restore law means a localStorage wipe would
        // NOT re-deal here — the remote is the honest control.)
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().ignited > 0,
          10_000,
          "hits ignite after remount",
        );
        $<HTMLButtonElement>('[aria-label="Previous preset"]').click();
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().sprites > 0,
          5000,
          "first preset's sprite-baking rig re-hung",
        );
        const canvas2 = $<HTMLCanvasElement>(".viz-canvas");
        console.log(
          `[VZ-DD-3 full-pre] ${JSON.stringify(activeVizNodeEngines()[0]!.probe())}`,
        );
        const fullReport = await sampleRuns(canvas2, 3000);
        // The contrast evidence: animated decay changes frame after frame.
        const maxFullRun = Math.max(
          ...REGIONS.map((r) => fullReport.maxRun[r.name]!),
        );
        expect(maxFullRun).toBeGreaterThanOrEqual(5);
        console.log(
          `[VZ-DD-3 full-sampling] ${JSON.stringify({
            samples: fullReport.samples,
            changes: fullReport.changes,
            maxRun: fullReport.maxRun,
          })}`,
        );
        // The governor binds on the demo's dense patterns: real denials.
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().flashMerges > 0,
          15_000,
          "flash-governor denials while playing",
        );
        const ledger = activeVizNodeEngines()[0]!.probe();
        console.log(
          `[VZ-DD-3 flash-ledger] ${JSON.stringify({
            admits: ledger.flashAdmits,
            merges: ledger.flashMerges,
          })}`,
        );
        expect(ledger.flashAdmits).toBeGreaterThan(0);
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
