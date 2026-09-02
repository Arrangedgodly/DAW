/**
 * PX-3 Euclidean fill session tests — the preview/commit contract:
 *  - applyEuclidFill WRITES the store (every drums pattern, per-pattern
 *    length) and is undoable;
 *  - preview derivation NEVER touches the store;
 *  - custom-state detection: after a hand edit the row matches no Euclidean
 *    pattern ('—'), and the session re-arms when parameters change again;
 *  - keyboard action mapping for the group-level keys.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { euclid } from "../src/audio/euclid";
import {
  applyEuclidFill,
  canUndo,
  docStore,
  toggleDrumStep,
  undo,
} from "../src/state/store";
import {
  fillDisplay,
  fillKeyAction,
  fillPattern,
  fillPreview,
  readFillSession,
  stepFillParam,
} from "../src/state/euclidFill";
import { addPattern } from "../src/state/store";

function doc() {
  return docStore.getState().doc;
}

function kickRow(): readonly boolean[] {
  const p = doc().patterns.drums[0];
  if (p.kind !== "drums") throw new Error("expected drums pattern");
  return p.steps.kick;
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

describe("applyEuclidFill (commit path writes the store)", () => {
  it("paints E(4,16) four-on-floor into the kick row", () => {
    applyEuclidFill("kick", 4, 0);
    expect([...kickRow()]).toEqual(euclid(4, 16, 0));
    // Other pieces untouched.
    const p = doc().patterns.drums[0];
    if (p.kind !== "drums") throw new Error("unreachable");
    expect(p.steps.snare.every((s) => !s)).toBe(true);
  });

  it("writes EVERY drums pattern at its own length", () => {
    addPattern("drums", 2, "B"); // second pattern: 32 steps
    applyEuclidFill("hat", 7, 1);
    expect(doc().patterns.drums.length).toBe(2);
    for (const p of doc().patterns.drums) {
      if (p.kind !== "drums") continue;
      expect(p.steps.hat.length).toBe(p.bars * 16);
      expect([...p.steps.hat]).toEqual(euclid(7, p.bars * 16, 1));
    }
  });

  it("is undoable back to the pre-fill row", () => {
    const before = [...kickRow()];
    applyEuclidFill("kick", 3, 0);
    expect([...kickRow()]).toEqual(euclid(3, 16, 0));
    undo();
    expect([...kickRow()]).toEqual(before);
  });

  it("after a fill the cells are ordinary data (hand edits work)", () => {
    applyEuclidFill("kick", 4, 0);
    const res = toggleDrumStep("kick", 1); // punch a 16th in
    expect(res.turnedOn).toBe(true);
    const row = [...kickRow()];
    expect(row[0]).toBe(true);
    expect(row[1]).toBe(true); // the hand edit survived alongside the fill
  });
});

describe("fill session (preview/commit separation + custom state)", () => {
  it("unarmed sessions preview nothing and mirror the row's match", () => {
    applyEuclidFill("kick", 3, 0);
    const s = readFillSession(kickRow());
    expect(s.armed).toBe(false);
    expect(s.match).toEqual({ pulses: 3, rotation: 0 });
    expect(fillPreview(s, 16)).toBeNull();
  });

  it("preview derives the overlay WITHOUT writing the store", () => {
    const before = doc();
    const s = stepFillParam(readFillSession(kickRow()), "pulses", 1, 16);
    expect(s.armed).toBe(true);
    const preview = fillPreview(s, 16);
    expect(preview).toEqual(fillPattern(s, 16));
    expect(doc()).toBe(before); // zero store writes from previewing
  });

  it("steppers clamp to [0, steps] / [0, steps-1] and stay armed", () => {
    let s = readFillSession(kickRow());
    s = stepFillParam(s, "pulses", -5, 16);
    expect(s.params.pulses).toBe(0);
    s = stepFillParam(s, "pulses", 99, 16);
    expect(s.params.pulses).toBe(16);
    s = stepFillParam(s, "rotation", 99, 16);
    expect(s.params.rotation).toBe(15);
  });

  it("a custom (hand-edited) row reads '—' and re-arms on parameter change", () => {
    applyEuclidFill("kick", 4, 0); // x...x...x...x...
    toggleDrumStep("kick", 1); // hand edit → no longer Euclidean
    const custom = readFillSession(kickRow());
    expect(custom.match).toBeNull();
    expect(custom.armed).toBe(false);
    expect(fillDisplay(custom, 16)).toBe("—");
    // Custom baseline keeps the row's density: 5 on cells → pulses 5.
    expect(custom.params.pulses).toBe(5);
    // Re-arm: the first stepper nudge arms the session again.
    const reArmed = stepFillParam(custom, "pulses", 1, 16);
    expect(reArmed.armed).toBe(true);
    expect(fillDisplay(reArmed, 16)).toBe("6/16");
  });

  it("an applied session reads back its own parameters (no drift)", () => {
    applyEuclidFill("kick", 4, 0); // deterministic E(4,16) baseline
    const s = stepFillParam(readFillSession(kickRow()), "pulses", 1, 16);
    expect(s.params.pulses).toBe(5);
    applyEuclidFill("kick", s.params.pulses, s.params.rotation);
    const after = readFillSession(kickRow());
    expect(after.armed).toBe(false);
    expect(after.match).toEqual({ pulses: 5, rotation: 0 });
    expect(fillDisplay(after, 16)).toBe("5/16");
  });

  it("keyboard mapping: Enter commits, Escape cancels, arrows pass through", () => {
    expect(fillKeyAction("Enter")).toBe("commit");
    expect(fillKeyAction("Escape")).toBe("cancel");
    expect(fillKeyAction("ArrowLeft")).toBeNull();
    expect(fillKeyAction(" ")).toBeNull();
  });
});
