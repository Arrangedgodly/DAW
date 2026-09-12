/**
 * DA-2 axe gate: run axe-core against the REAL mounted app in four states —
 * (1) the main screen as booted, (2) the booth scale popover open, (3) the
 * keyboard-shortcut help overlay open, (4) HP-1's help mode ON (the info
 * view mounted, E6's fourth state) — and assert ZERO critical/serious
 * violations.
 *
 * Moderates are triaged below: the accepted findings are documented in
 * docs/dev/accessibility.md and asserted BY ID so a new moderate can never
 * slip in silently (an unexpected moderate fails the test).
 *
 * Note: this is a devDependency consumed only by tests — the shipped bundle
 * never includes axe (zero-network / bundle gates unaffected).
 */

import { describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "solid-js/web";
import axe from "axe-core";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import { closeHelp, openHelp } from "../../src/state/helpOverlay";
import { setHelpMode } from "../../src/state/helpMode";
import { setVizMode } from "../../src/state/vizMode";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { activeCompositionEngines } from "../../src/viz/compositionEngine";


// DA-3 fix: App imports app.css/grid.css but NOT the token sheet (that is
// main.tsx's job in the real bundle). Without tokens every var(--color-*)
// background resolves to nothing, axe falls back to a white page, and light
// ink text (e.g. the empty-project .stage-hint) is measured against white
// and falsely flagged. Load the token base so contrast pairs are computed
// from the REAL rendered palette, exactly as deployed.
import "../../src/styles/base.css";

const session = getSession();

/** Browser-level preference emulation (CDP; restored in finally — the
 * viz-reduced-motion precedent, the same mechanism Playwright drives). */
async function emulateReducedMotion(
  value: "reduce" | "no-preference",
): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
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
 * MB-6 stabilization (the pre-existing transient this file inherited —
 * flakes ~4/5 under load at the parent, green in isolation; the MB-3
 * verifier filed it, state.md/production-log.md assign it to MB-6): the
 * popover tests follow the phone-stage test, whose teardown restores the
 * 1280×800 viewport. The STAGE-MODE flip is matchMedia-driven and lands
 * asynchronously — under load the swap can process AFTER the next test has
 * mounted and clicked, opening the popover inside the phone-branch Booth
 * that the branch swap then DESTROYS (the fresh desktop Booth mounts with
 * the popover closed → `.scale-pop` is null ~300 ms later → "expected null
 * to be truthy"). Determinism, not assertion change: settle the app on the
 * DESKTOP stage (the harness default this test always ran at) before the
 * click, and wait for the popover to mount instead of a fixed sleep. The
 * axe assertion set is byte-identical.
 */
async function settleDesktopStage(host: HTMLElement): Promise<void> {
  await page.viewport(1280, 800);
  await waitFor(
    () => host.querySelector(".app")?.getAttribute("data-stage") === "desktop",
    4000,
    "desktop stage settled (no matchMedia flip in flight)",
  );
  // Let the swap's DOM land before anything queries it.
  await new Promise((r) => setTimeout(r, 50));
}

/** Moderates accepted as deliberate for this UI (see docs/dev/accessibility.md). */
const ACCEPTED_MODERATES = new Set<string>([
  // Best-practice heading order: the app is a single-screen instrument panel
  // (booth + lanes); a visible <h1> has no designed place on the stage floor.
  "page-has-heading-one",
  // Best-practice landmark structure: <header> sits inside .app (not body),
  // so it is not exposed as banner. One main + labeled regions is deliberate.
  "banner-top-level",
  // Best-practice: region grouping. The grids/headers are labeled sections;
  // wrapping every one in a landmark adds noise, not navigation value.
  "region",
]);

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

async function runAxe(context: HTMLElement) {
  const results = await axe.run(context, {
    // Full ruleset; contrast pairs are computed from the REAL rendered CSS.
    resultTypes: ["violations"],
  });
  return results.violations;
}

function partition(violations: axe.Result[]) {
  const blocking = violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const moderates = violations.filter(
    (v) => v.impact !== "critical" && v.impact !== "serious",
  );
  return { blocking, moderates };
}

function expectClean(violations: axe.Result[], state: string) {
  const { blocking, moderates } = partition(violations);
  if (blocking.length > 0) {
    const detail = blocking
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      )
      .join("\n  ");
    throw new Error(`[${state}] critical/serious axe violations:\n  ${detail}`);
  }
  const unexpected = moderates.filter((m) => !ACCEPTED_MODERATES.has(m.id));
  if (unexpected.length > 0) {
    const detail = unexpected
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      )
      .join("\n  ");
    throw new Error(
      `[${state}] untriaged moderate axe violations (triage in docs/dev/accessibility.md or fix):\n  ${detail}`,
    );
  }
  // Accepted moderates may only ever be the known set.
  for (const m of moderates) expect(ACCEPTED_MODERATES.has(m.id)).toBe(true);
}

describe("DA-2 axe-core gate", () => {
  it("main screen: no critical/serious violations", async () => {
    const { host, cleanup } = mount();
    try {
      // Let Solid settle (popovers closed, grids built).
      await new Promise((r) => setTimeout(r, 300));
      expectClean(await runAxe(host), "main screen");
    } finally {
      cleanup();
    }
  });

  // MB-3 (mobile slice, m2 — "a11y gates extend" at phone width): the same
  // zero-critical/serous + triaged-moderates law at the committed phone
  // viewports on the PHONE STAGE (sticky chrome + lane switcher + condensed
  // rail + single-lane stage; the ≥44 target law's sizing in effect), plus
  // help mode ON at phone width (the tap-to-inspect surface).
  it("phone stage 390×844 + 360×800: main screen + help mode clean", async () => {
    for (const [w, h] of [
      [390, 844],
      [360, 800],
    ] as const) {
      await page.viewport(w, h);
      const { host, cleanup } = mount();
      try {
        await new Promise((r) => setTimeout(r, 400));
        expect(
          host.querySelector(".app")?.getAttribute("data-stage"),
          `phone stage at ${w}×${h}`,
        ).toBe("phone");
        expectClean(await runAxe(host), `phone main ${w}×${h}`);
        // Help mode on (the info view + mode-obvious markers at phone).
        // M-2 (iteration 4): the phone stage no longer renders the INFO ?
        // button (render guard) — the mode turns on through the state seam
        // (the `i` keyboard twin's path).
        setHelpMode(true);
        await new Promise((r) => setTimeout(r, 300));
        expect(host.querySelector(".info-view")).toBeTruthy();
        expectClean(await runAxe(host), `phone help mode ${w}×${h}`);
      } finally {
        setHelpMode(false);
        cleanup();
      }
    }
    await page.viewport(1280, 800); // leave the tester viewport as configured
  });

  it("booth scale popover open: dialog semantics clean", async () => {
    const { host, cleanup } = mount();
    try {
      // MB-6 stabilization: settle the stage BEFORE querying/clicking the
      // chip (a matchMedia branch swap in flight would destroy the Booth
      // the popover opened in), then wait for the popover to actually
      // mount — never a fixed sleep. Assertion set unchanged.
      await settleDesktopStage(host);
      const chip = host.querySelector<HTMLButtonElement>(".scale-chip-booth")!;
      expect(chip).toBeTruthy();
      chip.click();
      await waitFor(
        () => host.querySelector(".scale-pop") !== null,
        4000,
        "scale popover mounted",
      );
      // axe-after-settle: let the onMount focus choreography land so the
      // snapshot sees the popover's steady state.
      await new Promise((r) => setTimeout(r, 150));
      expectClean(await runAxe(host), "scale popover open");
    } finally {
      cleanup();
    }
  });

  it("help overlay open: modal dialog clean", async () => {
    const { host, cleanup } = mount();
    try {
      await settleDesktopStage(host);
      const keys = host.querySelector<HTMLButtonElement>(".booth-btn-help")!;
      openHelp(keys);
      await new Promise((r) => setTimeout(r, 300));
      expect(host.querySelector(".help-panel")).toBeTruthy();
      expectClean(await runAxe(host), "help overlay open");
    } finally {
      closeHelp();
      cleanup();
    }
  });

  // HP-1 / a11y §7 E6: the FOURTH mounted state — help mode ON (the info
  // view). Semantics asserted here: role=status, aria-live=polite, NOT
  // focusable / NOT in the tab order; a focus-driven update (no pointer
  // events) changes the region's text; axe stays clean with the surface
  // mounted.
  it("help mode on (info view): status-region semantics clean", async () => {
    const { host, cleanup } = mount();
    try {
      await settleDesktopStage(host);
      const info = host.querySelector<HTMLButtonElement>(".booth-btn-info")!;
      expect(info).toBeTruthy();
      info.click();
      await new Promise((r) => setTimeout(r, 300));
      const region = host.querySelector<HTMLElement>(".info-view")!;
      expect(region).toBeTruthy();
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.hasAttribute("tabindex")).toBe(false);
      expect(region.hasAttribute("contenteditable")).toBe(false);

      // Focus-driven update with ZERO pointer events (the E6 keyboard law).
      const loop = host.querySelector<HTMLElement>('[data-help="booth.loop"]')!;
      expect(loop).toBeTruthy();
      loop.focus();
      await new Promise((r) => setTimeout(r, 100));
      expect(region.textContent).toContain("LOOP");

      expectClean(await runAxe(host), "help mode on");
    } finally {
      setHelpMode(false);
      cleanup();
    }
  });

  // VZ-DD-1 / the visualizer surface's a11y gate: the VIZ page with its
  // REMOTE chrome present (the task's "review + axe" clause). Semantics
  // asserted here: the remote is a NAMED toolbar; the canvas is aria-hidden
  // decoration; the covered stage is `inert` (no focusable-hidden-content
  // class of violations — inert is the standard mechanism); axe stays clean
  // with the surface mounted.
  it("viz mode on (remote chrome): toolbar semantics clean", async () => {
    const { host, cleanup } = mount();
    try {
      await settleDesktopStage(host);
      const viz = host.querySelector<HTMLButtonElement>(".booth-btn-viz")!;
      expect(viz).toBeTruthy();
      viz.click();
      await waitFor(
        () => host.querySelector(".viz-remote") !== null,
        4000,
        "viz remote mounted",
      );
      const remote = host.querySelector<HTMLElement>(".viz-remote")!;
      expect(remote.tagName).toBe("ASIDE");
      expect(remote.getAttribute("aria-label")).toBe("Instrument inspector");
      expect(
        host.querySelector(".viz-canvas")?.getAttribute("aria-hidden"),
      ).toBe("true");
      expect(host.querySelector(".booth")?.inert).toBe(true);
      expect(host.querySelector("main.stage")?.inert).toBe(true);
      // VZ-HW-3 names this snapshot the mounted-IDLE state (transport
      // stopped): the idle line is its legibility law, visible here.
      expect(
        host.querySelector(".viz-header p")?.textContent?.trim(),
      ).toContain("Playback stopped");
      // axe-after-settle: let the transport subscription + roving seed land.
      await new Promise((r) => setTimeout(r, 300));
      expectClean(await runAxe(host), "viz mode on");
    } finally {
      setVizMode(false);
      cleanup();
    }
  });

  // VZ-HW-3 — the four VIZ surface states join the consolidated axe gate
  // (plan §"VZ-HW-3": mounted-PLAYING, IDLE, REDUCED-MOTION, PHONE-FALLBACK
  // — the previous test's stopped-desktop snapshot IS the idle state; this
  // sweep walks the other three and re-pins idle through a real played→
  // stopped edge, so the transport-truthful idle line is the state's own
  // proof). Deep semantics stay in their owning gates (viz-remote,
  // viz-reduced-motion, viz-phone); here it is the AXE law that must hold
  // in every state the surface can be observed in.
  it("viz states (VZ-HW-3): playing · idle · reduced-motion · phone-gate — axe clean", async () => {
    await emulateReducedMotion("no-preference"); // start from the real default
    const { host, cleanup } = mount();
    let bootDb: ProjectDb | null = null;
    let rows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
    try {
      await settleDesktopStage(host);
      // Deterministic demo content + the shared-origin rows restore (the
      // joy-loop idiom — loadDocument autosaves).
      await waitFor(
        () => getAutosaveController() !== null,
        10_000,
        "boot autosave controller",
      );
      bootDb = await openRawProjectDb("bitbounce");
      rows = await bootDb.allRecords();
      loadDocument(createDemoProject());
      session.setLoop(true);

      // --- STATE 1: mounted-PLAYING ------------------------------------
      await session.togglePlay();
      await waitFor(
        () => session.transport.snapshot.playing,
        5000,
        "transport playing",
      );
      host.querySelector<HTMLButtonElement>(".booth-btn-viz")!.click();
      await waitFor(
        () => host.querySelector(".viz-remote") !== null,
        5000,
        "viz remote mounted",
      );
      expect(host.querySelector(".viz-remote-idle")).toBeNull(); // playing
      await new Promise((r) => setTimeout(r, 300)); // entry line + seed land
      expectClean(await runAxe(host), "viz playing");

      // --- STATE 2: REDUCED-MOTION (the live swap, mid-play) -----------
      await emulateReducedMotion("reduce");
      await waitFor(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        5000,
        "emulated media applied",
      );
      await waitFor(
        () => activeCompositionEngines()[0]?.probe().reduced === true,
        5000,
        "engine swapped to reduced motion (the matchMedia seam)",
      );
      await new Promise((r) => setTimeout(r, 300));
      expectClean(await runAxe(host), "viz reduced-motion");
      await emulateReducedMotion("no-preference");
      await waitFor(
        () => activeCompositionEngines()[0]?.probe().reduced === false,
        5000,
        "engine back at full motion",
      );

      // --- STATE 3: mounted-IDLE (a real played→stopped edge) ----------
      await session.togglePlay();
      await waitFor(
        () => !session.transport.snapshot.playing,
        5000,
        "transport stopped",
      );
      await waitFor(
        () => host.querySelector(".viz-header p")?.textContent?.includes("Playback stopped") === true,
        5000,
        "idle line visible under the surface",
      );
      expectClean(await runAxe(host), "viz idle");

      // --- STATE 4: the PHONE GATE (DD-4's committed fallback form) ----
      setVizMode(false);
      await waitFor(
        () => host.querySelector(".viz-page") === null,
        5000,
        "viz closed before the stage flip",
      );
      await page.viewport(390, 844);
      await waitFor(
        () => host.querySelector(".app")?.getAttribute("data-stage") === "phone",
        5000,
        "phone stage settled",
      );
      // M-4 (iteration 4): at phone width the VIZ toggle lives in the
      // options drawer — open it first (the toggle is the gate's entry).
      host.querySelector<HTMLButtonElement>('[data-help="phone.options"]')!
        .click();
      await waitFor(
        () => host.querySelector(".phone-options-drawer") !== null,
        5000,
        "options drawer open",
      );
      host.querySelector<HTMLButtonElement>(".booth-btn-viz")!.click();
      await waitFor(
        () => host.querySelector(".viz-remote") !== null,
        5000,
        "phone gate mounted",
      );
      const gate = host.querySelector<HTMLElement>(".viz-remote")!;
      expect(gate.classList.contains("viz-remote-gate")).toBe(false);
      expect(gate.tagName).toBe("ASIDE");
      expect(host.querySelectorAll(".viz-lane-tabs button")).toHaveLength(4);
      await new Promise((r) => setTimeout(r, 300));
      expectClean(await runAxe(host), "viz phone-gate 390×844");
    } finally {
      await emulateReducedMotion("no-preference");
      setVizMode(false);
      void getSession().transport.stop?.();
      cleanup();
      await page.viewport(1280, 800); // leave the tester viewport as configured
      try {
        await getAutosaveController()?.stop();
        if (bootDb) {
          const ids = new Set(rows.map((r) => r.id));
          const current = await bootDb.allRecords();
          for (const row of rows) await bootDb.putRecord(row);
          for (const row of current) {
            if (!ids.has(row.id)) await bootDb.deleteRecord(row.id);
          }
        }
      } catch {
        /* best-effort restore */
      }
    }
  });
});
