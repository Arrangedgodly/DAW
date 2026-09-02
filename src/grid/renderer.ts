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
}

export interface GridRenderer {
  /** Request a cell activation (visual state arrives via sync()). */
  toggle(row: number, step: number): void;
  /** Position the playhead light bar (px) or park it (null). */
  setPlayhead(x: number | null): void;
  /** One-shot trigger glow on the sounding cells of a column. */
  triggerGlow(step: number): void;
  /** Recompute cached geometry (after resize / font load). */
  layout(): void;
  /** Push document pattern state (class toggles only). */
  sync(pattern: DrumPattern | PitchedPattern): void;
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
    grid.className = "lane-grid";
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
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.activate(target);
      return;
    }
    // Structural roving minimum (DA-1 completes the full spec later).
    const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (dir !== undefined) {
      e.preventDefault();
      this.moveFocus(Number(target.dataset.row), Number(target.dataset.step) + dir);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      this.moveFocus(
        Number(target.dataset.row) + (e.key === "ArrowDown" ? 1 : -1),
        Number(target.dataset.step),
      );
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
