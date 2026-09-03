/**
 * DA-2 axe gate: run axe-core against the REAL mounted app in three states —
 * (1) the main screen as booted, (2) the booth scale popover open, (3) the
 * help overlay open — and assert ZERO critical/serious violations.
 *
 * Moderates are triaged below: the two accepted findings are documented in
 * docs/dev/accessibility.md and asserted BY ID so a new moderate can never
 * slip in silently (an unexpected moderate fails the test).
 *
 * Note: this is a devDependency consumed only by tests — the shipped bundle
 * never includes axe (zero-network / bundle gates unaffected).
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import axe from "axe-core";
import App from "../../src/App";
import { closeHelp, openHelp } from "../../src/state/helpOverlay";
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
});
