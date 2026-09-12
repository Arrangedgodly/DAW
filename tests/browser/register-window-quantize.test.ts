/**
 * i3-2 browser gate — the WINDOW-EDGE ROW QUANTIZATION (iteration-3 critique
 * P2, the bisected-row sliver) on the REAL BUILT APP, demo state:
 *
 * THE LAW: a windowed register pane's border-box height is exactly
 * `windowRows` row pitches, so the pane's visible bottom edge lands EXACTLY
 * on a row boundary — no row is ever bisected at the window edge, and no
 * row is clipped by the scrollport — at boot, after every key window scroll
 * (Shift+↑/↓), after the editing/view-only rhythm flip, after pattern
 * switches, after fill-driven window growth (resize), and in the deficit
 * state (the one-octave default window). Unwindowed panes (drums, the 6/7-
 * row lanes, full-manifest windows) are auto-height and assert the same
 * no-partial-row clause for free.
 *
 * TEETH (proven RED → restored, the committed record): reverting the
 * renderer's pin to the pre-i3-2 law (content box = rows + padY, the
 * double-counted padding-bottom) reddens the seated states at ~4–6px
 * (boundary assert + partial-row assert); the boot states that stay clean
 * under the revert are the bottom-clamped seats (the manifest's tail ends
 * inside the window — no row below to cut), which is why the gate walks to
 * TOP and mid-manifest seats where the boundary is interior.
 *
 * i3-3 EXTENSION (iteration-3 critique P2 round 2, crit5 — the arrow-walked
 * seats): the i3-2 gate asserted only the burst-walked TOP seat, so the
 * ungated `ensureRowVisible` focus-follow path shipped writing RAW scroll
 * targets — walking the cursor to the BOTTOM CLAMP seated the pane off the
 * row grid (the critique measured scrollTop 44 at pitch 20, the on-grid seat
 * 40: row D# bisected 4px at the pane's TOP edge; the raw bottom write
 * `top + height − clientHeight` lands on-grid MINUS the row margin — one row
 * more visible than announced — and the browser's max-scroll clamp lands
 * on-grid PLUS the pane's padding-bottom). THE LAW (one path): the
 * focus-follow scroll write QUANTIZES to the row grid — the target snaps to
 * a clamped window start's own boundary (rowTopInScroll, the same arithmetic
 * the Shift+↑/↓ path writes), min-clamped at 0, manifest-clamped at
 * rows − windowRows — so every seat the cursor walk can produce (down to the
 * clamp, and the walk back up) lands on a boundary. Two new seats: the
 * arrow-walked bottom clamp + the arrow-walked walk-back-up, each asserting
 * the full pane law PLUS the explicit scrollTop-on-the-row-grid clause.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

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

interface Ctx {
  iframe: HTMLIFrameElement;
  cleanup: () => Promise<void>;
}

/** The vertical-fill gate's boot law (fresh IDB → demo, sized iframe). */
async function boot(w: number, h: number): Promise<Ctx> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(bundleKey, "built bundle missing (globalSetup build failed?)").toBeTruthy();
  expect(cssKey).toBeTruthy();
  let iframe: HTMLIFrameElement | null = null;
  const wipe = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("bitbounce");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  const write = (frame: HTMLIFrameElement): void => {
    const doc0 = frame.contentDocument!;
    doc0.open();
    doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
    doc0.close();
  };
  for (let attempt = 0; ; attempt++) {
    iframe?.remove();
    await new Promise((r) => setTimeout(r, 100));
    await wipe();
    iframe = document.createElement("iframe");
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    document.body.appendChild(iframe);
    write(iframe);
    const ok = await new Promise<boolean>((resolve) => {
      const t0 = performance.now();
      const check = () => {
        // 2026-09-11: rail-free readiness — the chain lives on its own SONG
        // page now, so cue tiles are not on screen at boot on ANY stage.
        const kits = Array.from(
          iframe!.contentDocument?.querySelectorAll(".head-ctl-value") ?? [],
        ).map((c) => c.textContent ?? "");
        if (kits.some((c) => c.includes("SOFT STEP"))) return resolve(true);
        if (performance.now() - t0 > 6_000) return resolve(false);
        setTimeout(check, 100);
      };
      check();
    });
    if (ok) break;
    if (attempt >= 3)
      throw new Error(`demo boot never settled at ${w}×${h}`);
  }
  const frame = iframe;
  return {
    iframe: frame,
    cleanup: async () => {
      frame.remove();
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
    },
  };
}

interface PaneReport {
  lane: string;
  windowed: boolean;
  windowRows: number | null; // from the announced name (the source of truth)
  manifestRows: number;
  fullyVisible: number;
  /** px of every row that intersects the scrollport but is neither fully
   * inside nor fully outside (>1px and <height−1 = a bisected row). */
  partials: number[];
  /** |scrollport bottom − the first row top below it| — the boundary law
   * (null when no row starts below the edge: the manifest ends inside). */
  boundaryDelta: number | null;
}

/**
 * Measure one pane against the quantization law. The scrollport's bottom is
 * the border-box bottom minus the pane's own horizontal scrollbar strip
 * (classic-scrollbar platforms; overlay platforms measure 0) — the same
 * edge the renderer's pin clears.
 */
function measurePane(pane: HTMLElement): PaneReport {
  const floor = pane.closest(".lane-floor")!;
  const lane = floor.getAttribute("data-lane") ?? "?";
  const box = pane.getBoundingClientRect();
  const hsb = Math.max(0, pane.offsetHeight - pane.clientHeight);
  const bottom = box.bottom - hsb;
  const rows = Array.from(pane.querySelectorAll<HTMLElement>(".grid-row"));
  const partials: number[] = [];
  let fully = 0;
  let boundaryDelta: number | null = null;
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (r.bottom <= box.top || r.top >= bottom) {
      // Fully outside — the FIRST such row below the edge pins the boundary.
      if (boundaryDelta === null && r.top >= bottom)
        boundaryDelta = r.top - bottom;
      continue;
    }
    const vis = Math.min(r.bottom, bottom) - Math.max(r.top, box.top);
    if (vis >= r.height - 1) fully++;
    else partials.push(vis);
  }
  const name =
    pane.querySelector("[role=grid]")?.getAttribute("aria-label") ?? "";
  const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(name);
  return {
    lane,
    windowed: pane.classList.contains("is-windowed"),
    windowRows: m ? Number(m[2]) - Number(m[1]) + 1 : null,
    manifestRows: rows.length,
    fullyVisible: fully,
    partials,
    boundaryDelta,
  };
}

/** The law, asserted for EVERY pane in the document. */
function assertQuantized(idoc: Document, state: string): void {
  const panes = Array.from(
    idoc.querySelectorAll<HTMLElement>(".lane-grid-scroll"),
  );
  expect(panes.length, `${state}: four panes mounted`).toBe(4);
  for (const pane of panes) {
    const r = measurePane(pane);
    expect(
      r.partials,
      `${state} · ${r.lane}: no row bisected at the pane edge (measured cuts ${r.partials.join(",")}px)`,
    ).toEqual([]);
    if (r.windowed) {
      expect(
        r.windowRows,
        `${state} · ${r.lane}: windowed pane carries the ROWS name`,
      ).not.toBeNull();
      expect(
        r.fullyVisible,
        `${state} · ${r.lane}: the whole announced window is visible`,
      ).toBe(r.windowRows);
      if (r.boundaryDelta !== null) {
        expect(
          Math.abs(r.boundaryDelta),
          `${state} · ${r.lane}: the pane edge lands on a row boundary (±1px)`,
        ).toBeLessThanOrEqual(1);
      }
    } else {
      expect(
        r.fullyVisible,
        `${state} · ${r.lane}: unwindowed pane shows its whole manifest`,
      ).toBe(r.manifestRows);
      expect(r.windowRows, `${state} · ${r.lane}: no stale ROWS name`).toBeNull();
    }
  }
}

/**
 * i3-3: the focus-follow scroll write quantizes to the row grid — every
 * WINDOWED pane's scrollTop sits ON a row boundary (row 0's top, modulo the
 * live row pitch), so no seat the cursor walk can produce parks the pane
 * between rows. This is the critique's own metric (scrollTop 44 vs the
 * on-grid 40 at pitch 20): the walked-to-clamp seat offends BOTH ways
 * pre-fix — the raw bottom write seats on-grid-minus-the-row-margin (the
 * pane then shows one row MORE than the announced window) and the browser's
 * max-scroll clamp seats on-grid-plus-the-pane's-padding-bottom (bisecting
 * the row under the top edge — the critique's clipped D#).
 */
function assertScrollOnGrid(idoc: Document, state: string): void {
  for (const pane of Array.from(
    idoc.querySelectorAll<HTMLElement>(".lane-grid-scroll.is-windowed"),
  )) {
    const lane = pane.closest(".lane-floor")?.getAttribute("data-lane") ?? "?";
    const rows = pane.querySelectorAll<HTMLElement>(".grid-row");
    if (rows.length < 2) continue;
    const pitch =
      rows[1]!.getBoundingClientRect().top -
      rows[0]!.getBoundingClientRect().top;
    const base =
      rows[0]!.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop;
    const off = Math.abs(pane.scrollTop - base) % pitch;
    expect(
      Math.min(off, pitch - off),
      `${state} · ${lane}: scrollTop on the row grid (±1px of ${pitch}px pitch)`,
    ).toBeLessThanOrEqual(1);
  }
}

describe("i3-2 window-edge row quantization (built app, demo state)", () => {
  it(
    "every windowed pane edge lands exactly on a row boundary — boot, key scrolls, rhythm flips, pattern switches, growth, deficit",
    { timeout: 300_000 },
    async () => {
      const key = (el: Element, k: string, opts: KeyboardEventInit = {}) => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
            ...opts,
          }),
        );
      };
      const settleFill = async (ctx: Ctx, w: number, h: number) => {
        const idoc = ctx.iframe.contentDocument!;
        await poll(
          () => {
            const floors = idoc.querySelector<HTMLElement>(".stage-floors");
            return (
              !!floors &&
              Math.abs(floors.getBoundingClientRect().bottom - h) < 1.5
            );
          },
          8_000,
          `the vertical fill settles at ${w}×${h}`,
        );
        await new Promise((r) => setTimeout(r, 300));
      };

      // --- A. BOOT at every committed viewport (incl. the deficit floor) ----
      for (const [w, h] of [
        [1280, 800],
        [1440, 900],
        [1920, 1080],
      ] as Array<[number, number]>) {
        const ctx = await boot(w, h);
        try {
          await settleFill(ctx, w, h);
          assertQuantized(ctx.iframe.contentDocument!, `boot ${w}×${h}`);
        } finally {
          await ctx.cleanup();
        }
      }

      // --- B. THE SEATED STATES at 1280×800 (the pre-fix RED classes) ------
      const ctx = await boot(1280, 800);
      try {
        const idoc = () => ctx.iframe.contentDocument!;
        await settleFill(ctx, 1280, 800);
        assertQuantized(idoc(), "boot 1280×800");

        // B1 — select the lead quadrant (its boot pane is view-only — the
        // demo boots with another lane editing), then walk focus to row 0:
        // the window follows to the TOP seat, so the bottom edge crosses an
        // INTERIOR row boundary (the strong clause; the boot seat is
        // bottom-clamped at the manifest tail).
        (
          idoc().querySelector(
            '.lane-floor[data-lane="lead"]',
          ) as HTMLElement
        ).click();
        await poll(
          () =>
            idoc()
              .querySelector('.lane-floor[data-lane="lead"]')
              ?.getAttribute("data-editing") === "true",
          3_000,
          "lead quadrant selected (editing)",
        );
        // Settle the flip BEFORE walking (B3/B4's fixed-settle idiom): the
        // flip's rAF re-pin + the fill re-fit re-seat the window lawfully,
        // and the i3-3 seats must measure the walk's OWN seat — the critique
        // walked a settled pane (the off-grid seat persists until the next
        // window move; a re-fit racing the walk would heal it and the gate
        // would pass against the defect — exactly how the burst walk in the
        // original B1 masked it).
        await new Promise((r) => setTimeout(r, 600));
        const cell = idoc().querySelector<HTMLElement>(
          '.lane-floor[data-lane="lead"] .cell',
        )!;
        cell.focus();
        // Walk the FULL manifest DOWN one row at a time to the BOTTOM CLAMP
        // (the e2e §7 pattern): the window follows focus. i3-3: this seat is
        // asserted MID-WALK — the critique's finding lived exactly here (the
        // ungated focus-follow path seated the pane off the row grid at the
        // clamp; the i3-2 gate only asserted the seat AFTER the walk-back).
        for (let i = 0; i < 14; i++) key(idoc().activeElement!, "ArrowDown");
        await poll(
          () =>
            (idoc().activeElement as HTMLElement)?.dataset.row === "14" &&
            /ROWS \d+–14 OF 14$/.test(
              idoc()
                .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
                ?.getAttribute("aria-label") ?? "",
            ),
          5_000,
          "arrows walk focus to the bottom clamp (window follows)",
        );
        await new Promise((r) => setTimeout(r, 250));
        assertQuantized(
          idoc(),
          "arrow-walked bottom clamp 1280 (i3-3 seat)",
        );
        assertScrollOnGrid(idoc(), "arrow-walked bottom clamp 1280");

        // And back UP to row 0 — the walk-back-up seat (the critique's
        // scrollTop=4 class: the top-edge write quantizes + min-clamps at 0).
        for (let i = 0; i < 14; i++) key(idoc().activeElement!, "ArrowUp");
        await poll(
          () =>
            (idoc().activeElement as HTMLElement)?.dataset.row === "0" &&
            /^LEAD grid · EDITING · ROWS 0–/.test(
              idoc()
                .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
                ?.getAttribute("aria-label") ?? "",
            ),
          5_000,
          "arrows walk focus to row 0 (window follows to the top)",
        );
        await new Promise((r) => setTimeout(r, 250));
        assertQuantized(idoc(), "top seat 1280 (focus walked to row 0)");
        assertScrollOnGrid(idoc(), "arrow-walked back to top 1280 (i3-3 seat)");

        // B2 — Shift+↓ ONE OCTAVE: the mid-manifest seat. The anchor law
        // needs focus OFF the top edge for a DOWN scroll (the e2e §7 law),
        // so walk focus to the window's bottom row first.
        const nameNow =
          idoc()
            .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
            ?.getAttribute("aria-label") ?? "";
        const mm = /ROWS (\d+)–(\d+) OF (\d+)/.exec(nameNow);
        expect(mm, `windowed lead name at the top seat (got ${nameNow})`).toBeTruthy();
        for (let i = 0; i < Number(mm![2]); i++)
          key(idoc().activeElement!, "ArrowDown");
        key(idoc().activeElement!, "ArrowDown", { shiftKey: true });
        await poll(
          () =>
            (/ROWS (\d+)–/.exec(
              idoc()
                .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
                ?.getAttribute("aria-label") ?? "",
            )?.[1] ?? "0") !== "0",
          5_000,
          "Shift+↓ seats the window mid-manifest",
        );
        await new Promise((r) => setTimeout(r, 250));
        assertQuantized(idoc(), "mid-manifest seat 1280 (Shift+↓)");

        // B3 — the editing/view-only rhythm flip (row margins change; the
        // pin must re-apply with the LIVE pitch).
        (
          idoc().querySelector(
            '.lane-floor[data-lane="drums"]',
          ) as HTMLElement
        ).click();
        await new Promise((r) => setTimeout(r, 500));
        assertQuantized(idoc(), "rhythm flip → view-only 1280");

        // B4 — and back to editing.
        (
          idoc().querySelector(
            '.lane-floor[data-lane="lead"]',
          ) as HTMLElement
        ).click();
        await new Promise((r) => setTimeout(r, 500));
        assertQuantized(idoc(), "rhythm flip → editing 1280");

        // B5 — a pattern switch remounts the surface (fresh mount pin).
        // 2026-09-11: the chain is its own page — switch from there, then
        // come back to the grid for the quantization assertion.
        idoc().querySelector<HTMLButtonElement>(".booth-btn-song")!.click();
        await new Promise((r) => setTimeout(r, 250));
        const tiles = Array.from(
          idoc().querySelectorAll<HTMLButtonElement>(
            '.rail-row[data-lane="lead"] .rail-tile',
          ),
        );
        expect(tiles.length).toBeGreaterThanOrEqual(2);
        tiles[1]!.click();
        idoc().querySelector<HTMLButtonElement>(".booth-btn-song")!.click();
        await new Promise((r) => setTimeout(r, 500));
        assertQuantized(idoc(), "pattern switch 1280");

        // B6 — 'b' grows the lead pattern 1 → 2 bars (eager grid; the pane
        // itself h-scrolls on classic-scrollbar platforms — the hsb clause).
        key(idoc().body, "b");
        await new Promise((r) => setTimeout(r, 700));
        assertQuantized(idoc(), "grown 2-bar pattern 1280");

        // B7 — → 8 bars: the virtualized grid (the inner .grid-hscroll owns
        // the x axis; the pane keeps the row law).
        key(idoc().body, "b");
        await new Promise((r) => setTimeout(r, 700));
        key(idoc().body, "b");
        await new Promise((r) => setTimeout(r, 900));
        assertQuantized(idoc(), "grown 8-bar virtual pattern 1280");
      } finally {
        await ctx.cleanup();
      }

      // --- C. DEFICIT + FILL GROWTH ----------------------------------------
      // 1024×600: the one-octave default window in a mid/low seat — the
      // pre-fix state that cut the MANIFEST'S LAST ROW 6px of 16 at boot.
      const ctx2 = await boot(1024, 600);
      try {
        const idoc = () => ctx2.iframe.contentDocument!;
        await new Promise((r) => setTimeout(r, 1_200));
        assertQuantized(idoc(), "deficit boot 1024×600 (window 7)");
        // The eager 2-bar pattern at the deficit width: the pane's own
        // horizontal scrollbar state (overlay platforms measure 0).
        (
          idoc().querySelector(
            '.lane-floor[data-lane="lead"]',
          ) as HTMLElement
        ).click();
        await new Promise((r) => setTimeout(r, 500));
        key(idoc().body, "b");
        await new Promise((r) => setTimeout(r, 900));
        assertQuantized(idoc(), "deficit + 2-bar pattern 1024×600");
        // Fill growth by resize: the window re-grows in whole rows.
        ctx2.iframe.style.width = "1280px";
        ctx2.iframe.style.height = "800px";
        await poll(
          () => {
            const name =
              idoc()
                .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
                ?.getAttribute("aria-label") ?? "";
            const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(name);
            return m ? Number(m[2]) - Number(m[1]) + 1 > 7 : false;
          },
          8_000,
          "resize 1024→1280: the window re-grows past the octave default",
        );
        await new Promise((r) => setTimeout(r, 300));
        assertQuantized(idoc(), "post-growth resize 1024→1280");
      } finally {
        await ctx2.cleanup();
      }
    },
    300_000,
  );
});
