/**
 * LY-1 browser gate — the 2×2 quadrant stage on the REAL BUILT APP:
 *
 * 1. ONE-PAGE LAW (iteration-2 AC #1/#4, plan LY-1): at 1440×900 the whole
 *    instrument — booth, rail, all four quadrants + their compact control
 *    strips — fits with ZERO page scrolling: documentElement scrollWidth/
 *    Height ≤ the viewport AND every booth/rail/strip bounding box inside
 *    it. Re-asserted after a 4-bar pattern joins (the Hulk extreme — long
 *    patterns scroll INSIDE quadrants, never the page).
 * 1b. REFINEMENT-4 (critique P2-5): the one-page law extends to the
 *    1280×800 tested minimum — BOTH axes. The pre-fix page measured
 *    1312×825 in an 800-px viewport (the rail box's content-box width:100%
 *    + its own 32 px padding = the horizontal breach; fixed 16/20 px
 *    quadrant row tracks = the vertical). Now the quadrant stage FLEXES
 *    within the 100dvh budget: row tracks compress per their own laws
 *    (floors: drums 20 px = the fill-rail control height, pitched 12 px =
 *    the Silkscreen label floor), no content loss (every row inside the
 *    viewport), 4-bar grids scroll inside quadrants as always, the
 *    entry-1 FX console and entry-2 euclid rail keep their pointer laws at
 *    1280, and a mid-session viewport resize recovers (1280 → 1440 → 1280:
 *    tracks restore to the committed scale, then compress again).
 * 2. E1 (a11y §7): every actual quadrant-selection change — by key AND by
 *    click — speaks `NOW EDITING <LANE>` through the stage role=status
 *    region (exists, labeled, not aria-hidden).
 * 3. E2: view-only quadrants are not focus traps — no cell tab stops, edit
 *    tier hidden out of the tab order, compact strips operable in ALL four
 *    quadrants (mute/solo/volume by keyboard while view-only), and the
 *    focus-carry law (selecting under a focused grid cell carries focus
 *    into the newly selected grid, clamped).
 * 4. E3: all four grid accessible names carry the edit state in text and
 *    flip with the selection.
 *
 * Synthetic-keyboard honesty (same law as DA-3): synthetic keydowns run the
 * app's handlers but carry no browser defaults; native-button activation is
 * replicated as focus + Enter keydown + click.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEW_W = 1440;
const VIEW_H = 900;

function poll(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      if (cond()) return resolve();
      if (performance.now() - t0 > timeoutMs)
        return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(check, 50);
    };
    check();
  });
}

describe("LY-1 quadrant layout (built app, 1440×900)", () => {
  it(
    "one page, no scrolling; selector announces; view-only quadrants are operable-not-traps",
    { timeout: 120_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      const iframe = document.createElement("iframe");
      iframe.style.width = `${VIEW_W}px`;
      iframe.style.height = `${VIEW_H}px`;
      document.body.appendChild(iframe);
      const win = iframe.contentWindow!;

      // Deterministic FIRST RUN (PX-1 demo).
      await new Promise<void>((resolve) => {
        const req = win.indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      const doc0 = iframe.contentDocument!;
      doc0.open();
      doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
      doc0.close();

      const idoc = () => iframe.contentDocument!;
      const $ = <T extends Element>(sel: string): T => {
        const el = idoc().querySelector<T>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        return el;
      };
      const $$ = <T extends Element>(sel: string): T[] =>
        Array.from(idoc().querySelectorAll<T>(sel));
      const key = (
        el: Element,
        k: string,
        opts: KeyboardEventInit = {},
      ): void => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
            ...opts,
          }),
        );
      };
      const active = (): HTMLElement | null =>
        idoc().activeElement as HTMLElement | null;
      const floor = (lane: string) =>
        $(`.lane-floor[data-lane="${lane}"]`) as HTMLElement;
      const gridOf = (lane: string) =>
        $(`.lane-floor[data-lane="${lane}"] [role="grid"]`);
      const statusText = () =>
        ($(".stage-status") as HTMLElement).textContent?.trim() ?? "";
      /** Native Enter activation (see header note). */
      const kbActivate = (el: Element): void => {
        (el as HTMLElement).focus();
        key(el, "Enter");
        (el as HTMLElement).click();
      };
      try {
        // --- BOOT ---------------------------------------------------------
        await poll(() => !!idoc().querySelector(".booth"), 15_000, "boot");
        await poll(
          () => $$(".rail-tile-cue").some((c) => c.textContent === "VERSE"),
          5_000,
          "demo cues",
        );
        expect($$(".lane-grid").length).toBe(4);

        // --- 1. ONE-PAGE LAW ----------------------------------------------
        const pageFits = () => {
          const de = idoc().documentElement;
          return (
            de.scrollWidth <= VIEW_W &&
            de.scrollHeight <= VIEW_H &&
            (idoc().body.scrollWidth ?? 0) <= VIEW_W &&
            (idoc().body.scrollHeight ?? 0) <= VIEW_H
          );
        };
        expect(pageFits(), `page must fit ${VIEW_W}×${VIEW_H}`).toBe(true);

        // Every booth/rail/strip bounding box inside the viewport.
        const insideViewport = (el: Element) => {
          const r = el.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.left >= 0 &&
            r.right <= VIEW_W + 0.5 &&
            r.bottom <= VIEW_H + 0.5
          );
        };
        expect(insideViewport($(".booth")), "booth inside viewport").toBe(true);
        expect(insideViewport($(".rail")), "rail inside viewport").toBe(true);
        for (const lane of ["drums", "bass", "chords", "lead"]) {
          const strip = floor(lane).querySelector(".lane-strip-compact")!;
          expect(
            insideViewport(strip),
            `${lane} control strip inside viewport`,
          ).toBe(true);
        }

        // --- 2. E3: names carry the edit state in text ---------------------
        // RC-1 journey delta (equal-window default): a WINDOWED pitched
        // grid's name appends `· ROWS a–b OF n` (E9) — assert the prefix +
        // the windowed/unwindowed split. i3-1 delta (vertical fill law):
        // the budget GROWS the lead window at this viewport — its 15-row
        // manifest may fit whole (the full-manifest law) or window just
        // under it — so the range is asserted against the LIVE window
        // state, never a hardcoded octave.
        const assertNames = (editing: string) => {
          for (const lane of ["drums", "bass", "chords", "lead"]) {
            const label = gridOf(lane).getAttribute("aria-label") ?? "";
            const state =
              lane === editing ? "EDITING" : "VIEW ONLY";
            const windowed = floor(lane)
              .querySelector(".lane-grid-scroll")!
              .classList.contains("is-windowed");
            // The demo's bass/chords manifests fit one octave; only the
            // 15-row lead manifest can window.
            if (lane !== "lead") {
              expect(label, `${lane} grid name (fits one window)`).toBe(
                `${lane.toUpperCase()} grid · ${state}`,
              );
              expect(windowed, `${lane} never windows`).toBe(false);
            } else if (windowed) {
              expect(
                label.startsWith(`LEAD grid · ${state} · ROWS `),
                "lead windowed name prefix",
              ).toBe(true);
              expect(
                label.endsWith(" OF 14"),
                "lead windowed name carries the manifest",
              ).toBe(true);
            } else {
              expect(
                label,
                "lead full-manifest name (fill-grown window)",
              ).toBe(`LEAD grid · ${state}`);
            }
          }
        };
        assertNames("drums");

        // --- 3. E2: view-only quadrants expose no tab stops ----------------
        for (const lane of ["bass", "chords", "lead"]) {
          const tabbableCells = [
            ...floor(lane).querySelectorAll<HTMLElement>(".cell"),
          ].filter((c) => c.tabIndex >= 0);
          expect(
            tabbableCells,
            `view-only ${lane} grid must have no cell tab stops`,
          ).toHaveLength(0);
          // Edit tier is display:none → out of the tab order entirely.
          const editRow =
            floor(lane).querySelector<HTMLElement>(".lane-strip-edit")!;
          expect(editRow.classList.contains("is-hidden")).toBe(true);
          expect(editRow.offsetParent).toBeNull();
        }
        // The selected grid owns exactly one (roving) tab stop.
        expect(
          [...floor("drums").querySelectorAll<HTMLElement>(".cell")].filter(
            (c) => c.tabIndex >= 0,
          ).length,
        ).toBe(1);

        // --- 4. E1 by KEY: PageDown selects + announces + carries -----------
        const drumsSeed = [
          ...floor("drums").querySelectorAll<HTMLElement>(".cell"),
        ].find((c) => c.tabIndex === 0)!;
        drumsSeed.focus();
        key(active() ?? drumsSeed, "ArrowDown"); // KICK → SNARE row
        key(active() ?? drumsSeed, "PageDown");
        await poll(
          () => statusText() === "NOW EDITING BASS",
          2_000,
          "NOW EDITING BASS announcement",
        );
        assertNames("bass");
        // Focus-carry law: the focused grid became view-only → focus carried.
        await poll(
          () =>
            active()?.classList.contains("cell") === true &&
            floor("bass").contains(active()),
          2_000,
          "focus carried into the bass grid",
        );
        expect(active()!.dataset.row).toBe("1"); // SNARE row index carried
        expect(active()!.dataset.step).toBe("0");

        // Edge clamp (no wrap): PageUp back to drums from bass.
        key(active()!, "PageUp");
        await poll(
          () => statusText() === "NOW EDITING DRUMS",
          2_000,
          "NOW EDITING DRUMS announcement",
        );

        // --- 5. E1 by CLICK: clicking a view-only quadrant selects it -------
        // Focus rests in the (now view-only) drums grid → the pointer law
        // CARRIES it into the newly selected grid (focus may never live in a
        // view-only grid).
        const leadCell = floor("lead").querySelector<HTMLElement>(".cell")!;
        leadCell.click();
        await poll(
          () => statusText() === "NOW EDITING LEAD",
          2_000,
          "NOW EDITING LEAD announcement (click path)",
        );
        assertNames("lead");
        await poll(
          () =>
            active()?.classList.contains("cell") === true &&
            floor("lead").contains(active()),
          2_000,
          "click under grid focus carries focus into lead",
        );

        // Mid-tweak is never yanked: focus a STRIP control (lead is now
        // selected; use the view-only BASS strip), select another quadrant by
        // pointer — focus STAYS on the strip control.
        const bassFloor = floor("bass");
        const bassMute = bassFloor.querySelector<HTMLButtonElement>(
          'button[aria-label="Mute BASS"]',
        )!;
        bassMute.focus();
        floor("chords").querySelector<HTMLElement>(".cell")!.click();
        await poll(
          () => statusText() === "NOW EDITING CHORDS",
          2_000,
          "NOW EDITING CHORDS announcement",
        );
        expect(active()).toBe(bassMute); // never yanked
        // --- 6. E2b: view-only strips stay operable (BASS, view-only) ------
        kbActivate(bassMute);
        await poll(
          () => bassMute.getAttribute("aria-pressed") === "true",
          2_000,
          "view-only bass MUTE operable",
        );
        // Undo reverts it (mix is document + undo, LY-1).
        key(bassMute, "z", { ctrlKey: true });
        await poll(
          () => bassMute.getAttribute("aria-pressed") === "false",
          2_000,
          "mix undo",
        );

        // SOLO on a view-only strip announces through the SAME region.
        const bassSolo = bassFloor.querySelector<HTMLButtonElement>(
          'button[aria-label="Solo BASS"]',
        )!;
        kbActivate(bassSolo);
        await poll(
          () => statusText() === "SOLO BASS",
          2_000,
          "SOLO BASS announcement",
        );
        expect(bassSolo.getAttribute("aria-pressed")).toBe("true");
        kbActivate(bassSolo); // off again — leave the mix clean
        await poll(
          () => statusText() === "SOLO OFF",
          2_000,
          "SOLO OFF announcement",
        );

        // VOLUME on a view-only strip: native range stepping commits.
        const bassVol = bassFloor.querySelector<HTMLInputElement>(
          'input[aria-label="BASS volume"]',
        )!;
        bassVol.focus();
        bassVol.value = "40";
        bassVol.dispatchEvent(new Event("input", { bubbles: true }));
        await poll(
          () => bassVol.getAttribute("aria-valuetext") === "40 percent",
          2_000,
          "view-only bass VOLUME commit",
        );

        // --- 7. `]`/`[` from a STRIP selects + lands in the grid -----------
        // (keyboard.md v2 key-scope rule: the strip-side escape hatch.)
        bassMute.focus();
        key(bassMute, "]"); // bass (index 1) → chords (index 2)
        await poll(
          () => statusText() === "NOW EDITING CHORDS",
          2_000,
          "] from a strip selects the next quadrant",
        );
        await poll(
          () =>
            active()?.classList.contains("cell") === true &&
            floor("chords").contains(active()),
          2_000,
          "strip ] lands focus in the chords grid",
        );

        // --- 8. E2c: carry-clamp into a SHORTER grid ------------------------
        // From the chords grid (7 rows), select DRUMS (5 rows) by pointer:
        // the carried row index clamps to the drums grid's bounds.
        for (let i = 0; i < 6; i++) key(active()!, "ArrowDown"); // row 6
        const drumsViewCell =
          floor("drums").querySelector<HTMLElement>(".cell")!;
        drumsViewCell.click();
        await poll(
          () => statusText() === "NOW EDITING DRUMS",
          2_000,
          "click-select drums",
        );
        await poll(
          () =>
            active()?.classList.contains("cell") === true &&
            floor("drums").contains(active()),
          2_000,
          "focus carried into drums",
        );
        expect(active()!.dataset.row).toBe("5"); // row 6 clamped to drums' 6 rows

        // --- 9. Status region contract (E1 axe-side assertions) ------------
        const status = $(".stage-status");
        expect(status.getAttribute("role")).toBe("status");
        expect(status.getAttribute("aria-live")).toBe("polite");
        expect(status.hasAttribute("aria-hidden")).toBe(false);
        expect(status.getAttribute("aria-label")).toBeTruthy();

        // --- 9b. FX CONSOLE AFFORDANCE (refinement-1, critique P1-1) ------
        // The pointer trap, proven gone ON THE BUILT APP: the console
        // chassis used to start at top:32px over the strip's edit row, so
        // its own FX toggle + the scale chip + GATE were pointer-dead and
        // elementFromPoint at their centers returned `.fx-strip`. Now: the
        // page still fits with the console open, the chassis starts below
        // the WHOLE strip, the five centers resolve to their controls, the
        // EMPTY console paints a visible boundary (demo drums chain is
        // empty), and Escape / CLOSE close it. Trusted-pointer twins (real
        // clicks) live in fx-console-trusted.test.tsx.
        const fxBTN = $<HTMLButtonElement>(
          '.lane-floor[data-lane="drums"] .head-fx',
        );
        fxBTN.click();
        await poll(
          () => !!idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "fx console opens",
        );
        expect(
          pageFits(),
          "page must still fit with the FX console open (overlay never grows the page)",
        ).toBe(true);
        const fxWrap = $(".lane-fx-wrap");
        const stripRect = floor("drums")
          .querySelector(".lane-head-strip")!
          .getBoundingClientRect();
        expect(fxWrap.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          stripRect.bottom - 0.5,
        );
        // Boundary + title chrome paint even with an empty chain (the
        // invisible empty-state console defect).
        const fxWin = idoc().defaultView!;
        const fxStyle = fxWin.getComputedStyle(fxWrap);
        expect(
          fxStyle.backgroundColor,
          "empty console chassis paints (was chassis-on-chassis)",
        ).not.toBe("rgba(0, 0, 0, 0)");
        expect(
          Number.parseFloat(fxStyle.borderTopWidth),
        ).toBeGreaterThanOrEqual(1);
        expect($(".lane-fx-title-name").textContent?.trim()).toBe("DRUMS FX");
        // The five formerly-occluded controls own their centers.
        const selfHit = (el: Element): boolean => {
          const r = el.getBoundingClientRect();
          const hit = idoc().elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return hit === el || el.contains(hit);
        };
        for (const sel of [
          ".head-fx",
          ".scale-chip",
          'button[aria-label="Shorter gate for DRUMS"]',
          'button[aria-label="Longer gate for DRUMS"]',
          '[aria-label="DRUMS gate length"] .head-ctl-label',
        ]) {
          const el = floor("drums").querySelector(sel)!;
          expect(selfHit(el), `${sel} must own its center`).toBe(true);
        }
        // Page-level Escape (focus outside the console): closes, focus
        // stays exactly where it was (help-mode precedent — no trap).
        const beforeEsc = active();
        key(idoc().body, "Escape");
        await poll(
          () => !idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "page-level Escape closes the console",
        );
        expect(active()).toBe(beforeEsc);
        // Covered-grid Escape: console closes INSTEAD of the region-head
        // pop — focus stays on the cell (one consumer per keystroke).
        fxBTN.click();
        await poll(
          () => !!idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "reopen",
        );
        const drumCell = floor("drums").querySelector<HTMLElement>(".cell")!;
        drumCell.focus();
        key(drumCell, "Escape");
        await poll(
          () => !idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "covered-grid Escape closes the console",
        );
        expect(active()).toBe(drumCell);
        // The CLOSE affordance (title strip, outside the occluded zone).
        fxBTN.click();
        await poll(
          () => !!idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "reopen for CLOSE",
        );
        $(".lane-fx-close").click();
        await poll(
          () => !idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "CLOSE button closes the console",
        );

        // --- 9c. EUCLID FILL-RAIL GEOMETRY (refinement-2, critique P1-2) ---
        // The pointer-dead SET, proven fixed ON THE BUILT APP: the 104 px
        // fill slot was narrower than its ~200 px control stack, so the
        // control overflowed UNDER the row cells (SET at x286–321 past the
        // cells' x233; elementFromPoint returned a `.cell`; real clicks
        // timed out). Now: every drum row's control fits its rail AND clears
        // the cells, all six SET buttons own their centers, the 1-bar demo
        // quadrant keeps its internal no-scroll at 1440×900 (the widened
        // rail re-budgeted INSIDE the quadrant — 72+228+350=650 ≤ its 666
        // px gut), and the one-page law is untouched. Trusted-pointer twins
        // (real clicks + preview/commit) live in euclid-fill-trusted.test.tsx.
        for (let row = 0; row < 6; row++) {
          const rail = floor("drums").querySelector(
            `.row-fill[data-row="${row}"]`,
          ) as HTMLElement;
          const ctl = rail.querySelector(".row-fill-ctl") as HTMLElement;
          const cells = [...floor("drums").querySelectorAll(".grid-row")][
            row
          ]!.querySelector(".row-cells")!;
          expect(rail.style.width, `row ${row} rail pinned inline`).toBe(
            "220px",
          );
          expect(
            ctl.getBoundingClientRect().right,
            `row ${row} fill control clears the cells`,
          ).toBeLessThanOrEqual(cells.getBoundingClientRect().left + 0.5);
          const set = rail.querySelector(".row-fill-apply")!;
          const r = set.getBoundingClientRect();
          const hit = idoc().elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          expect(
            hit === set || set.contains(hit!),
            `row ${row} SET must own its center (was a .cell)`,
          ).toBe(true);
        }
        const drumsScroll = floor("drums").querySelector(
          ".lane-grid-scroll",
        ) as HTMLElement;
        expect(
          drumsScroll.scrollWidth,
          "1-bar demo drums quadrant needs no internal scroll after the widening",
        ).toBeLessThanOrEqual(drumsScroll.clientWidth);
        expect(pageFits(), "page still fits with the widened rail").toBe(true);

        // --- 10. One-page law under the Hulk extreme (4-bar pattern) -------
        // LL-1 journey delta: the +4B menu button retired with the LENGTH
        // stepper — the honest path is select the lead quadrant, then the
        // global `b` ladder ×2 on its selected pattern (the lead quadrant
        // grid remounts to the 4-bar shape → internal h-scroll).
        $<HTMLElement>('.lane-floor[data-lane="lead"]').click();
        await new Promise((r) => setTimeout(r, 150));
        for (const k of ["b", "b"]) {
          idoc().body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        await poll(() => {
          const rows = floor("lead").querySelectorAll(".grid-row");
          return (
            rows.length > 0 &&
            floor("lead").querySelectorAll(".cell").length === rows.length * 64
          );
        }, 5_000, "4-bar lead pattern rendered (64 steps per row)");
        expect(
          pageFits(),
          "page must still fit with a 4-bar pattern (grid scrolls inside its quadrant, never the page)",
        ).toBe(true);
        const strip = floor("lead").querySelector(".lane-strip-compact")!;
        expect(insideViewport(strip)).toBe(true);
      } finally {
        // R14 teardown: remove the iframe (closes its DB connections), then
        // wipe the shared-origin IndexedDB with retries.
        iframe.remove();
        for (let attempt = 0; ; attempt++) {
          const deleted = await new Promise<boolean>((resolve) => {
            const req = indexedDB.deleteDatabase("bitbounce");
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(true);
            req.onblocked = () => resolve(false);
          });
          if (deleted || attempt >= 20) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    },
    120_000,
  );

  it(
    "refinement-4: 1280×800 one page on BOTH axes; quadrants flex within the 100dvh budget; resize recovers",
    { timeout: 120_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(bundleKey, "built bundle missing").toBeTruthy();
      expect(cssKey).toBeTruthy();

      const MIN_W = 1280;
      const MIN_H = 800;

      const iframe = document.createElement("iframe");
      iframe.style.width = `${MIN_W}px`;
      iframe.style.height = `${MIN_H}px`;
      document.body.appendChild(iframe);
      const win = iframe.contentWindow!;

      await new Promise<void>((resolve) => {
        const req = win.indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      const doc0 = iframe.contentDocument!;
      doc0.open();
      doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
      doc0.close();

      const idoc = () => iframe.contentDocument!;
      const $ = <T extends Element>(sel: string): T => {
        const el = idoc().querySelector<T>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        return el;
      };
      /** The one-page law at an explicit viewport size. */
      const fits = (w: number, h: number): boolean => {
        const de = idoc().documentElement;
        return (
          de.scrollWidth <= w &&
          de.scrollHeight <= h &&
          (idoc().body.scrollWidth ?? 0) <= w &&
          (idoc().body.scrollHeight ?? 0) <= h
        );
      };
      const trackOf = (lane: string): number =>
        Number.parseFloat(
          idoc()!.querySelector<HTMLElement>(
            `.lane-floor[data-lane="${lane}"] .row-cells`,
          )!.style.gridAutoRows,
        );

      try {
        await poll(() => !!idoc().querySelector(".booth"), 15_000, "boot");
        await poll(
          () =>
            Array.from(idoc().querySelectorAll(".rail-tile-cue")).some(
              (c) => c.textContent === "VERSE",
            ),
          5_000,
          "demo cues",
        );
        // Let the budget fit settle (fonts + first observers). Teeth note:
        // on a revert of the entry-4 fixes this poll times out and the
        // assertion below reports the measured breach (was 1312×825).
        let settled = false;
        try {
          await poll(() => fits(MIN_W, MIN_H), 5_000, "1280 fit settle");
          settled = true;
        } catch {
          settled = false;
        }
        const de = idoc().documentElement;
        expect(
          settled,
          `page must fit ${MIN_W}×${MIN_H} on BOTH axes (measured ${de.scrollWidth}×${de.scrollHeight} — pre-fix 1312×825)`,
        ).toBe(true);
        // --- 1b-1. THE BREACH, BOTH AXES --------------------------------
        // Pre-fix: 1312 × 825 in an 1280 × 800 viewport (25 px page v-scroll
        // + 32 px page h-scroll — the entry-2 verifier's recorded deltas).
        expect(de.scrollWidth, "no horizontal page scroll").toBeLessThanOrEqual(
          MIN_W,
        );
        expect(de.scrollHeight, "no vertical page scroll").toBeLessThanOrEqual(
          MIN_H,
        );
        // The rail box itself sits inside the viewport (was right = 1312).
        expect(
          $(".rail").getBoundingClientRect().right,
          "rail box inside viewport",
        ).toBeLessThanOrEqual(MIN_W + 0.5);

        // --- 1b-2. Quadrants flexed per their own laws, no content loss --
        // i3-1 delta (the VERTICAL FILL LAW): the budget share now GROWS
        // each lane — register-window rows first (whole-row quantized),
        // then row scale within the committed clamp [cellPx, 24px]. At the
        // 1280×800 minimum every lane's share admits the 24px clamp (the
        // world's own v0/phone editing-row scale), and the 15-row lead
        // manifest windows ABOVE one octave; the readability floors (drums
        // 20 / pitched 11) stay the compression boundary for real deficits,
        // which the windows prevent at the tested minimums. The full
        // manifest stays in the DOM; every VISIBLE row is inside the
        // viewport (the one-page law is a page law, not a pane law).
        const bassTrack = trackOf("bass");
        expect(
          bassTrack,
          "bass tracks fill-grown to the committed 24px clamp",
        ).toBe(24);
        expect(trackOf("drums"), "drums fills to the 24px clamp").toBe(24);
        for (const lane of ["drums", "bass", "chords", "lead"]) {
          const track = trackOf(lane);
          expect(
            track,
            `${lane} track within the fill clamp`,
          ).toBeGreaterThanOrEqual(lane === "drums" ? 20 : 16);
          expect(track).toBeLessThanOrEqual(24);
          const scroll = $(
            `.lane-floor[data-lane="${lane}"] .lane-grid-scroll`,
          ) as HTMLElement;
          const rows = Array.from(
            $(`.lane-floor[data-lane="${lane}"]`).querySelectorAll(".grid-row"),
          );
          expect(rows.length, `${lane} full manifest stays in the DOM`).toBe(
            lane === "drums" ? 6 : lane === "bass" ? 7 : lane === "chords" ? 7 : 15,
          );
          const box = scroll.getBoundingClientRect();
          const visible = rows.filter((row) => {
            const r = row.getBoundingClientRect();
            return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
          });
          if (lane === "lead") {
            // The fill law: the lead window holds AT LEAST the one-octave
            // default, grown by the budget share (never past the manifest).
            expect(
              visible.length,
              "lead window grown past one octave",
            ).toBeGreaterThanOrEqual(8);
            expect(visible.length).toBeLessThanOrEqual(15);
          } else {
            expect(
              visible.length,
              `${lane} full manifest visible (fits one window)`,
            ).toBe(lane === "drums" ? 6 : 7);
          }
          expect(
            visible[visible.length - 1]!.getBoundingClientRect().height,
            `${lane} rows render at full track height`,
          ).toBe(
            Number.parseFloat(
              getComputedStyle(rows[0].querySelector(".row-cells")!)
                .gridAutoRows,
            ),
          );
        }

        // --- 1b-3. Entry-2 euclid law at 1280 (no occlusion regression) --
        for (let row = 0; row < 6; row++) {
          const rail = $(
            `.lane-floor[data-lane="drums"] .row-fill[data-row="${row}"]`,
          );
          expect(rail.style.width, `row ${row} rail pinned`).toBe("220px");
          const set = rail.querySelector(".row-fill-apply")!;
          const r = set.getBoundingClientRect();
          const hit = idoc().elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          expect(
            hit === set || set.contains(hit!),
            `row ${row} SET owns its center at 1280`,
          ).toBe(true);
        }

        // --- 1b-4. Entry-1 FX console law at 1280 --------------------------
        $(".lane-floor[data-lane='drums'] .head-fx").click();
        await poll(
          () => !!idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "fx console opens at 1280",
        );
        expect(
          fits(MIN_W, MIN_H),
          "page fits with the FX console open at 1280 (overlay never grows the page)",
        ).toBe(true);
        const fxWrap = $(".lane-fx-wrap");
        const stripRect = $(
          `.lane-floor[data-lane="drums"] .lane-head-strip`,
        ).getBoundingClientRect();
        expect(fxWrap.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          stripRect.bottom - 0.5,
        );
        for (const sel of [
          ".head-fx",
          ".scale-chip",
          'button[aria-label="Shorter gate for DRUMS"]',
          'button[aria-label="Longer gate for DRUMS"]',
          '[aria-label="DRUMS gate length"] .head-ctl-label',
        ]) {
          const el = $(`.lane-floor[data-lane="drums"] ${sel}`);
          const r = el.getBoundingClientRect();
          const hit = idoc().elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          expect(
            hit === el || el.contains(hit!),
            `${sel} self-hits at 1280`,
          ).toBe(true);
        }
        idoc().body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await poll(
          () => !idoc().querySelector(".lane-fx-wrap"),
          2_000,
          "Escape closes the console at 1280",
        );

        // --- 1b-5. Mid-session resize: rotation recovery ------------------
        // 1280×800 → 1440×900: the fill re-distributes the bigger share —
        // the lead window grows to its manifest budget (the window count is
        // the recovery signal; the tracks sit at the 24px clamp on BOTH
        // sides of the crossing, so the window is the honest discriminator)
        // and the entry-2 §9c law (1-bar drums, no internal scroll) holds
        // at every step.
        iframe.style.width = `${VIEW_W}px`;
        iframe.style.height = `${VIEW_H}px`;
        await poll(
          () => trackOf("bass") === 24 && trackOf("lead") >= 17,
          5_000,
          "the fill re-distributes the 1440×900 share",
        );
        expect(
          fits(VIEW_W, VIEW_H),
          "page fits after growing to 1440×900",
        ).toBe(true);
        const drumsScroll = $(
          `.lane-floor[data-lane="drums"] .lane-grid-scroll`,
        );
        expect(
          drumsScroll.scrollWidth,
          "1-bar drums no-internal-scroll law restored at 1440",
        ).toBeLessThanOrEqual(drumsScroll.clientWidth);
        // …and back down to the minimum: the share shrinks, the lead window
        // re-quantizes DOWN (never below the one-octave default), tracks
        // hold inside the clamp, and the page still fits.
        iframe.style.width = `${MIN_W}px`;
        iframe.style.height = `${MIN_H}px`;
        await poll(
          () => trackOf("bass") === 24 && trackOf("lead") === 16,
          5_000,
          "the fill re-quantizes back down at 1280×800",
        );
        expect(fits(MIN_W, MIN_H), "page fits back at 1280×800").toBe(true);

        // --- 1b-6. Hulk extreme at the minimum ----------------------------
        // LL-1 journey delta: the +4B menu button retired with the LENGTH
        // stepper — select the lead quadrant, then the global `b` ladder.
        $(`.lane-floor[data-lane="lead"]`).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await new Promise((r) => setTimeout(r, 150));
        for (const k of ["b", "b"]) {
          idoc().body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        await poll(() => {
          const rows = $(`.lane-floor[data-lane="lead"]`).querySelectorAll(
            ".grid-row",
          );
          return (
            rows.length > 0 &&
            $(`.lane-floor[data-lane="lead"]`).querySelectorAll(".cell")
              .length ===
              rows.length * 64
          );
        }, 5_000, "4-bar lead pattern rendered at 1280 (64 steps per row)");
        expect(
          fits(MIN_W, MIN_H),
          "page fits with a 4-bar pattern at 1280×800 (grid scrolls inside its quadrant, never the page)",
        ).toBe(true);
        const leadScroll = $(`.lane-floor[data-lane="lead"] .lane-grid-scroll`);
        expect(
          leadScroll.scrollWidth,
          "the 4-bar grid scrolls INSIDE its quadrant",
        ).toBeGreaterThan(leadScroll.clientWidth);

        // --- 1b-7. Tallest-lane editing at the minimum --------------------
        // i3-1 delta: the tallest lane's EDITING state (strip edit tier +
        // editing row margins) still fills its share lawfully at 1280×800 —
        // the window takes the rows first, tracks hold within the clamp,
        // and the readability floor stays the compression boundary for real
        // deficits (which the windows prevent at the tested minimums).
        $(`.lane-floor[data-lane="bass"] .cell`).click();
        await poll(
          () => $(`.lane-floor[data-lane="bass"]`).dataset.editing === "true",
          2_000,
          "bass selected at 1280",
        );
        await poll(
          () =>
            trackOf("bass") >= 16 && trackOf("bass") <= 24 && fits(MIN_W, MIN_H),
          5_000,
          "bass editing fit at 1280",
        );
        expect(
          fits(MIN_W, MIN_H),
          "page fits with the tallest lane editing at 1280×800",
        ).toBe(true);
      } finally {
        // R14 teardown (same law as above).
        iframe.remove();
        for (let attempt = 0; ; attempt++) {
          const deleted = await new Promise<boolean>((resolve) => {
            const req = indexedDB.deleteDatabase("bitbounce");
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(true);
            req.onblocked = () => resolve(false);
          });
          if (deleted || attempt >= 20) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    },
    120_000,
  );
});
