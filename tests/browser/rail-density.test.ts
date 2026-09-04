/**
 * Refinement-6 browser gate — rail tools row density (critique P3,
 * heuristic 8 "Aesthetic and Minimalist Design": the per-lane six-tool row
 * REN/+1B/+2B/+4B/DUP/RM ×4 lanes competed with the clip tiles for
 * horizontal space and read as scan noise).
 *
 * The distill: the six management controls live behind ONE labeled PAT
 * trigger per lane, opening the committed popover vocabulary. This gate
 * pins, on the REAL BUILT APP at BOTH committed viewports (1440×900 and
 * the 1280×800 tested minimum):
 *
 * 1. CLUSTER LAW: every lane's .rail-tools box is a single small trigger
 *    (width ≤ TOOLS_MAX_PX, exactly one button rendered while closed) —
 *    the six-button row measured ~330 px per lane pre-fix, which is the
 *    teeth this assertion carries (a revert of the distill turns it red).
 * 2. TILE HEADROOM: with a long chain appended UI-honestly (the row's own
 *    + button), every rail row stays SINGLE-LINE — the density win is real
 *    horizontal room for tiles, not tighter tiles (each keeps its ≥48 px
 *    min-width). N_TILES is chosen to wrap pre-fix at 1440 (proven on the
 *    scratch revert during the entry) and fit post-fix at 1280.
 * 3. FUNCTION THROUGH THE DISTILL: the PAT menu opens/closes with the
 *    committed popover laws (focus lands on the first control, Escape
 *    closes with focus returned to the trigger, the inline rename field
 *    consumes its OWN Escape first), +1B adds a pattern from inside the
 *    menu (and closes it), the global `r` shortcut still lands focus on
 *    the active lane's REN (opening the menu when needed — keyboard.md
 *    ledger #5), and the rail still PLAYS: a tile click while the
 *    transport runs shows the quantized PENDING state (the IN-3 adjacent
 *    path the critique warned about distilling away).
 * 4. ONE-PAGE LAW: the page still fits both viewports exactly with the
 *    long chains mounted (the rail never grows for the menu — it is
 *    absolutely positioned).
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEW_W = 1440;
const VIEW_H = 900;
const MIN_W = 1280;
const MIN_H = 800;
/** One PAT trigger ("PAT" Silkscreen label + 12 px h-padding + border). */
const TOOLS_MAX_PX = 88;
/** Long-chain length appended for the headroom law: single-line post-fix
 *  at the 1280×800 minimum (with margin), beyond what the pre-fix row —
 *  six tools + gaps spending ~320 px per lane — could carry on one line
 *  even at 1440. Teeth for the cluster itself: the one-trigger law (a
 *  revert of the distill measures 6 buttons and fails red, proven during
 *  the entry). */
const N_TILES = 15;

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

describe("refinement-6 rail tools density (built app, 1440×900 + 1280×800)", () => {
  it(
    "one PAT trigger per lane · tiles breathe · every function reachable · one page",
    { timeout: 120_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      // Start at the tested minimum; §D resizes to 1440×900.
      const iframe = document.createElement("iframe");
      iframe.style.width = `${MIN_W}px`;
      iframe.style.height = `${MIN_H}px`;
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
      const fits = (w: number, h: number): boolean => {
        const de = idoc().documentElement;
        return (
          de.scrollWidth <= w &&
          de.scrollHeight <= h &&
          (idoc().body.scrollWidth ?? 0) <= w &&
          (idoc().body.scrollHeight ?? 0) <= h
        );
      };
      /** Every lane's tools cluster: one small trigger, nothing else. */
      const clusterLaw = (): void => {
        for (const row of $$(".rail-row")) {
          const lane = row.getAttribute("data-lane");
          const tools = row.querySelector<HTMLElement>(".rail-tools")!;
          const buttons = tools.querySelectorAll(":scope > button");
          expect(
            buttons.length,
            `${lane}: closed tools cluster renders exactly the PAT trigger`,
          ).toBe(1);
          const width = tools.getBoundingClientRect().width;
          expect(
            width,
            `${lane}: tools cluster is one small trigger (≤ ${TOOLS_MAX_PX}px; ` +
              `the six-button row measured ~330px pre-fix)`,
          ).toBeLessThanOrEqual(TOOLS_MAX_PX);
          expect(
            (buttons[0] as HTMLElement).getAttribute("aria-expanded"),
            `${lane}: trigger reports closed`,
          ).toBe("false");
        }
      };
      /** One rail row is single-line: the tiles box is exactly one tile tall. */
      const singleLine = (lane: string): void => {
        const row = $(`.rail-row[data-lane="${lane}"]`);
        const tilesBox = row.querySelector<HTMLElement>(".rail-tiles")!;
        const tile = tilesBox.querySelector<HTMLElement>(".rail-tile")!;
        expect(
          tilesBox.getBoundingClientRect().height,
          `${lane}: ${tilesBox.querySelectorAll(".rail-tile").length} tiles stay single-line ` +
            `(the distill's horizontal room; a wrap doubles this height)`,
        ).toBeLessThanOrEqual(tile.getBoundingClientRect().height + 0.5);
        for (const t of Array.from(
          tilesBox.querySelectorAll<HTMLElement>(".rail-tile"),
        )) {
          expect(
            t.getBoundingClientRect().width,
            `${lane}: tiles keep their ≥48px min-width (room, not squish)`,
          ).toBeGreaterThanOrEqual(48);
        }
        expect(
          row.querySelector(".rail-tools-menu"),
          `${lane}: menu closed`,
        ).toBeNull();
      };

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
        // Refinement-7 gate-environment correction (recorded): the boot-time
        // one-page check below can run while the pixel webfonts are still
        // landing — and the quadrant-budget fit LAWFULLY refuses to compress
        // on provisional metrics (refinement-4's fontsFinal guard), then
        // needs one more rAF after fonts.final to run, so the page honestly
        // reads ~825 px for the first ~100 ms of a cold boot. SETTLE before
        // asserting (the same convention this gate's §D 1440 resize and
        // quadrant-layout §1b already use); verified pre-existing on the
        // parent tree — not a refinement-7 behavior change.
        await poll(
          () => fits(MIN_W, MIN_H),
          5_000,
          "boot fit settles (fonts final + budget fit)",
        );

        /** Measured-evidence log (the perf-gate precedent): what the density
         *  laws actually measured this run. */
        const logDensity = (viewport: string): void => {
          const widths = $$(".rail-row").map((row) =>
            Math.round(
              row
                .querySelector<HTMLElement>(".rail-tools")!
                .getBoundingClientRect().width,
            ),
          );
          const drumsBox = $<HTMLElement>(
            '.rail-row[data-lane="drums"] .rail-tiles',
          ).getBoundingClientRect();
          console.log(
            `[refinement-6 rail density] ${viewport}: tools cluster px per lane ` +
              `[${widths.join(", ")}] · drums row ${Math.round(drumsBox.width)}px wide, ` +
              `${$$('.rail-row[data-lane="drums"] .rail-tile').length} tiles single-line`,
          );
        };

        // --- 1. CLUSTER LAW at 1280×800 -----------------------------------
        clusterLaw();
        expect(
          fits(MIN_W, MIN_H),
          "page fits 1280×800 before the long chain",
        ).toBe(true);

        // --- 2. TILE HEADROOM: append a long chain, rows stay single-line --
        // UI-honest: the row's own + button (the append stays with the tiles
        // by design — chain structure next to the chain it extends).
        for (const lane of ["drums", "bass"]) {
          const append = $<HTMLButtonElement>(
            `.rail-row[data-lane="${lane}"] .rail-append`,
          );
          const start = $$(`.rail-row[data-lane="${lane}"] .rail-tile`).length;
          for (let i = start; i < N_TILES; i++) {
            append.click();
            await poll(
              () =>
                $$(`.rail-row[data-lane="${lane}"] .rail-tile`).length ===
                i + 1,
              2_000,
              `${lane} chain slot ${i + 1} appended`,
            );
          }
          singleLine(lane);
        }
        expect(
          fits(MIN_W, MIN_H),
          "page still fits 1280×800 with the long single-line chains",
        ).toBe(true);
        logDensity("1280×800");

        // --- 3. FUNCTION THROUGH THE DISTILL ------------------------------
        // 3a. Menu opens with the committed popover laws.
        const trigger = $<HTMLButtonElement>(
          '.rail-row[data-lane="drums"] .rail-tools-trigger',
        );
        trigger.click();
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] .rail-tools-menu',
            ) !== null,
          2_000,
          "tools menu open",
        );
        const menu = $<HTMLElement>(
          '.rail-row[data-lane="drums"] .rail-tools-menu',
        );
        expect(menu.getAttribute("role"), "popover vocabulary role").toBe(
          "dialog",
        );
        // Layout pin: the menu wraps the tools into rows (3×2), never ONE
        // column — an abspos shrink-to-fit inside the tiny 45px cluster
        // (instead of the row anchor) collapses it to a column; wider than
        // tall + a height floor proves the anchored layout.
        const menuBox = menu.getBoundingClientRect();
        expect(
          menuBox.width,
          "menu lays the tools in wrapped rows, not one column",
        ).toBeGreaterThan(menuBox.height);
        expect(
          menuBox.height,
          "menu stays a compact two-row popover",
        ).toBeLessThanOrEqual(96);
        expect(
          menu.querySelectorAll(".rail-tool").length,
          "all six management controls inside the menu",
        ).toBe(6);
        // Pre-fix equivalent measurement: the six buttons + their 4px gaps
        // are exactly what the row used to spend (one line, no wrap).
        const toolRects = Array.from(
          menu.querySelectorAll<HTMLElement>(".rail-tool"),
        ).map((b) => b.getBoundingClientRect());
        const toolsRowEquiv =
          toolRects.reduce((sum, r) => sum + r.width, 0) +
          (toolRects.length - 1) * 4;
        console.log(
          `[refinement-6 rail density] the six tools in one line measure ${Math.round(toolsRowEquiv)}px — the per-lane row spend the distill removed (cluster now ${Math.round(trigger.getBoundingClientRect().width)}px)`,
        );
        expect(
          trigger.getAttribute("aria-expanded"),
          "trigger reports open",
        ).toBe("true");
        await poll(
          () =>
            idoc().activeElement ===
            menu.querySelector<HTMLButtonElement>('[data-help="rail.rename"]'),
          2_000,
          "focus lands on REN (first control, menu convention)",
        );

        // 3b. The global `r` twin: opens the menu focused on REN when closed.
        key(idoc().body, "r");
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] .rail-tools-menu',
            ) !== null,
          2_000,
          "`r` opens the active lane's tools menu",
        );
        await poll(
          () =>
            idoc().activeElement ===
            $('.rail-row[data-lane="drums"] [data-help="rail.rename"]'),
          2_000,
          "`r` lands focus on the active lane's REN control",
        );

        // 3c. Rename field: its OWN Escape consumes first (inline edits
        // before popovers — the documented page Escape order). Synthetic
        // keydowns carry no native button activation (DA-3 note) — click
        // REN to open the field.
        $<HTMLButtonElement>(
          '.rail-row[data-lane="drums"] [data-help="rail.rename"]',
        ).click();
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] .rail-tools .rail-edit',
            ) !== null,
          2_000,
          "rename field open inside the menu",
        );
        key($('.rail-row[data-lane="drums"] .rail-tools .rail-edit'), "Escape");
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] .rail-tools .rail-edit',
            ) === null,
          2_000,
          "field Escape cancels the edit (not the menu)",
        );
        expect(
          idoc().querySelector('.rail-row[data-lane="drums"] .rail-tools-menu'),
          "menu still open after the field's Escape",
        ).not.toBeNull();

        // 3d. Menu Escape closes with focus back on the trigger.
        key(idoc().activeElement ?? menu, "Escape");
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] .rail-tools-menu',
            ) === null,
          2_000,
          "menu Escape closes the menu",
        );
        expect(
          idoc().activeElement,
          "focus returns to the trigger (never stranded)",
        ).toBe(trigger);

        // 3e. +1B from inside the menu: adds + selects (the drums grid
        // switches to the new EMPTY pattern) and closes the menu.
        const onBefore = $$(
          '.lane-floor[data-lane="drums"] .cell[data-on="true"]',
        ).length;
        expect(onBefore, "demo drums pattern has on-cells").toBeGreaterThan(0);
        trigger.click();
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] button[aria-label="Add 1-bar pattern to DRUMS"]',
            ) !== null,
          2_000,
          "tools menu open for +1B",
        );
        $<HTMLButtonElement>(
          '.rail-row[data-lane="drums"] button[aria-label="Add 1-bar pattern to DRUMS"]',
        ).click();
        await poll(
          () =>
            idoc().querySelector(
              '.rail-row[data-lane="drums"] .rail-tools-menu',
            ) === null,
          2_000,
          "action commit closes the menu",
        );
        await poll(
          () =>
            $$('.lane-floor[data-lane="drums"] .cell[data-on="true"]')
              .length === 0,
          5_000,
          "new empty 1-bar pattern selected (grid cleared)",
        );

        // 3f. The rail still plays: a tile click under a running transport
        // shows the quantized PENDING state (the IN-3 adjacent path). Slot 2,
        // not slot 1: the IM-7 timing law (drag-cue header) — a switch to
        // the pattern the NEXT-boundary slot already plays is a CANCEL, and
        // right after PLAY the next boundary is slot 1, so slot 2 always
        // shows a real pending.
        const playBtn = $<HTMLButtonElement>(".booth-btn-play");
        playBtn.click();
        await poll(
          () => playBtn.getAttribute("aria-pressed") === "true",
          5_000,
          "transport playing",
        );
        const target = $$('.rail-row[data-lane="drums"] .rail-tile')[2]!;
        target.click();
        await poll(
          () => target.dataset.state === "pending",
          5_000,
          "tile click cues a quantized switch (pending visible)",
        );
        playBtn.click();
        await poll(
          () => playBtn.getAttribute("aria-pressed") === "false",
          5_000,
          "transport stopped",
        );

        // --- 4. BOTH VIEWPORTS: cluster + headroom + one-page at 1440 -----
        iframe.style.width = `${VIEW_W}px`;
        iframe.style.height = `${VIEW_H}px`;
        await poll(() => fits(VIEW_W, VIEW_H), 5_000, "1440 fit settle");
        clusterLaw();
        singleLine("drums");
        singleLine("bass");
        expect(
          fits(VIEW_W, VIEW_H),
          "page fits 1440×900 with the long single-line chains",
        ).toBe(true);
        expect(
          idoc().documentElement.scrollHeight,
          "1440×900 one-page law exact (900 == 900)",
        ).toBe(VIEW_H);
        logDensity("1440×900");
      } finally {
        iframe.remove();
        for (let attempt = 0; ; attempt++) {
          const deleted = await new Promise<boolean>((resolve) => {
            const req = indexedDB.deleteDatabase("bitbounce");
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(true);
            req.onblocked = () => resolve(false);
          });
          if (deleted || attempt >= 20) break;
        }
      }
    },
    120_000,
  );
});
