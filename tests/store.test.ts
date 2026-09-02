/**
 * DES-4/IM-6 store tests: document toggle actions + zundo undo/redo (limit 50)
 * with rapid-edit coalescing (same family within 350 ms → one undo step).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUndo,
  docStore,
  redo,
  toggleDrumStep,
  togglePitchedCell,
  undo,
} from "../src/state/store";

function doc() {
  return docStore.getState().doc;
}

beforeEach(() => {
  // Rewind history to the initial state before each test.
  // Rewind to the initial document, then drop all history (redo would
  // otherwise re-apply the previous test's edits and refill `past`).
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("doc store toggles", () => {
  it("drums: toggles a step off→on→off", () => {
    expect(doc().patterns.drums[0].kind).toBe("drums");
    const on = doc().patterns.drums[0].steps.kick[0];
    expect(on).toBe(false);

    const first = toggleDrumStep("kick", 0);
    expect(first.turnedOn).toBe(true);
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(true);
    // Sibling steps and pieces untouched.
    expect(doc().patterns.drums[0].steps.kick[1]).toBe(false);
    expect(doc().patterns.drums[0].steps.snare[0]).toBe(false);

    const second = toggleDrumStep("kick", 0);
    expect(second.turnedOn).toBe(false);
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(false);
  });

  it("pitched: cycles 0→1→0 and reports audition on placement only", () => {
    const before = doc().patterns.bass[0];
    expect(before.kind).toBe("pitched");

    const on = togglePitchedCell("bass", 3, 5);
    expect(on.turnedOn).toBe(true);
    const pattern = doc().patterns.bass[0];
    expect(pattern.kind).toBe("pitched");
    const row = pattern.rows.find((r) => r.degree === 3);
    expect(row?.steps[5]).toBe(1);

    const off = togglePitchedCell("bass", 3, 5);
    expect(off.turnedOn).toBe(false);
    const after = doc().patterns.bass[0];
    expect(after.kind).toBe("pitched");
    expect(after.rows.find((r) => r.degree === 3)?.steps[5]).toBe(0);
  });

  it("pitched rows cover two octaves (grid expansion)", () => {
    const pattern = doc().patterns.bass[0];
    expect(pattern.kind).toBe("pitched");
    if (pattern.kind !== "pitched") return;
    expect(pattern.rows.length).toBe(14); // minor: 7 × 2 octaves
    expect(pattern.rows.map((r) => r.degree)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    const chords = doc().patterns.chords[0];
    expect(chords.kind).toBe("pitched");
    if (chords.kind === "pitched") {
      expect(chords.rows.length).toBe(7);
    }
  });

  it("document stays schema-valid after edits", async () => {
    toggleDrumStep("hat", 7);
    togglePitchedCell("lead", 13, 15);
    const { validateProject } = await import("../src/document/validate");
    expect(() => validateProject(doc())).not.toThrow();
  });
});

describe("undo/redo", () => {
  it("undoes and redoes toggle edits (spaced gestures)", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    toggleDrumStep("kick", 0);
    vi.advanceTimersByTime(400); // outside the coalescing window
    toggleDrumStep("kick", 0); // net-zero edit pair
    vi.advanceTimersByTime(400);
    toggleDrumStep("snare", 4);
    expect(doc().patterns.drums[0].steps.snare[4]).toBe(true);

    undo();
    expect(doc().patterns.drums[0].steps.snare[4]).toBe(false);

    redo();
    expect(doc().patterns.drums[0].steps.snare[4]).toBe(true);

    undo();
    undo(); // kick 0 second toggle
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(true);
  });

  it("rapid toggles coalesce into one undo step", () => {
    toggleDrumStep("kick", 0);
    toggleDrumStep("hat", 3); // same family, within 350 ms
    togglePitchedCell("bass", 2, 1);
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(true);
    expect(doc().patterns.drums[0].steps.hat[3]).toBe(true);

    undo(); // one step reverts the whole gesture
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(false);
    expect(doc().patterns.drums[0].steps.hat[3]).toBe(false);
    const bass = doc().patterns.bass[0];
    if (bass.kind === "pitched") {
      expect(bass.rows.find((r) => r.degree === 2)?.steps[1]).toBe(0);
    }
    expect(canUndo()).toBe(false);
  });

  it("history depth is limited to 50 snapshots", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    for (let i = 0; i < 60; i++) {
      toggleDrumStep("hat", i % 16);
      vi.advanceTimersByTime(400); // every toggle is its own gesture
    }
    let depth = 0;
    while (canUndo()) {
      undo();
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(50);
    // Oldest surviving edit is not step 0's state.
    expect(doc().patterns.drums[0].steps.hat[0]).toBe(true);
  });
});
