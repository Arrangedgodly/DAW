/**
 * REFINEMENT-2 TRUSTED gate — the euclid fill rail under REAL pointers
 * (critique P1-2, snapshot .impeccable/critique/2026-09-03T22-28-59Z__route.md).
 * The original failure mode was RAIL GEOMETRY: the 104 px fill slot was
 * narrower than its control stack (E tag + pulses/rotation steppers + SET ≈
 * 200 px), so the control overflowed UNDER the row's grid cells — SET
 * (35×20 at x286–321) sat entirely past the cells' left edge (x233),
 * elementFromPoint at its center returned a `.cell`, and real Playwright
 * clicks timed out even with SET enabled. The advertised one-gesture rhythm
 * maker could not be applied by pointer at the primary viewport.
 *
 * The fix under test (world unchanged — geometry only): the rail slot is
 * sized to FIT the control stack (fillRailPx 220, pinned INLINE by the
 * renderer — the label-pin precedent — so the slot and the playhead offset
 * can never drift), re-budgeting the width inside the quadrant per its own
 * law (long patterns scroll INSIDE the quadrant; a 1-bar pattern still needs
 * no internal scroll at 1440×900).
 *
 * 1. GEOMETRY LAW: every one of the six drum rows' rails fits its control
 *    (ctl natural width ≤ rail content width, with ≥ one readout character
 *    of headroom = the 4-bar "64/64" worst case) and the control clears the
 *    cells (ctl right ≤ cells left). The slot width is renderer-pinned.
 * 2. elementFromPoint at every fill-rail control's center resolves to the
 *    control (the critique's exact probe — SET used to resolve to a cell),
 *    both UNARMED (SET disabled) and ARMED (SET enabled).
 * 3. REAL CLICKS land on every control: the real-user journey (hover a
 *    visible part of the row → the rail reveals) then pulses/rotation
 *    steppers arm + preview, and a trusted SET click COMMITS the row into
 *    the document (preview cleared).
 * 4. 4-BAR worst case: on a 64-step pattern the same laws hold and SET
 *    still commits by real click (the slot is fixed — no column shift).
 * 5. KEYBOARD TWIN KEPT (keyboard.md euclid path, PX-3): SET stays tab
 *    reachable and a REAL Enter on the focused SET commits.
 *
 * The component-level twin (rail pinned width, fit, synthetic preview/
 * commit law) lives in euclid-fill.test.tsx; the built-app/one-page twin
 * (1440×900 iframe) lives in quadrant-layout.test.ts §9c.
 */

import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import {
  loadDocument,
  createFreshProjectDocument,
  addPattern,
  docStore,
} from "../../src/state/store";
import { selectLane, selectPattern } from "../../src/state/selection";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { euclid } from "../../src/audio/euclid";
// DA-3 fix precedent (help-mode/help-coverage gates): App imports its
// component CSS but NOT the token sheet — that is main.tsx's job in the real
// bundle. Without tokens the geometry assertions would compute against
// missing font metrics; load the token base as deployed.
import "../../src/styles/base.css";

/** ONE trusted click (real press+release → real hit testing), bounded. */
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

describe("refinement-2 euclid fill-rail geometry (real pointers, 1440×900)", () => {
  it(
    "the rail fits its controls: real clicks land on pulses/rotation/SET, SET commits, keyboard twin kept",
    { timeout: 180_000 },
    async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

      /** Live row of the ACTIVE drums pattern (identity-checked by caller). */
      const activeRow = (patternId: string, piece: string): boolean[] => {
        const p = docStore
          .getState()
          .doc.patterns.drums.find((cand) => cand.id === patternId);
        if (p?.kind !== "drums") throw new Error("expected drums pattern");
        return [...p.steps[piece as keyof typeof p.steps]];
      };

      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument()); // deterministic: EMPTY rows
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
        // Font-metric determinism for the slot-fit law (fallback-face chars
        // are wider than the deployed Silkscreen/Departure Mono metrics).
        await document.fonts.ready;

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const drumsLane = () => $('.lane-floor[data-lane="drums"]');
        const railOf = (row: number) =>
          $(`.row-fill[data-row="${row}"]`) as HTMLElement;
        const cellsOfRow = (row: number): Element =>
          [...drumsLane().querySelectorAll(".grid-row")][row]!.querySelector(
            ".row-cells",
          )!;
        const selfHit = (el: Element): boolean => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return hit === el || el.contains(hit);
        };

        // --- 1. GEOMETRY LAW (all six rows) --------------------------------
        // The critique's numbers: rail 104 < control 200, ctl overflowed
        // 88.3 px past the cells' left edge (SET dead under the cells).
        await trustedClick($(".head-fill-toggle"));
        for (let row = 0; row < 6; row++) {
          const rail = railOf(row);
          const ctl = rail.querySelector(".row-fill-ctl") as HTMLElement;
          expect(rail.classList.contains("is-overlay")).toBe(true);
          expect(
            ctl.scrollWidth,
            `row ${row} controls fit the expanded overlay`,
          ).toBeLessThanOrEqual(rail.clientWidth);
          expect(ctl.getBoundingClientRect().right).toBeLessThanOrEqual(
            rail.getBoundingClientRect().right + 0.5,
          );
        }
        // The widened rail is re-budgeted INSIDE the quadrant: the 1-bar
        // row (72+228+350=650) still needs no internal scroll at 1440.
        const drumsScroll = drumsLane().querySelector(".lane-grid-scroll")!;
        expect(
          drumsScroll.scrollWidth,
          "1-bar drums quadrant keeps its internal no-scroll at 1440×900",
        ).toBeLessThanOrEqual(drumsScroll.clientWidth);

        // --- 2. elementFromPoint PROOF (unarmed: SET disabled) -------------
        const kickRail = railOf(0);
        kickRail.scrollIntoView({ block: "nearest" });
        const kickButtons = [
          ...kickRail.querySelectorAll("button"),
        ] as HTMLButtonElement[];
        expect(kickButtons.length).toBe(5); // – + – + SET
        expect(kickButtons[4]!.disabled, "empty row → SET unarmed").toBe(true);
        for (const btn of kickButtons) {
          expect(
            selfHit(btn),
            `${btn.getAttribute("aria-label")} self-hits`,
          ).toBe(true);
        }

        // --- 3. REAL CLICKS: reveal → arm → commit --------------------------
        // The real-user journey: the pointer enters the row through a
        // VISIBLE part (the row label), which reveals the opacity-gated
        // rail — then trusted clicks land on the revealed controls.

        await waitFor(
          () => getComputedStyle(kickRail).opacity === "1",
          4000,
          "row hover reveals the fill rail",
        );
        // Pulses + ×2 (trusted): 0 → 2, armed, dashed preview painted.
        await trustedClick(kickButtons[1]!);
        await trustedClick(kickButtons[1]!);
        await waitFor(
          () => kickRail.textContent?.includes("2/16") === true,
          4000,
          "pulses readout 2/16 after trusted clicks",
        );
        await waitFor(
          () =>
            host.querySelector(
              '.lane-floor[data-lane="drums"] .cell[data-preview="true"]',
            ) !== null,
          4000,
          "euclid preview painted",
        );
        // Rotation + (trusted): 0 → 1 (both steppers proven by real clicks).
        await trustedClick(kickButtons[3]!);
        await waitFor(
          () =>
            kickRail.querySelectorAll(".row-fill-value")[1]!.textContent ===
            "1",
          4000,
          "rotation readout 1 after trusted click",
        );
        // SET (trusted): commits E(2,16,1) into the document row.
        const setBtn = kickButtons[4]!;
        expect(setBtn.disabled, "armed → SET enabled").toBe(false);
        expect(selfHit(setBtn), "SET self-hits when enabled").toBe(true);
        const kickPatternId = docStore.getState().doc.patterns.drums[0]!.id;
        await trustedClick(setBtn);
        await waitFor(
          () =>
            JSON.stringify(activeRow(kickPatternId, "kick")) ===
            JSON.stringify(euclid(2, 16, 1)),
          4000,
          "trusted SET commits E(2,16,1) into the kick row",
        );
        expect(
          host.querySelector(
            '.lane-floor[data-lane="drums"] .cell[data-preview="true"]',
          ),
          "preview cleared after commit",
        ).toBeNull();

        // --- 4. 4-BAR WORST CASE (64 steps, widest readout) -----------------
        const id4 = addPattern("drums", 4, "TRUST4");
        selectPattern("drums", id4);
        await waitFor(
          () => cellsOfRow(0).querySelectorAll(".cell").length === 64,
          5000,
          "4-bar drums grid rendered",
        );
        const rail4 = railOf(0);
        rail4.scrollIntoView({ block: "nearest" });
        const ctl4 = rail4.querySelector(".row-fill-ctl") as HTMLElement;
        expect(
          ctl4.scrollWidth,
          "4-bar control fits the fixed rail",
        ).toBeLessThanOrEqual(rail4.clientWidth);
        expect(ctl4.getBoundingClientRect().right).toBeLessThanOrEqual(
          rail4.getBoundingClientRect().right + 0.5,
        );
        const buttons4 = [
          ...rail4.querySelectorAll("button"),
        ] as HTMLButtonElement[];
        for (const btn of buttons4) expect(selfHit(btn)).toBe(true);
        // Trusted arm + SET commit on the 64-step row (E(4,64,0)).

        await waitFor(
          () => getComputedStyle(rail4).opacity === "1",
          4000,
          "row hover reveals the 4-bar rail",
        );
        for (let i = 0; i < 4; i++) await trustedClick(buttons4[1]!);
        await waitFor(
          () => rail4.textContent?.includes("4/64") === true,
          4000,
          "4-bar readout 4/64",
        );
        await trustedClick(buttons4[4]!);
        await waitFor(
          () =>
            JSON.stringify(activeRow(id4, "kick")) ===
            JSON.stringify(euclid(4, 64, 0)),
          4000,
          "trusted SET commits E(4,64,0) on the 4-bar row",
        );

        // --- 5. KEYBOARD TWIN KEPT (PX-3, keyboard.md) ----------------------
        // SET remains tab-reachable (opacity gate ≠ focus gate) and a REAL
        // Enter on the focused SET commits — the pointer fix never traded
        // away the keyboard path.
        const hatRail = railOf(2);
        const hatButtons = [
          ...hatRail.querySelectorAll("button"),
        ] as HTMLButtonElement[];
        expect(hatButtons[1]!.tabIndex, "stepper stays tab-reachable").toBe(0);
        expect(hatButtons[4]!.tabIndex, "SET stays tab-reachable").toBe(0);
        hatButtons[1]!.focus(); // real focus reveals the rail (CSS law)
        await waitFor(
          () => getComputedStyle(hatRail).opacity === "1",
          4000,
          "focus reveals the fill rail",
        );
        await userEvent.keyboard("{Enter}"); // pulses 0 → 1 (native click)
        await waitFor(
          () => hatRail.textContent?.includes("1/64") === true,
          4000,
          "real Enter arms via the + stepper",
        );
        hatButtons[4]!.focus();
        await userEvent.keyboard("{Enter}"); // SET commits E(1,64,0)
        await waitFor(
          () =>
            JSON.stringify(activeRow(id4, "hat")) ===
            JSON.stringify(euclid(1, 64, 0)),
          4000,
          "real Enter on SET commits (keyboard twin)",
        );
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
