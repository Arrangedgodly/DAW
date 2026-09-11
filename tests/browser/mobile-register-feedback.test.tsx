/**
 * M-6 browser gate (iteration 4) — REGISTER-CHANGE FEEDBACK on the phone
 * stage, on the REAL BUILT APP (the mobile-transport/mobile-register-window
 * harness law: iframe + dist bundle, first-run wiped origin).
 *
 * The plan's AC (plan.md "M-6 · Register-change feedback"):
 *  1. LABEL RE-ANCHOR WITHIN ONE FRAME: at phone viewport, shifting the
 *     window changes the visible row-label text within one rAF after the
 *     click (the renderer re-seats through the same RC-1 effect).
 *  2. READOUT + ANNOUNCE: the window readout chip (ROWS start–end OF total)
 *     updates in the same frame and is the aria-live region (SR-friendly
 *     announcement rides the same state change — no second source).
 *  3. TRANSIENT CUE, CODED NOT COLOR-ONLY: the shift stamps data-cue
 *     up/down on the shift row (fill + inset border + ▲/▼ shape glyph in
 *     the chip) and clears it after the flash (~1.2 s); a rapid second
 *     shift RESTARTS the flash (parity flip).
 *  4. REDUCED MOTION: under prefers-reduced-motion: reduce the transient cue
 *     is ABSENT (no data-cue, arrow stays at rest) while the readout and
 *     the label re-anchor still land immediately (static equivalent).
 *  5. DESKTOP NON-REGRESSION: at 1280×800 no shift row, no readout, no cue
 *     DOM anywhere (phone-only chrome; desktop Booth/grid untouched).
 *
 * Teeth: probe 1 reddens if the label change lags a frame; probes 2/4 on
 * the exact readout text (a stale chip is a false re-anchor); probe 3
 * reddens if the cue never fires or never clears; probe 4 reddens if any
 * animation path survives reduced motion; probe 5 reddens if the chip leaks
 * to desktop.
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

/**
 * A deterministic first-run boot (PX-1 demo) in a sized iframe — the
 * mobile-register-window.test.tsx harness, verbatim law. `reducedMotion`
 * stubs the iframe's matchMedia for prefers-reduced-motion BEFORE the
 * bundle loads (delegating every other query, e.g. the width probes
 * stageMode reads) — deterministic without CDP emulation of the host page.
 */
async function bootIframe(
  w: number,
  h: number,
  reducedMotion = false,
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
<script>
(() => {
  if (!${reducedMotion ? "true" : "false"}) return;
  const orig = window.matchMedia.bind(window);
  window.matchMedia = (q) =>
    String(q).includes("prefers-reduced-motion")
      ? {
          matches: true,
          media: String(q),
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        }
      : orig(q);
})();
</script>
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

describe("M-6 phone register-change feedback — readout re-anchor + coded transient cue, reduced-motion safe", () => {
  it(
    "390×844 lead lane: labels + aria-live readout change within one frame; cue fires, restarts, and fades; direction coded",
    { timeout: 180_000 },
    async () => {
      const { iframe, win, $, $$ } = await bootIframe(390, 844);
      try {
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          5_000,
          "lead stage",
        );
        const shiftRow = $(".lane-floor[data-lane='lead'] .register-shift");
        const readout = $(
          ".lane-floor[data-lane='lead'] .register-window-readout",
        );
        const arrow = $(".lane-floor[data-lane='lead'] .register-window-arrow");

        // --- 2. The readout IS the aria-live announcement region ---------
        expect(readout.getAttribute("aria-live")).toBe("polite");

        // Demo lead: 15 rows, minor window 7, default start 6.
        const WINDOW = 7;
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
        await poll(
          () => visibleLabels().length === WINDOW,
          5_000,
          "one-octave window",
        );
        expect(readout.textContent?.replace(/\s+/g, " ").trim()).toBe(
          "■ROWS 7–13 OF 15",
        );

        const btn = (text: string): HTMLButtonElement => {
          const el = $$(
            ".lane-floor[data-lane='lead'] .register-shift-btn",
          ).find((b) => b.textContent?.trim() === text);
          if (!el) throw new Error(`missing shift button ${text}`);
          return el as HTMLButtonElement;
        };

        // --- 1+2+3. SEMI+: label text + readout change within ONE frame,
        // cue stamped "up" with the ▲ shape glyph --------------------------
        const before = visibleLabels()[0];
        btn("SEMI +").click();
        await new Promise<void>((r) => win.requestAnimationFrame(() => r()));
        const afterOneFrame = visibleLabels()[0];
        expect(
          afterOneFrame,
          "row-label text re-anchored within one frame",
        ).not.toBe(before);
        expect(
          readout.textContent?.replace(/\s+/g, " ").trim(),
          "readout re-anchored within one frame",
        ).toBe("▲ROWS 8–14 OF 15");
        expect(shiftRow.getAttribute("data-cue"), "cue direction").toBe("up");
        expect(arrow.textContent?.trim(), "shape-coded direction glyph").toBe(
          "▲",
        );
        const parity1 = shiftRow.getAttribute("data-cue-parity");

        // --- 3. A rapid second shift RESTARTS the flash (parity flips) ---
        btn("SEMI +").click();
        await new Promise<void>((r) => win.requestAnimationFrame(() => r()));
        expect(
          shiftRow.getAttribute("data-cue-parity") !== parity1,
          "second shift restarts the cue (parity flip)",
        ).toBe(true);
        expect(readout.textContent?.replace(/\s+/g, " ").trim()).toBe(
          "▲ROWS 9–15 OF 15",
        );

        // --- 3. The cue is TRANSIENT: cleared after the flash ------------
        await poll(
          () => shiftRow.getAttribute("data-cue") === null,
          4_000,
          "cue cleared after the flash",
        );
        expect(arrow.textContent?.trim(), "arrow returns to rest").toBe("■");

        // --- 3. Direction is signed: SEMI− codes "down" ------------------
        btn("SEMI −").click();
        await poll(
          () => shiftRow.getAttribute("data-cue") === "down",
          5_000,
          "down cue",
        );
        expect(arrow.textContent?.trim()).toBe("▼");
        expect(readout.textContent?.replace(/\s+/g, " ").trim()).toBe(
          "▼ROWS 8–14 OF 15",
        );
      } finally {
        await teardown(iframe);
      }
    },
    180_000,
  );

  it(
    "reduced motion: no transient cue at all (static readout re-anchor is the equivalent); labels still change",
    { timeout: 180_000 },
    async () => {
      const { iframe, win, $, $$ } = await bootIframe(390, 844, true);
      try {
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          5_000,
          "lead stage",
        );
        const shiftRow = $(".lane-floor[data-lane='lead'] .register-shift");
        const readout = $(
          ".lane-floor[data-lane='lead'] .register-window-readout",
        );
        const arrow = $(".lane-floor[data-lane='lead'] .register-window-arrow");
        await poll(
          () => readout.textContent?.includes("ROWS 7–13 OF 15"),
          5_000,
          "default readout",
        );

        const visibleFirst = (): string => {
          const scroll = $(
            ".lane-floor[data-lane='lead'] .lane-grid-scroll",
          ) as HTMLElement;
          const box = scroll.getBoundingClientRect();
          return (
            $$(".lane-floor[data-lane='lead'] .row-label")
              .find((l) => {
                const r = l.getBoundingClientRect();
                return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
              })
              ?.textContent?.trim() ?? ""
          );
        };
        const before = visibleFirst();
        const semiPlus = $$(
          ".lane-floor[data-lane='lead'] .register-shift-btn",
        ).find((b) => b.textContent?.trim() === "SEMI +")! as HTMLButtonElement;
        semiPlus.click();
        await new Promise<void>((r) => win.requestAnimationFrame(() => r()));

        // The static equivalent lands immediately: readout + label text.
        expect(readout.textContent?.replace(/\s+/g, " ").trim()).toBe(
          "■ROWS 8–14 OF 15",
        );
        expect(visibleFirst(), "label re-anchor still immediate").not.toBe(
          before,
        );

        // The transient cue NEVER appears for a full flash window.
        const deadline = Date.now() + 1_600;
        while (Date.now() < deadline) {
          expect(
            shiftRow.getAttribute("data-cue"),
            "no transient cue under reduced motion",
          ).toBeNull();
          expect(arrow.textContent?.trim(), "arrow stays at rest").toBe("■");
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        await teardown(iframe);
      }
    },
    180_000,
  );

  it(
    "desktop 1280×800: no shift row, no readout, no cue DOM (non-regression)",
    { timeout: 120_000 },
    async () => {
      const { iframe, $$ } = await bootIframe(1280, 800);
      try {
        expect(
          $$(
            ".register-shift, .register-shift-btn, .register-window-readout, [data-cue]",
          ).length,
          "the feedback chrome is phone-only",
        ).toBe(0);
      } finally {
        await teardown(iframe);
      }
    },
    120_000,
  );
});
