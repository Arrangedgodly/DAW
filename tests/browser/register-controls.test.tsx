/**
 * RC-1 browser gate — the register controls (v3, i3-1 + i3-2) on the REAL
 * app, demo document:
 *
 * 1. FULL MIDI REGISTER (i3-1): every pitched lane shows a scale-octave
 *    window backed by the complete physical MIDI domain. Higher pitches are
 *    first in the DOM and every valid register remains reachable.
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
 *    390×844 (44px target law) and a complete scale octave plus footer fits.
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import "../../src/styles/base.css";
import App from "../../src/App";
import { createDemoProject } from "../../src/document/demoSong";
import { pitchDomain } from "../../src/document/pitchWindow";
import { clampedWindowScroll } from "../../src/grid/keynav";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { registerWindowStart, selectLane } from "../../src/state/selection";
import { setHelpMode } from "../../src/state/helpMode";

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
  return laneHost(host, lane).querySelector('[role="grid"]')! as HTMLElement;
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

/**
 * i3-1 (vertical fill law): the desktop mount's budget GROWS the register
 * window past the one-octave default, so every window assertion derives
 * from the LIVE grid name instead of a hardcoded octave. Returns the
 * windowed range {a, b, w} + the manifest's last index n, or null when the
 * grid is unwindowed (full manifest).
 */
function winRangeOf(
  host: HTMLElement,
  lane: string,
): {
  a: number;
  b: number;
  w: number;
  n: number;
} | null {
  const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(
    gridOf(host, lane).getAttribute("aria-label") ?? "",
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { a, b, w: b - a + 1, n: Number(m[3]) };
}

/** The OCT-scroll fence comparator: the window name, frozen for compare. */
function winNameOf(host: HTMLElement, lane: string): string {
  return gridOf(host, lane).getAttribute("aria-label") ?? "";
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
        // 1. EQUAL DEFAULT REGISTER WINDOWS (i3-1) + the i3-1 FILL twin
        // ------------------------------------------------------------------
        // Pitched lanes all project the complete physical MIDI domain while
        // the drum voice list remains a compact, unwindowed six-row grid.
        const demo = docStore.getState().doc;
        const pitchedWins = Object.fromEntries(
          (["bass", "chords", "lead"] as const).map((lane) => [
            lane,
            winRangeOf(host, lane),
          ]),
        ) as Record<"bass" | "chords" | "lead", ReturnType<typeof winRangeOf>>;
        for (const lane of ["bass", "chords", "lead"] as const) {
          expect(
            scrollOf(host, lane).classList.contains("is-windowed"),
            `${lane} full MIDI domain uses a scale-octave window`,
          ).toBe(true);
          expect(pitchedWins[lane]).not.toBeNull();
        }
        expect(scrollOf(host, "drums").classList.contains("is-windowed")).toBe(
          false,
        );
        const manifestRows: Record<string, number> = {
          drums: 6,
          bass: pitchDomain(demo, "bass").degrees.length,
          chords: pitchDomain(demo, "chords").degrees.length,
          lead: pitchDomain(demo, "lead").degrees.length,
        };
        for (const [lane, count] of Object.entries(manifestRows)) {
          expect(
            scrollOf(host, lane).querySelectorAll(".grid-row").length,
            `${lane} full manifest in the DOM`,
          ).toBe(count);
        }
        // A complete heptatonic octave is visible in each pitched panel.
        for (const lane of ["bass", "chords", "lead"] as const) {
          expect(pitchedWins[lane]!.w).toBe(7);
          expect(visibleRowCount(host, lane)).toBe(7);
        }
        expect(visibleRowCount(host, "drums")).toBe(6);
        expect(gridOf(host, "bass").getAttribute("aria-label")).toBe(
          `BASS grid · VIEW ONLY · ROWS ${pitchedWins.bass!.a}–${pitchedWins.bass!.b} OF ${pitchedWins.bass!.n}`,
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
        // i3-1: freeze the window name only after the fill has settled —
        // Selecting the lane changes the edit tier, so wait until its
        // scale-octave range has held for 300ms before freezing the fence.
        let winBaseline: { name: string; at: number } | null = null;
        await waitFor(
          () => {
            const r = winRangeOf(host, "lead");
            if (r === null || r.w !== 7) {
              winBaseline = null;
              return false;
            }
            const name = winNameOf(host, "lead");
            if (winBaseline && winBaseline.name === name) {
              return Date.now() - winBaseline.at >= 300;
            }
            winBaseline = { name, at: Date.now() };
            return false;
          },
          4000,
          "lead scale-octave window settles",
        );
        const leadName = winNameOf(host, "lead");
        expect(
          leadName.startsWith("LEAD grid · EDITING · ROWS "),
          "lead editing (windowed name)",
        ).toBe(true);
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
          () => winNameOf(host, "lead") === leadName,
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
        expect(winNameOf(host, "lead")).toBe(leadName);

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
        // i3-1: the window is FILL-GROWN at this viewport; every number
        // below derives from the live range. The STEP stays ONE OCTAVE
        // (7 rows — the mode size), decoupled from the grown height, so
        // the announcement vocabulary stays honest at any window size.
        selectLane("lead");
        await waitFor(
          () => winNameOf(host, "lead") === leadName,
          2000,
          "lead re-selected",
        );
        const win = winRangeOf(host, "lead")!;
        const OCTAVE = 7; // the committed step (mode size), never the grown w
        const seed = [...laneHost(host, "lead").querySelectorAll(".cell")].find(
          (c) => c.tabIndex === 0,
        ) as HTMLElement;
        seed.focus();
        // Walk focus down to the window's bottom row (b) — the anchor law
        // needs the focus off the window's top edge for a DOWN scroll, and
        // the walk itself proves arrows traverse the full manifest.
        for (let i = Number(seed.dataset.row); i < win.b; i++)
          key(document.activeElement!, "ArrowDown");
        const focusedCell = document.activeElement as HTMLElement;
        expect(focusedCell.dataset.row).toBe(String(win.b));
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
        // The window moved one OCTAVE (7 rows), anchor- and manifest-
        // clamped (the pure keynav law, step = the octave — never the
        // grown height); the name flips with the window; the announcement
        // names the newly visible rows with the grid's OWN row labels.
        const newA = clampedWindowScroll(
          win.a,
          1,
          win.b,
          win.n + 1,
          win.w,
          OCTAVE,
        );
        await waitFor(
          () =>
            gridOf(host, "lead").getAttribute("aria-label") ===
            `LEAD grid · EDITING · ROWS ${newA}–${newA + win.w - 1} OF ${win.n}`,
          2000,
          "window scrolled one octave (anchor-clamped)",
        );
        const labels = [
          ...scrollOf(host, "lead").querySelectorAll(".row-label"),
        ].map((l) => l.textContent?.trim() ?? "");
        expect(viewLiveOf(host, "lead")).toBe(
          `VIEW DOWN ONE OCTAVE · ROWS ${labels[newA]}–${labels[newA + win.w - 1]}`,
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
        for (let i = 0; i < win.b; i++) key(document.activeElement!, "ArrowUp");
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

        // The full MIDI domain stays in the DOM while rows move in and out
        // of the visible scale-octave window.

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
        // bass/lead carry their full physical MIDI domains and BOTH window;
        // the scale-octave seat remains equal without document churn.
        // ------------------------------------------------------------------
        loadDocument(createFreshProjectDocument());
        // (Lead is the ACTIVE lane here — its name says EDITING.)
        await waitFor(
          () => {
            const b = winRangeOf(host, "bass");
            const l = winRangeOf(host, "lead");
            return (
              gridOf(host, "bass")
                .getAttribute("aria-label")
                ?.startsWith("BASS grid · VIEW ONLY · ROWS ") === true &&
              gridOf(host, "lead")
                .getAttribute("aria-label")
                ?.startsWith("LEAD grid · EDITING · ROWS ") === true &&
              b !== null &&
              l !== null
            );
          },
          4000,
          "fresh project: bass + lead windowed",
        );
        const freshBass = winRangeOf(host, "bass")!;
        const freshLead = winRangeOf(host, "lead")!;
        const fresh = docStore.getState().doc;
        expect(
          scrollOf(host, "bass").querySelectorAll(".grid-row").length,
          "fresh bass keeps its complete MIDI domain",
        ).toBe(pitchDomain(fresh, "bass").degrees.length);
        expect(
          scrollOf(host, "lead").querySelectorAll(".grid-row").length,
        ).toBe(pitchDomain(fresh, "lead").degrees.length);
        expect(freshBass.w).toBe(7);
        expect(freshLead.w).toBe(7);
        expect(
          freshBass.w,
          "both pitched lanes show the same scale-octave row count",
        ).toBe(freshLead.w);
        expect(visibleRowCount(host, "bass")).toBe(freshBass.w);
        expect(visibleRowCount(host, "lead")).toBe(freshLead.w);
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
    "phone 390×844: OCT control reachable (44px law); phone grid windows at the one-octave M-5 law",
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
            gridOf(host, "lead")
              .getAttribute("aria-label")
              ?.startsWith("LEAD grid · EDITING · ROWS ") === true,
          4000,
          "lead editing on the phone stage (M-5 one-octave window readout)",
        );
        // M-5 (iteration 4) FLIPPED the old phone full-manifest law: the
        // phone stage windows pitched grids at the RC-1 one-octave default
        // (same seat law as desktop; the full manifest stays in the DOM as
        // a fixed-height scroll seat).
        expect(
          scrollOf(host, "lead").classList.contains("is-windowed"),
          "phone grid windowed (M-5 one-octave seat)",
        ).toBe(true);
        expect(
          scrollOf(host, "lead").querySelectorAll(".grid-row").length,
        ).toBe(pitchDomain(docStore.getState().doc, "lead").degrees.length);

        // i7 N-2 (the LY-1 phone carve-out, midi-i7-audit §2.2): the strip's
        // OCT group HIDES at phone — the RC-1 SOUND transpose lives in the
        // OPTIONS drawer (PhoneOptions mounts the same stepper seam, the
        // strip's own .head-stepper vocabulary + the E9-fence caption).
        // Open the drawer and audit the control THERE (44px painted law).
        const optionsToggle = host.querySelector<HTMLElement>(
          '[data-help="phone.options"]',
        )!;
        optionsToggle.click();
        await waitFor(
          () => host.querySelector(".phone-options-drawer") !== null,
          2000,
          "options drawer open (the phone OCT home)",
        );
        const drawer = host.querySelector<HTMLElement>(
          ".phone-options-drawer",
        )!;
        // i7-crit1 refinements A1 + A2 (durable teeth on the drawer's
        // presentation — the mechanics above are unchanged):
        // A1 — the OPTIONS toggle's OPEN lamp: the generic .booth-btn.is-on
        // alone rendered ink-on-fill glyphs on the unlit chassis fill
        // (1.2:1); the toggle now carries the INFO/VIZ warm-white lamp, so
        // the is-on glyph/bg pair must clear AA (4.5:1) with a real border.
        {
          const btn = optionsToggle;
          const cs = getComputedStyle(btn);
          const lum = (c: string): number => {
            const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(c);
            if (!m) return -1;
            if (m[4] !== undefined && Number(m[4]) === 0) return -1;
            const srgb = [1, 2, 3].map((i) => {
              const v = Number(m[i]) / 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
          };
          const l1 = lum(cs.color);
          const l2 = lum(cs.backgroundColor);
          expect(
            l1,
            "the open lamp paints a real glyph color",
          ).toBeGreaterThanOrEqual(0);
          expect(l2, "the open lamp paints a real fill").toBeGreaterThanOrEqual(
            0,
          );
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          expect(
            ratio,
            `OPTIONS is-on glyph/bg contrast ≥ 4.5:1 (was 1.2:1, ${cs.color} on ${cs.backgroundColor})`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(cs.borderColor).not.toBe("rgba(0, 0, 0, 0)");
        }
        // A2 — the E9 fence speaks PROSE: the shared UI/body voice (13px
        // sentence case in the active theme), never the compact uppercase
        // panel-label voice; the WORDING itself is byte-pinned.
        {
          const fence = drawer.querySelector<HTMLElement>(".phone-oct-fence")!;
          expect(fence).toBeTruthy();
          const cs = getComputedStyle(fence);
          expect(
            cs.fontSize,
            "the fence renders at the UI/body size (13px), not the 10px label voice",
          ).toBe("13px");
          expect(
            cs.textTransform,
            "instructional prose is never uppercased",
          ).toBe("none");
          expect(cs.fontFamily).toContain("Segoe UI");
          expect(cs.color).toBe(getComputedStyle(document.body).color);
          expect(fence.textContent).toBe(
            "Changes what you HEAR, not what you SEE — clamped at −3 and +3. The OCT/SEMI row scrolls the view.",
          );
        }
        const drawerOctReadout = (): string =>
          drawer
            .querySelector(`[data-help="lane.lead.oct"] .head-oct-value`)
            ?.textContent?.trim() ?? "";
        const octUp = drawer.querySelector<HTMLButtonElement>(
          'button[aria-label="Octave up for LEAD"]',
        )!;
        expect(octUp).toBeTruthy();
        expect(octUp.getClientRects().length).toBeGreaterThan(0);
        expect(octUp.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(drawerOctReadout()).toBe("0");
        octUp.click();
        await waitFor(
          () => octLiveOf(host, "lead") === "LEAD OCTAVE +1",
          2000,
          "OCT +1 from the phone drawer",
        );
        expect(laneOctave("lead")).toBe(1);
        expect(drawerOctReadout()).toBe("+1");
        optionsToggle.click(); // close the drawer (the grid keys need the seat)
        await waitFor(
          () => host.querySelector(".phone-options-drawer") === null,
          2000,
          "options drawer closed",
        );

        // Shift+arrows are grid keys everywhere; since M-5 the phone grid
        // is windowed, so the keys scroll the SAME RC-1 window as desktop —
        // a VIEW announcement (move or edge clamp, never silent) and the
        // grid name keeps the ROWS readout.
        const seed = [...laneHost(host, "lead").querySelectorAll(".cell")].find(
          (c) => c.tabIndex === 0,
        ) as HTMLElement;
        seed.focus();
        key(document.activeElement!, "ArrowDown", { shiftKey: true });
        await new Promise((r) => setTimeout(r, 120));
        expect(viewLiveOf(host, "lead")).toMatch(
          /^VIEW (AT BOTTOM|DOWN ONE OCTAVE)/,
        );
        expect(gridOf(host, "lead").getAttribute("aria-label")).toContain(
          "ROWS",
        );

        // PX-4 (phone tap-to-inspect): with info mode ON, TAPPING the OCT
        // group shows its refined entry — the KL-1 fence readable on the
        // phone path (title says OCTAVE; text says SOUND vs SEE/HEAR).
        // i7 N-2: at phone the group lives in the OPTIONS drawer.
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        optionsToggle.click();
        await waitFor(
          () => host.querySelector(".phone-options-drawer") !== null,
          2000,
          "options drawer open (tap-to-inspect)",
        );
        (
          host
            .querySelector(".phone-options-drawer")!
            .querySelector('[data-help="lane.lead.oct"]') as HTMLElement
        ).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await waitFor(
          () =>
            host.querySelector(".info-view-title")?.textContent?.trim() ===
            "LEAD OCTAVE",
          2000,
          "tap-to-inspect shows the LEAD OCTAVE entry",
        );
        const octInfo = host.querySelector(".info-view")?.textContent ?? "";
        expect(octInfo).toContain("SOUND");
        expect(octInfo).toContain("HEAR");
        setHelpMode(false);
        await waitFor(() => host.querySelector(".info-view") === null);
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
