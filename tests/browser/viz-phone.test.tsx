/**
 * VZ-DD-4 browser journey — the PHONE-STAGE GATE (the committed fallback
 * form: gate + message; the production decision is recorded in the
 * production log and docs/dev/accessibility.md §8). The task's AC walked
 * end to end on the real mounted app (in-page JSX mount, the
 * viz-remote/viz-announcements precedent):
 *
 * 1. GATE FORM at 390×844 AND 360×800: opening VIZ at the phone stage
 *    mounts the GATE, not the show — the message line, the idle line while
 *    stopped, and EXIT as the surface's single control (no preset stepper,
 *    no reroll); the canvas element persists (display:none) but ZERO
 *    engine boots (no live renderer, no arrangement controller — the
 *    non-interference record: no rAF loop, no engine subscriptions over
 *    the mobile stage).
 * 2. DD-1/DD-2 LAWS UNCHANGED AT PHONE: the announcement region ships and
 *    speaks the transport- AND stage-truthful entry line; transport edges
 *    still speak (PLAYBACK STARTED / the idle line's own words — the
 *    visible line and spoken twin stay one string); entry focus lands on
 *    the gate's single control; the phone chrome + stage beneath carry
 *    `inert` with exactly ONE tab stop in the whole app (the gate EXIT).
 * 3. OPERABLE EXITS by touch AND key: the gate's EXIT click, Escape, and
 *    `v` all close through the one closeViz funnel — focus RETURNS to the
 *    booth invoker, inert lifts, and the mobile stage beneath keeps
 *    working (a lane-switcher tab still selects + announces).
 * 4. TARGET LAW (m2 / WCAG 2.5.5): the gate EXIT's hit box ≥44×44 at both
 *    widths, measured behaviorally (elementFromPoint lattice + core
 *    probes — target-size.test.tsx's own measurement law).
 * 5. AXE: the phone-gate state is clean (zero critical/serious, moderates
 *    the same triaged set) at 390 and 360.
 * 6. NO LAYOUT BREAKAGE at the tight width: the page never h-scrolls at
 *    360, the gate never overflows its own box, and everything stays
 *    inside the viewport.
 * 7. LIVE FLIPS (test 2): a desktop show shrunk to phone mid-session
 *    becomes the gate with the engine loop DEAD (module probes), the gate
 *    line SPOKEN once, focus re-seeded inside the gate; growing back
 *    re-boots the engines and CONTINUES the session envelope (a committed
 *    preset survives the round trip); the transport never stops across
 *    either flip.
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import axe from "axe-core";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { setVizMode, vizMode } from "../../src/state/vizMode";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { activeVizArrangementControllers } from "../../src/viz/arrangement";
import {
  liveVizRendererCount,
  vizRendererProbes,
} from "../../src/viz/renderer";
import {
  activeVizAnnouncers,
  VIZ_ON_PHONE_ANNOUNCEMENT,
  VIZ_ON_PHONE_IDLE_ANNOUNCEMENT,
  VIZ_PHONE_GATE_MESSAGE,
} from "../../src/viz/announcements";
import { VIZ_PRESETS } from "../../src/viz/presets";
import { VIZ_PREFS_STORAGE_KEY } from "../../src/viz/persist";
import { VIZ_IDLE_LINE } from "../../src/components/VizRemote";
// Token base exactly as deployed (the axe/viz-remote precedent): without
// it every var(--color-*) invalidates and computed-value/contrast
// assertions lie.
import "../../src/styles/base.css";

const session = getSession();

function mount(): { host: HTMLElement; cleanup: () => void } {
  // VIZ memory hygiene (the viz-remote precedent): boot the deterministic
  // default deal regardless of file order on this shared origin.
  localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      setVizMode(false);
      dispose();
      host.remove();
      localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
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

/** Dispatch a key at the FOCUSED element (flows to window capture). */
function keyAtActive(k: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * The m2 target law, behavioral (target-size.test.tsx's measurement law,
 * scoped to the gate's single control): the contiguous hit region around
 * the control's center must reach ≥44 on both axes (elementFromPoint
 * lattice, ±0.5 edge-corrected), and a 36×36 core (center ±18, clear of
 * fractional/snap boundaries) must resolve to the control at its corners
 * and cross — a neighbor encroaching, a covering overlay, or a clipped
 * box all redden here.
 */
async function auditHit44(el: Element, name: string): Promise<void> {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0)
    throw new Error(`[${name}] not rendered`);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hitBelongs = (x: number, y: number): boolean => {
    const hit = document.elementFromPoint(x, y);
    return hit === el || (hit !== null && el.contains(hit));
  };
  let left = cx;
  let right = cx;
  let top = cy;
  let bottom = cy;
  while (left > 0 && hitBelongs(left - 1, cy)) left--;
  while (right < innerWidth && hitBelongs(right + 1, cy)) right++;
  while (top > 0 && hitBelongs(cx, top - 1)) top--;
  while (bottom < innerHeight && hitBelongs(cx, bottom + 1)) bottom++;
  const hitW = Math.max(r.right, right + 0.5) - Math.min(r.left, left - 0.5);
  const hitH = Math.max(r.bottom, bottom + 0.5) - Math.min(r.top, top - 0.5);
  if (hitW < 44 || hitH < 44)
    throw new Error(
      `[${name}] hit box ${hitW.toFixed(1)}×${hitH.toFixed(1)} < 44×44`,
    );
  for (const [x, y] of [
    [cx - 18, cy - 18],
    [cx + 18, cy - 18],
    [cx - 18, cy + 18],
    [cx + 18, cy + 18],
    [cx, cy],
  ] as const) {
    if (!hitBelongs(x, y)) {
      const stolen = document.elementFromPoint(x, y);
      throw new Error(
        `[${name}] core probe (${x},${y}) resolves ${stolen ? stolen.tagName : "nothing"} — overlapped or clipped`,
      );
    }
  }
}

/** The axe gate's law (axe-a11y.test.tsx): zero critical/serious, moderates only the triaged set. */
const ACCEPTED_MODERATES = new Set<string>([
  "page-has-heading-one",
  "banner-top-level",
  "region",
]);

async function axeClean(host: HTMLElement, state: string): Promise<void> {
  const results = await axe.run(host, { resultTypes: ["violations"] });
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (blocking.length > 0) {
    const detail = blocking
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
      .join("; ");
    throw new Error(`[${state}] critical/serious axe violations: ${detail}`);
  }
  const unexpected = results.violations.filter(
    (v) =>
      v.impact !== "critical" &&
      v.impact !== "serious" &&
      !ACCEPTED_MODERATES.has(v.id),
  );
  if (unexpected.length > 0) {
    const detail = unexpected.map((v) => v.id).join(", ");
    throw new Error(`[${state}] untriaged moderates: ${detail}`);
  }
}

/** The shared project-row restore idiom (loadDocument autosaves). */
async function snapshotRows(db: ProjectDb) {
  return db.allRecords();
}
async function restoreRows(
  db: ProjectDb,
  rows: Awaited<ReturnType<typeof snapshotRows>>,
): Promise<void> {
  const ids = new Set(rows.map((r) => r.id));
  const current = await db.allRecords();
  for (const row of rows) await db.putRecord(row);
  for (const row of current) {
    if (!ids.has(row.id)) await db.deleteRecord(row.id);
  }
}

describe("VZ-DD-4 phone-stage gate (the committed fallback: gate + message)", () => {
  it(
    "390×844 + 360×800: gate renders with zero engine footprint · DD-2 laws hold · exits operable · EXIT ≥44×44 hit · axe clean · no h-scroll",
    { timeout: 180_000 },
    async () => {
      await page.viewport(390, 844);
      const { host, cleanup } = mount();
      let bootDb: ProjectDb | null = null;
      let rows: Awaited<ReturnType<typeof snapshotRows>> = [];
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        rows = await snapshotRows(bootDb);

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };

        // Deterministic content (the viz-remote precedent).
        loadDocument(createDemoProject());

        // --- the phone stage settles before anything queries it (MB-6) ---
        await waitFor(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone",
        );

        // --- ENTRY: the booth VIZ button (strap target) opens the GATE --
        const vizBtn = $<HTMLButtonElement>(".booth-btn-viz");
        expect(vizBtn, "the phone VIZ entry exists (booth toggle)").toBeTruthy();
        expect(vizMode()).toBe(false);
        vizBtn.click();
        await waitFor(
          () => host.querySelector(".viz-page") !== null,
          2_000,
          "viz page mounted",
        );

        const gate = $(".viz-remote");
        expect(
          gate.classList.contains("viz-remote-gate"),
          "the chassis takes the gate form at phone",
        ).toBe(true);
        expect(gate.getAttribute("role")).toBe("group"); // a notice + one button, not a toolbar
        expect(gate.getAttribute("aria-label")).toBe("VIZ remote");
        expect($(".viz-phone-message").textContent?.trim()).toBe(
          VIZ_PHONE_GATE_MESSAGE,
        );
        // No show controls at the gate — the show did not mount.
        expect(host.querySelector('[aria-label="Previous preset"]')).toBeNull();
        expect(host.querySelector('[aria-label="Next preset"]')).toBeNull();
        expect(host.querySelector(".viz-remote-reroll")).toBeNull();
        expect(host.querySelector(".viz-remote-name")).toBeNull();
        // The canvas element persists (ref stability) but paints nothing.
        const canvas = $(".viz-canvas");
        expect(getComputedStyle(canvas).display).toBe("none");

        // --- ZERO ENGINE FOOTPRINT (the non-interference record) --------
        expect(
          liveVizRendererCount(),
          "no renderer loop over the mobile stage",
        ).toBe(0);
        expect(activeVizArrangementControllers()).toHaveLength(0);
        // The DD-2 region ships with the page regardless of form.
        const announcers = activeVizAnnouncers();
        expect(announcers).toHaveLength(1);
        const announcer = announcers[0]!;

        // --- INERT LAW: phone chrome + stage inert; ONE tab stop --------
        expect($(".phone-chrome").inert, "phone chrome inert").toBe(true);
        expect($("main.stage").inert, "stage inert").toBe(true);
        const tabbables = [
          ...host.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
          ),
        ].filter(
          (el) =>
            el.isConnected &&
            !el.disabled &&
            !el.closest('[aria-hidden="true"]') &&
            el.getClientRects().length > 0,
        );
        const live = tabbables.filter((el) => !el.closest("[inert]"));
        for (const el of live) {
          // Documented above-surface chrome (z ≥ 60): failure affordances
          // stay reachable in ANY mode by design (keyboard.md §"VIZ page").
          if (el.closest(".support-banner, .toasts, .audio-resume")) continue;
          expect(
            el.closest(".viz-remote") !== null,
            `live tab stop outside the gate: ${el.outerHTML.slice(0, 60)}`,
          ).toBe(true);
        }
        const gateStops = live.filter((el) => el.closest(".viz-remote"));
        expect(
          gateStops.length,
          "the gate EXIT is the surface's single tab stop",
        ).toBe(1);
        const exitBtn = gateStops[0]!;
        expect(exitBtn.textContent?.trim()).toBe("EXIT");

        // --- ENTRY FOCUS: the gate's single control receives it ---------
        await waitFor(
          () => document.activeElement === exitBtn,
          2_000,
          "entry focus on the gate EXIT",
        );

        // --- ANNOUNCEMENTS (DD-2 unchanged): entry line is stage-truthful
        await waitFor(
          () => announcer.probe().last === VIZ_ON_PHONE_IDLE_ANNOUNCEMENT,
          2_000,
          "gate entry line (stopped)",
        );
        expect($(".viz-remote-idle").textContent?.trim()).toBe(VIZ_IDLE_LINE);

        // Transport edges still speak; the visible line yields to playback.
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4_000,
          "transport playing",
        );
        await waitFor(
          () => host.querySelector(".viz-remote-idle") === null,
          2_000,
          "idle line yields to playback",
        );
        expect(announcer.probe().last).toBe("PLAYBACK STARTED");
        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          4_000,
          "transport stopped",
        );
        await waitFor(
          () =>
            $(".viz-remote-idle").textContent?.trim() === VIZ_IDLE_LINE,
          2_000,
          "idle line returns",
        );
        expect(
          announcer.probe().last,
          "the spoken twin is the idle line's own words",
        ).toBe(VIZ_IDLE_LINE);

        // --- TARGET LAW: the gate EXIT's hit box ≥44×44 (m2 law) --------
        await auditHit44(exitBtn, "gate EXIT 390");

        // --- AXE: the phone-gate state is clean --------------------------
        await axeClean(host, "viz phone gate 390×844");

        // --- OPERABLE EXITS — the touch path first -----------------------
        exitBtn.click();
        await waitFor(() => vizMode() === false, 2_000, "gate EXIT closes");
        await waitFor(
          () => document.activeElement === vizBtn,
          2_000,
          "EXIT returns focus to the booth invoker",
        );
        expect($(".phone-chrome").inert, "inert lifted on close").toBe(false);

        // The mobile stage beneath keeps working (non-interference, live).
        ($('.lane-switch-tab[data-lane="bass"]') as HTMLElement).click();
        await waitFor(
          () =>
            $(".stage-status").textContent?.trim() === "NOW EDITING BASS",
          2_000,
          "lane switcher still selects + announces after a gate visit",
        );

        // The Escape twin (the DD-1 funnel, unchanged at phone).
        vizBtn.click();
        await waitFor(() => vizMode() === true, 2_000, "viz on (button)");
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2_000, "viz off (Escape)");
        await waitFor(
          () => document.activeElement === vizBtn,
          2_000,
          "Escape returns focus to the invoker",
        );

        // The `v` twin.
        keyAtActive("v");
        await waitFor(() => vizMode() === true, 2_000, "viz on (`v`)");
        keyAtActive("v");
        await waitFor(() => vizMode() === false, 2_000, "viz off (`v`)");

        // --- 360×800 — the tight width -----------------------------------
        await page.viewport(360, 800);
        await waitFor(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone at 360",
        );
        vizBtn.click();
        await waitFor(() => vizMode() === true, 2_000, "viz on at 360");
        const gate360 = $(".viz-remote");
        expect(gate360.classList.contains("viz-remote-gate")).toBe(true);
        expect(
          document.documentElement.scrollWidth,
          "the page never h-scrolls at the tight width",
        ).toBeLessThanOrEqual(360);
        // The gate never overflows its own box (everything wraps).
        expect(gate360.scrollWidth).toBeLessThanOrEqual(
          gate360.clientWidth + 1,
        );
        // Fully inside the viewport (no clipped message).
        const g3 = gate360.getBoundingClientRect();
        expect(g3.left).toBeGreaterThanOrEqual(-0.5);
        expect(g3.right).toBeLessThanOrEqual(360.5);
        expect(g3.top).toBeGreaterThanOrEqual(-0.5);
        expect(g3.bottom).toBeLessThanOrEqual(800.5);
        const exit360 = $<HTMLButtonElement>(
          ".viz-remote-gate .viz-remote-btn",
        );
        await auditHit44(exit360, "gate EXIT 360");
        await axeClean(host, "viz phone gate 360×800");

        // --- ENTRY WHILE PLAYING + TRANSPORT ISOLATION across a visit ---
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4_000,
          "transport playing under the gate",
        );
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2_000, "viz off");
        expect(
          session.transport.snapshot.playing,
          "closing the gate never stops playback",
        ).toBe(true);
        vizBtn.click();
        await waitFor(() => vizMode() === true, 2_000, "viz on while playing");
        await waitFor(
          // The registry, read FRESH: each mount owns a new announcer (the
          // captured one died with the previous page).
          () =>
            activeVizAnnouncers()[0]?.probe().last ===
            VIZ_ON_PHONE_ANNOUNCEMENT,
          2_000,
          "gate entry line (playing) — the isolation fact still spoken",
        );
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2_000, "viz off (final)");
        await session.togglePlay();
        await waitFor(
          () => !session.transport.snapshot.playing,
          4_000,
          "transport stopped (teardown hygiene)",
        );
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        await page.viewport(1280, 800); // leave the tester viewport as configured
        try {
          await getAutosaveController()?.stop();
          if (bootDb) await restoreRows(bootDb, rows);
        } catch {
          /* best-effort restore */
        }
      }
    },
  );

  it(
    "live flips: desktop show → phone gate (loop dead, gate spoken, focus re-seeded) → desktop again (engines re-boot, session envelope continues); transport never stops",
    { timeout: 180_000 },
    async () => {
      // MB-6 lesson: settle the stage BEFORE mounting (no matchMedia flip in flight).
      await page.viewport(1280, 800);
      await new Promise((r) => setTimeout(r, 100));
      const { host, cleanup } = mount();
      let bootDb: ProjectDb | null = null;
      let rows: Awaited<ReturnType<typeof snapshotRows>> = [];
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        rows = await snapshotRows(bootDb);

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        loadDocument(createDemoProject());
        await waitFor(
          () => $(".app").getAttribute("data-stage") === "desktop",
          5_000,
          "data-stage=desktop",
        );

        // --- the DESKTOP show, on and running ---------------------------
        const vizBtn = $<HTMLButtonElement>(".booth-btn-viz");
        vizBtn.click();
        await waitFor(() => vizMode() === true, 2_000, "viz on (desktop)");
        const remote = $(".viz-remote");
        expect(remote.getAttribute("role")).toBe("toolbar");
        expect(remote.classList.contains("viz-remote-gate")).toBe(false);
        await waitFor(
          () => liveVizRendererCount() === 1,
          2_000,
          "desktop renderer live",
        );
        let frames = vizRendererProbes()[0]!.frames;
        await waitFor(
          () => vizRendererProbes()[0]!.frames > frames + 3,
          4_000,
          "desktop loop draws",
        );
        // A committed deal the gate round trip must SURVIVE (the
        // session-continuation law — re-boots continue, never rewind).
        const next = $<HTMLButtonElement>('[aria-label="Next preset"]');
        next.click();
        await waitFor(
          () =>
            $(".viz-remote-name").textContent?.trim() ===
            VIZ_PRESETS[1]!.name,
          2_000,
          "preset cycled on the desktop remote",
        );
        await session.togglePlay();
        await waitFor(
          () => session.transport.snapshot.playing,
          4_000,
          "transport playing",
        );

        // --- FLIP TO PHONE: the gate takes over, the loop dies ----------
        await page.viewport(390, 844);
        await waitFor(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "data-stage=phone after shrink",
        );
        await waitFor(
          () =>
            host.querySelector(".viz-remote")?.classList.contains(
              "viz-remote-gate",
            ) === true,
          2_000,
          "gate form after shrink",
        );
        expect(vizMode(), "the surface never closed").toBe(true);
        expect(liveVizRendererCount(), "the engine loop died with the flip").toBe(0);
        expect(activeVizArrangementControllers()).toHaveLength(0);
        const announcer = activeVizAnnouncers()[0]!;
        await waitFor(
          () => announcer.probe().last === VIZ_PHONE_GATE_MESSAGE,
          2_000,
          "the flip speaks the gate line once",
        );
        const gateExit = $<HTMLButtonElement>(
          ".viz-remote-gate .viz-remote-btn",
        );
        await waitFor(
          () => document.activeElement === gateExit,
          2_000,
          "focus re-seeded inside the gate",
        );

        // --- FLIP BACK TO WIDE: engines re-boot, session continues -------
        await page.viewport(1280, 800);
        await waitFor(
          () => $(".app").getAttribute("data-stage") === "desktop",
          5_000,
          "data-stage=desktop after grow",
        );
        await waitFor(
          () => liveVizRendererCount() === 1,
          2_000,
          "renderer re-booted",
        );
        frames = vizRendererProbes()[0]!.frames;
        await waitFor(
          () => vizRendererProbes()[0]!.frames > frames + 3,
          4_000,
          "re-booted loop draws",
        );
        const controller = activeVizArrangementControllers()[0]!;
        expect(
          controller.probe().presetId,
          "the committed deal survived the gate round trip",
        ).toBe(VIZ_PRESETS[1]!.id);
        expect(
          $(".viz-remote-name").textContent?.trim(),
          "the readout still names the committed preset",
        ).toBe(VIZ_PRESETS[1]!.name);
        expect(
          getComputedStyle($(".viz-canvas")).display,
          "the canvas paints again",
        ).not.toBe("none");
        expect(
          session.transport.snapshot.playing,
          "the transport never stopped across either flip",
        ).toBe(true);

        // Exit cleanly at the wide stage.
        keyAtActive("Escape");
        await waitFor(() => vizMode() === false, 2_000, "viz off");
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        await page.viewport(1280, 800);
        try {
          await getAutosaveController()?.stop();
          if (bootDb) await restoreRows(bootDb, rows);
        } catch {
          /* best-effort restore */
        }
      }
    },
  );
});
