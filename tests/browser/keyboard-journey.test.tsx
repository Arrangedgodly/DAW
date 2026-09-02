/**
 * DA-1 browser journey: drive the REAL app by keyboard alone —
 * boot → play (body-level Space) → navigate to a drums cell (roving seed
 * focus) → toggle → lane-move (PageDown) → toggle a lead note → undo
 * (Ctrl+Z, coalesced gesture) → open help (?) → dismiss (Escape).
 *
 * Note on "keyboard alone": real browsers synthesize a click for Enter on
 * a focused button, but synthetic KeyboardEvents do not — the grid keys
 * (arrows/Enter/PageDown) run through the app's own keydown listeners,
 * and transport uses the body-level Space shortcut, so every step here
 * exercises the actual keyboard code paths.
 *
 * Undo assertion leans on IM-6's coalescing: both toggles are dispatched
 * inside the 350 ms "toggle" family window → ONE Ctrl+Z reverts both.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { currentPatternFor } from "../../src/state/selection";

function activePatternOf(lane: "drums" | "lead") {
  const p = currentPatternFor(lane);
  if (!p) throw new Error(`no active pattern for ${lane}`);
  return p;
}

function activeDrumsSteps(piece: string): boolean[] {
  const p = activePatternOf("drums");
  if (p.kind !== "drums") throw new Error("expected drums pattern");
  return [...p.steps[piece as keyof typeof p.steps]];
}

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return { host, cleanup: () => { dispose(); host.remove(); } };
}

async function waitFor(predicate: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("condition never met within budget");
}

function key(el: Element, k: string, opts: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }),
  );
}

function laneHost(host: HTMLElement, lane: string): HTMLElement {
  return host.querySelector(`.lane-floor[data-lane="${lane}"]`)! as HTMLElement;
}

function rovingSeed(lane: HTMLElement): HTMLElement {
  const seed = [...lane.querySelectorAll(".cell")].find((c) => c.tabIndex === 0);
  if (!seed) throw new Error(`no roving seed cell in lane`);
  return seed as HTMLElement;
}

describe("DA-1 keyboard journey (real app)", () => {
  it("boot → play → drums toggle → lane move → lead toggle → undo → help", async () => {
    const { host, cleanup } = mount();
    try {
      // Boot: all four lane grids exist with one roving tab stop each.
      for (const lane of ["drums", "bass", "chords", "lead"]) {
        const floor = laneHost(host, lane);
        expect(floor.querySelector('.lane-grid-scroll [role="grid"]')).toBeTruthy();
        expect(
          [...floor.querySelectorAll(".cell")].filter((c) => c.tabIndex === 0).length,
        ).toBe(1);
      }

      // PLAY by keyboard: body-level Space (the DA-1 transport shortcut).
      document.body.focus();
      key(document.body, " ");
      await waitFor(() =>
        (host.querySelector(".booth-btn-play") as HTMLButtonElement).getAttribute("aria-pressed") === "true",
      );

      // Navigate the drums grid: seed cell (KICK step 1) → right → down.
      const drums = laneHost(host, "drums");
      const seed = rovingSeed(drums);
      seed.focus();
      expect(document.activeElement).toBe(seed);
      key(seed, "ArrowRight");
      key(document.activeElement!, "ArrowDown");
      const cell = document.activeElement as HTMLElement;
      expect(cell.dataset.row).toBe("1"); // SNARE row
      expect(cell.dataset.step).toBe("1"); // second step

      // Home/End + beat jump (ctrl+ArrowRight) work per the spec map.
      key(cell, "End");
      expect((document.activeElement as HTMLElement).dataset.step).toBe("15");
      key(document.activeElement!, "Home");
      expect((document.activeElement as HTMLElement).dataset.step).toBe("0");
      key(document.activeElement!, "ArrowRight", { ctrlKey: true });
      expect((document.activeElement as HTMLElement).dataset.step).toBe("4");

      // Toggle the SNARE cell at step 4.
      const snareBefore = activeDrumsSteps("snare")[4];
      key(document.activeElement!, "Enter");
      await waitFor(() => activeDrumsSteps("snare")[4] === !snareBefore);

      // Escape pops to the region head: the lane header's first control.
      key(document.activeElement!, "Escape");
      await waitFor(() =>
        !!document.activeElement && drums.querySelector(".lane-head")!.contains(document.activeElement),
      );

      // Back into the grid via the (still-roving) seed's tab stop, then
      // lane-move: PageDown ×3 drums → bass → chords → lead.
      rovingSeed(drums).focus();
      key(document.activeElement!, "PageDown");
      await waitFor(() => laneHost(host, "bass").contains(document.activeElement));
      key(document.activeElement!, "PageDown");
      await waitFor(() => laneHost(host, "chords").contains(document.activeElement));
      key(document.activeElement!, "PageDown");
      await waitFor(() => laneHost(host, "lead").contains(document.activeElement));

      // Edge clamp: one more PageDown stays in lead (no wrap, spec law).
      key(document.activeElement!, "PageDown");
      expect(laneHost(host, "lead").contains(document.activeElement)).toBe(true);

      // Toggle a lead note at the carried cell (row index carried, clamped).
      const leadCell = document.activeElement as HTMLElement;
      const leadRow = Number(leadCell.dataset.row);
      const leadStep = Number(leadCell.dataset.step);
      const leadPattern = activePatternOf("lead");
      if (leadPattern.kind !== "pitched") throw new Error("expected pitched lead pattern");
      const leadBefore = leadPattern.rows[leadRow]!.steps[leadStep] !== 0;
      key(leadCell, "Enter");
      await waitFor(() => {
        const p = activePatternOf("lead");
        return p.kind === "pitched" &&
          (p.rows[leadRow]!.steps[leadStep] !== 0) === !leadBefore;
      });

      // UNDO (Ctrl+Z): both toggles coalesced into one gesture → both revert.
      key(document.activeElement!, "z", { ctrlKey: true });
      await waitFor(() => {
        const lead = activePatternOf("lead");
        return lead.kind === "pitched" &&
          (lead.rows[leadRow]!.steps[leadStep] !== 0) === leadBefore;
      });
      expect(activeDrumsSteps("snare")[4]).toBe(snareBefore);

      // Help overlay: "?" opens a focus-trapped dialog; Escape dismisses.
      document.body.focus();
      key(document.body, "?");
      const dialog = await waitForAndGrab(host);
      expect(dialog.getAttribute("role")).toBe("dialog");
      expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true);
      key(dialog, "Escape");
      await waitFor(() => !host.querySelector(".help-panel"));

      // Stop playback (keyboard) to leave the world quiet.
      document.body.focus();
      key(document.body, " ");
      await waitFor(() =>
        (host.querySelector(".booth-btn-play") as HTMLButtonElement).getAttribute("aria-pressed") === "false",
      );
    } finally {
      // Best-effort stop before teardown.
      void import("../../src/engine/session").then(({ getSession }) =>
        getSession().transport.stop?.(),
      ).catch(() => {});
      cleanup();
    }
  });
});

function waitForAndGrab(host: HTMLElement): HTMLElement {
  const grab = (): HTMLElement | null => host.querySelector(".help-panel");
  if (!grab()) throw new Error("help panel never appeared synchronously");
  return grab()!;
}
