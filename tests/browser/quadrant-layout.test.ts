/**
 * LY-1 browser gate — the 2×2 quadrant stage on the REAL BUILT APP:
 *
 * 1. ONE-PAGE LAW (iteration-2 AC #1/#4, plan LY-1): at 1440×900 the whole
 *    instrument — booth, rail, all four quadrants + their compact control
 *    strips — fits with ZERO page scrolling: documentElement scrollWidth/
 *    Height ≤ the viewport AND every booth/rail/strip bounding box inside
 *    it. Re-asserted after a 4-bar pattern joins (the Hulk extreme — long
 *    patterns scroll INSIDE quadrants, never the page).
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
        const assertNames = (editing: string) => {
          for (const lane of ["drums", "bass", "chords", "lead"]) {
            const label = gridOf(lane).getAttribute("aria-label") ?? "";
            expect(label, `${lane} grid name`).toBe(
              `${lane.toUpperCase()} grid · ${lane === editing ? "EDITING" : "VIEW ONLY"}`,
            );
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
          const cells = [
            ...floor("drums").querySelectorAll(".grid-row"),
          ][row]!.querySelector(".row-cells")!;
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
        const add4B = $<HTMLButtonElement>(
          '.rail-row[data-lane="lead"] button[aria-label="Add 4-bar pattern to LEAD"]',
        );
        // Clicking a rail tool adds AND selects the pattern (the lead
        // quadrant grid switches to the 4-bar shape → internal h-scroll).
        add4B.click();
        await poll(
          () =>
            (floor("lead").querySelectorAll(".cell").length ?? 0) === 14 * 64,
          5_000,
          "4-bar lead pattern rendered (14 rows × 64 steps)",
        );
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
});
