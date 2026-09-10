/**
 * MB-4 browser gate — MOBILE RESILIENCE on the real app at phone viewport
 * (town-hall mobile addendum m5 first clauses; the plan's AC):
 *
 * 1. FIRST-TOUCH UNLOCK: the gesture-unlock path works when the FIRST
 *    gesture is any touch interaction — tap a cell (audition), tap PLAY,
 *    tap a preset stepper — each resumes a genuinely SUSPENDED real
 *    AudioContext (ctx.suspend()), and the suspended-while-playing case
 *    surfaces the HU-2 "TAP TO RESUME AUDIO" affordance, which a trusted
 *    touch tap clears (running + banner gone). HONEST SCOPE (the TH-3
 *    precedent): CI launches Chromium with --autoplay-policy=
 *    no-user-gesture-required (vite.config.ts), so this harness cannot
 *    reproduce the BROWSER's autoplay gate — what is gated here is the
 *    app-side path (resume of a real suspended context, initiated by
 *    trusted CDP touch through the real handlers). The real-device
 *    gesture gate stays a human-session item (R12). iOS Safari residuals
 *    keep the existing HU-1 warn-and-attempt banner stance (v1 non-goal).
 *
 * 2. ROTATION mid-playback + mid-gesture (MB-1 re-budgeted layout; here
 *    the playback/focus/announcement coherence is pinned): audio continues
 *    (transport stays playing; the audio clock advances in lockstep with
 *    wall time across the rotation), the playhead is CONTINUOUS (pure
 *    ctx.currentTime recompute — consecutive getLoopTime() samples track
 *    the ctx.currentTime delta mod the loop length, and the rendered
 *    .grid-playhead keeps moving after the rotation), sticky chrome stays
 *    pinned mid-scroll mid-play, and a gesture interrupted by rotation
 *    cancels cleanly (the browser cancels the touch — CDP touchCancel
 *    mid-gesture, the derived pointercancel) or dies with a stage-mode
 *    REMOUNT (phone→tablet crossing) with no stuck preview, no phantom
 *    note, no stuck sweep (the rail clears its module sweep on unmount —
 *    verified) and no stranded focus (activeElement never a dead node).
 *
 * 3. VISIBILITY at 390×844 (v0 TH-3 + HU-3 laws pinned at mobile): while
 *    playing, a hidden window keeps audio on the ctx clock (lockstep,
 *    playing never drops) and the playhead resyncs on return (lockstep
 *    across the whole hidden window); visibilitychange→hidden AND pagehide
 *    flush a pending autosave to the REAL IndexedDB (row leaves dirty,
 *    bytes contain the edit), and a boot over a dirty row re-offers the
 *    HU-3 recovery affordance (RECOVERED UNSAVED WORK toast) at phone
 *    width. Headless honesty (TH-3's recorded caveat carries over): a
 *    synthetic visibilitychange does not make headless Chromium clamp
 *    timers or park rAF — real app-switch backgrounding stays the human
 *    session's item, not CI's.
 *
 * 4. ONE-SHOT LOOP re-enable (refinement-3) at phone: LOOP off mid-play by
 *    trusted touch → the pass plays out and the transport AUTO-STOPS (PLAY
 *    label returns, position parks); LOOP back on + PLAY restarts from the
 *    top; LOOP re-enabled DURING the exhausted tail keeps the transport
 *    playing past the pass end (no dead-air-while-playing stall — the
 *    audio-level audibility law is transport-loop-reenable.test.ts's own
 *    gate; this pins the UI/transport choreography at mobile).
 *
 * 5. TRUSTED TOUCH-CANCEL EDGE TABLE (IN-4's sweep extended to touch; the
 *    rows only the real input pipeline can express — every row's law:
 *    commit-or-cancel cleanly, never a stuck preview, never a partial
 *    commit, undo history coherent):
 *    T1 touchCancel mid create-drag (browser interruption: notification
 *       shade, navigation gesture) → preview cleared, 0 commits, 0
 *       history entries, 0 auditions;
 *    T2 touchCancel mid rail sweep → no cue commit, no stuck sweep
 *       preview, selection unchanged;
 *    T3 second finger mid-gesture → ignored entirely; the first finger's
 *       release commits exactly once;
 *    T4 long-press contextmenu mid-gesture → suppressed (the gesture owns
 *       the pointer); the gesture then completes; idle contextmenu stays
 *       free;
 *    T5 scroll-cancel during an armed gesture (MB-2's discrimination
 *       pinned as an edge law): a vertical touch swipe from a cell
 *       pointercancels the armed gesture with NO commit and NO history
 *       entry, and the same vertical pan still scrolls the page (the
 *       committed scrolling-grid law).
 *
 * The synthetic half of the extended table (touch-typed pointercancel,
 * touch second pointer, hybrid mouse-during-touch, help-mode mid-gesture)
 * lives in pointer-edge-states.test.tsx's touch describe — dispatch
 * events can express those; only these five need the trusted pipeline.
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
import { activePatterns, selectLane } from "../../src/state/selection";
import { clearToasts } from "../../src/state/toasts";
import { getSession } from "../../src/engine/session";
import { getActiveProjectId, getAutosaveController, getBootDb, initPersistence } from "../../src/persist/boot";
import { decode } from "../../src/document/codec";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { saveProject } from "../../src/persist/projectStore";
import type { PitchedPattern } from "../../src/document/schema";

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  ms = 4000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The app + the trusted-touch toolbox, source-mounted at a phone stage. */
interface PhoneApp {
  el: (sel: string) => HTMLElement;
  cell: (lane: string, row: number, step: number) => HTMLElement;
  tapEl: (target: Element) => Promise<void>;
  touch: (
    pts: ReadonlyArray<{ x: number; y: number }>,
    holdMs?: number,
  ) => Promise<void>;
  /** Raw dispatch with the payload in the error (diagnostics). */
  sendTouch: (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    touchPoints: ReadonlyArray<{ x: number; y: number }>,
  ) => Promise<void>;
  touchHoldAt: (p: { x: number; y: number }, ms: number) => Promise<void>;
  touchCancelAll: () => Promise<void>;
  secondFinger: (
    held: { x: number; y: number },
    extra: { x: number; y: number },
    move: { x: number; y: number },
  ) => Promise<void>;
  scrollGesture: (origin: Element, xDistance: number, yDistance: number) => Promise<void>;
  rowLine: (
    rowBox: DOMRect,
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps?: number,
  ) => Array<{ x: number; y: number }>;
  dispose: () => void;
}

async function mountPhoneApp(w: number, h: number): Promise<PhoneApp> {
  await page.viewport(w, h);
  const host = document.createElement("div");
  document.body.append(host);
  const disposeApp = render(() => <App />, host);
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
  const sendRaw = async (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    touchPoints: ReadonlyArray<{ x: number; y: number }>,
  ): Promise<void> => {
    try {
      await c.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: touchPoints.map((p) => ({ x: p.x, y: p.y })),
      });
    } catch (err) {
      throw new Error(
        `dispatchTouchEvent ${type} ${JSON.stringify(touchPoints)} @inner ${innerWidth}x${innerHeight}: ${String(err)}`,
        { cause: err },
      );
    }
  };
  const touch = async (
    pts: ReadonlyArray<{ x: number; y: number }>,
    holdMs = 30,
  ): Promise<void> => {
    const first = pts[0]!;
    await sendRaw("touchStart", [{ x: first.x, y: first.y }]);
    for (let i = 1; i < pts.length; i++) {
      await sleep(holdMs);
      await sendRaw("touchMove", [{ x: pts[i]!.x, y: pts[i]!.y }]);
    }
    await sleep(holdMs);
    await sendRaw("touchEnd", []);
    await sleep(120);
  };
  const tools: PhoneApp = {
    el: (sel: string) => document.querySelector(sel) as HTMLElement,
    cell: (lane: string, row: number, step: number) =>
      document.querySelector(
        `.lane-floor[data-lane="${lane}"] .cell[data-row="${row}"][data-step="${step}"]`,
      ) as HTMLElement,
    tapEl: async (target: Element): Promise<void> => {
      const r = target.getBoundingClientRect();
      await touch([map(r.left + r.width / 2, r.top + r.height / 2)], 40);
    },
    touch,
    sendTouch: sendRaw,
    /** A single touch held at one point (long-press chassis). */
    touchHoldAt: async (p: { x: number; y: number }, ms: number) => {
      await c.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: p.x, y: p.y }],
      });
      await sleep(ms);
    },
    /** The browser's interruption law: cancel every active touch. */
    touchCancelAll: async () => {
      await c.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await sleep(120);
    },
    /**
     * A second finger lands while the first is held, both move, then the
     * FIRST finger alone releases (touchEnd still carrying finger 2, then
     * a second touchEnd ends it) — the app must commit from finger 1 only.
     */
    secondFinger: async (held, extra, move) => {
      await c.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: held.x, y: held.y }],
      });
      await sleep(40);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: held.x, y: held.y },
          { x: extra.x, y: extra.y },
        ],
      });
      await sleep(40);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: move.x, y: move.y },
          { x: extra.x, y: extra.y },
        ],
      });
      await sleep(40);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [{ x: extra.x, y: extra.y }],
      });
      await sleep(40);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await sleep(120);
    },
    scrollGesture: async (origin: Element, xDistance: number, yDistance: number) => {
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
    },
    rowLine: (
      rowBox: DOMRect,
      from: { x: number; y: number },
      to: { x: number; y: number },
      steps = 8,
    ) => {
      const pts: Array<{ x: number; y: number }> = [];
      const n = Math.max(steps, 1); // steps=0 = the single `from` point
      for (let i = 0; i <= steps; i++) {
        pts.push(
          map(
            rowBox.left + from.x + ((to.x - from.x) * i) / n,
            rowBox.top + from.y + ((to.y - from.y) * i) / n,
          ),
        );
      }
      return pts;
    },
    dispose: () => {
      disposeApp();
      host.remove();
    },
  };
  return tools;
}

/** Snapshot/restore the shared origin DB around a gate (the suite's law). */
async function snapshotDb(): Promise<{
  db: ProjectDb;
  rows: Awaited<ReturnType<ProjectDb["allRecords"]>>;
} | null> {
  try {
    const db = await openRawProjectDb("bitbounce");
    return { db, rows: await db.allRecords() };
  } catch {
    return null;
  }
}

async function restoreDb(snap: Awaited<ReturnType<typeof snapshotDb>>): Promise<void> {
  try {
    await getAutosaveController()?.stop();
    if (snap) {
      const ids = new Set(snap.rows.map((r) => r.id));
      const current = await snap.db.allRecords();
      for (const row of snap.rows) await snap.db.putRecord(row);
      for (const row of current) {
        if (!ids.has(row.id)) await snap.db.deleteRecord(row.id);
      }
    }
  } catch {
    /* best-effort restore; the wiping suites clean the origin anyway */
  }
}

/** The number of pointercancel events seen while armed (IN-4 evidence). */
function cancelCounter(): { count: () => number; stop: () => void } {
  const seen: number[] = [];
  const oncancel = (): void => seen.push(1);
  window.addEventListener("pointercancel", oncancel);
  return {
    count: () => seen.length,
    stop: () => window.removeEventListener("pointercancel", oncancel),
  };
}

/** Best-effort visibilityState override (the TH-3 convention, Chromium).
 * The dispatched event BUBBLES — the real visibilitychange is fired at the
 * document and bubbles to window, which is where the app's autosave
 * listener sits. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

const bassNotes = () =>
  (docStore.getState().doc.patterns.bass[0] as PitchedPattern).notes;
const historyDepth = () => docStore.temporal.getState().pastStates.length;
const previews = () =>
  document.querySelectorAll(".note-run.is-drag-preview").length +
  document.querySelectorAll(".cell[data-preview]").length;

describe("MB-4 mobile resilience (phone stage, trusted CDP touch)", () => {
  it(
    "1 · first-touch unlock: suspended context resumes from the FIRST trusted touch (cell audition, PLAY, preset stepper) + the TAP-TO-RESUME affordance",
    { timeout: 120_000 },
    async () => {
      const app = await mountPhoneApp(390, 844);
      const session = getSession();
      const snap = await snapshotDb();
      const origAudition = session.audition;
      const auditions: Array<{ lane: string }> = [];
      session.audition = (laneId, degreeOrDrum) => {
        auditions.push({ lane: laneId });
        return origAudition.call(session, laneId, degreeOrDrum);
      };
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        loadDocument(createFreshProjectDocument());
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "phone",
          5000,
          "phone stage",
        );
        // Force the lazily-created context into the genuinely suspended
        // state (autoplay policy / OS stand-in — the real suspended case).
        const ctx = session.engine.getContext() as unknown as AudioContext;
        await ctx.suspend();
        expect(ctx.state).toBe("suspended");

        // (a) FIRST gesture = a touch tap on a CELL (the audition path).
        selectLane("bass");
        await waitFor(
          () => app.el(".lane-floor").dataset.lane === "bass",
          3000,
          "bass stage",
        );
        await app.tapEl(app.cell("bass", 0, 2));
        await waitFor(
          () => bassNotes().length === 1,
          4000,
          "first-touch tap placed the gate-default note",
        );
        expect(auditions.filter((a) => a.lane === "bass")).toHaveLength(1);
        await waitFor(
          () => ctx.state === "running",
          4000,
          "first touch (cell audition) resumed the suspended context",
        );
        const t0 = ctx.currentTime;
        await sleep(200);
        expect(ctx.currentTime, "the clock advances after unlock").toBeGreaterThan(t0);

        // (b) FIRST gesture = a touch tap on PLAY (the transport path).
        await ctx.suspend();
        expect(ctx.state).toBe("suspended");
        await app.tapEl(app.el(".booth-btn-play"));
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing after touch PLAY",
        );
        await waitFor(
          () => ctx.state === "running",
          4000,
          "first touch (PLAY) resumed the suspended context",
        );

        // (c) The suspended-WHILE-PLAYING case: the HU-2 affordance
        // surfaces and a trusted touch tap on it resumes + clears.
        await ctx.suspend();
        await waitFor(
          () => !!app.el(".audio-resume"),
          4000,
          "TAP TO RESUME AUDIO surfaced while playing",
        );
        expect(app.el(".audio-resume").textContent).toContain("TAP TO RESUME AUDIO");
        await app.tapEl(app.el(".audio-resume"));
        await waitFor(
          () => ctx.state === "running",
          4000,
          "trusted touch on the affordance resumed the context",
        );
        await waitFor(
          () => !document.querySelector(".audio-resume"),
          4000,
          "affordance cleared on running",
        );

        // STOP, then (d) FIRST gesture = a preset STEPPER tap (the
        // LaneHeader audition path — the plan's third example).
        await app.tapEl(app.el(".booth-btn-play"));
        await waitFor(() => !session.transport.snapshot.playing, 4000, "stopped");
        await ctx.suspend();
        expect(ctx.state).toBe("suspended");
        const bassConf = () =>
          docStore.getState().doc.lanes.find((l) => l.id === "bass")!;
        const presetBefore = bassConf().presetId;
        await app.tapEl(app.el('[aria-label="Next preset for BASS"]'));
        await waitFor(
          () => bassConf().presetId !== presetBefore,
          4000,
          "preset stepper advanced by touch tap",
        );
        await waitFor(
          () => ctx.state === "running",
          4000,
          "first touch (preset stepper audition) resumed the suspended context",
        );
      } finally {
        clearToasts(); // a toast left open covers the booth for the next test
        session.audition = origAudition;
        session.transport.stop();
        app.dispose();
        await restoreDb(snap);
        await page.viewport(1280, 800);
      }
    },
    120_000,
  );

  it(
    "2 · rotation mid-playback: audio + playhead continuous; mid-gesture rotation cancels (same stage) or remounts (crossing) cleanly; focus never strands",
    { timeout: 180_000 },
    async () => {
      const app = await mountPhoneApp(390, 844);
      const session = getSession();
      const snap = await snapshotDb();
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "phone",
          5000,
          "phone stage",
        );

        // PLAY by trusted touch, then sample (clock, loopTime) pairs across
        // the rotation — the PURE-ctx-recompute law: consecutive getLoopTime
        // samples track the ctx.currentTime delta modulo the loop length.
        await app.tapEl(app.el(".booth-btn-play"));
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "playing before rotation",
        );
        const ctx = session.engine.getContext() as unknown as AudioContext;
        // LL-2: the fresh project's LCM — four 1-bar chains → 16 steps =
        // 2 s @ 120 bpm (the v0.1 basis exactly; the zero-drift shape).
        const loopLen = 2;
        const sample = () => ({
          clock: ctx.currentTime,
          loopTime: session.transport.getLoopTime(),
        });
        const before = sample();
        // The rendered playhead must be live BEFORE the rotation.
        const playhead = app.el(".grid-playhead");
        const playheadX = () =>
          Number.parseFloat(playhead.style.transform.replace(/[^\d.-]/g, "")) || 0;
        const ph0 = playheadX();

        // --- same-stage rotation: 390×844 portrait → 844×390 landscape ---
        await page.viewport(844, 390);
        await sleep(250); // reflow + a few rAF frames settle
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "phone",
          3000,
          "rotated phone keeps the phone law",
        );
        expect(
          session.transport.snapshot.playing,
          "audio continues across the rotation",
        ).toBe(true);
        const after = sample();
        const dt = after.clock - before.clock;
        expect(dt, "the audio clock advanced in lockstep with wall time").toBeGreaterThan(0.2);
        let dl = after.loopTime - before.loopTime;
        // Modulo the loop length (wrap is legal — continuity is the law).
        while (dl < 0) dl += loopLen;
        while (dl > loopLen) dl -= loopLen;
        expect(Math.abs(dl - (dt % loopLen))).toBeLessThan(0.2);
        // The rendered playhead is still LIVE after the rotation (the rAF
        // reader restarted with the remounted chrome and moved on).
        await waitFor(
          () => Math.abs(playheadX() - ph0) > 0.01 || playhead.style.opacity === "1",
          3000,
          "rendered playhead live after rotation",
        );
        // Sticky chrome still pinned mid-scroll mid-play (MB-1's law re-pinned
        // in the PLAYING state).
        window.scrollTo(0, 120);
        await sleep(200);
        expect(
          Math.abs(app.el(".phone-chrome").getBoundingClientRect().top),
          "chrome pinned mid-scroll mid-play after rotation",
        ).toBeLessThanOrEqual(1);
        window.scrollTo(0, 0);

        // --- mid-gesture rotation, same stage: the browser cancels the
        // touch (CDP touchCancel mid-gesture) → clean cancel, no commit. ---
        const depth0 = historyDepth();
        const row1 = app.cell("bass", 1, 0).parentElement!;
        const line = app.rowLine(
          row1.getBoundingClientRect(),
          { x: 2 * 16 + 7, y: 12 },
          { x: 5 * 16 + 7, y: 12 },
          4,
        );
        await app.sendTouch("touchStart", [line[0]!]);
        for (let i = 1; i < line.length; i++) {
          await sleep(25);
          await app.sendTouch("touchMove", [line[i]!]);
        }
        await waitFor(
          () => previews() > 0,
          2000,
          "drag preview armed mid-gesture",
        );
        // Rotate WHILE the finger is down; the browser's law cancels the touch.
        await page.viewport(390, 844);
        await sleep(150);
        await app.touchCancelAll();
        await waitFor(() => previews() === 0, 2000, "preview cleared after cancel");
        expect(bassNotes().length, "rotation-interrupted gesture committed nothing").toBe(0);
        expect(historyDepth(), "undo history untouched by the cancel").toBe(depth0);

        // --- cross-stage rotation mid-gesture: phone → tablet REMOUNTS the
        // grid surface + the rail — the gesture dies with its surface. ---
        const anchorRow = app.cell("bass", 0, 4).parentElement!;
        const rectBefore = anchorRow.getBoundingClientRect();
        const downPt = app.rowLine(
          rectBefore,
          { x: 4 * 16 + 7, y: 12 },
          { x: 4 * 16 + 7, y: 12 },
          0,
        )[0]!;
        const movePt = app.rowLine(
          rectBefore,
          { x: 7 * 16 + 7, y: 12 },
          { x: 7 * 16 + 7, y: 12 },
          0,
        )[0]!;
        await app.sendTouch("touchStart", [downPt]);
        await sleep(30);
        await app.sendTouch("touchMove", [movePt]);
        await waitFor(() => previews() > 0, 2000, "preview armed before the crossing");
        // The crossing: phone → tablet. The GridSurface key includes the
        // stage mode → remount; the rail remounts with it and its onCleanup
        // clears the module sweep.
        await page.viewport(768, 1024);
        await sleep(300);
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "tablet",
          3000,
          "tablet after the crossing",
        );
        expect(
          session.transport.snapshot.playing,
          "audio continued across the stage-mode remount",
        ).toBe(true);
        // The held finger's eventual release lands on the NEW surface — the
        // dead gesture can never commit from it.
        await app.sendTouch("touchEnd", []);
        await sleep(150);
        expect(
          bassNotes().length,
          "the rotation-remounted gesture committed nothing (no phantom note)",
        ).toBe(0);
        expect(
          previews(),
          "no stuck preview after the remount",
        ).toBe(0);
        expect(
          document.querySelectorAll("[data-cue-preview]").length,
          "no stuck rail sweep after the remount",
        ).toBe(0);
        // A fresh gesture on the NEW surface works (the surface is not wedged).
        const tabletCell = app.cell("bass", 0, 6);
        expect(tabletCell, "tablet bass cell mounted").toBeTruthy();
        const tcR = tabletCell.getBoundingClientRect();
        const tc = { x: tcR.left + tcR.width / 2, y: tcR.top + tcR.height / 2 };
        const tp = (type: string): void =>
          tabletCell.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 3,
              pointerType: "touch",
              isPrimary: true,
              bubbles: true,
              cancelable: true,
              clientX: tc.x,
              clientY: tc.y,
            }),
          );
        tp("pointerdown");
        tp("pointerup");
        await waitFor(
          () => bassNotes().length === 1,
          3000,
          "a fresh gesture works on the remounted surface",
        );

        // Focus never strands on the unmounted tree across a rotation back.
        const anyCell = app.cell("bass", 0, 2);
        anyCell.focus();
        expect(document.activeElement).toBe(anyCell);
        await page.viewport(390, 844);
        await sleep(250);
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "phone",
          3000,
          "phone after rotating back",
        );
        expect(
          (document.activeElement as Element | null)?.isConnected ?? true,
          "focus never strands on a dead node after rotation",
        ).toBe(true);
        // The lane switcher still drives selection after all the rotation.
        await app.tapEl(app.el('.lane-switch-tab[data-lane="drums"]'));
        await waitFor(
          () => app.el(".lane-floor").dataset.lane === "drums",
          3000,
          "switcher works after rotation churn",
        );
        await app.tapEl(app.el(".booth-btn-play"));
        await waitFor(() => !session.transport.snapshot.playing, 4000, "stopped");
      } finally {
        clearToasts(); // a toast left open covers the booth for the next test
        session.transport.stop();
        app.dispose();
        await restoreDb(snap);
        await page.viewport(1280, 800);
      }
    },
    180_000,
  );

  it(
    "3 · visibility at phone: audio continues + playhead resyncs; hidden + pagehide flush autosave; the recovery affordance re-offers",
    { timeout: 150_000 },
    async () => {
      const app = await mountPhoneApp(390, 844);
      const session = getSession();
      const snap = await snapshotDb();
      let visibilityRestored = false;
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        // Prior tests' teardown STOPPED that controller (the suite's restore
        // law) — this test gates the LIVE autosave paths, so re-boot
        // persistence exactly like a fresh app load (the restored row's
        // recovery toast, if any, is cleared before touching the booth).
        await getAutosaveController()?.stop();
        await initPersistence();
        clearToasts();
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "phone",
          5000,
          "phone stage",
        );

        // PLAYING first; the edit below hides in the SAME macrotask (the
        // 800 ms debounce is the discrimination floor — only the
        // visibilitychange flush path can land inside it, tooth-proven).
        await app.tapEl(app.el(".booth-btn-play"));
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "playing before the edit",
        );
        const ctx = session.engine.getContext() as unknown as AudioContext;
        const projectId = getActiveProjectId();
        const db = getBootDb();
        expect(projectId).toBeTruthy();
        expect(db).toBeTruthy();
        /** The row's persisted bass-note count (content proof for flushes). */
        const rowBassNotes = async (): Promise<number | null> => {
          const row = await db!.getRecord(projectId!);
          if (!row) return null;
          const doc = decode(row.json);
          const p = doc.patterns.bass[0];
          return p?.kind === "pitched" ? p.notes.length : null;
        };
        const rowDirty = async (): Promise<boolean | null> => {
          const row = await db!.getRecord(projectId!);
          return row ? row.dirty : null;
        };

        // --- HIDE (visibilitychange→hidden): flush + audio continuity -----
        // Edit → hide in one breath; the flush must land BEFORE the edit's
        // own debounce could fire (800 ms) carrying the EDIT'S content.
        const clockHide = ctx.currentTime;
        const loopTimeHide = session.transport.getLoopTime();
        const tHide = performance.now();
        app.cell("bass", 0, 2).click(); // the pending edit (1 note)
        setVisibility("hidden");
        visibilityRestored = true;
        await waitFor(
          async () => (await rowDirty()) === false && (await rowBassNotes()) === 1,
          750,
          "visibilitychange→hidden flushed the edit inside the debounce window",
        );
        // Audio-clock continuity "while hidden" (TH-3's law at phone): the
        // clock advanced in lockstep with wall time; the transport never
        // dropped to stopped.
        await sleep(700);
        const wall = (performance.now() - tHide) / 1000;
        expect(ctx.currentTime - clockHide).toBeGreaterThan(wall - 0.25);
        expect(ctx.currentTime - clockHide).toBeLessThan(wall + 0.5);
        expect(
          session.transport.snapshot.playing,
          "transport still playing while hidden",
        ).toBe(true);

        // --- RETURN (visible): the playhead resyncs from the clock ---
        setVisibility("visible");
        visibilityRestored = false;
        await sleep(150);
        const loopTimeNow = session.transport.getLoopTime();
        const clockNow = ctx.currentTime;
        let dl = loopTimeNow - loopTimeHide;
        while (dl < 0) dl += 2; // 1-bar loop @120bpm
        while (dl > 2) dl -= 2;
        expect(
          Math.abs(dl - ((clockNow - clockHide) % 2)),
          "playhead resynced from ctx.currentTime on return (no jump)",
        ).toBeLessThan(0.25);
        const playhead = app.el(".grid-playhead");
        await waitFor(
          () => playhead.style.opacity === "1",
          3000,
          "rendered playhead live again after return",
        );

        // --- pagehide flush (HU-3's law re-pinned at phone; the same
        // edit → event → inside-the-debounce-window discrimination) ---
        app.cell("bass", 0, 6).click(); // the second pending edit (2 notes)
        window.dispatchEvent(new Event("pagehide"));
        await waitFor(
          async () => (await rowDirty()) === false && (await rowBassNotes()) === 2,
          750,
          "pagehide flushed the edit inside the debounce window",
        );
        await app.tapEl(app.el(".booth-btn-play"));
        await waitFor(() => !session.transport.snapshot.playing, 4000, "stopped");

        // --- the recovery affordance re-offers on a dirty-row boot ---
        await getAutosaveController()?.stop();
        const dirtyName = "mb4 hidden draft";
        await saveProject(
          snap!.db,
          "mb4-recover",
          { ...docStore.getState().doc, name: dirtyName },
          { dirty: true },
        );
        const result = await initPersistence({ db: snap!.db });
        expect(result.restored).toBe(true);
        await waitFor(
          () => document.body.textContent?.includes("RECOVERED UNSAVED WORK") === true,
          4000,
          "the HU-3 recovery affordance re-offered at phone width",
        );
      } finally {
        clearToasts(); // a toast left open covers the booth for the next test
        if (visibilityRestored) setVisibility("visible");
        session.transport.stop();
        app.dispose();
        await restoreDb(snap);
        await page.viewport(1280, 800);
      }
    },
    150_000,
  );

  it(
    "4 · one-shot LOOP re-enable law at phone (R-3): auto-stop parks, LOOP+PLAY restarts, tail re-enable keeps playing",
    { timeout: 150_000 },
    async () => {
      const app = await mountPhoneApp(390, 844);
      const session = getSession();
      const snap = await snapshotDb();
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        loadDocument(createFreshProjectDocument());
        await waitFor(
          () => app.el(".app").getAttribute("data-stage") === "phone",
          5000,
          "phone stage",
        );

        const playBtn = app.el(".booth-btn-play");
        // M-4 (iteration 4): the option tools live in the collapsible
        // options drawer at phone — open it (trusted toggle tap) so the
        // LOOP law's probes can reach the loop button; play/stop stays in
        // the pinned transport row either way.
        await app.tapEl(app.el('[data-help="phone.options"]'));
        await waitFor(
          () => document.querySelector(".phone-options-drawer") !== null,
          3000,
          "options drawer open",
        );
        const loopBtn = app.el(".booth-btn-loop");
        const posLed = app.el(".booth-group-position .booth-led");

        // Loop ON (default) → play → loop OFF mid-play by trusted touch.
        expect(loopBtn.getAttribute("aria-pressed")).toBe("true");
        await app.tapEl(playBtn);
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "playing (looped)",
        );
        await app.tapEl(loopBtn);
        await waitFor(
          () => loopBtn.getAttribute("aria-pressed") === "false",
          3000,
          "LOOP off by touch",
        );
        // One-shot: the pass (1 bar @120bpm ≈ 2s) plays out, then the
        // IN-4 auto-stop: button flips PLAY, position parks at the end.
        await waitFor(
          () => !session.transport.snapshot.playing,
          8000,
          "one-shot auto-stopped at the pass end",
        );
        expect(playBtn.textContent).toBe("PLAY");
        const parked = posLed.textContent;
        expect(parked, "position parked at the pass end").not.toBe("1.1.1");

        // The critique's recovery gesture: LOOP back on, then PLAY — the
        // restart must land within the normal first-lookahead window (no
        // horizon of dead air): position leaves the parked end quickly.
        await app.tapEl(loopBtn);
        await waitFor(
          () => loopBtn.getAttribute("aria-pressed") === "true",
          3000,
          "LOOP re-enabled by touch",
        );
        await app.tapEl(playBtn);
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "playing again after LOOP+PLAY",
        );
        await waitFor(
          () => posLed.textContent !== parked,
          1500,
          "replay left the parked position inside the normal window",
        );

        // The stall window (deferred #11): LOOP re-enabled DURING the
        // exhausted tail keeps the transport playing past the pass end.
        await app.tapEl(loopBtn); // off again, mid-play
        await waitFor(
          () => loopBtn.getAttribute("aria-pressed") === "false",
          3000,
          "LOOP off for the tail case",
        );
        // Wait INTO the exhausted tail: the 1.5s horizon has covered the
        // pass end long before the audible end (~2.1s at 120bpm 1 bar).
        await sleep(1400);
        expect(session.transport.snapshot.playing).toBe(true); // still the tail
        await app.tapEl(loopBtn); // the stall moment
        await waitFor(
          () => loopBtn.getAttribute("aria-pressed") === "true",
          3000,
          "LOOP re-enabled during the tail",
        );
        // Past the pass end the transport must STILL be playing (the
        // refinement-3 law: no silent-forever-while-playing at mobile).
        await sleep(1100);
        expect(
          session.transport.snapshot.playing,
          "tail re-enable kept the transport playing past the pass end",
        ).toBe(true);
        const lt = session.transport.getLoopTime();
        expect(lt).toBeLessThan(2.2); // wrapped into the next pass
        await app.tapEl(playBtn);
        await waitFor(() => !session.transport.snapshot.playing, 4000, "stopped");
        // M-4: close the drawer before dispose — `optionsOpen` is module
        // state and would otherwise leak an OPEN drawer (backdrop and all)
        // into the next test's fresh mount.
        await app.tapEl(app.el('[data-help="phone.options"]'));
        await waitFor(
          () => document.querySelector(".phone-options-drawer") === null,
          3000,
          "options drawer closed before dispose",
        );
      } finally {
        clearToasts(); // a toast left open covers the booth for the next test
        session.transport.stop();
        app.dispose();
        await restoreDb(snap);
        await page.viewport(1280, 800);
      }
    },
    150_000,
  );

  it(
    "5 · trusted touch-cancel edge table: touchCancel rows (create-drag, rail sweep), second finger, long-press contextmenu, scroll-cancel + undo coherence",
    { timeout: 180_000 },
    async () => {
      const app = await mountPhoneApp(390, 844);
      const session = getSession();
      const snap = await snapshotDb();
      const origAudition = session.audition;
      const auditions: Array<{ lane: string }> = [];
      session.audition = (laneId, degreeOrDrum) => {
        auditions.push({ lane: laneId });
        return origAudition.call(session, laneId, degreeOrDrum);
      };
      try {
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        loadDocument(createFreshProjectDocument());
        selectLane("bass");
        await waitFor(
          () => app.el(".lane-floor").dataset.lane === "bass",
          3000,
          "bass stage",
        );

        // -- T1: touchCancel mid create-drag (browser interruption) -------
        const depth0 = historyDepth();
        const aud0 = auditions.length;
        const row1 = app.cell("bass", 1, 0).parentElement!;
        const line = app.rowLine(
          row1.getBoundingClientRect(),
          { x: 2 * 16 + 7, y: 12 },
          { x: 6 * 16 + 7, y: 12 },
          5,
        );
        await app.sendTouch("touchStart", [line[0]!]);
        for (let i = 1; i < line.length; i++) {
          await sleep(25);
          await app.sendTouch("touchMove", [line[i]!]);
        }
        await waitFor(() => previews() > 0, 2000, "create preview armed");
        const cancels = cancelCounter();
        await app.touchCancelAll();
        await waitFor(() => previews() === 0, 2000, "preview cleared by touchCancel");
        expect(
          cancels.count(),
          "a REAL pointercancel was derived from the trusted touchCancel",
        ).toBeGreaterThanOrEqual(1);
        cancels.stop();
        expect(bassNotes().length, "T1: interrupted create committed nothing").toBe(0);
        expect(historyDepth(), "T1: no history entry").toBe(depth0);
        expect(auditions.length, "T1: no auditions").toBe(aud0);

        // -- T2: touchCancel mid rail sweep --------------------------------
        // (switch to drums FIRST: at phone the rail renders only the ACTIVE
        // lane's row — the drums tiles exist only on the drums stage.)
        await app.tapEl(app.el('.lane-switch-tab[data-lane="drums"]'));
        await waitFor(
          () => app.el(".lane-floor").dataset.lane === "drums",
          3000,
          "drums stage (sweep)",
        );
        const patternB = addPattern("drums", 1, "P2");
        appendChainSlot("drums", patternB);
        appendChainSlot("drums", patternB);
        await waitFor(
          () => document.querySelectorAll(".rail-tile").length >= 3,
          3000,
          "chain slots for the sweep",
        );
        const tiles = () =>
          Array.from(document.querySelectorAll(".rail-tile")) as HTMLElement[];
        const selectionBefore = activePatterns().drums;
        const tilesBox = tiles()[0]!.parentElement!.getBoundingClientRect();
        const t0 = tiles()[0]!.getBoundingClientRect();
        const t2 = tiles()[2]!.getBoundingClientRect();
        const sweepLine = app.rowLine(
          tilesBox,
          { x: t0.left - tilesBox.left + 8, y: t0.top - tilesBox.top + 8 },
          { x: t2.right - tilesBox.left - 6, y: t2.top - tilesBox.top + 8 },
          4,
        );
        await app.sendTouch("touchStart", [sweepLine[0]!]);
        for (let i = 1; i < sweepLine.length; i++) {
          await sleep(25);
          await app.sendTouch("touchMove", [sweepLine[i]!]);
        }
        await waitFor(
          () => document.querySelectorAll("[data-cue-preview]").length > 0,
          2000,
          "sweep preview armed",
        );
        await app.touchCancelAll();
        await waitFor(
          () => document.querySelectorAll("[data-cue-preview]").length === 0,
          2000,
          "T2: no stuck sweep preview after touchCancel",
        );
        expect(
          activePatterns().drums,
          "T2: interrupted sweep committed no cue",
        ).toBe(selectionBefore);

        // -- T3: second finger mid-gesture is ignored entirely -------------
        await app.tapEl(app.el('.lane-switch-tab[data-lane="bass"]'));
        await waitFor(
          () => app.el(".lane-floor").dataset.lane === "bass",
          3000,
          "bass stage (second finger)",
        );
        const notesBefore = bassNotes().length;
        const gRow = app.cell("bass", 1, 0).parentElement!;
        const gRect = gRow.getBoundingClientRect();
        const heldPt = app.rowLine(
          gRect,
          { x: 1 * 16 + 7, y: 12 },
          { x: 1 * 16 + 7, y: 12 },
          0,
        )[0]!;
        const extraPt = app.rowLine(
          gRect,
          { x: 9 * 16 + 7, y: 12 },
          { x: 9 * 16 + 7, y: 12 },
          0,
        )[0]!;
        const movePt = app.rowLine(
          gRect,
          { x: 4 * 16 + 7, y: 12 },
          { x: 4 * 16 + 7, y: 12 },
          0,
        )[0]!;
        await app.secondFinger(heldPt, extraPt, movePt);
        await waitFor(
          () => bassNotes().length === notesBefore + 1,
          4000,
          "T3: the FIRST finger's gesture committed exactly one note",
        );
        expect(
          bassNotes().length,
          "T3: the second finger contributed nothing",
        ).toBe(notesBefore + 1);
        expect(bassNotes().some((n) => n.start === 1), "T3: committed the sweep finger's span").toBe(true);

        // -- T4: long-press contextmenu during a held touch gesture ---------
        const lpRow = app.cell("bass", 2, 0).parentElement!;
        const lpRect = lpRow.getBoundingClientRect();
        const lpPt = app.rowLine(
          lpRect,
          { x: 2 * 16 + 7, y: 12 },
          { x: 2 * 16 + 7, y: 12 },
          0,
        )[0]!;
        const lpEnd = app.rowLine(
          lpRect,
          { x: 5 * 16 + 7, y: 12 },
          { x: 5 * 16 + 7, y: 12 },
          0,
        )[0]!;
        await app.touchHoldAt(lpPt, 600); // the long-press dwell
        // The browser's long-press menu, arriving mid-gesture: suppressed.
        const menuDuring = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: lpRect.left + 40,
          clientY: lpRect.top + 12,
        });
        document.querySelector(".lane-grid-scroll")!.dispatchEvent(menuDuring);
        expect(
          menuDuring.defaultPrevented,
          "T4: long-press contextmenu suppressed mid-gesture",
        ).toBe(true);
        // The gesture then COMPLETES (drag out + release).
        await app.sendTouch("touchMove", [lpEnd]);
        await sleep(40);
        await app.sendTouch("touchEnd", []);
        await sleep(150);
        await waitFor(
          () => bassNotes().some((n) => n.start === 2),
          3000,
          "T4: the long-pressed gesture completed after the suppressed menu",
        );
        // Idle (no gesture): the native menu stays free.
        const menuIdle = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        document.querySelector(".lane-grid-scroll")!.dispatchEvent(menuIdle);
        expect(menuIdle.defaultPrevented, "T4: idle contextmenu free").toBe(false);

        // -- T5: scroll-cancel during an armed gesture (edge law) -----------
        // (a) the vertical touch swipe pointercancels the armed gesture with
        //     no commit AND no history entry (undo coherent);
        const depth5 = historyDepth();
        const notesBefore5 = bassNotes().length;
        const swCell = app.cell("bass", 3, 3);
        const swR = swCell.getBoundingClientRect();
        const down: Array<{ x: number; y: number }> = [
          app.rowLine(swR, { x: 7, y: 12 }, { x: 7, y: 12 }, 0)[0]!,
        ];
        for (let i = 1; i <= 8; i++) {
          down.push(
            app.rowLine(swR, { x: 7, y: 12 + i * 14 }, { x: 7, y: 12 + i * 14 }, 0)[0]!,
          );
        }
        const cancels5 = cancelCounter();
        await app.touch(down, 25);
        expect(
          cancels5.count(),
          "T5: the vertical swipe pointercancelled the armed gesture",
        ).toBeGreaterThanOrEqual(1);
        cancels5.stop();
        expect(
          bassNotes().length,
          "T5: the cancelled gesture committed nothing",
        ).toBe(notesBefore5);
        expect(historyDepth(), "T5: undo history untouched (coherent)").toBe(depth5);
        expect(previews(), "T5: no stuck preview").toBe(0);
        // (b) the same vertical pan still scrolls the PAGE from that cell
        //     origin (pan-y — the committed scrolling-grid law). Needs real
        //     scroll range: the ROTATED phone (844×390 — MB-2's own recipe)
        //     with the LEAD lane mounted (chrome + 14 rows exceed 390px).
        await app.tapEl(app.el('.lane-switch-tab[data-lane="lead"]'));
        await waitFor(
          () => app.el(".lane-floor").dataset.lane === "lead",
          3000,
          "lead stage (scroll range)",
        );
        await page.viewport(844, 390);
        await sleep(250);
        await waitFor(
          () => document.documentElement.scrollHeight > innerHeight,
          3000,
          "the rotated-phone document scrolls",
        );
        scrollTo(0, 0);
        await sleep(120);
        const leadCell = app.cell("lead", 2, 3);
        await app.scrollGesture(leadCell, 0, -160);
        expect(
          scrollY,
          "T5: the page still scrolls from a cell origin",
        ).toBeGreaterThan(0);
        scrollTo(0, 0);
        await page.viewport(390, 844);
      } finally {
        clearToasts(); // a toast left open covers the booth for the next test
        session.audition = origAudition;
        session.transport.stop();
        app.dispose();
        await restoreDb(snap);
        await page.viewport(1280, 800);
      }
    },
    180_000,
  );
});
