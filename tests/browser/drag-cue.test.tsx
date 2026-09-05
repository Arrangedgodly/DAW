/**
 * IN-3 browser gate — multi-clip drag cueing on the pattern rail
 * (iteration-2 AC #3), synthetic pointer events on the real mounted app:
 *
 * 1. POINTER SWEEP (E5 path A): press a tile + sweep across sibling tiles
 *    AND into the next lane's row + release → every TOUCHED lane queues
 *    exactly ONE switch at its LAST-touched tile (identical to clicking
 *    each touched tile individually — IM-7 same-lane supersede), through
 *    the same requestPatternSwitch funnel; live preview during the gesture
 *    with ZERO engine/store writes; `QUEUED <n> LANES` summary; pending
 *    states visible; landing quantized on the boundary exactly as
 *    individual clicks (quantized-switch.test.ts extensions pin the engine
 *    half: per-lane independence + same-lane supersede).
 * 2. KEYBOARD PATH (E5 path B, Daredevil): Shift+arrows range-select
 *    (carried + clamped across rows; range text in aria) + Enter = CUE ALL
 *    through the same funnel; plain arrows collapse; Escape collapses
 *    first; the per-lane pending texts + the summary are IDENTICAL to the
 *    pointer path's (a11y §7 E5).
 * 3. CANCEL: pointercancel mid-gesture commits nothing.
 * 4. CLICK LAWS: an unmoved synthetic press/release pair is NOT a cue (the
 *    native trailing click owns single activation — the rail never captures
 *    on press); a plain synthetic click still cues one tile (v0 law); a
 *    single click never speaks the summary.
 *
 * Timing law of the engine (why the phases are ordered this way): a switch
 * to the pattern the NEXT-boundary slot already plays is a CANCEL (v0 IM-7
 * law — same for individual clicks), and `lastDeliveredStep` is a
 * session-lifetime high-water mark. Both parity paths therefore commit
 * fresh-play sweeps to slot 2 (the next boundary is slot 1, never slot 2 →
 * always a real pending at step 16), and the click-law phase runs right
 * after a landing (cursor just past 16 → next boundary slot 2 ≠ the cued
 * slot-1 tile), keeping every expectation deterministic.
 *
 * Synthetic-pointer honesty (the IN-2 lesson): dispatched PointerEvents
 * carry no active pointer, so setPointerCapture throws and is skipped —
 * moves stay inside the rail, which the section listeners track. The
 * REAL-capture half of the law (capture retargeting moves/ups, the trailing
 * click swallowed, no double activation) is pinned by the trusted-input
 * gate: tests/browser/drag-cue-trusted.test.tsx (userEvent → playwright
 * dragAndDrop = real trusted pointers). File is .tsx (not the plan's .ts)
 * to JSX-mount the real <App/> — the recorded IN-2 precedent.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { docStore, loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getSession } from "../../src/engine/session";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";

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

function tile(lane: string, slot: number): HTMLButtonElement {
  const row = document.querySelector(`.rail-row[data-lane="${lane}"]`);
  const el = row?.querySelectorAll<HTMLButtonElement>(".rail-tile")[slot];
  if (!el) throw new Error(`missing ${lane} rail tile ${slot}`);
  return el;
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

/** Per-lane pending announcement text (the E5 parity capture). */
function laneStatus(lane: string): string {
  return (
    document
      .querySelector(`.rail-row[data-lane="${lane}"] .head-sr`)
      ?.textContent?.trim() ?? ""
  );
}

/** The rail summary region's text (`QUEUED <n> LANES`). */
function cueSummaryText(): string {
  return (
    document.querySelector(".rail-cue-summary")?.textContent?.trim() ?? ""
  );
}

describe("IN-3 multi-clip drag cueing (real app, pointer + keyboard)", () => {
  it(
    "sweep cues every touched lane at its last-touched tile · preview zero-writes · cancel · E5 parity with Shift+arrows + Enter",
    { timeout: 120_000 },
    async () => {
      const { cleanup } = mount();
      const session = getSession();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      /** E5 capture: per-lane texts + summary, per path. */
      const capture = () => ({
        drums: laneStatus("drums"),
        bass: laneStatus("bass"),
        summary: cueSummaryText(),
      });
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createDemoProject()); // 4 chain slots per lane

        // ===== 1. POINTER SWEEP (E5 path A) ===============================
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );
        const docBefore = docStore.getState().doc;
        const d0 = center(tile("drums", 0));
        const d1 = center(tile("drums", 1));
        const d2 = center(tile("drums", 2));
        const b0 = center(tile("bass", 0));
        const b2 = center(tile("bass", 2));
        pe(tile("drums", 0), "pointerdown", d0.x, d0.y);
        pe(tile("drums", 1), "pointermove", d1.x, d1.y);
        pe(tile("drums", 2), "pointermove", d2.x, d2.y);
        pe(tile("bass", 0), "pointermove", b0.x, b0.y);
        // LIVE PREVIEW, zero writes: touched tiles marked, per-lane TARGET is
        // the last-touched tile; no pending switch exists yet; doc untouched.
        expect(tile("drums", 0).dataset.cuePreview).toBe("swept");
        expect(tile("drums", 2).dataset.cuePreview).toBe("target");
        expect(tile("bass", 0).dataset.cuePreview).toBe("target");
        expect(session.getPendingSwitch("drums")).toBeNull();
        expect(session.getPendingSwitch("bass")).toBeNull();
        expect(docStore.getState().doc).toBe(docBefore);
        // Sweep exits bass at slot 2 → bass's cue target moves there.
        pe(tile("bass", 2), "pointermove", b2.x, b2.y);
        expect(tile("bass", 0).dataset.cuePreview).toBe("swept");
        expect(tile("bass", 2).dataset.cuePreview).toBe("target");
        pe(tile("bass", 2), "pointerup", b2.x, b2.y);
        // COMMIT: one switch per touched lane, at each lane's LAST-touched
        // tile — exactly what clicking drums 0,1,2 + bass 0,2 would leave.
        expect(session.getPendingSwitch("drums")!.toPatternId).toBe("drums-3");
        expect(session.getPendingSwitch("bass")!.toPatternId).toBe("bass-3");
        expect(session.getPendingSwitch("chords")).toBeNull();
        expect(session.getPendingSwitch("lead")).toBeNull();
        expect(cueSummaryText()).toBe("QUEUED 2 LANES");
        // Pending states VISIBLE on the target tiles (IM-7 observable).
        expect(tile("drums", 2).dataset.state).toBe("pending");
        expect(tile("bass", 2).dataset.state).toBe("pending");
        // Preview cleared after commit; the gesture NEVER wrote the document.
        expect(tile("drums", 0).dataset.cuePreview).toBeUndefined();
        expect(tile("bass", 2).dataset.cuePreview).toBeUndefined();
        expect(docStore.getState().doc).toBe(docBefore);
        // Capture path A's announcements, then stop BEFORE the boundary —
        // path B must commit at the same delivered-step position for exact
        // text parity (see the timing law in the header).
        await waitFor(
          () =>
            laneStatus("drums").includes("switching to drums-3") &&
            laneStatus("bass").includes("switching to bass-3"),
          3000,
          "path A pending announcements",
        );
        const pointerPath = capture();
        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "transport stopped (path A)",
        );

        // ===== 2. KEYBOARD PATH (E5 path B) ===============================
        // Fresh engine schedules (loadDocument rebuilds lane playback); the
        // pointer high-water mark (< 16) carries over, so the commit's next
        // boundary is step 16 — identical to path A's.
        loadDocument(createDemoProject());
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing (path B)",
        );
        await new Promise((r) => setTimeout(r, 50));
        const kTile = tile("drums", 0);
        kTile.focus();
        key(kTile, "ArrowRight", { shiftKey: true });
        key(document.activeElement!, "ArrowRight", { shiftKey: true });
        expect(document.activeElement).toBe(tile("drums", 2)); // focus follows
        expect(
          tile("drums", 0).getAttribute("aria-label")?.includes("in cue range"),
        ).toBe(true);
        expect(
          tile("drums", 2).getAttribute("aria-label")?.includes("in cue range"),
        ).toBe(true);
        expect(tile("drums", 3).dataset.inRange).toBeUndefined();
        // Plain arrows collapse the range (cancel-extend) and rove normally.
        key(document.activeElement!, "ArrowLeft");
        expect(tile("drums", 0).dataset.inRange).toBeUndefined();
        expect(document.activeElement).toBe(tile("drums", 1));
        // Re-extend along the row, then DOWN into the bass row (carried slot).
        key(document.activeElement!, "ArrowRight", { shiftKey: true });
        key(document.activeElement!, "ArrowDown", { shiftKey: true });
        expect(document.activeElement).toBe(tile("bass", 2)); // carried focus
        expect(
          tile("bass", 2).getAttribute("aria-label")?.includes("in cue range"),
        ).toBe(true);
        // Escape collapses FIRST (cancel-first law) — focus stays put.
        key(document.activeElement!, "Escape");
        expect(tile("bass", 2).dataset.inRange).toBeUndefined();
        expect(document.activeElement).toBe(tile("bass", 2));
        // Re-select + CUE ALL: rows drums+bass at the focus-edge column
        // (slot 2) — the SAME targets as path A's sweep, same funnel.
        tile("drums", 0).focus();
        key(document.activeElement!, "ArrowRight", { shiftKey: true });
        key(document.activeElement!, "ArrowRight", { shiftKey: true });
        key(document.activeElement!, "ArrowDown", { shiftKey: true });
        key(document.activeElement!, "Enter");
        expect(session.getPendingSwitch("drums")!.toPatternId).toBe("drums-3");
        expect(session.getPendingSwitch("bass")!.toPatternId).toBe("bass-3");
        expect(cueSummaryText()).toBe("QUEUED 2 LANES");
        expect(tile("bass", 2).dataset.inRange).toBeUndefined(); // consumed
        await waitFor(
          () =>
            laneStatus("drums").includes("switching to drums-3") &&
            laneStatus("bass").includes("switching to bass-3"),
          3000,
          "path B pending announcements",
        );
        const keyboardPath = capture();
        // E5: the announcement texts are EQUAL between the two paths.
        expect(keyboardPath).toEqual(pointerPath);
        // The keyboard path's pendings are visible and land quantized too.
        expect(tile("drums", 2).dataset.state).toBe("pending");
        await waitFor(
          () =>
            session.getPendingSwitch("drums") === null &&
            session.getPendingSwitch("bass") === null,
          10_000,
          "path B switches land",
        );
        expect(session.getActivePattern("drums")).toBe("drums-3");
        expect(session.getActivePattern("bass")).toBe("bass-3");

        // ===== 3. SUPERSEDE + CANCEL + CLICK LAWS (cursor just past 16) ===
        // A NEW gesture supersedes the landed state per its own last-touched
        // tiles (bass slot 1, chords slot 2). PX-4 journey delta: the
        // poly-loop demo's CHORDS patterns are 2 bars, so at cursor just
        // past 16 the chords lane's next boundary (step 32) already plays
        // slot 1 — cueing slot 1 would be the IM-7 CANCEL; slot 2 is the
        // real pending (the 1-bar lanes keep the original slot-1 law:
        // their next boundary plays slot 2 ≠ slot 1).
        const b1 = center(tile("bass", 1));
        const c1 = center(tile("chords", 2));
        pe(tile("bass", 1), "pointerdown", b1.x, b1.y);
        pe(tile("chords", 2), "pointermove", c1.x, c1.y);
        pe(tile("chords", 2), "pointerup", c1.x, c1.y);
        expect(session.getPendingSwitch("bass")!.toPatternId).toBe("bass-2");
        expect(session.getPendingSwitch("chords")!.toPatternId).toBe(
          "chords-3",
        );
        expect(cueSummaryText()).toBe("QUEUED 2 LANES");
        // pointercancel mid-gesture: NOTHING commits, preview cleared.
        const l0 = center(tile("lead", 0));
        const l1 = center(tile("lead", 1));
        pe(tile("lead", 0), "pointerdown", l0.x, l0.y);
        pe(tile("lead", 1), "pointermove", l1.x, l1.y);
        expect(tile("lead", 0).dataset.cuePreview).toBe("swept");
        pe(tile("lead", 0), "pointercancel", l0.x, l0.y);
        expect(session.getPendingSwitch("lead")).toBeNull(); // no partial cues
        expect(tile("lead", 0).dataset.cuePreview).toBeUndefined();
        expect(tile("lead", 1).dataset.cuePreview).toBeUndefined();
        // Unmoved synthetic press/release pair: NOT a cue (the trailing
        // native click owns single activation; the rail never captures on
        // press — the recorded disambiguation).
        pe(tile("chords", 3), "pointerdown", c1.x, c1.y);
        pe(tile("chords", 3), "pointerup", c1.x, c1.y);
        expect(session.getPendingSwitch("chords")!.toPatternId).toBe(
          "chords-3",
        ); // unchanged by the pair
        // A plain synthetic click still cues one tile (v0 law) and NEVER
        // speaks the summary. Yield one macrotask first: the gesture's
        // trailing-click suppression expires there (IN-2 law) — this is a
        // NEW click, like a real user's next press.
        await new Promise((r) => setTimeout(r, 10));
        const summaryBeforeClick = cueSummaryText();
        tile("lead", 1).click();
        expect(session.getPendingSwitch("lead")!.toPatternId).toBe("lead-2");
        expect(cueSummaryText()).toBe(summaryBeforeClick);
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession: g }) => g().transport.stop?.())
          .catch(() => {});
        cleanup();
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
