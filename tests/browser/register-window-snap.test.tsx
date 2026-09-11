/**
 * N-2 browser gate (iteration 7) — THE SEMITONE-SNAP WINDOW LAW + THE BOX
 * LAW on the REAL BUILT APP (the m5 harness law: iframe + dist bundle,
 * first-run wiped origin), per docs/dev/midi-i7-audit.md §2.1 and §5.1:
 *
 *  1. EXACTLY `modeSize` COMPLETE ROWS at every rest: at boot, after button
 *     shifts (SEMI ±1 row / OCT ±modeSize rows), and after a SETTLED scroll
 *     — no partial row at EITHER edge (the m5 containment-predicate blind
 *     spot: "7 contained labels" passed while an 8th row intersected the
 *     stretched box as a sliver — the measured 332-pin-in-344-box probe).
 *  2. BOX === PIN: the windowed pane's border box is the renderer's inline
 *     pin (≈ modeSize row pitches) — the phone flex growth is retired for
 *     windowed panes (app.css .is-windowed rule).
 *  3. SEATED AT EVERY REST: scrollTop sits ON the row grid after every
 *     intentional move and after a settled scroll (scrollend + the settle
 *     fallback snap). Sub-row drift is mid-gesture only.
 *  4. THE PROBE-4 SWALLOW, RED→GREEN: from an UNSEATED rest (scrollTop
 *     nudged +20px mid-gesture, SEMI+ clicked in the same task — before any
 *     settle macrotask can run), SEMI+ must move the pane EXACTLY ONE ROW
 *     and seat on-grid. The retired distance guard swallowed exactly this
 *     (the readout moved, the pixels stayed: "notes sit stagnant while the
 *     viewed range changes").
 *  5. ONE SOURCE OF TRUTH: the register readout chip === the grid aria
 *     range at every rest (same 0-based `ROWS start–end OF last` string).
 *  6. DEAD-BELOW ~0 AT SCROLL END: the i5 bottom-ownership law survives the
 *     box clause — the CARD still owns the document bottom (the stage
 *     stretch, never the pane stretch).
 *  7. Viewports 390/360/430 (the i7 fence list) — one boot, live re-fits
 *     between them (the phone width/row fit re-runs on resize; the grid
 *     surface itself does not remount — the stage stays phone).
 */

import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
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
  await poll(() => $$(".rail-tile").length >= 2, 5_000, "demo chain tiles");
  await poll(
    () => !!idoc().querySelector(".phone-transport .booth-btn-play"),
    5_000,
    "pinned phone transport",
  );
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

describe("N-2 phone register-window snap — exactly one octave, seated at every rest", () => {
  it(
    "390/360/430: modeSize complete rows at boot/shifts/settled scroll; box === pin; SEMI+ from an unseated rest seats (probe-4); readout === aria; dead-below ~0",
    { timeout: 300_000 },
    async () => {
      const WINDOW = modeSize("minor"); // 7 — the demo's scale
      const MAX_START = 8; // demo lead: 15 rows − 7 window
      const { iframe, win, $, $$, idoc } = await bootIframe(390, 844);
      try {
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          5_000,
          "lead stage",
        );

        const seat = (): HTMLElement =>
          $(".lane-floor[data-lane='lead'] .lane-grid-scroll");
        const rows = (): HTMLElement[] =>
          $$(".lane-floor[data-lane='lead'] .grid-row");
        const pitch = (): number => {
          const r = rows();
          return (
            r[1]!.getBoundingClientRect().top -
            r[0]!.getBoundingClientRect().top
          );
        };
        /** Row 0's top in the seat's scroll coordinate space. */
        const rowBase = (): number =>
          rows()[0]!.getBoundingClientRect().top -
          seat().getBoundingClientRect().top +
          seat().scrollTop;
        /** scrollTop's offset from the row grid (0 = seated). */
        const seatOffset = (): number => {
          const p = pitch();
          return Math.abs((seat().scrollTop - rowBase()) % p);
        };
        const ariaStart = (): number => {
          const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(
            $(".lane-floor[data-lane='lead'] .lane-grid").getAttribute(
              "aria-label",
            ) ?? "",
          );
          if (!m) throw new Error("grid aria carries no ROWS range");
          return Number(m[1]);
        };
        const ariaRange = (): string => {
          const m = $(".lane-floor[data-lane='lead'] .lane-grid").getAttribute(
            "aria-label",
          );
          const r = /ROWS \d+–\d+ OF \d+/.exec(m ?? "");
          if (!r) throw new Error(`grid aria carries no ROWS range: ${m}`);
          return r[0];
        };
        const readoutRange = (): string => {
          const t = (
            $(".lane-floor[data-lane='lead'] .register-window-readout")
              .textContent ?? ""
          )
            .replace(/\s+/g, " ")
            .trim();
          const r = /ROWS \d+–\d+ OF \d+/.exec(t);
          if (!r) throw new Error(`readout carries no ROWS range: ${t}`);
          return r[0];
        };
        const btn = (label: string): HTMLButtonElement => {
          const el = $$(".lane-floor[data-lane='lead'] .register-shift-btn").find(
            (b) => b.getAttribute("aria-label") === label,
          );
          if (!el) throw new Error(`missing shift button ${label}`);
          return el as HTMLButtonElement;
        };

        /** THE LAW: exactly modeSize COMPLETE rows, box ≈ pin, seat
         * on-grid, readout === aria; deadBelow also asserts the i5 card
         * ownership at page scroll end. */
        const law = (state: string, deadBelow: boolean): void => {
          const s = seat();
          const box = s.getBoundingClientRect();
          const boxes = rows().map((r) => r.getBoundingClientRect());
          const intersecting = boxes.filter(
            (r) => r.top < box.bottom - 0.5 && r.bottom > box.top + 0.5,
          );
          const contained = boxes.filter(
            (r) => r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
          );
          expect(
            intersecting.length,
            `${state}: exactly ${WINDOW} rows intersect the pane (no partial 8th row at either edge — the 344-box probe)`,
          ).toBe(WINDOW);
          expect(
            contained.length,
            `${state}: all ${WINDOW} visible rows are FULLY contained (no edge clipping)`,
          ).toBe(WINDOW);
          const p = pitch();
          expect(
            Math.abs(box.height - p * WINDOW),
            `${state}: pane box height === ${WINDOW} row pitches (${p.toFixed(2)}px each) — the renderer pin, never the flex stretch`,
          ).toBeLessThanOrEqual(2.5);
          const off = seatOffset();
          expect(
            off <= 1 || Math.abs(off - p) <= 1,
            `${state}: scrollTop seated on the row grid (offset ${off.toFixed(2)}px of ${p.toFixed(2)}px pitch)`,
          ).toBe(true);
          expect(
            readoutRange(),
            `${state}: readout chip === grid aria range (one source of truth)`,
          ).toBe(ariaRange());
          if (deadBelow) {
            win.scrollTo(0, win.scrollY + 10_000);
            const docH = idoc().documentElement.scrollHeight;
            const floorBottom =
              $(".lane-floor").getBoundingClientRect().bottom + win.scrollY;
            expect(
              docH - floorBottom,
              `${state}: dead-below at scroll end (i5 H-3: the card owns the document bottom)`,
            ).toBeLessThanOrEqual(1);
          }
        };

        // The demo lead: 15-row manifest, window 7, default start 6.
        await poll(
          () => ariaStart() === 6,
          5_000,
          "default window start 6 seated at boot",
        );

        // --- 1. BOOT at 390×844 ------------------------------------------
        law("boot 390×844", true);

        // --- 2. BUTTON SHIFT: SEMI+ seats exactly ONE row -----------------
        const before = seat().scrollTop;
        btn("LEAD semitone view up").click();
        await poll(() => ariaStart() === 7, 5_000, "SEMI+ → start 7");
        expect(
          Math.abs(seat().scrollTop - before - pitch()),
          "SEMI+ moves the pane EXACTLY one row pitch",
        ).toBeLessThanOrEqual(1);
        law("after SEMI+ 390", false);

        // --- 3. THE PROBE-4 SWALLOW, RED→GREEN (start 7 — mid-manifest,
        //         so +20px is real drift, not a clamped no-op) --------------
        const seated0 = seat().scrollTop;
        seat().scrollTop = seated0 + 20; // the +20 unseated rest (probe 4)
        btn("LEAD semitone view up").click(); // SAME task — no settle ran
        await poll(
          () => ariaStart() === 8,
          5_000,
          "SEMI+ from an unseated rest still shifts the semantic window (+1, clamped at maxStart 8)",
        );
        expect(
          seat().scrollTop,
          "probe-4: SEMI+ from ANY rest seats the pane one row down (the OLD guard left the pixels at +20)",
        ).toBe(seated0 + pitch());
        law("after probe-4 SEMI+ 390", false);
        // The late settle (scrollend/fallback for the +20 write) must NOT
        // fight the new seat: after it fires, still on-grid at start 8.
        await new Promise((r) => setTimeout(r, 400));
        expect(ariaStart(), "the late settle kept the semantic seat").toBe(8);
        law("after the settle settles 390", false);

        // --- 4. SETTLED SCROLL: an off-grid rest SNAPS back on-grid ------
        // (start 8 = max scroll, so the drift goes UP: −0.45 pitch is a
        // real sub-row rest inside the scroll range.)
        {
          const p = pitch();
          const s = seat();
          const onGrid = s.scrollTop;
          s.scrollTop = onGrid - p * 0.45;
          expect(
            Math.abs(s.scrollTop - (onGrid - p * 0.45)) < 1,
            "the off-grid rest actually moved the seat (mid-gesture drift)",
          ).toBe(true);
          await poll(
            () => Math.abs(s.scrollTop - onGrid) <= 1,
            3_000,
            "an off-grid rest snaps back to the on-grid seat (scroll-end snap)",
          );
          law("after scroll-end snap 390", false);
        }

        // --- 5. A REAL trusted scroll gesture (CDP), then the snap --------
        // synthesizeScrollGesture drives the browser's own gesture pipeline
        // (the MB-2 law's scrolling half) at the seat's center, mapped
        // through the app iframe's box and the tester frame's scale.
        {
          const frame = window.frameElement as HTMLElement;
          const fr = frame.getBoundingClientRect();
          const ir = iframe.getBoundingClientRect();
          const er = seat().getBoundingClientRect();
          const sx = fr.width / innerWidth;
          const sy = fr.height / innerHeight;
          const point = {
            x: fr.left + (ir.left + er.left + er.width / 2) * sx,
            y: fr.top + (ir.top + er.top + er.height / 2) * sy,
          };
          const was = seat().scrollTop;
          await cdp().send("Input.synthesizeScrollGesture", {
            x: point.x,
            y: point.y,
            xDistance: 0,
            yDistance: -240,
            speed: 1200,
          });
          await poll(
            () => seat().scrollTop !== was,
            5_000,
            "trusted scroll gesture moved the seat",
          );
          // The seat rests SNAPPED: on-grid, law intact, aria adopted.
          await poll(
            () => seatOffset() <= 1 || Math.abs(seatOffset() - pitch()) <= 1,
            5_000,
            "trusted scroll rest snapped on-grid",
          );
          law("after trusted scroll 390", true);
        }

        // --- 6. RE-FIT to 360×800 (live resize — no remount) --------------
        iframe.style.width = "360px";
        iframe.style.height = "800px";
        await poll(
          () => win.innerWidth === 360,
          5_000,
          "iframe resized 360",
        );
        await new Promise((r) => setTimeout(r, 400)); // the fit's rAF passes
        law("boot 360×800", true);
        {
          const from = ariaStart();
          btn("LEAD octave view up").click();
          await poll(
            () => ariaStart() === Math.min(from + WINDOW, MAX_START),
            5_000,
            "OCT+ shifts one octave of the scale (±modeSize rows, clamped)",
          );
          law("after OCT+ 360", false);
        }

        // --- 7. RE-FIT to 430×932 -----------------------------------------
        iframe.style.width = "430px";
        iframe.style.height = "932px";
        await poll(
          () => win.innerWidth === 430,
          5_000,
          "iframe resized 430",
        );
        await new Promise((r) => setTimeout(r, 400));
        law("boot 430×932", true);
        {
          const from = ariaStart();
          btn("LEAD octave view down").click();
          await poll(
            () => ariaStart() === Math.max(0, from - WINDOW),
            5_000,
            "OCT− shifts one octave of the scale down (−modeSize rows)",
          );
          law("after OCT− 430", true);
        }

        // The unwindowed drums pane keeps the recess EXACTLY (the
        // full-manifest stretch survives the box clause).
        $<HTMLElement>('.lane-switch-tab[data-lane="drums"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          5_000,
          "drums stage",
        );
        expect(
          $(".lane-floor[data-lane='drums'] .lane-grid-scroll").classList.contains(
            "is-windowed",
          ),
          "drums stays a full-manifest pane (never windowed)",
        ).toBe(false);
      } finally {
        await teardown(iframe);
      }
    },
    300_000,
  );
});
