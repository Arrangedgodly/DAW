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
        const cues = Array.from(
          iframe!.contentDocument?.querySelectorAll(".rail-tile-cue") ?? [],
        ).map((c) => c.textContent);
        if (cues.some((c) => c === "VERSE")) return resolve(true);
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
        const cell = idoc().querySelector<HTMLElement>(
          '.lane-floor[data-lane="lead"] .cell',
        )!;
        cell.focus();
        // Walk the FULL manifest down and back (the e2e §7 pattern): the
        // window follows focus, ending seated at the TOP.
        for (let i = 0; i < 14; i++) key(idoc().activeElement!, "ArrowDown");
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
        const tiles = Array.from(
          idoc().querySelectorAll<HTMLButtonElement>(
            '.rail-row[data-lane="lead"] .rail-tile',
          ),
        );
        expect(tiles.length).toBeGreaterThanOrEqual(2);
        tiles[1]!.click();
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
