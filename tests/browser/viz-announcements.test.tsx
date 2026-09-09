/**
 * VZ-DD-2 browser journey — ANNOUNCEMENTS + FOCUS DISCIPLINE on the real
 * mounted app (in-page JSX mount, the viz-remote precedent; the plan names
 * viz-journeys.test.tsx but that file is VZ-HW-3's pending scope — this
 * gate lives in its own file until HW-3 folds it into the consolidated
 * journey suite, the VZ-DD-3 recorded name deviation).
 *
 * The task's AC, walked end to end:
 * 1. REGION CONTRACT: the page owns ONE polite live region (role=status,
 *    labelled, never focusable, never a Tab stop — the E6 shape); it
 *    inserts EMPTY and speaks the ENTRY line a task later (mount-with-text
 *    would read as initial content to screen readers).
 * 2. ENTRY FOCUS: opening hands focus to the remote's roving seed (focus
 *    is INSIDE the remote on entry); preset/reroll re-deals NEVER steal
 *    focus from wherever the user is.
 * 3. PRESET CYCLE announces the new preset's name — exactly once per
 *    committed switch, from BOTH input paths (keyboard + pointer).
 * 4. REROLL announces ONCE per COMMIT: a 3-request spam burst speaks
 *    exactly one line (the 150 ms coalescing law's spoken twin), and the
 *    identical consecutive text re-announces through the replay path.
 * 5. TRANSPORT EDGES speak (PLAYBACK STARTED / the idle line's own words
 *    — the visible line and the spoken twin are one string).
 * 6. FULL MOTION STAYS SILENT while hits flow (no per-hit narration —
 *    bounded means state changes only); REDUCED MOTION speaks the textual
 *    equivalence summaries (VIZ ACTIVITY lines at their own cadence).
 * 7. EXIT: the stage status region speaks VIZ OFF (the page's own region
 *    dies with the page — the INFO MODE OFF precedent), the page unmounts,
 *    and focus returns to the invoking control (the funnel verified, not
 *    rebuilt).
 */

import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { closeHelp } from "../../src/state/helpOverlay";
import { setHelpMode } from "../../src/state/helpMode";
import { setVizMode, vizMode } from "../../src/state/vizMode";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import {
  activeVizArrangementControllers,
  VIZ_REROLL_COALESCE_MS,
} from "../../src/viz/arrangement";
import { VIZ_PRESETS } from "../../src/viz/presets";
import { activeVizNodeEngines } from "../../src/viz/nodes";
import {
  activeVizAnnouncers,
  vizPresetAnnouncement,
  VIZ_OFF_ANNOUNCEMENT,
  VIZ_ON_ANNOUNCEMENT,
  VIZ_ON_IDLE_ANNOUNCEMENT,
  VIZ_PLAYBACK_STARTED_ANNOUNCEMENT,
  VIZ_REROLL_ANNOUNCEMENT,
} from "../../src/viz/announcements";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
import { VIZ_IDLE_LINE } from "../../src/components/VizRemote";
// Token base exactly as deployed (the viz-mount precedent): without it
// every var(--color-*) invalidates and computed-value assertions lie.
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VIZ memory hygiene (the joy-loop precedent): boot the deterministic
  // default deal regardless of file order on this shared origin.
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

/** Dispatch a key at the FOCUSED element (the viz-mount law). */
function keyAtActive(k: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Native-button activation, replicated exactly (the DA-3 testing note). */
function pressButton(el: HTMLElement): void {
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  el.click();
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

describe("VZ-DD-2 announcements + focus discipline", () => {
  it(
    "region contract · entry focus into the remote · cycle/reroll/transport announcements exactly once · full-motion silence vs reduced summaries · exit speaks VIZ OFF and returns focus",
    { timeout: 240_000 },
    async () => {
      // CI Chromium default (the viz-remote precedent ran desktop-shape).
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
        const remote = (): HTMLDivElement =>
          $<HTMLDivElement>(".viz-remote");
        const remoteBtn = (label: string): HTMLButtonElement => {
          const el = [
            ...remote().querySelectorAll<HTMLButtonElement>("button"),
          ].find(
            (b) =>
              (b.getAttribute("aria-label") ?? b.textContent?.trim()) ===
              label,
          );
          if (!el) throw new Error(`missing remote control ${label}`);
          return el;
        };
        const region = (): HTMLElement =>
          $<HTMLElement>(".viz-announce");
        const regionText = (): string =>
          region().textContent?.trim() ?? "";
        const emissions = (): number =>
          activeVizAnnouncers()[0]?.probe().emissions ?? -1;
        const readout = (): string =>
          $(".viz-remote-name").textContent?.trim() ?? "";
        const stageText = (): string =>
          $(".stage-status").textContent?.trim() ?? "";

        // Deterministic content for the hit-flow phases.
        loadDocument(createDemoProject());
        session.setLoop(true);

        // --- 1. ENTRY: `v` from body level mounts the surface -----------
        expect(vizMode()).toBe(false);
        keyAtActive("v");
        await waitFor(() => vizMode() === true, 2000, "viz on (`v` key)");
        await waitFor(
          () => host.querySelector(".viz-remote") !== null,
          2000,
          "remote mounted",
        );

        // --- 2. FOCUS INTO THE REMOTE on entry (the roving seed) --------
        await waitFor(
          () => remote().contains(document.activeElement),
          2000,
          "focus lands inside the remote on entry",
        );
        expect(document.activeElement).toBe(
          [...remote().querySelectorAll("button")][0],
        );

        // --- 3. REGION CONTRACT (the E6 shape, page-owned) --------------
        expect(
          host.querySelectorAll(".viz-announce").length,
          "ONE live region on the page",
        ).toBe(1);
        expect(region().getAttribute("role")).toBe("status");
        expect(region().getAttribute("aria-live")).toBe("polite");
        expect(region().getAttribute("aria-label")).toBe(
          "VIZ announcements",
        );
        expect(
          region().hasAttribute("tabindex"),
          "the region is never a Tab stop",
        ).toBe(false);

        // --- 4. ENTRY ANNOUNCEMENT: one line, transport-truthful --------
        // (Transport stopped at boot → the idle entry copy.)
        await waitFor(
          () => regionText() === VIZ_ON_IDLE_ANNOUNCEMENT,
          2000,
          "entry line spoken",
        );
        expect(emissions()).toBe(1);
        expect(activeVizAnnouncers().length).toBe(1);

        // --- 5. PRESET CYCLE: the new name, once per commit, both paths -
        pressButton(remoteBtn("Next preset"));
        await waitFor(
          () => regionText() === vizPresetAnnouncement(VIZ_PRESETS[1]!.name),
          2000,
          "cycle speaks the new preset name (keyboard path)",
        );
        expect(emissions(), "exactly one line per committed switch").toBe(2);
        expect(readout()).toBe(VIZ_PRESETS[1]!.name);

        remoteBtn("Previous preset").click(); // pointer path
        await waitFor(
          () => regionText() === vizPresetAnnouncement(VIZ_PRESETS[0]!.name),
          2000,
          "cycle speaks the new preset name (pointer path)",
        );
        expect(emissions()).toBe(3);

        // --- 6. FOCUS DISCIPLINE: a re-deal never steals focus ----------
        remoteBtn("REROLL").focus();
        remoteBtn("Next preset").click();
        await waitFor(
          () => regionText() === vizPresetAnnouncement(VIZ_PRESETS[1]!.name),
          2000,
          "the stepped-to preset announced",
        );
        expect(
          document.activeElement,
          "preset change leaves focus exactly where it was",
        ).toBe(remoteBtn("REROLL"));

        // --- 7. REROLL SPAM: ONE announcement for the coalesced commit --
        const controller = activeVizArrangementControllers()[0]!;
        const spamBefore = emissions();
        remoteBtn("REROLL").click();
        remoteBtn("REROLL").click();
        remoteBtn("REROLL").click();
        expect(controller.probe().rerollRequests).toBe(3);
        expect(
          regionText(),
          "no line before the window commits (requests are silent)",
        ).toBe(vizPresetAnnouncement(VIZ_PRESETS[1]!.name));
        await sleep(VIZ_REROLL_COALESCE_MS + 300);
        expect(controller.probe().rerollCommits).toBe(1);
        await waitFor(
          () => regionText() === VIZ_REROLL_ANNOUNCEMENT,
          2000,
          "reroll commit speaks",
        );
        expect(
          emissions(),
          "a 3-request burst speaks exactly once",
        ).toBe(spamBefore + 1);

        // --- 8. REPLAY: the identical text re-announces -----------------
        const replayBefore = emissions();
        remoteBtn("REROLL").click();
        await sleep(VIZ_REROLL_COALESCE_MS + 300);
        await waitFor(
          () => regionText() === VIZ_REROLL_ANNOUNCEMENT,
          2000,
          "second reroll re-speaks the identical line (clear-then-set)",
        );
        expect(emissions()).toBe(replayBefore + 1);

        // --- 9. TRANSPORT EDGES: spoken twins of the idle line state ----
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );
        await waitFor(
          () => regionText() === VIZ_PLAYBACK_STARTED_ANNOUNCEMENT,
          2000,
          "playback start speaks",
        );
        expect(
          host.querySelector(".viz-remote-idle"),
          "the idle line yields to playback",
        ).toBeNull();

        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "transport stopped",
        );
        await waitFor(
          () => regionText() === VIZ_IDLE_LINE,
          2000,
          "playback stop speaks the idle line's own words",
        );
        expect($(".viz-remote-idle").textContent?.trim()).toBe(VIZ_IDLE_LINE);

        // --- 10. FULL MOTION STAYS SILENT while hits flow ---------------
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing again",
        );
        await waitFor(
          () => (activeVizNodeEngines()[0]?.probe().ignited ?? 0) > 0,
          10_000,
          "hits igniting at full motion",
        );
        const silentBefore = emissions();
        for (let i = 0; i < 8; i++) {
          await sleep(150);
          expect(
            emissions(),
            `full motion never narrates hits (sample ${i})`,
          ).toBe(silentBefore);
        }
        // The last state change (the restart above) still owns the region —
        // no hit ever displaced it.
        expect(regionText()).toBe(VIZ_PLAYBACK_STARTED_ANNOUNCEMENT);

        // --- 11. REDUCED MOTION: the textual equivalence speaks ---------
        await emulateReducedMotion("reduce");
        await waitFor(
          () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          5000,
          "emulated media applied",
        );
        await waitFor(
          () => activeVizNodeEngines()[0]!.probe().reducedMotion === true,
          5000,
          "engine swapped to reduced motion",
        );
        await waitFor(
          () => /^VIZ ACTIVITY — /.test(regionText()),
          10_000,
          "the activity summary rides the live region under reduce",
        );
        expect(emissions()).toBeGreaterThan(silentBefore);
        await emulateReducedMotion("no-preference");

        // --- 12. EXIT: the STAGE region speaks; the funnel returns focus -
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2000, "viz off (Escape)");
        expect(
          host.querySelector(".viz-announce"),
          "the page's region dies with the page",
        ).toBeNull();
        expect(activeVizAnnouncers().length).toBe(0);
        await waitFor(
          () => stageText() === VIZ_OFF_ANNOUNCEMENT,
          2000,
          "the stage status region carries the exit line",
        );

        // --- 13. BUTTON ENTRY + EXIT: entry speaks, focus returns -------
        vizBtn().click(); // the pointer entry — the button is the invoker
        await waitFor(() => vizMode() === true, 2000, "viz on (button)");
        await waitFor(
          () => remote().contains(document.activeElement),
          2000,
          "focus into the remote on the button entry too",
        );
        // A FRESH announcer per mount — the entry line speaks again, with
        // the copy the transport now warrants (playing since step 10).
        await waitFor(
          () =>
            regionText() ===
            (session.transport.snapshot.playing
              ? VIZ_ON_ANNOUNCEMENT
              : VIZ_ON_IDLE_ANNOUNCEMENT),
          2000,
          "re-entry speaks the truthful entry line",
        );
        expect(emissions()).toBe(1);
        remoteBtn("EXIT").click();
        await waitFor(() => vizMode() === false, 2000, "viz off (EXIT)");
        await waitFor(
          () => document.activeElement === vizBtn(),
          2000,
          "EXIT returns focus to the invoker",
        );
        await waitFor(
          () => stageText() === VIZ_OFF_ANNOUNCEMENT,
          2000,
          "the exit line rode the funnel again",
        );
        expect(session.transport.snapshot.playing).toBe(true); // isolation
      } finally {
        await emulateReducedMotion("no-preference");
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
