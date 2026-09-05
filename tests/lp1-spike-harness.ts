/**
 * LP-1 (iteration 3) — shared spike machinery (Thor). Imported by
 * tests/lp1-perf-spike.test.ts (node) + tests/browser/lp1-perf-spike.test.tsx
 * (browser) — the tests/fuzz-harness.ts precedent for shared non-test code.
 *
 * THROWAWAY-MEASURABLE PROTOTYPE (the worker contract): nothing here lands in
 * src/. It contains the two committed-approach candidates the spike proves:
 *
 * 1. BOUNDED TIME-MATH — the O(1) step lookup that replaces the O(steps)
 *    linear scans at `src/audio/time.ts:99-112` (stepIndexAtTime) and
 *    `src/audio/song.ts:118-123` (stepOfTime). Algorithm: one division-floor
 *    GUESS (floor(t / secondsPerStep)) plus at most three EXACT
 *    timeAtStep-boundary predicate checks (candidates guess-1..guess+1) —
 *    bit-identical decisions to the scan by construction because the
 *    predicates are timeAtStep verbatim, and proven by the exhaustive sweep
 *    in the node harness. LL-1/LL-2 land this in src/ (seams A5 + F5).
 *
 * 2. COLUMN-WINDOW VIRTUALIZATION at the renderer seam — WindowedGridRenderer
 *    below, the DOM/CSS-grid prototype of the committed windowing approach:
 *    the grid keeps its full `repeat(steps, cellPx)` column template (native
 *    scroll extent + beat shading geometry unchanged) while each row renders
 *    [left spacer spanning winStart tracks][window cells][right spacer] —
 *    spacers are plain grid items, so cell geometry/scrollbars/playhead math
 *    are byte-identical to the eager renderer's, and the DOM holds only
 *    ~rows × visibleColumns cells. Rewindowing is hysteresis-gated (only
 *    when the visible range leaves the inner band) and scroll-driven. The
 *    rAF loop is the production law (transform playhead + quantized glow)
 *    on the BOUNDED math over a steps-typed basis (the LL-2 shape). LL-1
 *    wires real editing through this seam (window-aware keynav, G8).
 *
 * 3. Long-loop document builders at the iteration-3 target shapes (the
 *    user's poly-loop example + the all-128 worst case).
 */

import {
  type GrooveOptions,
  secondsPerStep,
  timeAtStep,
} from "../src/audio/time";
import type {
  DrumPattern,
  Note,
  Pattern,
  PatternBars,
  ProjectDocument,
} from "../src/document/schema";
import { DRUM_PIECES, createDefaultProject } from "../src/document/schema";

// ---------------------------------------------------------------------------
// Reference scans — exact copies of the production algorithms, re-typed to
// `steps` (the LP-1 shape; production keeps LoopBars through the compat
// window — seam A5).
// ---------------------------------------------------------------------------

/** Exact copy of stepIndexAtTime's scan body, steps-typed (time.ts:99-112). */
export function scanStepIndexAtTime(
  t: number,
  steps: number,
  groove: GrooveOptions,
): number {
  const loopLen = steps * secondsPerStep(groove.bpm);
  const local = t >= 0 ? t % loopLen : ((t % loopLen) + loopLen) % loopLen;
  for (let i = 0; i < steps - 1; i++) {
    if (local >= timeAtStep(i, groove) && local < timeAtStep(i + 1, groove)) {
      return i;
    }
  }
  return steps - 1;
}

/** Exact copy of song.ts stepOfTime's scan body (private there; :118-123). */
export function scanStepOfTime(
  t: number,
  groove: GrooveOptions,
  steps: number,
): number {
  for (let i = 0; i < steps - 1; i++) {
    if (t >= timeAtStep(i, groove) && t < timeAtStep(i + 1, groove)) return i;
  }
  return steps - 1;
}

// ---------------------------------------------------------------------------
// The bounded replacement (the LP-1 committed approach).
// ---------------------------------------------------------------------------

/**
 * Bounded step lookup for a NON-NEGATIVE, unwrapped pattern-local time
 * (song.ts's stepOfTime replacement): the step i with timeAtStep(i) <= t <
 * timeAtStep(i + 1), clamped into [0, steps - 1] with the scan's fallback.
 */
export function stepOfTimeBounded(
  t: number,
  groove: GrooveOptions,
  steps: number,
): number {
  if (steps <= 1) return Math.max(steps - 1, 0);
  const spb = secondsPerStep(groove.bpm);
  const guess = Math.max(0, Math.floor(t / spb));
  for (let i = Math.max(0, guess - 1); i <= guess + 1; i++) {
    if (t >= timeAtStep(i, groove) && t < timeAtStep(i + 1, groove)) {
      return Math.min(i, steps - 1);
    }
  }
  return steps - 1;
}

/**
 * Bounded step lookup for a loop-relative time (time.ts's stepIndexAtTime
 * replacement at any step count): same wrap fast path as production, then
 * the O(1) lookup.
 */
export function stepIndexAtTimeBounded(
  t: number,
  steps: number,
  groove: GrooveOptions,
): number {
  const loopLen = steps * secondsPerStep(groove.bpm);
  const local = t >= 0 ? t % loopLen : ((t % loopLen) + loopLen) % loopLen;
  return stepOfTimeBounded(local, groove, steps);
}

/**
 * Steps-typed playhead x (the LL-2 G1 shape: grid/math.ts playheadX with a
 * steps-typed basis instead of LoopBars) on the bounded lookup. Same
 * interpolation law as production: fraction through the CURRENT step's
 * [timeAtStep(step), timeAtStep(step + 1)) window.
 */
export function playheadXSteps(
  t: number,
  steps: number,
  groove: GrooveOptions,
  stepWidthPx: number,
): number {
  const loopLen = steps * secondsPerStep(groove.bpm);
  const local = Math.min(Math.max(t, 0), Math.max(loopLen - 1e-9, 0));
  const step = stepIndexAtTimeBounded(local, steps, groove);
  const t0 = timeAtStep(step, groove);
  const t1 = step + 1 < steps ? timeAtStep(step + 1, groove) : loopLen;
  const span = Math.max(t1 - t0, 1e-9);
  const frac = Math.min(Math.max((local - t0) / span, 0), 1);
  return (step + frac) * stepWidthPx;
}

// ---------------------------------------------------------------------------
// WindowedGridRenderer — the column-window prototype (renderer seam).
// ---------------------------------------------------------------------------

export interface WindowedGridGeometry {
  readonly cellPx: number;
  readonly gapPx: number;
  readonly labelPx: number;
  readonly rowHeightPx: number;
}

export interface WindowedFrame {
  readonly playing: boolean;
  readonly loopTime: number;
  readonly groove: GrooveOptions;
  /** The lane's step basis (chain total — the LL-2 shape, up to 2048). */
  readonly steps: number;
}

export interface WindowedGridOptions {
  /** The scroll container (the .lane-grid-scroll role). */
  readonly container: HTMLElement;
  readonly laneLabel: string;
  readonly rowLabels: readonly string[];
  readonly steps: number;
  readonly pitched: boolean;
  readonly geometry: WindowedGridGeometry;
  readonly readFrame: () => WindowedFrame | null;
  readonly prefersReducedMotion?: () => boolean;
  /** Columns kept beyond each visible edge (default 24). */
  readonly overscan?: number;
}

/** A rendered sustained-note bar (pitched rows). */
export interface WindowedSpan {
  readonly start: number;
  readonly length: number;
}

/**
 * The column-windowed DOM/CSS-grid renderer prototype — the COMMITTED
 * APPROACH shape (sticky-layer variant, chosen over spacer-spans after
 * measurement: re-laying-out spacer spans in a repeat(2048) template cost
 * ~25 ms per rewindow under a fling-speed sweep; the sticky layer's layout
 * scales with the WINDOW, never the pattern). Architecture:
 *
 *   container (.lane-grid-scroll, overflow-x: auto, position: relative)
 *   ├─ sizer  (absolute, width = labelPx + steps × stepWidth — the native
 *   │          scroll extent: scrollLeft maps to pattern columns exactly)
 *   └─ layer  (position: sticky; left: 0 — the COMPOSITOR pins it to the
 *              visible edge while the sizer scrolls under it)
 *      └─ .lane-grid > .grid-body > .grid-row > .row-label + .row-cells
 *         (repeat(winCols, cellPx) — ONLY the window's tracks exist)
 *
 * Rewindow (hysteresis: only when the visible range exhausts the overscan)
 * rebuilds the window's cells and CLIPS note-runs to the window (the G6
 * law); its layout cost is O(winCols × rows) at any pattern size. The
 * playhead/glow rAF loop is the production law on the BOUNDED math, with
 * the playhead x window-relative (patternX − winStart × stepWidth).
 */
export class WindowedGridRenderer {
  private readonly opts: WindowedGridOptions;
  private readonly stepWidthPx: number;
  private readonly overscan: number;
  private gridEl: HTMLElement;
  private playheadEl: HTMLElement;
  private readonly rowEls: HTMLElement[] = [];
  private readonly cellsEls: HTMLElement[] = [];
  /** cells[row][i] = the cell for step winStart + i (null: not in window). */
  private cells: (HTMLElement | null)[][] = [];
  private winStart = 0;
  private winEnd = 0;
  private raf = 0;
  private lastQuantized: number | null = null;
  private readonly glowTimers = new Set<number>();
  private readonly reducedMotion: MediaQueryList | null =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  /** Committed content: drums hits or pitched spans per row. */
  private drumSteps: readonly boolean[][] | null = null;
  private spans: readonly (readonly WindowedSpan[])[] = [];
  /**
   * Flattened on-state per row over the FULL pattern (0 = off, 1 = anchor,
   * 2 = sustain), rebuilt O(rows × steps) per sync — applyOnState then
   * reads O(1) per cell (the O(cells × spans) shape was the sweep's cost:
   * a 7,680-note row makes `spans.some` per cell 512-way).
   */
  private rowOn: Uint8Array[] = [];
  /** Diagnostics for the harness: rewindows + last rebuild cost. */
  rewindows = 0;
  lastRewindowMs = 0;

  private sizerEl!: HTMLElement;

  constructor(opts: WindowedGridOptions) {
    this.opts = opts;
    this.stepWidthPx = opts.geometry.cellPx + opts.geometry.gapPx;
    this.overscan = opts.overscan ?? 24;

    // The scroll-extent sizer: pattern-wide, invisible, absolute.
    const sizer = document.createElement("div");
    sizer.setAttribute("aria-hidden", "true");
    sizer.style.cssText = `position:absolute;top:0;left:0;height:1px;width:${opts.geometry.labelPx + opts.steps * this.stepWidthPx}px;visibility:hidden;`;
    opts.container.style.position = "relative";
    opts.container.append(sizer);
    this.sizerEl = sizer;

    // The sticky layer: pinned to the visible edge by the compositor; all
    // layout inside scales with the WINDOW.
    const layer = document.createElement("div");
    layer.style.cssText = "position:sticky;left:0;width:max-content;";
    opts.container.append(layer);

    const grid = document.createElement("div");
    grid.className = "lane-grid";
    grid.setAttribute("role", "grid");
    grid.setAttribute(
      "aria-label",
      `${opts.laneLabel} grid · WINDOWED PROTOTYPE · ${opts.steps} STEPS`,
    );
    const body = document.createElement("div");
    body.className = "grid-body";
    for (let row = 0; row < opts.rowLabels.length; row++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.setAttribute("role", "row");
      rowEl.style.contain = "layout style paint";
      const label = document.createElement("div");
      label.className = "row-label";
      label.setAttribute("role", "rowheader");
      label.textContent = opts.rowLabels[row]!;
      label.style.width = `${opts.geometry.labelPx}px`;
      rowEl.append(label);
      const cellsEl = document.createElement("div");
      cellsEl.className = "row-cells";
      cellsEl.style.gridAutoRows = `${opts.geometry.rowHeightPx}px`;
      cellsEl.style.gap = `${opts.geometry.gapPx}px`;
      rowEl.append(cellsEl);
      body.append(rowEl);
      this.rowEls.push(rowEl);
      this.cellsEls.push(cellsEl);
    }
    const playhead = document.createElement("div");
    playhead.className = "grid-playhead";
    playhead.setAttribute("aria-hidden", "true");
    playhead.style.left = `${opts.geometry.labelPx}px`;
    body.append(playhead);
    this.playheadEl = playhead;
    grid.append(body);
    this.gridEl = grid;
    layer.append(grid);

    this.rewindow(true);
    opts.container.addEventListener("scroll", this.onScroll, {
      passive: true,
    });
    this.loop();
  }

  /** The DOM cell count currently held (the virtualization law's metric). */
  cellCount(): number {
    return this.opts.container.querySelectorAll(".cell").length;
  }

  /** Sync committed content (drums pattern or pitched spans per row). */
  sync(content: { drumRows: readonly boolean[][] } | { pitchedSpans: readonly (readonly WindowedSpan[])[] }): void {
    if ("drumRows" in content) {
      this.drumSteps = content.drumRows;
      this.spans = this.opts.rowLabels.map(() => []);
    } else {
      this.spans = content.pitchedSpans;
      this.drumSteps = null;
    }
    this.rebuildRowOn();
    this.applyOnState();
    this.renderRuns();
  }

  /** Flatten content to O(1)-readable per-row state arrays (full pattern). */
  private rebuildRowOn(): void {
    const steps = this.opts.steps;
    this.rowOn = this.opts.rowLabels.map((_, row) => {
      const arr = new Uint8Array(steps);
      if (this.drumSteps) {
        const rowSteps = this.drumSteps[row] ?? [];
        for (let s = 0; s < steps; s++) if (rowSteps[s]) arr[s] = 1;
      } else {
        for (const span of this.spans[row] ?? []) {
          const from = Math.max(0, Math.min(steps - 1, span.start));
          const to = Math.min(steps, span.start + Math.max(1, span.length));
          arr[from] = 1;
          for (let s = from + 1; s < to; s++) arr[s] = 2;
        }
      }
      return arr;
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const timer of this.glowTimers) window.clearTimeout(timer);
    this.glowTimers.clear();
    this.opts.container.removeEventListener("scroll", this.onScroll);
    this.gridEl.parentElement?.remove();
    this.sizerEl.remove();
  }

  // -- windowing -----------------------------------------------------------

  private visibleRange(): { first: number; last: number } {
    const c = this.opts.container;
    const first = Math.max(
      0,
      Math.floor(c.scrollLeft / this.stepWidthPx) - 1,
    );
    const visible = Math.ceil(
      (c.clientWidth - this.opts.geometry.labelPx) / this.stepWidthPx,
    );
    return { first, last: Math.min(this.opts.steps, first + visible + 1) };
  }

  private onScroll = (): void => {
    // Hysteresis: rewindow only when the visible range EXHAUSTS the
    // window's overscan (first/last reaches a window edge) — the recentered
    // window then buys another full (overscan + visible) columns of travel
    // before the next rebuild, instead of firing per frame mid-sweep.
    const { first, last } = this.visibleRange();
    if (first <= this.winStart || last >= this.winEnd) this.rewindow(false);
  };

  private rewindow(initial: boolean): void {
    const t0 = performance.now();
    const { first, last } = this.visibleRange();
    const start = Math.max(0, first - this.overscan);
    const end = Math.min(this.opts.steps, last + this.overscan);
    this.winStart = start;
    this.winEnd = end;
    const winCols = end - start;
    for (let row = 0; row < this.cellsEls.length; row++) {
      const cellsEl = this.cellsEls[row]!;
      let runs = cellsEl.querySelector<HTMLElement>(".note-runs");
      if (!runs && this.opts.pitched) {
        runs = document.createElement("div");
        runs.className = "note-runs";
        runs.setAttribute("aria-hidden", "true");
        cellsEl.append(runs);
      }
      // ONLY the window's tracks exist — layout cost is O(winCols), never
      // O(steps) (the measured spacer-span variant's failure mode). Cells
      // are RECYCLED, not re-created: a rewindow re-tags the existing pool
      // (auto-placement keeps DOM order == column order, so a dataset
      // re-tag IS a column shift — zero element churn, zero layout tree
      // rebuild; only paint-level invalidations remain).
      if (this.cells[row]?.length !== winCols) {
        cellsEl.style.gridTemplateColumns = `repeat(${winCols}, ${this.opts.geometry.cellPx}px)`;
      }
      const pool = this.cells[row] ?? [];
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
      this.cells[row] = pool;
    }
    this.applyOnState();
    this.renderRuns();
    if (!initial) this.rewindows++;
    this.lastRewindowMs = performance.now() - t0;
  }

  private applyOnState(): void {
    for (let row = 0; row < this.cells.length; row++) {
      const rowCells = this.cells[row]!;
      const on = this.rowOn[row];
      if (!on) continue;
      for (let i = 0; i < rowCells.length; i++) {
        const cell = rowCells[i];
        if (!cell) continue;
        const state = on[this.winStart + i];
        cell.dataset.on = String(state !== 0);
        cell.setAttribute("aria-selected", String(state !== 0));
        cell.dataset.sustain = String(state === 2);
      }
    }
  }

  private renderRuns(): void {
    if (!this.opts.pitched) return;
    const runMargin = 64;
    for (let row = 0; row < this.cellsEls.length; row++) {
      const cellsEl = this.cellsEls[row]!;
      let layer = cellsEl.querySelector<HTMLElement>(".note-runs");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "note-runs";
        layer.setAttribute("aria-hidden", "true");
        cellsEl.append(layer);
      }
      layer.replaceChildren();
      const spans = this.spans[row] ?? [];
      for (const span of spans) {
        // Bounded existence + G6 clipping: only runs intersecting the
        // window enter the DOM, and their geometry is CLIPPED to the
        // window (window-relative coordinates — the sticky layer's grid
        // spans only winCols tracks).
        if (span.start + span.length < this.winStart - runMargin) continue;
        if (span.start > this.winEnd + runMargin) continue;
        const from = Math.max(span.start, this.winStart);
        const to = Math.min(span.start + span.length, this.winEnd);
        const run = document.createElement("div");
        run.className = "note-run";
        run.style.left = `${(from - this.winStart) * this.stepWidthPx}px`;
        run.style.width = `${Math.max(1, to - from) * this.stepWidthPx - this.opts.geometry.gapPx}px`;
        layer.append(run);
      }
    }
  }

  // -- rAF loop (the production law, bounded math) ---------------------------

  private loop = (): void => {
    const frame = this.opts.readFrame();
    if (!frame || !frame.playing) {
      this.playheadEl.style.opacity = "0";
      this.lastQuantized = null;
    } else {
      const reduced =
        this.reducedMotion?.matches ??
        this.opts.prefersReducedMotion?.() ??
        false;
      if (reduced) {
        this.playheadEl.style.opacity = "0";
      } else {
        this.playheadEl.style.opacity = "1";
        // Window-relative: the sticky layer's origin IS winStart, so the
        // pattern-coordinate x shifts by the window offset (O(1); the
        // off-window playhead simply paints outside the layer).
        this.playheadEl.style.transform = `translateX(${playheadXSteps(
          frame.loopTime,
          frame.steps,
          frame.groove,
          this.stepWidthPx,
        ) - this.winStart * this.stepWidthPx}px)`;
      }
      const q = stepIndexAtTimeBounded(
        frame.loopTime,
        frame.steps,
        frame.groove,
      );
      if (this.lastQuantized !== null && this.lastQuantized !== q) {
        // Crossed columns (no wrap handling needed at this scale for the
        // prototype; a single-step crossing is the steady-state case).
        const from = this.lastQuantized;
        const to = q;
        for (let s = from + 1; s <= to; s++) this.triggerGlow(s);
      }
      this.lastQuantized = q;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private triggerGlow(step: number): void {
    const i = step - this.winStart;
    if (i < 0 || i >= this.winEnd - this.winStart) return;
    for (const rowCells of this.cells) {
      const cell = rowCells[i];
      if (!cell || cell.dataset.on !== "true") continue;
      cell.classList.add("is-triggering");
      const timer = window.setTimeout(() => {
        cell.classList.remove("is-triggering");
        this.glowTimers.delete(timer);
      }, 180);
      this.glowTimers.add(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Long-loop document builders (iteration-3 target shapes).
// ---------------------------------------------------------------------------

function drumPattern(
  id: string,
  bars: PatternBars,
  density: "musical" | "max",
): DrumPattern {
  const width = bars * 16;
  const steps = {} as DrumPattern["steps"];
  for (const piece of DRUM_PIECES) {
    const arr = new Array<boolean>(width).fill(false);
    for (let s = 0; s < width; s++) {
      if (density === "max") arr[s] = true;
      else if (piece === "kick") arr[s] = s % 8 === 0;
      else if (piece === "snare") arr[s] = s % 16 === 8;
      else if (piece === "hat") arr[s] = s % 2 === 0;
      else if (piece === "openhat") arr[s] = s % 16 === 14;
      else if (piece === "clap") arr[s] = s % 32 === 28;
      else arr[s] = s % 4 === 2;
    }
    steps[piece] = arr;
  }
  return { kind: "drums", id, name: "A", bars, steps };
}

function pitchedPattern(
  id: string,
  bars: PatternBars,
  rowDegrees: readonly number[],
  stride: number,
  sustain = 1,
): Pattern {
  const notes: Note[] = [];
  for (const degree of rowDegrees)
    for (let start = 0; start < bars * 16; start += stride)
      notes.push({ degree, start, length: sustain });
  return {
    kind: "pitched",
    id,
    name: "A",
    bars,
    rowDegrees: [...rowDegrees],
    notes,
  };
}

export type LongLoopShape = "user64" | "all128";

/**
 * The iteration-3 target documents. `user64` = the user's poly-loop example
 * (drums 64B + bass 4B + chords 8B, lead 4B → LCM = one 64-bar cycle,
 * 128 s @120 BPM). `all128` = the worst case (every lane one 128-bar
 * pattern → LCM = 2048 steps = 256 s @120 BPM, and 42 rows × 2048 =
 * 86,016 eager grid cells across the quadrants — the town-hall ~100k
 * framing). Musical density (16th-chain feel) unless noted.
 */
export function longLoopDoc(shape: LongLoopShape): ProjectDocument {
  const base = createDefaultProject();
  if (shape === "user64") {
    return {
      ...base,
      patterns: {
        drums: [drumPattern("drums-1", 64, "musical")],
        bass: [pitchedPattern("bass-1", 4, [0, 1, 2, 3, 4, 5, 6], 4, 2)],
        chords: [pitchedPattern("chords-1", 8, [0, 1, 2, 3, 4, 5, 6], 8, 4)],
        lead: [pitchedPattern("lead-1", 4, Array.from({ length: 15 }, (_, i) => i), 2)],
      },
      songChain: {
        drums: ["drums-1"],
        bass: ["bass-1"],
        chords: ["chords-1"],
        lead: ["lead-1"],
      },
    };
  }
  return {
    ...base,
    patterns: {
      drums: [drumPattern("drums-1", 128, "musical")],
      bass: [pitchedPattern("bass-1", 128, [0, 1, 2, 3, 4, 5, 6], 4, 2)],
      chords: [pitchedPattern("chords-1", 128, [0, 1, 2, 3, 4, 5, 6], 8, 4)],
      lead: [
        pitchedPattern("lead-1", 128, Array.from({ length: 15 }, (_, i) => i), 4),
      ],
    },
    songChain: {
      drums: ["drums-1"],
      bass: ["bass-1"],
      chords: ["chords-1"],
      lead: ["lead-1"],
    },
  };
}

/**
 * The frame-budget document: the user's poly-loop shape but with the LEAD
 * lane carrying the dense 128-bar pattern (a note every 4th step across the
 * 15-row manifest + one full-length 2048-step note on row 0) — "a 128-bar
 * pattern visible on one lane while all four lanes play dense long chains"
 * (the LP-1 task's target state; LCM = 128 bars = 256 s @120 BPM).
 */
export function denseLead128Doc(): ProjectDocument {
  const doc = longLoopDoc("user64");
  const lead = pitchedPattern(
    "lead-1",
    128,
    Array.from({ length: 15 }, (_, i) => i),
    4,
  );
  lead.notes = [
    { degree: 0, start: 0, length: 2048 },
    ...lead.notes.filter((n) => n.degree !== 0),
  ];
  return { ...doc, patterns: { ...doc.patterns, lead: [lead] } };
}

/** Pitched spans per row for the windowed renderer (LaneGrid's sync shape). */
export function spansForPattern(
  pattern: Pattern,
): readonly (readonly WindowedSpan[])[] {
  if (pattern.kind !== "pitched") return [];
  const byDegree = new Map<number, WindowedSpan[]>();
  for (const note of pattern.notes) {
    const list = byDegree.get(note.degree);
    if (list) list.push({ start: note.start, length: note.length });
    else byDegree.set(note.degree, [{ start: note.start, length: note.length }]);
  }
  return pattern.rowDegrees.map((degree) => byDegree.get(degree) ?? []);
}

/** Drum rows in DRUM_PIECES order for the windowed renderer. */
export function drumRowsFor(pattern: Pattern): boolean[][] {
  if (pattern.kind !== "drums") return [];
  return DRUM_PIECES.map((piece) => [...(pattern.steps[piece] ?? [])]);
}
