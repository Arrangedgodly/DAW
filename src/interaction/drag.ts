/**
 * IN-2 pointer-gesture + keyboard note-edit logic — PURE (no DOM), the
 * src/grid/keynav.ts precedent: the renderer wires DOM pointer/keyboard
 * events onto these reducers, LaneGrid commits through the SC-2 store note
 * actions. Everything here is unit-testable without a browser.
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
