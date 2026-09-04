/**
 * IN-2 pointer-gesture + keyboard note-edit logic, and the IN-3 rail cue
 * sweep — PURE (no DOM), the src/grid/keynav.ts precedent: the renderer
 * wires DOM pointer/keyboard events onto these reducers, LaneGrid commits
 * through the SC-2 store note actions, PatternRail commits through the
 * requestPatternSwitch funnel. Everything here is unit-testable without a
 * browser.
 *
 * Laws implemented (docs/dev/keyboard.md v2 §"Note editing on the v2 note
 * model"; a11y §7 E4/E5):
 * - Single click = the lane's gate-default length (I2-3, backward compatible);
 *   a drag across segments creates ONE sustained note spanning them.
 * - Edge-drag resizes the note's LENGTH (right edge only — the left edge
 *   would move the note's start, which has no keyboard equivalent in the
 *   spec, and pointer/keyboard state parity is law (E5)).
 * - Keyboard resize: `+`/`-` = ±1 step, Shift = ±0.25; snap 0.25, clamp
 *   [MIN, MAX]; no-ops at the bounds (never wrap).
 * - Enter mid-span = trim to end at the focused step (length = step −
 *   start + 1); no-op when the note already ends there.
 * - Drums drag = paint hits (I2-4 one-shot law); painting never erases.
 *
 * Gesture law (Thor/plan): pointermove NEVER writes the store — previews are
 * renderer-local (data-preview cells + a dashed bar, the euclid precedent);
 * the commit happens once, on release.
 */

import type { LaneId } from "../document/schema";
import type { RailCell } from "../state/patternRail";
import {
  MAX_NOTE_LENGTH,
  MIN_NOTE_LENGTH,
  NOTE_LENGTH_GRANULARITY,
} from "../document/schema";

/**
 * A note reduced to what interaction needs (start + length in steps). The
 * renderer works per ROW (degree already resolved), so degree is not part of
 * the interaction math — store Notes satisfy this shape directly.
 */
export interface Span {
  readonly start: number;
  readonly length: number;
}

/** Snap onto the 0.25-step note grid, clamped to the schema bounds. */
export function snapSpanLength(length: number): number {
  const snapped =
    Math.round(length / NOTE_LENGTH_GRANULARITY) * NOTE_LENGTH_GRANULARITY;
  return Math.min(MAX_NOTE_LENGTH, Math.max(MIN_NOTE_LENGTH, snapped));
}

/** Human length text: 2 → "2", 2.25 → "2.25" (multiples of 0.25 are exact). */
export function formatSpanLength(length: number): string {
  return String(snapSpanLength(length));
}

/** The announcement text for a resize commit (E4: `LENGTH <len> ST`). */
export function lengthAnnouncement(length: number): string {
  return `LENGTH ${formatSpanLength(length)} ST`;
}

/**
 * The focused note on a row (keyboard.md v2): the span covering the focused
 * step (`start ≤ step < start + length`); an ANCHOR (exact start) wins first,
 * otherwise the latest-starting note still sounding (deterministic — overlaps
 * are legal per schema). -1 when nothing covers the step.
 */
export function focusedSpanIndex(spans: readonly Span[], step: number): number {
  let covering = -1;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.start === step) return i; // anchor wins immediately
    if (step > span.start && step < span.start + span.length) covering = i;
  }
  return covering;
}

/** The decision for activating (click / Enter / Space) a pitched cell. */
export type NoteEditDecision =
  | { readonly kind: "place"; readonly length: number }
  | { readonly kind: "remove"; readonly span: Span }
  | { readonly kind: "trim"; readonly span: Span; readonly length: number }
  | { readonly kind: "none" };

/**
 * The v2 toggle law on one row's spans: empty cell → place a gate-default
 * note; note anchor → remove it; mid-span → trim to end at the focused step.
 * `gateSteps` is the lane's effective gate at the current BPM (single-click
 * default — I2-3).
 */
export function noteEditAt(
  spans: readonly Span[],
  gateSteps: number,
  step: number,
): NoteEditDecision {
  const idx = focusedSpanIndex(spans, step);
  if (idx < 0) return { kind: "place", length: snapSpanLength(gateSteps) };
  const span = spans[idx];
  if (span.start === step) return { kind: "remove", span };
  const length = snapSpanLength(step - span.start + 1);
  // "No-op when the note already ends here" — the caller still sees the trim
  // decision (store resizeNote itself no-ops on an unchanged snapped length).
  return { kind: "trim", span, length };
}

/**
 * Resize by a keyboard step (`+`/`-` ±1, Shift ±0.25): snap + clamp; returns
 * the SAME length at the bounds (0.25 floor / 128 ceiling — no wrap, no-op).
 */
export function resizeBy(current: number, delta: number): number {
  return snapSpanLength(current + delta);
}

// ---------------------------------------------------------------------------
// Pointer gesture state (pure reducers; renderer feeds step-space coords)
// ---------------------------------------------------------------------------

/** A pitched drag-create gesture, row-locked (the degree you pressed). */
export interface CreateDrag {
  readonly row: number;
  /** Anchor step (where the pointer went down). */
  readonly start: number;
  /** Current drag extent (≥ start; clamped to the pattern). */
  readonly end: number;
  readonly steps: number;
}

export function createDragBegin(
  row: number,
  start: number,
  steps: number,
): CreateDrag {
  const clamped = Math.min(Math.max(start, 0), steps - 1);
  return { row, start: clamped, end: clamped, steps };
}

/** Extend the drag to `step` (never left of the anchor — notes start there). */
export function createDragMove(drag: CreateDrag, step: number): CreateDrag {
  const end = Math.min(Math.max(step, drag.start), drag.steps - 1);
  return end === drag.end ? drag : { ...drag, end };
}

/**
 * The committed length: null when the pointer never left the anchor segment
 * (a single click — the gate-default law applies instead), else the span in
 * whole steps (`end − start + 1`).
 */
export function createDragLength(drag: CreateDrag): number | null {
  if (drag.end <= drag.start) return null;
  return drag.end - drag.start + 1;
}

/** An edge-drag resize gesture over one note. */
export interface ResizeDrag {
  readonly row: number;
  readonly start: number;
  /** Gesture origin length (for no-op detection). */
  readonly from: number;
  /** Current preview length (0.25 grid, clamped). */
  readonly length: number;
}

export function resizeDragBegin(row: number, span: Span): ResizeDrag {
  return { row, start: span.start, from: span.length, length: span.length };
}

/** Track the pointer position (in steps from the pattern origin). */
export function resizeDragMove(
  drag: ResizeDrag,
  pointerStep: number,
): ResizeDrag {
  const length = snapSpanLength(pointerStep - drag.start);
  return length === drag.length ? drag : { ...drag, length };
}

/** The committed length, or null when nothing changed (press without drag). */
export function resizeDragCommit(drag: ResizeDrag): number | null {
  if (drag.length === drag.from) return null;
  return drag.length;
}

/** A drums paint gesture, row-locked (painting hits on one piece's row). */
export interface PaintDrag {
  readonly row: number;
  /** Where the pointer went down. */
  readonly anchor: number;
  readonly from: number;
  readonly to: number;
  readonly steps: number;
}

export function paintDragBegin(
  row: number,
  step: number,
  steps: number,
): PaintDrag {
  const clamped = Math.min(Math.max(step, 0), steps - 1);
  return { row, anchor: clamped, from: clamped, to: clamped, steps };
}

/** Paint extends in EITHER direction from the anchor (a swept range). */
export function paintDragMove(drag: PaintDrag, step: number): PaintDrag {
  const to = Math.min(Math.max(step, 0), drag.steps - 1);
  return to === drag.to ? drag : { ...drag, to };
}

/** The inclusive painted step range. */
export function paintDragRange(drag: PaintDrag): {
  readonly from: number;
  readonly to: number;
} {
  return {
    from: Math.min(drag.anchor, drag.to),
    to: Math.max(drag.anchor, drag.to),
  };
}

// ---------------------------------------------------------------------------
// IN-3 multi-clip cue sweep (pure reducers; PatternRail feeds tile addresses)
// ---------------------------------------------------------------------------

/**
 * A FREEFORM cue sweep across rail tiles (the recorded gesture-geometry
 * decision: press a tile, sweep across sibling tiles and/or into other
 * lanes' rows — no lasso, no rect snap). Commit law: every TOUCHED lane
 * cues its LAST-touched tile — the exact state clicking each touched tile
 * in sweep order would leave (IM-7 same-lane supersede included), so the
 * gesture's pending/quantized semantics are identical to individual clicks.
 * Like every drag reducer: pointermove NEVER writes the store or the
 * engine — previews are renderer-local; the commit happens once, on release.
 */
export interface CueSweep {
  /** Where the pointer went down (the gesture's first touched tile). */
  readonly origin: RailCell;
  /** Every touched tile, "lane:slot" keys (the preview set). */
  readonly touched: ReadonlySet<string>;
  /** Per touched lane row, the LAST slot the sweep touched (the cue target). */
  readonly lastByLane: ReadonlyMap<LaneId, number>;
}

const cellKey = (lane: LaneId, slot: number): string => `${lane}:${slot}`;

export function cueSweepBegin(lane: LaneId, slot: number): CueSweep {
  return {
    origin: { lane, slot },
    touched: new Set([cellKey(lane, slot)]),
    lastByLane: new Map([[lane, slot]]),
  };
}

/**
 * Track the pointer over a tile. `lane === null` = off-tile (row gaps, the
 * tools, outside the rail): the sweep state is unchanged. Returns the SAME
 * object when nothing changed (the renderer's no-rerender guard).
 */
export function cueSweepMove(
  sweep: CueSweep,
  lane: LaneId | null,
  slot: number,
): CueSweep {
  if (lane === null) return sweep;
  if (sweep.lastByLane.get(lane) === slot && sweep.touched.has(cellKey(lane, slot)))
    return sweep;
  const touched = new Set(sweep.touched);
  touched.add(cellKey(lane, slot));
  const lastByLane = new Map(sweep.lastByLane);
  lastByLane.set(lane, slot);
  return { ...sweep, touched, lastByLane };
}

/**
 * True once the pointer reached any tile other than the pressed one — the
 * drag/click disambiguation. Unmoved presses fall back to the native click
 * law (v0 single-tile cue, dblclick edits untouched).
 */
export function cueSweepMoved(sweep: CueSweep): boolean {
  return sweep.touched.size > 1;
}

/**
 * The commit: one cue target per touched lane, rows top→bottom; per lane
 * the LAST-touched tile. `rows` is the rail's lane order (drums → lead).
 */
export function cueSweepCommit(
  sweep: CueSweep,
  rows: readonly LaneId[],
): RailCell[] {
  const targets: RailCell[] = [];
  for (const lane of rows) {
    const slot = sweep.lastByLane.get(lane);
    if (slot !== undefined) targets.push({ lane, slot });
  }
  return targets;
}

// ---------------------------------------------------------------------------
// MB-2 (mobile slice): touch TAP TWINS — the dblclick gestures under touch
// input. Pure decision helpers; the rail feeds real pointerup coordinates.
// ---------------------------------------------------------------------------

/**
 * One recorded touch tap: viewport coords + the interaction clock (ms) + a
 * caller-defined target identity ("lane:slot" — or "lane:slot:cue" when the
 * tap landed on the tile's cue line, which owns its OWN edit action).
 */
export interface TapRecord {
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly target: string;
}

/** Two taps within this many ms count as a dbltap (the platform convention). */
export const DBLTAP_WINDOW_MS = 400;
/** ...and within this many px (fingers land imprecisely). */
export const DBLTAP_RADIUS_PX = 40;

/**
 * True when `next` completes a double-tap on the same target as `prev`:
 * same target identity, inside the time window, inside the radius. The
 * touch twin of the browser's dblclick — callers run it only for TOUCH
 * pointers, so a mouse dblclick can never double-fire the action.
 */
export function isDoubleTap(
  prev: TapRecord | null,
  next: TapRecord,
): boolean {
  if (!prev) return false;
  if (prev.target !== next.target) return false;
  if (next.time - prev.time > DBLTAP_WINDOW_MS) return false;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  return Math.sqrt(dx * dx + dy * dy) <= DBLTAP_RADIUS_PX;
}
