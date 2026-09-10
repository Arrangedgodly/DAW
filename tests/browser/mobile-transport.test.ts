/**
 * M-3 browser gate (iteration 4) — the pinned centered phone transport, on
 * the REAL BUILT APP (the mobile-viewport harness law: iframe + dist bundle,
 * first-run wiped origin, Android-Chrome overlay-scrollbar layout).
 *
 * The plan's AC (plan.md "M-3 · Centered always-visible play/stop"):
 *  1. PHONE 390×844 + 360×800 — the play button's client rect intersects
 *     the viewport with the grid scrolled to TOP and to BOTTOM (the sticky
 *     `.phone-chrome` row never scrolls away), and its center-x is within
 *     ±8 px of the viewport center-x (the centered pinned row).
 *  2. The pinned control's hit box is ≥44×44 (the MB-3 strap law — painted
 *     box ∪ lattice-scanned strap region, target-size's measurement law).
 *  3. ONE play/stop button per stage: at phone the single `.booth-btn-play`
 *     lives in the `.phone-transport` row inside the sticky chrome (the
 *     Booth's in-group copy is render-guarded away by `compact` — one
 *     handler, one help entry, one a11y-tree button); at desktop the single
 *     button lives in the Booth's Playback group and no `.phone-transport`
 *     row renders (the m4 byte-identical fallback law).
 *
 * Teeth (proved red during M-3 by flipping the row to
 * justify-content:flex-start): the ±8px center-x assertion reddens when the
 * button is not centered, and the scroll-bottom visibility assertion reddens
 * if the row leaves the sticky group.
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

/** A deterministic first-run boot (PX-1 demo) in a sized iframe — the
 * mobile-viewport.test.ts harness, verbatim law: overlay-scrollbar layout
 * so the phone stage lays out at the committed width. */
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
  await poll(() => $$(".rail-tile").length >= 2, 5_000, "demo chain tiles");
  // M-3: the pinned transport row is part of the phone boot signal — the
  // gate fails LOUD if the row (or its button) never renders.
  if (w < 768) {
    // M-3: at phone width the pinned transport row is part of the boot
    // signal — the gate fails LOUD if the row (or its button) never
    // renders. At desktop width the row must NOT exist (the m4 fallback).
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

/** Assert the pinned transport at the CURRENT scroll offset of `win`:
 * visible (rect intersects the viewport, nothing covering the center) and
 * horizontally centered within ±8 px of the viewport's center-x. */
function assertPinnedCentered(
  idoc: () => Document,
  win: Window,
  where: string,
): void {
  const btn = idoc().querySelector<HTMLElement>(".phone-transport .booth-btn-play");
  if (!btn) throw new Error(`[${where}] pinned play button missing`);
  const r = btn.getBoundingClientRect();
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  expect(
    r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw,
    `[${where}] play button rect ${r.left.toFixed(1)},${r.top.toFixed(1)} ` +
      `${r.width.toFixed(1)}×${r.height.toFixed(1)} does not intersect the ` +
      `${vw}×${vh} viewport`,
  ).toBe(true);
  const centerDelta = Math.abs(r.left + r.width / 2 - vw / 2);
  expect(
    centerDelta <= 8,
    `[${where}] play button center-x is ${centerDelta.toFixed(1)} px off the ` +
      `viewport center (rect left ${r.left.toFixed(1)}, width ${r.width.toFixed(1)}, viewport ${vw})`,
  ).toBe(true);
  // Not just geometrically visible — the button actually receives the hit
  // at its center (no overlay/neighbor stealing the tap).
  const hit = idoc().elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  expect(
    hit === btn || (hit && btn.contains(hit)),
    `[${where}] elementFromPoint at the button center resolves ${
      hit ? hit.tagName : "nothing"
    } instead of the play button`,
  ).toBe(true);
}

/** The MB-3 hit-box law for the pinned button: painted box ∪ contiguous
 * lattice-scanned strap region (the target-size measurement law, reduced to
 * the one control this gate owns). */
function assertHitBox44(idoc: () => Document, win: Window): void {
  const btn = idoc().querySelector<HTMLElement>(".phone-transport .booth-btn-play");
  if (!btn) throw new Error("pinned play button missing");
  const doc = idoc();
  const belongs = (x: number, y: number) => {
    const hit = doc.elementFromPoint(x, y);
    return hit === btn || (hit !== null && btn.contains(hit));
  };
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let left = cx;
  let right = cx;
  let top = cy;
  let bottom = cy;
  const guard = 60;
  while (left > cx - guard && belongs(left - 1, cy)) left--;
  while (right < cx + guard && belongs(right + 1, cy)) right++;
  while (top > cy - guard && belongs(cx, top - 1)) top--;
  while (bottom < cy + guard && belongs(cx, bottom + 1)) bottom++;
  const hitW = Math.max(r.right, right + 0.5) - Math.min(r.left, left - 0.5);
  const hitH = Math.max(r.bottom, bottom + 0.5) - Math.min(r.top, top - 0.5);
  expect(
    hitW >= 44 && hitH >= 44,
    `pinned play hit box ${hitW.toFixed(1)}×${hitH.toFixed(1)} < 44×44 ` +
      `(viewport ${win.innerWidth}×${win.innerHeight})`,
  ).toBe(true);
}

describe("M-3 phone transport — pinned centered always-visible play/stop", () => {
  it(
    "390×844 + 360×800: play centered ±8px and visible at scroll-top AND scroll-bottom, hit ≥44×44, exactly one button",
    { timeout: 180_000 },
    async () => {
      for (const [w, h] of [
        [390, 844],
        [360, 800],
      ] as const) {
        const { iframe, win, $, $$, idoc } = await bootIframe(w, h);
        try {
          // ONE play/stop on the phone stage: the pinned row's button, and
          // no Booth in-group copy (the `compact` render guard).
          const plays = $$(".booth-btn-play");
          expect(
            plays.length,
            `[${w}×${h}] expected exactly one .booth-btn-play, found ${plays.length}`,
          ).toBe(1);
          expect(
            $$(".phone-transport").length,
            `[${w}×${h}] expected exactly one .phone-transport row`,
          ).toBe(1);
          expect(
            $(".phone-transport").closest(".phone-chrome"),
            `[${w}×${h}] the transport row must live inside the sticky chrome`,
          ).toBeTruthy();
          expect(
            $$(".booth .booth-group .booth-btn-play").length,
            `[${w}×${h}] the Booth Playback group must NOT carry its own play copy at phone`,
          ).toBe(0);

          // The page must genuinely scroll (the law under test: the grid
          // scrolls while the transport stays pinned). The LEAD lane is the
          // tallest (the mobile-viewport scrolling-grid precedent) — switch
          // to it so the document exceeds the viewport.
          ($(`.lane-switch-tab[data-lane="lead"]`) as HTMLElement).click();
          await poll(
            () => $(".lane-floor").dataset.lane === "lead",
            5_000,
            "lead stage",
          );
          await poll(
            () => idoc().documentElement.scrollHeight > win.innerHeight + 8,
            5_000,
            "scrollable phone document",
          );

          // Fonts settle (the MB-6 law) before geometry is asserted.
          try {
            await (idoc() as Document & { fonts: FontFaceSet }).fonts.ready;
          } catch {
            /* fonts API unavailable */
          }
          await new Promise((r) => setTimeout(r, 50));

          // Scroll TOP.
          win.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 80));
          assertPinnedCentered(idoc, win, `${w}×${h} scroll-top`);
          assertHitBox44(idoc, win);

          // Scroll BOTTOM.
          win.scrollTo(0, idoc().documentElement.scrollHeight);
          await new Promise((r) => setTimeout(r, 80));
          // Fractional layout heights can leave a sub-pixel remainder —
          // "at the bottom" is within 1 px of the max scroll.
          expect(
            Math.abs(
              win.scrollY -
                (idoc().documentElement.scrollHeight - win.innerHeight),
            ),
            "the document actually scrolled to the bottom",
          ).toBeLessThanOrEqual(1);
          assertPinnedCentered(idoc, win, `${w}×${h} scroll-bottom`);
        } finally {
          await teardown(iframe);
        }
      }
    },
  );

  it("desktop 1280×800: the Booth play button is the one button, in the Playback group; no phone transport row", { timeout: 120_000 }, async () => {
    const { iframe, win, $, $$ } = await bootIframe(1280, 800);
    try {
      expect($$(".booth-btn-play").length).toBe(1);
      expect(
        $(".booth .booth-group .booth-btn-play"),
        "desktop play button must render inside the Booth Playback group",
      ).toBeTruthy();
      expect(
        $$(".phone-transport").length,
        "no phone transport row may render outside the phone stage",
      ).toBe(0);
      expect($$(".phone-chrome").length).toBe(0);
      expect(win.innerWidth).toBe(1280);
    } finally {
      await teardown(iframe);
    }
  });
});
