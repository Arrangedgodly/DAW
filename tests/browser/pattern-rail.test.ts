/**
 * BC-1 browser gate (I3-a — keyboard.md v3 §"Rail `+` = new blank clip"):
 * the rail `+` creates a NEW blank next-letter pattern (1 bar), appended to
 * the lane's chain + selected + immediately editable, announced
 * `PATTERN <L> CREATED · 1 BAR · APPENDED` through the lane's rail status
 * region (E11). DUP (PAT menu + global `d`) is unchanged and the ONLY
 * duplication path. One Ctrl+Z reverts the create+append as ONE step (the
 * recorded undo decision — store.appendBlankPattern single commit).
 *
 * Both trigger shapes are covered: the row's `+` button (click — focus
 * stays on the button, a mid-tweak is never yanked) and the rail-local
 * `+`/`=` key on a focused tile (focus lands on the NEW tile — the DA-3
 * focus-after-edit law). The E11 wording law is pinned too: the control's
 * accessible name + the rail.append registry entry say NEW, and no
 * duplication-by-`+` wording survives.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getHelp } from "../../src/help/registry";
import { createDemoProject } from "../../src/document/demoSong";
import { docStore } from "../../src/state/store";
import { activePatterns, selectLane } from "../../src/state/selection";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// Token sheet exactly as deployed (the DA-3-fix axe-gate precedent).
import "../../src/styles/base.css";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  // App is itself a () => JSX.Element, so no JSX syntax is needed here
  // (keeps this gate a plain .ts file).
  const dispose = render(App, host);
  return {
    host,
    cleanup: () => {
      dispose();
      host.remove();
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

function key(el: Element, k: string, opts: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
}

describe("BC-1 rail + = new blank clip (real app)", () => {
  it(
    "+ creates a new blank next-letter pattern, appended + selected + announced; DUP the only duplicator; one undo step",
    { timeout: 60_000 },
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

        // Deterministic content: the DEMO (bass pool A–D, chain of 4).
        await import("../../src/state/store").then(({ loadDocument }) =>
          loadDocument(createDemoProject()),
        );
        selectLane("bass");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              // RC-1 journey delta: windowed names append the ROWS range.
              ?.getAttribute("aria-label")
              ?.startsWith("BASS grid · EDITING") === true,
          4000,
          "bass quadrant editable (demo loaded)",
        );

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const tiles = (): HTMLElement[] =>
          Array.from(
            host.querySelectorAll<HTMLElement>(
              '.rail-row[data-lane="bass"] .rail-tile',
            ),
          );
        const poolSize = () => docStore.getState().doc.patterns.bass.length;
        const chainLen = () => docStore.getState().doc.songChain.bass.length;
        /** The lane's rail status region (the E11 announcement target). */
        const announce = (): string =>
          host
            .querySelector<HTMLSpanElement>(
              '.rail-row[data-lane="bass"] > .head-sr[role="status"]',
            )
            ?.textContent?.trim() ?? "";
        const bassFloor = () =>
          host.querySelector('.lane-floor[data-lane="bass"]')!;

        // --- 1. E11 WORDING: the control says NEW, never duplicate-by-+ ----
        const plus = $<HTMLButtonElement>(
          '.rail-row[data-lane="bass"] .rail-append',
        );
        expect(plus.getAttribute("aria-label")).toBe(
          "Append new blank pattern to BASS chain",
        );
        const helpText = getHelp("rail.append")!.text;
        expect(helpText, "registry entry says NEW").toContain("NEW blank");
        expect(
          helpText,
          "no stale duplication-by-+ wording survives (E11 — the v2 entry said 'another slot playing the lane's selected pattern')",
        ).not.toContain("slot playing");
        expect(helpText).toContain("only duplicator");

        // --- 2. BUTTON PATH: click + → new blank E, appended + selected ----
        expect(poolSize()).toBe(4);
        plus.click();
        await waitFor(() => chainLen() === 5, 3000, "chain gains the new slot");
        expect(poolSize()).toBe(5);
        const newTile = tiles()[4]!;
        expect(
          newTile.querySelector(".rail-tile-name")?.textContent,
          "next-letter label",
        ).toBe("E");
        expect(newTile.querySelector(".rail-tile-bars")?.textContent).toBe(
          "1B",
        );
        // Selection flipped to the blank (the tile carries the selected
        // state; the editing selection IS the new pattern id).
        await waitFor(
          () => newTile.dataset.state === "selected",
          2000,
          "new tile selected",
        );
        const createdId = docStore.getState().doc.songChain.bass[4]!;
        expect(activePatterns().bass).toBe(createdId);
        expect(
          docStore.getState().doc.patterns.bass.find((p) => p.id === createdId)
            ?.name,
        ).toBe("E");
        // E11: the creation announcement rides the lane's rail status region.
        await waitFor(
          () => announce() === "PATTERN E CREATED · 1 BAR · APPENDED",
          2000,
          "creation announcement",
        );
        // The button path moves NO focus (spec: native click keeps focus —
        // a mid-tweak is never yanked; only the KEY path lands on the tile).
        expect(document.activeElement).not.toBe(newTile);

        // --- 3. ONE UNDO STEP: create + append co-revert --------------------
        key(document.body, "z", { ctrlKey: true });
        await waitFor(
          () => chainLen() === 4 && poolSize() === 4,
          2000,
          "one Ctrl+Z reverts create+append together",
        );

        // --- 4. IMMEDIATELY EDITABLE: the grid remounts to the blank --------
        // (Make the current selection 4-bar first, so the blank's 1-bar
        // extent is an observable flip: PAT menu → +4B → selected 4-bar.)
        $<HTMLButtonElement>(
          '.rail-row[data-lane="bass"] .rail-tools-trigger',
        ).click();
        await waitFor(
          () =>
            host.querySelector(
              '.rail-row[data-lane="bass"] button[aria-label="Add 4-bar pattern to BASS"]',
            ) !== null,
          2000,
          "PAT menu open",
        );
        $<HTMLButtonElement>(
          '.rail-row[data-lane="bass"] button[aria-label="Add 4-bar pattern to BASS"]',
        ).click();
        const rowCount = () =>
          bassFloor().querySelectorAll(".grid-row").length;
        await waitFor(
          () =>
            bassFloor().querySelectorAll(".cell").length ===
            rowCount() * 64,
          4000,
          "4-bar grid rendered (64 steps per row)",
        );
        // …now the blank flips the extent back to one bar.
        plus.click();
        await waitFor(
          () =>
            chainLen() === 5 &&
            bassFloor().querySelectorAll(".cell").length === rowCount() * 16,
          4000,
          "grid remounts to the 1-bar blank (extent follows selection)",
        );
        // Editing lands IN the new blank pattern, not the old selection.
        const blankId = docStore.getState().doc.songChain.bass[4]!;
        expect(activePatterns().bass).toBe(blankId);
        const firstCell = bassFloor().querySelector<HTMLElement>(".cell")!;
        firstCell.click();
        await waitFor(
          () =>
            (docStore.getState().doc.patterns.bass.find((p) => p.id === blankId)
              ?.kind === "pitched" &&
              (
                docStore.getState().doc.patterns.bass.find(
                  (p) => p.id === blankId,
                ) as { notes: unknown[] }
              ).notes.length > 0),
          2000,
          "a painted cell lands inside the new blank pattern",
        );

        // --- 5. KEY PATH: + on a focused tile → focus lands on the new tile -
        const lastTile = tiles()[tiles().length - 1]!;
        lastTile.focus();
        key(lastTile, "+");
        await waitFor(() => chainLen() === 6, 3000, "key + appends the blank");
        // Pool: demo A–D, the 4-bar E, the blank F (button), the blank G (key).
        expect(poolSize()).toBe(7);
        const keyTile = tiles()[5]!;
        expect(keyTile.querySelector(".rail-tile-name")?.textContent).toBe(
          "G",
        );
        await waitFor(
          () => announce() === "PATTERN G CREATED · 1 BAR · APPENDED",
          2000,
          "key-path creation announcement",
        );
        // DA-3 focus-after-edit law: focus lands on the NEW tile.
        expect(document.activeElement).toBe(keyTile);

        // --- 6. DUP UNCHANGED — the ONLY duplicator -------------------------
        const chainBeforeDup = chainLen();
        const poolBeforeDup = poolSize();
        key(document.body, "d"); // the global twin
        await waitFor(
          () => poolSize() === poolBeforeDup + 1,
          2000,
          "global d duplicates the selected pattern into the pool",
        );
        expect(chainLen()).toBe(chainBeforeDup); // duplication never chains
        expect(
          docStore.getState().doc.patterns.bass.find(
            (p) => p.id === activePatterns().bass,
          )?.name,
          "the copy is selected, named after its source",
        ).toMatch(/\+$/);
        // …and the PAT-menu twin behaves identically.
        $<HTMLButtonElement>(
          '.rail-row[data-lane="bass"] .rail-tools-trigger',
        ).click();
        await waitFor(
          () =>
            host.querySelector(
              '.rail-row[data-lane="bass"] button[aria-label="Duplicate BASS selected pattern"]',
            ) !== null,
          2000,
          "PAT menu open for DUP",
        );
        const poolBeforeMenuDup = poolSize();
        $<HTMLButtonElement>(
          '.rail-row[data-lane="bass"] button[aria-label="Duplicate BASS selected pattern"]',
        ).click();
        await waitFor(
          () => poolSize() === poolBeforeMenuDup + 1,
          2000,
          "menu DUP duplicates too",
        );
        expect(chainLen()).toBe(chainBeforeDup);
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
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
          /* best-effort restore; the wiping suites clean the origin anyway */
        }
      }
    },
  );
});
