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
 * 34.6% / 36.5% (bass 40.3%). The gate pins the REWORKED numbers minus a
 * sanctioned ~4.5pp margin (30% / 32%): restoring the 24px rows reddens it
 * at both viewports (20.4 / 21.5 < 30 / 32).
 *
 * ROW-TARGET LAW: every rendered `.grid-row` is ≥44px tall — the cell hit
 * test is row-exact on the vertical axis, so this is the target-size law's
 * metric applied to the grid surface itself (the cells' WIDTH stays the
 * committed 15px 1-bar horizontal fit law; the grid is the recorded pan-y
 * gesture surface, exempted as a DATA TARGET in the MB-3 audit).
 *
 * Chrome law stays where it lives (mobile-viewport MB-1/MB-6: <50% at
 * 360×800) — this gate asserts only the utilization delta it owns.
 * ------------------------------------------------------------------------- */
describe("M-7 phone-stage grid utilization (built app, 390×844 + 360×800)", () => {
  it(
    "the grid takes ≥30%/≥32% of the phone viewport; every grid row ≥44px",
    { timeout: 180_000 },
    async () => {
      const CASES: ReadonlyArray<{
        w: number;
        h: number;
        minShare: number;
      }> = [
        { w: 390, h: 844, minShare: 0.3 },
        { w: 360, h: 800, minShare: 0.32 },
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
            () => idoc().querySelectorAll(".rail-tile").length > 0,
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
            `${w}×${h}: grid share of viewport (baseline 20.4%/21.5% pre-M-7; rework measures 34.6%/36.5%)`,
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
        } finally {
          await teardown(iframe);
        }
      }
    },
    180_000,
  );
});
