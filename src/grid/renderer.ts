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
 */

import type { DrumPattern, LaneId, PitchedPattern } from "../document/schema";
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

/** Step column width budget: cell + gap (px). Keep cells ≥20px for editing. */
export const GRID_CELL_PX = 24;
export const GRID_GAP_PX = 2;
export const STEP_WIDTH_PX = GRID_CELL_PX + GRID_GAP_PX;

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
  /** Position the playhead light bar (px) or park it (null). */
  setPlayhead(x: number | null): void;
  /** One-shot trigger glow on the sounding cells of a column. */
  triggerGlow(step: number): void;
  /** Recompute cached geometry (after resize / font load). */
  layout(): void;
  /** Push document pattern state (class toggles only). */
  sync(pattern: DrumPattern | PitchedPattern): void;
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

  constructor(opts: DomGridRendererOptions) {
    this.opts = opts;
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
    grid.setAttribute("aria-label", `${this.opts.laneLabel} grid`);

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
      rowEl.append(label);

      const cellsEl = document.createElement("div");
      cellsEl.className = "row-cells";
      cellsEl.style.gridTemplateColumns = `repeat(${steps}, ${GRID_CELL_PX}px)`;

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
        cell.setAttribute(
          "aria-label",
          `${rowLabels[row]} step ${step + 1}`,
        );
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
      // shifting the grid columns.
      if (this.opts.mountFillControl) {
        const fill = document.createElement("div");
        fill.className = "row-fill";
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
    body.append(playhead);
    this.playheadEl = playhead;

    grid.append(body);
    container.append(grid);

    // Roving tabindex seed: first cell.
    const first = this.cells[0]?.[0];
    if (first) {
      first.tabIndex = 0;
      this.rovingCell = first;
    }

    container.addEventListener("click", this.onClick);
    container.addEventListener("keydown", this.onKeyDown);
    if (typeof window !== "undefined" && window.matchMedia) {
      this.reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    }
  }

  // -- interface ----------------------------------------------------------

  toggle(row: number, step: number): void {
    this.opts.onToggle(row, step);
  }

  focusCell(row: number, step: number): void {
    this.moveFocus(row, step);
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

  sync(pattern: DrumPattern | PitchedPattern): void {
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
      run.style.left = `calc(${i} * ${STEP_WIDTH_PX}px)`;
      run.style.width = `calc(${len} * ${STEP_WIDTH_PX}px - ${GRID_GAP_PX}px)`;
      layer.append(run);
      i += len - 1;
    }
  }

  private onClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("cell")) return;
    this.activate(target);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
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
      const head = this.opts.container.closest(".lane-floor")?.querySelector<HTMLElement>(
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
      const next = nextCell(pos, { rows: this.cells.length, steps: this.cells[0]?.length ?? 0 }, move);
      this.moveFocus(next.row, next.step);
    }
  };

  private activate(cell: HTMLElement): void {
    this.setRoving(cell);
    this.opts.onToggle(Number(cell.dataset.row), Number(cell.dataset.step));
  }

  private moveFocus(row: number, step: number): void {
    const rowCells = this.cells[row];
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
      const reduced = this.reducedMotion?.matches ?? this.opts.host.prefersReducedMotion();
      if (reduced) {
        // D9: quantized column highlight, no sweep.
        this.setPlayhead(null);
      } else {
        this.setPlayhead(playheadX(frame.loopTime, frame.options, STEP_WIDTH_PX));
      }
      const q = quantizedStep(frame.loopTime, frame.options);
      const crossed = stepsCrossed(this.lastQuantized, q, frame.options.bars * 16);
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
