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
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import axe from "axe-core";
import App from "../../src/App";
import { closeHelp, openHelp } from "../../src/state/helpOverlay";
import { setHelpMode } from "../../src/state/helpMode";
// DA-3 fix: App imports app.css/grid.css but NOT the token sheet (that is
// main.tsx's job in the real bundle). Without tokens every var(--color-*)
// background resolves to nothing, axe falls back to a white page, and light
// ink text (e.g. the empty-project .stage-hint) is measured against white
// and falsely flagged. Load the token base so contrast pairs are computed
// from the REAL rendered palette, exactly as deployed.
import "../../src/styles/base.css";

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
        const info = host.querySelector<HTMLButtonElement>(".booth-btn-info")!;
        info.click();
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
      const chip = host.querySelector<HTMLButtonElement>(".scale-chip-booth")!;
      expect(chip).toBeTruthy();
      chip.click();
      await new Promise((r) => setTimeout(r, 300));
      expect(host.querySelector(".scale-pop")).toBeTruthy();
      expectClean(await runAxe(host), "scale popover open");
    } finally {
      cleanup();
    }
  });

  it("help overlay open: modal dialog clean", async () => {
    const { host, cleanup } = mount();
    try {
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
});
