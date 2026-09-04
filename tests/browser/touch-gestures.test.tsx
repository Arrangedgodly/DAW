/**
 * MB-2 browser gate — TOUCH GESTURE PARITY under TRUSTED CDP TOUCH INPUT
 * (the plan's per-gesture gate; the drag-notes-trusted precedent extended
 * from trusted pointers to trusted touch).
 *
 * Why CDP touch (the IN-2 fix lesson: synthetic events can lie): every
 * gesture here runs through `Input.dispatchTouchEvent` on the real browser
 * input pipeline — trusted touch events that derive REAL pointer events
 * (pointerType "touch"), REAL pointercancel-on-scroll, REAL click
 * finalization, and the REAL touch-action gesture-vs-scroll resolution the
 * CSS declares. A dispatched synthetic PointerEvent carries no active
 * pointer (capture throws) and consults no touch-action — it cannot express
 * a scroll stealing a gesture, which is exactly what this task must gate.
 *
 * Gated (phone stage 390×844, source-mounted app for store assertions —
 * MB-6's built-app gate consolidates later):
 * 1. TAP twins: tap places the gate-default note (one audition), anchor tap
 *    removes; drums tap toggles; the lane switcher + preset stepper tap.
 * 2. TAP-DRAG create (≥2 segments) + right-EDGE resize by touch.
 * 3. DRUMS PAINT by touch drag.
 * 4. RAIL SWEEP cue by touch: stopped sweep → selection follows the
 *    LAST-touched tile; playing sweep → one queued switch (`QUEUED …`).
 * 5. DBLTAP twins: two taps on a tile open the inline rename editor
 *    focused (the dblclick twin); Escape closes.
 * 6. EUCLID by touch: the FILL strip toggle reveals the overlay rails
 *    (opacity + pointer-events), stepper taps arm the preview, SET taps
 *    the row in; the toggle hides again.
 * 7. GESTURE-VS-SCROLL, both directions, at scrollable phone viewports
 *    (rotated 844×390 for the vertical page law, 390×844 for the 2-bar
 *    strip): a VERTICAL touch swipe from a cell pointercancels the armed
 *    gesture (IN-4, no commit) while the vertical pan itself still scrolls
 *    the page from that same origin (pan-y); a vertical swipe from a TILE
 *    cancels the armed sweep (no commit); a HORIZONTAL pan from a CELL is
 *    REFUSED by the pan-y reservation (the strip does not move — the axis
 *    belongs to drag-create/paint/sweep) while the same pan from a row
 *    LABEL scrolls the strip (the non-interactive origin keeps the browser
 *    pan); and a horizontal touch DRAG from a cell creates the note with
 *    the strip pinned at 0 (the interactive origin captures the gesture).
 *
 * CDP honesty note (the TH-3 precedent of recording what headless cannot
 * do): `Input.dispatchTouchEvent` runs the real app gesture handlers but
 * its injected stream does not drive compositor scrolling; scrolling is
 * driven by `Input.synthesizeScrollGesture` (the browser's own gesture
 * pipeline, so touch-action genuinely arbitrates). The two together cover
 * both halves of the discrimination; MB-4 owns the full pointercancel
 * edge table under touch.
 */

import { describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import {
  addPattern,
  appendChainSlot,
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { activePatterns, selectPattern } from "../../src/state/selection";
import { getSession } from "../../src/engine/session";
import { euclid } from "../../src/audio/euclid";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import type { DrumPattern, PitchedPattern } from "../../src/document/schema";

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

/** The number of pointercancel events seen while armed (IN-4 evidence). */
function cancelCounter(): { count: () => number; stop: () => void } {
  const seen: number[] = [];
  const oncancel = (): void => seen.push(1);
  window.addEventListener("pointercancel", oncancel);
  return { count: () => seen.length, stop: () => window.removeEventListener("pointercancel", oncancel) };
}

describe("MB-2 touch gesture parity (trusted CDP touch, phone stage)", () => {
  it(
    "tap place/remove · tap-drag create · edge resize · drums paint · sweep cue · dbltap rename · euclid reveal+SET · tap-vs-scroll both directions",
    { timeout: 240_000 },
    async () => {
      // The phone stage (MB-1): <768 wide. The app is source-mounted (the
      // drag-notes-trusted pattern) so every assertion reads the live store.
      await page.viewport(390, 844);
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];

      // Audition spy (session seam) — the v0 placement-audition law.
      const session = getSession();
      const origAudition = session.audition;
      const auditions: Array<{ lane: string }> = [];
      session.audition = (laneId, degreeOrDrum) => {
        auditions.push({ lane: laneId });
        return origAudition.call(session, laneId, degreeOrDrum);
      };

      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createFreshProjectDocument());

        // Trusted touch through CDP. Coordinates map client-space → page
        // space through the tester iframe's box (vitest scales it to fit
        // its viewport — measure, never assume (0,0)).
        await cdp().send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 5,
        });
        const c = cdp();
        const frame = window.frameElement as HTMLElement;
        const map = (clientX: number, clientY: number) => {
          const fr = frame.getBoundingClientRect();
          return {
            x: fr.left + clientX * (fr.width / innerWidth),
            y: fr.top + clientY * (fr.height / innerHeight),
          };
        };
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        /** One trusted touch sequence through the given client points. */
        const touch = async (
          pts: ReadonlyArray<{ x: number; y: number }>,
          holdMs = 30,
        ): Promise<void> => {
          const first = pts[0]!;
          await c.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: first.x, y: first.y }],
          });
          for (let i = 1; i < pts.length; i++) {
            await sleep(holdMs);
            await c.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: pts[i]!.x, y: pts[i]!.y }],
            });
          }
          await sleep(holdMs);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await sleep(120);
        };
        const el = (sel: string): HTMLElement =>
          document.querySelector(sel) as HTMLElement;
        const cell = (lane: string, row: number, step: number): HTMLElement =>
          el(
            `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
          );
        const tapEl = async (target: Element): Promise<void> => {
          const r = target.getBoundingClientRect();
          await touch([map(r.left + r.width / 2, r.top + r.height / 2)], 40);
        };
        /** A touch line across one row-box, in client coords relative to it. */
        const rowLine = (
          rowBox: DOMRect,
          from: { x: number; y: number },
          to: { x: number; y: number },
          steps = 8,
        ): Array<{ x: number; y: number }> => {
          const pts: Array<{ x: number; y: number }> = [];
          for (let i = 0; i <= steps; i++) {
            pts.push(
              map(
                rowBox.left + from.x + ((to.x - from.x) * i) / steps,
                rowBox.top + from.y + ((to.y - from.y) * i) / steps,
              ),
            );
          }
          return pts;
        };
        const bassNotes = () =>
          (docStore.getState().doc.patterns.bass[0] as PitchedPattern).notes;
        const kick = () =>
          (docStore.getState().doc.patterns.drums[0] as DrumPattern).steps
            .kick;
        const bassAuditions = () =>
          auditions.filter((a) => a.lane === "bass").length;

        await waitFor(
          () => el(".app").getAttribute("data-stage") === "phone",
          5000,
          "phone stage",
        );

        // ---- 1. SWITCHER TAP + TAP PLACE / REMOVE -------------------------
        await tapEl(el('.lane-switch-tab[data-lane="bass"]'));
        await waitFor(
          () => el(".lane-floor").dataset.lane === "bass",
          3000,
          "bass stage via touch tap on the switcher",
        );

        const anchor = cell("bass", 0, 2);
        await tapEl(anchor);
        await waitFor(
          () =>
            bassNotes().length === 1 &&
            bassNotes()[0]!.start === 2 &&
            bassNotes()[0]!.length === 2,
          4000,
          "touch tap places the gate-default note",
        );
        expect(bassAuditions()).toBe(1); // placement auditions (v0 law)
        await tapEl(anchor);
        await waitFor(
          () => bassNotes().length === 0,
          4000,
          "touch anchor tap removes the note",
        );
        expect(bassAuditions()).toBe(1); // removal never auditions

        // ---- 2. TAP-DRAG CREATE (≥2 segments) + EDGE RESIZE ----------------
        const row1 = cell("bass", 1, 0).parentElement!;
        await touch(rowLine(row1.getBoundingClientRect(), { x: 4 * 16 + 7, y: 12 }, { x: 8 * 16 + 7, y: 12 }));
        await waitFor(
          () =>
            bassNotes().length === 1 &&
            bassNotes()[0]!.start === 4 &&
            bassNotes()[0]!.length === 5,
          4000,
          "touch drag creates one 5-step note (drag-create ≥2 segments)",
        );
        const run = el('.lane-floor[data-lane="bass"] .note-run');
        const runR = run.getBoundingClientRect();
        const rowR = row1.getBoundingClientRect();
        // Release EXACTLY on the step-12 boundary: the resize reducer snaps
        // the pointer's fractional step to the 0.25 grid (12 − 4 = length 8).
        await touch(
          rowLine(
            rowR,
            { x: runR.right - rowR.left - 2, y: 12 },
            { x: 12 * 16, y: 12 },
          ),
        );
        await waitFor(
          () => bassNotes()[0]!.length === 8,
          4000,
          "touch edge-drag resizes the note",
        );

        // ---- 3. DRUMS PAINT -------------------------------------------------
        await tapEl(el('.lane-switch-tab[data-lane="drums"]'));
        await waitFor(
          () => el(".lane-floor").dataset.lane === "drums",
          3000,
          "drums stage",
        );
        const kickRow = cell("drums", 0, 0).parentElement!;
        await touch(
          rowLine(kickRow.getBoundingClientRect(), { x: 1 * 16 + 7, y: 12 }, { x: 5 * 16 + 7, y: 12 }),
        );
        await waitFor(
          () => kick().slice(1, 6).every(Boolean) && !kick()[0] && !kick()[6],
          4000,
          "touch drag paints the swept drums range",
        );

        // ---- 4. RAIL SWEEP CUE (stopped → selection; playing → queued) ------
        // A SECOND pattern for the chain, so a sweep's target is
        // distinguishable from its origin (same-id slots would make the
        // selection assertion meaningless).
        const patternA = activePatterns().drums;
        const patternB = addPattern("drums", 1, "P2");
        appendChainSlot("drums", patternB);
        appendChainSlot("drums", patternB);
        await waitFor(
          () => document.querySelectorAll(".rail-tile").length >= 3,
          3000,
          "three chain slots",
        );
        const chainIds = () => docStore.getState().doc.songChain.drums;
        expect(chainIds()[2]).not.toBe(patternA); // the sweep target differs
        const tiles = () =>
          Array.from(document.querySelectorAll(".rail-tile")) as HTMLElement[];
        const tilesBox = tiles()[0]!.parentElement!.getBoundingClientRect();
        const t0 = tiles()[0]!.getBoundingClientRect();
        const t2 = tiles()[2]!.getBoundingClientRect();
        await touch(
          rowLine(
            tilesBox,
            { x: t0.left - tilesBox.left + 8, y: t0.top - tilesBox.top + 8 },
            { x: t2.right - tilesBox.left - 6, y: t2.top - tilesBox.top + 8 },
          ),
        );
        await waitFor(
          () => activePatterns().drums === patternB,
          4000,
          "stopped touch sweep cues the LAST-touched tile (selection follows)",
        );

        // Playing sweep: PLAY by touch, sweep across to a FOURTH chain slot
        // carrying a THIRD pattern — whatever the lane sounds at play
        // (chain slot 0 or the selection) can never equal that target, so
        // the switch request is never a same-pattern no-op (the flake
        // class this avoids: pending only appears for a REAL switch).
        const patternC = addPattern("drums", 1, "P3");
        appendChainSlot("drums", patternC);
        await waitFor(
          () => document.querySelectorAll(".rail-tile").length >= 4,
          3000,
          "four chain slots",
        );
        /** Sweep across tiles by index, from FRESH rects (the chrome may
         * have reflowed since they were last captured). */
        const sweepTiles = async (fromIdx: number, toIdx: number) => {
          const list = tiles();
          const box = list[0]!.parentElement!.getBoundingClientRect();
          const a = list[fromIdx]!.getBoundingClientRect();
          const b = list[toIdx]!.getBoundingClientRect();
          await touch(
            rowLine(
              box,
              { x: a.left - box.left + 8, y: a.top - box.top + 8 },
              { x: b.right - box.left - 6, y: b.top - box.top + 8 },
            ),
          );
        };
        await tapEl(el(".booth-btn-play"));
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing after touch PLAY",
        );
        await sleep(150); // let the PLAY→STOP button reflow settle
        await sweepTiles(0, 3);
        await waitFor(
          () => session.getPendingSwitch("drums") !== null,
          4000,
          "playing touch sweep queues the switch",
        );
        expect(session.getPendingSwitch("drums")?.toPatternId).toBe(patternC);
        expect(
          document.querySelector(".rail-cue-summary")?.textContent ?? "",
        ).toMatch(/QUEUED 1 LANES?/);
        await tapEl(el(".booth-btn-play")); // STOP
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "stopped",
        );

        // ---- 5. DBLTAP RENAME TWIN ------------------------------------------
        await tapEl(tiles()[0]!);
        await sleep(80);
        await tapEl(tiles()[0]!);
        await waitFor(
          () => !!document.querySelector(".rail-tools-menu .rail-edit"),
          4000,
          "dbltap opens the inline rename editor (the dblclick twin)",
        );
        await waitFor(
          () =>
            document.activeElement ===
            document.querySelector(".rail-tools-menu .rail-edit"),
          4000,
          "dbltap focuses the rename field",
        );
        (document.activeElement as HTMLElement).dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => !document.querySelector(".rail-tools-menu .rail-edit"),
          4000,
          "rename editor closes on Escape",
        );

        // ---- 6. EUCLID BY TOUCH: reveal → arm → SET → hide ------------------
        const fill0 = el('.lane-floor[data-lane="drums"] .row-fill');
        expect(fill0.classList.contains("is-overlay")).toBe(true);
        expect(getComputedStyle(fill0).opacity).toBe("0"); // hidden first
        const fillToggle = el(".head-fill-toggle");
        expect(fillToggle).toBeTruthy(); // drums, narrow stage — present
        await tapEl(fillToggle);
        await sleep(350); // the 120ms ease settles
        expect(
          Number.parseFloat(getComputedStyle(fill0).opacity),
          "FILL reveals the overlay rail",
        ).toBeGreaterThanOrEqual(0.99);
        expect(getComputedStyle(fill0).pointerEvents).toBe("auto");
        // Steppers arm by touch: pulses +1 twice (E(7,16) for a fresh row).
        const plusBtn = fill0.querySelector(
          '[aria-label="More pulses for KICK fill"]',
        ) as HTMLElement;
        const setBtn = fill0.querySelector(".row-fill-apply") as HTMLElement;
        await tapEl(plusBtn);
        await tapEl(plusBtn);
        await waitFor(
          () => !setBtn.disabled,
          3000,
          "stepper taps arm SET",
        );
        expect(
          fill0.querySelector(".row-fill-value")?.textContent,
        ).toContain("7/16");
        // The armed preview paints BEFORE the commit (PX-3 law)…
        await tapEl(setBtn);
        await waitFor(
          () => kick()[0] === true,
          4000,
          "SET taps the Euclidean row in",
        );
        // The committed row IS euclid(7, 16, 0) — the pure algorithm is the
        // authority (no hand-computed literals to rot).
        expect([...kick()]).toEqual(euclid(7, 16, 0));
        await tapEl(fillToggle);
        await sleep(350);
        expect(
          Number.parseFloat(getComputedStyle(fill0).opacity),
          "FILL hides the rails again",
        ).toBeLessThanOrEqual(0.01);

        // ---- 7. STEPPER TAP (preset) — the compact strip by touch ----------
        await tapEl(el('.lane-switch-tab[data-lane="bass"]'));
        await waitFor(
          () => el(".lane-floor").dataset.lane === "bass",
          3000,
          "bass stage (steppers)",
        );
        const bassLaneConf = () =>
          docStore.getState().doc.lanes.find((l) => l.id === "bass")!;
        const presetBefore = bassLaneConf().presetId;
        await tapEl(el('[aria-label="Next preset for BASS"]'));
        await waitFor(
          () => bassLaneConf().presetId !== presetBefore,
          4000,
          "preset stepper advances by touch tap",
        );
        // (restore — determinism for later suites is the IDB restore's job)

        // ---- 8. GESTURE-VS-SCROLL, both directions --------------------------
        // Two CDP touch primitives, split by what each can honestly express
        // (recorded like TH-3's headless caveat): `dispatchTouchEvent` runs
        // the REAL app gesture handlers (pointerdown/move/up + click +
        // pointercancel when the renderer claims the pan) but its injected
        // stream does not drive compositor scrolling; `synthesizeScrollGesture`
        // drives REAL scrolling (through the browser's gesture pipeline, so
        // touch-action genuinely arbitrates) but carries no app pointer
        // stream. Between them: the app gestures capture from interactive
        // origins, the pans still scroll from everywhere the law promises,
        // and the armed-gesture cancel law holds under touch.
        //
        // A ROTATED PHONE (844×390 — MB-1's own rotation case: width ≥768
        // but height <600 keeps the phone law): the chrome + 14-row lead
        // exceed 390px by a wide deterministic margin, so the committed
        // scrolling-grid law has real scroll range for the swipes.
        await page.viewport(844, 390);
        await sleep(200);
        await tapEl(el('.lane-switch-tab[data-lane="lead"]'));
        await waitFor(
          () => el(".lane-floor").dataset.lane === "lead",
          3000,
          "lead stage (scroll phase)",
        );
        expect(
          document.documentElement.scrollHeight,
          "the phone document scrolls (scrolling-grid law)",
        ).toBeGreaterThan(innerHeight);
        /** One trusted synthesized touch-scroll gesture (real scrolling). */
        const scrollGesture = async (
          origin: Element,
          xDistance: number,
          yDistance: number,
        ): Promise<void> => {
          const r = origin.getBoundingClientRect();
          const p = map(r.left + r.width / 2, r.top + r.height / 2);
          await c.send("Input.synthesizeScrollGesture", {
            x: p.x,
            y: p.y,
            xDistance,
            yDistance,
            speed: 2000,
          });
          await sleep(500);
        };

        // (a) VERTICAL touch swipe FROM A CELL: the armed gesture
        // pointercancels and nothing commits (IN-4 under touch input)…
        // leadNotes reads the SELECTED pattern (the grid edits the
        // selection — DES-6), by id, never by array index.
        const leadNotes = () =>
          (
            docStore
              .getState()
              .doc.patterns.lead.find(
                (p) => p.id === activePatterns().lead,
              ) as PitchedPattern
          ).notes.length;
        const notesBefore = leadNotes();
        const cancels = cancelCounter();
        const lc = cell("lead", 2, 3);
        const lcR = lc.getBoundingClientRect();
        const down: Array<{ x: number; y: number }> = [map(lcR.left + 7, lcR.top + 12)];
        for (let i = 1; i <= 10; i++)
          down.push(map(lcR.left + 7, lcR.top + 12 + i * 16));
        await touch(down, 25);
        await sleep(250);
        expect(cancels.count(), "vertical touch swipe from a cell pointercancels the armed gesture (IN-4)").toBeGreaterThanOrEqual(1);
        expect(leadNotes()).toBe(notesBefore); // clean cancel: no commit
        cancels.stop();
        scrollTo(0, 0);
        await sleep(150);
        // …and the vertical pan itself still reaches the PAGE from that
        // same cell origin (pan-y — the scrolling-grid law).
        await scrollGesture(lc, 0, -160);
        expect(
          scrollY,
          "vertical scroll gesture from a cell scrolls the page",
        ).toBeGreaterThan(0);
        scrollTo(0, 0);
        await sleep(150);

        // (b) VERTICAL swipe FROM A TILE: the armed sweep cancels cleanly —
        // no cue commit (selection unchanged).
        const selectionBefore = activePatterns().drums;        const cancels2 = cancelCounter();
        const tile0 = tiles()[0]!;
        const tileR = tile0.getBoundingClientRect();
        const down2: Array<{ x: number; y: number }> = [map(tileR.left + 10, tileR.top + 8)];
        for (let i = 1; i <= 10; i++)
          down2.push(map(tileR.left + 10, tileR.top + 8 + i * 16));
        await touch(down2, 25);
        await sleep(250);
        expect(cancels2.count(), "vertical touch swipe from a tile pointercancels the armed sweep").toBeGreaterThanOrEqual(1);
        expect(activePatterns().drums).toBe(selectionBefore); // no commit
        cancels2.stop();
        scrollTo(0, 0);
        await sleep(150);

        // (c) HORIZONTAL pan FROM A CELL: `pan-y` RESERVES the horizontal
        // axis for the app — the synthesized horizontal scroll gesture from
        // a cell moves NOTHING (this is the reservation the drag-create
        // rides on); FROM THE LABEL the same gesture scrolls the strip
        // (the non-interactive origin keeps the browser pan). Back at
        // 390×844 — a 2-bar row overflows only at the narrow width.
        await page.viewport(390, 844);
        await sleep(200);
        const id2 = addPattern("lead", 2, "T2");
        selectPattern("lead", id2);
        await waitFor(
          () =>
            el('.lane-floor[data-lane="lead"] .lane-grid-scroll').querySelectorAll(".cell")
              .length ===
            14 * 32,
          5000,
          "2-bar lead grid mounts",
        );
        const strip = el(
          '.lane-floor[data-lane="lead"] .lane-grid-scroll',
        ) as HTMLElement;
        expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
        const cellOrigin = cell("lead", 3, 0);
        await scrollGesture(cellOrigin, 300, 0);
        expect(
          strip.scrollLeft,
          "horizontal pan from a CELL is refused (pan-y reserves the axis for gestures)",
        ).toBe(0);
        const label = el('.lane-floor[data-lane="lead"] .row-label');
        // Negative distance = finger drags left = content scrolls right
        // (same sign law as the vertical probe: -y scrolled down).
        await scrollGesture(label, -300, 0);
        expect(
          strip.scrollLeft,
          "horizontal pan from the row LABEL scrolls the strip",
        ).toBeGreaterThan(0);

        // (d) HORIZONTAL drag FROM A CELL on the SAME 2-bar strip: the
        // interactive origin captures the gesture — a note is created, the
        // strip does NOT move from the cell origin.
        strip.scrollLeft = 0;
        await sleep(100);
        const leadBefore = leadNotes();
        const cRow = cell("lead", 3, 0).parentElement!;
        await touch(
          rowLine(cRow.getBoundingClientRect(), { x: 6 * 16 + 7, y: 12 }, { x: 9 * 16 + 7, y: 12 }),
        );
        await waitFor(
          () => leadNotes() === leadBefore + 1,
          4000,
          "horizontal touch drag from a cell creates the note (gesture captured)",
        );
        // Sub-pixel drift from the programmatic reset is honest; a real
        // pan would be hundreds of px. The strip never meaningfully moved.
        expect(Math.abs(strip.scrollLeft)).toBeLessThanOrEqual(1);
      } finally {
        session.audition = origAudition;
        void import("../../src/engine/session")
          .then(({ getSession: g }) => g().transport.stop?.())
          .catch(() => {});
        dispose();
        host.remove();
        await page.viewport(1280, 800); // leave the tester viewport as configured
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
    240_000,
  );
});
