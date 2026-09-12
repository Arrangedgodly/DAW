/**
 * IN-3 TRUSTED-input gate — multi-clip drag cueing under REAL pointer
 * capture on the source-mounted real app (the drag-notes-trusted precedent:
 * the IN-2 lesson is that synthetic PointerEvents cannot capture, so this
 * gate drives the browser input pipeline through vitest `userEvent`:
 * playwright locator actions = trusted pointer events that REALLY capture).
 *
 * What only real pointers can prove here (the false-confidence classes):
 * - `userEvent.dragAndDrop(source, target)` = a REAL drag (hover source →
 *   press → move → release). The rail captures on the first extending move;
 *   every subsequent move/up is RETARGETED to the capture element — the
 *   sweep must still hit-test by coordinates and commit on release.
 * - the trailing click after a captured drag retargets to the rail (never
 *   the tile): a moved gesture cues each touched lane EXACTLY ONCE (no
 *   pointerup-commit + click double activation), pinned by a
 *   setActivePattern request spy.
 * - `userEvent.click` on a tile (unmoved press, never captured): the native
 *   trailing click still owns single-tile activation — exactly one request,
 *   no multi-clip summary.
 * - `userEvent.dblClick` still opens the inline rename editor (the rail
 *   deliberately does NOT capture on press — dblclick stays native).
 *
 * Timing law (same as the synthetic gate): a switch to the pattern the
 * NEXT-boundary slot already plays cancels (v0 IM-7 law, identical for
 * clicks), so every commit here targets a slot that is never the next
 * boundary: fresh play (cursor < 16 → next boundary slot 1) cues slots 3
 * and (bass/lead) 1; the landing then advances the cursor past 16 (next
 * boundary slot 2), where the chords single click (slot 3) still queues.
 */

import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { showPhonePage } from "../../src/state/phonePage";
import { getSession } from "../../src/engine/session";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";

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

/** Bounded trusted action (drag-notes-trusted pattern): never hang silently. */
function bounded(p: Promise<void>, what: string): Promise<void> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`trusted ${what} did not settle in 20s`)),
        20_000,
      ),
    ),
  ]);
}

describe("IN-3 multi-clip cueing under TRUSTED pointers (app)", () => {
  it(
    "trusted drag cues each touched lane once (real capture) · trusted single click · dblclick editor intact",
    { timeout: 120_000 },
    async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

      const session = getSession();
      // Request spy at the funnel's engine seam: one cue per cued lane per
      // gesture — the double-activation detector. (2026-09-11 merge: tile
      // drags now cue the SLOT through session.cueSlot — mode "jump" — and
      // the jump lands via applyChainFollow at the pattern boundary, so
      // setActivePattern is no longer the cue-time funnel seam.)
      const origCueSlot = session.cueSlot.bind(session);
      const requests: string[] = [];
      session.cueSlot = (lane, slot) => {
        requests.push(lane);
        return origCueSlot(lane, slot);
      };
      const laneRequests = (lane: string) =>
        requests.filter((l) => l === lane).length;
      const summary = () =>
        document.querySelector(".rail-cue-summary")?.textContent?.trim() ?? "";

      const tile = (lane: string, slot: number): HTMLButtonElement => {
        const row = document.querySelector(`.rail-row[data-lane="${lane}"]`);
        const el = row?.querySelectorAll<HTMLButtonElement>(".rail-tile")[slot];
        if (!el) throw new Error(`missing ${lane} rail tile ${slot}`);
        return el;
      };

      // The app is designed for 1440×900 (LY-1); the tester iframe defaults
      // narrower, where rail rows wrap and drag geometry degrades.
      await page.viewport(1440, 900);

      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createDemoProject()); // 4 chain slots per lane
        // 2026-09-11 (user call): the chain is its own SONG page now - the
        // rail is not on the stage. Open it before addressing rail tiles.
        showPhonePage("song");
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );

        // --- TRUSTED CROSS-LANE DRAG: one cue per touched lane -----------
        // (targets slot 3 — never the next boundary while the cursor is
        // inside the first bar; see the timing law in the header.)
        const bassBefore = laneRequests("bass");
        const leadBefore = laneRequests("lead");
        await bounded(
          userEvent.dragAndDrop(tile("bass", 3), tile("lead", 3)),
          "drag bass→lead",
        );
        await waitFor(
          () =>
            session.getPendingSwitch("bass") !== null &&
            session.getPendingSwitch("lead") !== null,
          4000,
          "trusted cross-lane drag cues both lanes",
        );
        expect(session.getPendingSwitch("bass")!.toPatternId).toBe("bass-4");
        expect(session.getPendingSwitch("lead")!.toPatternId).toBe("lead-4");
        expect(laneRequests("bass")).toBe(bassBefore + 1);
        expect(laneRequests("lead")).toBe(leadBefore + 1);
        expect(summary()).toBe("QUEUED 2 LANES");

        // --- TRUSTED within-lane DRAG (real press→move→release + capture) -
        const drumsBefore = laneRequests("drums");
        await bounded(
          userEvent.dragAndDrop(tile("drums", 0), tile("drums", 3)),
          "drag drums 0→3",
        );
        await waitFor(
          () => session.getPendingSwitch("drums") !== null,
          4000,
          "trusted drag cues drums",
        );
        // Last-touched tile owns the lane (identical to clicking 0..3 in
        // order — IM-7 supersede), and the gesture fired EXACTLY ONE request
        // (the retargeted trailing click added nothing).
        expect(session.getPendingSwitch("drums")!.toPatternId).toBe("drums-4");
        expect(laneRequests("drums")).toBe(drumsBefore + 1);
        expect(summary()).toBe("QUEUED 1 LANES");
        await waitFor(
          () => tile("drums", 3).dataset.state === "pending",
          2000,
          "trusted drag pending visible",
        );

        // --- TRUSTED SINGLE CLICK: exactly ONE request, no summary --------
        const chordsBefore = laneRequests("chords");
        await bounded(userEvent.click(tile("chords", 3)), "click chords");
        await waitFor(
          () => session.getPendingSwitch("chords") !== null,
          4000,
          "trusted click cues chords",
        );
        expect(
          session.getPendingSwitch("chords")!.toPatternId,
        ).toBe("chords-4");
        expect(laneRequests("chords")).toBe(chordsBefore + 1);
        expect(summary()).toBe("QUEUED 1 LANES"); // single cues never speak it

        // Both cross-lane switches land quantized at their own boundaries.
        await waitFor(
          () =>
            session.getPendingSwitch("bass") === null &&
            session.getPendingSwitch("lead") === null,
          10_000,
          "cross-lane switches land",
        );
        expect(session.getActivePattern("bass")).toBe("bass-4");
        expect(session.getActivePattern("lead")).toBe("lead-4");

        // --- TRUSTED DBLCLICK: the rename editor still opens (presses are
        //     never captured while unmoved — dblclick stays native) --------
        await bounded(userEvent.dblClick(tile("chords", 2)), "dblclick chords");
        await waitFor(
          () => !!document.querySelector(".rail-edit"),
          4000,
          "dblclick opens inline rename",
        );
        const edit = document.querySelector<HTMLInputElement>(".rail-edit")!;
        edit.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => !document.querySelector(".rail-edit"),
          2000,
          "Escape closes inline rename",
        );
      } finally {
        session.cueSlot = origCueSlot;
        void import("../../src/engine/session")
          .then(({ getSession: g }) => g().transport.stop?.())
          .catch(() => {});
        dispose();
        host.remove();
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
