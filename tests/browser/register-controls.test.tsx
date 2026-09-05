/**
 * RC-1 browser gate — the register controls (v3, i3-1 + i3-2) on the REAL
 * app, demo document:
 *
 * 1. EQUAL REGISTER WINDOWS (i3-1): every pitched lane's grid shows the SAME
 *    one-octave window by default (bass/lead windowed at 7 rows on the
 *    heptatonic demo, chords/drums full) with the FULL row manifest in the
 *    DOM (the construction law) and every window reachable by scroll.
 * 2. PER-LANE OCT −/+ (i3-2, a11y E8): the strip control exists on pitched
 *    lanes only; keyboard (`o`/Shift+`o`) and pointer paths produce IDENTICAL
 *    value texts through one funnel; the −3..+3 clamp no-op still announces
 *    (`· AT LIMIT`); drums answers `DRUMS HAS NO OCTAVE`; a held burst is
 *    ONE undo gesture; the readout text exists before any interaction.
 * 3. WINDOW SCROLL (E9, the conflation fence): Shift+↑/↓ scroll the window
 *    VIEW-ONLY (document identity unchanged, focus unmoved) and announce
 *    VIEW wording naming the newly visible rows; clamps announce the edge;
 *    the focus-anchor law bounds the keys; arrows walk the full manifest
 *    with the window following focus; grid names carry the range and flip
 *    with the window; an OCT transpose never scrolls the window.
 * 4. PHONE half (I3-f regression-only): the OCT control stays reachable at
 *    390×844 (44px target law) and the phone stage keeps its committed
 *    full-manifest scrolling-grid law (m1) — no windowing, keys clamp.
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { createDemoProject } from "../../src/document/demoSong";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import {
  registerWindowStart,
  selectLane,
} from "../../src/state/selection";
import "../../src/styles/base.css";

function mount(): { host: HTMLElement; cleanup: () => void } {
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

function laneHost(host: HTMLElement, lane: string): HTMLElement {
  return host.querySelector(`.lane-floor[data-lane="${lane}"]`)! as HTMLElement;
}

function gridOf(host: HTMLElement, lane: string): HTMLElement {
  return laneHost(host, lane).querySelector(
    '[role="grid"]',
  )! as HTMLElement;
}

function scrollOf(host: HTMLElement, lane: string): HTMLElement {
  return laneHost(host, lane).querySelector(
    ".lane-grid-scroll",
  )! as HTMLElement;
}

function octLiveOf(host: HTMLElement, lane: string): string {
  return (
    laneHost(host, lane).querySelector(".oct-live")?.textContent?.trim() ?? ""
  );
}

function octReadoutOf(host: HTMLElement, lane: string): string {
  return (
    laneHost(host, lane)
      .querySelector(`[data-help="lane.${lane}.oct"] .head-oct-value`)
      ?.textContent?.trim() ?? ""
  );
}

function viewLiveOf(host: HTMLElement, lane: string): string {
  return (
    laneHost(host, lane).querySelector(".view-live")?.textContent?.trim() ?? ""
  );
}

/** Rows FULLY inside the scroll container's visible box (1px slack). */
function visibleRowCount(host: HTMLElement, lane: string): number {
  const scroller = scrollOf(host, lane);
  const box = scroller.getBoundingClientRect();
  let n = 0;
  for (const row of scroller.querySelectorAll(".grid-row")) {
    const r = row.getBoundingClientRect();
    if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1) n++;
  }
  return n;
}

function laneOctave(lane: string): number {
  const conf = docStore.getState().doc.lanes.find((l) => l.id === lane)!;
  return (conf as { octave?: number }).octave ?? 0;
}

describe("RC-1 register controls (real app, demo document)", () => {
  it(
    "equal default windows + manifest scroll + OCT keyboard/pointer/undo + E8/E9 texts",
    { timeout: 120_000 },
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
        loadDocument(createDemoProject());
        selectLane("drums");
        await waitFor(
          () =>
            gridOf(host, "drums").getAttribute("aria-label") ===
            "DRUMS grid · EDITING",
          4000,
          "demo loaded (drums editing)",
        );

        // ------------------------------------------------------------------
        // 1. EQUAL DEFAULT REGISTER WINDOWS (i3-1)
        // ------------------------------------------------------------------
        // The tall lane is windowed at ONE octave; lanes whose manifest
        // already fits are not (today's names, byte-identical). The demo
        // presents 6/7/7/7 visible rows — no lane visually dominates.
        expect(
          scrollOf(host, "lead").classList.contains("is-windowed"),
          "lead windowed (15-row manifest > one octave)",
        ).toBe(true);
        for (const lane of ["bass", "chords", "drums"]) {
          expect(
            scrollOf(host, lane).classList.contains("is-windowed"),
            `${lane} manifest fits one window — no windowing (byte-identical name law)`,
          ).toBe(false);
        }
        // The FULL row manifest stays in the DOM (construction law) —
        // migration is lossless, nothing was cut to shrink the default.
        // (Demo manifests: bass-1 carries degrees 0..6 — one octave.)
        const manifestRows: Record<string, number> = {
          drums: 6,
          bass: 7,
          chords: 7,
          lead: 15,
        };
        for (const [lane, count] of Object.entries(manifestRows)) {
          expect(
            scrollOf(host, lane).querySelectorAll(".grid-row").length,
            `${lane} full manifest in the DOM`,
          ).toBe(count);
        }
        // Every pitched window shows the SAME number of visible rows.
        expect(visibleRowCount(host, "bass")).toBe(7);
        expect(visibleRowCount(host, "lead")).toBe(7);
        expect(visibleRowCount(host, "chords")).toBe(7);
        expect(visibleRowCount(host, "drums")).toBe(6);
        // The recorded default-position law: the window showing the most
        // noted rows (demo: the lead melody at 6–12; bass fits whole).
        expect(gridOf(host, "bass").getAttribute("aria-label")).toBe(
          "BASS grid · VIEW ONLY",
        );
        expect(gridOf(host, "lead").getAttribute("aria-label")).toBe(
          "LEAD grid · VIEW ONLY · ROWS 6–12 OF 14",
        );

        // ------------------------------------------------------------------
        // 2. THE OCT CONTROL (i3-2, E8)
        // ------------------------------------------------------------------
        for (const lane of ["bass", "chords", "lead"]) {
          const group = laneHost(host, lane).querySelector(
            `[data-help="lane.${lane}.oct"]`,
          );
          expect(group, `${lane} OCT group in the compact strip`).toBeTruthy();
          // The readout text exists BEFORE any interaction (E8).
          expect(octReadoutOf(host, lane)).toBe("0");
        }
        expect(
          laneHost(host, "drums").querySelector('[data-help="lane.drums.oct"]'),
          "drums carries NO OCT control",
        ).toBeNull();
        expect(
          laneHost(host, "drums").querySelector(
            'button[aria-label="Octave up for DRUMS"]',
          ),
          "drums carries no OCT buttons",
        ).toBeNull();

        // --- keyboard path on the ACTIVE lane (global `o`) ----------------
        selectLane("lead");
        await waitFor(
          () =>
            gridOf(host, "lead").getAttribute("aria-label") ===
            "LEAD grid · EDITING · ROWS 6–12 OF 14",
          2000,
          "lead editing (windowed name)",
        );
        key(document.body, "o");
        await waitFor(
          () => octLiveOf(host, "lead") === "LEAD OCTAVE +1",
          2000,
          "LEAD OCTAVE +1 announcement",
        );
        expect(octReadoutOf(host, "lead")).toBe("+1");
        expect(laneOctave("lead")).toBe(1);

        // --- pointer path on ANOTHER quadrant's strip (always-operable) ---
        const bassUp = laneHost(host, "bass").querySelector<HTMLButtonElement>(
          'button[aria-label="Octave up for BASS"]',
        )!;
        bassUp.click();
        await waitFor(
          () => octLiveOf(host, "bass") === "BASS OCTAVE +1",
          2000,
          "BASS OCTAVE +1 announcement (click path)",
        );
        // E8: the value texts are EQUAL between paths.
        expect(octReadoutOf(host, "bass")).toBe(octReadoutOf(host, "lead"));
        expect(laneOctave("bass")).toBe(1);

        // --- Shift+`o` steps down (re-select lead first: the strip click
        // above lawfully selected the bass quadrant — the LY-1 pointer
        // law — and the global key acts on the ACTIVE lane). --------------
        selectLane("lead");
        await waitFor(
          () =>
            gridOf(host, "lead").getAttribute("aria-label") ===
            "LEAD grid · EDITING · ROWS 6–12 OF 14",
          2000,
          "lead re-selected",
        );
        key(document.body, "o", { shiftKey: true });
        await waitFor(
          () => octLiveOf(host, "lead") === "LEAD OCTAVE 0",
          2000,
          "Shift+o back to 0",
        );
        expect(laneOctave("lead")).toBe(0);

        // --- the −3..+3 clamp: no-op that still announces ------------------
        // (Settle past the 350 ms coalescing window first so the +1/+2/+3
        // burst below is exactly ONE gesture with baseline 0.)
        await new Promise((r) => setTimeout(r, 400));
        key(document.body, "o"); // +1
        key(document.body, "o"); // +2
        key(document.body, "o"); // +3 (held-burst: one undo gesture)
        await waitFor(
          () => octLiveOf(host, "lead") === "LEAD OCTAVE +3",
          2000,
          "LEAD OCTAVE +3",
        );
        const docAtLimit = docStore.getState().doc;
        key(document.body, "o"); // blocked at +3
        await waitFor(
          () => octLiveOf(host, "lead") === "LEAD OCTAVE +3 · AT LIMIT",
          2000,
          "clamp announcement",
        );
        expect(docStore.getState().doc).toBe(docAtLimit); // never a silent write
        expect(octReadoutOf(host, "lead")).toBe("+3");

        // --- transpose never scrolls the window (E9 fence) -----------------
        expect(gridOf(host, "lead").getAttribute("aria-label")).toBe(
          "LEAD grid · EDITING · ROWS 6–12 OF 14",
        );

        // --- ONE undo gesture per held burst (coalescing family) -----------
        key(document.body, "z", { ctrlKey: true });
        await waitFor(
          () => laneOctave("lead") === 0,
          2000,
          "one Ctrl+Z reverts the whole +3 burst",
        );
        expect(octReadoutOf(host, "lead")).toBe("0");

        // --- drums refusal (global key only) --------------------------------
        selectLane("drums");
        await waitFor(
          () =>
            gridOf(host, "drums").getAttribute("aria-label") ===
            "DRUMS grid · EDITING",
          2000,
          "drums selected",
        );
        const docBeforeDrums = docStore.getState().doc;
        key(document.body, "o");
        await waitFor(
          () => octLiveOf(host, "drums") === "DRUMS HAS NO OCTAVE",
          2000,
          "DRUMS HAS NO OCTAVE",
        );
        expect(docStore.getState().doc).toBe(docBeforeDrums);

        // ------------------------------------------------------------------
        // 3. WINDOW SCROLL — VIEW ONLY (E9, the conflation fence)
        // ------------------------------------------------------------------
        selectLane("lead");
        await waitFor(
          () =>
            gridOf(host, "lead").getAttribute("aria-label") ===
            "LEAD grid · EDITING · ROWS 6–12 OF 14",
          2000,
          "lead re-selected",
        );
        const seed = [...laneHost(host, "lead").querySelectorAll(".cell")].find(
          (c) => c.tabIndex === 0,
        ) as HTMLElement;
        seed.focus();
        // Walk focus down to the window's bottom row (12) — the anchor law
        // needs the focus off the window's top edge for a DOWN scroll, and
        // the walk itself proves arrows traverse the full manifest.
        for (let i = 0; i < 12; i++) key(document.activeElement!, "ArrowDown");
        const focusedCell = document.activeElement as HTMLElement;
        expect(focusedCell.dataset.row).toBe("12");
        const docBeforeScroll = docStore.getState().doc;

        key(document.activeElement!, "ArrowDown", { shiftKey: true });
        await waitFor(
          () => viewLiveOf(host, "lead").startsWith("VIEW DOWN ONE OCTAVE"),
          2000,
          "VIEW DOWN ONE OCTAVE announcement",
        );
        // E9: VIEW ONLY — the document is untouched and focus does not move.
        expect(docStore.getState().doc).toBe(docBeforeScroll);
        expect(document.activeElement).toBe(focusedCell);
        // The window moved (start 6 → anchor- and manifest-clamped to 8).
        // The name flips with the window; the announcement names the newly
        // visible rows with the grid's OWN row labels (pitch names).
        await waitFor(
          () =>
            gridOf(host, "lead").getAttribute("aria-label") ===
            "LEAD grid · EDITING · ROWS 8–14 OF 14",
          2000,
          "window scrolled one octave (anchor-clamped)",
        );
        const labels = [
          ...scrollOf(host, "lead").querySelectorAll(".row-label"),
        ].map((l) => l.textContent?.trim() ?? "");
        expect(viewLiveOf(host, "lead")).toBe(
          `VIEW DOWN ONE OCTAVE · ROWS ${labels[8]}–${labels[14]}`,
        );

        // At the manifest bottom the press is a no-op that announces.
        key(document.activeElement!, "ArrowDown", { shiftKey: true });
        await waitFor(
          () => viewLiveOf(host, "lead").startsWith("VIEW AT BOTTOM"),
          2000,
          "VIEW AT BOTTOM clamp",
        );
        expect(docStore.getState().doc).toBe(docBeforeScroll);

        // Walk focus UP through the manifest: the window follows minimally
        // and the focused row stays visible (the cursor holds the window).
        for (let i = 0; i < 14; i++) key(document.activeElement!, "ArrowUp");
        await waitFor(
          () => (document.activeElement as HTMLElement).dataset.row === "0",
          2000,
          "arrows walked the full manifest to row 0",
        );
        const box = scrollOf(host, "lead").getBoundingClientRect();
        const focusRect = (
          document.activeElement as HTMLElement
        ).getBoundingClientRect();
        expect(focusRect.top).toBeGreaterThanOrEqual(box.top - 1);
        expect(focusRect.bottom).toBeLessThanOrEqual(box.bottom + 1);
        expect(registerWindowStart("lead")).toBe(0);

        // Anchor law at the top: focus on the window's first row blocks UP.
        key(document.activeElement!, "ArrowUp", { shiftKey: true });
        await waitFor(
          () => viewLiveOf(host, "lead").startsWith("VIEW AT TOP"),
          2000,
          "anchor-blocked UP announces the edge",
        );

        // The full manifest stays reachable: every row visited above (0..12
        // walked) — and the scrolled-out rows are still in the DOM (law 1).

        // Text-entry guard: `o` inside a text entry never transposes.
        const renameInput = document.createElement("input");
        renameInput.type = "text";
        document.body.append(renameInput);
        renameInput.focus();
        renameInput.value = "o";
        key(renameInput, "o");
        expect(laneOctave("lead")).toBe(0);
        renameInput.remove();

        // ------------------------------------------------------------------
        // 1b. FRESH project: the equal windows hold there too (i3-1 — fresh
        // bass/lead carry the 14-row double-octave manifests and BOTH
        // window to one octave; zero document churn — the manifests stay).
        // ------------------------------------------------------------------
        loadDocument(createFreshProjectDocument());
        // (Lead is the ACTIVE lane here — its name says EDITING.)
        await waitFor(
          () =>
            gridOf(host, "bass").getAttribute("aria-label") ===
              "BASS grid · VIEW ONLY · ROWS 0–6 OF 13" &&
            gridOf(host, "lead").getAttribute("aria-label") ===
              "LEAD grid · EDITING · ROWS 0–6 OF 13",
          4000,
          "fresh project: bass + lead windowed at the first octave",
        );
        expect(
          scrollOf(host, "bass").querySelectorAll(".grid-row").length,
          "fresh bass keeps its full 14-row manifest",
        ).toBe(14);
        expect(visibleRowCount(host, "bass")).toBe(7);
        expect(visibleRowCount(host, "lead")).toBe(7);
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

  it(
    "phone 390×844: OCT control reachable (44px law); phone grid keeps the full-manifest scrolling law",
    { timeout: 90_000 },
    async () => {
      await page.viewport(390, 844);
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
        loadDocument(createDemoProject());
        selectLane("lead");
        await waitFor(
          () =>
            host.querySelector(".app")?.getAttribute("data-stage") === "phone",
          4000,
          "phone stage",
        );
        await waitFor(
          () =>
            gridOf(host, "lead").getAttribute("aria-label") ===
            "LEAD grid · EDITING",
          4000,
          "lead editing on the phone stage (full manifest — no range)",
        );
        // I3-f/m1: the phone stage KEEPS its committed scrolling-grid law —
        // the whole manifest is the window (no internal windowing; the tall
        // lane's rows scroll with the document).
        expect(
          scrollOf(host, "lead").classList.contains("is-windowed"),
          "phone grid unwindowed (page-scroll law, m1)",
        ).toBe(false);
        expect(
          scrollOf(host, "lead").querySelectorAll(".grid-row").length,
        ).toBe(15);

        // The OCT control is reachable at phone width (compact strip, the
        // 44px target law sizes the steppers).
        const octUp = laneHost(host, "lead").querySelector<HTMLButtonElement>(
          'button[aria-label="Octave up for LEAD"]',
        )!;
        expect(octUp).toBeTruthy();
        expect(octUp.getClientRects().length).toBeGreaterThan(0);
        expect(octUp.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(octReadoutOf(host, "lead")).toBe("0");
        octUp.click();
        await waitFor(
          () => octLiveOf(host, "lead") === "LEAD OCTAVE +1",
          2000,
          "OCT +1 at phone width",
        );
        expect(laneOctave("lead")).toBe(1);

        // Shift+arrows are grid keys everywhere; on the full-manifest phone
        // grid the window cannot move — the keys clamp silently (chords/
        // drums precedent) and NOTHING is announced as a scroll.
        const seed = [...laneHost(host, "lead").querySelectorAll(".cell")].find(
          (c) => c.tabIndex === 0,
        ) as HTMLElement;
        seed.focus();
        key(document.activeElement!, "ArrowDown", { shiftKey: true });
        await new Promise((r) => setTimeout(r, 120));
        expect(viewLiveOf(host, "lead")).toBe("");
        expect(
          gridOf(host, "lead").getAttribute("aria-label"),
        ).not.toContain("ROWS");
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        await page.viewport(1280, 800);
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
