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
 */

import type {
  DrumPattern,
  LaneId,
  PitchedPatternView,
} from "../document/schema";
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

/** Default geometry = the v0 full-floor editing size. */
export const GRID_CELL_PX = 24;
export const GRID_GAP_PX = 2;
export const GRID_LABEL_PX = 72;
/** PX-3 fill-rail slot width (drums rows only). */
export const GRID_FILL_RAIL_PX = 152;

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
  /** Horizontal gap between cells (default 2). */
  readonly gapPx?: number;
  /** Row-label gutter px (default 72). */
  readonly labelPx?: number;
  /** Fill-rail slot width (default 152; drums mountFillControl only). */
  readonly fillRailPx?: number;
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
   * PX-3 (drums only): mount a per-row fill control into the row's dedicated
   * rail slot. Called once per row during build; the owner renders its own
   * framework UI into `el` and owns that subtree's lifecycle.
   */
  readonly mountFillControl?: (row: number, el: HTMLElement) => void;
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
  /** One-shot trigger glow on the sounding cells of a column. */
  triggerGlow(step: number): void;
  /** Recompute cached geometry (after resize / font load). */
  layout(): void;
  /** Push document pattern state (class toggles only). */
  sync(pattern: DrumPattern | PitchedPatternView): void;
  /**
   * PX-3: paint a Euclidean PREVIEW overlay onto one row (dashed lane-hue
   * outline; never touches the committed on-state). Null clears the preview.
   */
  previewRow(row: number, on: readonly boolean[] | null): void;
  dispose(): void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * DOM/CSS-Grid default renderer. Builds the grid once (rows + cells + playhead
 * bar), then only mutates classes, one transform and data attributes.
 */
export class DomGridRenderer implements GridRenderer {
  private readonly opts: DomGridRendererOptions;
  private readonly cells: HTMLElement[][] = [];
  private readonly runLayers: (HTMLElement | null)[] = [];
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
  private readonly stepWidthPx: number;
  private readonly playheadLeftPx: number;
  private gridEl: HTMLElement | null = null;

  constructor(opts: DomGridRendererOptions) {
    this.opts = opts;
    this.cellPx = opts.cellPx ?? GRID_CELL_PX;
    this.gapPx = opts.gapPx ?? GRID_GAP_PX;
    this.stepWidthPx = this.cellPx + this.gapPx;
    this.labelPx = opts.labelPx ?? GRID_LABEL_PX;
    const fillPx = opts.mountFillControl
      ? (opts.fillRailPx ?? GRID_FILL_RAIL_PX)
      : 0;
    this.playheadLeftPx = this.labelPx + fillPx;
    this.editable = opts.editable ?? true;
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
      rowEl.style.contain = "layout style paint";

      const label = document.createElement("div");
      label.className = "row-label";
      label.setAttribute("role", "rowheader");
      label.textContent = rowLabels[row];
      label.style.width = `${this.labelPx}px`;
      rowEl.append(label);

      const cellsEl = document.createElement("div");
      cellsEl.className = "row-cells";
      cellsEl.style.gridTemplateColumns = `repeat(${steps}, ${this.cellPx}px)`;
      cellsEl.style.gridAutoRows = `${this.cellPx}px`;
      cellsEl.style.gap = `${this.gapPx}px`;

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
        cell.setAttribute("aria-label", `${rowLabels[row]} step ${step + 1}`);
        cellsEl.append(cell);
        rowCells.push(cell);
      }
      this.cells.push(rowCells);

      // Sustained-note width layer (pitched only).
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
      // shifting the grid columns. DA-2: the slot is a gridcell so the row's
      // required-children contract holds (the fill control is a labeled
      // interactive group — legal inside a gridcell, not a bare row).
      if (this.opts.mountFillControl) {
        const fill = document.createElement("div");
        fill.className = "row-fill";
        fill.setAttribute("role", "gridcell");
        fill.dataset.row = String(row);
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
    if (typeof window !== "undefined" && window.matchMedia) {
      this.reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    }
  }

  /** E3 (a11y §7): the grid's accessible name carries the edit state in text. */
  private gridAriaLabel(): string {
    return `${this.opts.laneLabel} grid · ${this.editable ? "EDITING" : "VIEW ONLY"}`;
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

  sync(pattern: DrumPattern | PitchedPatternView): void {
    if (pattern.kind === "drums") {
      const pieces = Object.keys(pattern.steps);
      for (let row = 0; row < this.cells.length; row++) {
        const steps = pattern.steps[pieces[row] as keyof typeof pattern.steps];
        const rowCells = this.cells[row];
        for (let step = 0; step < rowCells.length; step++) {
          this.applyOn(rowCells[step], Boolean(steps?.[step]));
        }
      }
      return;
    }
    for (let row = 0; row < this.cells.length; row++) {
      const patternRow = pattern.rows[row];
      const rowCells = this.cells[row];
      for (let step = 0; step < rowCells.length; step++) {
        const cell = patternRow?.steps[step] ?? 0;
        this.applyOn(rowCells[step], cell !== 0);
        rowCells[step].dataset.sustain = cell === 2 ? "true" : "false";
      }
      this.syncRuns(row, patternRow?.steps ?? []);
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
    this.opts.container.removeEventListener("click", this.onClick);
    this.opts.container.removeEventListener("keydown", this.onKeyDown);
  }

  // -- internals ------------------------------------------------------------

  private applyOn(cell: HTMLElement, on: boolean): void {
    cell.dataset.on = String(on);
    cell.setAttribute("aria-selected", String(on));
  }

  private syncRuns(row: number, steps: readonly number[]): void {
    const layer = this.runLayers[row];
    if (!layer) return;
    layer.replaceChildren();
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] !== 1) continue;
      let len = 1;
      while (i + len < steps.length && steps[i + len] === 2) len++;
      const run = document.createElement("div");
      run.className = "note-run";
      run.style.left = `calc(${i} * ${this.stepWidthPx}px)`;
      run.style.width = `calc(${len} * ${this.stepWidthPx}px - ${this.gapPx}px)`;
      layer.append(run);
      i += len - 1;
    }
  }

  private onClick = (e: Event): void => {
    // View-only quadrants: clicks select the QUADRANT (LaneGrid wires that on
    // the floor); the grid itself never toggles.
    if (!this.editable) return;
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
