/**
 * IN-2 browser gate — drag-created notes + resize + drums paint on the REAL
 * app (iteration-2 AC #2), pointer-event simulation throughout:
 *
 * 1. DRAG-CREATE: pointer down on an empty pitched cell + drag across ≥2
 *    segments + release → ONE sustained note spanning them (store note
 *    {degree, start, length}; renderer note-run bar + covered cells; live
 *    preview during the drag with ZERO store writes — the euclid law).
 * 2. PLAYS SUSTAINED: compileLaneEvents emits holdSeconds = length ×
 *    secondsPerStep (SC-2 native note lengths).
 * 3. EDGE-DRAG RESIZE: pointer down on the note's edge hit zone + drag +
 *    release → length commits; announces `LENGTH <n> ST` (E4).
 * 4. KEYBOARD RESIZE: `+`/`-` ±1 step, Shift ±0.25, clamps at 0.25/128;
 *    the SAME announcement text as the pointer path (E5 parity).
 * 5. KEYBOARD NOTE LAW: Enter places (gate default) / trims mid-span /
 *    removes at the anchor; Delete removes; cell names carry note state.
 * 6. DRUMS PAINT: drag paints multiple hits (one-shot law); ONE undo reverts
 *    the whole gesture; single click still toggles.
 * 7. ROUND-TRIP: codec encode→decode AND a real IndexedDB save→load preserve
 *    the dragged note.
 * 8. MIDI: the dragged note exports with duration = noteLengthTicks(length).
 * 9. EDGE STATES (interaction-level, IN-2-owned): pointercancel mid-gesture
 *    cancels cleanly; view-only quadrants ignore gestures.
 *
 * Synthetic-pointer honesty: PointerEvents dispatched here carry no active
 * pointer, so setPointerCapture throws and is skipped (caught in the
 * renderer) — moves stay inside the grid, which is exactly what the
 * container listeners track. Real drags additionally capture (IN-4 sweeps
 * the rest). SINGLE-CLICK activation under REAL captured pointers (the
 * Chromium click-retarget trap) is pinned by the companion trusted-input
 * gate: tests/browser/drag-notes-trusted.test.tsx (CDP Input domain).
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
  undo,
} from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { getAutosaveController } from "../../src/persist/boot";
import { encode, decode } from "../../src/document/codec";
import type { PitchedPattern } from "../../src/document/schema";
import { effectiveScale } from "../../src/document/scales";
import { compileLaneEvents } from "../../src/audio/compile";
import { getPreset } from "../../src/audio/presets";
import { secondsPerStep } from "../../src/audio/time";
import { buildPitchedNotes, noteLengthTicks } from "../../src/audio/exportMidi";
import {
  makeRecord,
  openRawProjectDb,
  type ProjectDb,
} from "../../src/persist/db";

/** Isolated DB for the save→load round-trip (persistence.test.ts precedent). */
const TEST_DB = "bitbounce-in2-drag-notes";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      dispose();
      host.remove();
    },
  };
}

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

function key(el: Element, k: string, opts: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
}

const POINTER_ID = 7;

function pe(
  el: Element,
  type: string,
  x: number,
  y: number,
  extra: PointerEventInit = {},
): boolean {
  return el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...extra,
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

function bassPattern(): PitchedPattern {
  const p = docStore.getState().doc.patterns.bass[0];
  if (p?.kind !== "pitched") throw new Error("expected pitched bass pattern");
  return p;
}

function bassNotes() {
  return bassPattern().notes;
}

describe("IN-2 drag notes + resize + drums paint (real app, pointer events)", () => {
  it(
    "drag-create → sustained compile → edge-drag + keyboard resize (announcement parity) → note law → paint → round-trip → MIDI",
    { timeout: 120_000 },
    async () => {
      const { cleanup } = mount();
      let db: ProjectDb;
      // Snapshot the shared-origin project rows so teardown can restore the
      // pre-test state (an in-page mount cannot deleteDatabase("bitbounce")
      // — the boot connection stays open and the delete blocks forever; the
      // iframe-based suites wipe at their own start instead).
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        // Boot settles first (its async restore must never override the
        // deterministic document this test loads).
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitFor(
          () =>
            (
              document.querySelector(
                '.lane-floor[data-lane="bass"] [role="grid"]',
              ) as HTMLElement
            )
              // RC-1 journey delta: windowed pitched names append ROWS range.
              ?.getAttribute("aria-label")
              ?.startsWith("BASS grid · EDITING") === true,
          2000,
          "bass quadrant editable",
        );
        expect(bassNotes()).toHaveLength(0);

        // --- 1. DRAG-CREATE across 4 segments -----------------------------
        const start = cellAt("bass", 0, 2);
        const mid = cellAt("bass", 0, 3);
        const end = cellAt("bass", 0, 5);
        const a = center(start);
        const m = center(mid);
        const e = center(end);
        pe(start, "pointerdown", a.x, a.y);
        pe(mid, "pointermove", m.x, m.y);
        // LIVE PREVIEW: dashed bar + data-preview cells, ZERO store writes.
        expect(bassNotes()).toHaveLength(0);
        expect(
          document.querySelectorAll(".note-run.is-drag-preview").length,
        ).toBe(1);
        expect(start.dataset.preview).toBe("true");
        pe(end, "pointermove", e.x, e.y);
        pe(end, "pointerup", e.x, e.y);
        expect(bassNotes()).toEqual([{ degree: 0, start: 2, length: 4 }]);
        // Renderer: covered cells on (2 anchor, 3..5 sustain), bar + edge.
        expect(start.dataset.on).toBe("true");
        expect(start.dataset.sustain).toBe("false");
        expect(cellAt("bass", 0, 4).dataset.on).toBe("true");
        expect(cellAt("bass", 0, 4).dataset.sustain).toBe("true");
        expect(cellAt("bass", 0, 6).dataset.on).toBe("false");
        expect(
          document.querySelectorAll(".note-run.is-drag-preview"),
        ).toHaveLength(0);
        const edge = document.querySelector(
          '.lane-floor[data-lane="bass"] .note-edge',
        ) as HTMLElement;
        expect(edge.dataset.start).toBe("2");
        expect(edge.dataset.length).toBe("4");

        // E4: cell names carry note state in text.
        expect(start.getAttribute("aria-label")).toBe(
          "C step 3, note starts, 4 steps",
        );
        expect(cellAt("bass", 0, 3).getAttribute("aria-label")).toBe(
          "C step 4, note continues",
        );

        // --- 2. PLAYS SUSTAINED (SC-2 compiler) ---------------------------
        const doc = docStore.getState().doc;
        const stepSec = secondsPerStep(doc.transport.bpm);
        const events = compileLaneEvents({
          pattern: bassPattern(),
          preset: getPreset("preset-bass-1")!,
          gate: { unit: "steps", value: 2 },
          groove: { bpm: doc.transport.bpm, swing: doc.transport.swing },
          scale: effectiveScale(doc, "bass"),
        });
        const sustained = events.find(
          (ev) => Math.abs(ev.time - 2 * stepSec) < 1e-9,
        );
        expect(sustained, "dragged note compiled").toBeTruthy();
        expect(sustained!.holdSeconds).toBeCloseTo(4 * stepSec, 9);

        // --- 3. EDGE-DRAG RESIZE 4 → 6 ------------------------------------
        const liveSpan = () =>
          (
            document.querySelector(
              '.lane-floor[data-lane="bass"] .note-length-live',
            ) as HTMLElement
          )?.textContent?.trim() ?? "";
        const runEl = edge.parentElement as HTMLElement;
        const er = runEl.getBoundingClientRect();
        // Drag the edge to the END of step 7 (pointer step-fraction 8).
        const cells0 = cellAt("bass", 0, 0).parentElement as HTMLElement;
        const origin = cells0.getBoundingClientRect();
        // Step width = cell + gap (measured, not derived from row width).
        const stepW =
          center(cellAt("bass", 0, 1)).x - center(cellAt("bass", 0, 0)).x;
        const px = (frac: number) => origin.left + frac * stepW;
        pe(edge, "pointerdown", er.right - 1, er.top + er.height / 2);
        pe(cells0, "pointermove", px(7), er.top + er.height / 2);
        pe(cells0, "pointermove", px(8), er.top + er.height / 2);
        pe(cells0, "pointerup", px(8), er.top + er.height / 2);
        expect(bassNotes()[0]!.length).toBe(6);
        const pointerAnnouncement = liveSpan();
        expect(pointerAnnouncement).toBe("LENGTH 6 ST");

        // --- 4. KEYBOARD RESIZE + E5 announcement parity -------------------
        start.focus();
        expect(document.activeElement).toBe(start);
        key(start, "+"); // 6 → 7
        expect(bassNotes()[0]!.length).toBe(7);
        expect(liveSpan()).toBe("LENGTH 7 ST");
        key(start, "+", { shiftKey: true }); // 7 → 7.25
        expect(bassNotes()[0]!.length).toBe(7.25);
        expect(liveSpan()).toBe("LENGTH 7.25 ST");
        key(start, "-", { shiftKey: true }); // → 7
        key(start, "-"); // → 6 — SAME text as the pointer path (E5)
        expect(bassNotes()[0]!.length).toBe(6);
        expect(liveSpan()).toBe(pointerAnnouncement);
        // Clamp at the 0.25 floor: repeats never wrap or go below.
        for (let i = 0; i < 30; i++) key(start, "-", { shiftKey: true });
        expect(bassNotes()[0]!.length).toBe(0.25);
        const floorLive = liveSpan();
        key(start, "-");
        key(start, "_");
        expect(bassNotes()[0]!.length).toBe(0.25); // no-op at the bound
        expect(liveSpan()).toBe(floorLive);

        // --- 5. KEYBOARD NOTE LAW (place / trim / remove) ------------------
        const emptyCell = cellAt("bass", 0, 9);
        emptyCell.focus();
        key(emptyCell, "Enter"); // place → gate default (bass gate = 2 steps)
        expect(bassNotes()).toContainEqual({ degree: 0, start: 9, length: 2 });
        key(emptyCell, "+");
        key(emptyCell, "+"); // length 4 → covers steps 9..12
        expect(bassNotes().find((n) => n.start === 9)!.length).toBe(4);
        const midSpan = cellAt("bass", 0, 11);
        midSpan.focus();
        key(midSpan, "Enter"); // TRIM to end at step 11 → length 3
        expect(bassNotes().find((n) => n.start === 9)!.length).toBe(3);
        key(emptyCell, "Enter"); // at the anchor → REMOVE (toggle-off law)
        expect(bassNotes().find((n) => n.start === 9)).toBeUndefined();
        key(emptyCell, "Enter"); // place again …
        expect(bassNotes().find((n) => n.start === 9)).toBeTruthy();
        key(emptyCell, "Backspace"); // … then Delete removes the focused note
        expect(bassNotes().find((n) => n.start === 9)).toBeUndefined();

        // --- 6. DRUMS PAINT + undo + single click --------------------------
        selectLane("drums");
        await waitFor(
          () =>
            (
              document.querySelector(
                '.lane-floor[data-lane="drums"] [role="grid"]',
              ) as HTMLElement
            )?.getAttribute("aria-label") === "DRUMS grid · EDITING",
          2000,
          "drums quadrant editable",
        );
        const kick = (step: number) => {
          const p = docStore.getState().doc.patterns.drums[0];
          if (p?.kind !== "drums") throw new Error("expected drums pattern");
          return p.steps.kick[step];
        };
        const d0 = cellAt("drums", 0, 0);
        const d3 = cellAt("drums", 0, 3);
        const c0 = center(d0);
        const c3 = center(d3);
        expect(kick(0)).toBe(false);
        pe(d0, "pointerdown", c0.x, c0.y);
        pe(d3, "pointermove", c3.x, c3.y);
        expect(d0.dataset.preview).toBe("true"); // preview during the sweep
        expect(kick(0)).toBe(false); // zero store writes until release
        pe(d3, "pointerup", c3.x, c3.y);
        expect([kick(0), kick(1), kick(2), kick(3)]).toEqual([
          true,
          true,
          true,
          true,
        ]);
        expect(kick(4)).toBe(false);
        // ONE gesture = ONE undo step (the "toggle" family coalesces the
        // synchronous release batch).
        undo();
        expect([kick(0), kick(1), kick(2), kick(3)]).toEqual([
          false,
          false,
          false,
          false,
        ]);
        // Single click still toggles (v0 law preserved). The gesture's
        // trailing-click suppression expires on the next macrotask — yield
        // one so this is a NEW click, exactly like a real user's next press.
        await new Promise((r) => setTimeout(r, 10));
        d0.click();
        expect(kick(0)).toBe(true);
        d0.click();
        expect(kick(0)).toBe(false);

        // --- 7. ROUND-TRIP (codec + real IndexedDB save→load) -------------
        selectLane("bass");
        loadDocument({
          ...docStore.getState().doc,
          patterns: {
            ...docStore.getState().doc.patterns,
            bass: [
              {
                ...bassPattern(),
                notes: [{ degree: 0, start: 2, length: 6 }],
              },
            ],
          },
        });
        const withNote = docStore.getState().doc;
        const decoded = decode(encode(withNote));
        expect(decoded.patterns.bass[0]!.kind).toBe("pitched");
        expect((decoded.patterns.bass[0] as PitchedPattern).notes).toEqual([
          { degree: 0, start: 2, length: 6 },
        ]);
        db = await openRawProjectDb(TEST_DB);
        await db.putRecord(
          makeRecord("in2", withNote, encode(withNote), Date.now(), false),
        );
        const restored = await db.getRecord("in2");
        expect(restored).toBeTruthy();
        const reloaded = decode(restored!.json);
        expect((reloaded.patterns.bass[0] as PitchedPattern).notes).toEqual([
          { degree: 0, start: 2, length: 6 },
        ]);

        // --- 8. MIDI duration from the note length ------------------------
        const midiNotes = buildPitchedNotes(
          docStore.getState().doc,
          "bass",
          docStore.getState().doc.patterns.bass,
          0,
        );
        const dragged = midiNotes.find((n) => n.tick === 2 * 120);
        expect(dragged, "dragged note exported to MIDI").toBeTruthy();
        expect(dragged!.durationTicks).toBe(noteLengthTicks(6));

        // --- 9. EDGE STATES (interaction-level) ----------------------------
        // pointercancel mid-gesture: preview cleared, nothing committed.
        expect(bassNotes()).toHaveLength(1);
        const freeCell = cellAt("bass", 0, 12);
        const f = center(freeCell);
        pe(freeCell, "pointerdown", f.x, f.y);
        pe(
          cellAt("bass", 0, 14),
          "pointermove",
          center(cellAt("bass", 0, 14)).x,
          f.y,
        );
        expect(
          document.querySelectorAll(".note-run.is-drag-preview").length,
        ).toBe(1);
        pe(freeCell, "pointercancel", f.x, f.y);
        expect(bassNotes()).toHaveLength(1); // unchanged
        expect(
          document.querySelectorAll(".note-run.is-drag-preview"),
        ).toHaveLength(0);
        expect(freeCell.dataset.preview).toBeUndefined();

        // View-only quadrants ignore pointer gestures (E2 pointer law): the
        // lead grid is view-only while bass is selected.
        const leadCell = cellAt("lead", 0, 2);
        const l = center(leadCell);
        pe(leadCell, "pointerdown", l.x, l.y);
        pe(leadCell, "pointermove", l.x, l.y);
        pe(leadCell, "pointerup", l.x, l.y);
        const leadPattern = docStore.getState().doc.patterns.lead[0];
        if (leadPattern?.kind !== "pitched") throw new Error("expected lead");
        expect(leadPattern.notes).toHaveLength(0); // nothing created
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        // Stop the boot autosave controller first (no writes may land after
        // the restore), then put the pre-test rows back and drop any row this
        // test's autosave created. No deleteDatabase — see the snapshot note.
        try {
          await getAutosaveController()?.stop();
          if (bootDb) {
            const ids = new Set(snapshotRows.map((r) => r.id));
            const current = await bootDb.allRecords();
            for (const row of snapshotRows) await bootDb.putRecord(row);
            for (const row of current) {
              if (!ids.has(row.id)) await bootDb.deleteRecord(row.id);
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
