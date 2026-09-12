/**
 * i7 N-5 browser gate (midi-i7-audit §2.5, THE HEADER LAW) — the phone
 * card header, on the REAL BUILT APP (the mobile-transport harness law:
 * iframe + dist bundle, first-run wiped origin).
 *
 * The plan's AC (plan.md iteration-7 N-5): hide `.lane-state` at phone
 * scope; rebalance the compact row (title+LED left, MUTE/SOLO right;
 * PRESET own row; edit tier consistent alignment); every ≥44px hit at
 * 360/390/430; desktop/tablet strip byte-identical.
 *
 * Probes:
 *  1. NO STATE WORD AT PHONE: `.lane-state` (the `· EDIT`/`· VIEW` noise —
 *     exactly one lane is mounted at phone, StageFloor) is display:none
 *     with zero rects; the LED pseudo still paints (the LED + name carry
 *     the card). Desktop 1280×800 keeps the word, visible, with text.
 *  2. THE TIER LAW at 360/390/430 × every lane: the compact row is TWO
 *     explicit rows — identity (name left-anchored at the card content
 *     left, MUTE+SOLO trailing, SOLO's right edge AT the content right)
 *     and mix (PRESET/KIT left-anchored, VOLUME right-anchored at the
 *     content right). No third row, no tier creep (height stays 2×44+gap).
 *  3. NO-WRAP/OVERFLOW: every compact-row control inside the card's
 *     content box at every viewport; the VOLUME slider never shrinks
 *     below the 48px floor (≥44 target law) — the shrink chain resolves
 *     overflow by ellipsizing the preset name, never by re-wrapping.
 *  4. 44px AUDIT: MUTE/SOLO/PRESET ±/VOL + the edit tier (scale chip,
 *     GATE ±, FX, drums FILL) all ≥44×44 painted (MB-3 painted-box law).
 *  5. TAB ORDER = VISUAL ORDER (the m2 law, scoped to the strip): the
 *     phone DOM order the N-5 Show guard provides — row 1's mix keys
 *     before row 2's stepper/slider — reads top-to-bottom, left-to-right.
 *  6. DESKTOP FINGERPRINT (m4): at 1280×800 the compact row is the UNTIERED
 *     HEAD child sequence (name → sound → [OCT on pitched] → VOL → MUTE →
 *     SOLO), the state word rendered — the phone carve-out never touches
 *     the shared strip.
 *
 * Teeth (journaled in production-log "N-5"): scratch-removing the phone
 * CSS block reddens probes 1–3 (the state word returns; the rows collapse
 * back to HEAD's wrap scatter — VOL wraps to a third row at 360, the
 * stepper joins the identity row at 430, the trailing edges drift off the
 * content right); byte-exact restore → green.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEWPORTS: Array<[number, number]> = [
  [390, 844],
  [360, 800],
  [430, 932],
];
const LANES = ["drums", "bass", "chords", "lead"] as const;
/** The ROTATED phone (MB-1's own rotation case: width ≥768, height <600 —
 * still data-stage="phone"): the tier groups share ONE 44px line. */
const ROTATED: [number, number] = [844, 390];

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

async function wipeOrigin(win: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    let blocked = false;
    const grace = setTimeout(() => {
      blocked = true;
      resolve();
    }, 3000);
    const done = () => {
      if (blocked) return;
      clearTimeout(grace);
      resolve();
    };
    const req = win.indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = req.onblocked = done;
  });
  await new Promise((r) => setTimeout(r, 150));
}

/** The mobile-transport harness (deterministic first-run PX-1 demo). */
async function bootIframe(w: number, h: number) {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(bundleKey, "built bundle missing (globalSetup build failed?)").toBeTruthy();
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
  // 2026-09-11 merge: the phone chain rail lives on the SONG page now — the
  // phone boot signal is the preset readout. The fork keys on the app's own
  // stage (lane-switch tabs = phone, the rotated 844-wide phone included),
  // never on the raw width.
  await poll(
    () =>
      // 2026-09-11: rail-free on every stage (the chain is its own page).
      Array.from(idoc().querySelectorAll(".head-ctl-value")).some((v) =>
        (v.textContent ?? "").includes("SOFT STEP"),
      ),
    5_000,
    "demo chain tiles",
  );
  if (w < 768) {
    await poll(
      () => idoc().querySelector(".phone-transport .booth-btn-play") !== null,
      5_000,
      "pinned phone transport",
    );
  }
  return { iframe, $, $$, idoc };
}

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
};

describe("i7 N-5 phone card header law (§2.5, real built app)", () => {
  it(
    "390/360/430 × every lane: no · EDIT, identity/mix tiers anchored both edges, no wrap/overflow, ≥44 hits, tab order visual; desktop 1280 fingerprint unchanged",
    { timeout: 300_000 },
    async () => {
      for (const [w, h] of VIEWPORTS) {
        const { iframe, $, $$, idoc } = await bootIframe(w, h);
        try {
          for (const lane of LANES) {
            const tab = $(
              `.lane-switch-tab[data-lane="${lane}"]`,
            ) as HTMLElement;
            tab.click();
            await poll(
              () =>
                idoc().querySelector(
                  `.lane-floor[data-lane="${lane}"] .lane-strip-compact`,
                ) !== null,
              5000,
              `${lane} strip mounted`,
            );
            await new Promise((r) => setTimeout(r, 120));

            const floor = $(`.lane-floor[data-lane="${lane}"]`);
            const cs = idoc().defaultView!.getComputedStyle(floor);
            const fr = floor.getBoundingClientRect();
            const contentLeft = fr.left + parseFloat(cs.paddingLeft);
            const contentRight = fr.right - parseFloat(cs.paddingRight);
            const where = `${lane} @${w}×${h}`;

            const compact = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-compact`,
            );
            const cr = rectOf(compact);

            // --- probe 1: the state word is GONE at phone; LED stays -----
            const state = $(
              `.lane-floor[data-lane="${lane}"] .lane-state`,
            );
            const stateCS = idoc().defaultView!.getComputedStyle(state);
            expect(
              stateCS.display,
              `${where}: · EDIT/· VIEW word must be display:none at phone (one lane mounted — constant noise)`,
            ).toBe("none");
            expect(state.getBoundingClientRect().width).toBe(0);
            const name = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-compact .lane-name`,
            );
            const ledCS = idoc().defaultView!.getComputedStyle(
              name,
              "::before",
            );
            expect(
              ledCS.content,
              `${where}: the lane LED pseudo still paints beside the name`,
            ).not.toBe("none");
            expect(parseFloat(ledCS.width)).toBeGreaterThan(0);

            // --- probe 2: the tier law — identity row --------------------
            const rowId = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-id`,
            );
            const rowMix = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-mix`,
            );
            const idr = rectOf(rowId);
            const mixr = rectOf(rowMix);
            const nameR = rectOf(name);
            const muteBtn = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-id .head-mix-btn`,
            );
            const soloBtn = $$(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-id .head-mix-btn`,
            )[1];
            expect(soloBtn, `${where}: SOLO key in the identity row`).toBeTruthy();
            const mr = rectOf(muteBtn);
            const sr = rectOf(soloBtn!);
            // both mix keys live on the identity row, beside the name
            expect(
              Math.abs(mr.top - idr.top),
              `${where}: MUTE sits on the identity row`,
            ).toBeLessThan(2);
            expect(
              Math.abs(sr.top - idr.top),
              `${where}: SOLO sits on the identity row`,
            ).toBeLessThan(2);
            // WEIGHT BALANCE: left anchor = title at the card content left
            expect(
              Math.abs(nameR.left - contentLeft),
              `${where}: title left edge at the card's left padding`,
            ).toBeLessThanOrEqual(1);
            // right anchor = SOLO's right edge AT the content right
            expect(
              Math.abs(sr.right - contentRight),
              `${where}: SOLO right edge within 1px of the card's right edge`,
            ).toBeLessThanOrEqual(1);

            // --- probe 2: the tier law — mix row --------------------------
            const sound = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-mix [aria-label$=" sound"]`,
            );
            const vol = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-mix .head-ctl-vol`,
            );
            const soundR = rectOf(sound);
            const volR = rectOf(vol);
            expect(
              Math.abs(soundR.top - mixr.top),
              `${where}: PRESET/KIT group on the mix row`,
            ).toBeLessThan(2);
            expect(
              Math.abs(volR.top - mixr.top),
              `${where}: VOLUME group on the mix row`,
            ).toBeLessThan(2);
            expect(
              mixr.top - idr.bottom,
              `${where}: mix row strictly below the identity row`,
            ).toBeGreaterThanOrEqual(3);
            expect(
              Math.abs(soundR.left - contentLeft),
              `${where}: PRESET/KIT left edge at the card's left padding`,
            ).toBeLessThanOrEqual(1);
            expect(
              Math.abs(volR.right - contentRight),
              `${where}: VOLUME right edge within 1px of the card's right edge`,
            ).toBeLessThanOrEqual(1);

            // --- probe 3: no wrap, no overflow, no tier creep -------------
            expect(
              $$(`.lane-floor[data-lane="${lane}"] .lane-strip-compact > .lane-strip-row`),
              `${where}: exactly the two tier rows`,
            ).toHaveLength(2);
            expect(
              cr.height,
              `${where}: compact row stays two 44px lines + the row gap (no tier creep)`,
            ).toBeLessThanOrEqual(2 * 44 + 4 + 1);
            const controls = $$(
              `.lane-floor[data-lane="${lane}"] .lane-strip-compact button, .lane-floor[data-lane="${lane}"] .lane-strip-compact input`,
            );
            expect(controls.length).toBeGreaterThanOrEqual(5);
            for (const el of controls) {
              const r = rectOf(el);
              expect(
                r.left,
                `${where}: ${el.getAttribute("aria-label") ?? el.className} leaves the card's content box on the left`,
              ).toBeGreaterThanOrEqual(contentLeft - 0.5);
              expect(
                r.right,
                `${where}: ${el.getAttribute("aria-label") ?? el.className} overflows the card's content box on the right`,
              ).toBeLessThanOrEqual(contentRight + 0.5);
            }
            const slider = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-row-mix .head-range`,
            );
            expect(
              rectOf(slider).width,
              `${where}: VOLUME slider never below the 48px shrink floor`,
            ).toBeGreaterThanOrEqual(48);

            // --- probe 4: the 44px audit (MB-3 painted-box law) -----------
            const audit44 = (sel: string, what: string) => {
              const els = $$(
                `.lane-floor[data-lane="${lane}"] ${sel}`,
              );
              for (const el of els) {
                const r = rectOf(el);
                expect(
                  r.width,
                  `${where}: ${what} painted width ≥44 (MB-3)`,
                ).toBeGreaterThanOrEqual(44);
                expect(
                  r.height,
                  `${where}: ${what} painted height ≥44 (MB-3)`,
                ).toBeGreaterThanOrEqual(44);
              }
            };
            audit44(".lane-strip-compact .head-mix-btn", "MUTE/SOLO");
            audit44(
              '.lane-strip-compact .head-stepper .head-step-btn',
              "PRESET/KIT stepper",
            );
            audit44(".lane-strip-compact .head-range", "VOLUME slider");
            audit44(".lane-strip-edit .scale-chip", "scale chip");
            audit44(
              '.lane-strip-edit .head-stepper .head-step-btn',
              "GATE stepper",
            );
            audit44(".lane-strip-edit .head-fx", "FX");
            audit44(".lane-strip-edit .head-fill-toggle", "FILL toggle");

            // --- probe 2c: edit tier consistent alignment ------------------
            const edit = $(
              `.lane-floor[data-lane="${lane}"] .lane-strip-edit`,
            );
            const editChildren = Array.from(edit.children).filter(
              (c) => rectOf(c).width > 0,
            );
            expect(editChildren.length).toBeGreaterThanOrEqual(3);
            // group into visual lines; every line's leader sits at the
            // content left; nothing crosses the content right
            const lines: Element[][] = [];
            for (const child of editChildren) {
              const r = rectOf(child);
              const line = lines.find(
                (ln) => Math.abs(rectOf(ln[0]!).top - r.top) < 4,
              );
              if (line) line.push(child);
              else lines.push([child]);
            }
            expect(lines.length).toBeGreaterThanOrEqual(1);
            for (const line of lines) {
              const leader = line.reduce((a, b) =>
                rectOf(a).left <= rectOf(b).left ? a : b,
              );
              expect(
                Math.abs(rectOf(leader).left - contentLeft),
                `${where}: edit-tier line leader aligned at the card's left padding (consistent alignment)`,
              ).toBeLessThanOrEqual(1);
            }
            for (const child of editChildren) {
              expect(
                rectOf(child).right,
                `${where}: edit-tier item overflows the content box`,
              ).toBeLessThanOrEqual(contentRight + 0.5);
            }

            // --- probe 5: tab order = visual order, scoped to the strip ---
            const strip = $(`.lane-floor[data-lane="${lane}"] .lane-head-strip`);
            const tabbables = Array.from(
              strip.querySelectorAll<HTMLElement>("button, input"),
            ).filter(
              (el) =>
                el.isConnected &&
                el.tabIndex !== -1 &&
                !el.disabled &&
                el.getClientRects().length > 0,
            );
            expect(tabbables.length).toBeGreaterThanOrEqual(6);
            const labels = tabbables.map((el) =>
              el.getAttribute("aria-label") ?? el.className,
            );
            // the identity row's keys precede the mix row's stepper/slider
            const muteIdx = tabbables.findIndex(
              (el) => el.getAttribute("aria-label")?.startsWith("Mute") ?? false,
            );
            const presetPrev = tabbables.findIndex(
              (el) =>
                el.getAttribute("aria-label")?.startsWith("Previous") ?? false,
            );
            expect(
              muteIdx,
              `${where}: MUTE is a strip tab stop`,
            ).toBeGreaterThanOrEqual(0);
            expect(
              presetPrev,
              `${where}: the preset stepper is a strip tab stop`,
            ).toBeGreaterThanOrEqual(0);
            expect(
              muteIdx! < presetPrev!,
              `${where}: phone DOM order = visual order (identity row before mix row — the m2 law; a CSS-only visual reorder would leave the tab order scattered)`,
            ).toBe(true);
            for (let i = 1; i < tabbables.length; i++) {
              const a = tabbables[i - 1]!;
              const b = tabbables[i]!;
              const ra = rectOf(a);
              const rb = rectOf(b);
              const sameRow = rb.top < ra.bottom && ra.top < rb.bottom;
              if (sameRow) {
                expect(
                  rb.left,
                  `${where}: ${labels[i - 1]} → ${labels[i]} breaks left-to-right tab order`,
                ).toBeGreaterThanOrEqual(ra.left - 2);
              } else {
                expect(
                  rb.top,
                  `${where}: ${labels[i - 1]} → ${labels[i]} breaks top-to-bottom tab order`,
                ).toBeGreaterThanOrEqual(ra.top - 2);
              }
            }

            // the grid pane still paints below the rebalanced strip (the
            // PANE is the visual box — `[role=grid]` is the scrolled
            // content inside it, clipped, so its raw rect rides scrollTop)
            const pane = $(
              `.lane-floor[data-lane="${lane}"] .lane-grid-scroll`,
            );
            const crNow = rectOf(compact);
            const pr = rectOf(pane);
            expect(
              pr.top,
              `${where}: grid pane below the strip`,
            ).toBeGreaterThan(crNow.bottom);
          }
        } finally {
          iframe.remove();
        }
      }

      // --- probe 6b: the ROTATED phone — one line, the MB-4 budget -------
      // (measured regression this probe pins: the portrait tier law applied
      // to landscape grew the strip to two 44px lines, +48px of stage the
      // MB-4 rotation gates' scroll geometry cannot spare.)
      {
        const { iframe, $, idoc } = await bootIframe(ROTATED[0], ROTATED[1]);
        try {
          const lane = "lead";
          (
            $(`.lane-switch-tab[data-lane="${lane}"]`) as HTMLElement
          ).click();
          await poll(
            () =>
              idoc().querySelector(
                `.lane-floor[data-lane="${lane}"] .lane-strip-compact`,
              ) !== null,
            5000,
            "lead strip mounted (rotated)",
          );
          await new Promise((r) => setTimeout(r, 150));
          expect(
            idoc()
              .querySelector(".app")
              ?.getAttribute("data-stage"),
            "844×390 stays the phone stage",
          ).toBe("phone");
          const compact = $(
            `.lane-floor[data-lane="${lane}"] .lane-strip-compact`,
          );
          const cr = rectOf(compact);
          expect(
            cr.height,
            "rotated phone: the compact row is ONE line (the MB-4 rotation budget — HEAD's wide-phone strip is 44px)",
          ).toBeLessThanOrEqual(44 + 1);
          const idr = rectOf(
            $(`.lane-floor[data-lane="${lane}"] .lane-strip-row-id`),
          );
          const mixr = rectOf(
            $(`.lane-floor[data-lane="${lane}"] .lane-strip-row-mix`),
          );
          expect(
            Math.abs(idr.top - mixr.top),
            "rotated phone: identity + mix groups share the one line",
          ).toBeLessThan(2);
          // the state word stays hidden here too (one card, stage-wide law)
          expect(
            idoc().defaultView!.getComputedStyle(
              $(`.lane-floor[data-lane="${lane}"] .lane-state`),
            ).display,
          ).toBe("none");
          // nothing overflows the card
          const floor = $(`.lane-floor[data-lane="${lane}"]`);
          const cs = idoc().defaultView!.getComputedStyle(floor);
          const fr = floor.getBoundingClientRect();
          const contentRight = fr.right - parseFloat(cs.paddingRight);
          expect(mixr.right).toBeLessThanOrEqual(contentRight + 0.5);
        } finally {
          iframe.remove();
        }
      }

      // --- probe 6: desktop fingerprint (m4) — 1280×800, untiered HEAD ---
      {
        const { iframe, $, idoc } = await bootIframe(1280, 800);
        try {
          await poll(
            () =>
              idoc().querySelectorAll(".lane-floor").length === 4,
            5000,
            "four quadrant floors",
          );
          // drums: no OCT group — the exact HEAD sequence
          const drumsCompact = $(
            '.lane-floor[data-lane="drums"] .lane-strip-compact',
          );
          const drumsSeq = Array.from(drumsCompact.children).map(
            (c) => c.className,
          );
          expect(drumsSeq).toEqual([
            "lane-name",
            "head-ctl",
            "head-ctl head-ctl-vol",
            "head-mix-btn",
            "head-mix-btn",
          ]);
          // bass (pitched): OCT stays between sound and VOL — byte-identical
          const bassCompact = $(
            '.lane-floor[data-lane="bass"] .lane-strip-compact',
          );
          const bassSeq = Array.from(bassCompact.children).map(
            (c) => c.className,
          );
          expect(bassSeq).toEqual([
            "lane-name",
            "head-ctl",
            "head-ctl",
            "head-ctl head-ctl-vol",
            "head-mix-btn",
            "head-mix-btn",
          ]);
          // the state word renders on desktop
          for (const lane of ["drums", "bass"]) {
            const state = $(
              `.lane-floor[data-lane="${lane}"] .lane-state`,
            );
            const r = state.getBoundingClientRect();
            expect(r.width, `${lane} desktop state word visible`).toBeGreaterThan(0);
            expect(state.textContent).toMatch(/^· (EDIT|VIEW)$/);
          }
          // no phone tier rows anywhere on desktop
          expect(idoc().querySelectorAll(".lane-strip-row")).toHaveLength(0);
        } finally {
          iframe.remove();
        }
      }
    },
    300_000,
  );
});
