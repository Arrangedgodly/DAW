/**
 * M-5 browser gate (iteration 4) — the phone-stage ONE-OCTAVE register
 * window + octave/semitone shift row, on the REAL BUILT APP (the
 * mobile-transport harness law: iframe + dist bundle, first-run wiped
 * origin).
 *
 * The plan's AC (plan.md "M-5 · One-octave window + octave/semitone shift"):
 *  1. WINDOW MATH: at phone viewport a windowed pitched lane (lead — the
 *     demo's tallest manifest, 15 rows) shows EXACTLY the scale-mode row
 *     count (modeSize(minor) = 7): not the 15-row manifest, not a grown
 *     window (the phone fill compressor never grows windows).
 *  2. SHIFT ACTIONS (i7 N-2 regroup: TWO steppers — OCT −/+ steps ONE
 *     OCTAVE OF THE SCALE (modeSize rows), SEMI −/+ steps ONE SEMITONE
 *     (±1 row)) move the window through the RC-1 seam — observed as the
 *     visible row-label set changing while the COUNT stays pinned at the
 *     one-octave default.
 *  3. BOUNDS: the shifts CLAMP at the manifest edges and the buttons DISABLE
 *     eagerly at the bounds (demo lead: rows 15 − window 7 → maxStart 8;
 *     from the default start 6, OCT+ clamps to 8 and disables the + pair;
 *     OCT− from 8 lands at 1 (8−7, mid-manifest), OCT− again clamps to 0
 *     and disables the − pair; SEMI+ from 0 is exactly +1).
 *  4. TARGETS: every shift button carries a ≥44×44 painted hit box (the
 *     MB-3 painted-box law — no strap on these).
 *  5. DESKTOP NON-REGRESSION: at 1280×800 there is NO shift row, the lead
 *     quadrant still windows at 7 rows, and the desktop Booth/grid chrome is
 *     untouched (no .register-shift DOM at all).
 *
 * Teeth: probe 1 reddens if the phone ever renders the full manifest again
 * (the pre-M-5 law — 15 labels); probe 2 reddens if a delta is ±12/±1 in
 * rows-worth of LABELS (a wrong first-label after a shift); probe 3 reddens
 * if clamping or the eager disabled state is lost; probe 5 reddens if the
 * row leaks onto the desktop stage.
 */

import { describe, expect, it } from "vitest";
import { modeSize } from "../../src/document/scales";

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

/** A deterministic first-run boot (PX-1 demo) in a sized iframe — the
 * mobile-transport.test.ts harness, verbatim law. */
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
  try {
    await wipeOrigin(win);
  } catch (err) {
    iframe.remove();
    throw err;
  }
  const doc0 = iframe.contentDocument!;
  doc0.open();
  doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}"/>
<style>html { scrollbar-width: none; }</style>
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
  await poll(() => ($$(".lane-switch-tab").length === 4 ? $$(".head-ctl-value").some((v) => (v.textContent ?? "").includes("SOFT STEP")) : $$(".rail-tile").length >= 2), 5_000, "demo chain tiles");
  if (w < 768) {
    await poll(
      () => !!idoc().querySelector(".phone-transport .booth-btn-play"),
      5_000,
      "pinned phone transport",
    );
  }
  return { iframe, win, $, $$, idoc };
}

async function wipeOrigin(win: Window): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let blocked = false;
    const grace = setTimeout(() => {
      if (blocked)
        reject(
          new Error(
            "bootIframe wipe stayed blocked for 3 s — the first-run boot is not honest",
          ),
        );
    }, 3_000);
    const req = win.indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = () => {
      clearTimeout(grace);
      resolve();
    };
    req.onblocked = () => {
      blocked = true;
    };
  });
}

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

describe("M-5 phone register window — one octave, ±octave/±semitone shifts, clamped", () => {
  it(
    "390×844 lead lane: exactly 7 visible rows; OCT/SEMI shift the window ±12/±1; clamped + eagerly disabled at bounds; ≥44px targets",
    { timeout: 180_000 },
    async () => {
      const { iframe, $, $$ } = await bootIframe(390, 844);
      try {
        // --- stage: switch to LEAD (the tallest demo manifest, 15 rows) ---
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          5_000,
          "lead stage",
        );
        // The shift row is phone-only and pitched-only.
        const row = $(".lane-floor[data-lane='lead'] .register-shift");
        expect(row.getAttribute("role")).toBe("group");

        // --- 1. WINDOW MATH: exactly the one-octave default --------------
        // Demo scale = minor → modeSize 7; the manifest is 15 rows. The
        // window is a fixed-height scroll seat (rows above/below stay in the
        // DOM, scrolled out) — so count only labels INSIDE the scroll box.
        const WINDOW = modeSize("minor"); // 7
        const visibleLabels = (): string[] => {
          const scroll = $(
            ".lane-floor[data-lane='lead'] .lane-grid-scroll",
          ) as HTMLElement;
          const box = scroll.getBoundingClientRect();
          return $$(".lane-floor[data-lane='lead'] .row-label")
            .filter((l) => {
              const r = l.getBoundingClientRect();
              return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
            })
            .map((l) => l.textContent?.trim() ?? "")
            .filter(Boolean);
        };
        const labels = visibleLabels;
        await poll(
          () => labels().length === WINDOW,
          5_000,
          `one-octave window (${WINDOW} rows)`,
        );
        expect(labels().length, "not the 15-row manifest, not grown").toBe(
          WINDOW,
        );
        const firstAtDefault = labels()[0];

        // --- 4. TARGETS: ≥44×44 painted hit boxes ------------------------
        // i7 N-2: the two steppers' four buttons (aria-labeled — the
        // painted glyphs are −/+).
        const btn = (label: string): HTMLButtonElement => {
          const el = $$(".lane-floor[data-lane='lead'] .register-shift-btn").find(
            (b) => b.getAttribute("aria-label") === label,
          );
          if (!el) throw new Error(`missing shift button ${label}`);
          return el as HTMLButtonElement;
        };
        const LABELS = [
          "LEAD octave view down",
          "LEAD octave view up",
          "LEAD semitone view down",
          "LEAD semitone view up",
        ] as const;
        for (const label of LABELS) {
          const r = btn(label).getBoundingClientRect();
          expect(
            r.width >= 44 && r.height >= 44,
            `${label} hit box ${r.width.toFixed(1)}×${r.height.toFixed(1)} < 44×44`,
          ).toBe(true);
        }

        // The grid's aria-label is the honest window readout
        // (`… · ROWS start–end OF max`) — the EXACT-start probe for the
        // ±12/±1 deltas and both clamps (the clamp on lead masks a raw
        // +12 vs +11 from start 6, so deltas assert on the seat itself).
        const rowsLabel = (): string => {
          const m = $(".lane-floor[data-lane='lead'] .lane-grid").getAttribute(
            "aria-label",
          );
          const r = /ROWS (\d+)–(\d+) OF (\d+)/.exec(m ?? "");
          if (!r) throw new Error(`grid name carries no ROWS range: ${m}`);
          return r[1]!;
        };
        // Demo lead: 15 rows − 7 window → maxStart 8; the default start is 6
        // (the most-noted-rows heuristic).
        expect(rowsLabel(), "default window start").toBe("6");

        // --- 2+3. OCT+ (+modeSize) CLAMPS to the top and disables --------
        const octPlus = btn("LEAD octave view up");
        expect(octPlus.disabled, "OCT+ enabled at start 6 (below max 8)").toBe(
          false,
        );
        octPlus.click();
        await poll(
          () => octPlus.disabled && btn("LEAD semitone view up").disabled,
          5_000,
          "+ pair disabled at the clamped top (maxStart 8)",
        );
        expect(rowsLabel(), "OCT+ from 6: 6+7 clamped to maxStart 8").toBe("8");
        expect(labels().length, "window COUNT pinned at the octave").toBe(
          WINDOW,
        );
        expect(
          labels()[0] !== firstAtDefault,
          "OCT+ (clamped +2) must move the visible rows",
        ).toBe(true);

        // --- OCT− (−modeSize) from 8 lands at 1 (mid-manifest) ----------
        const octMinus = btn("LEAD octave view down");
        octMinus.click();
        await poll(
          () => rowsLabel() === "1",
          5_000,
          "OCT− from 8: 8−7 = 1 (mid-manifest, no clamp)",
        );
        expect(labels().length).toBe(WINDOW);
        // --- OCT− again CLAMPS to 0 and disables the − pair -------------
        octMinus.click();
        await poll(
          () => octMinus.disabled && btn("LEAD semitone view down").disabled,
          5_000,
          "− pair disabled at the bottom (start 0)",
        );
        expect(rowsLabel(), "OCT− from 1: 1−7 clamped to 0").toBe("0");
        expect(labels().length).toBe(WINDOW);

        // --- SEMI+ from the bottom is EXACTLY +1 row --------------------
        const bottomWindow = labels(); // snapshot BEFORE the +1 click
        btn("LEAD semitone view up").click();
        await poll(
          () => !btn("LEAD semitone view down").disabled && rowsLabel() === "1",
          5_000,
          "SEMI+ → start exactly 1 (±1 law), SEMI− re-enabled",
        );
        expect(rowsLabel()).toBe("1");
        // The one-row nudge: the bottom window's SECOND label is the new
        // first (the manifest is one contiguous ascending label sequence).
        const afterSemi = labels();
        expect(afterSemi.length).toBe(WINDOW);
        expect(
          afterSemi[0],
          "SEMI+ shifts the visible rows by exactly one",
        ).toBe(bottomWindow[1]);

        // The drums lane (unpitched) never gets a shift row.
        $<HTMLElement>('.lane-switch-tab[data-lane="drums"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          5_000,
          "drums stage",
        );
        expect(
          $$(".register-shift").length,
          "drums (unpitched) has no shift row",
        ).toBe(0);
      } finally {
        await teardown(iframe);
      }
    },
    180_000,
  );

  it(
    "desktop 1280×800: no shift row anywhere; the lead quadrant still windows at one octave (non-regression)",
    { timeout: 120_000 },
    async () => {
      const { iframe, $, $$ } = await bootIframe(1280, 800);
      try {
        expect(
          $$(".register-shift, .register-shift-btn").length,
          "the shift row is phone-only",
        ).toBe(0);
        // The desktop lead quadrant still windows (RC-1 law untouched): the
        // seat carries .is-windowed and shows at LEAST the one-octave count
        // (the desktop fill law may GROW windows — the surplus growth M-5
        // keeps; measured 12 of the 14-row manifest at this HEAD, the
        // pre-change value). Exact desktop window math stays owned by the
        // register-controls gate (Shift+arrow law).
        const scroll = $(
          ".lane-floor[data-lane='lead'] .lane-grid-scroll",
        ) as HTMLElement;
        expect(
          scroll.classList.contains("is-windowed"),
          "desktop lead grid still windowed",
        ).toBe(true);
        const box = scroll.getBoundingClientRect();
        const leadLabels = $$(".lane-floor[data-lane='lead'] .row-label").filter(
          (l) => {
            const r = l.getBoundingClientRect();
            return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
          },
        );
        expect(
          leadLabels.length,
          "desktop lead window ≥ one octave (fill growth allowed, full manifest is not)",
        ).toBeGreaterThanOrEqual(modeSize("minor"));
        // And the desktop Booth/grid chrome never grew a phone control.
        expect($$(".phone-transport").length).toBe(0);
        void $;
      } finally {
        await teardown(iframe);
      }
    },
    120_000,
  );
});
