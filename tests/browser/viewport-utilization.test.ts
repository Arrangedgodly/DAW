/**
 * FV-1 browser gate — THE CONSOLIDATED i3-6 GATE (re-indexed by HW-6's AC
 * matrix, docs/dev/definition-of-done.md §7): FULL-VIEWPORT DENSIFICATION on
 * the REAL BUILT APP. The 1400px cap family is RETIRED (I3-b, user-approved
 * 2026-09-04): `.stage-floors`'s cap plus its `.rail` twin — one
 * centered-vacancy law. The quadrant stage fills the viewport width at
 * every desktop width, and width growth buys MORE VISIBLE STEPS per
 * quadrant before the internal h-scroll (fixed step px is the readability
 * law — columns, never bigger cells; RC-1's windowed grids made columns
 * the thing width buys). The i3-6 clause split: THIS gate owns the
 * utilization + one-page + densification halves at all three viewports;
 * the desktop perf half rides frame-budget.test.ts TH-5 (d); the mobile
 * regression half rides the §6 matrix suite; the built-app wide probe on
 * an edited document also rides the iteration-3 e2e journey (stage 10).
 *
 * UTILIZATION DEFINITION (recorded in-task — the plan's "bounding-box
 * utilization assertion"): the widest committed layout surfaces — the 2×2
 * stage floors and the rail — each span ≥95% of the LAYOUT viewport width
 * (iframe documentElement.clientWidth) as their border-box bounding rect,
 * measured per viewport at 1280×800, 1440×900, 1920×1080. The 5% margin
 * absorbs nothing today (both surfaces measure 100%); it is the sanctioned
 * tolerance for a future deliberate inset, so the gate pins the LAW (no
 * centered vacancy — the surfaces start at the layout edge) rather than
 * one exact stylesheet value.
 *
 * ONE-PAGE LAW (the two law viewports, both axes): 1280×800 AND 1440×900
 * keep zero page scroll — this task is width densification only; the
 * refinement-4 vertical fit is untouched. 1920×1080 is additionally pinned
 * as defense-in-depth: the wider page must not grow any element past it.
 *
 * DENSIFICATION PROOF (the retirement actually densifies): a 4-bar lead
 * pattern shows STRICTLY MORE visible step columns at 1920 than at 1440 —
 * the retired "1920 = 1440" full-page byte-identity (the old LaneGrid
 * refinement-4 note, journaled retired in-source) would fail this as
 * equality.
 *
 * Teeth: restoring `max-width: 1400px` reddens the gate — the centered
 * vacancy assert catches the 20px margin at 1440 first (measured on the
 * scratch revert), and at 1920 the utilization ratio itself (1400/1920 ≈
 * 73%) plus the densification assert (36 == 36, not >) go RED.
 *
 * MOBILE FENCE (I3-f, regression-only): NO mobile behavior is asserted
 * here — below 1400px the retired caps were already inert, so the
 * phone/tablet branches are byte-stable by construction and stay pinned by
 * their own gates (mobile-viewport m1, mobile-resilience m3/m5,
 * frame-budget m5, the MB-1 PNG law), re-run in the same battery.
 *
 * Evidence screenshots at all three viewports ride the UNCOMMITTED
 * zz-shots scratch harness into .impeccable/review/ (the RC-1 precedent:
 * machine-specific absolute screenshot paths never enter the committed
 * suite — this gate is assertions-only and CI-safe).
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

/** The three gate viewports (I3-b): min, primary law, wide. The one-page
 * LAW viewports are 1280×800 + 1440×900; 1920×1080 is the wide gate. */
const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];

const UTILIZATION_MIN = 0.95;

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

/** Deterministic first-run boot (PX-1 demo) in a sized iframe — the
 * quadrant-layout harness shape. */
async function bootIframe(
  w: number,
  h: number,
): Promise<{
  iframe: HTMLIFrameElement;
  idoc: () => Document;
  $: <T extends Element>(sel: string) => T;
}> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(
    bundleKey,
    "built bundle missing (globalSetup build failed?)",
  ).toBeTruthy();
  expect(cssKey).toBeTruthy();
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
  await poll(() => !!idoc().querySelector(".booth"), 15_000, "boot");
  await poll(
    () =>
      Array.from(idoc().querySelectorAll(".rail-tile-cue")).some(
        (c) => c.textContent === "VERSE",
      ),
    5_000,
    "demo cues",
  );
  return { iframe, idoc, $ };
}

/** R14 teardown: remove the iframe, then wipe the shared-origin DB. */
async function teardown(iframe: HTMLIFrameElement): Promise<void> {
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

describe("FV-1 full-viewport densification (built app, 1280/1440/1920)", () => {
  it(
    "≥95% width utilization at all three viewports; one-page at both law viewports; 1920 shows strictly more columns",
    { timeout: 180_000 },
    async () => {
      /** Visible step columns of the lead quadrant's first 4-bar row. */
      const visibleLeadSteps = (idoc: () => Document): number => {
        const scroll = idoc().querySelector<HTMLElement>(
          '.lane-floor[data-lane="lead"] .lane-grid-scroll',
        )!;
        const box = scroll.getBoundingClientRect();
        const row = idoc().querySelector(
          '.lane-floor[data-lane="lead"] .grid-row .row-cells',
        )!;
        let visible = 0;
        for (const cell of Array.from(row.querySelectorAll(".cell"))) {
          if (cell.getBoundingClientRect().right <= box.right + 1) visible++;
          else break;
        }
        return visible;
      };

      /** Grow the LEAD pattern to 4 bars (LL-1 journey delta: the +4B menu
       * button retired with the LENGTH stepper — select the lead quadrant,
       * then the global `b` ladder ×2), wait for the 64-step remount. */
      const add4BarLead = async (
        $: <T extends Element>(sel: string) => T,
        idoc: () => Document,
      ): Promise<void> => {
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
        await poll(
          () =>
            (idoc()
              .querySelector('.lane-floor[data-lane="lead"] .grid-row')
              ?.querySelectorAll(".cell").length ?? 0) === 64,
          5_000,
          "4-bar lead pattern rendered (first row = 64 steps)",
        );
      };

      const visibleAt = new Map<number, number>();
      for (const [w, h] of VIEWPORTS) {
        const { iframe, idoc, $ } = await bootIframe(w, h);
        try {
          // --- 0. SETTLE -------------------------------------------------
          // Fonts + the refinement-4 fit first: a scrollbar-free document
          // is what clientWidth === w asserts below.
          const fitsNow = () => {
            const de = idoc().documentElement;
            return (
              de.scrollWidth <= w &&
              de.scrollHeight <= h &&
              (idoc().body.scrollWidth ?? 0) <= w &&
              (idoc().body.scrollHeight ?? 0) <= h
            );
          };
          let settled = true;
          try {
            await poll(fitsNow, 5_000, `${w}×${h} fit settle`);
          } catch {
            settled = false;
          }
          const de = idoc().documentElement;
          expect(
            settled,
            `${w}×${h}: page must fit (measured ${de.scrollWidth}×${de.scrollHeight})`,
          ).toBe(true);

          // --- 1. UTILIZATION (the FV-1 definition, both surfaces) -------
          const clientW = idoc().documentElement.clientWidth;
          expect(clientW, `${w} layout viewport (no scrollbar)`).toBe(w);
          const floors = $(".stage-floors").getBoundingClientRect();
          const rail = $(".rail").getBoundingClientRect();
          expect(
            floors.width / clientW,
            `${w}×${h}: stage floors utilization (≥${UTILIZATION_MIN * 100}%; the retired cap measured 1400/${w})`,
          ).toBeGreaterThanOrEqual(UTILIZATION_MIN);
          expect(
            rail.width / clientW,
            `${w}×${h}: rail utilization (the twin capped surface)`,
          ).toBeGreaterThanOrEqual(UTILIZATION_MIN);
          // No centered vacancy: both surfaces start at the layout edge
          // (the scratch revert measured left = 20 at 1440, 260 at 1920).
          expect(floors.left).toBeLessThanOrEqual(0.5);
          expect(rail.left).toBeLessThanOrEqual(0.5);

          // --- 2. ONE-PAGE LAW ------------------------------------------
          // The two law viewports by name (1280×800 + 1440×900); 1920 is
          // the defense-in-depth half — a wider page must not overflow
          // either axis. Proven by the settle poll; re-asserted for the
          // failure message.
          expect(fitsNow(), `${w}×${h}: one-page holds after settle`).toBe(
            true,
          );

          // --- 3. DENSIFICATION PROOF at 1440 + 1920 ---------------------
          // A 4-bar (64-step) grid overflows the quadrant at BOTH widths
          // (the v0 internal-scroll law); the retired cap made the two
          // viewports show the SAME column count — the byte-identity law.
          if (w >= 1440) {
            await add4BarLead($, idoc);
            const scroll = $(
              '.lane-floor[data-lane="lead"] .lane-grid-scroll',
            ) as HTMLElement;
            expect(
              scroll.scrollWidth,
              `${w}: the 4-bar lead grid scrolls INSIDE its quadrant (the measurement grid genuinely overflows)`,
            ).toBeGreaterThan(scroll.clientWidth);
            const visible = visibleLeadSteps(idoc);
            expect(visible, `${w}: visible lead columns`).toBeGreaterThan(0);
            visibleAt.set(w, visible);
            // The one-page law still holds with the long pattern aboard.
            expect(
              de.scrollWidth <= w && de.scrollHeight <= h,
              `${w}: one-page holds with the 4-bar pattern (internal scroll, never the page)`,
            ).toBe(true);
          }
        } finally {
          await teardown(iframe);
        }
      }

      // The retirement's whole point: 1920 buys MORE VISIBLE COLUMNS than
      // 1440 (pre-FV-1 both measured the same — the 1400px cap).
      const at1440 = visibleAt.get(1440)!;
      const at1920 = visibleAt.get(1920)!;
      expect(
        at1920,
        `1920 shows strictly more lead columns than 1440 (measured ${at1920} vs ${at1440}; the retired 1920=1440 law measured equal)`,
      ).toBeGreaterThan(at1440);
    },
    180_000,
  );
});

/* ---------------------------------------------------------------------------
 * M-7 (iteration 4) — the PHONE-STAGE utilization half of this gate. The
 * desktop describe above owns width densification + the one-page law; this
 * describe owns the phone max-space law: with chrome thinned (M-2), the
 * transport pinned (M-3), the tools drawer-ized (M-4) and the grids
 * windowed (M-5), the GRID — not chrome, not gutters — takes the maximum
 * share of the phone viewport.
 *
 * GRID-SHARE DEFINITION (recorded in-task at HEAD bce635a, first-run PX-1
 * demo, font-settled, overlay-scrollbar layout — the MB-6 measurement law):
 * the rendered height of the active lane's `.lane-grid-scroll` divided by
 * the viewport height. BASELINE (pre-M-7, 24px PHONE_ROW_PX): 292px was
 * 172px → 20.4% at 390×844 and 21.5% at 360×800 (drums, the first-run
 * active lane; pitched bass measured 200px → 23.7%). M-7's rework raises
 * the phone editing rows to 44px (finger-sized cells — the target-size
 * law's own number on the row axis) and trims the stage gutters, measuring
 * 34.6% / 36.5% (bass 40.3%). The gate pinned the REWORKED numbers minus a
 * sanctioned ~4.5pp margin (30% / 32%): restoring the 24px rows reddens it
 * at both viewports (20.4 / 21.5 < 30 / 32).
 * i5 (H-3's row-growth clamp, re-derived GROW-ONLY by H-4 at HEAD fd7bf68):
 * the drums pane measures 52.1% / 49.5% / 56.7% at 390/360/430 — floors
 * raised to 47.5% / 45% / 52% (same ~4.5pp margin, old floors the hard
 * minimum). Restoring the 24px rows STILL reddens all three (20.4/21.5 ≪
 * 45/47.5); so does clamping tracks back to the exact 44 pin (share
 * returns to ~34.6/36.5 < 45/47.5).
 *
 * ROW-TARGET LAW: every rendered `.grid-row` is ≥44px tall — the cell hit
 * test is row-exact on the vertical axis, so this is the target-size law's
 * metric applied to the grid surface itself. The cells' WIDTH is the i5
 * WIDTH-FILL LAW below (15.69–20.81 px on the shipped viewports — the
 * recorded 15 px phone cell pin retired with it; the grid stays the
 * recorded pan-y gesture surface, exempted as a DATA TARGET in the MB-3
 * audit).
 *
 * Chrome law stays where it lives (mobile-viewport MB-1/MB-6: <50% at
 * 360×800) — this gate asserts only the utilization delta it owns.
 *
 * H-4 (iteration 5) — THE i5 GATES WITH TEETH, per lane per phone viewport
 * (390×844, 360×800, 430×932; the MB-6 scrollbar-width:none convention, so
 * the well measures W−26 exactly — audit §1):
 *
 *   WIDTH-FILL (i5 audit §2, H-2+H-3 law): a 1-bar row (drums/bass/lead —
 *   the demo's 16-step patterns) fills the well EXACTLY — `.row-cells`
 *   right edge == `.lane-grid-scroll` right edge within 0.25 px (the CSS
 *   LayoutUnit 1/64-px track quantization bound at n=32; per-lane sum error
 *   ≤ n/128 ≤ 0.25), i.e. dead-right 0, and the measured first-cell width
 *   equals the audit's exact recorded fraction (17.5625/15.6875/20.0625
 *   drums, 18.3125/16.4375/20.8125 pitched at 390/360/430 — measured
 *   bounding boxes, NEVER computed track lists, which serialize rounded);
 *   `scrollWidth ≤ clientWidth + 1` (m1's no-scroll property, by
 *   construction). The 2-bar chords lane is the audit's one scroller: raw
 *   fit 8.66/7.72/9.91 < the 15 floor → cells stay 15, the grid scrolls
 *   INSIDE the well, the page never h-scrolls.
 *
 *   ROW-TRACK CLAMP (i5 audit §3): every lane's `gridAutoRows` track reads
 *   within [44, 64] — the M-7 ≥44 floor plus H-3's growth cap (the exact
 *   44px pin retired with the clamp).
 *
 *   BOTTOM-OWNERSHIP (i5 audit §3, H-3 law): at document scroll-end the
 *   lane-floor's bottom IS the document bottom (≤1 px) — the card owns the
 *   viewport bottom; the pre-H-3 dead band measured 4–236 px.
 *
 * TEETH (scratch-revert proofs, journaled in production-log.md "H-4"):
 * re-pinning the phone cell to 15 in fitPhoneGeometry reddens the fill +
 * cell-px asserts at 390/430 (dead-right ~41/53 px, cell 15 vs 17.5625);
 * early-returning the phone fit reddens them at ALL viewports; reverting
 * the app.css stage stretch (flex:grow → flex:none) reddens the
 * bottom-ownership assert (dead below 148+ px at 390 drums).
 *
 * SHARE FLOORS (grow-only, re-derived at HEAD fd7bf68 after H-3's row
 * growth — the pre-H-3 floors 30%/32% remain the hard minimum): see the
 * CASES table below for the measured values and the sanctioned ~4.5pp
 * margin (the original M-7 convention).
 * ------------------------------------------------------------------------- */
describe("M-7 phone-stage grid utilization (built app, 390×844 + 360×800 + 430×932)", () => {
  it(
    "grid share floors; rows within [44,64]; i5 width-fill + bottom-ownership per lane",
    { timeout: 240_000 },
    async () => {
      const CASES: ReadonlyArray<{
        w: number;
        h: number;
        minShare: number;
      }> = [
        // Grow-only re-derivation at HEAD fd7bf68 (H-4, first-run drums
        // active): 52.1% / 49.5% / 56.7% measured after H-3's row growth —
        // floors raised 30→47.5 / 32→45 (the ~4.5pp sanctioned margin),
        // old floors stay the hard minimum. The pre-H-3 numbers were
        // 34.6% / 36.5% (30% / 32% floors); the pre-M-7 24px-row baseline
        // was 20.4% / 21.5%.
        { w: 390, h: 844, minShare: 0.475 },
        { w: 360, h: 800, minShare: 0.45 },
        { w: 430, h: 932, minShare: 0.52 },
      ];
      for (const { w, h, minShare } of CASES) {
        // The phone boot: the MB-6 overlay-scrollbar pin (the committed
        // Android-Chrome target) + the first-run demo, same as MB-1.
        const bundleKey = Object.keys(bundleGlob)[0];
        const cssKey = Object.keys(cssGlob)[0];
        expect(bundleKey, "built bundle missing").toBeTruthy();
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
<style>html{scrollbar-width:none}</style>
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
        doc0.close();
        const idoc = () => iframe.contentDocument!;
        try {
          await poll(
            () => !!idoc().querySelector(".phone-chrome"),
            15_000,
            "phone boot",
          );
          // Phone rail renders only the ACTIVE lane's row (MB-1), so the
          // desktop gate's VERSE-cue probe does not apply — any demo tile
          // proves the first-run document painted.
          await poll(
            () => (idoc().querySelectorAll(".lane-switch-tab").length === 4 ? Array.from(idoc().querySelectorAll(".head-ctl-value")).some((v) => (v.textContent ?? "").includes("SOFT STEP")) : idoc().querySelectorAll(".rail-tile").length > 0),
            5_000,
            "demo rail tiles",
          );
          // MB-6 settle law: fonts ready + a dimension-stable grid box.
          try {
            await idoc().fonts.ready;
          } catch {
            /* the stability poll below still applies */
          }
          await poll(
            () => {
              const g = idoc().querySelector<HTMLElement>(".lane-grid-scroll");
              if (!g) return false;
              const now = g.getBoundingClientRect().height;
              const last = (g as HTMLElement & { __m7h?: number }).__m7h;
              (g as HTMLElement & { __m7h?: number }).__m7h = now;
              return last !== undefined && Math.abs(now - last) < 0.5;
            },
            8_000,
            "settled grid box",
          );
          const vh = win.innerHeight;
          const grid = idoc().querySelector<HTMLElement>(".lane-grid-scroll")!;
          const gridH = grid.getBoundingClientRect().height;
          const share = gridH / vh;
          expect(
            share,
            `${w}×${h}: grid share of viewport (pre-M-7 20.4%/21.5%; i4 rework 34.6%/36.5%; i5 row growth measures 52.1%/49.5%/56.7% at 390/360/430)`,
          ).toBeGreaterThanOrEqual(minShare);
          // The chrome must not have regrown past its own law while the
          // grid took the space (the MB-1 twin, at the gate's own view).
          const chromeH = idoc()
            .querySelector<HTMLElement>(".phone-chrome")!
            .getBoundingClientRect().height;
          expect(
            chromeH,
            `${w}×${h}: chrome under half the viewport`,
          ).toBeLessThan(h / 2);
          // The row-target law: every rendered row ≥44px (44px rows are
          // 44px-tall cell targets — the M-7 finger-sized editing surface).
          const rows = Array.from(
            idoc().querySelectorAll<HTMLElement>(".grid-row"),
          );
          expect(rows.length, `${w}×${h}: rendered rows`).toBeGreaterThan(0);
          for (const row of rows) {
            expect(
              row.getBoundingClientRect().height,
              `${w}×${h}: grid row is a ≥44px cell target (M-7 PHONE_ROW_PX law)`,
            ).toBeGreaterThanOrEqual(44);
          }
          console.log(
            `[M-7 grid utilization · ${w}×${h}] grid ${gridH.toFixed(0)}px = ${(share * 100).toFixed(1)}% of viewport; chrome ${chromeH.toFixed(0)}px; ${rows.length} rows ≥44px`,
          );

          // --- H-4: the i5 WIDTH-FILL + BOTTOM-OWNERSHIP laws, per lane ----
          // The audit's exact fractions (§2 targets table): drums label-box
          // 68, pitched 56, so cellPx = (W−26 − labelBox − 15)/16 lands on
          // these EXACT 16ths. Measured boxes, never computed tracks (§2
          // fractional note: getComputedStyle serializes rounded tracks).
          const FILL_TOL = 0.25; // LayoutUnit 1/64-px bound at n=32 (§2)
          const EXPECTED_CELL_PX: Record<number, [drums: number, pitched: number]> =
            {
              390: [17.5625, 18.3125],
              360: [15.6875, 16.4375],
              430: [20.0625, 20.8125],
            };
          const [drumsPx, pitchedPx] = EXPECTED_CELL_PX[w]!;
          for (const lane of ["drums", "bass", "chords", "lead"] as const) {
            const expectedPx =
              lane === "drums" ? drumsPx : pitchedPx;
            const scrolling = lane === "chords"; // the demo's 2-bar scroller
            const tab = idoc().querySelector<HTMLElement>(
              `.lane-switch-tab[data-lane="${lane}"]`,
            )!;
            tab.click();
            await poll(
              () =>
                idoc().querySelector(".lane-floor")?.getAttribute("data-lane") ===
                lane,
              5_000,
              `${lane} stage`,
            );
            const cellsOf = () =>
              idoc().querySelector<HTMLElement>(".grid-row .row-cells")!;
            const wellOf = () =>
              idoc().querySelector<HTMLElement>(".lane-grid-scroll")!;
            const firstCellOf = () =>
              cellsOf().querySelector<HTMLElement>(".cell")!;
            // Fill-exact wait (the H-3 touch-gestures precedent): the mount
            // fit is one rAF out and fonts.ready re-fits once, so poll the
            // settled law instead of sleeping. On red, re-measure so the
            // failure carries the ACTUAL geometry (teeth with numbers).
            const measured = () => {
              const wellR = wellOf().getBoundingClientRect();
              const cellsR = cellsOf().getBoundingClientRect();
              return `measured dead-right ${(wellR.right - cellsR.right).toFixed(3)}px, first cell ${firstCellOf().getBoundingClientRect().width.toFixed(4)}px, well ${wellR.width.toFixed(1)}px`;
            };
            if (scrolling) {
              await poll(
                () => cellsOf().querySelectorAll(".cell").length === 32,
                5_000,
                `${lane} 2-bar row (32 steps)`,
              );
              try {
                await poll(
                  () =>
                    Math.abs(
                      firstCellOf().getBoundingClientRect().width - 15,
                    ) <= FILL_TOL,
                  8_000,
                  `${lane} 15-floor pitch`,
                );
              } catch (err) {
                  throw new Error(
                    `${(err as Error).message} — ${measured()}`,
                    { cause: err },
                  );
                }
            } else {
              try {
                await poll(
                  () =>
                    Math.abs(
                      wellOf().getBoundingClientRect().right -
                        cellsOf().getBoundingClientRect().right,
                    ) <= FILL_TOL,
                  8_000,
                  `${lane} fill-exact row (i5 §2 law)`,
                );
              } catch (err) {
                throw new Error(
                  `${(err as Error).message} — ${measured()}`,
                  { cause: err },
                );
              }
            }
            // WIDTH-FILL: the row owns the whole well — dead-right 0 (the
            // pre-H-2 dead band measured 41–93 px, audit §1).
            const cellsRect = cellsOf().getBoundingClientRect();
            const cellPx = firstCellOf().getBoundingClientRect().width;
            const well = wellOf();
            if (scrolling) {
              expect(
                cellPx,
                `${w}×${h} ${lane}: 2-bar keeps the committed 15px floor pitch`,
              ).toBeGreaterThanOrEqual(15 - FILL_TOL);
              expect(
                cellPx,
                `${w}×${h} ${lane}: 2-bar floor pitch is exactly 15 (raw fit 8-10 < 15)`,
              ).toBeLessThanOrEqual(15 + FILL_TOL);
              expect(
                well.scrollWidth,
                `${w}×${h} ${lane}: 2-bar scrolls INSIDE the well`,
              ).toBeGreaterThan(well.clientWidth);
              expect(
                idoc().documentElement.scrollWidth,
                `${w}×${h} ${lane}: 2-bar never h-scrolls the page`,
              ).toBeLessThanOrEqual(w);
            } else {
              const deadRight =
                well.getBoundingClientRect().right - cellsRect.right;
              expect(
                deadRight,
                `${w}×${h} ${lane}: dead-right px (i5 fill law: exact fill, 0 dead)`,
              ).toBeLessThanOrEqual(FILL_TOL);
              expect(
                deadRight,
                `${w}×${h} ${lane}: row must not overflow the well (1-bar fits)`,
              ).toBeGreaterThanOrEqual(-FILL_TOL);
              expect(
                cellPx,
                `${w}×${h} ${lane}: cell width == the audit's exact fraction (${expectedPx}px; the 15px pin retired by i5)`,
              ).toBeGreaterThanOrEqual(expectedPx - FILL_TOL);
              expect(cellPx).toBeLessThanOrEqual(expectedPx + FILL_TOL);
              expect(
                well.scrollWidth,
                `${w}×${h} ${lane}: 1-bar needs no horizontal scroll (exact fill)`,
              ).toBeLessThanOrEqual(well.clientWidth + 1);
            }
            // ROW-TRACK CLAMP: [44,64] (the §3 grow law; the M-7 ≥44 floor
            // plus H-3's cap — exact-44 retired).
            const trackPx = Number.parseFloat(
              getComputedStyle(cellsOf()).gridAutoRows,
            );
            expect(
              trackPx,
              `${w}×${h} ${lane}: row track ≥44 (M-7 floor)`,
            ).toBeGreaterThanOrEqual(44);
            expect(
              trackPx,
              `${w}×${h} ${lane}: row track ≤64 (i5 §3 cap)`,
            ).toBeLessThanOrEqual(64);
            // BOTTOM-OWNERSHIP: at scroll end the card bottom IS the
            // document bottom (pre-H-3 measured 4–236 px dead below).
            win.scrollTo(0, idoc().documentElement.scrollHeight);
            await new Promise((r) => setTimeout(r, 150));
            const floorBottomDoc =
              idoc()
                .querySelector<HTMLElement>(".lane-floor")!
                .getBoundingClientRect().bottom + win.scrollY;
            const docH = idoc().documentElement.scrollHeight;
            expect(
              Math.abs(docH - floorBottomDoc),
              `${w}×${h} ${lane}: dead-below at scroll end (i5 §3: the lane-floor owns the document bottom)`,
            ).toBeLessThanOrEqual(1);
            console.log(
              `[M-7 i5 · ${w}×${h} ${lane}] cell ${cellPx.toFixed(4)}px (expected ${scrolling ? "15 floor" : expectedPx}); track ${trackPx}px; bottom Δ ${(docH - floorBottomDoc).toFixed(2)}px`,
            );
          }
        } finally {
          await teardown(iframe);
        }
      }
    },
    240_000,
  );
});
