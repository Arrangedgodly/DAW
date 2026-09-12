/**
 * N-3 browser gate (iteration 7) — THE PITCH-ANCHORED NOTES LAW on the REAL
 * BUILT APP (the m5 harness law: iframe + dist bundle, first-run wiped
 * origin), per docs/dev/midi-i7-audit.md §2.3 and §5.2:
 *
 * A note's identity is its DEGREE (`pattern.rowDegrees`; the mounted grid's
 * row N is manifest degree N for as long as the surface lives). Its pixels
 * ride its row (`.note-run` is absolute inside its row's `.row-cells`) — so
 * EVERY register-window path must leave each run on its own row, in-view
 * iff its row is, with the readout, the grid aria range, and the pixels
 * always agreeing. Driven paths:
 *
 *  1. SEMI ±1 / OCT ±modeSize buttons, both window CLAMPS (top and bottom —
 *     the tracked runs go out of and back into view across them).
 *  2. THE D# SCENARIO: a run placed on the D#′ row, shifted until its row
 *     is OFF-WINDOW, shifted back — same note, same row, BYTE-IDENTICAL
 *     placement (dx/dy/width within its row, unchanged label).
 *  3. A TRUSTED CDP scroll gesture (the browser's own pipeline) up past the
 *     runs and back — the settle snap re-seats; anchoring survives — plus
 *     a REAL wheel tick down/back (N-6: audit §5.2 names the wheel among
 *     the shift paths; the wheel rest goes through the same settle snap).
 *  4. ARROW-WALK focus-follow: keyboard cells walk the manifest; the window
 *     follows the roving cursor; the runs stay on their rows.
 *  5. LANE SWITCH away/back (setEditable re-anchor + surface remount) and
 *  6. PATTERN SWITCH away/back (fresh projection through the manifest) —
 *     byte-identical placement on return.
 *  7. SCALE-MODE CHANGE — the i7 N-3 residual, RED→GREEN: a same-size mode
 *     edit (minor→major) re-names every degree through the LIVE scale (the
 *     engine re-pitches via degreeToMidi the same moment) — the row labels
 *     re-derive IN PLACE (setRowLabels), the notes' degrees/rows/pixels
 *     never move, only the names under them do. A SIZE change (→
 *     pentatonicMinor, modeSize 5) additionally re-pins the window height.
 *     Restore → the boot labels return byte-identically.
 *  8. LIVE RE-FITS to 360×800 and 430×932 — anchoring holds across the
 *     phone width/row fit re-runs (no remount).
 *
 * TEETH (journaled): reverting the label re-map (setRowLabels wiring off →
 * stale labels after a scale edit) and pinning runs to the viewport
 * (.note-run position:fixed → runs detach from their rows on scroll) each
 * turn this gate RED; restoring goes green.
 */

import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { MODE_INTERVALS, modeSize } from "../../src/document/scales";

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

const PE_ID = 41;
function pe(el: Element, type: string, x: number, y: number): boolean {
  return el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: PE_ID,
      pointerType: "mouse",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }),
  );
}
function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The demo's pitched label math (`pitchedLabels` verbatim law) — the gate's
 * EXPECTED names, so a stale-label renderer has nowhere to hide. */
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function expectedLabels(
  root: number,
  mode: keyof typeof MODE_INTERVALS,
  count: number,
): string[] {
  const intervals = MODE_INTERVALS[mode];
  const size = intervals.length;
  return Array.from({ length: count }, (_, degree) => {
    const pc = (root + intervals[degree % size]) % 12;
    const octave = Math.floor(degree / size);
    return PC_NAMES[pc]! + (octave > 0 ? "′" : "");
  });
}

describe("N-3 pitch-anchored notes — every shift path keeps each run on its row", () => {
  it(
    "runs ride rows through SEMI/OCT/scroll/arrows/lane/pattern/scale/re-fit; D# off-window and back is byte-identical; labels re-derive on scale edits",
    { timeout: 300_000 },
    async () => {
      // The demo project: C minor (root 0), lead manifest = 15 rows (degrees
      // 0..14), default window start 6 (ROWS 6–12), modeSize 7.
      const ROOT = 0;
      const MANIFEST = 15;
      const W = modeSize("minor");
      const MAX_START = MANIFEST - W; // 8
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
        const labelOf = (row: number): string =>
          rows()[row]!.querySelector(".row-label")!.textContent ?? "";
        const runIn = (row: number): HTMLElement | null =>
          rows()[row]!.querySelector<HTMLElement>(".note-run") ?? null;
        const ariaRange = (): string => {
          const m = $(".lane-floor[data-lane='lead'] .lane-grid").getAttribute(
            "aria-label",
          );
          const r = /ROWS \d+–\d+ OF \d+/.exec(m ?? "");
          if (!r) throw new Error(`grid aria carries no ROWS range: ${m}`);
          return r[0]!;
        };
        const ariaStart = (): number => {
          const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(ariaRange())!;
          return Number(m[1]);
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
          return r[0]!;
        };
        const btn = (label: string): HTMLButtonElement => {
          const el = $$(".lane-floor[data-lane='lead'] .register-shift-btn").find(
            (b) => b.getAttribute("aria-label") === label,
          );
          if (!el) throw new Error(`missing shift button ${label}`);
          return el as HTMLButtonElement;
        };
        const cellAt = (row: number, step: number): HTMLElement => {
          const c = $(
            `.lane-floor[data-lane='lead'] .cell[data-row="${row}"][data-step="${step}"]`,
          );
          return c as HTMLElement;
        };

        /** One run's placement inside its row — the BYTE-IDENTICAL metric.
         * `cell` carries the live cell pitch so a LEGITIMATE width re-fit
         * (the phone H-2 law re-fitting cells to the measured well) rebases
         * the baseline instead of masquerading as an anchor break: the run
         * must re-map CORRECTLY to the new geometry (containment + in-view
         * laws below), and byte-identity resumes within it. */
        type Snap = { label: string; dx: number; dy: number; w: number; h: number; cell: number };
        const cellPx = (): number => {
          const m = /repeat\(\d+,\s*([\d.]+)px\)/.exec(
            (rows()[9]!.querySelector(".row-cells") as HTMLElement).style
              .gridTemplateColumns,
          );
          return m ? Number.parseFloat(m[1]!) : 0;
        };
        const snapOf = (row: number): Snap => {
          const run = runIn(row);
          if (!run) throw new Error(`no run at row ${row}`);
          const rect = run.getBoundingClientRect();
          const cr = rows()[row]!.getBoundingClientRect();
          return {
            label: labelOf(row),
            dx: rect.left - cr.left,
            dy: rect.top - cr.top,
            w: rect.width,
            h: rect.height,
            cell: cellPx(),
          };
        };
        const rowInView = (row: number): boolean => {
          const box = seat().getBoundingClientRect();
          const r = rows()[row]!.getBoundingClientRect();
          return r.top < box.bottom - 0.5 && r.bottom > box.top + 0.5;
        };

        /** THE ANCHOR LAW (audit §2.3): every tracked run sits INSIDE its
         * row (pixels ride it — containment is geometry-independent, the
         * dx/dy/w baseline is per-viewport and rebased on re-fits), its
         * label is the live scale's name for its degree, it is in-view IFF
         * its row is, and the readout === grid aria range. */
        const anchor = (
          state: string,
          tracked: Array<{ row: number; base: Snap; note: string }>,
          scale: { root: number; mode: keyof typeof MODE_INTERVALS },
        ): void => {
          const names = expectedLabels(scale.root, scale.mode, MANIFEST);
          for (const t of tracked) {
            if (snapOf(t.row).cell !== t.base.cell) {
              // A legitimate width re-fit (H-2): re-map, then rebase.
              t.base = snapOf(t.row);
            }
            const run = runIn(t.row)!;
            const row = rows()[t.row]!;
            const rr = run.getBoundingClientRect();
            const cr = row.getBoundingClientRect();
            expect(
              rr.top >= cr.top - 0.6 &&
                rr.bottom <= cr.bottom + 0.6 &&
                rr.left >= cr.left - 0.6,
              `${state}: the ${t.note} run's pixels ride its row (contained in it)`,
            ).toBe(true);
            expect(
              Math.abs(snapOf(t.row).dx - t.base.dx),
              `${state}: the ${t.note} run keeps its horizontal placement inside its row`,
            ).toBeLessThanOrEqual(0.6);
            expect(
              Math.abs(snapOf(t.row).dy - t.base.dy),
              `${state}: the ${t.note} run keeps its vertical placement inside its row`,
            ).toBeLessThanOrEqual(0.6);
            expect(
              Math.abs(snapOf(t.row).w - t.base.w),
              `${state}: the ${t.note} run keeps its width`,
            ).toBeLessThanOrEqual(0.6);
            expect(
              snapOf(t.row).label,
              `${state}: the ${t.note} run's row-label identity (degree ${t.row} of the ${scale.mode} manifest — labels re-derive with the live scale)`,
            ).toBe(names[t.row]!);
            const box = seat().getBoundingClientRect();
            const runVis = rr.top < box.bottom && rr.bottom > box.top;
            expect(
              runVis,
              `${state}: the ${t.note} run is in-view IFF its row is (row in-view: ${rowInView(t.row)})`,
            ).toBe(rowInView(t.row));
          }
          expect(
            readoutRange(),
            `${state}: readout chip === grid aria range (one source of truth)`,
          ).toBe(ariaRange());
        };

        await poll(
          () => ariaStart() === 6,
          5_000,
          "default window start 6 seated at boot",
        );

        // --- PLACE: a 2-step drag-created run on the D#′ row (row 9) and a
        //     single-click note one octave down (row 7) ---------------------
        const a = cellAt(9, 2);
        const b = cellAt(9, 3);
        const pa = center(a);
        const pb = center(b);
        pe(a, "pointerdown", pa.x, pa.y);
        pe(b, "pointermove", pb.x, pb.y);
        pe(b, "pointerup", pb.x, pb.y);
        cellAt(7, 6).click();
        await poll(() => !!runIn(9) && !!runIn(7), 3_000, "placed runs");
        const run9 = { row: 9, base: snapOf(9), note: "D#′ drag-run" };
        const run7 = { row: 7, base: snapOf(7), note: "row-7 click-note" };
        expect(run9.base.label, "row 9 is D#′ on the demo's C minor").toBe("D#′");
        anchor("placed", [run9, run7], { root: ROOT, mode: "minor" });

        // --- 1. BUTTONS: SEMI ±1, OCT ±modeSize, both clamps ---------------
        btn("LEAD semitone view up").click();
        await poll(() => ariaStart() === 7, 5_000, "SEMI+ → 7");
        anchor("SEMI+", [run9, run7], { root: ROOT, mode: "minor" });
        btn("LEAD octave view up").click();
        await poll(() => ariaStart() === MAX_START, 5_000, "OCT+ clamps at 8");
        anchor("OCT+ top clamp", [run9, run7], { root: ROOT, mode: "minor" });
        expect(
          rowInView(7),
          "top clamp: the row-7 note's row is OFF-window (start 8)",
        ).toBe(false);
        btn("LEAD semitone view down").click();
        await poll(() => ariaStart() === MAX_START - 1, 5_000, "SEMI− at top");
        anchor("SEMI− near top", [run9, run7], { root: ROOT, mode: "minor" });
        btn("LEAD octave view down").click();
        await poll(() => ariaStart() === MAX_START - 1 - W, 5_000, "OCT−");
        anchor("OCT−", [run9, run7], { root: ROOT, mode: "minor" });

        // --- 2. THE D# SCENARIO: off-window (bottom clamp) and back --------
        btn("LEAD octave view down").click();
        await poll(() => ariaStart() === 0, 5_000, "bottom clamp at 0");
        anchor("bottom clamp", [run9, run7], { root: ROOT, mode: "minor" });
        expect(
          rowInView(9),
          "bottom clamp: the D#′ row is OFF-window (start 0)",
        ).toBe(false);
        btn("LEAD octave view up").click();
        await poll(() => ariaStart() === W, 5_000, "OCT+ back to 7");
        anchor("D# back in view", [run9, run7], { root: ROOT, mode: "minor" });
        const dsharp = snapOf(9);
        expect(
          dsharp.label,
          "the D# run: same note after the off-window round-trip",
        ).toBe("D#′");
        expect(
          Math.abs(dsharp.dx - run9.base.dx) +
            Math.abs(dsharp.dy - run9.base.dy) +
            Math.abs(dsharp.w - run9.base.w),
          "the D# run: BYTE-IDENTICAL placement after the off-window round-trip",
        ).toBeLessThanOrEqual(0.6);

        // --- 3. TRUSTED CDP scroll: up past the runs, then back -----------
        const scrollBy = async (dy: number): Promise<void> => {
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
          await cdp().send("Input.synthesizeScrollGesture", {
            x: point.x,
            y: point.y,
            xDistance: 0,
            yDistance: dy,
            speed: 1200,
          });
          // The settle fallback snaps within 120 ms; give it room.
          await new Promise((r) => setTimeout(r, 500));
        };
        await scrollBy(240); // content up = window down the manifest
        anchor("trusted scroll down", [run9, run7], {
          root: ROOT,
          mode: "minor",
        });
        await scrollBy(-480); // back up past the runs
        anchor("trusted scroll up", [run9, run7], { root: ROOT, mode: "minor" });

        // --- 3b. THE WHEEL (N-6, audit §5.2): a real mouse-wheel tick
        //         through the browser's own wheel pipeline — the off-grid
        //         rest settles, the runs stay on their rows ---------------
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
          // The trusted scrolls left the seat clamped at the BOTTOM
          // (scrollTop max) — wheel UP first (unclamped), then back down.
          await cdp().send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: point.x,
            y: point.y,
            deltaX: 0,
            deltaY: -240,
          });
          await poll(
            () => seat().scrollTop !== was,
            5_000,
            "wheel tick moved the seat",
          );
          // The settle fallback snaps within 120 ms; give it room.
          await new Promise((r) => setTimeout(r, 500));
          anchor("wheel up", [run9, run7], { root: ROOT, mode: "minor" });
          const wasUp = seat().scrollTop;
          await cdp().send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: point.x,
            y: point.y,
            deltaX: 0,
            deltaY: 480,
          });
          await poll(
            () => seat().scrollTop !== wasUp,
            5_000,
            "wheel tick back moved the seat",
          );
          await new Promise((r) => setTimeout(r, 500));
          anchor("wheel down", [run9, run7], { root: ROOT, mode: "minor" });
        }

        // --- 4. ARROW-WALK focus-follow: the window follows the roving
        //     cursor; the runs stay on their rows ---------------------------
        {
          const cell = cellAt(14, 4); // the manifest's last row
          cell.focus();
          for (let i = 0; i < 3; i++)
            cell.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "ArrowDown",
                bubbles: true,
                cancelable: true,
              }),
            );
          await poll(
            () => ariaStart() >= MAX_START - 1,
            5_000,
            "arrow-walk focus-follow seats the window at the bottom",
          );
          anchor("arrow-walk down", [run9, run7], { root: ROOT, mode: "minor" });
          const cellTop = cellAt(0, 4);
          cellTop.focus();
          for (let i = 0; i < 3; i++)
            cellTop.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "ArrowUp",
                bubbles: true,
                cancelable: true,
              }),
            );
          await poll(
            () => ariaStart() <= 1,
            5_000,
            "arrow-walk back up seats the window at the top",
          );
          anchor("arrow-walk up", [run9, run7], { root: ROOT, mode: "minor" });
        }

        // --- 5. LANE SWITCH away/back (editable flips + remount) -----------
        $<HTMLElement>('.lane-switch-tab[data-lane="drums"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          5_000,
          "drums stage",
        );
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          5_000,
          "lead back",
        );
        await poll(() => !!runIn(9) && !!runIn(7), 5_000, "runs re-projected");
        anchor("lane away/back", [run9, run7], { root: ROOT, mode: "minor" });
        const afterLane = snapOf(9);
        expect(
          Math.abs(afterLane.dx - run9.base.dx) +
            Math.abs(afterLane.dy - run9.base.dy) +
            Math.abs(afterLane.w - run9.base.w),
          "byte-identical placement across the lane round-trip",
        ).toBeLessThanOrEqual(0.6);

        // --- 6. PATTERN SWITCH away/back (fresh projection) ----------------
        // The chain tiles live on the phone SONG page (the 2026-09-11
        // split) — hop there for the switch, back to EDIT for the asserts.
        {
          const pageToggle = () =>
            $(".phone-page-toggle") as unknown as HTMLButtonElement;
          pageToggle().click(); // to SONG
          await poll(
            () => $$(".rail-tile").length >= 2,
            5_000,
            "SONG page chain tiles",
          );
          const tiles = () => $$(".rail-tile");
          (tiles()[1] as HTMLButtonElement).click(); // lead-2: pattern B
          await new Promise((r) => setTimeout(r, 500)); // remount + projection
          (tiles()[0] as HTMLButtonElement).click(); // back to lead-1
          pageToggle().click(); // to EDIT
          await poll(
            () => !!runIn(9) && !!runIn(7),
            5_000,
            "lead-1 back: the placed runs re-project",
          );
          anchor("pattern away/back", [run9, run7], { root: ROOT, mode: "minor" });
          const afterPat = snapOf(9);
          expect(
            Math.abs(afterPat.dx - run9.base.dx) +
              Math.abs(afterPat.dy - run9.base.dy) +
              Math.abs(afterPat.w - run9.base.w),
            "byte-identical placement across the pattern round-trip",
          ).toBeLessThanOrEqual(0.6);
        }

        // --- 7. SCALE-MODE CHANGE — the i7 N-3 residual, RED→GREEN --------
        const applyScale = async (
          mode: keyof typeof MODE_INTERVALS,
        ): Promise<void> => {
          $<HTMLElement>(".lane-floor[data-lane='lead'] .scale-chip").click();
          const pop = await (async () => {
            for (let i = 0; i < 30; i++) {
              const p = idoc().querySelector<HTMLElement>(".scale-pop");
              if (p) return p;
              await new Promise((r) => setTimeout(r, 100));
            }
            throw new Error("scale popover never opened");
          })();
          pop.querySelector<HTMLElement>(`[data-mode="${mode}"]`)!.click();
          pop.querySelector<HTMLElement>(".scale-pop-commit")!.click();
          await new Promise((r) => setTimeout(r, 300));
        };
        // 7a. SAME-SIZE (minor → major): names move, degrees/rows/pixels
        //     do not; the window height stays 7.
        await applyScale("major");
        await poll(
          () => labelOf(2) === "E",
          5_000,
          "major re-names degree 2 D#→E (labels re-derive with the live scale)",
        );
        anchor("scale minor→major", [run9, run7], { root: ROOT, mode: "major" });
        const afterMajor = snapOf(9);
        expect(afterMajor.label, "the D#-degree run now names E (degree 9 of C major = E′)").toBe("E′");
        expect(
          Math.abs(afterMajor.dx - run9.base.dx) +
            Math.abs(afterMajor.dy - run9.base.dy) +
            Math.abs(afterMajor.w - run9.base.w),
          "a scale edit moves ONLY the names — placement is byte-identical",
        ).toBeLessThanOrEqual(0.6);
        // 7b. SIZE CHANGE (major → pentatonicMinor): the window re-pins to
        //     modeSize 5; labels re-derive per the 5-degree manifest math.
        await applyScale("pentatonicMinor");
        await poll(
          () => labelOf(2) === "F",
          5_000,
          "pentatonic re-names degree 2 (interval 5 = F)",
        );
        {
          const box = seat().getBoundingClientRect();
          const boxes = rows().map((r) => r.getBoundingClientRect());
          const intersecting = boxes.filter(
            (r) => r.top < box.bottom - 0.5 && r.bottom > box.top + 0.5,
          );
          expect(
            intersecting.length,
            "pentatonic: the window re-pins to exactly modeSize (5) rows",
          ).toBe(modeSize("pentatonicMinor"));
        }
        anchor("scale →pentatonic", [run9, run7], {
          root: ROOT,
          mode: "pentatonicMinor",
        });
        // 7c. RESTORE (→ minor): the boot labels return byte-identically.
        await applyScale("minor");
        await poll(
          () => labelOf(9) === "D#′",
          5_000,
          "minor restores the boot labels",
        );
        anchor("scale restored", [run9, run7], { root: ROOT, mode: "minor" });
        const restored = snapOf(9);
        expect(
          Math.abs(restored.dx - run9.base.dx) +
            Math.abs(restored.dy - run9.base.dy) +
            Math.abs(restored.w - run9.base.w),
          "the scale round-trip never moved a pixel",
        ).toBeLessThanOrEqual(0.6);

        // --- 8. LIVE RE-FITS: 360×800 then 430×932 (no remount) -----------
        // Geometry legitimately re-fits across viewports (the phone width
        // law) — the BYTE-IDENTICAL baseline is per-viewport: rebase after
        // each fit settles, then anchor against the fresh geometry.
        iframe.style.width = "360px";
        iframe.style.height = "800px";
        await poll(() => win.innerWidth === 360, 5_000, "resized 360");
        await new Promise((r) => setTimeout(r, 400)); // the fit's rAF passes
        run9.base = snapOf(9);
        run7.base = snapOf(7);
        anchor("re-fit 360×800", [run9, run7], { root: ROOT, mode: "minor" });
        iframe.style.width = "430px";
        iframe.style.height = "932px";
        await poll(() => win.innerWidth === 430, 5_000, "resized 430");
        await new Promise((r) => setTimeout(r, 400));
        run9.base = snapOf(9);
        run7.base = snapOf(7);
        anchor("re-fit 430×932", [run9, run7], { root: ROOT, mode: "minor" });
      } finally {
        await teardown(iframe);
      }
    },
    300_000,
  );
});
