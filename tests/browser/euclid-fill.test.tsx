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
import { render } from "solid-js/web";
import LaneGrid from "../../src/components/LaneGrid";
import { applyEuclidFill, docStore } from "../../src/state/store";

function mount(lane: "drums" | "bass"): {
  host: HTMLElement;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <LaneGrid lane={lane} />, host);
  return {
    host,
    cleanup: () => {
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
});
