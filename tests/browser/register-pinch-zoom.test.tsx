/**
 * N-4 browser gate (iteration 7) — THE PINCH-ZOOM LAW (midi-i7-audit §2.4)
 * on the phone MIDI grid: the GESTURE STATE MACHINE (source-mounted,
 * synthetic touch pointers — the pointer-edge-states `te()` law; the trusted
 * CDP half against the built app lives in register-pinch-zoom-trusted) —
 *   1. COEXISTENCE, stray-finger class (MB-4 T5): a second finger that never
 *      moves the factor (no distance change) is IGNORED — the FIRST finger's
 *      editing gesture completes; the second contributes nothing.
 *   2. COEXISTENCE, clamp-noop class (MB-4 T3): a two-pointer stream whose
 *      ratio would pinch OUT at ×1 (a clamp no-op) never TAKES OVER — the
 *      first finger's create-drag still commits.
 *   3. TAKEOVER: a ratio that moves the factor (>×1) takes the surface —
 *      the armed create gesture cancels (no note), the geometry re-fits
 *      LIVE through the seams (row pitch × factor; NEVER a CSS transform).
 *   4. CLAMP [1,2] × the fill geometry — ×2 the ceiling, committed.
 *   5. TRAILING FIT: the factor survives the post-release re-fit (the
 *      zoom-aware fit — the N-1 verifier's regression).
 *   6. DOUBLE-TAP RESET (≤350 ms, ≤32 px): consumed PRE-ACTIVATION while a
 *      zoom is committed (the second tap resets and never removes the note
 *      under it); at ×1 the same double-tap nets place+remove = zero — the
 *      MB-2 single-pointer law byte-identical.
 *   7. THE CHIP: shows the factor, is a ≥44px reset target, clicking resets.
 *
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { modeSize } from "../../src/document/scales";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";

const WINDOW = modeSize("minor"); // 7 — the demo scale's mode size

// ---------------------------------------------------------------------------
// Shared small helpers
// ---------------------------------------------------------------------------

async function waitFor(
  predicate: () => boolean,
  ms = 4000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ===========================================================================
// HALF 1 — the gesture state machine (source-mounted, phone stage)
// ===========================================================================

/** One touch-typed pointer event (the pointer-edge-states `te` law). */
function te(
  el: Element,
  type: string,
  x: number,
  y: number,
  pointerId = 7,
  isPrimary = true,
): boolean {
  return el.dispatchEvent(
    new PointerEvent(type, {
      pointerId,
      pointerType: "touch",
      isPrimary,
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

function cellAt(lane: string, row: number, step: number): HTMLElement {
  const cell = document.querySelector(
    `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
  );
  if (!cell) throw new Error(`missing ${lane} cell ${row}:${step}`);
  return cell as HTMLElement;
}

function seatEl(lane: string): HTMLElement {
  const el = document.querySelector(
    `.lane-floor[data-lane="${lane}"] .lane-grid-scroll`,
  );
  if (!el) throw new Error(`missing ${lane} grid pane`);
  return el as HTMLElement;
}

function rowsOf(lane: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `.lane-floor[data-lane="${lane}"] .grid-row`,
    ),
  );
}

/** Row pitch from the live DOM (the renderer's own rowPitch law). */
function rowPitch(lane: string): number {
  const r = rowsOf(lane);
  return r[1]!.getBoundingClientRect().top - r[0]!.getBoundingClientRect().top;
}

/** The grid aria's visible start row (0-based). */
function ariaStart(lane: string): number {
  const m = /ROWS (\d+)–\d+ OF \d+/.exec(
    document
      .querySelector(`.lane-floor[data-lane="${lane}"] [role="grid"]`)
      ?.getAttribute("aria-label") ?? "",
  );
  if (!m) throw new Error(`no ROWS range in ${lane} grid aria`);
  return Number(m[1]);
}

function chipText(lane: string): string {
  const el = document.querySelector(
    `.lane-floor[data-lane="${lane}"] .register-zoom-factor`,
  );
  return (el?.textContent ?? "").trim();
}

function bassNotes() {
  const p = docStore.getState().doc.patterns.bass[0];
  if (p?.kind !== "pitched") throw new Error("expected pitched bass pattern");
  return p.notes;
}

describe("N-4 pinch-zoom state machine (phone stage)", () => {
  it(
    "takeover law, clamp, double-tap reset, chip reset",
    { timeout: 120_000 },
    async () => {
      await page.viewport(390, 844);
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "phone",
          5000,
          "phone stage",
        );
        selectLane("bass");
        await waitFor(
          () =>
            document.querySelector(".lane-floor")?.dataset.lane === "bass",
          3000,
          "bass stage",
        );
        expect(bassNotes()).toHaveLength(0);
        // The boot fit lands (row pitch settles to the fill target).
        await waitFor(
          () => rowPitch("bass") >= 44 && rowPitch("bass") <= 64,
          5000,
          "boot row fit [44,64]",
        );
        const basePitch = rowPitch("bass");
        expect(chipText("bass")).toBe("1.00×");

        // A visible row to work in (cells of off-window rows still exist —
        // but the gesture surface is honest everywhere; use the window).
        const row0 = ariaStart("bass");

        // -- 1. STRAY FINGER (MB-4 T5): ignored entirely --------------------
        {
          const anchor = cellAt("bass", row0, 2);
          const dragTo = cellAt("bass", row0, 4);
          const stray = cellAt("bass", row0, 8);
          const a = center(anchor);
          te(anchor, "pointerdown", a.x, a.y, 7, true);
          te(dragTo, "pointermove", center(dragTo).x, center(dragTo).y, 7, true);
          const s = center(stray);
          te(stray, "pointerdown", s.x, s.y, 8, false);
          te(stray, "pointermove", s.x, s.y, 8, false); // NO distance change
          te(stray, "pointerup", s.x, s.y, 8, false);
          te(stray, "pointercancel", s.x, s.y, 8, false);
          te(dragTo, "pointerup", center(dragTo).x, center(dragTo).y, 7, true);
          expect(
            bassNotes(),
            "T5 coexistence: the FIRST finger's create-drag committed; the stray finger contributed nothing",
          ).toEqual([{ degree: expect.any(Number), start: 2, length: 3 }]);
        }

        // -- 2. CLAMP-NOOP SHRINK AT ×1 (MB-4 T3): never takes over ---------
        {
          const before = bassNotes().length;
          const held = cellAt("bass", row0, 10);
          const twin = cellAt("bass", row0, 14); // 4 steps RIGHT of held
          const moveTo = cellAt("bass", row0, 12); // toward the twin (a real
          // create-drag: drags never pass left of their anchor)
          const h = center(held);
          const t = center(twin);
          const m = center(moveTo);
          te(held, "pointerdown", h.x, h.y, 7, true);
          te(twin, "pointerdown", t.x, t.y, 8, false);
          // Finger 1 drags toward the twin: distance 4→2 cells, ratio ≈0.5
          // → candidate clamps to ×1 — a no-op, NO takeover.
          te(moveTo, "pointermove", m.x, m.y, 7, true);
          te(moveTo, "pointerup", m.x, m.y, 7, true);
          te(twin, "pointerup", t.x, t.y, 8, false);
          expect(
            bassNotes().length,
            "T3 coexistence: a shrink-to-×1 stream left the first finger's law alone (drag committed)",
          ).toBe(before + 1);
          expect(bassNotes().some((n) => n.start === 10 && n.length === 3)).toBe(
            true,
          );
          expect(chipText("bass")).toBe("1.00×"); // the clamp no-op moved nothing
        }

        // -- 3. TAKEOVER: a real ratio cancels the gesture, re-fits LIVE ---
        {
          const before = bassNotes().length;
          const seat = seatEl("bass");
          const rect = seat.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          const cx = rect.left + rect.width / 2;
          const anyCell = cellAt("bass", row0, 0);
          // Finger 1 on a cell (arms a create gesture that must be CANCELLED
          // at takeover — a pinch never places a note).
          te(anyCell, "pointerdown", cx - 50, cy, 7, true);
          te(anyCell, "pointerdown", cx + 50, cy, 8, false); // twin (100px)
          // Spread to 160px → ratio 1.6 → factor 1.6 (clamped ≤ 2).
          te(anyCell, "pointermove", cx - 80, cy, 7, true);
          te(anyCell, "pointermove", cx + 80, cy, 8, false);
          await waitFor(
            () => Math.abs(rowPitch("bass") / basePitch - 1.6) < 0.02,
            4000,
            "live re-fit: row pitch ×1.6 before any release",
          );
          expect(chipText("bass")).toBe("1.60×");
          te(anyCell, "pointerup", cx - 80, cy, 7, true);
          te(anyCell, "pointerup", cx + 80, cy, 8, false);
          expect(
            bassNotes().length,
            "takeover cancelled the armed create — a pinch never commits a note",
          ).toBe(before);
          expect(
            document.querySelectorAll(".note-run.is-drag-preview").length,
            "the cancelled gesture left no preview",
          ).toBe(0);
          // The window law at ×1.6: exactly WINDOW complete rows in the pane.
          const box = seat.getBoundingClientRect();
          const boxes = rowsOf("bass").map((r) => r.getBoundingClientRect());
          expect(
            boxes.filter((r) => r.top < box.bottom - 0.5 && r.bottom > box.top + 0.5)
              .length,
          ).toBe(WINDOW);
          expect(
            boxes.filter((r) => r.top >= box.top - 1 && r.bottom <= box.bottom + 1)
              .length,
          ).toBe(WINDOW);
        }

        // -- 4. CLAMP: ×2 is the ceiling (ratio would give 1.6×2 = 3.2) -----
        {
          const seat = seatEl("bass");
          const rect = seat.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          const cx = rect.left + rect.width / 2;
          const any = cellAt("bass", row0, 0);
          te(any, "pointerdown", cx - 50, cy, 7, true);
          te(any, "pointerdown", cx + 50, cy, 8, false);
          te(any, "pointermove", cx - 150, cy, 7, true); // distance 100 → 300
          te(any, "pointermove", cx + 150, cy, 8, false);
          await waitFor(
            () => chipText("bass") === "2.00×",
            4000,
            "over-pinch clamps at ×2",
          );
          expect(rowPitch("bass")).toBeLessThanOrEqual(basePitch * 2 * 1.02);
          te(any, "pointerup", cx - 150, cy, 7, true);
          te(any, "pointerup", cx + 150, cy, 8, false);
        }

        // -- 5. TRAILING FIT: the committed factor survives the release fit -
        await sleep(450); // ≥2 rAF past the release (the trailing fit landed)
        expect(
          chipText("bass"),
          "the trailing post-release fit is zoom-aware — the committed ×2 survives it",
        ).toBe("2.00×");
        expect(Math.abs(rowPitch("bass") / basePitch - 2)).toBeLessThan(0.02);

        // -- 6a. DOUBLE-TAP RESET at zoom: consumed PRE-ACTIVATION ----------
        const target = cellAt("bass", row0 + 1, 1);
        const beforeTap = bassNotes().length;
        {
          const p1 = center(target);
          // No awaits between the taps: the pair must land ≤350ms apart.
          te(target, "pointerdown", p1.x, p1.y, 7, true);
          te(target, "pointerup", p1.x, p1.y, 7, true);
          te(target, "pointerdown", p1.x + 6, p1.y, 7, true);
          te(target, "pointerup", p1.x + 6, p1.y, 7, true);
          expect(chipText("bass")).toBe("1.00×");
          expect(
            bassNotes().length,
            "tap 1 placed (+1); the reset tap was consumed pre-activation — it did NOT remove the note under it",
          ).toBe(beforeTap + 1);
          await waitFor(
            () => Math.abs(rowPitch("bass") / basePitch - 1) < 0.02,
            4000,
            "reset re-fits to the ×1 fill geometry (rAF-deferred apply)",
          );
        }

        // -- 6b. ×1 DOUBLE-TAP: net place+remove = zero (MB-2 identical) ----
        const fresh = cellAt("bass", row0 + 1, 3);
        const net0 = bassNotes().length;
        {
          const p = center(fresh);
          te(fresh, "pointerdown", p.x, p.y, 7, true);
          te(fresh, "pointerup", p.x, p.y, 7, true);
          te(fresh, "pointerdown", p.x + 4, p.y, 7, true);
          te(fresh, "pointerup", p.x + 4, p.y, 7, true);
          expect(
            bassNotes().length,
            "×1 double-tap nets place+remove = zero (the detector consumes nothing at ×1 — MB-2 byte-identical)",
          ).toBe(net0);
        }

        // -- 7. THE CHIP: a small zoom, then the chip resets it -------------
        {
          const seat = seatEl("bass");
          const rect = seat.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          const cx = rect.left + rect.width / 2;
          const any = cellAt("bass", row0, 0);
          te(any, "pointerdown", cx - 40, cy, 7, true);
          te(any, "pointerdown", cx + 40, cy, 8, false);
          te(any, "pointermove", cx - 48, cy, 7, true); // 80 → 96: ratio 1.2
          te(any, "pointermove", cx + 48, cy, 8, false);
          await waitFor(
            () => chipText("bass") === "1.20×",
            4000,
            "pinch to ×1.2",
          );
          te(any, "pointerup", cx - 48, cy, 7, true);
          te(any, "pointerup", cx + 48, cy, 8, false);
          await sleep(200);
          const chip = document.querySelector(
            ".lane-floor[data-lane='bass'] .register-zoom-chip",
          ) as HTMLElement;
          expect(chip).toBeTruthy();
          const cr = chip.getBoundingClientRect();
          expect(cr.height, "the zoom chip is a ≥44px-tall target").toBeGreaterThanOrEqual(44);
          expect(cr.width, "the zoom chip is a ≥44px-wide target").toBeGreaterThanOrEqual(44);
          chip.click();
          await waitFor(
            () => chipText("bass") === "1.00×",
            3000,
            "the chip click resets to ×1",
          );
        }
      } finally {
        dispose();
        host.remove();
        try {
          await getAutosaveController()?.stop();
          if (bootDb) {
            const ids = new Set(snapshotRows.map((r) => r.id));
            const current = await bootDb.allRecords();
            for (const row of snapshotRows) await bootDb.putRecord(row);
            for (const row of current) {
              if (!ids.has(row.id)) await bootDb.deleteRecord(row);
            }
          }
        } catch {
          /* best-effort restore; the wiping suites clean the origin anyway */
        }
      }
    },
    120_000,
  );
});
