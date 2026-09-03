/**
 * IN-2 FIX gate — TRUSTED single-click activation on the source-mounted real
 * app (the verifier-FAIL class, pinned so it can never pass silently again).
 *
 * The verifier proved (2026-09-03, real CDP-trusted pointers on the built
 * app): `setPointerCapture` on pointerdown retargets the trailing `click` to
 * the grid container, so a click-target cell check never passes under REAL
 * pointers — pitched single click placed nothing, the anchor/mid-span click
 * law and the drums single-click toggle+audition were unreachable. Synthetic
 * gates cannot catch it: un-trusted dispatched PointerEvents carry no active
 * pointer (capture throws), and HTMLElement.click() bypasses pointer events.
 *
 * This gate drives REAL trusted input via vitest's `userEvent` (playwright
 * provider → locator.click → the browser input pipeline: trusted pointer
 * events that REALLY capture — the exact conditions of the FAIL), with full
 * store + session access (drag-notes' mount pattern):
 * - trusted pitched single click PLACES the GATE-DEFAULT note and auditions
 *   exactly ONCE (I2-3 + v0 audition law);
 * - trusted anchor click REMOVES; trusted mid-span click TRIMS;
 * - trusted drums click toggles + auditions once, toggle-off never auditions;
 * - the SYNTHETIC unmoved pointerdown/up pair — the uncaptured branch of the
 *   same pointerup activation path — still works (parity with test pointers).
 *
 * Proven to catch the original bug: against the pre-fix renderer this gate
 * fails with "trusted single click places gate-default note never met" (the
 * verifier's exact finding); with the fix it is green. The renderer code is
 * identical in the built bundle (globalSetup builds it from this source);
 * the independent CDP-trusted probe of dist/ remains the verifier's own
 * methodology. A dedicated built-bundle userEvent gate was attempted and
 * dropped: vitest's locators cannot reach into the e2e's app iframe, and a
 * main-document injection of the bundle fights the harness (viewport/scroll
 * interactions with vitest's own DOM) too unstably to gate on — recorded in
 * production-log.md "IN-2 fix".
 */

import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { getSession } from "../../src/engine/session";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import type { PitchedPattern } from "../../src/document/schema";

/**
 * ONE trusted click (real pointer press+release → real capture). Bounded: a
 * click that cannot land must fail loudly, never hang the worker.
 */
async function trustedClick(el: Element): Promise<void> {
  await Promise.race([
    userEvent.click(el),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "trusted click did not settle in 20s (stale target or blocked actionability)",
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

describe("IN-2 fix: single-click activation under TRUSTED pointers (app)", () => {
  it(
    "gate-default place + ONE audition, anchor remove, mid-span trim, drums toggle + one audition, synthetic pointerup parity",
    { timeout: 120_000 },
    async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

      // Audition spy (session seam): count calls per lane — the verifier's
      // worklet-message evidence, at the API surface the app actually calls.
      const session = getSession();
      const origAudition = session.audition;
      const auditions: Array<{ lane: string }> = [];
      session.audition = (laneId, degreeOrDrum) => {
        auditions.push({ lane: laneId });
        return origAudition.call(session, laneId, degreeOrDrum);
      };

      const cellAt = (lane: string, row: number, step: number): HTMLElement => {
        const cell = document.querySelector(
          `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
        );
        if (!cell) throw new Error(`missing ${lane} cell ${row}:${step}`);
        return cell as HTMLElement;
      };
      const bassNotes = () => {
        const p = docStore.getState().doc.patterns.bass[0];
        if (p?.kind !== "pitched") throw new Error("expected pitched bass");
        return (p as PitchedPattern).notes;
      };
      const bassAuditions = () =>
        auditions.filter((a) => a.lane === "bass").length;
      const drumsAuditions = () =>
        auditions.filter((a) => a.lane === "drums").length;
      const kickOn = (step: number): boolean => {
        const p = docStore.getState().doc.patterns.drums[0];
        if (p?.kind !== "drums") throw new Error("expected drums pattern");
        return p.steps.kick[step] === true;
      };
      const waitEditable = async (lane: string, label: string) =>
        waitFor(
          () =>
            document.querySelector(
              `.lane-floor[data-lane="${lane}"] [role="grid"]`,
            )?.getAttribute("aria-label") === label,
          4000,
          `${lane} quadrant editable`,
        );

      const pe = (el: Element, type: string, x: number, y: number): boolean =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: "mouse",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      const center = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };

      // The app is designed for 1440×900 (LY-1); the tester iframe defaults
      // to a phone-narrow viewport where quadrant geometry collapses and
      // click points stop hitting their cells.
      await page.viewport(1440, 900);

      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitEditable("bass", "BASS grid · EDITING");
        expect(bassNotes()).toHaveLength(0);
        expect(bassAuditions()).toBe(0);

        // --- trusted PLACE: gate default (bass gate = 2 steps) + ONE audition
        const anchor = cellAt("bass", 0, 2);
        await trustedClick(anchor);
        await waitFor(
          () =>
            bassNotes().length === 1 &&
            bassNotes()[0]!.start === 2 &&
            bassNotes()[0]!.length === 2,
          4000,
          "trusted single click places gate-default note",
        );
        expect(bassAuditions()).toBe(1); // placement auditions (v0 law)

        // --- trusted ANCHOR click removes (no audition on removal)
        await trustedClick(anchor);
        await waitFor(
          () => bassNotes().length === 0,
          4000,
          "trusted anchor click removes the note",
        );
        expect(bassAuditions()).toBe(1);

        // --- place again, grow to 4, then trusted MID-SPAN click trims to 3
        await trustedClick(anchor);
        await waitFor(
          () => bassNotes().length === 1,
          4000,
          "trusted re-place",
        );
        expect(bassAuditions()).toBe(2);
        anchor.focus();
        anchor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "+",
            bubbles: true,
            cancelable: true,
          }),
        );
        anchor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "+",
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(bassNotes()[0]!.length).toBe(4); // covers steps 2..5
        await trustedClick(cellAt("bass", 0, 4)); // mid-span → trim to 3
        await waitFor(
          () => bassNotes()[0]!.length === 3,
          4000,
          "trusted mid-span click trims the note",
        );
        expect(bassAuditions()).toBe(2); // trim never auditions

        // --- SYNTHETIC unmoved pointerdown/up pair: the SAME pointerup
        // activation must work when capture is impossible (test pointers).
        const free = cellAt("bass", 0, 8);
        const f = center(free);
        pe(free, "pointerdown", f.x, f.y);
        pe(free, "pointerup", f.x, f.y);
        expect(bassNotes()).toContainEqual({ degree: 0, start: 8, length: 2 });
        expect(bassAuditions()).toBe(3);

        // --- drums trusted toggle: ON auditions once, OFF never auditions
        selectLane("drums");
        await waitEditable("drums", "DRUMS grid · EDITING");
        const kickCell = cellAt("drums", 0, 0);
        expect(kickOn(0)).toBe(false);
        expect(drumsAuditions()).toBe(0);
        await trustedClick(kickCell);
        await waitFor(() => kickOn(0), 4000, "trusted drums click toggles ON");
        expect(drumsAuditions()).toBe(1);
        await trustedClick(kickCell);
        await waitFor(
          () => !kickOn(0),
          4000,
          "trusted drums click toggles OFF",
        );
        expect(drumsAuditions()).toBe(1);
      } finally {
        session.audition = origAudition;
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
    120_000,
  );
});
