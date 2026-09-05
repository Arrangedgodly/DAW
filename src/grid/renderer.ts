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
   * T5 (route.md playback-reactivity #5): fired from the EXISTING crossed-
   * steps computation in the render loop — once per crossed step while
   * playing, and once with `null` on the playing→parked transition (the
   * stop edge, so consumers can clear held state; no repeat fires while
   * parked). Host-side observation ONLY: the renderer writes nothing for
   * this and the audio path is untouched (R2 fence — the payload is step
   * identity alone, no engine coupling). Consumers own the policy; the
   * sanctioned v2 consumer toggles ONE `.is-sounding` class per beat per
   * lane on the quadrant chassis (LaneGrid) — those class writes join
   * TH-4(b)'s named legal set.
   */
  readonly onStepPulse?: (step: number | null) => void;
}

export interface GridRenderer {
  /** Request a cell activation (visual state arrives via sync()). */
  toggle(row: number, step: number): void;
  /** DA-1: move DOM focus + the roving tabindex to a cell (clamped). */
  focusCell(row: number, step: number): void;
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
  private gridEl: HTMLElement | null = null;
  /** IN-2 announcement span (E4 — the gate-stepper value pattern). */
  private lengthLiveEl: HTMLElement | null = null;
  /** IN-2 active pointer gesture; null = idle. */
  private gesture: Gesture | null = null;
  /** IN-2 preview bar for a create-drag (removed on end). */
  private previewRunEl: HTMLElement | null = null;
  /** IN-2: swallow the click that follows a committed/cancelled gesture. */
  private suppressClick = false;
  private suppressClearTimer = 0;

  constructor(opts: DomGridRendererOptions) {
    this.opts = opts;
    this.cellPx = opts.cellPx ?? GRID_CELL_PX;
    this.gapPx = opts.gapPx ?? GRID_GAP_PX;
    this.stepWidthPx = this.cellPx + this.gapPx;
    this.labelPx = opts.labelPx ?? GRID_LABEL_PX;
    this.rowHeightPx = opts.rowHeightPx ?? this.cellPx;
    this.fillPx = opts.mountFillControl
      ? (opts.fillRailPx ?? GRID_FILL_RAIL_PX)
      : 0;
    // MB-1: overlay mode only exists where a fill control is mounted (drums).
    this.fillOverlay =
      !!opts.mountFillControl && (opts.fillRailMode ?? "inline") === "overlay";
    // The playhead offset always matches where the CELLS actually start:
    // inline = label + fill slot; overlay = the label alone (the overlay is
    // out of flow, so the cells begin right after the label).
    this.playheadLeftPx = this.labelPx + (this.fillOverlay ? 0 : this.fillPx);
    this.editable = opts.editable ?? true;
    this.rowSpans = opts.rowLabels.map(() => []);
    this.build();
    this.loop();
  }

  // -- construction ---------------------------------------------------------

  private build(): void {
    const { container, rowLabels, steps } = this.opts;
    container.replaceChildren();
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
    }

    // Playhead light bar — compositor-only (transform), spans all rows.
    const playhead = document.createElement("div");
    playhead.className = "grid-playhead";
    playhead.setAttribute("aria-hidden", "true");
    playhead.style.left = `${this.playheadLeftPx}px`;
    body.append(playhead);
    this.playheadEl = playhead;

    grid.append(body);
    container.append(grid);

    // IN-2 E4: the local note-length announcement value span (gate-stepper
    // pattern). OUTSIDE the role=grid element so the grid's required-children
    // contract stays clean; NO aria-label (aria-prohibited-attr on live
    // regions — the DA-2 toasts lesson).
    const live = document.createElement("span");
    live.className = "head-sr note-length-live";
    live.setAttribute("aria-live", "polite");
    container.append(live);
    this.lengthLiveEl = live;

    // Roving tabindex seed: first cell (editable grids only — LY-1).
    const first = this.cells[0]?.[0];
    if (first && this.editable) {
      first.tabIndex = 0;
      this.rovingCell = first;
    } else if (first) {
      this.rovingCell = first; // remembered for setEditable(true), no tab stop
    }

    container.addEventListener("click", this.onClick);
    container.addEventListener("keydown", this.onKeyDown);
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

  /** E3 (a11y §7): the grid's accessible name carries the edit state in text. */
  private gridAriaLabel(): string {
    return `${this.opts.laneLabel} grid · ${this.editable ? "EDITING" : "VIEW ONLY"}`;
  }

  /**
   * E4 (a11y §7): the focused cell's name carries note state in text —
   * anchor: `<row> step <n>, note starts, <len> steps`; spanned:
   * `…, note continues`; empty: the v0 name.
   */
  private cellName(row: number, step: number): string {
    const base = `${this.opts.rowLabels[row]} step ${step + 1}`;
    if (!this.opts.pitched) return base;
    const idx = focusedSpanIndex(this.rowSpans[row] ?? [], step);
    if (idx < 0) return base;
    const span = this.rowSpans[row][idx];
    if (span.start === step)
      return `${base}, note starts, ${String(span.length)} steps`;
    return `${base}, note continues`;
  }

  // -- interface ----------------------------------------------------------

  toggle(row: number, step: number): void {
    if (!this.editable) return;
    this.opts.onToggle(row, step);
  }

  focusCell(row: number, step: number): void {
    this.moveFocus(row, step);
  }

  focusRoving(): void {
    if (!this.editable) return;
    if (this.rovingCell) this.rovingCell.focus();
    else this.moveFocus(0, 0);
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
  }

  setPlayhead(x: number | null): void {
    if (!this.playheadEl) return;
    if (x === null) {
      this.playheadEl.style.opacity = "0";
      return;
    }
    this.playheadEl.style.opacity = "1";
    this.playheadEl.style.transform = `translateX(${x}px)`;
  }

  setRowHeight(px: number): void {
    if (px === this.rowHeightPx) return; // idempotent — observers converge
    this.rowHeightPx = px;
    for (const track of this.rowTracks) track.style.gridAutoRows = `${px}px`;
  }

  triggerGlow(step: number): void {
    for (const row of this.cells) {
      const cell = row[step];
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
      for (let row = 0; row < this.cells.length; row++) {
        const piece = DRUM_PIECES[row];
        const steps = pattern.steps[piece];
        const rowCells = this.cells[row];
        for (let step = 0; step < rowCells.length; step++) {
          this.applyOn(rowCells[step], Boolean(steps?.[step]));
        }
      }
      return;
    }
    this.rowSpans = pattern.rows;
    for (let row = 0; row < this.cells.length; row++) {
      this.syncPitchedRow(row);
    }
  }

  previewRow(row: number, on: readonly boolean[] | null): void {
    const rowCells = this.cells[row];
    if (!rowCells) return;
    for (let step = 0; step < rowCells.length; step++) {
      const cell = rowCells[step];
      if (on?.[step]) cell.dataset.preview = "true";
      else delete cell.dataset.preview;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const timer of this.glowTimers) window.clearTimeout(timer);
    this.glowTimers.clear();
    if (this.suppressClearTimer) window.clearTimeout(this.suppressClearTimer);
    const { container } = this.opts;
    container.removeEventListener("click", this.onClick);
    container.removeEventListener("keydown", this.onKeyDown);
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

  /** Render one pitched row from its committed spans: cells + bars + names. */
  private syncPitchedRow(row: number): void {
    const spans = this.rowSpans[row] ?? [];
    const rowCells = this.cells[row];
    for (let step = 0; step < rowCells.length; step++) {
      const idx = focusedSpanIndex(spans, step);
      const covering = idx >= 0;
      const anchor = covering && spans[idx].start === step;
      this.applyOn(rowCells[step], covering);
      rowCells[step].dataset.sustain = String(covering && !anchor);
      rowCells[step].setAttribute("aria-label", this.cellName(row, step));
    }
    this.renderRuns(row);
  }

  private renderRuns(row: number): void {
    const layer = this.runLayers[row];
    if (!layer) return;
    layer.replaceChildren();
    for (const span of this.rowSpans[row] ?? []) {
      layer.append(this.buildRun(row, span.start, span.length));
    }
  }

  private buildRun(row: number, start: number, length: number): HTMLElement {
    const run = document.createElement("div");
    run.className = "note-run";
    run.style.left = `calc(${start} * ${this.stepWidthPx}px)`;
    run.style.width = `calc(${length} * ${this.stepWidthPx}px - ${this.gapPx}px)`;
    // IN-2 right-edge resize hit zone (keyboard equivalent = `+`/`-` keys —
    // the zone itself is aria-hidden decoration, never a tab stop).
    const edge = document.createElement("div");
    edge.className = "note-edge";
    edge.dataset.row = String(row);
    edge.dataset.start = String(start);
    edge.dataset.length = String(length);
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

    // Within-grid moves: pure math from keynav (clamped, never wraps).
    const move = gridMoveForKey(e.key, e.ctrlKey || e.metaKey);
    if (move !== null) {
      e.preventDefault();
      const next = nextCell(
        pos,
        { rows: this.cells.length, steps: this.cells[0]?.length ?? 0 },
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
    if (next === span.length) return; // clamped no-op at 0.25 / 128
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

  /** Cells currently off, keyed "row:step" — the paint commit set. */
  private snapshotOffCells(): Set<string> {
    const off = new Set<string>();
    for (let row = 0; row < this.cells.length; row++) {
      const rowCells = this.cells[row];
      for (let step = 0; step < rowCells.length; step++) {
        if (rowCells[step].dataset.on !== "true") off.add(`${row}:${step}`);
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

  /** The pointer's step-space position on one row (x only; gestures are row-locked). */
  private pointerStepFloat(e: PointerEvent, row: number): number {
    const cellsEl = this.cells[row]?.[0]?.parentElement;
    if (!cellsEl) return 0;
    const rect = cellsEl.getBoundingClientRect();
    return (e.clientX - rect.left) / this.stepWidthPx;
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
        const anchor = this.cells[g.drag.row]?.[g.drag.start];
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
    const anchor = this.cells[row]?.[step];
    if (!anchor) return;
    if (this.cellAtPoint(e.clientX, e.clientY) !== anchor) return;
    this.armClickSuppression(); // the trailing click must not double-activate
    this.activate(anchor);
  }

  /**
   * The cell under viewport coordinates (x inside the step span, y inside the
   * row band) — the release-side hit test for click parity. Null off-grid.
   */
  private cellAtPoint(clientX: number, clientY: number): HTMLElement | null {
    for (const rowCells of this.cells) {
      const el = rowCells[0]?.parentElement;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top || clientY >= rect.bottom) continue;
      if (clientX < rect.left || clientX >= rect.right) return null;
      const step = Math.floor((clientX - rect.left) / this.stepWidthPx);
      return rowCells[step] ?? null;
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
      rowCells[step]?.setAttribute("data-preview", "true");
    }
    const layer = this.runLayers[drag.row];
    if (layer && drag.end > drag.start) {
      const bar = this.buildRun(
        drag.row,
        drag.start,
        drag.end - drag.start + 1,
      );
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
    runEl.style.width = `calc(${drag.length} * ${this.stepWidthPx}px - ${this.gapPx}px)`;
    if (extended) {
      // Dashed outline on the cells the extension newly covers (the bar
      // itself is the primary preview; shrink previews stay bar-only).
      const rowCells = this.cells[drag.row];
      const oldEnd = drag.start + drag.from;
      for (
        let step = Math.max(0, Math.ceil(oldEnd));
        step < drag.start + drag.length && step < rowCells.length;
        step++
      ) {
        rowCells[step]?.setAttribute("data-preview", "true");
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
        rowCells[step]?.setAttribute("data-preview", "true");
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
    // grid clamps to THIS grid's row count and step count — never wraps.
    const rowIndex = Math.min(Math.max(row, 0), this.cells.length - 1);
    const rowCells = this.cells[rowIndex];
    if (!rowCells) return;
    const cell = rowCells[Math.min(Math.max(step, 0), rowCells.length - 1)];
    if (!cell) return;
    this.setRoving(cell);
    cell.focus();
  }

  private setRoving(cell: HTMLElement): void {
    if (this.rovingCell === cell) return;
    if (this.rovingCell) this.rovingCell.tabIndex = -1;
    cell.tabIndex = 0;
    this.rovingCell = cell;
  }

  private loop = (): void => {
    const frame = this.opts.host.readFrame();
    if (!frame) {
      // T5: the playing→parked edge — fire the pulse callback's null step
      // ONCE (lastQuantized is non-null only on the first parked frame after
      // playback; consumers clear held sounding state, no idle phantoms).
      if (this.lastQuantized !== null) this.opts.onStepPulse?.(null);
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
      const crossed = stepsCrossed(
        this.lastQuantized,
        q,
        frame.options.bars * 16,
      );
      for (const step of crossed) {
        if (reduced) this.highlightColumn(step);
        else this.triggerGlow(step);
        // T5: host-side step observation (fires in BOTH motion modes — the
        // consumer owns the reduced-motion policy; see onStepPulse).
        this.opts.onStepPulse?.(step);
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
      row[step]?.classList.add("is-col-active");
    }
  }

  private clearColumnHighlight(keep?: number): void {
    for (let step = 0; step < (this.cells[0]?.length ?? 0); step++) {
      if (step === keep) continue;
      for (const row of this.cells) {
        row[step]?.classList.remove("is-col-active");
      }
    }
  }
}
