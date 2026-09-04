/**
 * IN-2 unit gate — the pure pointer-gesture + keyboard note-edit math
 * (src/interaction/drag.ts), the keynav.ts precedent: no DOM, no store.
 * Browser journeys (pointer-event simulation against the real app) live in
 * tests/browser/drag-notes.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  type CreateDrag,
  type PaintDrag,
  type ResizeDrag,
  type Span,
  createDragBegin,
  createDragLength,
  createDragMove,
  focusedSpanIndex,
  formatSpanLength,
  lengthAnnouncement,
  noteEditAt,
  paintDragBegin,
  paintDragMove,
  paintDragRange,
  resizeBy,
  resizeDragBegin,
  resizeDragCommit,
  resizeDragMove,
  snapSpanLength,
} from "../src/interaction/drag";
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from "../src/document/schema";

const span = (start: number, length: number): Span => ({ start, length });

describe("IN-2 pure note-edit math", () => {
  // -- length grid ----------------------------------------------------------

  it("snaps to the 0.25 grid and clamps to the schema bounds", () => {
    expect(snapSpanLength(1.1)).toBe(1);
    expect(snapSpanLength(1.2)).toBe(1.25);
    expect(snapSpanLength(0.1)).toBe(MIN_NOTE_LENGTH);
    expect(snapSpanLength(0)).toBe(MIN_NOTE_LENGTH);
    // v3 (SV-1, J8): the ceiling widened to the 128-bar step space. Boundary
    // neighbors pin it exactly: 2047.75 is in-bounds, 2048.25 clamps to 2048.
    expect(snapSpanLength(2047.75)).toBe(2047.75);
    expect(snapSpanLength(1000)).toBe(1000); // v2's ceiling is mid-range now
    expect(snapSpanLength(2048.25)).toBe(MAX_NOTE_LENGTH);
    expect(snapSpanLength(5000)).toBe(MAX_NOTE_LENGTH);
    expect(snapSpanLength(-3)).toBe(MIN_NOTE_LENGTH);
  });

  it("formats lengths without float noise and builds the E4 announcement", () => {
    expect(formatSpanLength(2)).toBe("2");
    expect(formatSpanLength(2.25)).toBe("2.25");
    expect(formatSpanLength(0.25)).toBe("0.25");
    expect(lengthAnnouncement(4)).toBe("LENGTH 4 ST");
    expect(lengthAnnouncement(3.75)).toBe("LENGTH 3.75 ST");
  });

  // -- focused note (keyboard.md v2 definition) ------------------------------

  it("focuses the anchor first, then the latest-starting covering note", () => {
    const spans = [span(0, 4), span(2, 2)];
    expect(focusedSpanIndex(spans, 0)).toBe(0); // anchor of the first
    expect(focusedSpanIndex(spans, 2)).toBe(1); // anchor beats covering
    expect(focusedSpanIndex(spans, 1)).toBe(0); // covered by the first only
    expect(focusedSpanIndex(spans, 3)).toBe(1); // covered by the latest start
    expect(focusedSpanIndex(spans, 4)).toBe(-1); // end is exclusive
    expect(focusedSpanIndex(spans, 9)).toBe(-1);
  });

  it("focused span law holds for fractional lengths (start ≤ step < start+length)", () => {
    const spans = [span(2, 1.5)];
    expect(focusedSpanIndex(spans, 2)).toBe(0); // anchor
    expect(focusedSpanIndex(spans, 3)).toBe(0); // 3 < 3.5 → covered
    expect(focusedSpanIndex(spans, 4)).toBe(-1); // 4 ≥ 3.5 → past the end
  });

  // -- the v2 toggle law (click / Enter / Space) ------------------------------

  it("places a gate-default note on an empty cell", () => {
    expect(noteEditAt([], 2, 5)).toEqual({ kind: "place", length: 2 });
    expect(noteEditAt([span(0, 1)], 0.25, 3)).toEqual({
      kind: "place",
      length: 0.25,
    });
  });

  it("removes at a note's anchor", () => {
    const s = span(4, 3);
    expect(noteEditAt([s], 2, 4)).toEqual({ kind: "remove", span: s });
  });

  it("trims mid-span to end at the focused step (length = step − start + 1)", () => {
    const s = span(2, 6);
    expect(noteEditAt([s], 2, 5)).toEqual({
      kind: "trim",
      span: s,
      length: 4,
    });
    // Trim is also the extension path for fractional tails: the note ends at
    // 3.5; focusing step 3 drags the right edge to 4.
    expect(noteEditAt([span(2, 1.5)], 2, 3)).toEqual({
      kind: "trim",
      span: span(2, 1.5),
      length: 2,
    });
    // Already ending here = the trimmed length equals the current length
    // (the caller's store resize no-ops; the decision stays observable).
    expect(noteEditAt([span(2, 4)], 2, 5)).toEqual({
      kind: "trim",
      span: span(2, 4),
      length: 4,
    });
  });

  it("applies the anchor-wins law to the edit decision (covering note, not its span)", () => {
    const early = span(0, 8);
    const late = span(4, 2);
    expect(noteEditAt([early, late], 1, 4)).toEqual({
      kind: "remove",
      span: late,
    });
    expect(noteEditAt([early, late], 1, 5)).toEqual({
      kind: "trim",
      span: late,
      length: 2,
    });
  });

  // -- keyboard resize --------------------------------------------------------

  it("resizes ±1 and ±0.25 with clamps at both bounds (never wraps)", () => {
    expect(resizeBy(2, 1)).toBe(3);
    expect(resizeBy(2, -1)).toBe(1);
    expect(resizeBy(2, 0.25)).toBe(2.25);
    expect(resizeBy(2.25, -0.25)).toBe(2);
    expect(resizeBy(MIN_NOTE_LENGTH, -1)).toBe(MIN_NOTE_LENGTH); // floor no-op
    expect(resizeBy(MIN_NOTE_LENGTH, -0.25)).toBe(MIN_NOTE_LENGTH);
    expect(resizeBy(MAX_NOTE_LENGTH, 1)).toBe(MAX_NOTE_LENGTH); // ceiling no-op
    expect(resizeBy(MAX_NOTE_LENGTH - 0.25, 0.25)).toBe(MAX_NOTE_LENGTH);
  });

  // -- drag-create gesture -----------------------------------------------------

  it("drag-create spans whole segments and never crosses its anchor leftward", () => {
    let d: CreateDrag = createDragBegin(3, 6, 16);
    expect(createDragLength(d)).toBeNull(); // no movement → click law
    d = createDragMove(d, 9);
    expect(createDragLength(d)).toBe(4); // steps 6..9 inclusive
    d = createDragMove(d, 2); // dragging left never shortens below the anchor
    expect(d.end).toBe(6);
    expect(createDragLength(d)).toBeNull();
    d = createDragMove(d, 40); // clamped at the pattern end
    expect(d.end).toBe(15);
    expect(createDragLength(d)).toBe(10);
  });

  // -- edge-resize gesture -----------------------------------------------------

  it("edge-drag tracks the 0.25 grid from the pointer position", () => {
    let d: ResizeDrag = resizeDragBegin(1, span(4, 2));
    expect(resizeDragCommit(d)).toBeNull(); // press without drag
    d = resizeDragMove(d, 8.4); // pointer at step 8.4 → 4.4 steps long
    expect(d.length).toBe(4.5);
    expect(resizeDragCommit(d)).toBe(4.5);
    d = resizeDragMove(d, 4.1); // never below the 0.25 floor
    expect(d.length).toBe(MIN_NOTE_LENGTH);
    // v3 ceiling (2048): lengths are pointer − start; a far pointer clamps
    // at the widened cap (start 4 → 4996 raw → 2048).
    d = resizeDragMove(d, 500);
    expect(d.length).toBe(496);
    d = resizeDragMove(d, 5000);
    expect(d.length).toBe(MAX_NOTE_LENGTH);
  });

  // -- drums paint gesture -----------------------------------------------------

  it("paint sweeps both directions from the anchor, clamped", () => {
    let p: PaintDrag = paintDragBegin(2, 10, 16);
    expect(paintDragRange(p)).toEqual({ from: 10, to: 10 });
    p = paintDragMove(p, 7);
    expect(paintDragRange(p)).toEqual({ from: 7, to: 10 });
    p = paintDragMove(p, 14);
    expect(paintDragRange(p)).toEqual({ from: 10, to: 14 });
    p = paintDragMove(p, 99);
    expect(paintDragRange(p)).toEqual({ from: 10, to: 15 }); // steps - 1
    p = paintDragMove(p, -5);
    expect(paintDragRange(p)).toEqual({ from: 0, to: 10 });
  });
});
