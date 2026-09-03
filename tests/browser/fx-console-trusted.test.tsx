/**
 * REFINEMENT-1 TRUSTED gate — the FX console affordance under REAL pointers
 * (critique P1-1, snapshot .impeccable/critique/2026-09-03T22-28-59Z__route.md).
 * The original failure mode was POINTER ACTIONABILITY: the console chassis
 * covered its own toggle + the scale chip + GATE, so real Playwright clicks
 * timed out and elementFromPoint returned `.fx-strip` — the only pointer exit
 * was clicking another quadrant (which also moved editing focus).
 *
 * The fix under test (world unchanged — affordance only): the chassis starts
 * BELOW the whole control strip (top pinned to the strip's measured bottom),
 * carries a visible boundary + title strip, and its CLOSE affordance lives on
 * the chassis itself; page-level Escape closes it (keyboard.md v2 Escape
 * order: after the KEYS modal / help mode / inner popovers+menus cancel,
 * before region-head pops).
 *
 * 1. THE FIVE FORMERLY-OCCLUDED CONTROLS receive real clicks while the
 *    console is open: GATE − / GATE + step the value, the scale chip opens
 *    its popover, the FX toggle closes and reopens the console.
 * 2. elementFromPoint at each control's center resolves to the control
 *    (the critique's exact probe — was `.fx-strip` on all five).
 * 3. TRUSTED CLOSE: the title-strip CLOSE button closes the console and
 *    focus lands on the strip's FX entry (the control that owns it).
 * 4. TRUSTED ESCAPE: page-level (body focus) closes the console; with focus
 *    on a covered grid cell it closes WITHOUT the region-head pop (focus
 *    stays on the cell); the scale popover keeps cancel-first (its Escape
 *    does not close the console).
 * 5. EMPTY-STATE VISIBILITY: with an empty chain the chassis still paints —
 *    opaque ground + 1px border + title strip (it used to be an invisible
 *    chassis-on-chassis overlay).
 *
 * The built-app/one-page twin of this gate (1440×900 iframe, page-fits law,
 * geometry vs the strip) lives in quadrant-layout.test.ts.
 */

import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import {
  loadDocument,
  createFreshProjectDocument,
} from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// DA-3 fix precedent (help-mode/help-coverage gates): App imports its
// component CSS but NOT the token sheet — that is main.tsx's job in the real
// bundle. Without tokens the chassis boundary assertions (opaque ground +
// 1px border) would compute to nothing; load the token base as deployed.
import "../../src/styles/base.css";

/** ONE trusted click (real press+release → real capture), bounded. */
async function trustedClick(el: Element): Promise<void> {
  await Promise.race([
    userEvent.click(el),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "trusted click did not settle in 20s (occluded target or blocked actionability)",
            ),
          ),
        20_000,
      ),
    ),
  ]);
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

describe("refinement-1 FX console affordance (real pointers, 1440×900)", () => {
  it(
    "the five strip controls take real clicks under the open console; CLOSE + Escape close it; empty console visibly paints",
    { timeout: 120_000 },
    async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
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
        loadDocument(createFreshProjectDocument()); // deterministic + EMPTY chains
        selectLane("drums");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="drums"] [role="grid"]')
              ?.getAttribute("aria-label") === "DRUMS grid · EDITING",
          4000,
          "drums quadrant editable",
        );

        // The app is designed for 1440×900 (LY-1); the tester page defaults
        // to a phone-narrow viewport where quadrant geometry collapses.
        await page.viewport(1440, 900);

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const drums = () => $('.lane-floor[data-lane="drums"]');
        const fxEntry = () =>
          $<HTMLButtonElement>('.lane-floor[data-lane="drums"] .head-fx');
        const gateValue = () => {
          const group = $('[aria-label="DRUMS gate length"]');
          const text =
            group.querySelector(".head-ctl-value")?.textContent ?? "";
          const digits = text.match(/\d+/)?.[0];
          if (digits === undefined) throw new Error(`gate readout: ${text}`);
          return Number(digits);
        };
        const consoleOpen = () => host.querySelector(".lane-fx-wrap") !== null;

        // --- 1. OPEN + EMPTY-STATE VISIBILITY --------------------------------
        await trustedClick(fxEntry());
        await waitFor(consoleOpen, 4000, "console opens (trusted toggle)");
        expect(fxEntry().getAttribute("aria-expanded")).toBe("true");
        expect(
          host.querySelectorAll(".fx-mod").length,
          "fresh project ships an EMPTY chain",
        ).toBe(0);
        // The chassis paints: opaque ground + a real border + the title
        // strip naming the lane (the invisible-overlay defect).
        const wrap = $<HTMLElement>(".lane-fx-wrap");
        const wrapStyle = getComputedStyle(wrap);
        expect(wrapStyle.backgroundColor, "opaque chassis background").not.toBe(
          "rgba(0, 0, 0, 0)",
        );
        expect(wrapStyle.backgroundColor).not.toBe("transparent");
        expect(
          Number.parseFloat(wrapStyle.borderTopWidth),
          "1px boundary",
        ).toBeGreaterThanOrEqual(1);
        expect($(".lane-fx-title-name").textContent?.trim()).toBe("DRUMS FX");
        expect(
          $<HTMLButtonElement>(".lane-fx-close").getAttribute("aria-label"),
        ).toBe("Close DRUMS FX console");

        // --- 2. THE FIVE FORMERLY-OCCLUDED CONTROLS -------------------------
        // elementFromPoint at each center (the critique's exact probe —
        // every one of these used to resolve to `.fx-strip`).
        const selfHit = (el: Element): boolean => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return hit === el || el.contains(hit);
        };
        const five = [
          [".head-fx", "FX toggle"],
          [".scale-chip", "scale chip"],
          ['button[aria-label="Shorter gate for DRUMS"]', "GATE −"],
          ['button[aria-label="Longer gate for DRUMS"]', "GATE +"],
          ['[aria-label="DRUMS gate length"] .head-ctl-label', "GATE label"],
        ] as const;
        for (const [sel, name] of five) {
          expect(selfHit(drums().querySelector(sel)!), name).toBe(true);
        }
        // The chassis starts BELOW the strip (was top:32px over the edit row).
        const stripR = drums()
          .querySelector(".lane-head-strip")!
          .getBoundingClientRect();
        const wrapR = wrap.getBoundingClientRect();
        expect(wrapR.top).toBeGreaterThanOrEqual(stripR.bottom - 0.5);

        // REAL CLICKS land: GATE + steps the value, GATE − steps it back.
        const gate0 = gateValue();
        await trustedClick($('button[aria-label="Longer gate for DRUMS"]'));
        await waitFor(
          () => gateValue() === gate0 + 1,
          4000,
          "GATE + steps under the open console",
        );
        await trustedClick($('button[aria-label="Shorter gate for DRUMS"]'));
        await waitFor(() => gateValue() === gate0, 4000, "GATE − steps back");

        // The scale chip OPENS its popover while the console stays open.
        await trustedClick($(".scale-chip"));
        await waitFor(
          () => host.querySelector(".scale-pop") !== null,
          4000,
          "scale popover opens under the open console",
        );
        expect(consoleOpen(), "console unaffected").toBe(true);
        // Cancel-first: the popover's Escape does NOT close the console.
        await userEvent.keyboard("{Escape}");
        await waitFor(
          () => host.querySelector(".scale-pop") === null,
          4000,
          "popover Escape closes the popover",
        );
        expect(consoleOpen(), "console survives the popover's Escape").toBe(
          true,
        );

        // --- 3. TRUSTED ESCAPE (page level) ---------------------------------
        await userEvent.keyboard("{Escape}");
        await waitFor(
          () => !consoleOpen(),
          4000,
          "page-level Escape closes the console",
        );
        expect(fxEntry().getAttribute("aria-expanded")).toBe("false");

        // --- 4. COVERED-GRID ESCAPE (no region-head pop) --------------------
        await trustedClick(fxEntry());
        await waitFor(consoleOpen, 4000, "console reopens");
        const cell = $<HTMLElement>(
          '.lane-floor[data-lane="drums"] .cell[data-row="0"][data-step="0"]',
        );
        cell.focus();
        await userEvent.keyboard("{Escape}");
        await waitFor(
          () => !consoleOpen(),
          4000,
          "Escape on the covered grid closes the console",
        );
        expect(
          document.activeElement,
          "focus stays on the cell (region pop stands down)",
        ).toBe(cell);
        // With the console closed, the NEXT Escape pops to the strip head.
        await userEvent.keyboard("{Escape}");
        await waitFor(
          () => document.activeElement !== cell,
          4000,
          "region-head pop applies once the console is closed",
        );

        // --- 5. TRUSTED CLOSE BUTTON ----------------------------------------
        await trustedClick(fxEntry());
        await waitFor(consoleOpen, 4000, "console reopens (toggle)");
        await trustedClick($(".lane-fx-close"));
        await waitFor(
          () => !consoleOpen(),
          4000,
          "CLOSE button closes the console",
        );
        expect(
          document.activeElement,
          "focus lands on the strip's FX entry",
        ).toBe(fxEntry());

        // The FX TOGGLE also closes by real click (the designed v0 exit,
        // un-occluded again): open, then click the toggle.
        await trustedClick(fxEntry());
        await waitFor(consoleOpen, 4000, "console opens for the toggle test");
        await trustedClick(fxEntry());
        await waitFor(
          () => !consoleOpen(),
          4000,
          "FX toggle closes the console by real click",
        );

        // Gate value unchanged from the round trip (− undid +).
        expect(gateValue()).toBe(gate0);
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession: g }) => g().transport.stop?.())
          .catch(() => {});
        dispose();
        host.remove();
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
  );
});
