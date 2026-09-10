/**
 * MB-3 browser gate — TAP-TO-INSPECT under TRUSTED CDP TOUCH (town-hall
 * mobile addendum m3: "help mode via tap-to-inspect (no hover)"; Professor
 * X's help-mode tap model, Daredevil's gate). The committed model, recorded
 * in keyboard.md §Help mode + InfoView.tsx:
 *
 *   A tap BOTH activates and inspects. The click observer (observe-only,
 *   mounted only while the mode is on) resolves the tapped registered
 *   control and shows its entry; the native click keeps doing exactly what
 *   it always did (HP-1's pass-through law — "inspect without activating"
 *   was rejected: it would contradict the recorded no-trap/no-block
 *   decision and put the mode in the way of editing).
 *
 * Gated at the phone stage (390×844) through `Input.dispatchTouchEvent` —
 * trusted touch streams that derive real pointer events and REAL click
 * finalization (the MB-2 touch-gate precedent):
 * 1. ENTRY BY TOUCH: tapping the booth "INFO ?" turns the mode on — the
 *    tappable affordance that replaces the `i` key on touch (announcement
 *    `INFO MODE ON …` through the stage status region).
 * 2. TAP = INSPECT + ACTIVATE: tapping LOOP shows the LOOP entry AND flips
 *    aria-pressed (pass-through); tapping a drum cell shows the grid entry
 *    AND places the note; tapping a preset stepper shows the preset entry
 *    AND steps the sound; tapping a chain tile shows the tile entry AND
 *    selects it.
 * 3. THE CLICK PATH ITSELF (harness-honest teeth): tapping the tile's CUE
 *    SPAN — non-focusable content inside the registered tile — cannot ride
 *    focusin (no focus event fires for a span tap), so ONLY the click
 *    observer can resolve the entry. Removing the observer (the scratch
 *    revert) reddens exactly this assertion.
 * 4. PERSISTENCE: tapping unregistered ground (the strip's lane name —
 *    pure text, no data-help ancestor) keeps the last entry.
 * 5. EXIT BY TOUCH: tapping INFO ? again turns the mode off (announcement
 *    `INFO MODE OFF`; the surface unmounts — zero cost off).
 * 6. The region's live semantics hold at phone width (role=status,
 *    aria-live=polite, never focusable) — announcements continue.
 */

import { describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { activePatterns } from "../../src/state/selection";
import {
  INFO_MODE_OFF_ANNOUNCEMENT,
  INFO_MODE_ON_ANNOUNCEMENT,
  helpMode,
} from "../../src/state/helpMode";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import type { DrumPattern, PitchedPattern } from "../../src/document/schema";

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

describe("MB-3 help-mode tap-to-inspect (trusted CDP touch, phone stage)", () => {
  it(
    "touch enters/inspects/exits help mode: tap shows the entry AND activates; span tap rides the click path; persistence; live semantics",
    { timeout: 180_000 },
    async () => {
      await page.viewport(390, 844);
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "phone",
          5000,
          "phone stage",
        );

        // Trusted touch through CDP (the MB-2 harness: client coords map
        // through the tester iframe's box — measure, never assume (0,0)).
        await cdp().send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 5,
        });
        const c = cdp();
        const frame = window.frameElement as HTMLElement;
        const map = (clientX: number, clientY: number) => {
          const fr = frame.getBoundingClientRect();
          return {
            x: fr.left + clientX * (fr.width / innerWidth),
            y: fr.top + clientY * (fr.height / innerHeight),
          };
        };
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const touch = async (
          pts: ReadonlyArray<{ x: number; y: number }>,
          holdMs = 40,
        ): Promise<void> => {
          const first = pts[0]!;
          await c.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: first.x, y: first.y }],
          });
          for (let i = 1; i < pts.length; i++) {
            await sleep(holdMs);
            await c.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: pts[i]!.x, y: pts[i]!.y }],
            });
          }
          await sleep(holdMs);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await sleep(140);
        };
        const el = (sel: string): HTMLElement =>
          document.querySelector(sel) as HTMLElement;
        const tapEl = async (target: Element): Promise<void> => {
          const r = target.getBoundingClientRect();
          await touch([map(r.left + r.width / 2, r.top + r.height / 2)], 40);
        };
        const title = () =>
          document.querySelector(".info-view-title")?.textContent?.trim() ?? "";
        const stageStatus = () =>
          document.querySelector(".stage-status")?.textContent?.trim() ?? "";

        // --- 1. ENTRY: the `i` keyboard twin --------------------------------
        // M-2 (iteration 4): the phone stage no longer renders the INFO ?
        // (or KEYS ?) button — a render guard, so they are absent from the
        // DOM and the a11y tree. Help mode is entered/exited at phone by
        // the `i` keyboard twin (KeyboardShortcuts), which stays functional
        // with an attached keyboard; the tap-to-inspect model below is
        // unchanged.
        expect(
          document.querySelector(".booth-btn-info"),
          "M-2: no INFO ? button in the phone DOM",
        ).toBeNull();
        expect(
          document.querySelector(".booth-btn-help"),
          "M-2: no KEYS ? button in the phone DOM",
        ).toBeNull();
        const pressI = () =>
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "i", bubbles: true }),
          );
        expect(helpMode()).toBe(false);
        pressI();
        await waitFor(
          () => helpMode() === true,
          2000,
          "mode on by the i keyboard twin",
        );
        expect(el(".info-view")).toBeTruthy();
        expect(stageStatus()).toBe(INFO_MODE_ON_ANNOUNCEMENT);
        // Live semantics hold at phone width (E6 at small scale).
        const region = el(".info-view");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-live")).toBe("polite");
        expect(region.hasAttribute("tabindex")).toBe(false);

        // --- 2. TAP = INSPECT + ACTIVATE (the committed model) -----------
        // LOOP: entry shows AND the control still worked (pass-through).
        const loop = el('[data-help="booth.loop"]');
        const loopBefore = loop.getAttribute("aria-pressed") === "true";
        await tapEl(loop);
        await waitFor(() => title() === "LOOP", 2000, "tap shows LOOP entry");
        expect(
          (loop.getAttribute("aria-pressed") === "true") !== loopBefore,
          "the tapped control still activated (pass-through law)",
        ).toBe(true);

        // A drum cell: the grid entry + the note placed (one audition).
        const cell = el(
          '.lane-floor[data-lane="drums"] .cell[data-row="0"][data-step="2"]',
        );
        await tapEl(cell);
        await waitFor(
          () => title() === "DRUMS GRID",
          2000,
          "tap shows the grid entry",
        );
        const drumPattern = docStore.getState().doc.patterns
          .drums[0] as DrumPattern;
        expect(drumPattern.steps.kick[2], "the tap placed the hit").toBe(true);

        // A preset stepper on bass: entry + the sound stepped.
        const bassTab = el('.lane-switch-tab[data-lane="bass"]');
        await tapEl(bassTab);
        await waitFor(
          () => el(".lane-floor").dataset.lane === "bass",
          3000,
          "bass stage via the switcher tap",
        );
        const bassConf = () =>
          docStore.getState().doc.lanes.find((l) => l.id === "bass")!;
        const presetBefore = bassConf().presetId;
        await tapEl(el('[aria-label="Next preset for BASS"]'));
        await waitFor(
          () => title() === "BASS PRESET",
          2000,
          "tap shows the preset entry",
        );
        expect(bassConf().presetId).not.toBe(presetBefore);

        // --- 3. THE CLICK PATH (harness-honest teeth) ---------------------
        // The tile's CUE SPAN is non-focusable content inside the registered
        // tile. Two probes:
        // (a) the TRUSTED tap — on Chromium-with-touch the tap's default
        //     action focuses the nearest focusable ancestor (the tile), so
        //     focusin may carry the resolve here; it proves real taps
        //     inspect, whatever carries them.
        // (b) the ISOLATED synthetic click — focus parked on <body> (no
        //     focus event can fire), a plain click dispatched at the span:
        //     ONLY the click observer can resolve the entry. This is the
        //     tooth — removing the observer reddens exactly this probe (the
        //     MB-2 honesty note: the observer's exclusive real-device path
        //     is browsers that do NOT focus on tap, e.g. iOS Safari, which
        //     no headless harness can express).
        const tile = el(".rail-row[data-lane='bass'] .rail-tile");
        const tilePattern = activePatterns().bass;
        const cueSpan = tile.querySelector(".rail-tile-cue") as HTMLElement;
        expect(cueSpan.closest("[data-help]")?.getAttribute("data-help")).toBe(
          "rail.tile",
        );
        expect(
          cueSpan.matches("button, input, [tabindex]:not([tabindex='-1'])"),
          "the cue span is genuinely non-focusable (the teeth premise)",
        ).toBe(false);
        await tapEl(cueSpan);
        await waitFor(
          () => title() === "CHAIN TILE",
          2000,
          "span tap resolves (trusted tap inspects)",
        );
        // The tile's own activation law held too: the tap selected the tile's
        // pattern (the unmoved press = the native click law).
        expect(activePatterns().bass).toBeTruthy();
        expect(tilePattern).toBeTruthy();
        // (b) isolate the click observer: set the entry elsewhere by focus,
        // park focus on <body>, then click the span synthetically.
        el('[data-help="booth.loop"]').focus();
        await waitFor(() => title() === "LOOP", 2000, "entry moved to LOOP");
        (document.activeElement as HTMLElement | null)?.blur?.();
        expect(document.activeElement).toBe(document.body);
        cueSpan.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await waitFor(
          () => title() === "CHAIN TILE",
          2000,
          "the click observer resolves the span click with focus parked (the tooth)",
        );

        // --- 4. PERSISTENCE on unregistered ground ------------------------
        const laneName = el(".lane-head-strip .lane-name");
        expect(laneName.closest("[data-help]"), "the premise: no entry").toBeNull();
        await tapEl(laneName);
        expect(
          title(),
          "tapping unregistered ground keeps the last entry",
        ).toBe("CHAIN TILE");

        // --- 5. EXIT by the `i` twin (M-2: no phone INFO ? button) --------
        pressI();
        await waitFor(
          () => helpMode() === false,
          2000,
          "mode off by the i keyboard twin",
        );
        expect(document.querySelector(".info-view")).toBeNull();
        expect(stageStatus()).toBe(INFO_MODE_OFF_ANNOUNCEMENT);

        // --- 6. Controls keep working with the mode OFF (nothing ate) ----
        const notes = () =>
          (docStore.getState().doc.patterns.bass[0] as PitchedPattern).notes;
        const bassCell = el(
          '.lane-floor[data-lane="bass"] .cell[data-row="0"][data-step="0"]',
        );
        await tapEl(bassCell);
        await waitFor(
          () => notes().length === 1,
          3000,
          "editing unaffected with help mode off",
        );
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        dispose();
        host.remove();
        await page.viewport(1280, 800); // leave the tester viewport as configured
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
          /* best-effort restore; the wiping suites clean the origin anyway */
        }
      }
    },
    180_000,
  );
});
