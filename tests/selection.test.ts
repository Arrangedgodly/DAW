/**
 * IM-6 selection/focus tests: ephemeral Solid-signal state (D1 two-tier law —
 * never in the document store, never in undo history).
 */

import { describe, expect, it } from "vitest";
import {
  activeLane,
  clearFocus,
  focusedCell,
  focusCell,
  getActivePattern,
  selectLane,
  selectPattern,
} from "../src/state/selection";
import { canUndo, toggleDrumStep, undo, redo } from "../src/state/store";

describe("selection state", () => {
  it("active lane defaults to drums and switches", () => {
    expect(activeLane()).toBe("drums");
    selectLane("lead");
    expect(activeLane()).toBe("lead");
    selectLane("drums");
  });

  it("active pattern per lane defaults to the first chain entry", () => {
    expect(getActivePattern("bass")).toBe("bass-1");
    selectPattern("bass", "bass-2");
    expect(getActivePattern("bass")).toBe("bass-2");
    expect(getActivePattern("lead")).toBe("lead-1"); // per-lane independence
  });

  it("focused cell sets and clears", () => {
    expect(focusedCell()).toBeNull();
    focusCell({ lane: "chords", row: 3, step: 7 });
    expect(focusedCell()).toEqual({ lane: "chords", row: 3, step: 7 });
    clearFocus();
    expect(focusedCell()).toBeNull();
  });

  it("selection changes never touch the document or its history", () => {
    toggleDrumStep("kick", 1); // one history entry
    selectLane("bass");
    selectPattern("bass", "bass-9");
    focusCell({ lane: "bass", row: 0, step: 0 });
    expect(canUndo()).toBe(true);
    undo();
    expect(canUndo()).toBe(false);
    redo();
    expect(activeLane()).toBe("bass"); // selection survived the round trip
  });
});
