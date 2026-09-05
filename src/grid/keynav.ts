/**
 * Pure grid keyboard-navigation math (DA-1 / docs/dev/keyboard.md).
 *
 * Law: NO WRAPPING — every move clamps at its bounds (documented in the
 * spec: focus never wraps because a wrapped cursor a screen-reader user
 * cannot predict is worse than a hard edge). These functions are pure so
 * the whole map is unit-testable without a DOM.
 */

/** Steps per 4/4 beat for the beat-jump keys (Ctrl+←/→, , .). */
export const BEAT_STEPS = 4;

export interface CellPos {
  readonly row: number;
  readonly step: number;
}

export interface GridDims {
  readonly rows: number;
  readonly steps: number;
}

export type GridMove =
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "beatBack"
  | "beatForward";

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/** Map a KeyboardEvent to a within-grid move; null = not a grid key. */
export function gridMoveForKey(key: string, ctrl: boolean): GridMove | null {
  if (ctrl) {
    if (key === "ArrowLeft") return "beatBack";
    if (key === "ArrowRight") return "beatForward";
    // Ctrl+Up/Down are lane moves, handled by the host — not a grid move.
    return null;
  }
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    // , / . are beat-jump alternates (spec: Ctrl+←/→ or , .)
    case ",":
      return "beatBack";
    case ".":
      return "beatForward";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return null;
  }
}

/** Next focused cell for a within-grid move (clamped, never wraps). */
export function nextCell(
  pos: CellPos,
  dims: GridDims,
  move: GridMove,
): CellPos {
  switch (move) {
    case "left":
      return { row: pos.row, step: clamp(pos.step - 1, 0, dims.steps - 1) };
    case "right":
      return { row: pos.row, step: clamp(pos.step + 1, 0, dims.steps - 1) };
    case "up":
      return { row: clamp(pos.row - 1, 0, dims.rows - 1), step: pos.step };
    case "down":
      return { row: clamp(pos.row + 1, 0, dims.rows - 1), step: pos.step };
    case "home":
      return { row: pos.row, step: 0 };
    case "end":
      return { row: pos.row, step: dims.steps - 1 };
    case "beatBack":
      return {
        row: pos.row,
        step: clamp(pos.step - BEAT_STEPS, 0, dims.steps - 1),
      };
    case "beatForward":
      return {
        row: pos.row,
        step: clamp(pos.step + BEAT_STEPS, 0, dims.steps - 1),
      };
  }
}

/** Lane order (top to bottom on the stage floor). */
export const LANE_ORDER = ["drums", "bass", "chords", "lead"] as const;
export type LaneName = (typeof LANE_ORDER)[number];

/**
 * Target lane index for a lane move (PageUp/PageDown, Ctrl+↑/↓, [ ]),
 * clamped at the first/last lane. Returns the SAME index at the edges —
 * no wrap (spec).
 */
export function laneMoveIndex(
  fromIndex: number,
  laneCount: number,
  dir: -1 | 1,
): number {
  return clamp(fromIndex + dir, 0, laneCount - 1);
}

/**
 * Carry a cell position into another lane's grid: row index and step are
 * kept but clamped to the target grid's (different) row count and pattern
 * length. Pure — the caller resolves actual row identity.
 */
export function carryCellTo(pos: CellPos, target: GridDims): CellPos {
  return {
    row: clamp(pos.row, 0, target.rows - 1),
    step: clamp(pos.step, 0, target.steps - 1),
  };
}

/** Is this key event a lane-move trigger? (PageUp/PageDown, Ctrl+↑/↓, [ ]) */
export function isLaneMoveKey(key: string, ctrl: boolean): -1 | 1 | null {
  if (key === "PageUp" || key === "[") return -1;
  if (key === "PageDown" || key === "]") return 1;
  if (ctrl && key === "ArrowUp") return -1;
  if (ctrl && key === "ArrowDown") return 1;
  return null;
}

/* ---------------------------------------------------------------------------
 * RC-1 (v3): register-window math — pure so the whole window law is
 * unit-testable without a DOM (the spec's "Where things live" row: clamp +
 * focus-anchor live here). The window is a scroll POSITION of the grid body
 * (docs/dev/keyboard.md §"Register window scroll"); `start` is the index of
 * the first VISIBLE row over the full row manifest.
 * ------------------------------------------------------------------------- */

/**
 * Clamp a window start into [0, rows − windowRows] (the manifest bounds; a
 * manifest that fits the window has exactly one legal start, 0).
 */
export function clampWindowStart(
  start: number,
  rows: number,
  windowRows: number,
): number {
  const maxStart = Math.max(0, rows - windowRows);
  return Math.min(Math.max(Math.round(start), 0), maxStart);
}

/**
 * THE FOCUS-ANCHOR LAW (E9): a Shift+↑/↓ window scroll may never move the
 * focused row out of view — the target clamps BOTH at the manifest bounds
 * AND at the last position that keeps `focusRow` visible
 * (start ≤ focusRow ≤ start + windowRows − 1). A target equal to the current
 * start is the blocked no-op the renderer announces as the edge.
 *
 * i3-1 (vertical fill law): `stepRows` separates the STEP from the window
 * HEIGHT — the fill grows windows past one octave, but the keys' committed
 * meaning (and announcement) is ONE OCTAVE, so callers pass the mode size
 * as the step; the anchor/bounds math stays on the LIVE window height.
 * Default stepRows = windowRows (the unwindowed-growth law, byte-identical).
 */
export function clampedWindowScroll(
  start: number,
  dir: -1 | 1,
  focusRow: number,
  rows: number,
  windowRows: number,
  stepRows: number = windowRows,
): number {
  const maxStart = Math.max(0, rows - windowRows);
  // Manifest bounds first …
  let target = Math.min(Math.max(start + dir * stepRows, 0), maxStart);
  // … then the anchor window [focusRow − windowRows + 1, focusRow] (which is
  // never empty for windowRows ≥ 1), re-clamped at the manifest bounds so an
  // anchor row below the first window cannot push the start negative.
  target = Math.min(
    Math.max(target, focusRow - windowRows + 1),
    Math.max(focusRow, 0),
  );
  return Math.min(Math.max(target, 0), maxStart);
}
