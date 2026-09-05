/**
 * LL-1 browser gate (i3-4 — keyboard.md v3 §"Pattern resize"): pattern
 * LENGTH is the only length control — the powers-of-two ladder
 * 1·2·4·8·16·32·64·128 through BOTH the global `b`/Shift+`b` keys and the
 * PAT menu's LENGTH stepper (which owns its lifecycle inside the popover).
 *
 * Laws pinned (the plan's AC + the KL-1 spec):
 * - grow ALWAYS proceeds; the grid REMOUNTS at the new extent (the G9 law)
 *   and announces `PATTERN <L> · <n> BARS` through the lane's rail status
 *   region (E10);
 * - shrink REFUSES BY DEFAULT when any note would be lost past the new end:
 *   the exact refusal text names the blocking note; the store is untouched;
 *   after the note moves, the shrink proceeds;
 * - the ladder limits are no-ops that still announce (… · AT LIMIT);
 * - ONE Ctrl+Z reverts a rapid ladder burst (the resize coalescing family);
 * - FOCUS CARRY through the remount: focus in the grid lands on the carried
 *   cell (same row, step clamped to the new extent); `b` from outside the
 *   grid never yanks focus (the no-yank law);
 * - beyond the v0.1 4-bar maximum the grid renders through the STICKY-LAYER
 *   COLUMN WINDOW (LP-1 §10a): DOM cells stay window-bounded while the
 *   scroll extent stays pattern-wide.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { createDemoProject } from "../../src/document/demoSong";
import {
  addNote,
  docStore,
  loadDocument,
  removeNote,
  undo,
} from "../../src/state/store";
import { activePatterns, selectLane } from "../../src/state/selection";
import { requestCellFocus } from "../../src/state/gridFocus";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// Token sheet exactly as deployed (the DA-3-fix axe-gate precedent).
import "../../src/styles/base.css";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
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

/** Shift+`b` — the ladder's shrink direction (the event must CARRY shift). */
function shrinkKey(): void {
  key(document.body, "B", { shiftKey: true });
}

async function snapshotDb(): Promise<{
  db: ProjectDb;
  rows: Awaited<ReturnType<ProjectDb["allRecords"]>>;
} | null> {
  try {
    const db = await openRawProjectDb("bitbounce");
    return { db, rows: await db.allRecords() };
  } catch {
    return null;
  }
}

async function restoreDb(
  snap: Awaited<ReturnType<typeof snapshotDb>>,
): Promise<void> {
  if (!snap) return;
  try {
    const ids = new Set(snap.rows.map((r) => r.id));
    const current = await snap.db.allRecords();
    for (const row of snap.rows) await snap.db.putRecord(row);
    for (const row of current)
      if (!ids.has(row.id)) await snap.db.deleteRecord(row.id);
  } catch {
    /* best-effort restore */
  }
}

describe("LL-1 pattern LENGTH ladder (real app)", () => {
  it(
    "b/Shift+b walk the ladder with E10 announcements; grid remounts at the new extent; limits announce; one undo reverts the burst; the no-yank law holds",
    { timeout: 90_000 },
    async () => {
      const { host, cleanup } = mount();
      const snap = await snapshotDb();
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        loadDocument(createDemoProject());
        selectLane("bass");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
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
        const selected = () => {
          const id = activePatterns().bass;
          return docStore.getState().doc.patterns.bass.find(
            (p) => p.id === id,
          )!;
        };
        const bars = () => selected().bars as number;
        const bassFloor = () =>
          $<HTMLElement>('.lane-floor[data-lane="bass"]');
        const rowCount = () =>
          bassFloor().querySelectorAll(".grid-row").length;
        const cellsPerRow = () =>
          bassFloor().querySelectorAll(".cell").length / rowCount();
        /** The lane's rail status region (the E10 target). */
        const announce = (): string =>
          host
            .querySelector<HTMLSpanElement>(
              '.rail-row[data-lane="bass"] > .head-sr[role="status"]',
            )
            ?.textContent ?? "";

        // --- 1. The ladder: 1→2→4 with announcements + extent remounts ----
        key(document.body, "b");
        await waitFor(() => bars() === 2, 2000, "b grows 1→2");
        await waitFor(
          () => announce() === "PATTERN A · 2 BARS",
          2000,
          "E10 success announcement",
        );
        await waitFor(
          () => cellsPerRow() === 32,
          4000,
          "grid remounts at the 2-bar extent (32 columns)",
        );
        key(document.body, "b");
        await waitFor(() => bars() === 4, 2000, "b grows 2→4");
        await waitFor(
          () => cellsPerRow() === 64,
          4000,
          "grid remounts at the 4-bar extent (64 columns)",
        );
        // The tile badge carries the length.
        expect(
          $('.rail-row[data-lane="bass"] .rail-tile .rail-tile-bars')
            .textContent,
        ).toBe("4B");

        // --- 2. The no-yank law: `b` from outside the grid moves no focus --
        expect(document.activeElement).toBe(document.body);

        // --- 3. ONE Ctrl+Z reverts the rapid burst (resize family) ------------
        // The whole ladder ran inside the 350 ms coalescing window (the
        // store flips synchronously per press), so ONE undo must return to
        // the gesture's baseline — the KL-1 discrete-commit precedent.
        key(document.body, "b"); // 4→8: the first VIRTUALIZED extent
        key(document.body, "b"); // 8→16
        await waitFor(() => bars() === 16, 2000, "the rapid burst lands");
        await waitFor(
          () =>
            bassFloor().querySelectorAll(".cell").length <
            rowCount() * 256,
          4000,
          "the 16-bar grid renders windowed (cells ≪ eager)",
        );
        undo();
        await waitFor(
          () => bars() === 1,
          2000,
          "one undo reverts the whole ladder burst to its baseline",
        );
        await waitFor(
          () => cellsPerRow() === 16,
          4000,
          "extent restored (eager 1-bar grid)",
        );

        // --- 4. The limits: no-ops that still announce ---------------------
        for (let i = 0; i < 7; i++) key(document.body, "b"); // 1→128
        await waitFor(() => bars() === 128, 4000, "ladder reaches 128");
        key(document.body, "b");
        await waitFor(
          () => announce() === "PATTERN A · 128 BARS · AT LIMIT",
          2000,
          "top limit announcement",
        );
        expect(bars()).toBe(128);
        // Back down to 1 (all clean — the demo notes live in bar 1)…
        for (let i = 0; i < 7; i++) shrinkKey();
        await waitFor(() => bars() === 1, 4000, "Shift+b walks back to 1");
        shrinkKey();
        await waitFor(
          () => announce() === "PATTERN A · 1 BAR · AT LIMIT",
          2000,
          "bottom limit announcement",
        );
        expect(bars()).toBe(1);
      } finally {
        cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "PAT menu LENGTH stepper: own lifecycle (stays open), value span, pointer twin announcements; lossy shrink REFUSES with the exact E10 text, clean shrink proceeds",
    { timeout: 90_000 },
    async () => {
      const { host, cleanup } = mount();
      const snap = await snapshotDb();
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        loadDocument(createDemoProject());
        selectLane("bass");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
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
        const selected = () => {
          const id = activePatterns().bass;
          return docStore.getState().doc.patterns.bass.find(
            (p) => p.id === id,
          )!;
        };
        const bars = () => selected().bars as number;
        const announce = (): string =>
          host
            .querySelector<HTMLSpanElement>(
              '.rail-row[data-lane="bass"] > .head-sr[role="status"]',
            )
            ?.textContent ?? "";
        const menuOpen = () =>
          host.querySelector('.rail-row[data-lane="bass"] .rail-tools-menu') !==
          null;

        // --- 1. The stepper owns its lifecycle ------------------------------
        $<HTMLElement>('.rail-row[data-lane="bass"] .rail-tools-trigger').click();
        await waitFor(menuOpen, 2000, "PAT menu open");
        const grow = () =>
          $<HTMLButtonElement>(
            '.rail-row[data-lane="bass"] button[aria-label^="Grow BASS selected pattern"]',
          );
        const shrink = () =>
          $<HTMLButtonElement>(
            '.rail-row[data-lane="bass"] button[aria-label^="Shrink BASS selected pattern"]',
          );
        grow().click();
        await waitFor(() => bars() === 2, 2000, "LENGTH + grows 1→2");
        await waitFor(menuOpen, 500, "menu STAYS OPEN across presses (own lifecycle)");
        expect(
          $<HTMLElement>('.rail-row[data-lane="bass"] .rail-length-value')
            .textContent,
        ).toBe("LENGTH 2 BARS");
        await waitFor(
          () => announce() === "PATTERN A · 2 BARS",
          2000,
          "pointer-twin announcement (E5 parity)",
        );
        // Escape closes with focus returned to the trigger (popover law).
        $<HTMLElement>(".rail-tools-menu").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(() => !menuOpen(), 2000, "Escape closes the menu");

        // --- 2. REFUSE-BY-DEFAULT: a note past the new end blocks ----------
        // Grow to 8 bars, plant a note at bar 5, then try to shrink to 4.
        const id = selected().id;
        for (let i = 0; i < 2; i++) key(document.body, "b");
        await waitFor(() => bars() === 8, 2000, "grown to 8 bars");
        expect(
          addNote("bass", id, { degree: 0, start: 64, length: 4 }),
        ).toBe(true);
        shrinkKey(); // 8→4: must REFUSE
        await waitFor(
          () =>
            announce() ===
            "CANNOT SHRINK PATTERN A TO 4 BARS · C NOTE AT BAR 5 WOULD BE LOST · MOVE OR SHORTEN IT FIRST",
          2000,
          "the exact E10 refusal names the blocking note",
        );
        expect(bars()).toBe(8); // store untouched
        // Every path produces the SAME text (the stepper twin).
        $<HTMLElement>('.rail-row[data-lane="bass"] .rail-tools-trigger').click();
        await waitFor(menuOpen, 2000, "PAT menu open (refusal twin)");
        shrink().click();
        await waitFor(
          () =>
            announce() ===
            "CANNOT SHRINK PATTERN A TO 4 BARS · C NOTE AT BAR 5 WOULD BE LOST · MOVE OR SHORTEN IT FIRST",
          2000,
          "the stepper refuses with the identical text (one funnel)",
        );
        expect(bars()).toBe(8);
        // Move the note first — then the shrink proceeds.
        expect(removeNote("bass", id, 0, 64)).toBe(true);
        shrinkKey();
        await waitFor(() => bars() === 4, 2000, "clean shrink proceeds");
        await waitFor(
          () => announce() === "PATTERN A · 4 BARS",
          2000,
          "clean-shrink success announcement",
        );
      } finally {
        cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "focus carry through the resize remount (same row, step clamped to the new extent); the windowed grid keeps a pattern-wide scroll extent",
    { timeout: 90_000 },
    async () => {
      const { host, cleanup } = mount();
      const snap = await snapshotDb();
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        loadDocument(createDemoProject());
        selectLane("bass");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
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
        const selected = () => {
          const id = activePatterns().bass;
          return docStore.getState().doc.patterns.bass.find(
            (p) => p.id === id,
          )!;
        };
        const bars = () => selected().bars as number;
        const bassFloor = () =>
          $<HTMLElement>('.lane-floor[data-lane="bass"]');

        // Grow to 8 bars (the virtualized extent) and land focus on a cell
        // far past the 4-bar space.
        for (let i = 0; i < 3; i++) key(document.body, "b");
        await waitFor(() => bars() === 8, 2000, "grown to 8 bars");
        requestCellFocus("bass", 2, 100);
        await waitFor(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.classList.contains("cell") &&
            document.activeElement.dataset.step === "100",
          4000,
          "focus lands on step 100 (the window re-seats)",
        );
        // Grow with focus INSIDE: the carried cell keeps its position.
        key(document.body, "b");
        await waitFor(() => bars() === 16, 2000, "grown to 16 bars");
        await waitFor(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.dataset.step === "100" &&
            document.activeElement.dataset.row === "2",
          4000,
          "grow carries the focused cell (same row + step)",
        );
        // Shrink past the focused step: the carry CLAMPS to the new last
        // step (the v0 carry-clamp law through the remount).
        for (let i = 0; i < 3; i++) shrinkKey(); // 16→2
        await waitFor(() => bars() === 2, 2000, "shrunk to 2 bars");
        await waitFor(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.classList.contains("cell") &&
            document.activeElement.dataset.step === "31",
          4000,
          "the carried focus clamps to the new extent's last step",
        );

        // The virtualization law at the 128-bar extreme: DOM cells stay
        // window-bounded while the scroll extent stays pattern-wide.
        for (let i = 0; i < 6; i++) key(document.body, "b"); // 2→128
        await waitFor(() => bars() === 128, 4000, "ladder reaches 128");
        await waitFor(
          () =>
            bassFloor().querySelectorAll(".cell").length > 0 &&
            bassFloor().querySelector(".grid-col-layer") !== null,
          4000,
          "the windowed grid mounts (sticky layer present)",
        );
        const rows = bassFloor().querySelectorAll(".grid-row").length;
        const cells = bassFloor().querySelectorAll(".cell").length;
        expect(cells).toBeLessThan(rows * 2048); // never the eager census
        // The split horizontal scroller carries the pattern-wide extent
        // (2048 steps × 17 px + label ≈ 34.9k px — the sizer's law).
        const hscroll = bassFloor().querySelector<HTMLElement>(
          ".lane-grid-scroll .grid-hscroll",
        )!;
        expect(hscroll).toBeTruthy();
        expect(hscroll.scrollWidth).toBeGreaterThan(30_000);
      } finally {
        cleanup();
        await restoreDb(snap);
      }
    },
  );
});
