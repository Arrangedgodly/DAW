/**
 * DA-1 keyboard-nav pure math tests (docs/dev/keyboard.md is the spec):
 * next-cell moves incl. lane/row bounds and the NO-WRAP clamp law, beat
 * jumps, Home/End, lane-move clamping, cross-lane cell carry.
 */

import { describe, expect, it } from "vitest";
import {
  BEAT_STEPS,
  carryCellTo,
  gridMoveForKey,
  isLaneMoveKey,
  laneMoveIndex,
  nextCell,
} from "../src/grid/keynav";

const DIMS = { rows: 6, steps: 16 }; // drums-shaped grid

describe("gridMoveForKey", () => {
  it("maps the plain arrows, Home/End and the , . beat alternates", () => {
    expect(gridMoveForKey("ArrowLeft", false)).toBe("left");
    expect(gridMoveForKey("ArrowRight", false)).toBe("right");
    expect(gridMoveForKey("ArrowUp", false)).toBe("up");
    expect(gridMoveForKey("ArrowDown", false)).toBe("down");
    expect(gridMoveForKey("Home", false)).toBe("home");
    expect(gridMoveForKey("End", false)).toBe("end");
    expect(gridMoveForKey(",", false)).toBe("beatBack");
    expect(gridMoveForKey(".", false)).toBe("beatForward");
  });

  it("ctrl+arrows: left/right are beat jumps; up/down are NOT grid moves", () => {
    expect(gridMoveForKey("ArrowLeft", true)).toBe("beatBack");
    expect(gridMoveForKey("ArrowRight", true)).toBe("beatForward");
    expect(gridMoveForKey("ArrowUp", true)).toBeNull();
    expect(gridMoveForKey("ArrowDown", true)).toBeNull();
  });

  it("returns null for everything else (never hijacks unrelated keys)", () => {
    for (const key of [
      "Tab",
      "Enter",
      " ",
      "Escape",
      "x",
      "F2",
      "Delete",
      "[",
      "]",
    ]) {
      expect(gridMoveForKey(key, false)).toBeNull();
    }
  });
});

describe("nextCell (bounds + no-wrap law)", () => {
  it("moves one step / one row", () => {
    expect(nextCell({ row: 2, step: 3 }, DIMS, "right")).toEqual({
      row: 2,
      step: 4,
    });
    expect(nextCell({ row: 2, step: 3 }, DIMS, "left")).toEqual({
      row: 2,
      step: 2,
    });
    expect(nextCell({ row: 2, step: 3 }, DIMS, "down")).toEqual({
      row: 3,
      step: 3,
    });
    expect(nextCell({ row: 2, step: 3 }, DIMS, "up")).toEqual({
      row: 1,
      step: 3,
    });
  });

  it("clamps at every edge — never wraps (spec law)", () => {
    expect(nextCell({ row: 0, step: 0 }, DIMS, "left")).toEqual({
      row: 0,
      step: 0,
    });
    expect(nextCell({ row: 0, step: 0 }, DIMS, "up")).toEqual({
      row: 0,
      step: 0,
    });
    expect(nextCell({ row: 5, step: 15 }, DIMS, "right")).toEqual({
      row: 5,
      step: 15,
    });
    expect(nextCell({ row: 5, step: 15 }, DIMS, "down")).toEqual({
      row: 5,
      step: 15,
    });
  });

  it("Home/End go to the row's first/last step, keeping the row", () => {
    expect(nextCell({ row: 4, step: 9 }, DIMS, "home")).toEqual({
      row: 4,
      step: 0,
    });
    expect(nextCell({ row: 4, step: 9 }, DIMS, "end")).toEqual({
      row: 4,
      step: 15,
    });
  });

  it("beat jumps move 4 steps and clamp at the ends", () => {
    expect(BEAT_STEPS).toBe(4);
    expect(nextCell({ row: 1, step: 2 }, DIMS, "beatForward")).toEqual({
      row: 1,
      step: 6,
    });
    expect(nextCell({ row: 1, step: 14 }, DIMS, "beatForward")).toEqual({
      row: 1,
      step: 15,
    });
    expect(nextCell({ row: 1, step: 2 }, DIMS, "beatBack")).toEqual({
      row: 1,
      step: 0,
    });
    expect(nextCell({ row: 1, step: 3 }, DIMS, "beatBack")).toEqual({
      row: 1,
      step: 0,
    });
  });

  it("single-step grids and single-row grids still behave", () => {
    const tiny = { rows: 1, steps: 1 };
    expect(nextCell({ row: 0, step: 0 }, tiny, "right")).toEqual({
      row: 0,
      step: 0,
    });
    expect(nextCell({ row: 0, step: 0 }, tiny, "down")).toEqual({
      row: 0,
      step: 0,
    });
    expect(nextCell({ row: 0, step: 0 }, tiny, "end")).toEqual({
      row: 0,
      step: 0,
    });
  });
});

describe("lane moves", () => {
  it("isLaneMoveKey recognizes PageUp/PageDown, ctrl+arrows and [ ]", () => {
    expect(isLaneMoveKey("PageUp", false)).toBe(-1);
    expect(isLaneMoveKey("PageDown", false)).toBe(1);
    expect(isLaneMoveKey("[", false)).toBe(-1);
    expect(isLaneMoveKey("]", false)).toBe(1);
    expect(isLaneMoveKey("ArrowUp", true)).toBe(-1);
    expect(isLaneMoveKey("ArrowDown", true)).toBe(1);
    expect(isLaneMoveKey("ArrowUp", false)).toBeNull();
    expect(isLaneMoveKey("ArrowDown", false)).toBeNull();
    expect(isLaneMoveKey("Tab", false)).toBeNull();
  });

  it("laneMoveIndex clamps at the first/last lane — no wrap", () => {
    expect(laneMoveIndex(0, 4, -1)).toBe(0);
    expect(laneMoveIndex(3, 4, 1)).toBe(3);
    expect(laneMoveIndex(0, 4, 1)).toBe(1);
    expect(laneMoveIndex(2, 4, 1)).toBe(3);
  });

  it("carryCellTo clamps row + step into the target grid's shape", () => {
    // drums row 5 (TOM) carried into a chords grid with 7 rows → row 5 stays;
    // a long step carried into a 1-bar pattern clamps to 15.
    expect(carryCellTo({ row: 5, step: 10 }, { rows: 7, steps: 16 })).toEqual({
      row: 5,
      step: 10,
    });
    expect(carryCellTo({ row: 5, step: 10 }, { rows: 7, steps: 64 })).toEqual({
      row: 5,
      step: 10,
    });
    expect(carryCellTo({ row: 5, step: 30 }, { rows: 7, steps: 16 })).toEqual({
      row: 5,
      step: 15,
    });
    expect(carryCellTo({ row: 13, step: 3 }, { rows: 7, steps: 16 })).toEqual({
      row: 6,
      step: 3,
    });
    expect(carryCellTo({ row: 2, step: -4 }, { rows: 7, steps: 16 })).toEqual({
      row: 2,
      step: 0,
    });
  });
});
