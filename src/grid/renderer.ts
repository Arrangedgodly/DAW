/**
 * GridRenderer (DES-4, decision D1): the grid rendering seam. The DOM/CSS-Grid
 * implementation below is the default; a canvas fallback can slot in later for
 * the pitched lanes if profiling ever fails the 60 fps budget — it only needs
 * to satisfy this interface (NOT built yet; interface-only hedge per D1).
 *
 * Law (D1 / res-1): playhead + glow ride a rAF loop reading engine clock
 * time and writing `style.transform` / one-shot classes directly to the DOM —
 * NEVER framework reactive state. `contain: layout style paint` on rows;
 * toggling a cell is a class flip (no reflow-inducing DOM surgery).
 *
 * Law (D9 / res-9): glow is decoration-only over fill+border coding; one-shot
 * decay ≤180 ms; under prefers-reduced-motion (gated BOTH here via matchMedia
 * and in CSS) the sweep becomes a quantized column highlight and the trigger
 * glow a static on-state.
 *
 * LY-1 (quadrant layout): geometry is PARAMETERIZED — the v0 editing size
 * (24 px cells) stays the default; quadrant-scaled grids pass smaller cells.
 * FV-1 (I3-b): the WIDTH axis is fluid BY CONSTRUCTION — steps keep their
 * pinned px (the readability law; never bigger cells) while the grid lays
 * out at `max-content` inside the quadrant's scrollport, so a wider
 * quadrant (the retired 1400px stage cap) shows MORE STEPS before the
 * internal h-scroll. No new seam: the playhead/hit math already derives
 * from the same pinned stepWidthPx at every quadrant width.
 * A grid can be switched between EDITABLE and VIEW-ONLY at any time
 * (`setEditable`): view-only grids keep rendering live notes + playhead but
 * expose NO tab stops, NO focusable descendants, and ignore activation —
 * the quadrant's click handler selects instead (never a focus trap, E2).
 *
 * IN-2 (drag notes): pitched grids render NOTES natively — one `.note-run`
 * bar per note with a right-EDGE hit zone. Pointer gestures (drag-create from
 * an empty cell, edge-drag resize, drums paint) preview locally (zero store
 * writes — the euclid `data-preview` language) and commit once on release;
 * pointer capture keeps up-outside/pointercancel deliverable (the systematic
 * edge sweep is IN-4's). Keyboard equivalents (spec v2): `+`/`-` ±1 step,
 * Shift ±0.25 resize the focused note; Delete/Backspace removes it; resize
 * commits announce `LENGTH <len> ST` through a local aria-live span from BOTH
 * the pointer and the keyboard path (E4/E5 parity).
 *
 * LL-1 (iteration 3, i3-4 — LP-1 §10a, seams G3/G5/G6/G8): the COLUMN-WINDOW
 * virtualization. Patterns longer than GRID_VIRTUALIZE_MIN_STEPS (the v0.1
 * 4-bar maximum — every shipped shape stays EAGER and byte-identical) render
 * through a sticky-layer column window, the approach LP-1 measured and
 * committed: the scroll container keeps a native, pattern-wide scroll extent
 * via an invisible absolute SIZER, and a `position: sticky; left: 0` LAYER
 * holds the grid — the compositor pins it to the visible edge while the
 * sizer scrolls under it, with NO JS on the per-scroll path. Each row's
 * template carries ONLY the window's tracks; rewindow is hysteresis-gated
 * (fires only when the visible range exhausts the ±GRID_OVERSCAN_COLS
 * overscan) and RECYCLES the cell pool (re-tagging existing cells — zero
 * element churn), so rewindow layout scales with the WINDOW, never the
 * pattern (the spacer-span variant was measured and REJECTED, LP-1 §10a).
 * On-state reads are O(1) per cell (a flattened Uint8Array per row, rebuilt
 * per sync — the O(cells × spans) `some` per cell was the eager sweep cost);
 * note-runs are CLIPPED to the window (G6) with window-relative geometry and
 * true-span resize edges; the glow wrap modulus is the renderer's own step
 * count (G5 — self-consistent at any extent). Keyboard nav is window-aware
 * (G8): the cursor carry-clamps to the PATTERN extent, and moves past the
 * window re-seat it (scroll-to + rewindow) so Home/End/beat-jump keep their
 * exact meanings at any length.
 *
 * IN-2 FIX (verifier FAIL 2026-09-03): SINGLE-CLICK activation runs on
 * POINTERUP of an unmoved gesture, never on the trailing `click` — Chromium
 * retargets the click that follows a captured press to the capture element
 * (this container), so a click-target cell check can never pass under REAL
 * pointers (synthetic test pointers cannot capture, which is why the old
 * click-only law passed its gates). The `click` listener stays only for
 * bare synthetic clicks (HTMLElement.click(), e2e drivers) and is suppressed
 * after every pointerup activation so a real click activates exactly once.
 */

import type { DrumPattern, LaneId } from "../document/schema";
import { DRUM_PIECES } from "../document/schema";
import {
  type PlayheadOptions,
  playheadX,
  quantizedStep,
  stepsCrossed,
} from "./math";
import {
  type CellPos,
  clampedWindowScroll,
  clampWindowStart,
  gridMoveForKey,
  isLaneMoveKey,
  nextCell,
} from "./keynav";
import {
  type CreateDrag,
  type PaintDrag,
  type ResizeDrag,
  type Span,
  createDragBegin,
  createDragLength,
  createDragMove,
  lengthAnnouncement,
  paintDragBegin,
  paintDragMove,
  paintDragRange,
  focusedSpanIndex,
  resizeBy,
  resizeDragBegin,
  resizeDragCommit,
  resizeDragMove,
} from "../interaction/drag";

/** Default geometry = the v0 full-floor editing size. */
export const GRID_CELL_PX = 24;
export const GRID_GAP_PX = 2;
export const GRID_LABEL_PX = 72;
/**
 * PX-3 fill-rail slot width (drums rows only). Refinement-2 (critique P1-2):
 * sized to FIT the control stack (E tag + pulses/rotation steppers + SET =
 * 207.3 px at the 4-bar "64/64" readout worst case) + 8 px trailing gutter +
 * headroom — at the old narrower slots the control overflowed UNDER the row
 * cells and SET was pointer-dead.
 */
export const GRID_FILL_RAIL_PX = 220;
/**
 * LL-1 (seam I1): the euclid readout at 8+ bars reads "2048/2048" — 4 glyphs
 * wider than the 220 px slot's 2-digit worst case (~28 px at the value font).
 * The INLINE desktop slot widens by exactly that for windowed patterns only
 * (production-tunable per the RC-1/FV-1 precedent); every ≤4-bar shape keeps
 * the committed 220 px byte-identically (the 1-bar no-scroll fit law), and
 * the phone/tablet OVERLAY rail is out of flow (content-sized) — untouched.
 */
export const GRID_FILL_RAIL_LONG_PX = 28;
/**
 * LL-1 (LP-1 §10a): grids at or below this step count render EAGER —
 * today's law, byte-identical DOM (64 steps = the v0.1 4-bar maximum, every
 * shipped shape; the LP-1 eager budget holds there with 2× headroom).
 * Above it (8..128 bars — the LL-1 vocabulary), the sticky-layer column
 * window takes over: DOM cells scale with the window, never the pattern.
 */
export const GRID_VIRTUALIZE_MIN_STEPS = 64;
/**
 * LL-1: overscan columns kept beyond each visible edge. The LP-1 harness
 * tuned 24 on its UNSTYLED prototype (it imports base.css only); on the
 * styled production grid the rewindow's paint cost scales with the window
 * area (the D9 glow shadow's raster dominates — measured in-task), so the
 * production window runs TIGHTER: 8 keeps every rewindow inside one frame
 * even at the LP-1 fling worst case (measured 100.0% < 33.4 ms, median
 * 16.6 ms) while still amortizing rewindows to ~1 per frame mid-sweep.
 */
export const GRID_OVERSCAN_COLS = 8;
/**
 * IN-2/IN-4: right-edge resize hit-zone width (px, inward from the note's
 * right edge — the IN-4 honest-geometry law: the zone never overhangs the
 * bar's right edge into the NEXT cell, and stays ≤ this width inside the bar
 * so the tap law remains reachable at 1-step notes' centers).
 */
export const NOTE_EDGE_HIT_PX = 5;

export interface PlayheadFrame {
  readonly playing: boolean;
  /** Loop-relative seconds (transport timeline; swing applied). */
  readonly loopTime: number;
  readonly options: PlayheadOptions;
}

export interface GridRendererHost {
  /** Polled once per animation frame; null frame = park the playhead. */
  readonly readFrame: () => PlayheadFrame | null;
  /** Reduced-motion gate (matchMedia) — the render loop must also honor it. */
  readonly prefersReducedMotion: () => boolean;
}

/**
 * IN-2: what a pitched grid syncs — NOTES per rendered row (row order =
 * opts.rowLabels; the owner already resolved degrees → rows). Lengths live on
 * the 0.25-step grid and MAY overhang the pattern end (schema law, loops
 * wrap).
 */
export interface PitchedNotesView {
  readonly kind: "pitched";
  readonly rows: ReadonlyArray<readonly Span[]>;
}

export interface DomGridRendererOptions {
  readonly container: HTMLElement;
  readonly laneId: LaneId;
  readonly laneLabel: string;
  /** One per row, top to bottom. */
  readonly rowLabels: readonly string[];
  readonly steps: number;
  /** Sounding-note widths (pitched lanes only). */
  readonly pitched: boolean;
  readonly host: GridRendererHost;
  /** Cell box px (default 24 — the v0 editing size). */
  readonly cellPx?: number;
  /**
   * Refinement-4 (critique P2-5, the 1280×800 one-page breach — vertical
   * half): the row-track HEIGHT px, decoupled from cellPx. The horizontal
   * geometry (cellPx → stepWidthPx → playhead/hit math) stays renderer-pinned
   * law; the VERTICAL track is the axis the quadrant stage compresses when
   * the 100dvh budget is short (setRowHeight — the owner's viewport-budget
   * fit). Default = cellPx (v0 square cells, byte-identical when never set).
   */
  readonly rowHeightPx?: number;
  /** Horizontal gap between cells (default 2). */
  readonly gapPx?: number;
  /** Row-label gutter px (default 72). */
  readonly labelPx?: number;
  /** Fill-rail slot width (default 152; drums mountFillControl only). */
  readonly fillRailPx?: number;
  /**
   * MB-1 (mobile slice): where the drums fill-rail slot lives.
   * "inline" (default — the desktop law): the stable-width slot sits BETWEEN
   * the row label and the cells, and the playhead offset includes it.
   * "overlay" (narrow stages — phone + tablet): the slot overlays the cells
   * at label-left, OUT of flow (focus-revealed; MB-3 adds the touch reveal
   * twin), so the cells start right after the label, the playhead offset is
   * the label alone, and a 1-bar pattern fits the narrow viewport (the
   * committed scrolling law's default view). The slot keeps its
   * renderer-pinned width (the refinement-2 drift law).
   */
  readonly fillRailMode?: "inline" | "overlay";
  /** Start editable (default true). `setEditable` flips it live. */
  readonly editable?: boolean;
  /** Cell activated (click / Enter / Space) — owner writes the document. */
  readonly onToggle: (row: number, step: number) => void;
  /**
   * DA-1: lane move requested from inside the grid (PageUp/PageDown,
   * Ctrl+↑/↓, [ ]) — the owner coordinates cross-lane focus because
   * renderers are per-lane and DOM-sibling agnostic.
   */
  readonly onLaneMove?: (dir: -1 | 1, from: CellPos) => void;
  /** DA-1: audition the focused cell WITHOUT toggling (Shift+Enter). */
  readonly onAudition?: (row: number, step: number) => void;
  /**
   * DA-1: Escape pops focus to the region head (the lane header's first
   * control). Default implementation walks up to the owning lane floor.
   */
  readonly onEscape?: () => void;
  /**
   * Refinement-1 (critique P1-1): consulted FIRST on Escape — returns true
   * when an overlay covering this grid (the FX console) consumes the
   * keystroke. The owner closes the overlay; the region-head pop stands
   * down for that Escape (keyboard.md v2: pop applies only once the
   * console is closed — one consumer per keystroke).
   */
  readonly onEscapeCovered?: () => boolean;
  /**
   * MB-2 (mobile slice): consulted BEFORE onEscapeCovered — returns true
   * when the fill-rails reveal (the narrow-stage overlay state, innermost
   * row-local surface) consumes the keystroke. The owner closes the
   * reveal; one consumer per keystroke (keyboard.md v2 Escape order:
   * row-local surfaces before the console cover before the region pop).
   */
  readonly onEscapeFillRails?: () => boolean;
  /**
   * PX-3 (drums only): mount a per-row fill control into the row's dedicated
   * rail slot. Called once per row during build; the owner renders its own
   * framework UI into `el` and owns that subtree's lifecycle.
   */
  readonly mountFillControl?: (row: number, el: HTMLElement) => void;
  /** IN-2 (pitched): pointer drag created a note — owner commits + auditions. */
  readonly onNoteCreate?: (row: number, start: number, length: number) => void;
  /**
   * IN-2 (pitched): note length committed (edge-drag release OR keyboard
   * `+`/`-`) — owner resizes through the store; the renderer announces.
   */
  readonly onNoteResize?: (row: number, start: number, length: number) => void;
  /** IN-2 (pitched): keyboard Delete/Backspace removed the focused note. */
  readonly onNoteRemove?: (row: number, start: number) => void;
  /**
   * IN-2 (drums): drag painted hits — every cell in the swept range that was
   * OFF at gesture start. The owner turns exactly these on (one gesture,
   * coalesced undo).
   */
  readonly onDrumsPaint?: (
    cells: ReadonlyArray<{ row: number; step: number }>,
  ) => void;
  /**
   * RC-1 (v3): the register window MOVED from inside the grid (Shift+↑/↓
   * keys, wheel scroll, the window-follows-focus law) — the owner persists
   * the new start as lane view state (selection.ts). View-only by law: the
   * owner never writes the document from this callback.
   */
  readonly onWindowScroll?: (start: number) => void;
}

export interface GridRenderer {
  /** Request a cell activation (visual state arrives via sync()). */
  toggle(row: number, step: number): void;
  /** DA-1: move DOM focus + the roving tabindex to a cell (clamped). */
  focusCell(row: number, step: number): void;
  /**
   * LL-1: the roving cursor (row + step) — the remembered editing place.
   * The resize remount law (keyboard.md v3): when a resize rebuilds the
   * grid, a cursor that was focused lands on the CARRIED cell — same row,
   * step clamped to the new extent's last step. Null before the first seed.
   */
  cursor(): { row: number; step: number } | null;
  /**
   * LY-1: focus the grid's CURRENT roving cell without moving the cursor —
   * the strip `]`/`[` escape hatch lands where this grid left off.
   */
  focusRoving(): void;
  /**
   * LY-1 quadrant state: editable grids own the region's tab stop + keys;
   * view-only grids keep rendering (sync/playhead/glow) with NO tab stops
   * and no focusable descendants (E2 — never a focus trap).
   */
  setEditable(editable: boolean): void;
  /** Position the playhead light bar (px) or park it (null). */
  setPlayhead(x: number | null): void;
  /**
   * Refinement-4 (critique P2-5): re-pin the vertical row-track px live
   * (the quadrant viewport-budget fit — rotation/resize mid-session). Pure
   * geometry: class-visible state and the rAF loop are untouched, so the
   * v0 resize law (a resize never strands the playhead) holds by
   * construction.
   */
  setRowHeight(px: number): void;
  /**
   * RC-1 (v3): set the register window — the grid body becomes an internally
   * scrolling pane showing `heightRows` rows, with the FULL row manifest
   * staying in the DOM (the construction law: rows are bounded by the
   * manifest — tens, not thousands; LP-1's windowing owns the column axis
   * only). `null` (or a height covering the manifest) restores the
   * unwindowed law byte-identically (chords/drums on heptatonic projects,
   * every phone-stage grid). The accessible name carries the visible range
   * while windowed (E9).
   */
  setWindow(heightRows: number | null, start?: number): void;
  /**
   * RC-1: scroll the window so `start` is the first visible row (clamped to
   * the manifest; no-op when unwindowed). The ≥1-row snap guard keeps a free
   * wheel scroll fractional — the renderer only re-seats on whole-window
   * moves (keys / lane view state).
   */
  scrollWindowTo(start: number, force?: boolean): void;
  /** One-shot trigger glow on the sounding cells of a column. */
  triggerGlow(step: number): void;
  /** Recompute cached geometry (after resize / font load). */
  layout(): void;
  /** Push document pattern state (class toggles only). */
  sync(pattern: DrumPattern | PitchedNotesView): void;
  /**
   * PX-3: paint a Euclidean PREVIEW overlay onto one row (dashed lane-hue
   * outline; never touches the committed on-state). Null clears the preview.
   */
  previewRow(row: number, on: readonly boolean[] | null): void;
  dispose(): void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** One active pointer gesture (IN-2). */
type Gesture =
  | { kind: "create"; pointerId: number; drag: CreateDrag; moved: boolean }
  | {
      kind: "resize";
      pointerId: number;
      drag: ResizeDrag;
      moved: boolean;
      runEl: HTMLElement;
    }
  | {
      kind: "paint";
      pointerId: number;
      drag: PaintDrag;
      moved: boolean;
      /** Steps OFF at gesture start ("row:step") — painting never erases. */
      offCells: ReadonlySet<string>;
    }
  /**
   * IN-2 fix: press on a COVERED pitched cell (anchor / mid-span). No
   * preview — pointerup runs the click law (remove / trim) directly, because
   * the trailing click is retargeted to the container under pointer capture.
   */
  | { kind: "tap"; pointerId: number; row: number; step: number };

/**
 * DOM/CSS-Grid default renderer. Builds the grid once (rows + cells + playhead
 * bar), then only mutates classes, one transform and data attributes.
 */
export class DomGridRenderer implements GridRenderer {
  private readonly opts: DomGridRendererOptions;
  private readonly cells: HTMLElement[][] = [];
  private readonly runLayers: (HTMLElement | null)[] = [];
  /** IN-2: committed note spans per row (drives runs, cells, names, keys). */
  private rowSpans: readonly (readonly Span[])[] = [];
  private playheadEl: HTMLElement | null = null;
  private raf = 0;
  private lastQuantized: number | null = null;
  private glowTimers = new Set<number>();
  private rovingCell: HTMLElement | null = null;
  private reducedMotion: MediaQueryList | null = null;
  /** LY-1 quadrant state (see setEditable). */
  private editable = true;
  /** Geometry (LY-1): cell/gap/label/fill px + derived step width. */
  private readonly cellPx: number;
  private readonly gapPx: number;
  private readonly labelPx: number;
  /** PX-3 fill-rail slot width (0 when no fill control is mounted). */
  private readonly fillPx: number;
  /** MB-1: the fill-rail slot overlays the cells (narrow stages). */
  private readonly fillOverlay: boolean;
  private readonly stepWidthPx: number;
  private readonly playheadLeftPx: number;
  /** Refinement-4: vertical row-track px (mutable — setRowHeight). */
  private rowHeightPx: number;
  /** One `.row-cells` per row — the vertical track pins (setRowHeight). */
  private readonly rowTracks: HTMLElement[] = [];
  /** One `.grid-row` per row (RC-1: window scroll geometry). */
  private readonly rowEls: HTMLElement[] = [];
  private gridEl: HTMLElement | null = null;
  /** IN-2 announcement span (E4 — the gate-stepper value pattern). */
  private lengthLiveEl: HTMLElement | null = null;
  /** RC-1 window-scroll announcement span (E9 — grid-local, VIEW wording). */
  private viewLiveEl: HTMLElement | null = null;
  /** RC-1: visible register window in rows; null = unwindowed (full manifest). */
  private windowRows: number | null = null;
  /**
   * RC-1: the AUTHORITATIVE semantic window start — the last INTENTIONAL
   * seat (keys, lane view state, focus-follow). Never derived from layout:
   * the scroll offset is geometry-dependent (row px + the editing/view-only
   * margin rhythm), so a measured start can drift a row across a state
   * flip; the name and the anchor math read THIS, and layout flips re-seat
   * the scroll onto it.
   */
  private seatedStart = 0;
  /** IN-2 active pointer gesture; null = idle. */
  private gesture: Gesture | null = null;
  /** IN-2 preview bar for a create-drag (removed on end). */
  private previewRunEl: HTMLElement | null = null;
  /** IN-2: swallow the click that follows a committed/cancelled gesture. */
  private suppressClick = false;
  /** RC-1: dispose() parks deferred seat re-anchors (rAF survives removal). */
  private disposed = false;
  private suppressClearTimer = 0;
  /* -- LL-1: the column window (see the header law) ------------------------ */
  /** True when steps > GRID_VIRTUALIZE_MIN_STEPS (sticky-layer windowing). */
  private readonly virtual: boolean;
  /**
   * The dedicated single-axis HORIZONTAL scroller holding the sizer + sticky
   * layer (virtual only — see build() for the two-axis-split law). Null on
   * eager grids; all horizontal math goes through hScroll().
   */
  private hscrollEl: HTMLElement | null = null;
  /** Window [start, end) in PATTERN steps; eager grids hold [0, steps). */
  private winStart = 0;
  private winEnd = 0;
  private readonly overscan = GRID_OVERSCAN_COLS;
  /** Flattened on-state per row over the FULL pattern: 0 off / 1 anchor / 2
   * sustain — rebuilt O(rows × steps) per sync, read O(1) per cell. */
  private rowOn: Uint8Array[] = [];
  /** Anchor note length per step (0 when not an anchor) — cell names. */
  private rowAnchorLen: number[][] = [];
  /** Axis discrimination for the shared scroll listener (RC-1 vertical vs
   * LL-1 horizontal) — skips the vertical seat's layout reads on x-scrolls. */
  private lastScrollLeft = 0;
  /** Last-seen vertical offset (the RC-1 seat's echo guard). */
  private seatedScrollTop = 0;
  /** Diagnostics (the LP-1 harness precedent): rewindow count + last cost. */
  rewindows = 0;
  lastRewindowMs = 0;
  /** LL-1: re-check the window once after the first layout frame (mount may
   * run before clientWidth exists — the fallback window corrects then). */
  private mountPending = false;

  constructor(opts: DomGridRendererOptions) {
    this.opts = opts;
    this.cellPx = opts.cellPx ?? GRID_CELL_PX;
    this.gapPx = opts.gapPx ?? GRID_GAP_PX;
    this.stepWidthPx = this.cellPx + this.gapPx;
    this.labelPx = opts.labelPx ?? GRID_LABEL_PX;
    this.rowHeightPx = opts.rowHeightPx ?? this.cellPx;
    // MB-1: overlay mode only exists where a fill control is mounted (drums).
    this.fillOverlay =
      !!opts.mountFillControl && (opts.fillRailMode ?? "inline") === "overlay";
    const baseFill = opts.mountFillControl
      ? (opts.fillRailPx ?? GRID_FILL_RAIL_PX)
      : 0;
    // LL-1 (seam I1): windowed patterns widen the inline rail for the
    // 4-digit readout ("2048/2048"); overlay rails are content-sized.
    this.fillPx =
      baseFill && !this.fillOverlay && opts.steps > GRID_VIRTUALIZE_MIN_STEPS
        ? baseFill + GRID_FILL_RAIL_LONG_PX
        : baseFill;
    // The playhead offset always matches where the CELLS actually start:
    // inline = label + fill slot; overlay = the label alone (the overlay is
    // out of flow, so the cells begin right after the label).
    this.playheadLeftPx = this.labelPx + (this.fillOverlay ? 0 : this.fillPx);
    this.editable = opts.editable ?? true;
    this.rowSpans = opts.rowLabels.map(() => []);
    this.virtual = opts.steps > GRID_VIRTUALIZE_MIN_STEPS;
    this.winEnd = opts.steps; // eager covers the pattern; virtual re-seats below
    this.build();
    if (this.virtual) {
      this.rewindow(true);
      this.mountPending = true;
    }
    this.seedRoving();
    this.loop();
  }

  // -- construction ---------------------------------------------------------

  private build(): void {
    const { container, rowLabels, steps } = this.opts;
    container.replaceChildren();
    // LL-1: the virtualized grid keeps a NATIVE, pattern-wide scroll extent
    // via an invisible absolute sizer, and the whole grid lives in a sticky
    // layer pinned to the visible edge by the compositor (grid.css owns the
    // positioning classes; the renderer pins the sizer's px). Eager grids
    // append the grid directly — today's DOM, byte-identical.
    //
    // TWO-AXIS SPLIT (measured in-task): the sizer + sticky layer live in a
    // DEDICATED single-axis horizontal scroller (.grid-hscroll), NOT in the
    // RC-1 vertical-window container — a sticky child inside a scroller
    // overflowing on BOTH axes re-lays-out per horizontal scroll step
    // (measured 65 ms/frame fling on the windowed lead grid); split into two
    // single-axis scrollers the same sweep runs at ~16.7 ms (the drums/
    // chords shape). The outer container keeps the whole RC-1 window law.
    let layerEl: HTMLElement | null = null;
    if (this.virtual) {
      const hscroll = document.createElement("div");
      hscroll.className = "grid-hscroll is-col-windowed";
      container.append(hscroll);
      this.hscrollEl = hscroll;
      const sizer = document.createElement("div");
      sizer.className = "grid-col-sizer";
      sizer.setAttribute("aria-hidden", "true");
      sizer.style.width = `${this.playheadLeftPx + steps * this.stepWidthPx}px`;
      hscroll.append(sizer);
      layerEl = document.createElement("div");
      layerEl.className = "grid-col-layer";
      hscroll.append(layerEl);
      hscroll.addEventListener("scroll", this.onScroll, { passive: true });
    }
    const grid = document.createElement("div");
    grid.className = this.opts.mountFillControl
      ? "lane-grid has-fill-rail"
      : "lane-grid";
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", this.gridAriaLabel());
    grid.dataset.editing = String(this.editable);
    this.gridEl = grid;

    const body = document.createElement("div");
    body.className = "grid-body";

    for (let row = 0; row < rowLabels.length; row++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.setAttribute("role", "row");
      // MB-1: paint containment would CLIP the out-of-flow fill overlay to
      // the row box — layout+style containment is enough for narrow drums
      // rows (the overlay needs to paint at its own height).
      rowEl.style.contain = this.fillOverlay
        ? "layout style"
        : "layout style paint";

      const label = document.createElement("div");
      label.className = "row-label";
      label.setAttribute("role", "rowheader");
      label.textContent = rowLabels[row];
      label.style.width = `${this.labelPx}px`;
      rowEl.append(label);

      const cellsEl = document.createElement("div");
      cellsEl.className = "row-cells";
      cellsEl.style.gridTemplateColumns = `repeat(${steps}, ${this.cellPx}px)`;
      // Refinement-4: the vertical track pins rowHeightPx (default cellPx) —
      // the axis the quadrant viewport-budget fit compresses live.
      cellsEl.style.gridAutoRows = `${this.rowHeightPx}px`;
      cellsEl.style.gap = `${this.gapPx}px`;
      this.rowTracks.push(cellsEl);

      const rowCells: HTMLElement[] = [];
      if (!this.virtual) {
        // Eager: every pattern cell exists up front — today's law. The
        // virtualized grid's POOL is created by rewindow() (recycled, only
        // the window's tracks ever exist).
        for (let step = 0; step < steps; step++) {
          const cell = document.createElement("div");
          cell.className = "cell";
          cell.setAttribute("role", "gridcell");
          cell.dataset.step = String(step);
          cell.dataset.row = String(row);
          // Beat shading: 4/4 grouping — odd beats read slightly raised.
          cell.dataset.beat = String(Math.floor(step / 4) % 2);
          cell.tabIndex = -1;
          cell.setAttribute("aria-label", this.cellName(row, step));
          cellsEl.append(cell);
          rowCells.push(cell);
        }
      }
      this.cells.push(rowCells);

      // Sustained-note layer (pitched only): one bar per note, each with a
      // right-edge resize hit zone (IN-2). aria-hidden — keyboard resize
      // happens from the focused CELL (spec v2), never from the bar.
      let runLayer: HTMLElement | null = null;
      if (this.opts.pitched) {
        runLayer = document.createElement("div");
        runLayer.className = "note-runs";
        runLayer.setAttribute("aria-hidden", "true");
        cellsEl.append(runLayer);
      }
      this.runLayers.push(runLayer);

      // PX-3 fill rail (drums only): a stable-width slot between the label
      // and the cells so the control can appear on hover/focus without ever
      // shifting the grid columns. The slot WIDTH is pinned INLINE from
      // fillRailPx (the label-pin precedent): the CSS fallback and this value
      // can never drift, and the playhead offset (playheadLeftPx = label +
      // fill) always matches the slot the DOM actually paints. Refinement-2
      // (critique P1-2): the slot must fit the mounted control — an
      // undersized rail let the control overflow UNDER the cells (SET
      // pointer-dead). DA-2: the slot is a gridcell so the row's
      // required-children contract holds (the fill control is a labeled
      // interactive group — legal inside a gridcell, not a bare row).
      if (this.opts.mountFillControl) {
        const fill = document.createElement("div");
        fill.className = "row-fill";
        fill.setAttribute("role", "gridcell");
        fill.dataset.row = String(row);
        if (this.fillOverlay) {
          // MB-1 overlay: anchored at label-left over the cells; the row
          // becomes its positioning context (grid-body would otherwise win)
          // and the slot paints as a floating chassis (see grid.css).
          // MB-3: the overlay does NOT pin the in-flow fillPx width — out of
          // flow, nothing depends on it (playheadLeftPx ignores it in overlay
          // mode), and the phone target law sizes the chassis to its CONTENT
          // (44 px steppers ≈ 300 px, wider than the 220 px inline slot;
          // grid.css owns the width + scrollport clamp).
          // MB-3 fix (verifier m2-3): --fill-left publishes this anchor to
          // CSS so the overlay's max-width can clamp against the SCROLLPORT
          // (its overflow clip), not the viewport — the published var and
          // the inline left are one law, pinned in the same breath (the
          // label-pin precedent).
          fill.classList.add("is-overlay");
          fill.style.left = `${this.labelPx}px`;
          fill.style.setProperty("--fill-left", `${this.labelPx}px`);
          rowEl.style.position = "relative";
        } else {
          fill.style.width = `${this.fillPx}px`;
        }
        rowEl.append(fill); // label → fill rail → cells (appended next)
        this.opts.mountFillControl(row, fill);
      }

      rowEl.append(cellsEl);
      body.append(rowEl);
      this.rowEls.push(rowEl);
    }

    // Playhead light bar — compositor-only (transform), spans all rows.
    const playhead = document.createElement("div");
    playhead.className = "grid-playhead";
    playhead.setAttribute("aria-hidden", "true");
    playhead.style.left = `${this.playheadLeftPx}px`;
    body.append(playhead);
    this.playheadEl = playhead;

    grid.append(body);
    // LL-1: virtualized grids append INTO the sticky layer; eager grids
    // straight into the container (today's shape).
    (layerEl ?? container).append(grid);

    // IN-2 E4: the local note-length announcement value span (gate-stepper
    // pattern). OUTSIDE the role=grid element so the grid's required-children
    // contract stays clean; NO aria-label (aria-prohibited-attr on live
    // regions — the DA-2 toasts lesson).
    const live = document.createElement("span");
    live.className = "head-sr note-length-live";
    live.setAttribute("aria-live", "polite");
    container.append(live);
    this.lengthLiveEl = live;

    // RC-1 E9: the grid-local window-scroll announcement span — same shape,
    // VIEW wording only (the conflation fence: window scrolls say VIEW,
    // OCT transposes say OCTAVE, never the other way around).
    const viewLive = document.createElement("span");
    viewLive.className = "head-sr view-live";
    viewLive.setAttribute("aria-live", "polite");
    container.append(viewLive);
    this.viewLiveEl = viewLive;

    container.addEventListener("click", this.onClick);
    container.addEventListener("keydown", this.onKeyDown);
    // RC-1: the windowed grid body scrolls internally — keep the semantic
    // start (name + lane view state) in step with any scroll source (the
    // pointer/wheel twin; no announcement fires for passive pointer scroll,
    // the E9 spam fence — the window is always readable from the grid name).
    // LL-1: the listener is shared with the COLUMN window — the axis check
    // inside keeps each law on its own axis.
    container.addEventListener("scroll", this.onScroll, { passive: true });
    // IN-2 pointer gestures (capture-on-down keeps up-outside deliverable).
    container.addEventListener("pointerdown", this.onPointerDown);
    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerup", this.onPointerUp);
    container.addEventListener("pointercancel", this.onPointerCancel);
    // IN-4: while a gesture owns the pointer, the grid owns the context menu
    // (an interrupting menu would strand the gesture — cancel is the only
    // clean mid-gesture exit, and it arrives as pointercancel).
    container.addEventListener("contextmenu", this.onContextMenu);
    if (typeof window !== "undefined" && window.matchMedia) {
      this.reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    }
  }

  /** E3 (a11y §7): the grid's accessible name carries the edit state in text.
   * RC-1 (E9): while windowed it also carries the VISIBLE row range —
   * `<LANE> grid · EDITING · ROWS 8–14 OF 14` (0-based row indexes, `OF` the
   * manifest's last index); when the whole manifest is visible the range is
   * omitted (today's name, byte-identical — chords/drums defaults). */
  private gridAriaLabel(): string {
    const base = `${this.opts.laneLabel} grid · ${this.editable ? "EDITING" : "VIEW ONLY"}`;
    if (!this.windowRows) return base;
    const start = this.seatedStart;
    return `${base} · ROWS ${start}–${start + this.windowRows - 1} OF ${this.cells.length - 1}`;
  }

  /**
   * E4 (a11y §7): the focused cell's name carries note state in text —
   * anchor: `<row> step <n>, note starts, <len> steps`; spanned:
   * `…, note continues`; empty: the v0 name.
   * LL-1: reads the flattened on-state O(1) (the old per-cell
   * focusedSpanIndex scan was the eager sync cost at long patterns).
   */
  private cellName(row: number, step: number): string {
    const base = `${this.opts.rowLabels[row]} step ${step + 1}`;
    if (!this.opts.pitched) return base;
    const state = this.rowOn[row]?.[step] ?? 0;
    if (state === 1)
      return `${base}, note starts, ${String(this.rowAnchorLen[row]?.[step] ?? 1)} steps`;
    if (state === 2) return `${base}, note continues`;
    return base;
  }

  /**
   * Roving tabindex seed: first cell (editable grids only — LY-1). LL-1:
   * factored out of build() so the VIRTUALIZED grid can seed AFTER its first
   * rewindow builds the pool (eager keeps today's exact order).
   */
  private seedRoving(): void {
    const first = this.cells[0]?.[0];
    if (first && this.editable) {
      first.tabIndex = 0;
      this.rovingCell = first;
    } else if (first) {
      this.rovingCell = first; // remembered for setEditable(true), no tab stop
    }
  }

  // -- interface ----------------------------------------------------------

  toggle(row: number, step: number): void {
    if (!this.editable) return;
    this.opts.onToggle(row, step);
  }

  focusCell(row: number, step: number): void {
    this.moveFocus(row, step);
  }

  /** LL-1: the roving cursor (see the interface law). */
  cursor(): { row: number; step: number } | null {
    if (!this.rovingCell || !this.rovingCell.isConnected) return null;
    const row = Number(this.rovingCell.dataset.row);
    const step = Number(this.rovingCell.dataset.step);
    if (!Number.isFinite(row) || !Number.isFinite(step)) return null;
    return { row, step };
  }

  focusRoving(): void {
    if (!this.editable) return;
    if (this.rovingCell) {
      this.rovingCell.focus({ preventScroll: true });
      // RC-1: the roving landing must be visible in the window (E2 extended).
      this.ensureRowVisible(this.rovingRowIndex());
    } else this.moveFocus(0, 0);
  }

  setEditable(editable: boolean): void {
    if (this.editable === editable) return;
    this.editable = editable;
    // IN-4 contract (the HP-1 help-mode law, pre-pinned): a MODE flip
    // mid-gesture never cancels the active gesture — it was armed while
    // editable and completes (or cancels via pointercancel) cleanly; only an
    // external document sync (sync()) interrupts by cancelling. Never a
    // stuck preview either way.
    // O(1) transitions: editable grids own exactly ONE tab stop (the roving
    // cell); view-only grids own none. The remembered roving cell survives
    // the flip, so re-entering edit mode returns to the same place.
    if (editable) {
      if (!this.rovingCell) this.rovingCell = this.cells[0]?.[0] ?? null;
      if (this.rovingCell) this.rovingCell.tabIndex = 0;
    } else if (this.rovingCell) {
      this.rovingCell.tabIndex = -1;
    }
    if (this.gridEl) {
      this.gridEl.setAttribute("aria-label", this.gridAriaLabel());
      this.gridEl.dataset.editing = String(editable);
    }
    // RC-1: the editing/view-only flip changes the CSS row RHYTHM (margins),
    // which moves every row's offset — re-anchor the window seat one frame
    // later (after the attribute-driven style re-applies) so the visible
    // range and its name stay truthful.
    if (this.windowRows) {
      requestAnimationFrame(() => {
        if (!this.windowRows || this.disposed) return;
        this.scrollWindowTo(this.seatedStart, true);
      });
    }
  }

  setPlayhead(x: number | null): void {
    if (!this.playheadEl) return;
    if (x === null) {
      this.playheadEl.style.opacity = "0";
      return;
    }
    this.playheadEl.style.opacity = "1";
    // LL-1: the sticky layer's origin IS winStart — the pattern-coordinate x
    // shifts by the window offset (O(1); the off-window playhead simply
    // paints outside the layer, clipped by the scrollport).
    const wx = this.virtual ? x - this.winStart * this.stepWidthPx : x;
    this.playheadEl.style.transform = `translateX(${wx}px)`;
  }

  setRowHeight(px: number): void {
    if (px === this.rowHeightPx) return; // idempotent — observers converge
    this.rowHeightPx = px;
    for (const track of this.rowTracks) track.style.gridAutoRows = `${px}px`;
    // RC-1: the pinned window height rides the track px (the budget fit
    // re-pins tracks live); the seat re-anchors on its AUTHORITATIVE start
    // (never a layout-derived one), and a focused row stays visible across
    // the re-pitch (E2 extended).
    if (this.windowRows) {
      this.applyWindowHeight();
      this.scrollWindowTo(this.seatedStart, true);
      if (
        this.rovingCell &&
        document.activeElement === this.rovingCell &&
        this.rovingCell.isConnected
      ) {
        this.ensureRowVisible(this.rovingRowIndex());
      }
    }
  }

  // -- RC-1: the register window ---------------------------------------------

  setWindow(heightRows: number | null, start = 0): void {
    const effective =
      heightRows != null && heightRows < this.cells.length ? heightRows : null;
    const container = this.opts.container;
    if (effective === null) {
      this.windowRows = null;
      this.seatedStart = 0;
      container.classList.remove("is-windowed");
      container.style.height = "";
      container.scrollTop = 0;
      this.updateGridName();
      return;
    }
    this.windowRows = effective;
    container.classList.add("is-windowed");
    this.applyWindowHeight();
    this.scrollWindowTo(start, true);
    // The seat is geometry-derived and a fresh mount can measure against
    // not-yet-invalidated styles (the editing/view-only margin rhythm):
    // re-anchor one frame later, on the SAME semantic start — idempotent
    // when the first seat was already true.
    requestAnimationFrame(() => {
      if (this.disposed || !this.windowRows) return;
      this.scrollWindowTo(this.seatedStart, true);
    });
  }

  scrollWindowTo(start: number, force = false): void {
    if (!this.windowRows) return;
    const s = clampWindowStart(start, this.cells.length, this.windowRows);
    const target = this.rowTopInScroll(s);
    const container = this.opts.container;
    // Snap guard: a free wheel scroll may rest between rows — only re-seat
    // on WHOLE-window moves (the wheel path re-seats the semantic start
    // itself via onScroll, so its echo never fights the user's scroll).
    if (!force && Math.abs(container.scrollTop - target) < this.rowPitch()) {
      return;
    }
    container.scrollTop = target;
    this.seatedStart = s;
    this.updateGridName();
  }

  /** The semantic window start: the FIRST row crossing the visible top. */
  private currentStart(): number {
    if (!this.windowRows) return 0;
    const boxTop = this.opts.container.getBoundingClientRect().top;
    for (let i = 0; i < this.rowEls.length; i++) {
      const el = this.rowEls[i]!;
      const top = el.getBoundingClientRect().top;
      if (top + el.offsetHeight > boxTop + 1) return i;
    }
    return Math.max(0, this.rowEls.length - 1);
  }

  /** Row-to-row pitch in px (track height + the CSS row margin), from the DOM. */
  private rowPitch(): number {
    if (this.rowEls.length >= 2) {
      const a = this.rowEls[0]!.getBoundingClientRect().top;
      const b = this.rowEls[1]!.getBoundingClientRect().top;
      const pitch = b - a;
      if (pitch > 0) return pitch;
    }
    return this.rowHeightPx + this.gapPx;
  }

  /** A row's offsetTop in the scroll container's coordinate space. */
  private rowTopInScroll(row: number): number {
    const el = this.rowEls[row];
    const container = this.opts.container;
    if (!el) return 0;
    return (
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop
    );
  }

  /** Pin the container height to exactly `windowRows` rows (+ own padding). */
  private applyWindowHeight(): void {
    const w = this.windowRows;
    if (w == null) return;
    const container = this.opts.container;
    const style = getComputedStyle(container);
    const padY =
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const first = this.rowEls[0]?.offsetHeight ?? this.rowHeightPx;
    const pitch = this.rowPitch();
    const content = pitch * (w - 1) + first;
    container.style.height = `${Math.ceil(content + padY)}px`;
  }

  /**
   * The window-follows-focus law: scroll the MINIMAL amount that keeps `row`
   * visible (scroll-into-view, block:"nearest" semantics). View-only — no
   * document write, no announcement; the focus move itself is the signal.
   */
  private ensureRowVisible(row: number): void {
    if (!this.windowRows) return;
    const container = this.opts.container;
    const top = this.rowTopInScroll(row);
    const height = this.rowEls[row]?.offsetHeight ?? this.rowHeightPx;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (top + height > container.scrollTop + container.clientHeight)
      container.scrollTop = top + height - container.clientHeight;
    this.seatedStart = this.currentStart();
    this.updateGridName();
  }

  private rovingRowIndex(): number {
    const idx = this.rovingCell ? Number(this.rovingCell.dataset.row) : 0;
    return Number.isFinite(idx) ? idx : 0;
  }

  /**
   * The scroll twin of every USER scroll (wheel/drag): the semantic start
   * follows the measured top row — the user's scroll IS the intent. Key and
   * focus-follow seats keep their authoritative start instead.
   * LL-1: the listener is shared with the COLUMN window; the axis check
   * routes horizontal scrolls to the (cheap, layout-free) rewindow check and
   * keeps the vertical seat law off the x-axis path (its rect reads are the
   * RC-1 layout cost — never paid during a horizontal fling).
   */
  private onScroll = (): void => {
    const container = this.opts.container;
    const hs = this.hScroll();
    if (this.virtual && hs.scrollLeft !== this.lastScrollLeft) {
      this.lastScrollLeft = hs.scrollLeft;
      this.rewindowIfNeeded();
    }
    if (!this.windowRows) return;
    if (container.scrollTop === this.seatedScrollTop) return;
    this.seatedScrollTop = container.scrollTop;
    this.seatedStart = this.currentStart();
    this.updateGridName();
    this.opts.onWindowScroll?.(this.seatedStart);
  };

  private updateGridName(): void {
    if (this.gridEl)
      this.gridEl.setAttribute("aria-label", this.gridAriaLabel());
  }

  /**
   * E9: Shift+↑/↓ — scroll the visible window ONE OCTAVE, VIEW ONLY (no
   * focus move, no document write, no audition). The focus-anchor law bounds
   * the target (keynav.clampedWindowScroll); a blocked press is a no-op that
   * still announces the edge (never silent — the same VIEW AT TOP/BOTTOM
   * wording serves both clamp kinds: the named rows are the CURRENT window).
   */
  private scrollWindowByKey(dir: -1 | 1, focusRow: number): void {
    if (!this.windowRows) return;
    const rows = this.cells.length;
    const w = this.windowRows;
    const start = this.seatedStart;
    const target = clampedWindowScroll(start, dir, focusRow, rows, w);
    const range = (s: number) =>
      `ROWS ${this.opts.rowLabels[s] ?? s}–${this.opts.rowLabels[s + w - 1] ?? s + w - 1}`;
    if (target === start) {
      this.announceView(
        `${dir > 0 ? "VIEW AT BOTTOM" : "VIEW AT TOP"} · ${range(start)}`,
      );
      return;
    }
    this.scrollWindowTo(target, true);
    this.announceView(
      `VIEW ${dir > 0 ? "DOWN" : "UP"} ONE OCTAVE · ${range(target)}`,
    );
  }

  /** The ONE window-scroll announcement text, from every key path (E9). */
  private announceView(text: string): void {
    if (this.viewLiveEl) this.viewLiveEl.textContent = text;
  }

  // -- LL-1: the column window (sticky-layer virtualization) ----------------

  /** The horizontal scroller (the split's inner pane; eager = container). */
  private hScroll(): HTMLElement {
    return this.hscrollEl ?? this.opts.container;
  }

  /**
   * Pool cell for a PATTERN step (null when the row is missing or the step
   * is outside the window). Eager grids hold [0, steps) — the identity map.
   */
  private cellFor(row: number, step: number): HTMLElement | null {
    const rowCells = this.cells[row];
    if (!rowCells) return null;
    return this.cellInRow(rowCells, step);
  }

  /** Pool index for a step within one row's pool (null outside the window). */
  private cellInRow(rowCells: HTMLElement[], step: number): HTMLElement | null {
    const idx = step - this.winStart;
    return idx >= 0 && idx < rowCells.length ? (rowCells[idx] ?? null) : null;
  }

  /**
   * Visible columns from the scroll position (layout-free — scrollLeft +
   * clientWidth only). `first` is the leftmost column the scrollbar
   * addresses; `last` the first column past the right edge. clientWidth 0
   * (mount before first layout) falls back to a desktop-wide guess — the
   * first post-layout frame corrects it (mountPending).
   */
  private visibleRange(): { first: number; last: number } {
    const c = this.hScroll();
    const first = Math.max(
      0,
      Math.floor(c.scrollLeft / this.stepWidthPx) - 1,
    );
    const visible = Math.ceil(
      (c.clientWidth > 0
        ? c.clientWidth - this.playheadLeftPx
        : 48 * this.stepWidthPx) / this.stepWidthPx,
    );
    return {
      first,
      last: Math.min(this.opts.steps, first + visible + 1),
    };
  }

  /**
   * Hysteresis (LP-1 §10a): rewindow only when the visible range EXHAUSTS
   * the window's overscan — the recentered window then buys another full
   * (overscan + visible) columns of travel before the next rebuild, instead
   * of firing per frame mid-sweep. No-op (zero DOM work) inside the band.
   */
  private rewindowIfNeeded(): void {
    const { first, last } = this.visibleRange();
    if (first <= this.winStart || last >= this.winEnd) this.rewindow(false);
  }

  /**
   * Rebuild the column window: recycle each row's pool (only length changes
   * touch the template; cells are RE-TAGGED, never re-created — zero element
   * churn, auto-placement keeps DOM order == column order), re-tag step +
   * beat identity, then re-apply on-state + clipped runs. O(winCols × rows)
   * at ANY pattern size — the committed law.
   */
  private rewindow(force: boolean): void {
    if (!this.virtual) return;
    const { first, last } = this.visibleRange();
    const start = Math.max(0, first - this.overscan);
    const end = Math.min(this.opts.steps, last + this.overscan);
    if (!force && start === this.winStart && end === this.winEnd) return;
    const rewindowT0 = performance.now();
    // The cursor (focused or merely remembered) survives the re-tag by
    // position: re-home it onto the pool cell now holding its step, clamped
    // to the window when a pointer scroll moved the view past it (E2's
    // "focus stays visible" law, extended to the column axis).
    const cursor = this.cursor();
    const hadFocus =
      cursor !== null &&
      this.opts.container.contains(document.activeElement) &&
      (document.activeElement as HTMLElement).classList?.contains("cell");
    this.winStart = start;
    this.winEnd = end;
    const winCols = end - start;
    for (let row = 0; row < this.rowTracks.length; row++) {
      const cellsEl = this.rowTracks[row]!;
      const runs = cellsEl.querySelector<HTMLElement>(".note-runs");
      const pool = this.cells[row]!;
      if (pool.length !== winCols) {
        cellsEl.style.gridTemplateColumns = `repeat(${winCols}, ${this.cellPx}px)`;
        while (pool.length > winCols) pool.pop()!.remove();
        while (pool.length < winCols) {
          const cell = document.createElement("div");
          cell.className = "cell";
          cell.setAttribute("role", "gridcell");
          cell.dataset.row = String(row);
          cell.tabIndex = -1;
          cellsEl.insertBefore(cell, runs ?? null);
          pool.push(cell);
        }
      }
      for (let i = 0; i < pool.length; i++) {
        const step = start + i;
        const cell = pool[i]!;
        cell.dataset.step = String(step);
        cell.dataset.beat = String(Math.floor(step / 4) % 2);
      }
    }
    this.applyOnState();
    for (let row = 0; row < this.rowTracks.length; row++)
      this.renderRuns(row);
    if (cursor) {
      const rowCells = this.cells[cursor.row];
      if (rowCells && rowCells.length > 0) {
        const idx = Math.min(
          Math.max(cursor.step - this.winStart, 0),
          rowCells.length - 1,
        );
        const cell = rowCells[idx]!;
        this.setRoving(cell);
        if (hadFocus) cell.focus({ preventScroll: true });
      }
    }
    this.rewindows++;
    this.lastRewindowMs = performance.now() - rewindowT0;
  }

  /**
   * G8 (window-aware nav): a cursor step outside the window re-seats BOTH
   * the scrollbar and the window before the caller indexes the pool —
   * scroll-into-view "nearest" semantics: left-clamps put the step just
   * after the label; right-clamps put it at the right edge.
   */
  private ensureColVisible(step: number): void {
    if (!this.virtual) return;
    if (step >= this.winStart && step < this.winEnd) return;
    const hs = this.hScroll();
    const { first, last } = this.visibleRange();
    const visible = Math.max(1, last - first - 1);
    hs.scrollLeft =
      step < this.winStart
        ? step * this.stepWidthPx
        : Math.max(0, (step + 1 - visible) * this.stepWidthPx);
    this.lastScrollLeft = hs.scrollLeft;
    this.rewindow(false);
  }

  triggerGlow(step: number): void {
    for (const row of this.cells) {
      const cell = this.cellInRow(row, step);
      if (!cell || cell.dataset.on !== "true") continue;
      cell.classList.add("is-triggering");
      const timer = window.setTimeout(() => {
        cell.classList.remove("is-triggering");
        this.glowTimers.delete(timer);
      }, 180);
      this.glowTimers.add(timer);
    }
  }

  layout(): void {
    // Geometry is constant (fixed cell px; CSS var driven) — revalidate the
    // playhead once so a resize can't strand it mid-column.
    this.lastQuantized = null;
    // LL-1: a re-layout may change clientWidth (viewport resize, quadrant
    // re-fit) — re-derive the window against it.
    if (this.virtual) {
      this.lastScrollLeft = this.hScroll().scrollLeft;
      this.rewindow(false);
    }
  }

  sync(pattern: DrumPattern | PitchedNotesView): void {
    // A sync mid-gesture would fight the preview (external edit) — cancel the
    // gesture cleanly first (preview cleared, nothing committed).
    this.cancelGesture();
    if (pattern.kind === "drums") {
      // HP-1 gate finding (the HW-4 Bug-2 class): rows are built in
      // DRUM_PIECES order, so the row→piece map must too. Object.keys order
      // follows insertion — and the canonical codec key-SORTS objects, so
      // any save→load round-tripped project (every autosave restore) mapped
      // row 1 to HAT while the label said SNARE: the grid displayed one
      // row's hits under another row's label, and row toggles edited a
      // different piece than the one shown. Iterate the constant, exactly
      // like compile.ts/exportMidi.ts.
      this.rowSpans = this.opts.rowLabels.map(() => []);
      this.rowOn = this.opts.rowLabels.map((_, row) => {
        const arr = new Uint8Array(this.opts.steps);
        const steps = pattern.steps[DRUM_PIECES[row]!];
        for (let s = 0; s < this.opts.steps; s++)
          if (steps?.[s]) arr[s] = 1;
        return arr;
      });
      this.rowAnchorLen = this.rowOn.map(() => []);
    } else {
      this.rowSpans = pattern.rows;
      // LL-1 (LP-1 §10a): flatten each row's spans ONCE — O(rows × steps)
      // per sync, O(1) per cell read (the naive `spans.some` per cell was
      // the eager sweep's measured cost at long patterns).
      this.rowOn = this.opts.rowLabels.map((_, row) => {
        const arr = new Uint8Array(this.opts.steps);
        for (const span of this.rowSpans[row] ?? []) {
          const from = Math.max(0, Math.min(this.opts.steps - 1, span.start));
          const to = Math.min(
            this.opts.steps,
            span.start + Math.max(1, span.length),
          );
          arr[from] = 1;
          for (let s = from + 1; s < to; s++) arr[s] = 2;
        }
        return arr;
      });
      this.rowAnchorLen = pattern.rows.map((spans) => {
        const lens = new Array<number>(this.opts.steps).fill(0);
        for (const span of spans ?? []) {
          if (span.start >= 0 && span.start < this.opts.steps)
            lens[span.start] = span.length;
        }
        return lens;
      });
    }
    this.applyOnState();
    for (let row = 0; row < this.rowTracks.length; row++)
      this.renderRuns(row);
  }

  previewRow(row: number, on: readonly boolean[] | null): void {
    const rowCells = this.cells[row];
    if (!rowCells) return;
    // LL-1: `on` addresses PATTERN steps; the pool is window-relative.
    for (let i = 0; i < rowCells.length; i++) {
      const cell = rowCells[i]!;
      if (on?.[this.winStart + i]) cell.dataset.preview = "true";
      else delete cell.dataset.preview;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const timer of this.glowTimers) window.clearTimeout(timer);
    this.glowTimers.clear();
    if (this.suppressClearTimer) window.clearTimeout(this.suppressClearTimer);
    const { container } = this.opts;
    container.removeEventListener("click", this.onClick);
    container.removeEventListener("keydown", this.onKeyDown);
    container.removeEventListener("scroll", this.onScroll);
    this.hscrollEl?.removeEventListener("scroll", this.onScroll);
    container.removeEventListener("pointerdown", this.onPointerDown);
    container.removeEventListener("pointermove", this.onPointerMove);
    container.removeEventListener("pointerup", this.onPointerUp);
    container.removeEventListener("pointercancel", this.onPointerCancel);
    container.removeEventListener("contextmenu", this.onContextMenu);
  }

  // -- internals ------------------------------------------------------------

  private applyOn(cell: HTMLElement, on: boolean): void {
    cell.dataset.on = String(on);
    cell.setAttribute("aria-selected", String(on));
  }

  /**
   * LL-1: apply the flattened on-state to the POOL (window cells only; the
   * flattened arrays carry the full pattern). Pitched cells also refresh
   * their note-state names (E4) — O(1) reads. Eager grids: same writes as
   * the old per-row sync, over the full extent.
   */
  private applyOnState(): void {
    const pitched = this.opts.pitched;
    for (let row = 0; row < this.cells.length; row++) {
      const rowCells = this.cells[row]!;
      const on = this.rowOn[row];
      for (let i = 0; i < rowCells.length; i++) {
        const cell = rowCells[i]!;
        const step = this.winStart + i;
        const state = on ? (on[step] ?? 0) : 0;
        this.applyOn(cell, state !== 0);
        if (pitched) {
          cell.dataset.sustain = String(state === 2);
          cell.setAttribute("aria-label", this.cellName(row, step));
        }
      }
    }
  }

  /**
   * Render one row's note bars (G6 law: only spans intersecting the window
   * exist). LL-1 (measured in-task): the runs layer is TRANSLATED by the
   * window offset and every run keeps its TRUE pattern geometry — a
   * surviving run's style NEVER changes across a rewindow (the D9 glow
   * shadow's raster is the paint cost: re-positioning runs re-rasters every
   * blur, measured 56 ms medians on the dense-128 fling; translate +
   * identity-stable survivors keep the same sweep inside budget). The layer
   * clips at the window edge (grid.css overflow), so off-window runs never
   * paint.
   */
  private renderRuns(row: number): void {
    const layer = this.runLayers[row];
    if (!layer) return;
    const spans = this.rowSpans[row] ?? [];
    const existing = new Map<string, HTMLElement>();
    for (const child of Array.from(layer.children) as HTMLElement[]) {
      const key = `${child.dataset.start}:${child.dataset.length}`;
      existing.get(key)?.remove(); // dupes cannot happen; defensive
      existing.set(key, child);
    }
    const keep = new Set<HTMLElement>();
    let anchor: ChildNode | null = layer.firstChild;
    for (const span of spans) {
      const from = Math.max(span.start, this.winStart);
      const to = Math.min(span.start + span.length, this.winEnd);
      if (to <= from) continue;
      const key = `${span.start}:${span.length}`;
      const run = existing.get(key);
      if (run) {
        // Re-assert TRUE geometry on reuse: identical strings are no-ops on
        // a clean run, and this is what RESTORES a run after a cancelled
        // resize preview mutated its width in place (the pointer-edge
        // cancel law).
        run.style.left = `${span.start * this.stepWidthPx}px`;
        run.style.width = `${span.length * this.stepWidthPx - this.gapPx}px`;
        keep.add(run);
        if (anchor === run) anchor = run.nextSibling;
        else layer.insertBefore(run, anchor); // span order is paint order
      } else {
        const fresh = this.buildRun(row, span.start, span.length);
        keep.add(fresh);
        layer.insertBefore(fresh, anchor);
      }
    }
    for (const el of existing.values()) if (!keep.has(el)) el.remove();
    layer.style.transform = `translateX(${-this.winStart * this.stepWidthPx}px)`;
  }

  private buildRun(
    row: number,
    trueStart: number,
    trueLength: number,
  ): HTMLElement {
    const run = document.createElement("div");
    run.className = "note-run";
    // TRUE pattern geometry — never re-positioned across rewindows (the
    // runs layer carries the window offset as one transform).
    run.style.left = `${trueStart * this.stepWidthPx}px`;
    run.style.width = `${trueLength * this.stepWidthPx - this.gapPx}px`;
    run.dataset.start = String(trueStart);
    run.dataset.length = String(trueLength);
    // IN-2 right-edge resize hit zone (keyboard equivalent = `+`/`-` keys —
    // the zone itself is aria-hidden decoration, never a tab stop).
    const edge = document.createElement("div");
    edge.className = "note-edge";
    edge.dataset.row = String(row);
    edge.dataset.start = String(trueStart);
    edge.dataset.length = String(trueLength);
    run.append(edge);
    return run;
  }

  private onClick = (e: Event): void => {
    // View-only quadrants: clicks select the QUADRANT (LaneGrid wires that on
    // the floor); the grid itself never toggles.
    if (!this.editable) return;
    if (this.suppressClick) {
      // A committed/cancelled/activated pointer gesture — the trailing click
      // must not re-activate the anchor cell.
      this.suppressClick = false;
      if (this.suppressClearTimer) window.clearTimeout(this.suppressClearTimer);
      return;
    }
    // IN-2 fix: real captured presses activate on POINTERUP instead; this
    // path only serves bare synthetic clicks (HTMLElement.click(), e2e
    // drivers) — under real pointers the captured click targets the
    // container, not a cell.
    const target = e.target as HTMLElement;
    if (!target.classList.contains("cell")) return;
    this.activate(target);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // A view-only grid holds no focus, so keys cannot originate here — but a
    // stale focus (mid-flip) must never toggle or move into it either (E2).
    if (!this.editable) return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains("cell")) return;
    const pos: CellPos = {
      row: Number(target.dataset.row),
      step: Number(target.dataset.step),
    };

    // Enter / Space toggle (APG grid); Shift+Enter auditions without
    // toggling (DA-1 audition key).
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.shiftKey && e.key === "Enter") {
        this.opts.onAudition?.(pos.row, pos.step);
      } else {
        this.activate(target);
      }
      return;
    }

    if (e.key === "Escape") {
      // MB-2: the fill-rails reveal is the innermost row-local surface —
      // close it before the console cover / region-head pop consider the
      // keystroke (one consumer per Escape).
      if (this.opts.onEscapeFillRails?.()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Refinement-1: an overlay covering this grid (the FX console) owns
      // the Escape first — close it, skip the region-head pop this
      // keystroke, and stop the page-level consumer from double-handling.
      if (this.opts.onEscapeCovered?.()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Pop to the region head: the lane header's first control.
      e.preventDefault();
      const head = this.opts.container
        .closest(".lane-floor")
        ?.querySelector<HTMLElement>(
          ".lane-head button, .lane-head input, .lane-head [href]",
        );
      if (head) head.focus();
      else this.opts.onEscape?.();
      return;
    }

    // IN-2 note keys — PITCHED only (drums keep the one-shot law, I2-4:
    // +/-/Delete do nothing there). Browser zoom (Ctrl/Cmd +/-) is on the
    // deliberate exclusion list — never intercepted with a modifier held.
    if (this.opts.pitched && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
        e.preventDefault();
        this.keyResize(
          pos.row,
          pos.step,
          e.key === "+" || e.key === "=",
          e.shiftKey ? 0.25 : 1,
        );
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const spans = this.rowSpans[pos.row] ?? [];
        const idx = focusedSpanIndex(spans, pos.step);
        if (idx >= 0) this.opts.onNoteRemove?.(pos.row, spans[idx].start);
        return;
      }
    }

    // Lane moves (PageUp/PageDown, Ctrl+↑/↓, [ ]) — host coordinates.
    const laneDir = isLaneMoveKey(e.key, e.ctrlKey || e.metaKey);
    if (laneDir !== null) {
      e.preventDefault();
      this.opts.onLaneMove?.(laneDir, pos);
      return;
    }

    // RC-1 (v3): Shift+↑/↓ scroll the register window ONE OCTAVE — VIEW
    // ONLY (focus does not move, nothing is written, nothing auditions).
    // Pitched-windowed grids only: drums and full-manifest grids keep
    // today's Shift+arrow behavior (the plain move — Shift is not a move
    // modifier, so exactly today's no-op there).
    if (
      this.windowRows &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
      this.scrollWindowByKey(e.key === "ArrowDown" ? 1 : -1, pos.row);
      return;
    }

    // Within-grid moves: pure math from keynav (clamped, never wraps). LL-1
    // (G8): the dims carry the PATTERN extent — Home/End/beat-jump keep their
    // exact meanings at any length (off-window targets re-seat the window).
    const move = gridMoveForKey(e.key, e.ctrlKey || e.metaKey);
    if (move !== null) {
      e.preventDefault();
      const next = nextCell(
        pos,
        { rows: this.cells.length, steps: this.opts.steps },
        move,
      );
      this.moveFocus(next.row, next.step);
    }
  };

  /** Keyboard resize of the focused note (spec v2 ±1 / Shift ±0.25). */
  private keyResize(
    row: number,
    step: number,
    grow: boolean,
    magnitude: number,
  ): void {
    const spans = this.rowSpans[row] ?? [];
    const idx = focusedSpanIndex(spans, step);
    if (idx < 0) return;
    const span = spans[idx];
    const next = resizeBy(span.length, grow ? magnitude : -magnitude);
    if (next === span.length) return; // clamped no-op at 0.25 / 2048 (C3/G7)
    this.announceLength(next);
    this.opts.onNoteResize?.(row, span.start, next);
  }

  /** E4/E5: the ONE resize announcement text, from every input path. */
  private announceLength(length: number): void {
    if (this.lengthLiveEl)
      this.lengthLiveEl.textContent = lengthAnnouncement(length);
  }

  // -- IN-2 pointer gestures -------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.editable || this.gesture || !e.isPrimary) return;
    this.suppressClick = false; // a fresh press always re-arms normal clicks
    const target = e.target as HTMLElement;

    // Edge hit zone → resize gesture (pitched only).
    const edge = target.closest<HTMLElement>(".note-edge");
    if (edge && this.opts.pitched) {
      const row = Number(edge.dataset.row ?? "-1");
      const start = Number(edge.dataset.start);
      const length = Number(edge.dataset.length);
      const spans = this.rowSpans[row] ?? [];
      const span = spans.find((s) => s.start === start && s.length === length);
      if (span && this.opts.onNoteResize) {
        this.gesture = {
          kind: "resize",
          pointerId: e.pointerId,
          drag: resizeDragBegin(row, span),
          moved: false,
          runEl: edge.parentElement as HTMLElement,
        };
        this.capture(e);
        e.preventDefault();
      }
      return;
    }

    const cell = target.closest<HTMLElement>(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const step = Number(cell.dataset.step);
    if (this.opts.pitched) {
      // Covered cell (anchor / mid-span): arm a TAP so pointerup can run the
      // remove/trim law directly. Falling through to the trailing click (the
      // old law) is dead under real pointers: this press captures, and the
      // capture retargets the click to the container (IN-2 fix).
      if (focusedSpanIndex(this.rowSpans[row] ?? [], step) >= 0) {
        this.gesture = { kind: "tap", pointerId: e.pointerId, row, step };
        this.capture(e);
        e.preventDefault();
        return;
      }
      if (!this.opts.onNoteCreate) return;
      this.gesture = {
        kind: "create",
        pointerId: e.pointerId,
        drag: createDragBegin(row, step, this.opts.steps),
        moved: false,
      };
    } else {
      if (!this.opts.onDrumsPaint) return;
      this.gesture = {
        kind: "paint",
        pointerId: e.pointerId,
        drag: paintDragBegin(row, step, this.opts.steps),
        moved: false,
        offCells: this.snapshotOffCells(),
      };
    }
    this.capture(e);
    e.preventDefault();
  };

  /**
   * Cells currently off, keyed "row:step" — the paint commit set. LL-1:
   * reads the FLATTENED on-state (the full pattern's truth — the pool alone
   * would miss off-window cells a fast paint sweep crosses).
   */
  private snapshotOffCells(): Set<string> {
    const off = new Set<string>();
    for (let row = 0; row < this.cells.length; row++) {
      const on = this.rowOn[row];
      if (!on) continue;
      for (let step = 0; step < this.opts.steps; step++) {
        if ((on[step] ?? 0) === 0) off.add(`${row}:${step}`);
      }
    }
    return off;
  }

  private capture(e: PointerEvent): void {
    // Pointer capture keeps pointerup/pointercancel deliverable when the
    // pointer leaves the grid (up-outside commits; cancel cancels). Synthetic
    // test events carry no active pointer — capture throws and we proceed
    // uncaptured (listeners on the container still track in-grid moves).
    try {
      this.opts.container.setPointerCapture(e.pointerId);
    } catch {
      /* uncaptured — IN-4 owns the systematic edge sweep */
    }
  }

  private releaseCapture(pointerId: number): void {
    try {
      this.opts.container.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }

  /**
   * The pointer's step-space position on one row (x only; gestures are
   * row-locked). LL-1: the cells element's left edge is the WINDOW's column
   * 0 (the sticky layer is pinned) — pattern step = winStart + offset.
   */
  private pointerStepFloat(e: PointerEvent, row: number): number {
    const cellsEl = this.cells[row]?.[0]?.parentElement;
    if (!cellsEl) return 0;
    const rect = cellsEl.getBoundingClientRect();
    return this.winStart + (e.clientX - rect.left) / this.stepWidthPx;
  }

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.kind === "tap") return; // no preview — activation decides on release
    if (g.kind === "create") {
      const next = createDragMove(
        g.drag,
        Math.floor(this.pointerStepFloat(e, g.drag.row)),
      );
      if (next !== g.drag) {
        g.drag = next;
        g.moved = true;
        this.previewCreate(g.drag);
      }
    } else if (g.kind === "resize") {
      const next = resizeDragMove(g.drag, this.pointerStepFloat(e, g.drag.row));
      if (next !== g.drag) {
        const extended = next.length > g.drag.length;
        g.drag = next;
        g.moved = true;
        this.previewResize(g.drag, g.runEl, extended);
      }
    } else {
      const next = paintDragMove(
        g.drag,
        Math.floor(this.pointerStepFloat(e, g.drag.row)),
      );
      if (next !== g.drag) {
        g.drag = next;
        g.moved = true;
        this.previewPaint(g.drag, g.offCells);
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    this.releaseCapture(g.pointerId);
    this.gesture = null;
    if (g.kind === "create") {
      this.clearCreatePreview();
      const length = createDragLength(g.drag);
      if (length !== null) {
        // A real drag committed — swallow the trailing click (click-parity
        // with v0: roving follows the interaction).
        this.armClickSuppression();
        const anchor = this.cellFor(g.drag.row, g.drag.start);
        if (anchor) this.setRoving(anchor);
        this.opts.onNoteCreate?.(g.drag.row, g.drag.start, length);
      } else {
        // Unmoved = a single click. Run the activation law HERE (gate-default
        // place): under real pointers this press captured, and the capture
        // retargets the trailing click to the container — it can never reach
        // onClick (IN-2 fix).
        this.activateIfReleasedOver(g.drag.row, g.drag.start, e);
      }
    } else if (g.kind === "tap") {
      this.activateIfReleasedOver(g.row, g.step, e);
    } else if (g.kind === "resize") {
      const length = resizeDragCommit(g.drag);
      this.clearResizePreview(g.drag.row);
      this.armClickSuppression();
      if (length !== null) {
        this.announceLength(length);
        this.opts.onNoteResize?.(g.drag.row, g.drag.start, length);
      }
    } else {
      this.clearPaintPreview();
      const cells: Array<{ row: number; step: number }> = [];
      if (g.moved) {
        const range = paintDragRange(g.drag);
        for (let step = range.from; step <= range.to; step++) {
          if (g.offCells.has(`${g.drag.row}:${step}`))
            cells.push({ row: g.drag.row, step });
        }
      }
      if (cells.length > 0) {
        this.armClickSuppression();
        this.opts.onDrumsPaint?.(cells);
      } else {
        // Unmoved paint = a single click → the v0 toggle+audition law, run
        // directly on release (same capture-retarget reason as create).
        this.activateIfReleasedOver(g.drag.row, g.drag.anchor, e);
      }
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    this.releaseCapture(g.pointerId);
    this.cancelGesture();
  };

  /** IN-4: the active gesture owns the pointer — no context menu mid-drag. */
  private onContextMenu = (e: MouseEvent): void => {
    if (this.gesture) e.preventDefault();
  };

  /**
   * Clear any active gesture + its preview; commit NOTHING (IN-4 law). Also
   * releases pointer capture (a sync-mid-gesture external edit must not leak
   * the capture past the gesture — the browser reclaims it on the eventual
   * pointerup, but explicit release keeps the container honest).
   */
  private cancelGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    this.releaseCapture(g.pointerId);
    if (g.kind === "create") this.clearCreatePreview();
    else if (g.kind === "resize") this.clearResizePreview(g.drag.row);
    else if (g.kind === "paint") this.clearPaintPreview();
    // tap: no preview
  }

  /**
   * IN-2 fix: single-click activation from POINTERUP of an unmoved gesture.
   * Chromium retargets the click that follows a captured press to the
   * capture element (the container), so `onClick` never sees a cell target
   * under real pointers — the activation law must run here. Click-parity
   * guard: activate only when the release hit-tests back to the PRESSED cell
   * (a down/up on different elements never produced a cell-targeted click in
   * v0 either — the release lands on the common ancestor).
   */
  private activateIfReleasedOver(
    row: number,
    step: number,
    e: PointerEvent,
  ): void {
    const anchor = this.cellFor(row, step);
    if (!anchor) return;
    if (this.cellAtPoint(e.clientX, e.clientY) !== anchor) return;
    this.armClickSuppression(); // the trailing click must not double-activate
    this.activate(anchor);
  }

  /**
   * The cell under viewport coordinates (x inside the step span, y inside the
   * row band) — the release-side hit test for click parity. Null off-grid.
   * LL-1: the step maps through the WINDOW (pool cells represent winStart+i).
   */
  private cellAtPoint(clientX: number, clientY: number): HTMLElement | null {
    for (const rowCells of this.cells) {
      const el = rowCells[0]?.parentElement;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top || clientY >= rect.bottom) continue;
      if (clientX < rect.left || clientX >= rect.right) return null;
      const step =
        this.winStart + Math.floor((clientX - rect.left) / this.stepWidthPx);
      return this.cellInRow(rowCells, step);
    }
    return null;
  }

  private armClickSuppression(): void {
    this.suppressClick = true;
    // The trailing click (if any) arrives in the same task as pointerup; the
    // timer is the belt-and-braces expiry so a click that never comes cannot
    // eat a later, genuine click.
    if (this.suppressClearTimer) window.clearTimeout(this.suppressClearTimer);
    this.suppressClearTimer = window.setTimeout(() => {
      this.suppressClick = false;
    }, 0);
  }

  // Previews — renderer-local only (zero store writes; euclid's language).

  private previewCreate(drag: CreateDrag): void {
    this.clearCreatePreview();
    const rowCells = this.cells[drag.row];
    if (!rowCells) return;
    for (let step = drag.start; step <= drag.end; step++) {
      this.cellInRow(rowCells, step)?.setAttribute("data-preview", "true");
    }
    const layer = this.runLayers[drag.row];
    if (layer && drag.end > drag.start) {
      // LL-1: the preview bar carries the TRUE drag extent (the runs layer
      // translates + clips; zero store writes until release).
      const bar = this.buildRun(drag.row, drag.start, drag.end - drag.start + 1);
      bar.classList.add("is-drag-preview");
      layer.append(bar);
      this.previewRunEl = bar;
    }
  }

  private clearCreatePreview(): void {
    this.previewRunEl?.remove();
    this.previewRunEl = null;
    this.clearAllCellPreviews();
  }

  private previewResize(
    drag: ResizeDrag,
    runEl: HTMLElement,
    extended: boolean,
  ): void {
    // LL-1: the run keeps TRUE geometry; the width write matches buildRun.
    runEl.style.width = `${drag.length * this.stepWidthPx - this.gapPx}px`;
    if (extended) {
      // Dashed outline on the cells the extension newly covers (the bar
      // itself is the primary preview; shrink previews stay bar-only).
      const rowCells = this.cells[drag.row];
      if (rowCells) {
        const oldEnd = drag.start + drag.from;
        for (
          let step = Math.max(0, Math.ceil(oldEnd));
          step < drag.start + drag.length && step < this.opts.steps;
          step++
        ) {
          this.cellInRow(rowCells, step)?.setAttribute(
            "data-preview",
            "true",
          );
        }
      }
    }
  }

  private clearResizePreview(row: number): void {
    this.clearAllCellPreviews();
    this.renderRuns(row); // restore committed bar geometry
  }

  private previewPaint(drag: PaintDrag, offCells: ReadonlySet<string>): void {
    this.clearPaintPreview();
    const rowCells = this.cells[drag.row];
    if (!rowCells) return;
    const range = paintDragRange(drag);
    for (let step = range.from; step <= range.to; step++) {
      if (offCells.has(`${drag.row}:${step}`))
        this.cellInRow(rowCells, step)?.setAttribute("data-preview", "true");
    }
  }

  private clearPaintPreview(): void {
    this.clearAllCellPreviews();
  }

  private clearAllCellPreviews(): void {
    for (const row of this.cells) {
      for (const cell of row) delete cell.dataset.preview;
    }
  }

  // -- focus / roving --------------------------------------------------------

  private activate(cell: HTMLElement): void {
    this.setRoving(cell);
    this.opts.onToggle(Number(cell.dataset.row), Number(cell.dataset.step));
  }

  private moveFocus(row: number, step: number): void {
    // Carry-clamp law (keynav carryCellTo): a position carried from a taller
    // grid clamps to THIS grid's row count and the PATTERN's step count —
    // never wraps. LL-1 (G8): the clamp is the PATTERN extent (never the
    // window), and a step outside the window re-seats the window first.
    const rowIndex = Math.min(Math.max(row, 0), this.cells.length - 1);
    const stepIndex = Math.min(Math.max(step, 0), this.opts.steps - 1);
    this.ensureColVisible(stepIndex);
    const cell = this.cellFor(rowIndex, stepIndex);
    if (!cell) return;
    this.setRoving(cell);
    // preventScroll: the window-follows-focus law is OURS (ensureRowVisible
    // below, block:"nearest") — the native focus scroll-into-view would
    // fight the seat with uncoordinated offsets.
    cell.focus({ preventScroll: true });
    // RC-1 (E9): arrows walk the FULL manifest — when focus crosses the
    // window edge the window scrolls the MINIMAL amount that keeps the
    // focused row visible ("the cursor holds the window").
    this.ensureRowVisible(rowIndex);
    this.opts.onWindowScroll?.(this.seatedStart);
  }

  private setRoving(cell: HTMLElement): void {
    if (this.rovingCell === cell) return;
    if (this.rovingCell) this.rovingCell.tabIndex = -1;
    cell.tabIndex = 0;
    this.rovingCell = cell;
  }

  private loop = (): void => {
    // LL-1: the mount may run before first layout (clientWidth 0 → fallback
    // window) — correct it once on the first real frame.
    if (this.mountPending) {
      this.mountPending = false;
      if (this.virtual) this.rewindow(false);
    }
    const frame = this.opts.host.readFrame();
    if (!frame) {
      this.setPlayhead(null);
      this.clearColumnHighlight();
      this.lastQuantized = null;
    } else {
      const reduced =
        this.reducedMotion?.matches ?? this.opts.host.prefersReducedMotion();
      if (reduced) {
        // D9: quantized column highlight, no sweep.
        this.setPlayhead(null);
      } else {
        this.setPlayhead(
          playheadX(frame.loopTime, frame.options, this.stepWidthPx),
        );
      }
      const q = quantizedStep(frame.loopTime, frame.options);
      // LL-1 (seam G5): the glow wrap modulus is the renderer's OWN step
      // count (the pattern width) — self-consistent glow at any extent, even
      // while the playhead basis still rides the transport's compat loopBars
      // (LL-2 swaps that basis; today the two agree at every shipped shape).
      const crossed = stepsCrossed(this.lastQuantized, q, this.opts.steps);
      for (const step of crossed) {
        if (reduced) this.highlightColumn(step);
        else this.triggerGlow(step);
      }
      if (reduced && crossed.length > 0) {
        this.clearColumnHighlight(crossed[crossed.length - 1]);
      }
      this.lastQuantized = q;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private highlightColumn(step: number): void {
    for (const row of this.cells) {
      this.cellInRow(row, step)?.classList.add("is-col-active");
    }
  }

  private clearColumnHighlight(keep?: number): void {
    for (let step = this.winStart; step < this.winEnd; step++) {
      if (step === keep) continue;
      for (const row of this.cells) {
        this.cellInRow(row, step)?.classList.remove("is-col-active");
      }
    }
  }
}
