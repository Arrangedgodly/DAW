/**
 * HP-1 browser gate — help mode (info view) mechanics on the REAL app,
 * iteration-2 AC #6 + a11y §7 E6 + keyboard.md v2 §"Help mode":
 *
 * 1. ZERO-COST OFF: help mode off = NO help surface mounted (no .info-view,
 *    app root data-help-mode="off") — the TH-4 c clause, pinned here at the
 *    interaction level too (frame-budget.test.ts pins it during measurement).
 * 2. TOGGLE: booth "INFO ?" button (aria-pressed) and the global `i` key;
 *    `INFO MODE ON …` / `INFO MODE OFF` announcements ride the stage status
 *    region (the info region is unmounted when off — it cannot speak its own
 *    departure).
 * 3. GUARDS: `i` never fires in text entries, never with an AT/browser
 *    modifier, never while the KEYS modal is open.
 * 4. FOCUS-DRIVEN UPDATES (E6 keyboard law — no pointer events involved):
 *    focusing representatives of every registered surface (booth, lane
 *    strip, grid, euclid rail, rail tile, projects popover, FX strip +
 *    add menu, save indicator) shows that entry's title + text.
 * 5. HOVER-DRIVEN UPDATES: synthetic pointerover shows the entry; hovering
 *    unregistered ground keeps the last entry (persistence).
 * 6. NO TRAP: the info region is never focusable, never in the tab order.
 * 7. ESCAPE-EXITS-FIRST (cancel-first): with focus on a grid cell, Escape
 *    exits the mode WITHOUT running the region-head pop (focus unchanged);
 *    the next Escape pops as usual. Same law in front of the projects
 *    popover and the FX add menu: the mode exits first, the surface keeps
 *    its own (second) Escape.
 * 8. POINTER PASS-THROUGH: while ON, a control click still works (a drum
 *    cell toggles) — info mode is observe-only (the recorded HP-1 decision).
 * 9. MID-GESTURE TOGGLE (the IN-4 contract): toggling `i` during an active
 *    drag-create neither corrupts nor cancels the gesture — the preview
 *    survives, the release commits exactly one note.
 * 10. MODE-OBVIOUS: dashed markers on registered controls + the help cursor
 *     (static CSS — the world's Ableton-precedent tell).
 *
 * Plus the registry anti-rot invariants (HP-2 widened the source scan to all
 * TWELVE registering components): non-empty id/title/text for every entry;
 * every LITERAL data-help="…" in the component sources resolves to an entry;
 * every registered id is reachable from the sources (literal, or one of the
 * known per-lane/piece/device generators). A control whose data-help id has
 * no entry FAILS here. The mounted-surface WALK (every interactive element
 * must resolve to a substantive entry) lives in help-coverage.test.tsx —
 * HP-2's coverage gate proper.
 */

import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getHelp, helpEntryIds } from "../../src/help/registry";
import {
  helpMode,
  setHelpMode,
  INFO_MODE_OFF_ANNOUNCEMENT,
  INFO_MODE_ON_ANNOUNCEMENT,
} from "../../src/state/helpMode";
import { closeHelp, openHelp } from "../../src/state/helpOverlay";
import { selectLane } from "../../src/state/selection";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { decode, encode } from "../../src/document/codec";
import { createDemoProject } from "../../src/document/demoSong";
import type { PitchedPattern } from "../../src/document/schema";
// DA-3 fix precedent (axe gate): App imports its component CSS but NOT the
// token sheet — that is main.tsx's job in the real bundle. Without tokens
// every var(--color-*) declaration invalidates at computed-value time (the
// mode-obvious dashed marker would compute to none), so load the token base
// exactly as deployed.
import "../../src/styles/base.css";

// ?raw source feeds the anti-rot scan (Vite raw imports — bundled at test
// build time; no fs access needed in the browser page). HP-2 widened the
// scan beyond HP-1's eight: the deferred ScalePopover internals plus the
// failure chrome (toasts, banners, audio-resume) now register too — and
// MB-1's phone lane switcher (StageFloor became a registering component).
import boothSrc from "../../src/components/Booth.tsx?raw";
import stageFloorSrc from "../../src/components/StageFloor.tsx?raw";
import laneHeaderSrc from "../../src/components/LaneHeader.tsx?raw";
import laneGridSrc from "../../src/components/LaneGrid.tsx?raw";
import euclidFillSrc from "../../src/components/EuclidFill.tsx?raw";
import patternRailSrc from "../../src/components/PatternRail.tsx?raw";
import fxStripSrc from "../../src/components/FxStrip.tsx?raw";
import projectsSrc from "../../src/components/Projects.tsx?raw";
import saveIndicatorSrc from "../../src/components/SaveIndicator.tsx?raw";
import scalePopoverSrc from "../../src/components/ScalePopover.tsx?raw";
import toastsSrc from "../../src/components/Toasts.tsx?raw";
import bannerSrc from "../../src/components/Banner.tsx?raw";
import audioStatusSrc from "../../src/components/AudioStatus.tsx?raw";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      setHelpMode(false);
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

function key(
  el: Element | Window,
  k: string,
  opts: KeyboardEventInit = {},
): void {
  (el as EventTarget).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
}

const POINTER_ID = 11;

function pe(
  el: Element,
  type: string,
  x: number,
  y: number,
  extra: PointerEventInit = {},
): boolean {
  return el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  );
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Dispatch a key at the FOCUSED element (never at window): a real keystroke
 * targets the focused control and flows capture→bubble through document, so
 * document-level capture handlers (Projects' Escape) and container handlers
 * (the FX menu's Escape) see it exactly as deployed.
 */
function keyAtActive(k: string, opts: KeyboardEventInit = {}): void {
  key((document.activeElement as Element) ?? document.body, k, opts);
}

describe("HP-1 help mode (info view) — mechanics + E6", () => {
  it(
    "off = zero help surface · button + `i` toggle with announcements · focus AND hover drive the region · no trap · Escape exits first · pass-through · mid-gesture safety · mode-obvious styling",
    { timeout: 90_000 },
    async () => {
      const { host, cleanup } = mount();
      // Snapshot the shared-origin project rows so teardown can restore the
      // pre-test state (in-page mounts cannot deleteDatabase — the boot
      // connection stays open; the iframe-based suites wipe at their start).
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        // Boot settles first (its async restore must never override the
        // deterministic document the mid-gesture stage loads).
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();

        // Park the shared browser's REAL cursor on UNREGISTERED ground: the
        // trusted-pointer suites leave it wherever they finished, and
        // Chromium fires real pointerover boundary events on layout changes
        // under a stationary cursor — over a registered control those would
        // legitimately update the info region and race the synthetic
        // assertions below. A trusted click on the "SONG CHAIN" label (no
        // handlers, no focus) leaves the cursor somewhere harmless.
        const railTitle = host.querySelector(".rail-title");
        if (railTitle) await userEvent.click(railTitle);

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const title = () =>
          host.querySelector(".info-view-title")?.textContent?.trim() ?? "";

        // --- 1. ZERO-COST OFF ------------------------------------------
        expect(helpMode()).toBe(false);
        expect(host.querySelector(".info-view")).toBeNull();
        expect($(".app").getAttribute("data-help-mode")).toBe("off");

        // --- 2. TOGGLE via the booth corner button ---------------------
        const infoBtn = $<HTMLButtonElement>(".booth-btn-info");
        expect(infoBtn.textContent?.trim()).toBe("INFO ?");
        expect(infoBtn.getAttribute("aria-pressed")).toBe("false");
        infoBtn.click();
        await waitFor(() => helpMode() === true, 2000, "mode on (button)");
        expect($(".info-view").getAttribute("role")).toBe("status");
        expect($(".info-view").getAttribute("aria-live")).toBe("polite");
        expect(infoBtn.getAttribute("aria-pressed")).toBe("true");
        expect($(".app").getAttribute("data-help-mode")).toBe("on");
        // Toggle announcements ride the stage status region (E6).
        expect($(".stage-status").textContent).toBe(INFO_MODE_ON_ANNOUNCEMENT);

        // --- 3. MODE-OBVIOUS (static CSS tells) -------------------------
        const metro = $<HTMLElement>('[data-help="booth.metronome"]');
        expect(getComputedStyle(metro).outlineStyle).toBe("dashed");
        expect(getComputedStyle($(".app")).cursor).toBe("help");

        // --- 4. FOCUS-DRIVEN updates across surfaces (no pointer) ------
        // booth (a group-registered control: the tempo stepper + input)
        const bpmInput = $<HTMLInputElement>('[data-help="booth.tempo"] input');
        bpmInput.focus();
        expect(title()).toBe("TEMPO");

        // lane strip (per-lane generated id; a view-only quadrant's strip
        // stays operable — its controls are registered all the same)
        const bassVol = $<HTMLInputElement>(
          '[data-help="lane.bass.volume"] input',
        );
        bassVol.focus();
        expect(title()).toBe("BASS VOLUME");

        // selected quadrant's grid (one entry covers every cell)
        selectLane("drums");
        $(
          '.lane-floor[data-lane="drums"] .cell[data-row="0"][data-step="0"]',
        ).focus();
        expect(title()).toBe("DRUMS GRID");

        // euclid fill rail (per-piece generated id)
        $<HTMLElement>('[data-help="euclid.snare.fill"] button').focus();
        expect(title()).toBe("SNARE FILL");

        // pattern rail tile
        $<HTMLElement>('.rail-row[data-lane="drums"] .rail-tile').focus();
        expect(title()).toBe("CHAIN TILE");

        // save indicator
        $<HTMLElement>('[data-help="save.status"]').focus();
        expect(title()).toBe("AUTOSAVE");

        // projects popover (its buttons mount only while open)
        const projectsBtn = $<HTMLButtonElement>('[data-help="projects.open"]');
        projectsBtn.click();
        await waitFor(
          () => !!host.querySelector(".projects-pop"),
          2000,
          "projects popover",
        );
        $<HTMLElement>('[data-help="projects.wav"]').focus();
        expect(title()).toBe("EXPORT WAV");
        // Escape #1 exits the MODE first (cancel-first); the popover stays.
        keyAtActive("Escape");
        await waitFor(() => helpMode() === false, 2000, "mode off (Escape)");
        expect(host.querySelector(".info-view")).toBeNull();
        expect($(".app").getAttribute("data-help-mode")).toBe("off");
        expect($(".stage-status").textContent).toBe(INFO_MODE_OFF_ANNOUNCEMENT);
        expect(host.querySelector(".projects-pop")).toBeTruthy();
        // Escape #2 closes the popover (its own handler, unblocked now).
        keyAtActive("Escape");
        await waitFor(
          () => host.querySelector(".projects-pop") === null,
          2000,
          "popover closes on the second Escape",
        );

        // --- 5. Escape-exits-FIRST, focus unchanged (grid cell) --------
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        const cell = $<HTMLElement>(
          '.lane-floor[data-lane="drums"] .cell[data-row="0"][data-step="2"]',
        );
        cell.focus();
        expect(title()).toBe("DRUMS GRID");
        keyAtActive("Escape");
        await waitFor(() => helpMode() === false, 2000, "mode off (cell Esc)");
        // Focus NEVER moved — the region-head pop did not run (cancel-first).
        expect(document.activeElement).toBe(cell);
        // With the mode already off, the NEXT Escape pops to the strip head.
        keyAtActive("Escape");
        await waitFor(
          () => document.activeElement !== cell,
          2000,
          "region-head pop applies once the mode is off",
        );

        // --- 6. FX strip + add menu: focus updates + escape ordering ----
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        selectLane("bass");
        const fxBtn = $<HTMLButtonElement>('[data-help="lane.bass.fx"]');
        fxBtn.click();
        await waitFor(
          () => !!host.querySelector(".fx-strip"),
          2000,
          "fx overlay",
        );
        $<HTMLElement>('[data-help="fx.add"]').focus();
        expect(title()).toBe("+ ADD FX");
        // Open the add menu (menu convention: the first item gets focus).
        $('[data-help="fx.add"]').dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await waitFor(
          () => !!host.querySelector(".fx-add-menu"),
          2000,
          "add menu",
        );
        await waitFor(
          () =>
            document.activeElement?.classList.contains("fx-add-item") === true,
          2000,
          "menu item focus",
        );
        expect(title()).toBe("FILTER"); // menu items carry device entries
        // Escape #1: the mode exits FIRST — the menu's own Escape is
        // swallowed this keystroke (the recorded cancel-first reading).
        keyAtActive("Escape");
        await waitFor(() => helpMode() === false, 2000, "mode off (menu Esc)");
        expect(host.querySelector(".fx-add-menu")).toBeTruthy();
        // Escape #2: the menu closes with focus returned to + ADD FX.
        keyAtActive("Escape");
        await waitFor(
          () => host.querySelector(".fx-add-menu") === null,
          2000,
          "add menu closes",
        );
        // Refinement-1 (deliberate spec extension, keyboard.md v2 ledger):
        // with the mode off and the menu closed, the NEXT Escape closes the
        // FX CONSOLE itself — the full order on one surface: help mode →
        // add menu → console. Focus rested inside the console (+ ADD FX),
        // so closing lands it on the strip's FX entry (the owner control).
        expect(host.querySelector(".lane-fx-wrap")).toBeTruthy();
        keyAtActive("Escape");
        await waitFor(
          () => host.querySelector(".lane-fx-wrap") === null,
          2000,
          "third Escape closes the FX console",
        );
        expect(document.activeElement).toBe(fxBtn);

        // --- 7. HOVER-driven update (pointerover) ----------------------
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        const loop = $<HTMLElement>('[data-help="booth.loop"]');
        const at = center(loop);
        pe(loop, "pointerover", at.x, at.y);
        await waitFor(
          () => title() === "LOOP",
          2000,
          "hover shows the LOOP entry",
        );
        // Hovering UNREGISTERED ground keeps the last entry (persistence).
        // Asserted synchronously — the shared browser's parked real cursor
        // can legitimately fire its own boundary events at any async gap.
        const unregistered = $(".rail-title"); // "SONG CHAIN" label
        expect(unregistered.closest("[data-help]")).toBeNull();
        pe(unregistered, "pointerover", 0, 0);
        expect(title()).toBe("LOOP");

        // --- 8. NO TRAP: the region is never focusable ------------------
        const regionEl = $(".info-view");
        expect(regionEl.hasAttribute("tabindex")).toBe(false);
        expect(regionEl.querySelector("button, input, select, a")).toBeNull();

        // --- 9. POINTER PASS-THROUGH: controls still function -----------
        selectLane("drums");
        const target = $<HTMLElement>(
          '.lane-floor[data-lane="drums"] .cell[data-row="1"][data-step="0"]',
        );
        const before = target.dataset.on === "true";
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await new Promise((r) => setTimeout(r, 80));
        expect(target.dataset.on === "true").toBe(!before); // the toggle RAN while the mode was on

        // --- 10. MID-GESTURE toggle (the IN-4 contract) -----------------
        loadDocument(createFreshProjectDocument()); // deterministic notes
        selectLane("bass");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              ?.getAttribute("aria-label") === "BASS grid · EDITING",
          2000,
          "bass quadrant editable",
        );
        const bassCell = (step: number): HTMLElement =>
          $(
            `.lane-floor[data-lane="bass"] .cell[data-row="0"][data-step="${step}"]`,
          );
        const a = center(bassCell(4));
        const mid = center(bassCell(5));
        const end = center(bassCell(6));
        pe(bassCell(4), "pointerdown", a.x, a.y);
        pe(bassCell(5), "pointermove", mid.x, mid.y);
        await waitFor(
          () =>
            host.querySelectorAll(
              '.lane-floor[data-lane="bass"] .note-run.is-drag-preview',
            ).length === 1,
          2000,
          "drag preview lives before the toggle",
        );
        // THE mid-gesture toggle (the harder direction — the mode is ON
        // here, so `i` UNMOUNTS the info surface mid-flight): the gesture
        // must survive the unmount — preview intact, commit on release.
        key(window, "i");
        await waitFor(() => helpMode() === false, 2000, "mode off mid-gesture");
        expect(host.querySelector(".info-view")).toBeNull();
        expect(
          host.querySelectorAll(
            '.lane-floor[data-lane="bass"] .note-run.is-drag-preview',
          ).length,
          "preview survives the mode toggle",
        ).toBe(1);
        pe(bassCell(6), "pointermove", end.x, end.y);
        pe(bassCell(6), "pointerup", end.x, end.y);
        // The gesture COMPLETED: exactly one sustained note was committed.
        const pattern = docStore.getState().doc.patterns.bass[0];
        expect(pattern?.kind).toBe("pitched");
        const notes =
          pattern?.kind === "pitched"
            ? pattern.notes
            : ([] as PitchedPattern["notes"]);
        expect(notes).toEqual([{ degree: 0, start: 4, length: 3 }]);
        // The mode STAYED off (the toggle did not bounce) and no preview
        // is stuck after the commit.
        expect(helpMode()).toBe(false);
        expect(
          host.querySelectorAll(
            '.lane-floor[data-lane="bass"] .note-run.is-drag-preview',
          ).length,
        ).toBe(0);

        // --- 11. `i` TOGGLE + GUARDS -----------------------------------
        // The mode is off (stage 10 left it off); `i` toggles both ways.
        key(window, "i"); // focus rests in the bass grid — legal toggle
        await waitFor(() => helpMode() === true, 2000, "mode on (i)");
        key(window, "i");
        await waitFor(() => helpMode() === false, 2000, "mode off (i)");
        key(window, "i", { ctrlKey: true });
        await new Promise((r) => setTimeout(r, 80));
        expect(helpMode(), "AT/browser modifiers never toggle").toBe(false);
        // Text entry: typing `i` in the tempo input is typing, not a toggle.
        bpmInput.focus();
        key(bpmInput, "i");
        await new Promise((r) => setTimeout(r, 80));
        expect(helpMode(), "never in text entries").toBe(false);
        // KEYS modal open: `i` stands down (the modal owns keys).
        openHelp($<HTMLElement>(".booth-btn-help"));
        key(window, "i");
        await new Promise((r) => setTimeout(r, 80));
        expect(helpMode(), "modal stands `i` down").toBe(false);
        closeHelp();
        // Mount-time resolution: `i` while a control is focused explains it
        // immediately (no pointer events involved). All synchronous — the
        // toggle, the mount and the mount-time resolve flush inside the
        // keystroke's dispatch, so the assertion has no async window.
        loop.focus();
        key(window, "i");
        expect(helpMode()).toBe(true);
        expect(title()).toBe("LOOP");
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        // Stop the boot autosave controller first (no writes may land after
        // the restore), then put the pre-test rows back and drop any row
        // this test's autosave created (drag-notes.test.tsx precedent).
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

// ---------------------------------------------------------------------------
// Registry anti-rot invariants (HP-2 extends this into full coverage)
// ---------------------------------------------------------------------------

const SOURCES = [
  boothSrc,
  stageFloorSrc,
  laneHeaderSrc,
  laneGridSrc,
  euclidFillSrc,
  patternRailSrc,
  fxStripSrc,
  projectsSrc,
  saveIndicatorSrc,
  scalePopoverSrc,
  toastsSrc,
  bannerSrc,
  audioStatusSrc,
] as const;

/** Every LITERAL `data-help="…"` id stamped in the component sources. */
function literalHelpIds(): Set<string> {
  const ids = new Set<string>();
  for (const src of SOURCES) {
    for (const m of src.matchAll(/data-help="([^"]+)"/g)) ids.add(m[1]!);
  }
  return ids;
}

/** Ids the generators mint (per-lane strips/grids, per-piece fills, devices). */
function generatedHelpIds(): Set<string> {
  const ids = new Set<string>();
  for (const lane of ["drums", "bass", "chords", "lead"]) {
    for (const part of [
      "sound",
      "volume",
      "mute",
      "solo",
      "scale",
      "gate",
      "fx",
    ]) {
      ids.add(`lane.${lane}.${part}`);
    }
    ids.add(`grid.${lane}`);
  }
  for (const piece of ["kick", "snare", "hat", "openhat", "clap", "tom"]) {
    ids.add(`euclid.${piece}.fill`);
  }
  for (const type of ["filter", "drive", "bitcrusher", "delay", "reverb"]) {
    ids.add(`fx.device.${type}`);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Regression found BY this gate's pass-through stage (flaky only when the
// mounted project had been codec round-tripped): the drums grid displayed
// one row's hits under another row's label after any save→load restore.
// ---------------------------------------------------------------------------

describe("HP-1 gate finding — drums sync is codec key-order independent", () => {
  it(
    "a codec round-tripped project maps rows by DRUM_PIECES, not Object.keys order (row 1 = SNARE, not HAT)",
    { timeout: 30_000 },
    async () => {
      const { host, cleanup } = mount();
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        // encode→decode SORTS object keys (the canonical codec law), so the
        // decoded document's steps arrive clap-first — insertion order gone.
        const roundTripped = decode(encode(createDemoProject()));
        loadDocument(roundTripped);
        selectLane("drums");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="drums"] [role="grid"]')
              ?.getAttribute("aria-label") === "DRUMS grid · EDITING",
          2000,
          "drums quadrant editable",
        );
        const cell = (row: number, step: number): HTMLElement => {
          const el = host.querySelector(
            `.lane-floor[data-lane="drums"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
          if (!el) throw new Error(`missing drums cell ${row}:${step}`);
          return el as HTMLElement;
        };
        // Demo law: SNARE row 1 = "....x.......x..." (step 0 OFF) while HAT
        // row 2 = 8ths (step 0 ON). With the Object.keys bug, row 1 showed
        // HAT's ON at step 0 under the SNARE label.
        expect(cell(1, 0).dataset.on).toBe("false"); // SNARE 0 = off
        expect(cell(2, 0).dataset.on).toBe("true"); // HAT 0 = on
        // And a click on row 1 toggles the SNARE pattern (not hat):
        cell(1, 0).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await new Promise((r) => setTimeout(r, 80));
        expect(cell(1, 0).dataset.on).toBe("true");
        expect(cell(2, 0).dataset.on).toBe("true"); // hat untouched
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
      }
    },
  );
});

describe("HP-1 help registry — anti-rot invariants", () => {
  it("every entry has non-empty id/title/text", () => {
    const ids = helpEntryIds();
    expect(ids.length).toBeGreaterThan(30); // every surface registered
    for (const id of ids) {
      const entry = getHelp(id)!;
      expect(entry, id).toBeTruthy();
      expect(entry.title.trim().length, `${id} title`).toBeGreaterThan(0);
      expect(entry.text.trim().length, `${id} text`).toBeGreaterThan(0);
    }
  });

  it("every literal data-help id in the sources resolves to an entry", () => {
    for (const id of literalHelpIds()) {
      expect(getHelp(id), `unregistered data-help id: ${id}`).toBeTruthy();
    }
  });

  it("every registered id is reachable from a component source (no dead entries)", () => {
    const reachable = new Set([...literalHelpIds(), ...generatedHelpIds()]);
    const dead = helpEntryIds().filter((id) => !reachable.has(id));
    expect(dead, "registry ids nothing stamps").toEqual([]);
  });
});
