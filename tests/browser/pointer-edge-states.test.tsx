import { pitchDomain } from "../../src/document/pitchWindow";
import { rowForDegree } from "./pitch-fixture";
/**
 * IN-4 gate — the POINTER EDGE-STATE TABLE + migration-fallback UX +
 * view-only quadrant extremes, on the real app (iteration-2 AC #4).
 *
 * EDGE-STATE TABLE (spec'd in-task; every row = setup → perturbation → law).
 * The invariant under EVERY row: no stuck previews, no partial commits, no
 * leaked pointer capture, no corrupted undo history.
 *
 * | # | Edge state                                | Law                              |
 * |---|-------------------------------------------|----------------------------------|
 * | 1 | pointercancel during create-drag          | preview cleared, 0 commits, 0    |
 * |   |                                           | history entries                  |
 * | 2 | pointercancel during edge-resize          | bar geometry restored, 0 commits |
 * | 3 | pointercancel during drums paint          | preview cleared, 0 commits, 0    |
 * |   |                                           | auditions                        |
 * | 4 | pointercancel during tap (covered cell)   | note untouched (no activation)   |
 * | 5 | stray late move/up AFTER a cancel         | still nothing (gesture is null)  |
 * | 6 | pointerup outside the window/grid         | moved create COMMITS (capture    |
 * |   |                                           | law); unmoved release outside    |
 * |   |                                           | NEVER activates (click parity)   |
 * | 7 | down on one cell + up on another         | no activation (release hit-test) |
 * | 8 | second pointer mid-gesture (finger/pen)   | ignored entirely; the first      |
 * |   |                                           | pointer's release commits ONCE   |
 * | 9 | quadrant scroll initiated during a drag   | moves re-hit-test by the CURRENT |
 * |   |                                           | rect — the note spans what the   |
 * |   |                                           | pointer covered on screen        |
 * |10 | contextmenu during a gesture              | suppressed (the gesture owns the |
 * |   |                                           | pointer); idle contextmenu free  |
 * |11 | mode flip mid-gesture (quadrant select /  | gesture COMPLETES cleanly (armed |
 * |   | the HP-1 help-mode contract)              | while editable); never a stuck   |
 * |   |                                           | preview                          |
 * |12 | external document sync mid-gesture        | gesture CANCELS cleanly; nothing |
 * |   |                                           | committed from it                |
 * |13 | rapid re-press during/after commit        | each press activates exactly     |
 * |   |                                           | once; suppression never eats a   |
 * |   |                                           | later genuine click              |
 * |14 | rail sweep: contextmenu mid-sweep         | suppressed; idle rail menu free  |
 * |15 | rail sweep: second pointer mid-sweep      | ignored; commit follows the      |
 * |   |                                           | sweep pointer's last-touched tile|
 *
 * Real-pointer rows that synthetic events cannot express (capture, trusted
 * focus races, the honest note-edge hit geometry under real pointers) live
 * in the companion trusted gate:
 * tests/browser/pointer-edge-states-trusted.test.tsx.
 *
 * MIGRATION-FALLBACK UX (SC-1 typed MigrationError through the REAL user
 * paths): an unmigratable v1 FILE surfaces a clear, actionable, dismissible
 * error with the project untouched and no partial state (no row, no store
 * swap), and the recovery path (a subsequent valid import) works; an
 * unmigratable v1 INDEXEDDB ROW at boot is quarantined (bytes kept, RECOVER
 * action offered) with a fresh project loaded — clear error + recovery, v0
 * law.
 *
 * VIEW-ONLY QUADRANT EXTREMES (LY-1): 4-bar max-density patterns render in
 * view-only quadrants with scroll-within-quadrant at 1440×900 AND below; a
 * 128-step (schema max) note renders overhanging the pattern end; the
 * playhead runs live in view-only grids; the note-edge resize zone is
 * honest (never overhangs the bar, never covers a 1-step note's center —
 * the IN-2 verifier finding).
 */

import { describe, expect, it } from "vitest";
import { showPhonePage } from "../../src/state/phonePage";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import Projects from "../../src/components/Projects";
import Toasts from "../../src/components/Toasts";
import {
  addPattern,
  appendChainSlot,
  createFreshProjectDocument,
  docStore,
  loadDocument,
  setLaneChain,
} from "../../src/state/store";
import { activePatterns, selectLane } from "../../src/state/selection";
import { setHelpMode } from "../../src/state/helpMode";
import { getSession } from "../../src/engine/session";
import { clearToasts } from "../../src/state/toasts";
import { getAutosaveController, initPersistence } from "../../src/persist/boot";
import {
  makeRecord,
  openRawProjectDb,
  type ProjectDb,
} from "../../src/persist/db";
import { createDefaultProject } from "../../src/document/schema";
import type { ProjectDocument } from "../../src/document/schema";

// ---------------------------------------------------------------------------
// Shared helpers (drag-notes precedents)
// ---------------------------------------------------------------------------

function mountApp(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
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

function pe(
  el: Element,
  type: string,
  x: number,
  y: number,
  pointerId = 7,
): boolean {
  return el.dispatchEvent(
    new PointerEvent(type, {
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }),
  );
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function cellAt(lane: string, row: number, step: number): HTMLElement {
  const cell = document.querySelector(
    `.lane-floor[data-lane="${lane}"] .cell[data-row="${rowForDegree(lane, row)}"][data-step="${step}"]`,
  );
  if (!cell) throw new Error(`missing ${lane} cell ${row}:${step}`);
  return cell as HTMLElement;
}

function bassNotes() {
  const p = docStore.getState().doc.patterns.bass[0];
  if (p?.kind !== "pitched") throw new Error("expected pitched bass pattern");
  return p.notes;
}

const gridLabel = (lane: string) =>
  document
    .querySelector(`.lane-floor[data-lane="${lane}"] [role="grid"]`)
    ?.getAttribute("aria-label");

// RC-1 (journey delta, equal-window default): a WINDOWED pitched grid's
// accessible name appends `· ROWS a–b OF n` (E9) — gate on the edit-state
// PREFIX; drums/chords names stay exact (they never window).
const waitEditable = (lane: string, label: string) =>
  waitFor(
    () => gridLabel(lane)?.startsWith(label) === true,
    4000,
    `${lane} quadrant ${label}`,
  );

/** Rows of the lane's first pitched pattern, with the scroll container. */
function quadrantScroll(lane: string): HTMLElement {
  const el = document.querySelector(
    `.lane-floor[data-lane="${lane}"] .lane-grid-scroll`,
  );
  if (!el) throw new Error(`missing ${lane} scroll container`);
  return el as HTMLElement;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** A v1 document whose bass cells cannot be faithfully migrated (cell 3). */
function unmigratableV1Json(name: string): string {
  const base = createDefaultProject();
  const steps = new Array<number>(16).fill(0);
  steps[0] = 3; // not a v1 pitched cell → notesFromRowCells throws
  const bass0 = base.patterns.bass[0]!;
  return JSON.stringify({
    ...base,
    name,
    version: 1,
    patterns: {
      ...base.patterns,
      bass: [{ ...bass0, rows: [{ degree: 0, steps }] }],
    },
  });
}

/**
 * View-only extremes: bass (editable quadrant) carries a 4-bar pattern with
 * content at the far end; lead carries a 4-bar MAX-DENSITY pattern (a note
 * on every step of every row except row 0) plus one 128-step (schema max)
 * note on row 0 that overhangs the pattern end.
 */
function extremesDoc(): ProjectDocument {
  const base = createFreshProjectDocument();
  const bass0 = base.patterns.bass[0] as Extract<Pattern, { kind: "pitched" }>;
  const lead0 = base.patterns.lead[0] as Extract<Pattern, { kind: "pitched" }>;
  const width = 64;
  const bassNotes = Array.from({ length: width / 4 }, (_, i) => ({
    degree: 0,
    start: i * 4,
    length: 2,
  }));
  const degrees = lead0.rowDegrees;
  const denseLead: typeof lead0.notes = [
    { degree: degrees[0]!, start: 0, length: 128 },
  ];
  for (let r = 1; r < degrees.length; r++) {
    for (let s = 0; s < width; s++) {
      denseLead.push({ degree: degrees[r]!, start: s, length: 1 });
    }
  }
  // SV-1: no loopBars key — the transport basis is derived engine-side
  // (min(4, max pattern bars) = 4 for this 4-bar doc, the old value exactly).
  return {
    ...base,
    patterns: {
      ...base.patterns,
      bass: [{ ...bass0, bars: 4, notes: bassNotes }],
      lead: [{ ...lead0, bars: 4, notes: denseLead }],
    },
  };
}

// ===========================================================================
// 1 — the edge-state table (grid + rail)
// ===========================================================================

describe("IN-4 pointer edge states (real app, synthetic pointer events)", () => {
  it(
    "the edge-state table: cancel/up-outside/cross-cell/multi-pointer/scroll/contextmenu/mode-flip/sync/rapid re-press",
    { timeout: 120_000 },
    async () => {
      await page.viewport(1440, 900);
      const { cleanup } = mountApp();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

      const session = getSession();
      const origAudition = session.audition;
      const auditions: Array<{ lane: string }> = [];
      session.audition = (laneId, x) => {
        auditions.push({ lane: laneId });
        return origAudition.call(session, laneId, x);
      };

      const previews = () =>
        document.querySelectorAll(".note-run.is-drag-preview").length;
      const cellPreviews = () =>
        document.querySelectorAll(".cell[data-preview]").length;
      const historyDepth = () => docStore.temporal.getState().pastStates.length;

      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitEditable("bass", "BASS grid · EDITING");
        expect(bassNotes()).toHaveLength(0);

        // -- Row 1: pointercancel during create-drag -----------------------
        const s2 = cellAt("bass", 0, 2);
        const s5 = cellAt("bass", 0, 5);
        const c2 = center(s2);
        const c5 = center(s5);
        const depth0 = historyDepth();
        pe(s2, "pointerdown", c2.x, c2.y);
        pe(s5, "pointermove", c5.x, c5.y);
        expect(previews()).toBe(1);
        expect(cellPreviews()).toBe(4);
        pe(s5, "pointercancel", c5.x, c5.y);
        expect(bassNotes()).toHaveLength(0); // no partial commit
        expect(previews()).toBe(0); // no stuck preview
        expect(cellPreviews()).toBe(0);
        expect(historyDepth()).toBe(depth0); // no history corruption

        // -- Row 5: stray late events AFTER the cancel ----------------------
        pe(s5, "pointermove", c5.x, c5.y);
        pe(s5, "pointerup", c5.x, c5.y);
        expect(bassNotes()).toHaveLength(0);
        expect(previews()).toBe(0);

        // -- Row 6a: moved create released OUTSIDE the grid COMMITS ---------
        const outside = () => {
          const r = quadrantScroll("bass").getBoundingClientRect();
          return { x: r.left - 60, y: r.top - 60 };
        };
        pe(s2, "pointerdown", c2.x, c2.y);
        pe(s5, "pointermove", c5.x, c5.y);
        const o = outside();
        pe(s5, "pointerup", o.x, o.y);
        expect(bassNotes()).toEqual([{ degree: 0, start: 2, length: 4 }]);
        expect(previews()).toBe(0);

        // -- Row 4: pointercancel during tap (covered cell) -----------------
        const anchorCell = cellAt("bass", 0, 2); // the note's anchor
        const ac = center(anchorCell);
        pe(anchorCell, "pointerdown", ac.x, ac.y);
        pe(anchorCell, "pointercancel", ac.x, ac.y);
        expect(bassNotes()).toHaveLength(1); // untouched — cancel never activates

        // -- Row 6b: UNMOVED press released outside NEVER activates ---------
        const s8 = cellAt("bass", 0, 8);
        const c8 = center(s8);
        const aud0 = auditions.length;
        pe(s8, "pointerdown", c8.x, c8.y);
        const o2 = outside();
        pe(s8, "pointerup", o2.x, o2.y);
        expect(bassNotes()).toHaveLength(1); // no phantom gate-default note
        expect(auditions.length).toBe(aud0);

        // -- Row 7: down on one cell + up on another ------------------------
        const s3 = cellAt("bass", 0, 3);
        const c3 = center(s3);
        pe(s3, "pointerdown", c3.x, c3.y); // covered (mid-span of the 4-note)
        pe(s8, "pointerup", c8.x, c8.y); // released over a DIFFERENT cell
        expect(bassNotes()).toEqual([{ degree: 0, start: 2, length: 4 }]); // no trim

        // -- Row 2: pointercancel during edge-resize ------------------------
        const run = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-run',
        ) as HTMLElement;
        const runRect0 = run.getBoundingClientRect().width;
        const edge = run.querySelector(".note-edge") as HTMLElement;
        const ec = { x: run.getBoundingClientRect().right - 1, y: ac.y };
        pe(edge, "pointerdown", ec.x, ec.y);
        const cells0 = cellAt("bass", 0, 0).parentElement as HTMLElement;
        const row0 = cells0.getBoundingClientRect();
        const stepW =
          center(cellAt("bass", 0, 1)).x - center(cellAt("bass", 0, 0)).x;
        pe(cells0, "pointermove", row0.left + 7.5 * stepW, ac.y);
        expect(run.getBoundingClientRect().width).toBeGreaterThan(runRect0); // live preview
        pe(cells0, "pointercancel", row0.left + 7.5 * stepW, ac.y);
        expect(bassNotes()[0]!.length).toBe(4); // unchanged
        // cancelGesture rebuilds the run layer — re-query the committed bar.
        const runAfter = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-run',
        ) as HTMLElement;
        expect(runAfter.getBoundingClientRect().width).toBe(runRect0); // geometry restored

        // -- Row 13: rapid re-press during/after commit ----------------------
        // First press activates via pointerup (unmoved create). Note-length
        // memory: it places at the last DRAG-CREATED length (Row 6a's 4
        // steps), so the follow-up press targets s12 (the s8 note covers
        // s8–s11).
        pe(s8, "pointerdown", c8.x, c8.y);
        pe(s8, "pointerup", c8.x, c8.y);
        expect(bassNotes()).toHaveLength(2);
        expect(bassNotes()).toContainEqual({ degree: 0, start: 8, length: 4 });
        expect(auditions.length).toBe(aud0 + 1); // exactly one audition
        // IMMEDIATE second press (same macrotask — before the suppression
        // timer can fire): pointerup activation must not be eaten by the
        // first gesture's trailing-click suppression.
        const nextCell = cellAt("bass", 0, 12);
        const cNext = center(nextCell);
        pe(nextCell, "pointerdown", cNext.x, cNext.y);
        pe(nextCell, "pointerup", cNext.x, cNext.y);
        expect(bassNotes()).toHaveLength(3);
        expect(auditions.length).toBe(aud0 + 2);
        // After the macrotask, the synthetic click path still works.
        await new Promise((r) => setTimeout(r, 10));
        nextCell.click(); // anchor → remove
        expect(bassNotes()).toHaveLength(2);

        // -- Row 11: mode flip mid-gesture (the HP-1 help-mode contract) ----
        const s12 = cellAt("bass", 0, 12);
        const s14 = cellAt("bass", 0, 14);
        pe(s12, "pointerdown", center(s12).x, center(s12).y);
        pe(s14, "pointermove", center(s14).x, center(s14).y);
        expect(previews()).toBe(1);
        selectLane("drums"); // bass flips VIEW-ONLY mid-gesture
        await waitEditable("bass", "BASS grid · VIEW ONLY");
        expect(previews()).toBe(1); // gesture still owns its preview
        pe(s14, "pointerup", center(s14).x, center(s14).y);
        expect(bassNotes()).toContainEqual({ degree: 0, start: 12, length: 3 });
        expect(previews()).toBe(0); // completed cleanly — no stuck preview

        // -- Row 12: external document sync mid-gesture CANCELS --------------
        loadDocument(createFreshProjectDocument()); // deterministic empty grid
        selectLane("bass");
        await waitEditable("bass", "BASS grid · EDITING");
        const s4 = cellAt("bass", 0, 4);
        const s6 = cellAt("bass", 0, 6);
        pe(s4, "pointerdown", center(s4).x, center(s4).y);
        pe(s6, "pointermove", center(s6).x, center(s6).y);
        expect(previews()).toBe(1);
        const depth1 = historyDepth();
        // An EXTERNAL pattern edit (new patterns.bass identity): undo of a
        // prior edit, autosave restore — any surface writing the same pattern.
        const doc0 = docStore.getState().doc;
        const bass0 = doc0.patterns.bass[0]!;
        loadDocument({
          ...doc0,
          patterns: {
            ...doc0.patterns,
            bass: [{ ...bass0, notes: [{ degree: 1, start: 0, length: 1 }] }],
          },
        });
        await waitFor(() => previews() === 0, 2000, "sync cancels gesture");
        pe(s6, "pointerup", center(s6).x, center(s6).y); // late release: dead
        expect(bassNotes().some((n) => n.start === 4)).toBe(false); // nothing committed from the gesture
        expect(bassNotes()).toEqual([{ degree: 1, start: 0, length: 1 }]); // the external edit landed
        expect(historyDepth()).toBe(depth1 + 1); // exactly the loadDocument entry

        // -- Row 10: contextmenu during a gesture ----------------------------
        const s10 = cellAt("bass", 0, 10);
        pe(s10, "pointerdown", center(s10).x, center(s10).y);
        pe(s12, "pointermove", center(s12).x, center(s12).y);
        const menuDuring = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: center(s12).x,
          clientY: center(s12).y,
        });
        quadrantScroll("bass").dispatchEvent(menuDuring);
        expect(menuDuring.defaultPrevented).toBe(true); // gesture owns the pointer
        pe(s12, "pointerup", center(s12).x, center(s12).y); // still completes
        expect(bassNotes().some((n) => n.start === 10)).toBe(true);
        // Idle: the native menu is untouched.
        const menuIdle = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        quadrantScroll("bass").dispatchEvent(menuIdle);
        expect(menuIdle.defaultPrevented).toBe(false);

        // -- Row 9: quadrant scroll initiated during a drag ------------------
        // (needs the 4-bar pattern: the fresh 1-bar grid cannot scroll)
        loadDocument(extremesDoc());
        selectLane("bass");
        await waitFor(
          () => cellAt("bass", 0, 60) !== null,
          4000,
          "4-bar bass grid mounted",
        );
        const scroll = quadrantScroll("bass");
        await waitFor(
          () => scroll.scrollWidth > scroll.clientWidth,
          4000,
          "bass quadrant scrollable",
        );
        const t2 = cellAt("bass", 0, 2);
        const t30 = cellAt("bass", 0, 30);
        const pressAt = center(t2);
        const targetX = center(t30).x;
        pe(t2, "pointerdown", pressAt.x, pressAt.y);
        scroll.scrollLeft = 240; // the quadrant scrolls UNDER the held pointer
        const rectAfter = (
          cellAt("bass", 0, 0).parentElement as HTMLElement
        ).getBoundingClientRect();
        const expectedEnd = Math.floor((targetX - rectAfter.left) / stepW);
        pe(t30, "pointermove", targetX, pressAt.y);
        pe(t30, "pointerup", targetX, pressAt.y);
        const dragged = bassNotes().find((n) => n.start === 2);
        expect(dragged, "scroll-mid-drag note committed").toBeTruthy();
        expect(dragged!.length).toBe(expectedEnd - 2 + 1);

        // -- Rows 3: pointercancel during drums paint ------------------------
        selectLane("drums");
        await waitEditable("drums", "DRUMS grid · EDITING");
        const d0 = cellAt("drums", 0, 0);
        const d3 = cellAt("drums", 0, 3);
        const aud1 = auditions.length;
        pe(d0, "pointerdown", center(d0).x, center(d0).y);
        pe(d3, "pointermove", center(d3).x, center(d3).y);
        expect(cellPreviews()).toBe(4);
        pe(d3, "pointercancel", center(d3).x, center(d3).y);
        const drums0 = docStore.getState().doc.patterns.drums[0];
        expect(
          drums0?.kind === "drums" && drums0.steps.kick.every((s) => !s),
          "paint cancelled: nothing on",
        ).toBe(true);
        expect(cellPreviews()).toBe(0);
        expect(auditions.length).toBe(aud1); // zero auditions from a cancelled paint

        // -- Row 8: second pointer mid-gesture (multi-pointer) ---------------
        // (steps past the row-9 dragged note's span AND off the every-4th
        // gate notes: 50..54 are free on the 4-bar bass grid)
        selectLane("bass");
        await waitEditable("bass", "BASS grid · EDITING");
        const m50 = cellAt("bass", 0, 50);
        const m54 = cellAt("bass", 0, 54);
        const m58 = cellAt("bass", 0, 58);
        const beforeMulti = bassNotes().length;
        pe(m50, "pointerdown", center(m50).x, center(m50).y, 7);
        pe(m54, "pointermove", center(m54).x, center(m54).y, 7);
        // A second pointer lives and dies entirely inside the gesture.
        pe(m58, "pointerdown", center(m58).x, center(m58).y, 8);
        pe(m58, "pointermove", center(m58).x, center(m58).y, 8);
        pe(m58, "pointerup", center(m58).x, center(m58).y, 8);
        pe(m58, "pointercancel", center(m58).x, center(m58).y, 8);
        expect(bassNotes().length).toBe(beforeMulti); // nothing from pointer 8
        pe(m58, "pointermove", center(m58).x, center(m58).y, 7);
        pe(m58, "pointerup", center(m58).x, center(m58).y, 7);
        expect(bassNotes().length).toBe(beforeMulti + 1); // exactly one note
        expect(bassNotes().some((n) => n.start === 50)).toBe(true); // the sweep pointer's note

        // Undo integrity through the whole table: the committed gesture
        // reverts with ONE undo (the row-9 drag note may coalesce into the
        // same note-family step when both commits land inside the 350 ms
        // window — the DA-1 rapid-edit law — so assert the note is gone and
        // exactly one history state was popped, not the array length).
        const depthNow = historyDepth();
        const { undo } = await import("../../src/state/store");
        undo();
        expect(bassNotes().some((n) => n.start === 50)).toBe(false); // reverted
        expect(historyDepth()).toBe(depthNow - 1);

        // -- Rows 14/15: rail sweep edge states ------------------------------
        const drumsChain = () => docStore.getState().doc.songChain.drums;
        addPattern("drums", 1, "B"); // drums-2
        setLaneChain("drums", ["drums-1", "drums-2", "drums-1"]);
        appendChainSlot("drums", "drums-2");
        await waitFor(
          () => drumsChain().length === 4,
          2000,
          "rail chain extended",
        );
        const tile = (slot: number): HTMLElement => {
          const tiles = document.querySelectorAll(
            '.rail-row[data-lane="drums"] .rail-tile',
          );
          const el = tiles[slot];
          if (!el) throw new Error(`missing rail tile ${slot}`);
          return el as HTMLElement;
        };
        // 2026-09-11: the chain is its own page on every stage — the rail
        // rows this block sweeps only mount while that page shows.
        showPhonePage("song");
        await waitFor(
          () => document.querySelector(".stage-song .rail") !== null,
          2000,
          "song page rail",
        );
        const rail = document.querySelector(".rail") as HTMLElement;
        // Row 14: idle contextmenu on the rail is free…
        const railMenuIdle = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        rail.dispatchEvent(railMenuIdle);
        expect(railMenuIdle.defaultPrevented).toBe(false);
        // …mid-sweep it is suppressed.
        pe(tile(0), "pointerdown", center(tile(0)).x, center(tile(0)).y, 7);
        pe(tile(1), "pointermove", center(tile(1)).x, center(tile(1)).y, 7);
        const railMenuDuring = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        rail.dispatchEvent(railMenuDuring);
        expect(railMenuDuring.defaultPrevented).toBe(true);
        // Row 15: a second pointer mid-sweep is ignored; the sweep pointer's
        // LAST-touched tile commits.
        pe(tile(3), "pointerdown", center(tile(3)).x, center(tile(3)).y, 8);
        pe(tile(2), "pointermove", center(tile(2)).x, center(tile(2)).y, 8);
        pe(tile(2), "pointerup", center(tile(2)).x, center(tile(2)).y, 8);
        pe(tile(2), "pointermove", center(tile(2)).x, center(tile(2)).y, 7);
        pe(tile(2), "pointerup", center(tile(2)).x, center(tile(2)).y, 7);
        expect(activePatterns().drums).toBe("drums-1"); // last-touched tile 2, not pointer 8's
        expect(
          document.querySelectorAll(".rail-tile[data-cue-preview]"),
        ).toHaveLength(0); // no stuck sweep preview
      } finally {
        // View state is MODULE-LEVEL — never leak SONG into the next test
        // (the help-coverage precedent).
        showPhonePage("edit");
        session.audition = origAudition;
        void import("../../src/engine/session")
          .then(({ getSession: g }) => g().transport.stop?.())
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
    120_000,
  );
});

// ===========================================================================
// 2 — migration-fallback UX (file import + IndexedDB boot)
// ===========================================================================

async function freshDb(name: string): Promise<ProjectDb> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  return openRawProjectDb(name);
}

function setInputFiles(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Wait for the shared Toasts bus to show a role=alert error toast. */
async function errorToast(): Promise<HTMLElement> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const el = document.body.querySelector<HTMLElement>(
      '[role="alert"] .toast',
    );
    if (el) return el;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("error toast never appeared");
}

describe("IN-4 migration-fallback UX (SC-1 typed errors through the real paths)", () => {
  it(
    "unmigratable v1 FILE: clear actionable toast, project untouched, no partial row; recovery import works",
    { timeout: 60_000 },
    async () => {
      const db = await freshDb("bitbounce-in4-import-fallback");
      const host = document.createElement("div");
      document.body.append(host);
      const toastHost = document.createElement("div");
      document.body.append(toastHost);
      const dispose = render(Projects, host);
      const disposeToasts = render(Toasts, toastHost);
      try {
        await initPersistence({ db });
        const before = docStore.getState().doc;
        const rowsBefore = (await db.allRecords()).length;

        const file = new File(
          [unmigratableV1Json("old thing")],
          "old.bitbounce.json",
          {
            type: "application/json",
          },
        );
        const input =
          host.querySelector<HTMLInputElement>('input[type="file"]')!;
        setInputFiles(input, file);

        const toast = await errorToast();
        // Clear, actionable, audience-worded: says it is an OLDER file that
        // could not be migrated, and how to recover.
        expect(toast.textContent).toContain("older version");
        expect(toast.textContent).toContain("could not be migrated cleanly");
        expect(toast.textContent).toContain("Re-export");
        // Project untouched: no store swap, no partial persistence.
        expect(docStore.getState().doc).toBe(before);
        expect(await db.allRecords()).toHaveLength(rowsBefore);
        // Dismissible (role=alert with a real button).
        const dismiss = toast.querySelector("button");
        expect(dismiss).not.toBeNull();
        dismiss!.click();
        await waitFor(
          () => document.body.querySelector('[role="alert"] .toast') === null,
        );

        // Recovery path: a VALID file still imports cleanly afterwards.
        const good = new File(
          [
            JSON.stringify({
              ...createDefaultProject(),
              name: "after the fall",
            }),
          ],
          "good.bitbounce.json",
          { type: "application/json" },
        );
        setInputFiles(input, good);
        await waitFor(
          () => docStore.getState().doc.name === "after the fall (imported)",
        );
        expect(await db.allRecords()).toHaveLength(rowsBefore + 1);
      } finally {
        dispose();
        disposeToasts();
        clearToasts();
        await getAutosaveController()?.stop();
        host.remove();
        toastHost.remove();
      }
    },
    60_000,
  );

  it(
    "unmigratable v1 INDEXEDDB ROW at boot: quarantined (bytes kept + RECOVER), fresh project loads, boot completes",
    { timeout: 60_000 },
    async () => {
      const db = await freshDb("bitbounce-in4-boot-fallback");
      const badJson = unmigratableV1Json("dead row");
      await db.putRecord(
        makeRecord("boot-bad", JSON.parse(badJson), badJson, Date.now(), false),
      );
      const toastHost = document.createElement("div");
      document.body.append(toastHost);
      const disposeToasts = render(Toasts, toastHost);
      try {
        const result = await initPersistence({ db });
        expect(result.quarantined).toBeTruthy();
        expect(result.quarantined!.json).toBe(badJson); // bytes preserved verbatim
        expect(result.restored).toBe(false);

        // The user-facing error: sticky, actionable, recoverable.
        const toast = await errorToast();
        expect(toast.textContent).toContain("damaged");
        expect(toast.textContent).toContain("could not be loaded");
        const recover = [...toast.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("RECOVER"),
        );
        expect(recover).toBeTruthy();

        // The app continued on a FRESH project; the bad row survives only
        // under its quarantine id; autosave targets the fresh row.
        expect(docStore.getState().doc.name).toBe("Untitled");
        const rows = await db.allRecords();
        expect(rows).toHaveLength(2);
        expect(rows.some((r) => r.id === "boot-bad")).toBe(false);
        expect(rows.some((r) => r.id.includes(".corrupt"))).toBe(true);
        expect(getAutosaveController()).not.toBeNull();
      } finally {
        disposeToasts();
        clearToasts();
        await getAutosaveController()?.stop();
        toastHost.remove();
      }
    },
    60_000,
  );
});

// ===========================================================================
// 3 — view-only quadrant extremes + honest hit geometry
// ===========================================================================

describe("IN-4 view-only quadrant extremes (LY-1 scroll-within-quadrant, 128-step notes, playhead)", () => {
  it(
    "4-bar max-density view-only render + scroll at 1440×900 and below; 128-step note; live playhead; honest note-edge geometry",
    { timeout: 120_000 },
    async () => {
      await page.viewport(1440, 900);
      const { cleanup } = mountApp();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(extremesDoc());
        selectLane("bass");
        await waitFor(
          () =>
            gridLabel("lead")?.startsWith("LEAD grid · VIEW ONLY") === true &&
            cellAt("lead", 0, 63) !== null,
          6000,
          "4-bar view-only lead mounted",
        );

        // Max-density render: a run per note (1×128 + 13 rows × 64 steps).
        const leadRuns = document.querySelectorAll(
          '.lane-floor[data-lane="lead"] .note-run',
        );
        const domain = pitchDomain(docStore.getState().doc, "lead");
        const visibleDegrees = new Set(
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '.lane-floor[data-lane="lead"] .grid-row:has(.cell)',
            ),
          ).map(
            (row) =>
              domain.degrees[
                Number(row.querySelector<HTMLElement>(".cell")!.dataset.row)
              ],
          ),
        );
        const pattern = docStore.getState().doc.patterns.lead[0];
        if (pattern?.kind !== "pitched")
          throw new Error("expected pitched lead fixture");
        expect(leadRuns.length).toBe(
          pattern.notes.filter((note) => visibleDegrees.has(note.degree))
            .length,
        );

        // The 128-step (schema max) note renders its full width — overhang
        // past the pattern end is legal (loops wrap).
        const longRun = document.querySelector<HTMLElement>(
          '.lane-floor[data-lane="lead"] .note-run[data-length="128"]',
        )!;
        const leadStepW =
          center(cellAt("lead", 0, 1)).x - center(cellAt("lead", 0, 0)).x;
        expect(longRun.getBoundingClientRect().width).toBeCloseTo(
          128 * leadStepW - 1,
          0,
        );

        // THE FULL UNIT (2026-09-11, user call): every quadrant's pads are
        // pointer-live, so a non-selected quadrant's resize edge is live too
        // (the E2 keyboard half is unchanged: no tab stop there).
        const longEdge = longRun.querySelector(".note-edge") as HTMLElement;
        expect(getComputedStyle(longEdge).pointerEvents).not.toBe("none");

        // Scroll-within-quadrant: the VIEW-ONLY 4-bar quadrant scrolls
        // internally; the page itself never grows a horizontal scrollbar at
        // 1440×900 (the one-page law holds with 4-bar content mounted).
        const leadScroll = quadrantScroll("lead");
        expect(leadScroll.scrollWidth).toBeGreaterThan(leadScroll.clientWidth);
        leadScroll.scrollLeft = 9999;
        expect(leadScroll.scrollLeft).toBeGreaterThan(0);
        expect(leadScroll.scrollLeft).toBe(
          leadScroll.scrollWidth - leadScroll.clientWidth,
        );
        const floors = [...document.querySelectorAll(".lane-floor")];
        expect(floors.length).toBe(4);
        for (const floor of floors) {
          const r = floor.getBoundingClientRect();
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.right).toBeLessThanOrEqual(1440 + 0.5);
        }

        // Playhead runs LIVE in the view-only quadrant (rAF loop alive).
        const leadPlayhead = document.querySelector(
          '.lane-floor[data-lane="lead"] .grid-playhead',
        ) as HTMLElement;
        expect(leadPlayhead.style.opacity).toBe("0");
        const session = getSession();
        session.transport.play();
        await waitFor(
          () => leadPlayhead.style.opacity === "1",
          4000,
          "view-only playhead live",
        );
        session.transport.stop();
        await waitFor(
          () => leadPlayhead.style.opacity === "0",
          4000,
          "view-only playhead parks",
        );

        // BELOW the design viewport (1280×800): the quadrant stays the
        // scroller for the 4-bar content — never the page.
        await page.viewport(1280, 800);
        await new Promise((r) => setTimeout(r, 150)); // reflow settles
        const leadScroll2 = quadrantScroll("lead");
        expect(leadScroll2.scrollWidth).toBeGreaterThan(
          leadScroll2.clientWidth,
        );
        leadScroll2.scrollLeft = 9999;
        expect(leadScroll2.scrollLeft).toBe(
          leadScroll2.scrollWidth - leadScroll2.clientWidth,
        );
        await page.viewport(1440, 900);

        // -- honest note-edge hit geometry (IN-2 verifier finding) ----------
        // A 1-step note in the EDITABLE quadrant: the resize zone never
        // overhangs the bar's right edge and never covers the bar's center.
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitEditable("bass", "BASS grid · EDITING");
        const b2 = cellAt("bass", 0, 2);
        pe(b2, "pointerdown", center(b2).x, center(b2).y);
        pe(b2, "pointerup", center(b2).x, center(b2).y);
        await waitFor(() => bassNotes().length === 1, 2000, "gate note placed");
        b2.focus();
        b2.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "-",
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(bassNotes()[0]!.length).toBe(1); // 1-step note
        const run1 = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-run',
        ) as HTMLElement;
        const edge1 = run1.querySelector(".note-edge") as HTMLElement;
        const runR = run1.getBoundingClientRect();
        const edgeR = edge1.getBoundingClientRect();
        expect(edgeR.right).toBeLessThanOrEqual(runR.right + 0.5); // no overhang
        expect(edgeR.width).toBeLessThanOrEqual(5.5); // honest width
        expect(edgeR.left).toBeGreaterThan(runR.left + runR.width / 2); // center stays tappable

        // The tap law at the note's CENTER removes it (pointerup activation;
        // dispatched on the CELL — the run layer is pointer-events:none, so
        // the real hit target is the cell beneath the bar).
        const mid = {
          x: runR.left + runR.width / 2,
          y: runR.top + runR.height / 2,
        };
        pe(b2, "pointerdown", mid.x, mid.y);
        pe(b2, "pointerup", mid.x, mid.y);
        await waitFor(
          () => bassNotes().length === 0,
          2000,
          "center tap removes",
        );

        // The cell just RIGHT of a 1-step note is a plain cell again: a press
        // there PLACES, never a resize of the neighbor (the old overhang).
        const b3 = cellAt("bass", 0, 3);
        pe(b3, "pointerdown", center(b3).x, center(b3).y);
        pe(b3, "pointerup", center(b3).x, center(b3).y);
        await waitFor(() => bassNotes().length === 1, 2000, "next cell places");
        expect(bassNotes()[0]!.start).toBe(3);
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
          /* best-effort restore */
        }
      }
    },
    120_000,
  );
});

// ===========================================================================
// 4 — MB-4 (mobile slice): the touch EXTENSION of the edge-state table
// (synthetic half — rows dispatch events can express, at the PHONE stage
// 390×844; the trusted-CDP half — touchCancel derivation, two-finger CDP,
// long-press menus, scroll-cancel, rotation — lives in
// tests/browser/mobile-resilience.test.tsx §5/§2 with the CDP harness).
//
// | #  | Touch edge state                              | Law                    |
// |----|-----------------------------------------------|------------------------|
// | T1 | pointercancel (touch) mid create-drag        | preview cleared, 0     |
// |    |                                               | commits, 0 history     |
// | T2 | pointercancel (touch) mid edge-resize        | bar geometry restored  |
// | T3 | pointercancel (touch) mid drums paint        | preview cleared, 0     |
// |    |                                               | commits, 0 auditions   |
// | T4 | pointercancel (touch) mid rail sweep         | no cue commit, no      |
// |    |                                               | stuck sweep preview    |
// | T5 | SECOND touch pointer mid-gesture             | ignored entirely; the  |
// |    |                                               | first commits ONCE     |
// | T6 | MOUSE pointerdown mid TOUCH gesture (hybrid  | ignored; the touch     |
// |    | mouse+touch device)                          | gesture completes once |
// | T7 | help mode ON + tap = inspect AND activate;   | gesture COMPLETES      |
// |    | help toggled MID touch-gesture (HP-1 law     | cleanly; the info      |
// |    | carries over, MB-3's tap model)              | region shows the       |
// |    |                                               | tapped control         |
// ===========================================================================

describe("MB-4 touch edge states (synthetic touch pointers, phone stage)", () => {
  /** One touch-typed pointer event (synthetic — no capture, but the app's
   * container listeners still consume it; `te` mirrors the suite's `pe`). */
  function te(
    el: Element,
    type: string,
    x: number,
    y: number,
    pointerId = 7,
    isPrimary = true,
  ): boolean {
    return el.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: "touch",
        isPrimary,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
    );
  }

  it(
    "touch-typed cancels (create/resize/paint/sweep), second touch, hybrid mouse, help-mode carry-over — the phone stage",
    { timeout: 120_000 },
    async () => {
      await page.viewport(390, 844);
      const { cleanup } = mountApp();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

      const session = getSession();
      const origAudition = session.audition;
      const auditions: Array<{ lane: string }> = [];
      session.audition = (laneId, x) => {
        auditions.push({ lane: laneId });
        return origAudition.call(session, laneId, x);
      };

      const previews = () =>
        document.querySelectorAll(".note-run.is-drag-preview").length;
      const cellPreviews = () =>
        document.querySelectorAll(".cell[data-preview]").length;
      const historyDepth = () => docStore.temporal.getState().pastStates.length;

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
        selectLane("bass");
        await waitFor(
          () => document.querySelector(".lane-floor")?.dataset.lane === "bass",
          3000,
          "bass stage",
        );
        expect(bassNotes()).toHaveLength(0);

        // -- T1: pointercancel (touch) mid create-drag ----------------------
        const s2 = cellAt("bass", 0, 2);
        const s5 = cellAt("bass", 0, 5);
        const c2 = center(s2);
        const c5 = center(s5);
        const depth0 = historyDepth();
        te(s2, "pointerdown", c2.x, c2.y);
        te(s5, "pointermove", c5.x, c5.y);
        expect(previews()).toBe(1);
        expect(cellPreviews()).toBe(4);
        te(s5, "pointercancel", c5.x, c5.y);
        expect(bassNotes()).toHaveLength(0); // no partial commit
        expect(previews()).toBe(0); // no stuck preview
        expect(cellPreviews()).toBe(0);
        expect(historyDepth()).toBe(depth0); // no history corruption
        // Stray late events after the cancel stay dead.
        te(s5, "pointermove", c5.x, c5.y);
        te(s5, "pointerup", c5.x, c5.y);
        expect(bassNotes()).toHaveLength(0);
        expect(previews()).toBe(0);

        // -- T2: pointercancel (touch) mid edge-resize ----------------------
        // Place a 2-step note by touch tap first (unmoved press → gate law).
        te(s2, "pointerdown", c2.x, c2.y);
        te(s2, "pointerup", c2.x, c2.y);
        await waitFor(
          () => bassNotes().length === 1,
          2000,
          "touch tap placed the gate-default note",
        );
        const run = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-run',
        ) as HTMLElement;
        const runRect0 = run.getBoundingClientRect().width;
        const edge = run.querySelector(".note-edge") as HTMLElement;
        const ec = { x: run.getBoundingClientRect().right - 1, y: c2.y };
        te(edge, "pointerdown", ec.x, ec.y);
        const cells0 = cellAt("bass", 0, 0).parentElement as HTMLElement;
        const row0 = cells0.getBoundingClientRect();
        const stepW =
          center(cellAt("bass", 0, 1)).x - center(cellAt("bass", 0, 0)).x;
        te(cells0, "pointermove", row0.left + 5.5 * stepW, c2.y);
        expect(run.getBoundingClientRect().width).toBeGreaterThan(runRect0);
        te(cells0, "pointercancel", row0.left + 5.5 * stepW, c2.y);
        expect(bassNotes()[0]!.length).toBe(2); // unchanged
        const runAfter = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-run',
        ) as HTMLElement;
        expect(runAfter.getBoundingClientRect().width).toBe(runRect0);

        // -- T7a: help mode ON + touch TAP = inspect AND activate (MB-3's
        // tap model): the note is removed by the anchor tap AND the info
        // region shows the tapped grid's entry.
        setHelpMode(true);
        await waitFor(
          () => !!document.querySelector(".info-view"),
          3000,
          "info view mounted",
        );
        te(s2, "pointerdown", c2.x, c2.y);
        te(s2, "pointerup", c2.x, c2.y);
        // Synthetic pointer events derive no click — dispatch the bare click
        // the real touch pipeline would deliver after touchend (the MB-3 tap
        // model's inspect half rides the CLICK observer).
        s2.click();
        await waitFor(
          () => bassNotes().length === 0,
          3000,
          "T7a: the tap activated (anchor removed) while help mode is on",
        );
        await waitFor(
          () =>
            (document.querySelector(".info-view-title")?.textContent ?? "")
              .toUpperCase()
              .includes("BASS GRID"),
          3000,
          "T7a: the same tap inspected (info region shows the grid)",
        );
        setHelpMode(false);

        // -- T7b: help mode toggled MID touch-gesture → completes cleanly ---
        te(s2, "pointerdown", c2.x, c2.y);
        te(s5, "pointermove", c5.x, c5.y);
        expect(previews()).toBe(1);
        setHelpMode(true); // the HP-1 mid-gesture contract, under touch
        expect(previews()).toBe(1); // the gesture still owns its preview
        te(s5, "pointerup", c5.x, c5.y);
        expect(bassNotes()).toEqual([{ degree: 0, start: 2, length: 4 }]);
        expect(previews()).toBe(0); // completed cleanly
        setHelpMode(false);

        // -- T5: SECOND touch pointer mid-gesture → ignored ------------------
        const before5 = bassNotes().length;
        const s8 = cellAt("bass", 0, 8);
        const s10 = cellAt("bass", 0, 10);
        const s12 = cellAt("bass", 0, 12);
        const c8 = center(s8);
        te(s8, "pointerdown", c8.x, c8.y, 7, true); // finger 1 (primary)
        te(s10, "pointermove", center(s10).x, center(s10).y, 7, true);
        // Finger 2 lives and dies entirely inside the gesture (non-primary).
        te(s12, "pointerdown", center(s12).x, center(s12).y, 8, false);
        te(s12, "pointermove", center(s12).x, center(s12).y, 8, false);
        te(s12, "pointerup", center(s12).x, center(s12).y, 8, false);
        te(s12, "pointercancel", center(s12).x, center(s12).y, 8, false);
        expect(bassNotes().length).toBe(before5); // nothing from finger 2
        te(s10, "pointermove", center(s10).x, center(s10).y, 7, true);
        te(s10, "pointerup", center(s10).x, center(s10).y, 7, true);
        expect(bassNotes().length).toBe(before5 + 1); // exactly one note
        expect(bassNotes().some((n) => n.start === 8)).toBe(true);

        // -- T6: MOUSE pointerdown mid TOUCH gesture (hybrid device) ---------
        // A mouse pointer IS primary — the armed-gesture guard is the law
        // that must hold (a touch laptop user's palm taps the trackpad).
        // Steps 12–14 are free (T7b's note spans 2–5, T5's spans 8–10).
        const before6 = bassNotes().length;
        te(s12, "pointerdown", center(s12).x, center(s12).y, 7, true); // touch
        te(
          cellAt("bass", 0, 13),
          "pointermove",
          center(cellAt("bass", 0, 13)).x,
          center(cellAt("bass", 0, 13)).y,
          7,
          true,
        );
        expect(previews()).toBe(1);
        pe(
          cellAt("bass", 0, 14),
          "pointerdown",
          center(cellAt("bass", 0, 14)).x,
          center(cellAt("bass", 0, 14)).y,
          3,
        );
        pe(
          cellAt("bass", 0, 14),
          "pointerup",
          center(cellAt("bass", 0, 14)).x,
          center(cellAt("bass", 0, 14)).y,
          3,
        );
        expect(bassNotes().length).toBe(before6); // the mouse press was ignored
        te(
          cellAt("bass", 0, 13),
          "pointerup",
          center(cellAt("bass", 0, 13)).x,
          center(cellAt("bass", 0, 13)).y,
          7,
          true,
        );
        expect(bassNotes().length).toBe(before6 + 1); // the touch gesture commits
        expect(bassNotes().some((n) => n.start === 12)).toBe(true);

        // Undo integrity for the touch rows: the last committed gesture
        // (T6's touch create at step 12) reverts with ONE undo — checked
        // HERE, before the drums/rail rows add their own history entries.
        const depthNow = historyDepth();
        const { undo } = await import("../../src/state/store");
        undo();
        expect(bassNotes().some((n) => n.start === 12)).toBe(false); // reverted
        expect(historyDepth()).toBe(depthNow - 1);

        // -- T3: pointercancel (touch) mid drums paint -----------------------
        selectLane("drums");
        await waitFor(
          () => document.querySelector(".lane-floor")?.dataset.lane === "drums",
          3000,
          "drums stage",
        );
        const d0 = cellAt("drums", 0, 0);
        const d3 = cellAt("drums", 0, 3);
        const aud1 = auditions.length;
        te(d0, "pointerdown", center(d0).x, center(d0).y);
        te(d3, "pointermove", center(d3).x, center(d3).y);
        expect(cellPreviews()).toBe(4);
        te(d3, "pointercancel", center(d3).x, center(d3).y);
        const drums0 = docStore.getState().doc.patterns.drums[0];
        expect(
          drums0?.kind === "drums" && drums0.steps.kick.every((s) => !s),
          "T3: paint cancelled, nothing on",
        ).toBe(true);
        expect(cellPreviews()).toBe(0);
        expect(auditions.length).toBe(aud1); // zero auditions from the cancel

        // -- T4: pointercancel (touch) mid rail sweep ------------------------
        // (at phone the rail renders ONLY the active lane's row — drums.)
        const drumsChain = () => docStore.getState().doc.songChain.drums;
        addPattern("drums", 1, "B");
        setLaneChain("drums", ["drums-1", "drums-2", "drums-1"]);
        appendChainSlot("drums", "drums-2");
        await waitFor(
          () => drumsChain().length === 4,
          2000,
          "rail chain extended",
        );
        // 2026-09-11: the phone rail lives on the SONG page (EDIT has none).
        showPhonePage("song");
        await waitFor(
          () =>
            document.querySelector(
              '.rail-row[data-lane="drums"] .rail-tile',
            ) !== null,
          2000,
          "SONG page rail mounted",
        );
        const tile = (slot: number): HTMLElement => {
          const tiles = document.querySelectorAll(
            '.rail-row[data-lane="drums"] .rail-tile',
          );
          const el = tiles[slot];
          if (!el) throw new Error(`missing rail tile ${slot}`);
          return el as HTMLElement;
        };
        const rail = document.querySelector(".rail") as HTMLElement;
        const selectionBefore = activePatterns().drums;
        te(tile(0), "pointerdown", center(tile(0)).x, center(tile(0)).y, 7);
        te(tile(1), "pointermove", center(tile(1)).x, center(tile(1)).y, 7);
        te(tile(2), "pointermove", center(tile(2)).x, center(tile(2)).y, 7);
        await waitFor(
          () =>
            document.querySelectorAll(".rail-tile[data-cue-preview]").length >
            0,
          2000,
          "T4: sweep preview armed",
        );
        te(rail, "pointercancel", center(tile(2)).x, center(tile(2)).y, 7);
        expect(activePatterns().drums).toBe(selectionBefore); // no commit
        expect(
          document.querySelectorAll(".rail-tile[data-cue-preview]"),
        ).toHaveLength(0); // no stuck sweep preview
        // A stray late move+up after the cancel stays dead.
        te(tile(3), "pointermove", center(tile(3)).x, center(tile(3)).y, 7);
        te(tile(3), "pointerup", center(tile(3)).x, center(tile(3)).y, 7);
        expect(activePatterns().drums).toBe(selectionBefore);
      } finally {
        showPhonePage("edit");
        setHelpMode(false);
        session.audition = origAudition;
        void import("../../src/engine/session")
          .then(({ getSession: g }) => g().transport.stop?.())
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
          /* best-effort restore */
        }
        await page.viewport(1440, 900); // the suite's convention viewport
      }
    },
    120_000,
  );
});
