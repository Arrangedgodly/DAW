/**
 * PX-3 browser tests — the Euclidean fill control against the REAL DOM:
 *  - the drums lane mounts one fill rail per drum row (6 pieces), pitched
 *    lanes mount none;
 *  - the controls are keyboard reachable (buttons in the tab order, revealed
 *    on focus) — the opacity gate never removes them from focus flow;
 *  - preview/commit separation: stepper clicks paint data-preview overlays
 *    with ZERO store writes; SET commits the pattern into the document row;
 *  - after commit, hand clicking a cell still edits (the fill does not fight
 *    manual edits) and a hand-edited row reads CUSTOM ('—').
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import LaneGrid from "../../src/components/LaneGrid";
import { closeFillRails } from "../../src/state/fillRails";
import { applyEuclidFill, docStore } from "../../src/state/store";
// DA-3 fix precedent (fx-console-trusted/help gates): components import
// their CSS but NOT the token sheet — main.tsx's job in the real bundle.
// The geometry law below additionally needs the two stylesheets the fill
// rail's geometry lives in (App.tsx owns these imports in the real app):
// grid.css (the rail) + lane-header.css (the stepper buttons), plus the
// token/font base so metrics match the deployed world.
import "../../src/styles/base.css";
import "../../src/styles/grid.css";
import "../../src/styles/lane-header.css";

function mount(lane: "drums" | "bass"): {
  host: HTMLElement;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  closeFillRails();
  document.body.append(host);
  const dispose = render(() => <LaneGrid lane={lane} />, host);
  return {
    host,
    cleanup: () => {
      closeFillRails();
      dispose();
      host.remove();
    },
  };
}

function doc() {
  return docStore.getState().doc;
}

function firstDrumsPattern() {
  const p = doc().patterns.drums[0];
  if (p.kind !== "drums") throw new Error("expected drums pattern");
  return p;
}

async function waitFor(predicate: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("condition never met within budget");
}

describe("Euclidean fill control (browser DOM)", () => {
  it("drums lane: 6 fill rails, one per drum row; pitched lanes none", () => {
    const { host, cleanup } = mount("drums");
    try {
      const rails = host.querySelectorAll(".row-fill");
      expect(rails.length).toBe(6);
      const labels = [...host.querySelectorAll(".row-label")].map(
        (el) => el.textContent,
      );
      expect(labels).toEqual([
        "KICK",
        "SNARE",
        "HAT",
        "OPENHAT",
        "CLAP",
        "TOM",
      ]);
      expect(
        host.querySelector(".lane-grid")!.classList.contains("has-fill-rail"),
      ).toBe(true);
    } finally {
      cleanup();
    }
    const pitched = mount("bass");
    try {
      expect(pitched.host.querySelectorAll(".row-fill").length).toBe(0);
    } finally {
      pitched.cleanup();
    }
  });

  it("steppers preview (no store write) and SET commits; keyboard reachable", async () => {
    // Deterministic baseline: an empty kick row reads E(0) unarmed.
    applyEuclidFill("kick", 0, 0);
    const { host, cleanup } = mount("drums");
    try {
      const kickRail = host.querySelector(
        '.row-fill[data-row="0"]',
      )! as HTMLElement;
      const buttons = [
        ...kickRail.querySelectorAll("button"),
      ] as HTMLButtonElement[];
      expect(buttons.length).toBe(5); // – + – + SET

      // Keyboard reachability: the opacity gate never evicts the buttons
      // from the tab order, and focusing one reveals the rail.
      const plusPulse = buttons[1]!;
      expect(plusPulse.tabIndex).toBe(0);
      plusPulse.focus();
      await waitFor(() => getComputedStyle(kickRail).opacity === "1");

      // PREVIEW: pulse the stepper up to 4 pulses — overlay painted, store
      // untouched (identity + row content). Empty row baseline: match
      // {pulses:0} → each click arms/raises by one.
      const docBefore = doc();
      const rowBefore = [...firstDrumsPattern().steps.kick];
      const morePulses = buttons[1]!;
      morePulses.click(); // 0 → 1
      morePulses.click(); // 1 → 2
      morePulses.click(); // 2 → 3
      morePulses.click(); // 3 → 4
      const grid = host.querySelector(".lane-grid")!;
      const previews = grid.querySelectorAll('.cell[data-preview="true"]');
      expect(previews.length).toBe(4);
      expect(doc()).toBe(docBefore); // preview wrote NOTHING
      expect([...firstDrumsPattern().steps.kick]).toEqual(rowBefore);

      // COMMIT via keyboard: focus SET, press Enter (native click path).
      const set = buttons[4]!;
      expect(set.disabled).toBe(false);
      set.focus();
      set.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      set.click();
      await waitFor(
        () => firstDrumsPattern().steps.kick.filter(Boolean).length === 4,
      );
      const committed = [...firstDrumsPattern().steps.kick];
      expect(committed[0]).toBe(true);
      expect(grid.querySelectorAll('.cell[data-preview="true"]').length).toBe(
        0,
      );

      // Hand edit still works after the fill, and the row then reads custom.
      const kickCells = [
        ...grid.querySelectorAll(".grid-row"),
      ][0]!.querySelectorAll(".cell");
      (kickCells[1] as HTMLElement).click();
      await waitFor(() => firstDrumsPattern().steps.kick[1] === true);
      expect(kickRail.textContent).toContain("—");
    } finally {
      cleanup();
    }
  });

  it("refinement-2 (critique P1-2): the rail geometry FITS the control so SET self-hits", async () => {
    // The defect: the 104 px slot was narrower than its ~200 px control
    // stack, so the control overflowed UNDER the row cells — elementFromPoint
    // at SET's center returned a `.cell` and real clicks timed out. The law
    // now: the renderer PINS the slot width inline (label-pin precedent),
    // the control's natural width fits the slot (≥ one readout char of
    // headroom = the 4-bar "64/64" worst case), and every control — SET
    // included — owns its center. Trusted-pointer twins (real clicks) live
    // in euclid-fill-trusted.test.tsx; the built-app twin in
    // quadrant-layout.test.ts §9c.
    await page.viewport(1440, 900); // elementFromPoint needs an on-screen rail
    const { host, cleanup } = mount("drums");
    // Font-metric determinism: the label/value faces load lazily on first
    // use — load them EXPLICITLY so the slot-fit law reads the deployed
    // Silkscreen/Departure Mono metrics, not the wider fallback face's.
    await Promise.all([
      document.fonts.load('700 10px "Silkscreen"'),
      document.fonts.load('400 11px "Departure Mono"'),
    ]);
    await document.fonts.ready;
    try {
      host.querySelector<HTMLButtonElement>(".head-fill-toggle")!.click();
      const rail = host.querySelector('.row-fill[data-row="0"]') as HTMLElement;
      expect(rail.classList.contains("is-overlay")).toBe(true);
      const ctl = rail.querySelector(".row-fill-ctl") as HTMLElement;
      expect(
        ctl.scrollWidth,
        "control natural width fits the overlay",
      ).toBeLessThanOrEqual(rail.clientWidth);
      expect(ctl.getBoundingClientRect().right).toBeLessThanOrEqual(
        rail.getBoundingClientRect().right + 0.5,
      );
      // The critique's exact probe: elementFromPoint at every control's
      // center (SET used to resolve to a .cell under the paint order).
      for (const btn of rail.querySelectorAll("button")) {
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        expect(
          hit === btn || btn.contains(hit!),
          `${btn.getAttribute("aria-label")} must own its center`,
        ).toBe(true);
      }
    } finally {
      cleanup();
    }
  });
});
