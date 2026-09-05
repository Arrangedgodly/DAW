/**
 * IN-4 TRUSTED gate — the edge rows only REAL pointers can express (the
 * drag-notes-trusted precedent: vitest userEvent → playwright locator → the
 * browser input pipeline = trusted pointer events that REALLY capture, plus
 * real focus finalization):
 *
 * 1. DBLCLICK FOCUS (verifier finding, fixed in-task): a trusted dblclick on
 *    a rail tile opens the inline rename editor AND DOM focus lands in the
 *    input — the second press's default focus finalization used to steal it
 *    back to the tile, so the first typed character went to the tile.
 * 2. HONEST NOTE-EDGE GEOMETRY (IN-2 verifier observation, fixed in-task):
 *    a trusted click at a 1-step note's visual CENTER removes it (the tap
 *    law under real capture), and a trusted click on the cell just RIGHT of
 *    a 1-step note PLACES a note (the old ±5px hit-zone overhang used to
 *    swallow that press into a no-op resize).
 * 3. RAPID RE-PRESS DURING COMMIT: two fast trusted presses on separate
 *    cells each activate exactly once (pointerup activation is never eaten
 *    by the previous gesture's trailing-click suppression).
 *
 * Proven to catch the originals: with the InlineEdit focus fix reverted, row
 * 1 fails ("dblclick editor input focused never met"); with the old
 * `right:-5px; width:10px` note-edge zone restored, row 2's next-cell place
 * fails (the press lands in the overhung zone → a no-op resize arms → no
 * note). The synthetic companion (pointer-edge-states.test.tsx) owns every
 * row dispatch events can express.
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

/** ONE trusted click (real press+release → real capture), bounded. */
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

describe("IN-4 trusted pointer edge states (real capture, real focus)", () => {
  it(
    "dblclick focuses the inline editor; 1-step-note center click removes; next-cell click places; rapid re-press activates each press once",
    { timeout: 120_000 },
    async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

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

      // The app is designed for 1440×900 (LY-1); the tester iframe defaults
      // to a phone-narrow viewport where quadrant geometry collapses.
      await page.viewport(1440, 900);

      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());

        // --- 1. DBLCLICK FOCUS: the editor opens AND holds DOM focus -------
        const tile = document.querySelector(
          '.rail-row[data-lane="drums"] .rail-tile',
        ) as HTMLElement;
        await userEvent.dblClick(tile);
        await waitFor(
          () => document.querySelector(".rail-edit") !== null,
          4000,
          "dblclick editor opens",
        );
        await waitFor(
          () =>
            document.activeElement === document.querySelector(".rail-edit"),
          4000,
          "dblclick editor input focused",
        );
        // Close the editor (Esc) without committing a rename.
        (
          document.activeElement as HTMLElement
        ).dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => document.querySelector(".rail-edit") === null,
          4000,
          "editor closes on Escape",
        );

        // --- 2. HONEST NOTE-EDGE GEOMETRY under real capture ----------------
        selectLane("bass");
        await waitFor(
          () =>
            document
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              // RC-1 journey delta: windowed pitched names append ROWS range.
              ?.getAttribute("aria-label")
              ?.startsWith("BASS grid · EDITING") === true,
          4000,
          "bass quadrant editable",
        );
        // A 1-step note at step 2 (place at the gate default, then shrink).
        const anchor = cellAt("bass", 0, 2);
        await trustedClick(anchor);
        await waitFor(
          () =>
            bassNotes().length === 1 &&
            bassNotes()[0]!.start === 2 &&
            bassNotes()[0]!.length === 2,
          4000,
          "trusted click places gate-default note",
        );
        anchor.focus();
        anchor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "-",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => bassNotes()[0]!.length === 1,
          4000,
          "note shrunk to 1 step",
        );
        const run = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-run',
        ) as HTMLElement;
        const runR = run.getBoundingClientRect();
        // The CENTER of the 1-step note: the tap law must own it under real
        // pointers (the old 10px zone covered it → a no-op resize armed).
        await trustedClick(anchor);
        await waitFor(
          () => bassNotes().length === 0,
          4000,
          "trusted center click removes the 1-step note",
        );
        // The cell just RIGHT of where the note was: a plain cell press
        // again (the old overhang swallowed it into a resize).
        expect(runR.width).toBeGreaterThan(0); // geometry sanity
        const nextCell = cellAt("bass", 0, 3);
        const aud0 = auditions.filter((a) => a.lane === "bass").length;
        await trustedClick(nextCell);
        await waitFor(
          () =>
            bassNotes().length === 1 &&
            bassNotes()[0]!.start === 3 &&
            bassNotes()[0]!.length === 2,
          4000,
          "trusted next-cell click places (no overhang swallow)",
        );
        expect(auditions.filter((a) => a.lane === "bass").length).toBe(
          aud0 + 1,
        );

        // --- 3. RAPID RE-PRESS DURING COMMIT --------------------------------
        // Two fast trusted presses on separate empty cells: each activates
        // exactly once (suppression eats only trailing CLICKS, never the
        // next press's pointerup activation).
        await trustedClick(cellAt("bass", 0, 10));
        await trustedClick(cellAt("bass", 0, 13));
        await waitFor(
          () =>
            bassNotes().some((n) => n.start === 10) &&
            bassNotes().some((n) => n.start === 13),
          4000,
          "rapid re-press: both notes placed exactly once",
        );
        expect(
          bassNotes().filter((n) => n.start === 10 || n.start === 13).length,
        ).toBe(2);
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
