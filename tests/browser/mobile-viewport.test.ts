/**
 * MB-1 browser gate — the responsive stage on the REAL BUILT APP (town-hall
 * mobile addendum m1 layout half + m4; the plan's AC):
 *
 * 1. PHONE 390×844 — the committed model: lane switcher (tabs) IS quadrant
 *    selection (drives selection.activeLane, `NOW EDITING <LANE>`
 *    announcements hold); sticky chrome (transport + switcher + condensed
 *    rail) never scrolls away mid-scroll; the scrolling-grid law — rows
 *    scroll vertically with the document, a 1-BAR pattern needs NO
 *    horizontal scroll (the default view), 2-bar patterns scroll
 *    horizontally INSIDE the grid, and the page never h-scrolls. The other
 *    three lanes DO NOT RENDER at phone width (no view-only quadrants, no
 *    focus traps by construction).
 * 2. PHONE 360×800 — the same laws at the tighter viewport + the usable-
 *    grid budget (sticky chrome must not eat the majority of the viewport —
 *    the plan's return-to-Town-Hall flag, asserted as a hard law here).
 * 3. TABLET 768×1024 — the 2×2 quadrant stage responsively scaled: four
 *    quadrants on ONE page (both axes), narrow geometry (a 1-bar drums row
 *    fits its quadrant with NO internal h-scroll), the entry-4 flex fit
 *    compressing tracks within its floors, selection laws unchanged.
 * 4. DESKTOP boundary (1024×768 + 1280×800) — the desktop law is the
 *    desktop law (m4): ≥1024 keeps the quadrant stage + the one-page law;
 *    deep byte-identity is quadrant-layout.test.ts's own gate, re-run in
 *    the same battery.
 * 5. ROTATION / re-budget (mid-session viewport transitions, the entry-4
 *    re-fit law extended): 390×844 phone → 844×390 (a ROTATED PHONE keeps
 *    the phone law — width ≥768 but height <600) → 768×1024 tablet (2×2
 *    one page) → 1280×800 desktop (quadrants, one page). The stage re-derives
 *    live; no reload, no stuck state.
 *
 * Synthetic-input honesty (the suite's law): synthetic keydowns run the
 * app's handlers; native-button activation = focus + Enter + click.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const LANES = ["drums", "bass", "chords", "lead"] as const;

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

/** A deterministic first-run boot (PX-1 demo) in a sized iframe. */
async function bootIframe(
  w: number,
  h: number,
): Promise<{
  iframe: HTMLIFrameElement;
  win: Window;
  $: <T extends Element>(sel: string) => T;
  $$: <T extends Element>(sel: string) => T[];
  idoc: () => Document;
}> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(
    bundleKey,
    "built bundle missing (globalSetup build failed?)",
  ).toBeTruthy();
  const iframe = document.createElement("iframe");
  iframe.style.width = `${w}px`;
  iframe.style.height = `${h}px`;
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
  const $$ = <T extends Element>(sel: string): T[] =>
    Array.from(idoc().querySelectorAll<T>(sel));
  await poll(() => !!idoc().querySelector(".booth"), 15_000, "boot");
  // The demo chain booted (its drums chain carries >1 tile; a default
  // project would have exactly one). The quadrant gates wait on the VERSE
  // cue, but at phone width only the ACTIVE lane's rail row renders, so the
  // cue may live on an unrendered lane — the tile count is the honest
  // phone-mode boot signal.
  await poll(() => $$(".rail-tile").length >= 2, 5_000, "demo chain tiles");
  return { iframe, win, $, $$, idoc };
}

/** R14 teardown: close live connections, then wipe the shared-origin DB. */
async function teardown(iframe: HTMLIFrameElement): Promise<void> {
  iframe.remove();
  for (let i = 0; i < 20; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = () => resolve();
        req.onblocked = () => reject(new Error("blocked"));
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

describe("MB-1 responsive stage (built app)", () => {
  it(
    "phone 390×844: lane switcher IS selection; sticky chrome; scrolling-grid law",
    { timeout: 120_000 },
    async () => {
      const W = 390;
      const H = 844;
      const { iframe, win, $, $$, idoc } = await bootIframe(W, H);
      const key = (el: Element, k: string): void => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      try {
        // --- the phone stage mounts --------------------------------------
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone",
        );
        expect($$(".lane-switch-tab")).toHaveLength(4);
        // The other three lanes DO NOT RENDER — no view-only quadrants, no
        // focus traps by construction (exactly one floor + one grid).
        expect($$(".lane-floor")).toHaveLength(1);
        expect($$(".lane-grid")).toHaveLength(1);
        expect($(".lane-floor").dataset.lane).toBe("drums");

        // Tabs semantics: roving tabindex — exactly ONE tab stop, the active
        // lane; every tab carries aria-selected + aria-controls.
        const tabs = $$(".lane-switch-tab");
        expect(
          tabs.filter((t) => t.tabIndex === 0),
          "exactly one switcher tab stop",
        ).toHaveLength(1);
        for (const tab of tabs) {
          expect(tab.getAttribute("aria-controls")).toBe("lane-stage");
        }
        expect(
          tabs.find((t) => t.getAttribute("aria-selected") === "true")!.dataset
            .lane,
        ).toBe("drums");
        // The stage panel is the tabs' honest target.
        expect($("#lane-stage").getAttribute("role")).toBe("tabpanel");

        // --- lane reachability: every lane via the switcher ----------------
        // (drums is already the active lane — selecting it again is a no-op
        // by law, so the announcement walk starts from the first CHANGE.)
        for (const lane of ["bass", "chords", "lead", "drums"] as const) {
          ($(`.lane-switch-tab[data-lane="${lane}"]`) as HTMLElement).click();
          await poll(
            () =>
              $(".stage-status").textContent?.trim() ===
              `NOW EDITING ${lane.toUpperCase()}`,
            2_000,
            `NOW EDITING ${lane.toUpperCase()} announcement`,
          );
          expect($$(".lane-floor")).toHaveLength(1);
          expect($(".lane-floor").dataset.lane).toBe(lane);
          // The single grid is the EDITING grid (E3 names carry the state).
          expect($(".lane-grid").getAttribute("aria-label")).toBe(
            `${lane.toUpperCase()} grid · EDITING`,
          );
          // The condensed rail follows the selection (one row, the lane's).
          expect($$(".rail-row")).toHaveLength(1);
          expect($(".rail-row").dataset.lane).toBe(lane);
          expect($(".rail-head").offsetParent).toBeNull(); // head hidden
        }

        // Keyboard: ArrowRight on the switcher selects + focuses the next
        // lane (tabs convention — the announcement law still holds). Focus
        // and selection agree by construction (focus follows selection), so
        // the arrow walks from the ACTIVE lane — drums after the loop above.
        const drumsTab = $(
          `.lane-switch-tab[data-lane="drums"]`,
        ) as HTMLElement;
        drumsTab.focus();
        key(drumsTab, "ArrowRight");
        await poll(
          () => $(".stage-status").textContent?.trim() === "NOW EDITING BASS",
          2_000,
          "ArrowRight → NOW EDITING BASS",
        );
        expect(
          ($(`.lane-switch-tab[data-lane="bass"]`) as HTMLElement).tabIndex,
        ).toBe(0);

        // --- the scrolling-grid law ----------------------------------------
        // Rows scroll vertically with the document: the LEAD lane (tallest)
        // grows the document past the viewport and scrolls.
        ($(`.lane-switch-tab[data-lane="lead"]`) as HTMLElement).click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          2_000,
          "lead stage",
        );
        const de = () => idoc().documentElement;
        expect(
          de().scrollWidth,
          "page never h-scrolls (width)",
        ).toBeLessThanOrEqual(W);
        expect(
          de().scrollHeight,
          "tall lane document exceeds the viewport (rows scroll)",
        ).toBeGreaterThan(H);
        win.scrollTo(0, 400);
        await new Promise((r) => setTimeout(r, 150));
        expect(win.scrollY).toBeGreaterThan(0);

        // Sticky chrome mid-scroll: the pinned group stays at the top and
        // every chrome box stays fully inside the viewport.
        const chrome = $(".phone-chrome").getBoundingClientRect();
        expect(Math.abs(chrome.top)).toBeLessThanOrEqual(1);
        for (const [sel, what] of [
          [".booth", "transport"],
          [".lane-switcher", "lane switcher"],
          [".rail", "condensed rail"],
        ] as const) {
          const box = $(sel).getBoundingClientRect();
          expect(
            box.top,
            `${what} pinned below the chrome top`,
          ).toBeGreaterThanOrEqual(-0.5);
          expect(box.bottom, `${what} inside the viewport`).toBeLessThanOrEqual(
            H + 0.5,
          );
        }

        // 1-BAR pattern needs NO horizontal scroll (the default view): drive
        // the PAT menu (+1B — the refinement-6 commit-and-close law).
        ($(`.lane-switch-tab[data-lane="drums"]`) as HTMLElement).click();
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          2_000,
          "drums stage",
        );
        const openAddBars = async (bars: number) => {
          ($(".rail-tools-trigger") as HTMLElement).click();
          await poll(
            () => !!idoc().querySelector(".rail-tools-menu"),
            2_000,
            "PAT menu",
          );
          const btn = $$(".rail-tool").find(
            (b) =>
              b.getAttribute("aria-label") ===
              `Add ${bars}-bar pattern to DRUMS`,
          )! as HTMLElement;
          btn.click();
          await poll(
            () => !idoc().querySelector(".rail-tools-menu"),
            2_000,
            "PAT menu closes after commit",
          );
        };
        await openAddBars(1);
        await poll(
          () =>
            $(".lane-grid-scroll").querySelectorAll(".cell").length === 16 * 6,
          3_000,
          "fresh 1-bar drums pattern (6 rows × 16 steps)",
        );
        const scroll1 = $(".lane-grid-scroll") as HTMLElement;
        expect(scroll1.scrollWidth).toBeLessThanOrEqual(
          scroll1.clientWidth + 1,
          "1-bar pattern needs no horizontal scroll",
        );
        expect(de().scrollWidth).toBeLessThanOrEqual(W);

        // 2-BAR pattern scrolls horizontally INSIDE the grid; the page still
        // never h-scrolls; the strip actually scrolls.
        await openAddBars(2);
        await poll(
          () =>
            $(".lane-grid-scroll").querySelectorAll(".cell").length === 32 * 6,
          3_000,
          "fresh 2-bar drums pattern (6 rows × 32 steps)",
        );
        const scroll2 = $(".lane-grid-scroll") as HTMLElement;
        expect(
          scroll2.scrollWidth,
          "2-bar pattern h-scrolls inside the grid",
        ).toBeGreaterThan(scroll2.clientWidth);
        expect(
          de().scrollWidth,
          "2-bar never h-scrolls the page",
        ).toBeLessThanOrEqual(W);
        scroll2.scrollLeft = 80;
        expect(scroll2.scrollLeft).toBeGreaterThan(0);

        // --- narrow grid geometry laws ------------------------------------
        // Phone rows restore the v0 24px editing scale; 16 step columns; the
        // labels never clip (the 60px OPENHAT floor).
        const cells = $(".row-cells");
        expect(getComputedStyle(cells).gridAutoRows).toBe("24px");
        expect(
          getComputedStyle(cells).gridTemplateColumns.split(" "),
        ).toHaveLength(32); // (the 2-bar pattern is displayed)
        for (const label of $$(".row-label")) {
          expect(
            label.scrollWidth,
            `label ${label.textContent} clips its gutter`,
          ).toBeLessThanOrEqual(label.clientWidth);
        }
        // The drums fill rail is the narrow OVERLAY: out of flow, anchored at
        // the label gutter, hidden-but-focusable (reveal on :focus-within —
        // MB-3's tap twin lands on this exact structure).
        const fill = $(".row-fill");
        expect(fill.classList.contains("is-overlay")).toBe(true);
        expect(getComputedStyle(fill).position).toBe("absolute");
        expect(getComputedStyle(fill).opacity).toBe("0");
        const playhead = $(".grid-playhead") as HTMLElement;
        expect(
          playhead.style.left,
          "playhead offset = the label alone (overlay is out of flow)",
        ).toBe("60px");
        // Reveal law: the overlay's steppers are always-enabled tab stops —
        // focusing one reveals the rail (SET stays disabled until armed, so
        // the stepper is the honest focus probe). MB-3's tap twin lands on
        // this exact structure.
        const stepBtn = fill.querySelector<HTMLElement>(
          '[aria-label="More pulses for KICK fill"]',
        )!;
        expect(stepBtn.tabIndex).toBeGreaterThanOrEqual(0);
        stepBtn.focus();
        await new Promise((r) => setTimeout(r, 350)); // the 120ms ease settles
        expect(
          Number.parseFloat(getComputedStyle(fill).opacity),
          "focus reveals the overlay",
        ).toBeGreaterThanOrEqual(0.99);
        expect(getComputedStyle(fill).pointerEvents).toBe("auto");
        stepBtn.blur();
      } finally {
        await teardown(iframe);
      }
    },
  );

  it(
    "phone 360×800: same laws at the tight viewport + the usable-grid budget",
    { timeout: 120_000 },
    async () => {
      const W = 360;
      const H = 800;
      const { iframe, win, $, $$, idoc } = await bootIframe(W, H);
      try {
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone",
        );
        // The page never h-scrolls at the tightest phone width.
        expect(idoc().documentElement.scrollWidth).toBeLessThanOrEqual(W);

        // The tallest lane scrolls and the chrome stays pinned mid-scroll.
        ($(`.lane-switch-tab[data-lane="lead"]`) as HTMLElement).click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          2_000,
          "lead stage",
        );
        win.scrollTo(0, 400);
        await new Promise((r) => setTimeout(r, 150));
        expect(
          Math.abs($(".phone-chrome").getBoundingClientRect().top),
        ).toBeLessThanOrEqual(1);

        // The usable-grid budget (the return-to-Town-Hall flag as a hard
        // law): sticky chrome must NOT eat the majority of the viewport, and
        // the visible stage below it stays a usable editing area (≥ 40% of
        // the viewport height).
        const chromeH = $(".phone-chrome").getBoundingClientRect().height;
        expect(chromeH, "chrome under half the viewport").toBeLessThan(H / 2);
        expect(H - chromeH, "usable stage height").toBeGreaterThanOrEqual(
          H * 0.4,
        );

        // 1-bar default view still fits (the tight case: label 60 + 16×17).
        ($(`.lane-switch-tab[data-lane="drums"]`) as HTMLElement).click();
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          2_000,
          "drums stage",
        );
        const scroll = $(".lane-grid-scroll") as HTMLElement;
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
        expect(idoc().documentElement.scrollWidth).toBeLessThanOrEqual(W);
        expect($$(".lane-floor")).toHaveLength(1);
      } finally {
        await teardown(iframe);
      }
    },
  );

  it(
    "tablet 768×1024: 2×2 quadrants responsively scaled, one page, narrow geometry",
    { timeout: 120_000 },
    async () => {
      const W = 768;
      const H = 1024;
      const { iframe, $, $$ } = await bootIframe(W, H);
      try {
        await poll(
          () => $(".app").getAttribute("data-stage") === "tablet",
          5_000,
          "data-stage=tablet",
        );
        // No lane switcher on the quadrant stage (it is the phone surface).
        expect($$(".lane-switcher")).toHaveLength(0);

        // The quadrant stage stays 2×2: four floors + four grids + full rail.
        expect($$(".lane-floor")).toHaveLength(4);
        expect($$(".lane-grid")).toHaveLength(4);
        expect($$(".rail-row")).toHaveLength(4);

        // ONE PAGE, both axes (m1 tablet clause). Settle first — the webfont
        // race is real (refinement-7's recorded correction): the fit lawfully
        // refuses to compress on provisional metrics, so a cold boot honestly
        // reads tall for ~100ms.
        const fits = () =>
          iframe.contentDocument!.documentElement.scrollWidth <= W &&
          iframe.contentDocument!.documentElement.scrollHeight <= H;
        await poll(fits, 5_000, "tablet one-page (both axes)");
        expect(fits()).toBe(true);

        // Narrow geometry: a 1-bar drums row fits its quadrant with NO
        // internal h-scroll (the overlay fill rail freed the width budget).
        const drumsScroll = $(
          '.lane-floor[data-lane="drums"] .lane-grid-scroll',
        ) as HTMLElement;
        expect(drumsScroll.scrollWidth).toBeLessThanOrEqual(
          drumsScroll.clientWidth + 1,
          "1-bar drums quadrant needs no internal scroll at 768",
        );
        // The overlay fill + the compressed/narrow tracks (the entry-4 fit
        // within the narrow floors).
        const fill = $(
          '.lane-floor[data-lane="drums"] .row-fill',
        ) as HTMLElement;
        expect(fill.classList.contains("is-overlay")).toBe(true);
        for (const lane of LANES) {
          const track = $(`.lane-floor[data-lane="${lane}"] .row-cells`);
          const px = Number.parseFloat(getComputedStyle(track).gridAutoRows);
          expect(
            px,
            `${lane} track within the narrow floors`,
          ).toBeGreaterThanOrEqual(11);
          expect(
            px,
            `${lane} track at/below the narrow max`,
          ).toBeLessThanOrEqual(16);
        }

        // Selection laws unchanged at tablet: a view-only quadrant click
        // selects + announces (E1), names carry the state (E3).
        ($('.lane-floor[data-lane="chords"]') as HTMLElement).click();
        await poll(
          () => $(".stage-status").textContent?.trim() === "NOW EDITING CHORDS",
          2_000,
          "NOW EDITING CHORDS (quadrant click)",
        );
        expect(
          $('.lane-floor[data-lane="drums"] .lane-grid').getAttribute(
            "aria-label",
          ),
        ).toBe("DRUMS grid · VIEW ONLY");
      } finally {
        await teardown(iframe);
      }
    },
  );

  it(
    "desktop boundary ≥1024 (1024×768 + 1280×800): the desktop law, unchanged (m4)",
    { timeout: 120_000 },
    async () => {
      const { iframe, $, $$ } = await bootIframe(1280, 800);
      try {
        await poll(
          () => $(".app").getAttribute("data-stage") === "desktop",
          5_000,
          "data-stage=desktop at 1280×800",
        );
        expect($$(".lane-floor")).toHaveLength(4);
        expect($$(".lane-grid")).toHaveLength(4);
        // One page, both axes — SETTLED (the refinement-7 webfont-race
        // convention: the quadrant fit lawfully refuses to compress on
        // provisional metrics, so a cold boot honestly reads ~820px tall for
        // ~100ms before the fonts land).
        const fitsDesktop = () =>
          iframe.contentDocument!.documentElement.scrollWidth <= 1280 &&
          iframe.contentDocument!.documentElement.scrollHeight <= 800;
        await poll(fitsDesktop, 5_000, "1280×800 one-page (settled)");
        expect(fitsDesktop()).toBe(true);
        // Desktop geometry law: the INLINE fill rail + the committed drums
        // 20px track (the deep per-track byte-identity is quadrant-layout's
        // own gate; this pins the boundary structurally).
        const fill = $(
          '.lane-floor[data-lane="drums"] .row-fill',
        ) as HTMLElement;
        expect(fill.classList.contains("is-overlay")).toBe(false);
        expect(
          getComputedStyle($('.lane-floor[data-lane="drums"] .row-cells'))
            .gridAutoRows,
        ).toBe("20px");

        // The exact boundary: 1024 = desktop, 1023.98 = tablet.
        iframe.style.width = "1024px";
        iframe.style.height = "768px";
        await poll(
          () => $(".app").getAttribute("data-stage") === "desktop",
          3_000,
          "1024×768 stays desktop",
        );
        iframe.style.width = "1023px";
        await poll(
          () => $(".app").getAttribute("data-stage") === "tablet",
          3_000,
          "1023px crosses to tablet",
        );
      } finally {
        await teardown(iframe);
      }
    },
  );

  it(
    "rotation re-budgets live: 390×844 → 844×390 phone-law → 768×1024 tablet → 1280×800 desktop",
    { timeout: 120_000 },
    async () => {
      const { iframe, $, $$ } = await bootIframe(390, 844);
      const resize = async (w: number, h: number) => {
        iframe.style.width = `${w}px`;
        iframe.style.height = `${h}px`;
        await new Promise((r) => setTimeout(r, 60));
      };
      try {
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "portrait phone",
        );
        expect($$(".lane-floor")).toHaveLength(1);

        // Rotate a 390×844 phone: 844 wide but 390 tall — the phone law
        // holds (width <1024 AND height <600 keeps the phone stage).
        await resize(844, 390);
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          3_000,
          "rotated phone keeps the phone law",
        );
        expect($$(".lane-floor")).toHaveLength(1);
        expect($$(".lane-switch-tab")).toHaveLength(4);
        // The rotated phone still scrolls with pinned chrome.
        expect(
          iframe.contentWindow!.document.documentElement.scrollHeight,
        ).toBeGreaterThan(390);
        iframe.contentWindow!.scrollTo(0, 200);
        await new Promise((r) => setTimeout(r, 120));
        expect(
          Math.abs($(".phone-chrome").getBoundingClientRect().top),
          "rotated-phone chrome pinned",
        ).toBeLessThanOrEqual(1);

        // Rotate up to the portrait tablet: the 2×2 quadrants return and fit
        // ONE page (the entry-4 re-fit under the narrow geometry).
        await resize(768, 1024);
        await poll(
          () => $(".app").getAttribute("data-stage") === "tablet",
          3_000,
          "tablet after rotation",
        );
        await poll(
          () =>
            $$(".lane-floor").length === 4 &&
            iframe.contentDocument!.documentElement.scrollWidth <= 768 &&
            iframe.contentDocument!.documentElement.scrollHeight <= 1024,
          5_000,
          "tablet one page after rotation",
        );

        // And to the desktop minimum: the committed quadrant law.
        await resize(1280, 800);
        await poll(
          () => $(".app").getAttribute("data-stage") === "desktop",
          3_000,
          "desktop after rotation",
        );
        expect($$(".lane-floor")).toHaveLength(4);
        await poll(
          () =>
            iframe.contentDocument!.documentElement.scrollWidth <= 1280 &&
            iframe.contentDocument!.documentElement.scrollHeight <= 800,
          5_000,
          "desktop one page after rotation",
        );
      } finally {
        await teardown(iframe);
      }
    },
  );
});
