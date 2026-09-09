/**
 * VZ-DD-1 browser journey — the REMOTE CHROME + FULL KEYBOARD PATHS on the
 * real mounted app (in-page JSX mount, the viz-mount/viz-joy-loop
 * precedent). The task's AC, walked end to end with BOTH input paths:
 *
 * 1. CHROME: the page mounts canvas + remote; the remote is a labelled
 *    toolbar whose four buttons carry the whole surface (preset stepper,
 *    REROLL, EXIT); the PRESET readout names the booted deal; the J2 idle
 *    line ("PLAYBACK STOPPED — EXIT TO TRANSPORT") shows while the
 *    transport is stopped and disappears once it plays.
 * 2. ENTRY: the global `v` key opens the surface from body level (the
 *    chosen binding, no v2-region collision) and the booth button stays
 *    the pointer twin.
 * 3. THE INERT LAW: while open, the covered stage (booth + main) carries
 *    `inert` and NO tabbable element exists outside the remote — the
 *    "no new Tab stops beyond the remote" law, held mechanically.
 * 4. ROVING: exactly one Tab stop among the remote's buttons; ←/→ walk
 *    (clamped at both ends, no wrap); Home/End jump.
 * 5. KEYBOARD OPERATES EVERYTHING: Enter on PRESET + / – cycles the
 *    library (wrapping both directions, readout tracking), Enter on
 *    REROLL drives the controller's coalesced reroll, and the EXIT paths
 *    (Escape · EXIT button · `v`) all unmount the page AND return focus
 *    to the invoking control (helpOverlay precedent).
 * 6. POINTER PARITY: plain clicks on prev/next/reroll drive the same
 *    controller seams.
 * 7. FINAL ESCAPE ORDER: KEYS modal wins → help mode next → VIZ last; and
 *    help mode still WORKS on the surface (`i` live, info bar lifted
 *    above the page, remote entries readable, no overlap with the remote).
 * 8. STAGE KEYS STAND DOWN: n/d/r do nothing under the full-bleed page.
 * 9. TRANSPORT ISOLATION: playback never stops across any of it.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { closeHelp, helpOpen, openHelp } from "../../src/state/helpOverlay";
import { setHelpMode } from "../../src/state/helpMode";
import { setVizMode, vizMode } from "../../src/state/vizMode";
import { docStore, loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import {
  activeVizArrangementControllers,
  VIZ_REROLL_COALESCE_MS,
} from "../../src/viz/arrangement";
import { VIZ_PRESETS } from "../../src/viz/presets";
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

/** Dispatch a key at the FOCUSED element (the viz-mount law: a real
 * keystroke targets the focused control and flows to window capture). */
function keyAtActive(k: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Native-button activation, replicated exactly (the DA-3 testing note:
 * synthetic keydowns carry no browser default actions — focus + Enter
 * keydown + click is the platform guarantee). */
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

/** Total patterns across lanes — the `n`/`d` stand-down observables. */
function totalPatterns(): number {
  const patterns = docStore.getState().doc.patterns;
  return Object.values(patterns).reduce((n, list) => n + list.length, 0);
}

describe("VZ-DD-1 remote chrome + full keyboard paths", () => {
  it(
    "chrome mounts · v enters · inert holds the tab-stop law · roving + Enter operate everything · exits return focus · escape order final · stage keys stand down · transport isolated",
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
        const readout = (): string =>
          $(".viz-remote-name").textContent?.trim() ?? "";

        // Deterministic content for the stand-down law.
        loadDocument(createDemoProject());
        const patternsBefore = totalPatterns();

        // --- 1. ENTRY: `v` from body level mounts the surface ------------
        expect(vizMode()).toBe(false);
        expect(host.querySelector(".viz-remote")).toBeNull();
        keyAtActive("v");
        await waitFor(() => vizMode() === true, 2000, "viz on (`v` key)");
        expect(vizBtn().getAttribute("aria-pressed")).toBe("true");

        // --- 2. CHROME: labelled toolbar, readout, idle line -------------
        // Canvas + remote + the VZ-DD-2 announcement region + the VZ-HU-1
        // error line (empty :until-fault, always mounted) — four children.
        expect($(".viz-page").childElementCount).toBe(4);
        expect(remote().getAttribute("role")).toBe("toolbar");
        expect(remote().getAttribute("aria-label")).toBe("VIZ remote");
        expect(remoteBtn("Previous preset")).toBeTruthy();
        expect(remoteBtn("Next preset")).toBeTruthy();
        expect(remoteBtn("REROLL")).toBeTruthy();
        expect(remoteBtn("EXIT")).toBeTruthy();
        expect(readout()).toBe(VIZ_PRESETS[0]!.name);
        // J2 idle line: stopped transport names the way back.
        expect($(".viz-remote-idle").textContent?.trim()).toBe(VIZ_IDLE_LINE);

        // --- 3. THE INERT LAW: no tab stop outside the remote -----------
        const booth = $(".booth");
        const stage = $("main.stage");
        expect(booth.inert, "booth inert under the page").toBe(true);
        expect(stage.inert, "stage inert under the page").toBe(true);
        const tabbables = [
          ...host.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => el.isConnected);
        expect(tabbables.length).toBeGreaterThan(4); // the walk sees real UI
        for (const el of tabbables) {
          if (remote().contains(el)) continue;
          // Documented above-surface chrome (z ≥ 60): failure affordances
          // stay reachable in ANY mode by design (keyboard.md §"VIZ page").
          if (el.closest(".support-banner, .toasts, .audio-resume")) continue;
          expect(
            el.closest("main.stage, .booth") !== null,
            `tabbable outside the remote must sit under the inert stage: ${el.outerHTML.slice(0, 60)}`,
          ).toBe(true);
        }

        // --- 4. ROVING: one Tab stop; arrows walk clamped ----------------
        const controls = (): HTMLButtonElement[] => [
          ...remote().querySelectorAll<HTMLButtonElement>("button"),
        ];
        const tabStops = (): HTMLButtonElement[] =>
          controls().filter((b) => b.tabIndex === 0);
        await waitFor(
          () => tabStops().length === 1,
          2000,
          "roving seeded (one tab stop)",
        );
        expect(tabStops()[0]).toBe(controls()[0]); // seed = first control
        controls()[0]!.focus();
        keyAtActive("ArrowLeft"); // clamp at the first control — no wrap
        expect(document.activeElement).toBe(controls()[0]);
        keyAtActive("ArrowRight");
        expect(document.activeElement).toBe(controls()[1]);
        keyAtActive("ArrowRight");
        keyAtActive("ArrowRight");
        expect(document.activeElement).toBe(controls()[3]);
        keyAtActive("ArrowRight"); // clamp at the last control
        expect(document.activeElement).toBe(controls()[3]);
        keyAtActive("Home");
        expect(document.activeElement).toBe(controls()[0]);
        keyAtActive("End");
        expect(document.activeElement).toBe(controls()[3]);
        expect(tabStops().length).toBe(1); // roving moved, never multiplied

        // --- 5. KEYBOARD CYCLE: Enter on the stepper, wrapping -----------
        const controller = activeVizArrangementControllers()[0]!;
        const commits0 = controller.probe().commits;
        pressButton(remoteBtn("Next preset"));
        expect(readout()).toBe(VIZ_PRESETS[1]!.name);
        expect(controller.probe().presetId).toBe(VIZ_PRESETS[1]!.id);
        expect(controller.probe().commits).toBe(commits0 + 1);
        // Wrapping backwards: – from index 1 → 0, one more – wraps to the
        // LAST library entry.
        pressButton(remoteBtn("Previous preset"));
        expect(readout()).toBe(VIZ_PRESETS[0]!.name);
        pressButton(remoteBtn("Previous preset"));
        expect(readout()).toBe(
          VIZ_PRESETS[VIZ_PRESETS.length - 1]!.name,
        );

        // --- 6. REROLL (keyboard): pending → one commit, same preset -----
        const seedBefore = controller.probe().seed;
        const nameAtReroll = readout();
        pressButton(remoteBtn("REROLL"));
        expect(controller.probe().pendingReroll).toBe(true);
        expect(readout(), "readout never flickers on a pending window").toBe(
          nameAtReroll,
        );
        await sleep(VIZ_REROLL_COALESCE_MS + 300);
        expect(controller.probe().pendingReroll).toBe(false);
        expect(controller.probe().seed).not.toBe(seedBefore);
        expect(controller.probe().presetId).toBe(
          VIZ_PRESETS[VIZ_PRESETS.length - 1]!.id,
        );
        expect(controller.probe().commits).toBe(commits0 + 4);

        // --- 7. POINTER PARITY: plain clicks, same seams ------------------
        remoteBtn("Next preset").click();
        expect(controller.probe().commits).toBe(commits0 + 5);
        expect(controller.probe().presetId).toBe(VIZ_PRESETS[0]!.id); // wrap
        remoteBtn("REROLL").click();
        expect(controller.probe().rerollRequests).toBe(2);
        await sleep(VIZ_REROLL_COALESCE_MS + 300);

        // --- 8. STAGE KEYS STAND DOWN under the full-bleed page ----------
        keyAtActive("n");
        keyAtActive("d");
        keyAtActive("r");
        expect(
          totalPatterns(),
          "n/d/r never edit the covered stage",
        ).toBe(patternsBefore);
        const docBefore = JSON.stringify(docStore.getState().doc.patterns);
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(
          JSON.stringify(docStore.getState().doc.patterns),
          "undo never edits the covered stage either",
        ).toBe(docBefore);

        // --- 9. HELP MODE ON THE SURFACE: `i` live, info bar lifted ------
        keyAtActive("i");
        await waitFor(() => host.querySelector(".info-view") !== null);
        const info = $(".info-view") as HTMLElement;
        const page = $(".viz-page") as HTMLElement;
        expect(
          Number(getComputedStyle(info).zIndex),
          "info bar rides above the surface",
        ).toBeGreaterThan(Number(getComputedStyle(page).zIndex));
        // The remote's entries are READABLE (the coverage journey clause).
        remoteBtn("REROLL").focus();
        await waitFor(
          () =>
            host.querySelector(".info-view-title")?.textContent?.trim() ===
            "REROLL",
          2000,
          "focused REROLL drives the info region",
        );
        // Non-overlap: the lifted bar and the stepped-up remote never collide.
        const infoRect = info.getBoundingClientRect();
        const remoteRect = remote().getBoundingClientRect();
        expect(remoteRect.bottom).toBeLessThanOrEqual(infoRect.top + 0.5);

        // --- 10. FINAL ESCAPE ORDER: modal → help → viz -------------------
        keyAtActive("Escape"); // help mode exits FIRST (cancel-first)
        await waitFor(() => host.querySelector(".info-view") === null);
        expect(vizMode(), "help peeled, surface stays").toBe(true);
        openHelp($<HTMLElement>(".booth-btn-help"));
        await waitFor(() => helpOpen() === true, 2000, "keys modal open");
        keyAtActive("Escape");
        await waitFor(() => helpOpen() === false, 2000, "keys modal closed");
        expect(vizMode(), "modal wins the first Escape").toBe(true);
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2000, "viz off (Escape)");
        expect(booth.inert, "inert lifted on close").toBe(false);

        // --- 11. FOCUS RETURN: every exit lands back on the invoker ------
        vizBtn().focus();
        vizBtn().click(); // the pointer entry — the button is the invoker
        await waitFor(() => vizMode() === true, 2000, "viz on (button)");
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2000, "viz off (Escape)");
        await waitFor(
          () => document.activeElement === vizBtn(),
          2000,
          "Escape exit returns focus to the booth VIZ button",
        );

        // The EXIT button funnel (focus starts INSIDE the remote).
        vizBtn().click();
        await waitFor(() => vizMode() === true, 2000, "viz on (button)");
        remoteBtn("EXIT").focus();
        remoteBtn("EXIT").click();
        await waitFor(() => vizMode() === false, 2000, "viz off (EXIT)");
        await waitFor(
          () => document.activeElement === vizBtn(),
          2000,
          "EXIT returns focus to the invoker",
        );

        // The `v` exit funnel (entry from a focused non-invoker control).
        const keysBtn = $<HTMLElement>(".booth-btn-help");
        keysBtn.focus();
        keyAtActive("v");
        await waitFor(() => vizMode() === true, 2000, "viz on (`v` from KEYS)");
        keyAtActive("v");
        await waitFor(() => vizMode() === false, 2000, "viz off (`v`)");
        await waitFor(
          () => document.activeElement === keysBtn,
          2000,
          "`v` exit returns focus to the focused invoker",
        );

        // --- 12. IDLE LINE + TRANSPORT ISOLATION across the surface ------
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );
        vizBtn().click();
        await waitFor(() => vizMode() === true, 2000, "viz on while playing");
        expect(
          host.querySelector(".viz-remote-idle"),
          "the idle line yields to playback",
        ).toBeNull();
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2000, "viz off");
        expect(session.transport.snapshot.playing).toBe(true);
        expect($(".booth-btn-play").textContent?.trim()).toBe("STOP");
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
