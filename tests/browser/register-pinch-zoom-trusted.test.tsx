/**
 * N-4 TRUSTED browser gate (iteration 7) — THE PINCH-ZOOM LAW
 * (midi-i7-audit §2.4) on the REAL BUILT APP (dist bundle in a sized iframe,
 * the register-window-snap harness law): trusted CDP two-pointer touch
 * streams against the shipped bundle —
 *
 *  1. PINCH IN to ~1.5× LIVE: the geometry re-fits through the renderer
 *     seams DURING the gesture (rows grow before any release — the pinch
 *     preview IS the geometry; NEVER a CSS transform).
 *  2. EXACTLY `modeSize` COMPLETE ROWS at every factor: the windowed pane's
 *     box re-pins to 7 ZOOMED row pitches, no partial 8th row, seat on the
 *     zoomed row grid, the window's semantic start unchanged (zoom is
 *     view-only).
 *  3. NOTES ANCHORED: the demo note's row label + run identity survive;
 *     the run's width = TRUE length × the ZOOMED step pitch.
 *  4. SEMI+ steps EXACTLY ONE ZOOMED pitch (the N-2 snap law at zoom).
 *  5. OVER-PINCH clamps at ×2 (the ceiling).
 *  6. THE TRAILING FIT never stomps the committed factor (the zoom-aware
 *     post-release re-fit — the N-1 verifier's regression).
 *  7. DOUBLE-TAP RESET (≤350 ms, ≤32 px) consumed pre-activation: the reset
 *     tap never removes the note under it; the exact ×1 fill returns.
 *  8. THE CHIP resets a fresh zoom (≥44px target).
 *  9. MB-2 SINGLE-POINTER byte-identical after a zoom session: a tap places
 *     and a touch drag-create commits at ×1.
 */

import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { modeSize } from "../../src/document/scales";

const WINDOW = modeSize("minor"); // 7 — the demo scale's mode size
const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

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

/** A deterministic first-run boot (PX-1 demo) in a sized iframe. */
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
  // 2026-09-11 merge: phone boot signal = the preset readout (the chain rail
  // lives on the SONG page now — the forked-helper convention).
  await poll(
    () =>
      // 2026-09-11: rail-free on every stage (the chain is its own page).
      $$(".head-ctl-value").some((v) =>
        (v.textContent ?? "").includes("SOFT STEP"),
      ),
    5_000,
    "demo chain tiles",
  );
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

describe("N-4 trusted pinch — built app, two-pointer CDP streams", () => {
  it(
    "390×844 lead: live pinch to ×1.5 then ×2 clamp; 7 complete rows at every factor; SEMI+ steps a zoomed pitch; trailing fit keeps the factor; double-tap + chip reset; tap/drag-create still work after",
    { timeout: 300_000 },
    async () => {
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
            r[1]!.getBoundingClientRect().top - r[0]!.getBoundingClientRect().top
          );
        };
        /** The row TRACK px (gridAutoRows) — the honest zoom factor basis:
         * the row's margin-bottom rhythm (4px) is a CONSTANT, so the pitch
         * ratio carries it unscaled; the track ratio is exactly the factor. */
        const track = (): number =>
          Number.parseFloat(
            getComputedStyle(
              $(".lane-floor[data-lane='lead'] .row-cells"),
            ).gridAutoRows,
          );
        const rowBase = (): number =>
          rows()[0]!.getBoundingClientRect().top -
          seat().getBoundingClientRect().top +
          seat().scrollTop;
        const seatOffset = (): number => {
          const p = pitch();
          return Math.abs((seat().scrollTop - rowBase()) % p);
        };
        /** The committed/live factor from the CHIP (the honest readout). */
        const chip = (): string =>
          (
            $(".lane-floor[data-lane='lead'] .register-zoom-factor")
              .textContent ?? ""
          ).trim();
        const factor = (): number => Number.parseFloat(chip().replace("×", ""));
        const ariaStart = (): number => {
          const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(
            $(".lane-floor[data-lane='lead'] .lane-grid").getAttribute(
              "aria-label",
            ) ?? "",
          );
          if (!m) throw new Error("grid aria carries no ROWS range");
          return Number(m[1]);
        };

        // The boot fit SETTLES before the baseline snapshot: the fill law
        // runs on boot rAF + font settle + observers, so an early read can
        // still sit at the 44 floor — the gate must compare against the
        // CONVERGED ×1 fill (dimension-stable across animation frames, the
        // MB-6 geometryQuiet law).
        const stablePitch = async (): Promise<number> => {
          await sleep(400); // the mount rAF + fonts.ready fits land (N-2 law)
          let last = -1;
          for (let i = 0; i < 24; i++) {
            const p = pitch();
            // The [44,64] clamp is the TRACK law; pitch = track + the 4px
            // row-margin rhythm (the N-4 measurement basis) → [48,68].
            if (p >= 48 && p <= 68 && p === last) return p;
            last = p;
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
          }
          throw new Error(`boot row fit never settled (last ${last})`);
        };
        const basePitch = await stablePitch();
        const baseTrack = track();
        const baseStart = ariaStart();
        expect(chip()).toBe("1.00×");

        /** THE LAW at any factor: exactly WINDOW complete rows, box ≈ pin,
         * seat on the (zoomed) row grid, chip parses. */
        const law = (state: string): void => {
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
            `${state}: exactly ${WINDOW} rows intersect the pane at factor ${chip()}`,
          ).toBe(WINDOW);
          expect(
            contained.length,
            `${state}: all ${WINDOW} visible rows are FULLY contained at factor ${chip()}`,
          ).toBe(WINDOW);
          const p = pitch();
          expect(
            Math.abs(box.height - p * WINDOW),
            `${state}: pane box === ${WINDOW} ZOOMED row pitches`,
          ).toBeLessThanOrEqual(2.5);
          const off = seatOffset();
          expect(
            off <= 1 || Math.abs(off - p) <= 1,
            `${state}: seat on the zoomed row grid`,
          ).toBe(true);
          expect(Number.isFinite(factor())).toBe(true);
        };
        law("boot ×1");

        // The zoom chip target law: ≥44 both axes, its corners hit itself.
        {
          const el = $(".lane-floor[data-lane='lead'] .register-zoom-chip");
          const r = el.getBoundingClientRect();
          expect(r.height).toBeGreaterThanOrEqual(44);
          expect(r.width).toBeGreaterThanOrEqual(44);
          for (const [dx, dy] of [
            [4, 4],
            [r.width - 4, 4],
            [4, r.height - 4],
            [r.width - 4, r.height - 4],
          ]) {
            const hit = idoc().elementFromPoint(r.left + dx, r.top + dy);
            expect(
              hit && el.contains(hit),
              `chip corner hit resolves to the chip (${dx},${dy})`,
            ).toBe(true);
          }
        }

        // --- trusted CDP touch, mapped through BOTH iframe boxes ----------
        const c = cdp();
        await c.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 5,
        });
        const map = (ix: number, iy: number) => {
          const fr = (window.frameElement as HTMLElement).getBoundingClientRect();
          const ir = iframe.getBoundingClientRect();
          const sx = fr.width / innerWidth;
          const sy = fr.height / innerHeight;
          return {
            x: fr.left + (ir.left + ix) * sx,
            y: fr.top + (ir.top + iy) * sy,
          };
        };
        /** One two-finger pinch from spread half-widths a→b around the
         * pane's center (fingers move on X — pan-y reserves the horizontal
         * axis for the app, so the browser never scrolls mid-pinch). */
        const pinch = async (
          halfA: number,
          halfB: number,
          steps = 5,
          holdMs = 40,
        ): Promise<void> => {
          const r = seat().getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const p = (half: number) => [
            map(cx - half, cy),
            map(cx + half, cy),
          ];
          const [f1a, f2a] = p(halfA);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { x: f1a.x, y: f1a.y, id: 1 },
              { x: f2a.x, y: f2a.y, id: 2 },
            ],
          });
          for (let i = 1; i <= steps; i++) {
            await sleep(holdMs);
            const half = halfA + ((halfB - halfA) * i) / steps;
            const [f1, f2] = p(half);
            await c.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [
                { x: f1.x, y: f1.y, id: 1 },
                { x: f2.x, y: f2.y, id: 2 },
              ],
            });
            if (i === Math.ceil(steps / 2)) {
              // LIVE: geometry grows BEFORE any release (the pinch preview
              // IS the geometry — the held-pointer deferral does not stop
              // the pinch's own sanctioned seam writes). Poll: the apply is
              // rAF-coalesced off the move dispatch.
              await poll(
                () => pitch() > basePitch * 1.05,
                2_000,
                "live re-fit mid-pinch: rows grew before release",
              );
            }
          }
          await sleep(holdMs);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await sleep(150);
        };
        /** One raw touch tap at an element's center (activation rides
         * pointerup — no click synthesis needed for cell gestures). */
        const touchTap = async (el: Element, dx = 0): Promise<void> => {
          const r = el.getBoundingClientRect();
          const p = map(r.left + r.width / 2 + dx, r.top + r.height / 2);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: p.x, y: p.y, id: 1 }],
          });
          await sleep(30);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await sleep(60);
        };
        const noteCount = (): number =>
          $$(".lane-floor[data-lane='lead'] .note-run").length;

        // An anchor note from the demo: record identity before zooming.
        const firstRun = (): HTMLElement => {
          const el = $(".lane-floor[data-lane='lead'] .note-run");
          return el;
        };
        const run0 = firstRun();
        const run0Row = Number(
          (run0.querySelector(".note-edge") as HTMLElement).dataset.row,
        );
        const run0Start = Number(run0.dataset.start);
        const run0Len = Number(run0.dataset.length);
        const labelAt = (row: number): string =>
          rows()[row]!.querySelector(".row-label")!.textContent ?? "";
        const run0Label = labelAt(run0Row);
        const stepPitch = (): number => {
          const r0 = rows()[0]!
            .querySelectorAll(".cell")[0]!
            .getBoundingClientRect();
          const r1 = rows()[0]!
            .querySelectorAll(".cell")[1]!
            .getBoundingClientRect();
          return r1.left - r0.left;
        };
        const notes0 = noteCount();

        // --- 1. PINCH IN to ×1.5 (half-width 40 → 60 = ratio 1.5) ---------
        await pinch(40, 60);
        await poll(
          () => Math.abs(factor() - 1.5) < 0.02,
          5_000,
          "pinch commits ×1.5 (chip)",
        );
        expect(
          Math.abs(track() / baseTrack - 1.5),
          "row track = fill track × 1.5 (seam-refit, not a transform)",
        ).toBeLessThan(0.02);
        law("pinched ×1.5");

        // Notes anchored: same row label, same span, honest zoomed width.
        {
          const run = $$(".lane-floor[data-lane='lead'] .note-run").find(
            (r) =>
              Number((r.querySelector(".note-edge") as HTMLElement).dataset.row) ===
                run0Row && Number(r.dataset.start) === run0Start,
          );
          expect(run, "the demo note's run still exists (row + start)").toBeTruthy();
          expect(labelAt(run0Row)).toBe(run0Label);
          expect(
            Math.abs(
              run!.getBoundingClientRect().width -
                (run0Len * stepPitch() - 1),
            ),
            "run width = true length × ZOOMED step pitch − gap",
          ).toBeLessThan(1.5);
          expect(noteCount()).toBe(notes0);
          expect(ariaStart()).toBe(baseStart); // zoom is view-only: same seat
        }

        // --- 2. SEMI+ at ×1.5 steps EXACTLY one ZOOMED pitch --------------
        {
          const before = seat().scrollTop;
          const btn = $$(".register-shift-btn").find(
            (b) => b.getAttribute("aria-label") === "LEAD semitone view up",
          ) as HTMLButtonElement;
          btn.click();
          await poll(
            () => ariaStart() === baseStart + 1,
            5_000,
            "SEMI+ at ×1.5 shifts the semantic window +1",
          );
          expect(
            Math.abs(seat().scrollTop - before - pitch()),
            "SEMI+ moves the pane EXACTLY one ZOOMED row pitch",
          ).toBeLessThanOrEqual(1.5);
          law("after SEMI+ ×1.5");
        }

        // --- 3. OVER-PINCH clamps at ×2 (ratio 2.2 × 1.5 = 3.3 → 2) -------
        await pinch(40, 40 * 2.2);
        await poll(() => chip() === "2.00×", 5_000, "over-pinch clamps at ×2");
        expect(track()).toBeLessThanOrEqual(baseTrack * 2 * 1.02);
        law("clamped ×2");

        // --- 4. TRAILING FIT: the committed ×2 survives release + rAFs ----
        await sleep(650); // the release-hook rAF + observer fits all landed
        expect(
          chip(),
          "the zoom-aware trailing fit re-derives AT the committed factor (never stomps back to ×1)",
        ).toBe("2.00×");
        expect(Math.abs(track() / baseTrack - 2)).toBeLessThan(0.02);
        law("after the trailing fit ×2");

        // --- 5. DOUBLE-TAP RESET: consumed pre-activation -----------------
        {
          // An EMPTY visible cell (no [data-on]) for the tap pair.
          const visibleRow = rows()[ariaStart()]!;
          const empty = visibleRow.querySelector<HTMLElement>(
            ".cell[data-on='false']",
          );
          expect(empty, "an empty cell for the double-tap pair").toBeTruthy();
          const before = noteCount();
          await touchTap(empty); // tap 1: places (byte-identical law)
          await touchTap(empty, 6); // tap 2: ≤350ms later, ≤32px away → RESET
          await poll(
            () => chip() === "1.00×",
            4_000,
            "the double-tap resets to ×1",
          );
          expect(
            noteCount(),
            "tap 1 placed (+1) and the reset tap was consumed pre-activation (no remove under it)",
          ).toBe(before + 1);
          expect(
            Math.abs(track() / baseTrack - 1),
            "reset restores the exact ×1 fill geometry",
          ).toBeLessThan(0.02);
          law("after double-tap reset ×1");
        }

        // --- 6. THE CHIP resets a fresh zoom --------------------------------
        await pinch(40, 52); // ×1.3
        await poll(
          () => Math.abs(factor() - 1.3) < 0.02,
          5_000,
          "pinch to ×1.3",
        );
        (
          $(".lane-floor[data-lane='lead'] .register-zoom-chip") as HTMLElement
        ).click();
        await poll(
          () => chip() === "1.00×",
          4_000,
          "the chip click resets to ×1",
        );
        law("after chip reset ×1");

        // --- 7. MB-2 SINGLE-POINTER after a zoom session --------------------
        {
          const visibleRow = rows()[ariaStart()]!;
          const empty2 =
            visibleRow.querySelector<HTMLElement>(
              ".cell[data-step='8'][data-on='false']",
            ) ??
            visibleRow.querySelector<HTMLElement>(".cell[data-on='false']");
          expect(empty2).toBeTruthy();
          const before = noteCount();
          await touchTap(empty2);
          await poll(
            () => noteCount() === before + 1,
            4_000,
            "a single tap still places a note after a zoom session",
          );
          // Drag-create by touch: down → two moves right → up.
          const r = empty2!.getBoundingClientRect();
          const sp = stepPitch();
          const p0 = map(r.left + r.width / 2, r.top + r.height / 2);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: p0.x, y: p0.y, id: 1 }],
          });
          for (const dx of [sp * 1.6, sp * 2.6]) {
            await sleep(40);
            const p = map(r.left + r.width / 2 + dx, r.top + r.height / 2);
            await c.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: p.x, y: p.y, id: 1 }],
            });
          }
          await sleep(40);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await poll(
            () => noteCount() === before + 2,
            4_000,
            "touch drag-create still commits a longer note (MB-2 byte-identical)",
          );
          law("after MB-2 taps/drags ×1");
        }

        // The page may scroll more at zoom (the audit's own clause) — the
        // card still owns the document bottom at scroll end.
        win.scrollTo(0, win.scrollY + 10_000);
        const docH = idoc().documentElement.scrollHeight;
        const floorBottom =
          $(".lane-floor").getBoundingClientRect().bottom + win.scrollY;
        expect(docH - floorBottom).toBeLessThanOrEqual(1);
      } finally {
        await teardown(iframe);
      }
    },
    300_000,
  );
});
