/**
 * VZ-IM-2 browser gate — the VIZ page mount + open signal on the REAL
 * mounted app (in-page JSX mount, the drag-cue/help-mode harness — the plan
 * names viz-mount.test.ts; the file is .tsx to JSX-mount <App/>, the
 * recorded IN-2 precedent):
 *
 * 1. ZERO-COST OFF (HP-1 clause, VZ-IM-2 AC): viz closed = NO viz surface
 *    mounted (no .viz-page), app root data-viz-mode="off", booth VIZ lamp
 *    unlit — and no leaked Escape swallow: help mode's Escape still works
 *    with VIZ closed (a leaked capture handler would stopImmediatePropagation
 *    it away), before AND after an open→close cycle.
 * 2. TOGGLE: the booth VIZ button (INFO-? row precedent) flips the signal
 *    both ways — mounted exactly once, aria-pressed tracks, the app root
 *    attribute tracks, the page is full-bleed over the viewport on the
 *    token ground.
 * 3. ESCAPE exits (the exit key binding + entry key are VZ-DD-1's — the
 *    `v` entry key and the finalized order are pinned in
 *    viz-remote.test.tsx; this gate keeps the mount-law core).
 * 4. ESCAPE ORDER (FINALIZED by VZ-DD-1): the KEYS modal wins first
 *    (Escape closes the modal, VIZ stays); help mode wins next
 *    (cancel-first — Escape #1 exits help, #2 exits VIZ); the surface
 *    peels before every stage-level consumer.
 * 5. TRANSPORT ISOLATION (plan Preamble 8): with the transport PLAYING
 *    (demo song, loop on), open → Escape-close across audible time: the
 *    snapshot stays unchanged (playing/bpm/swing/loop), the position keeps
 *    advancing under the overlay, the booth still reads STOP — opening or
 *    closing VIZ never stops or alters playback.
 *
 * VZ-IM-4 second block — the CANVAS SKELETON gate (a real browser is the
 * honest gate for DPR/resize behavior; the pure math is the unit suite
 * tests/viz-renderer-lifecycle.test.ts): DPR-capped integer backing store
 * (min(dpr, VIZ_DPR_CAP = 2) via emulated devicePixelRatio 2/3/1 at the
 * committed 768/1440 widths; 390 is the PHONE stage = the VZ-DD-4 GATE —
 * no renderer there, gated by viz-phone.test.tsx), ResizeObserver →
 * rAF-coalesced swaps (exactly
 * one per integer change, none while settled), the opaque token ground
 * (center pixel = tokens.css --color-ground), pause-on-hidden via SYNTHETIC
 * visibilitychange (honesty caveat: real rAF parking is human-verified,
 * §0.7), zero DOM mutations from the running loop (canvas writes only),
 * and teardown leaving ZERO live rAF/observers (module probes) + a clean
 * remount.
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { formatPosition } from "../../src/engine/mappings";
import { closeHelp, helpOpen, openHelp } from "../../src/state/helpOverlay";
import { setHelpMode } from "../../src/state/helpMode";
import { setVizMode, vizMode } from "../../src/state/vizMode";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import {
  liveVizRendererCount,
  vizRendererProbes,
} from "../../src/viz/renderer";
import { activeVizArrangementControllers } from "../../src/viz/arrangement";
import { activeVizPipelines } from "../../src/viz/pipeline";
import { activeVizNodeEngines } from "../../src/viz/nodes";
import { activeVizPhaseControllers } from "../../src/viz/phases";
import { activeVizActivitySummarizers } from "../../src/viz/textEquivalence";
import { activeVizAnnouncers } from "../../src/viz/announcements";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
// DA-3 precedent (axe/axe-adjacent gates): App imports component CSS but
// NOT the token sheet — main.tsx owns it in the real bundle. Without tokens
// every var(--color-*) invalidates at computed-value time, so load the
// token base exactly as deployed before asserting computed ground.
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VZ-IM-3 memory hygiene: VizPage reads the viz memory key at mount —
  // clear it so every mount here boots the deterministic default deal,
  // regardless of what an earlier file on this shared origin persisted.
  localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      setVizMode(false);
      setHelpMode(false);
      closeHelp();
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

/**
 * Dispatch a key at the FOCUSED element (never at window): a real keystroke
 * targets the focused control and flows capture (window) → target → bubble,
 * so window-capture handlers (VizPage/InfoView) and container handlers
 * (HelpOverlay's panel) see it exactly as deployed.
 */
function keyAtActive(k: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Distinct formatted positions observed over a wall-clock window. */
async function collectPositions(ms: number): Promise<Set<string>> {
  const seen = new Set<string>();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    seen.add(formatPosition(session.transport.getPosition()));
    await new Promise((r) => setTimeout(r, 60));
  }
  return seen;
}

/** The live renderer's inert probe (exactly one while the page is open). */
function probe(): ReturnType<typeof vizRendererProbes>[number] {
  const p = vizRendererProbes()[0];
  if (!p) throw new Error("no live viz renderer");
  return p;
}

/** Emulate a devicePixelRatio reading (restored by deleting the own prop). */
function emulateDpr(value: number): void {
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value,
  });
}

function restoreDpr(): void {
  delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio;
}

describe("VZ-IM-2 VIZ page mount + open signal", () => {
  it(
    "closed = zero viz DOM · booth toggle + Escape flip the signal · placeholder escape order · transport never stops across open/close",
    { timeout: 90_000 },
    async () => {
      const { host, cleanup } = mount();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const vizBtn = (): HTMLButtonElement =>
          $<HTMLButtonElement>(".booth-btn-viz");

        // --- 1. ZERO-COST OFF ------------------------------------------
        expect(vizMode()).toBe(false);
        expect(host.querySelector(".viz-page")).toBeNull();
        expect($(".app").getAttribute("data-viz-mode")).toBe("off");
        expect(vizBtn().textContent?.trim()).toBe("VIZ");
        expect(vizBtn().getAttribute("aria-pressed")).toBe("false");
        // No leaked Escape swallow while closed: help mode's own capture
        // exit still receives the keystroke (a leaked viz handler's
        // stopImmediatePropagation would eat it).
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        keyAtActive("Escape");
        await waitFor(() => host.querySelector(".info-view") === null);
        expect(vizMode()).toBe(false);

        // --- 2. TOGGLE: booth button mounts the page -------------------
        vizBtn().click();
        await waitFor(() => vizMode() === true, 2000, "viz on (button)");
        expect(host.querySelectorAll(".viz-page").length).toBe(1);
        expect(vizBtn().getAttribute("aria-pressed")).toBe("true");
        expect($(".app").getAttribute("data-viz-mode")).toBe("on");
        // Full-bleed over the viewport, on the token ground.
        const page = $(".viz-page") as HTMLElement;
        const rect = page.getBoundingClientRect();
        expect(rect.left).toBe(0);
        expect(rect.top).toBe(0);
        expect(Math.round(rect.width)).toBe(window.innerWidth);
        expect(Math.round(rect.height)).toBe(window.innerHeight);
        expect(getComputedStyle(page).backgroundColor).toBe("rgb(17, 16, 20)");
        // The full-bleed page COVERS the booth: the topmost element at the
        // VIZ button's center is the page itself (the remote chrome sits
        // bottom-center — VZ-DD-1 — and exits carry the focus return).
        const btnRect = vizBtn().getBoundingClientRect();
        const topEl = document.elementFromPoint(
          btnRect.left + btnRect.width / 2,
          btnRect.top + btnRect.height / 2,
        );
        expect(topEl?.closest(".viz-page")).toBeTruthy();

        // --- 3. ESCAPE exits -------------------------------------------
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2000, "viz off (Escape)");
        expect(host.querySelector(".viz-page")).toBeNull();
        expect($(".app").getAttribute("data-viz-mode")).toBe("off");
        expect(vizBtn().getAttribute("aria-pressed")).toBe("false");
        // The leak probe again AFTER a cycle: unmount cleaned its listener.
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        keyAtActive("Escape");
        await waitFor(() => host.querySelector(".info-view") === null);
        expect(vizMode()).toBe(false);

        // --- 4. ESCAPE ORDER (FINALIZED by VZ-DD-1) ----------------------
        setVizMode(true);
        await waitFor(() => host.querySelector(".viz-page") !== null);
        // KEYS modal wins: its Escape closes the modal, VIZ stays on.
        openHelp($<HTMLElement>(".booth-btn-help"));
        await waitFor(() => helpOpen() === true, 2000, "keys modal open");
        await waitFor(
          () => document.activeElement?.classList.contains("help-panel"),
          2000,
          "modal focus",
        );
        keyAtActive("Escape");
        await waitFor(() => helpOpen() === false, 2000, "keys modal closed");
        expect(vizMode(), "modal wins the first Escape").toBe(true);
        // Help mode wins next (cancel-first): Escape #1 exits help, VIZ
        // stays; Escape #2 exits VIZ.
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        keyAtActive("Escape");
        await waitFor(() => host.querySelector(".info-view") === null);
        expect(vizMode(), "help exits before viz").toBe(true);
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2000, "viz off (2nd Esc)");
        expect(host.querySelector(".viz-page")).toBeNull();

        // --- 5. TRANSPORT ISOLATION ------------------------------------
        loadDocument(createDemoProject());
        session.setLoop(true); // looping demo — playback never auto-stops
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );
        const snapBefore = { ...session.transport.snapshot };
        expect(snapBefore.playing).toBe(true);

        // Open WHILE PLAYING: the transport keeps running under the page.
        vizBtn().click();
        await waitFor(() => host.querySelector(".viz-page") !== null);
        const whileOpen = await collectPositions(900);
        expect(
          whileOpen.size,
          "position advanced under the open viz page",
        ).toBeGreaterThan(1);
        expect(session.transport.snapshot).toEqual(snapBefore);
        expect($(".booth-btn-play").textContent?.trim()).toBe("STOP");

        // Close WHILE PLAYING: still running, snapshot unchanged.
        keyAtActive("Escape");
        await waitFor(() => host.querySelector(".viz-page") === null);
        const afterClose = await collectPositions(900);
        expect(
          afterClose.size,
          "position advanced after closing",
        ).toBeGreaterThan(1);
        expect(session.transport.snapshot).toEqual(snapBefore);
        expect($(".booth-btn-play").textContent?.trim()).toBe("STOP");
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        // Restore the shared-origin project rows (loadDocument autosaves;
        // the help-mode teardown precedent).
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
          /* best-effort restore */
        }
      }
    },
  );

  it(
    "VZ-IM-4 canvas skeleton — DPR-capped integer backing store across widths, coalesced resize, pause-on-hidden, teardown leaves zero live rAF/observers, token ground, zero DOM mutations from the loop",
    { timeout: 120_000 },
    async () => {
      // The renderer's DPR law runs against REAL devicePixelRatio readings:
      // headless Chromium reports 1, so emulate 2/3/1 (own-property shadow,
      // restored in finally) to exercise the cap law end-to-end in a real
      // browser with a real ResizeObserver and a real rAF loop.
      emulateDpr(2);
      const { host, cleanup } = mount();
      try {
        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const vizBtn = (): HTMLButtonElement =>
          $<HTMLButtonElement>(".booth-btn-viz");

        // --- 1. MOUNT: canvas + running renderer at the emulated DPR -----
        expect(liveVizRendererCount()).toBe(0);
        vizBtn().click();
        await waitFor(() => host.querySelector(".viz-page") !== null);
        const canvas = $<HTMLCanvasElement>(".viz-canvas");
        // Decorative canvas: aria-hidden (a11y rides the DOM chrome, DD-1/2).
        expect(canvas.getAttribute("aria-hidden")).toBe("true");
        // Full-bleed inside the page (CSS box = page box).
        await waitFor(
          () =>
            Math.round(canvas.getBoundingClientRect().width) ===
            Math.round($(".viz-page").getBoundingClientRect().width),
          4000,
          "canvas full-bleed",
        );
        // Backing store = round(css × min(dpr, CAP)) — dpr 2 → ×2.
        await waitFor(
          () =>
            canvas.width ===
              Math.round(canvas.getBoundingClientRect().width * 2) &&
            canvas.height ===
              Math.round(canvas.getBoundingClientRect().height * 2),
          4000,
          "dpr-2 integer backing store",
        );
        expect(liveVizRendererCount()).toBe(1);
        expect(probe().state).toBe("running");
        expect(probe().dpr).toBe(2);
        expect(probe().backing.width).toBe(canvas.width);

        // The loop runs: frames advance. (The pixel probe below must wait
        // for this — the initial backing sizing is synchronous at start(),
        // so the canvas paints its first frame only at the first rAF.)
        const frames0 = probe().frames;
        await waitFor(() => probe().frames > frames0 + 3, 4000, "frames run");

        // Opaque token ground: the center pixel IS tokens.css --color-ground
        // (#111014 → 17,16,20 — the i-series ground token) — the {alpha:false} canvas's one-fillRect
        // clear paints it every frame.
        const ctx2d = canvas.getContext("2d");
        expect(ctx2d).toBeTruthy();
        const px = ctx2d!.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;
        expect([px[0], px[1], px[2]]).toEqual([17, 16, 20]);
        expect(px[3]).toBe(255); // opaque

        // --- 2. DPR 3 (OVER CAP) at 768×900: cap holds ------------------
        // (VZ-DD-4: 390 — the original narrow pin — is the PHONE stage,
        // where the committed fallback is the GATE and no renderer exists;
        // the phone-gate zero-engine law is viz-phone.test.tsx's own gate.
        // 768 is the narrowest WIDE stage the full show runs at.)
        emulateDpr(3);
        await page.viewport(768, 900);
        await waitFor(() => window.innerWidth === 768, 4000, "768 viewport");
        await waitFor(
          () =>
            canvas.width ===
              Math.round(canvas.getBoundingClientRect().width * 2) &&
            canvas.height ===
              Math.round(canvas.getBoundingClientRect().height * 2),
          4000,
          "768 backing store still ×2 (capped)",
        );
        expect(probe().dpr).toBe(2); // the cap, not the raw 3
        // The swap happened via the RO → dirty-flag → frame-head path.
        expect(probe().resizes).toBeGreaterThanOrEqual(2);

        // --- 3. DPR 1 at 800×900: backing follows the lower DPR ----------
        // (A real width change too — the RO → swap path keys on element-box
        // changes, so a DPR-only drop at an unchanged width would never
        // fire it; the original test changed width between DPR steps.)
        emulateDpr(1);
        await page.viewport(800, 900);
        await waitFor(() => window.innerWidth === 800, 4000, "800 viewport");
        await waitFor(
          () =>
            canvas.width ===
              Math.round(canvas.getBoundingClientRect().width * 1) &&
            canvas.height ===
              Math.round(canvas.getBoundingClientRect().height * 1),
          4000,
          "800 backing store ×1 (dpr follows down)",
        );
        expect(probe().dpr).toBe(1);

        // --- 3b. 1440×900 at dpr 2: the third committed width -----------
        emulateDpr(2);
        await page.viewport(1440, 900);
        await waitFor(() => window.innerWidth === 1440, 4000, "1440 viewport");
        await waitFor(
          () =>
            canvas.width ===
              Math.round(canvas.getBoundingClientRect().width * 2) &&
            canvas.height ===
              Math.round(canvas.getBoundingClientRect().height * 2),
          4000,
          "1440 backing store ×2",
        );
        expect(probe().dpr).toBe(2);

        // --- 4. COALESCED: at a SETTLED size, zero further swaps --------
        // (Stage transitions may legitimately deliver transient integer
        // sizes — the law pinned here is no per-frame reallocation churn
        // once the size is steady; exact swap counts are the unit suite's
        // backingSizeChanged table, not this count.)
        await new Promise((r) => setTimeout(r, 150));
        const swapsSettled = probe().resizes;
        const framesA = probe().frames;
        await waitFor(
          () => probe().frames > framesA + 20,
          8000,
          "20 frames at settled size",
        );
        expect(probe().resizes).toBe(swapsSettled); // ZERO swaps while settled

        // --- 5. rAF law: the loop mutates NO DOM (canvas writes only) ---
        let domMutations = 0;
        const observer = new MutationObserver(() => {
          domMutations++;
        });
        observer.observe($(".viz-page"), {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        const framesB = probe().frames;
        await waitFor(() => probe().frames > framesB + 10, 8000, "10 frames");
        observer.disconnect();
        expect(domMutations).toBe(0);

        // --- 6. SYNTHETIC visibilitychange parks / resumes the loop -----
        // HONESTY CAVEAT (§0.7): a synthetic hidden flag parks THIS
        // renderer's own rAF (the law's mechanism); real browser-level rAF
        // parking in a genuinely hidden tab is human-session verified.
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(probe().state).toBe("parked");
        const frozen = probe().frames;
        await new Promise((r) => setTimeout(r, 250));
        expect(probe().frames).toBe(frozen); // zero frames while parked
        delete (document as unknown as { hidden?: boolean }).hidden;
        document.dispatchEvent(new Event("visibilitychange"));
        expect(probe().state).toBe("running");
        await waitFor(() => probe().frames > frozen, 4000, "resume advances");

        // --- 7. TEARDOWN: unmount leaves zero live rAF/observers --------
        const beforeClose = probe().frames;
        keyAtActive("Escape");
        await waitFor(() => host.querySelector(".viz-page") === null);
        expect(liveVizRendererCount()).toBe(0);
        expect(vizRendererProbes()).toEqual([]);
        await new Promise((r) => setTimeout(r, 250));
        expect(liveVizRendererCount()).toBe(0); // no zombie re-arm

        // --- 8. REMOUNT: a fresh renderer runs on the SAME laws ---------
        vizBtn().click();
        await waitFor(() => host.querySelector(".viz-page") !== null);
        expect(liveVizRendererCount()).toBe(1);
        const canvas2 = $<HTMLCanvasElement>(".viz-canvas");
        await waitFor(
          () =>
            canvas2.width > 0 &&
            vizRendererProbes()[0]!.frames > 0 &&
            vizRendererProbes()[0]!.frames < beforeClose + 1000,
          4000,
          "fresh renderer draws",
        );
        expect(vizRendererProbes()[0]!.state).toBe("running");
      } finally {
        restoreDpr();
        delete (document as unknown as { hidden?: boolean }).hidden;
        setVizMode(false);
        await page.viewport(1280, 800); // leave the tester viewport configured
        cleanup();
      }
    },
  );

  // VZ-HU-1 — the CONSOLIDATED resilience gate: rapid open/close cycles
  // leave nothing behind, a thrown draw is CONTAINED (loop parks into
  // `error`, the ONE DOM error line appears, nothing reaches window, EXIT
  // stays functional), and every exit path leaves ALL seven registries
  // empty — the full teardown invariant in one place (the distributed
  // per-module gates stay; this is the cross-module pin).
  it(
    "VZ-HU-1 — rapid cycles stay clean; a thrown draw parks contained (error line, zero window faults, EXIT functional); every exit empties ALL registries",
    { timeout: 120_000 },
    async () => {
      const { host, cleanup } = mount();
      // Patched in the journey below; restored in finally (prototype
      // patch FILTERED to the viz canvas's own context so the grid
      // renderer beneath keeps drawing).
      const proto = CanvasRenderingContext2D.prototype;
      const origFillRect = proto.fillRect;
      let vizCtx: CanvasRenderingContext2D | null = null;
      let throwOnVizFill = false;
      let uncaught = 0;
      const onWindowError = (): void => {
        uncaught++;
      };
      const allRegistriesEmpty = (): boolean =>
        liveVizRendererCount() === 0 &&
        activeVizArrangementControllers().length === 0 &&
        activeVizPipelines().length === 0 &&
        activeVizNodeEngines().length === 0 &&
        activeVizPhaseControllers().length === 0 &&
        activeVizActivitySummarizers().length === 0 &&
        activeVizAnnouncers().length === 0;
      try {
        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const vizBtn = (): HTMLButtonElement =>
          $<HTMLButtonElement>(".booth-btn-viz");

        // --- 1. RAPID OPEN/CLOSE CYCLES: no accumulation, no leaks ------
        expect(allRegistriesEmpty()).toBe(true);
        for (let i = 0; i < 3; i++) {
          vizBtn().click();
          await waitFor(() => host.querySelector(".viz-page") !== null);
          keyAtActive("Escape");
          await waitFor(() => host.querySelector(".viz-page") === null);
        }
        // A fourth open boots EXACTLY ONE of everything.
        vizBtn().click();
        await waitFor(() => host.querySelector(".viz-page") !== null);
        await waitFor(() => probe().state === "running", 4000, "running");
        expect(liveVizRendererCount()).toBe(1);
        expect(activeVizArrangementControllers().length).toBe(1);
        expect(activeVizPipelines().length).toBe(1);
        expect(activeVizNodeEngines().length).toBe(1);
        expect(activeVizPhaseControllers().length).toBe(1);
        expect(activeVizActivitySummarizers().length).toBe(1);
        expect(activeVizAnnouncers().length).toBe(1);

        // --- 2. THE THROWN DRAW: contained, surfaced, never propagated --
        window.addEventListener("error", onWindowError);
        vizCtx = $<HTMLCanvasElement>(".viz-canvas").getContext("2d");
        expect(vizCtx).toBeTruthy();
        throwOnVizFill = true;
        proto.fillRect = function (
          this: CanvasRenderingContext2D,
          ...args: Parameters<typeof origFillRect>
        ): ReturnType<typeof origFillRect> {
          if (throwOnVizFill && this === vizCtx) {
            throw new Error("synthetic draw fault");
          }
          return origFillRect.apply(this, args);
        };
        await waitFor(
          () => probe().state === "error",
          8000,
          "faulted loop parks into error",
        );
        // The loop is FROZEN (parked), the ONE error line is surfaced...
        const frozen = probe().frames;
        const line = $<HTMLElement>(".viz-error");
        await waitFor(
          () => (line.textContent ?? "").length > 0,
          4000,
          "DOM error line",
        );
        expect(line.textContent).toContain("EXIT still works");
        await new Promise((r) => setTimeout(r, 250));
        expect(probe().frames).toBe(frozen); // zero frames while faulted
        // ...and NOTHING reached the window (containment, not crash):
        // only the viz canvas's own fill was throwing, and the renderer's
        // boundary swallowed it before the rAF callback returned.
        expect(uncaught).toBe(0);

        // Visibility flips never resume a faulted loop.
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(probe().state).toBe("error");
        delete (document as unknown as { hidden?: boolean }).hidden;
        document.dispatchEvent(new Event("visibilitychange"));
        expect(probe().state).toBe("error");
        expect(uncaught).toBe(0);

        // --- 3. EXIT STAYS FUNCTIONAL PAST THE FAULT ---------------------
        // Un-patch first so the post-close world (and any reopened show)
        // draws normally — the fault was the journey, not the residue.
        throwOnVizFill = false;
        keyAtActive("Escape");
        await waitFor(() => host.querySelector(".viz-page") === null);
        // THE invariant: every registry empty, and STAYS empty (no zombie
        // re-arm, no late pending timer firing into a dead page).
        expect(allRegistriesEmpty()).toBe(true);
        await new Promise((r) => setTimeout(r, 300));
        expect(allRegistriesEmpty()).toBe(true);
        expect(uncaught).toBe(0);

        // --- 4. REOPEN AFTER A FAULTED SESSION: clean re-boot ------------
        vizBtn().click();
        await waitFor(() => host.querySelector(".viz-page") !== null);
        await waitFor(() => probe().state === "running", 4000, "re-boot");
        const fresh = probe().frames;
        await waitFor(() => probe().frames > fresh, 4000, "fresh frames");
        expect(uncaught).toBe(0);
      } finally {
        window.removeEventListener("error", onWindowError);
        proto.fillRect = origFillRect;
        delete (document as unknown as { hidden?: boolean }).hidden;
        setVizMode(false);
        cleanup();
      }
    },
  );
});
