/**
 * LaneGrid (DES-4, DES-6, LY-1, IN-2): one lane's pad floor — a QUADRANT of
 * the 2×2 stage. The DOM grid itself is owned by DomGridRenderer (D1 seam); this
 * component provides the quadrant chassis (strip, scroll container, hue),
 * the document write-through + audition wiring, and the quadrant-selection
 * law. Nothing here re-renders at 60 Hz — the renderer's rAF loop handles
 * the playhead and glow outside Solid entirely.
 *
 * DES-6: the grid edits the lane's ACTIVE pattern — the ephemeral selection
 * (selection.ts activePatterns), which the pattern rail drives. A Keyed
 * wrapper remounts the grid surface when the selected pattern (or its shape)
 * changes; the selection itself lives outside, so collapse/expand and
 * pattern switches never lose your place.
 *
 * LY-1: exactly ONE quadrant is editable (selection.activeLane IS the
 * quadrant selection); the other three render view-only with live notes +
 * playhead, no tab stops, not focus traps (a11y §7 E2). A click on any part
 * of a view-only quadrant selects it (pointer parity — keyboard.md v2).
 *
 * IN-2 (v2 note law): pitched clicks/Enter place (gate default), remove
 * (anchor) or trim (mid-span) through the SC-2 pattern-scoped note actions —
 * replacing the v0 all-patterns cell toggle (journey-change ledger #2).
 * Pointer drag-create / edge-drag resize / drums paint commit through the
 * same actions on release (previews are renderer-local, zero store writes).
 */

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import {
  DRUM_PIECES,
  type DrumPiece,
  type DrumPattern,
  type LaneId,
  PITCH_CLASS_NAMES,
  type Pattern,
  resolveGateSteps,
} from "../document/schema";
import { effectiveScale, modeSize } from "../document/scales";
import { getSession } from "../engine/session";
import {
  DomGridRenderer,
  type PitchedNotesView,
  type PlayheadFrame,
} from "../grid/renderer";
import {
  addNote,
  docStore,
  removeNote,
  resizeNote,
  toggleDrumStep,
} from "../state/store";
import {
  activeLane,
  activePatterns,
  currentPatternFor,
  selectLane,
  stageMode,
} from "../state/selection";
import {
  focusRequest,
  requestLaneFocus,
  selectQuadrantFromPointer,
} from "../state/gridFocus";
import { closeFxConsole, fxConsoleLane } from "../state/fxConsole";
import { closeFillRails, fillRailsOpen } from "../state/fillRails";
import { noteEditAt, type Span } from "../interaction/drag";
import { registerHelp } from "../help/registry";
import LaneHeader from "./LaneHeader";
import EuclidFill from "./EuclidFill";
import { LANE_NAMES } from "./laneMeta";

const session = getSession();

/**
 * HP-2 help content — one entry per quadrant's grid (Professor X voice on
 * HP-1's registry; I2-6 colocated law). The entry covers every cell/row
 * inside the grid: the InfoView resolves focus/hover through
 * `closest("[data-help]")`, so the per-cell names (renderer) stay as they are.
 */
for (const lane of ["drums", "bass", "chords", "lead"] as const) {
  registerHelp([
    {
      id: `grid.${lane}`,
      title: `${LANE_NAMES[lane]} GRID`,
      text:
        lane === "drums"
          ? "The drum machine. Click a pad — or walk with the arrows and press Enter — to toggle a hit; drag to paint several at once. The E rail left of each row spreads hits evenly for you."
          : `Where ${LANE_NAMES[lane]}'s notes live. Click once for a note of the lane's GATE length; drag right to draw a longer one, then drag its right edge (or press + / −) to resize. Rows follow the lane's scale, so everything you place sits in key.`,
    },
  ]);
}

/**
 * LY-1 quadrant geometry (production decision inside the committed 2×2
 * structure, recorded in-task): drums keeps near-v0 pad scale (6 rows); the
 * 14-row pitched lanes compress to 16 px cells so every quadrant fits the
 * one-page 1440×900 law. Long patterns scroll horizontally inside the
 * quadrant (the v0 per-grid mechanism) — the page itself never scrolls.
 *
 * Refinement-4 (critique P2-5, the 1280×800 one-page breach — vertical
 * half): minRowPx is the per-lane READABILITY FLOOR for the row-track
 * compression the viewport-budget fit applies (see fitQuadrantRows below).
 * drums 20 px = the fill-rail control stack's committed height (SET and the
 * steppers must never be squeezed under their own controls); pitched 11 px =
 * the Silkscreen label floor (10 px glyphs + 1 px breathing — reached only
 * when a tallest 14-row lane is the EDITING quadrant at the 1280×800
 * minimum, where its strip edit tier + 4 px editing row margins spend the
 * rest of that quadrant's budget). Below these floors the page honestly
 * scrolls instead of shrinking illegibly — narrower viewports are the
 * mobile slice's (MB-1) breakpoints, which extend this same seam.
 */
const QUADRANT_GEOMETRY: Record<
  LaneId,
  {
    cellPx: number;
    gapPx: number;
    labelPx: number;
    fillRailPx: number;
    minRowPx: number;
  }
> = {
  // Refinement-2 (critique P1-2): the fill rail must FIT its control stack —
  // at the old 104 px slot the E-tag + pulses/rotation steppers + SET needed
  // 200 px (207 at the 4-bar "64/64" readout worst case), so the control
  // overflowed 88 px UNDER the row cells and SET was pointer-dead
  // (elementFromPoint at its center returned a .cell; real clicks timed out).
  // 220 = measured 207.3 worst case + font-fallback headroom (the 8 px
  // trailing gutter rides inside the slot as padding, total 228). The stolen
  // 124 px of grid width is re-budgeted inside the quadrant per its own law
  // (long patterns scroll INSIDE the quadrant — a 1-bar pattern,
  // 72+228+350=650 px, still fits the 666 px quadrant gut at 1440×900 with
  // zero internal scroll; 4-bar scrolls, exactly as before).
  drums: { cellPx: 20, gapPx: 2, labelPx: 72, fillRailPx: 220, minRowPx: 20 },
  bass: { cellPx: 16, gapPx: 1, labelPx: 64, fillRailPx: 0, minRowPx: 11 },
  chords: { cellPx: 16, gapPx: 1, labelPx: 64, fillRailPx: 0, minRowPx: 11 },
  lead: { cellPx: 16, gapPx: 1, labelPx: 64, fillRailPx: 0, minRowPx: 11 },
};

/* ---------------------------------------------------------------------------
 * MB-1 (mobile slice): the NARROW geometry — phone (<768 single-lane stage)
 * AND tablet (768–1024 quadrant stage) share one horizontal law so rotation
 * between them re-fits without a geometry rethink:
 *   - cell 15 + gap 1: the tightest phone (360 px) must fit a 1-bar row
 *     BESIDE its label with no horizontal scroll (the committed default
 *     view) — drums measure 68 (label box) + 16×15 + 15 = 323 px against a
 *     334 px content width, 11 px of honest slack; 16 px cells would read
 *     339 px and scroll. The quadrant pitched scale (16) stays 16 — only
 *     the narrow preset pays the phone-width tax;
 *   - labels condense (drums 60 = the OPENHAT Silkscreen floor at 10 px;
 *     pitched 48 — short note names);
 *   - the drums fill rail becomes a focus-revealed OVERLAY over the cells
 *     (renderer fillRailMode "overlay" — the 220 px in-flow slot would leave
 *     ~4 visible cells at 360 px, so the committed "1-bar default view"
 *     forces the rail out of flow; MB-3 owns the touch-reveal twin);
 *   - minRowPx 11 for every lane at narrow widths (the drums 20 px floor
 *     protected the IN-FLOW fill control — the overlay removes that need;
 *     11 px stays the Silkscreen label floor, the refinement-4 readability
 *     law the tablet fit compresses toward).
 * PHONE_ROW_PX restores the v0 24 px editing rows on the phone stage: the
 * single lane owns the whole viewport height and the page scrolls (the
 * committed scrolling law), so rows can be finger-sized instead of
 * quadrant-compressed.
 * ------------------------------------------------------------------------- */
const NARROW_GEOMETRY: Record<
  LaneId,
  {
    cellPx: number;
    gapPx: number;
    labelPx: number;
    fillRailPx: number;
    minRowPx: number;
  }
> = {
  drums: { cellPx: 15, gapPx: 1, labelPx: 60, fillRailPx: 220, minRowPx: 11 },
  bass: { cellPx: 15, gapPx: 1, labelPx: 48, fillRailPx: 0, minRowPx: 11 },
  chords: { cellPx: 15, gapPx: 1, labelPx: 48, fillRailPx: 0, minRowPx: 11 },
  lead: { cellPx: 15, gapPx: 1, labelPx: 48, fillRailPx: 0, minRowPx: 11 },
};
const PHONE_ROW_PX = 24;

/* ---------------------------------------------------------------------------
 * Refinement-4 (critique P2-5): the quadrant stage FLEXES within the 100dvh
 * budget. The shell was already a fixed-height flex column (.app 100dvh →
 * stage flex:1 min-height:0), but the quadrant row tracks were FIXED px
 * (renderer-pinned 16/20), so whenever the viewport's leftover fell short
 * (measured 825 px of content in the 800 px viewport at 1280×800) the page
 * scrolled — the grow-on-miss law without its shrink-to-fit twin (the
 * critique's own framing). The mechanism below is the renderer-pinned-
 * geometry precedent (label pin, fill-rail pin, refinement-1's measured FX
 * wrap): MEASURE the real flexed budget, then re-pin each quadrant's
 * vertical row-track px through the renderer seam (setRowHeight) so the
 * quadrant's own laws decide HOW it compresses —
 *   - tracks clamp at cellPx when the budget is met (viewports that fit are
 *     BYTE-IDENTICAL to before: 1440×900 and 1920×1080 keep their 290 px
 *     quadrant rows and 16/20 px tracks);
 *   - tracks compress toward minRowPx only by the measured deficit (no
 *     content loss: every row stays fully rendered, cells within
 *     readability);
 *   - horizontal laws untouched (long/1-bar patterns scroll INSIDE the
 *     quadrant exactly as today — entry-2's recorded 1280 trade stands);
 *   - rotation-safe: ResizeObservers on the stage/rail/every strip (booth
 *     wrap, rail growth, edit-row toggles — everything that changes the
 *     budget) re-run the fit, and the rAF-rendered playhead is untouched
 *     (the v0 resize law holds by construction).
 * MB-1 (the mobile slice) extends this seam: its tablet scale re-uses the
 * parameterized geometry + this fit; its phone stage replaces the 2×2 but
 * keeps the same 100dvh shell.
 * ------------------------------------------------------------------------- */

/** One live grid surface registered for the budget fit (GridSurface scope). */
interface QuadrantSurface {
  /** Stage row (0 = drums|bass, 1 = chords|lead) — the 2×2 pairing. */
  readonly row: 0 | 1;
  readonly rowCount: number;
  readonly minRowPx: number;
  readonly maxRowPx: number;
  readonly renderer: () => DomGridRenderer | null;
  readonly scrollEl: HTMLElement;
  readonly stripEl: HTMLElement | null;
}

const liveSurfaces = new Set<QuadrantSurface>();
let fitObserver: ResizeObserver | null = null;
let fitQueued = false;

/** rAF-coalesced fit (resize-time only — never in the 60 Hz loop). */
function scheduleFit(): void {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    fitQuadrantRows();
  });
}

/**
 * The fit itself — TWO PHASES, measured, never restated as constants (the
 * refinement-2 drift lesson):
 *
 * Phase 1 (grow-on-miss preserved): measure every quadrant's NATURAL height
 * (strip + chrome + max-track content, at its CURRENT edit state — the
 * selected quadrant's strip carries the edit tier and 4px row margins) and
 * sum the two stage ROWS (each row = the taller of its pair). If the rows
 * fit the stage's real leftover (100dvh − booth-as-wrapped − rail-as-wrapped
 * − the floors' chrome), NOTHING compresses — viewports that fit keep the
 * committed scale byte-for-byte, exactly the pre-entry layout law.
 *
 * Phase 2 (shrink-to-fit, the critique's ask): only under a REAL total
 * deficit does each quadrant compress against an equal split of the budget
 * — the deficit is repaid in whole track px down to the lane's readability
 * floor. Natural heights are extrapolated from the CURRENT pinned track
 * (offsetHeight + rows × (max − current)) so measurement never writes to
 * the DOM (a layout write mid-gesture is the TH-4(b) zero-mutations law).
 *
 * Guards: no shell (bare component tests) or no layout (jsdom) → stand
 * down; provisional font metrics never compress (see ensureFitObservers).
 */
function fitQuadrantRows(): void {
  // MB-1: the phone stage SCROLLS (the committed sticky-chrome + scrolling-
  // grid law) — there is no one-page budget to fit, so the compressor stands
  // down; tracks stay at the phone preset. (No phone surfaces register
  // either — this guard is defense in depth for mid-rotation transitions.)
  if (stageMode() === "phone") return;
  const stage = document.querySelector<HTMLElement>("main.stage");
  const rail = document.querySelector<HTMLElement>(".rail");
  const floors = document.querySelector<HTMLElement>(".stage-floors");
  if (!stage || !rail || !floors || liveSurfaces.size === 0) return;
  const stageH = stage.clientHeight;
  const railH = rail.offsetHeight;
  if (stageH <= 0 || railH <= 0) return; // no layout context — stand down
  // Never COMPRESS on provisional metrics: before the pixel faces load,
  // fallback-font heights run a hair taller and the compression would be
  // undone by the font-swap observer — the TH-4(b) flip-flop write class.
  // Restores stay allowed (no-op at the committed scale).
  const fontsFinal =
    typeof document === "undefined" ||
    !document.fonts ||
    document.fonts.status === "loaded";
  const floorsStyle = getComputedStyle(floors);
  const chrome =
    Number.parseFloat(floorsStyle.paddingTop) +
    Number.parseFloat(floorsStyle.paddingBottom) +
    Number.parseFloat(floorsStyle.rowGap);
  const rowsBudget = stageH - railH - chrome;
  const rowH = Math.floor(rowsBudget / 2);
  if (rowH <= 0) return;

  // Phase 1: measure every quadrant's natural height (no DOM writes).
  const measured: Array<{
    surface: QuadrantSurface;
    renderer: DomGridRenderer;
    above: number;
    below: number;
    natural: number;
  }> = [];
  const rowNatural = [0, 0];
  for (const surface of liveSurfaces) {
    const renderer = surface.renderer();
    const scroll = surface.scrollEl;
    if (!renderer || !scroll.isConnected) continue;
    const floor = scroll.closest<HTMLElement>(".lane-floor");
    if (!floor) continue;
    // Everything above the scroll container (the strip, at its CURRENT
    // edit state) + the card chrome under it.
    const above =
      scroll.getBoundingClientRect().top - floor.getBoundingClientRect().top;
    const floorStyle = getComputedStyle(floor);
    const below =
      Number.parseFloat(floorStyle.paddingBottom) +
      Number.parseFloat(floorStyle.borderBottomWidth);
    // Natural (max-track) content height WITHOUT touching the DOM:
    // extrapolate linearly from the CURRENT pinned track — offsetHeight is
    // the honest flow height (it includes the horizontal-scrollbar
    // thickening of an in-quadrant h-scrolling grid, e.g. 4-bar patterns).
    const firstTrack = scroll.querySelector<HTMLElement>(".row-cells");
    if (!firstTrack) continue;
    const currentPx = Number.parseFloat(firstTrack.style.gridAutoRows);
    const natural =
      scroll.offsetHeight + surface.rowCount * (surface.maxRowPx - currentPx);
    measured.push({ surface, renderer, above, below, natural });
    const total = above + below + natural;
    if (total > rowNatural[surface.row]) rowNatural[surface.row] = total;
  }

  // Phase 2: fit — restore when the page fits naturally, else compress.
  const fitsNaturally = rowNatural[0] + rowNatural[1] <= rowsBudget;
  for (const m of measured) {
    const { surface, renderer, above, below, natural } = m;
    const available = rowH - above - below;
    if (fitsNaturally || !fontsFinal || natural <= available) {
      // Budget met — the committed scale (no-op restore when already max).
      renderer.setRowHeight(surface.maxRowPx);
      continue;
    }
    const deficit = natural - available;
    const target = Math.max(
      surface.minRowPx,
      surface.maxRowPx - Math.ceil(deficit / surface.rowCount),
    );
    renderer.setRowHeight(target);
  }
}

/** Observe everything that can change the budget (lazily, once). */
function ensureFitObservers(surfaces: Iterable<QuadrantSurface>): void {
  if (
    fitObserver ||
    typeof window === "undefined" ||
    typeof window.ResizeObserver === "undefined"
  ) {
    return;
  }
  fitObserver = new ResizeObserver(() => scheduleFit());
  // Viewport/booth wrap (stage height) + rail growth (tile wraps).
  const stage = document.querySelector("main.stage");
  const rail = document.querySelector(".rail");
  if (stage) fitObserver.observe(stage);
  if (rail) fitObserver.observe(rail);
  // Strip height flips (the edit tier follows the selection).
  for (const surface of surfaces) {
    if (surface.stripEl) fitObserver.observe(surface.stripEl);
  }
  // Font landings: the pixel faces change strip/label metrics, and the
  // swap may NOT resize any observed element — so the fit that finally
  // may compress (see fontsFinal) re-runs on every completed load batch.
  // (document.fonts.ready is NOT usable here: it can resolve before the
  // first load even starts, with fallback metrics still applied.)
  document.fonts?.addEventListener("loadingdone", scheduleFit);
}

function registerQuadrantSurface(surface: QuadrantSurface): void {
  liveSurfaces.add(surface);
  // MB-1: the phone/desktop shell swap REMOVES the old stage/rail elements
  // from the DOM (App renders a different structure per stage mode), so the
  // budget observers re-target the CURRENT elements on every registration —
  // observing the same element twice is a no-op, and a fresh rotation's
  // remount therefore always lands observed.
  if (fitObserver) {
    const stage = document.querySelector("main.stage");
    const rail = document.querySelector(".rail");
    if (stage) fitObserver.observe(stage);
    if (rail) fitObserver.observe(rail);
  } else {
    ensureFitObservers(liveSurfaces);
  }
  if (surface.stripEl && fitObserver) fitObserver.observe(surface.stripEl);
  // Synchronous first fit: onMount runs before the first paint, and with
  // provisional font metrics it can only restore (no-op) — compression
  // waits for final metrics via the loadingdone/observer triggers above.
  fitQuadrantRows();
}

function unregisterQuadrantSurface(surface: QuadrantSurface): void {
  liveSurfaces.delete(surface);
  if (surface.stripEl && fitObserver) fitObserver.unobserve(surface.stripEl);
}

function currentPattern(lane: LaneId): Pattern | undefined {
  void activePatterns();
  return currentPatternFor(lane);
}

function drumLabels(): string[] {
  return DRUM_PIECES.map((p) => p.toUpperCase());
}

/** Degree rows for a pitched lane: note names over ~2 octaves (1 for chords). */
function pitchedLabels(
  lane: Exclude<LaneId, "drums">,
  pattern: Pattern,
): {
  labels: string[];
  degrees: number[];
} {
  const doc = docStore.getState().doc;
  const scale = effectiveScale(doc, lane);
  const size = modeSize(scale.mode);
  const degrees = pattern.kind === "pitched" ? [...pattern.rowDegrees] : [];
  const labels = degrees.map((degree) => {
    const pc = (scale.root + scale.intervals[degree % size]) % 12;
    const octave = Math.floor(degree / size);
    return PITCH_CLASS_NAMES[pc] + (octave > 0 ? "′" : "");
  });
  return { labels, degrees };
}

/**
 * What the renderer syncs (IN-2): drums patterns pass through; pitched
 * patterns project their v2 NOTES onto rows (degree → row index via the
 * pattern's manifest). The renderer renders note spans natively — the v1
 * cell view (SC-1 bridge) is retired from the UI path.
 */
function syncPatternFor(pattern: Pattern): DrumPattern | PitchedNotesView {
  if (pattern.kind !== "pitched") return pattern; // drums pass through
  const byDegree = new Map<number, Span[]>();
  for (const note of pattern.notes) {
    const list = byDegree.get(note.degree);
    if (list) list.push(note);
    else byDegree.set(note.degree, [note]);
  }
  const rows = pattern.rowDegrees.map(
    (degree) => byDegree.get(degree) ?? [], // degree without a row: unplayed
  );
  return { kind: "pitched", rows };
}

/**
 * The lane's effective gate in note steps at the CURRENT document BPM — the
 * single-click default length (I2-3), read at interaction time so BPM/gate
 * edits apply immediately.
 */
function laneGateStepsNow(lane: LaneId): number {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane);
  return conf ? resolveGateSteps(conf.gate, doc.transport.bpm) : 1;
}

/**
 * One row's note spans at interaction time (the mount-time props.pattern is
 * a stale snapshot after the first edit — always read the live document).
 */
function rowSpansNow(lane: LaneId, patternId: string, degree: number): Span[] {
  const p = docStore
    .getState()
    .doc.patterns[lane].find((cand) => cand.id === patternId);
  if (p?.kind !== "pitched") return [];
  return p.notes
    .filter((n) => n.degree === degree)
    .map((n) => ({ start: n.start, length: n.length }));
}

/**
 * The grid surface for exactly one pattern shape. Mounts the renderer, syncs
 * content edits from the store, disposes on cleanup. Keyed by pattern id +
 * step count so every shape change rebuilds cleanly.
 */
function GridSurface(props: { lane: LaneId; pattern: Pattern }) {
  let container: HTMLDivElement | undefined;

  onMount(() => {
    if (!container) return;
    const lane = props.lane;
    const pattern = props.pattern;

    // MB-1: geometry preset follows the stage mode. The mount is keyed on
    // the mode too (LaneGrid's key), so a phone↔tablet↔desktop transition
    // remounts the surface with its own geometry — the renderer pins px
    // inline at build time, so a live re-pin of every axis would be a bigger
    // seam than the pattern-shape remounts that already exist (DES-6).
    const mode = stageMode();
    const narrow = mode !== "desktop";
    const geo = narrow ? NARROW_GEOMETRY[lane] : QUADRANT_GEOMETRY[lane];

    const pitched = pattern.kind === "pitched";
    const rowLabels = pitched
      ? pitchedLabels(lane as Exclude<LaneId, "drums">, pattern).labels
      : drumLabels();
    const degrees = pitched
      ? pitchedLabels(lane as Exclude<LaneId, "drums">, pattern).degrees
      : [];
    const steps = pattern.bars * 16;
    // (mode-aware preset chosen above — MB-1)

    const readFrame = (): PlayheadFrame | null => {
      const snap = session.transport.snapshot;
      if (!snap.playing) return null;
      return {
        playing: true,
        loopTime: session.transport.getLoopTime(),
        options: { bars: snap.loopBars, bpm: snap.bpm, swing: snap.swing },
      };
    };

    let rendererRef: DomGridRenderer | null = null;
    const fillDisposers: Array<() => void> = [];

    /*
     * T5 (route.md playback-reactivity #5): the lane-rim sounding pulse.
     * The renderer's EXISTING rAF loop fires onStepPulse per crossed step
     * (and null when the transport parks); this surface owns the policy —
     * ONE class toggle per BEAT per lane (the plan's AC law), on the
     * quadrant chassis (.lane-floor, the element carrying T3's rim grammar;
     * chassis.css paints the pre-painted ::after rim layer — opacity only,
     * ~120ms decay, compositor-only). ZERO new rAF loops. Reduced-motion
     * twin is dual-gated: the matchMedia check here switches the policy to
     * add-and-HOLD (static lit rim while playing, one write, no churn) and
     * the CSS media query kills the animation (chassis.css) — same
     * information, statically.
     */
    const floorEl = container.closest<HTMLElement>(".lane-floor");
    const RIM_PULSE_HOLD_MS = 120; // = --rim-pulse-decay (tokens.css; the renderer glow-timer precedent)
    let soundingTimer = 0;
    const stopSounding = (): void => {
      if (soundingTimer) {
        window.clearTimeout(soundingTimer);
        soundingTimer = 0;
      }
      floorEl?.classList.remove("is-sounding");
    };
    const prefersReducedMotion = (): boolean =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    const renderer = new DomGridRenderer({
      container,
      laneId: lane,
      laneLabel: LANE_NAMES[lane],
      rowLabels,
      steps,
      pitched,
      cellPx: geo.cellPx,
      gapPx: geo.gapPx,
      labelPx: geo.labelPx,
      fillRailPx: geo.fillRailPx,
      // MB-1: narrow stages overlay the drums fill rail over the cells
      // (out of flow) so a 1-bar row fits; desktop stays inline (the
      // refinement-2 law, byte-identical).
      fillRailMode: narrow ? "overlay" : "inline",
      // MB-1: the phone stage restores the v0 24 px editing rows (the single
      // lane owns the viewport height; the page scrolls). Tablet keeps the
      // renderer default (row track = cellPx, the quadrant law the
      // refinement-4 fit then compresses).
      rowHeightPx: mode === "phone" ? PHONE_ROW_PX : undefined,
      // LY-1: only the selected quadrant's grid starts editable.
      editable: activeLane() === lane,
      host: {
        readFrame,
        prefersReducedMotion: () =>
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
            true,
      },
      // PX-3: drums rows only — pitched lanes are out of scope.
      ...(lane === "drums"
        ? {
            mountFillControl: (row: number, el: HTMLElement) => {
              const piece = DRUM_PIECES[row] as DrumPiece;
              fillDisposers.push(
                render(
                  () => (
                    <EuclidFill
                      piece={piece}
                      steps={steps}
                      label={rowLabels[row] ?? piece}
                      onPreview={(values) =>
                        rendererRef?.previewRow(row, values)
                      }
                    />
                  ),
                  el,
                ),
              );
            },
          }
        : {}),
      // Refinement-1 (critique P1-1): Escape on a covered grid closes the
      // FX console instead of popping to the region head — the console is
      // the innermost open surface (keyboard.md v2 Escape order). Focus
      // stays on the cell; the grid is revealed, not left.
      onEscapeCovered: () => {
        if (fxConsoleLane() !== lane) return false;
        closeFxConsole();
        return true;
      },
      // MB-2 (mobile slice): Escape first closes the fill-rails reveal (the
      // narrow-stage row-local overlay state) — drums only; pitched lanes
      // own no fill rails and pass the keystroke on untouched.
      ...(lane === "drums"
        ? {
            onEscapeFillRails: () => {
              if (!fillRailsOpen()) return false;
              closeFillRails();
              return true;
            },
          }
        : {}),
      onToggle: (row, step) => {
        selectLane(lane); // selection follows the latest grid interaction
        if (lane === "drums") {
          const piece = DRUM_PIECES[row] as DrumPiece;
          const res = toggleDrumStep(piece, step);
          if (res.turnedOn) void session.audition(lane, piece);
          return;
        }
        // IN-2 v2 note law (keyboard.md v2): place / remove / trim, scoped to
        // the DISPLAYED pattern (DES-6) through the SC-2 note actions.
        const degree = degrees[row];
        if (degree === undefined) return;
        const gateSteps = laneGateStepsNow(lane);
        const spans = rowSpansNow(lane, pattern.id, degree);
        const decision = noteEditAt(spans, gateSteps, step);
        if (decision.kind === "place") {
          if (
            addNote(lane, pattern.id, {
              degree,
              start: step,
              length: gateSteps,
            })
          )
            void session.audition(lane, degree); // placement auditions (v0 law)
        } else if (decision.kind === "remove") {
          removeNote(lane, pattern.id, degree, decision.span.start);
        } else if (decision.kind === "trim") {
          resizeNote(
            lane,
            pattern.id,
            degree,
            decision.span.start,
            decision.length,
          );
        }
      },
      // IN-2 pointer gestures — commit on release, through the same store
      // note actions (0.25 snap + clamps live in the store; SC-2).
      onNoteCreate: (row, start, length) => {
        selectLane(lane);
        const degree = degrees[row];
        if (degree === undefined) return;
        const pitchedLane = lane as Exclude<LaneId, "drums">;
        if (addNote(pitchedLane, pattern.id, { degree, start, length }))
          void session.audition(lane, degree); // audition on create (plan law)
      },
      onNoteResize: (row, start, length) => {
        const degree = degrees[row];
        if (degree === undefined) return;
        resizeNote(
          lane as Exclude<LaneId, "drums">,
          pattern.id,
          degree,
          start,
          length,
        );
      },
      onNoteRemove: (row, start) => {
        const degree = degrees[row];
        if (degree === undefined) return;
        removeNote(lane as Exclude<LaneId, "drums">, pattern.id, degree, start);
      },
      onDrumsPaint: (cells) => {
        selectLane(lane);
        let auditioned = false;
        for (const c of cells) {
          const piece = DRUM_PIECES[c.row] as DrumPiece | undefined;
          if (!piece) continue;
          const res = toggleDrumStep(piece, c.step); // cells were off → on
          if (res.turnedOn && !auditioned) {
            // One placement audition per gesture — a hit-per-cell machine
            // gun would fight the one-shot law (I2-4).
            auditioned = true;
            void session.audition(lane, piece);
          }
        }
      },
      // T5: the sounding rim pulse — the beat gate (step % 4) is the ONE
      // toggle per beat per lane law; view-only quadrants pulse too (their
      // renderers run the same loop). The class joins TH-4(b)'s named legal
      // set (frame-budget.test.ts documents the addition).
      onStepPulse: (step) => {
        if (step === null) {
          // Transport parked — no phantom lit rim at idle.
          stopSounding();
          return;
        }
        if (step % 4 !== 0) return; // beat downbeats only
        if (prefersReducedMotion()) {
          // Static twin: lit while playing (add-and-hold, idempotent adds
          // write nothing after the first — cleared by the null edge).
          if (soundingTimer) {
            window.clearTimeout(soundingTimer);
            soundingTimer = 0;
          }
          floorEl?.classList.add("is-sounding");
          return;
        }
        floorEl?.classList.add("is-sounding");
        if (soundingTimer) window.clearTimeout(soundingTimer);
        soundingTimer = window.setTimeout(() => {
          soundingTimer = 0;
          floorEl?.classList.remove("is-sounding");
        }, RIM_PULSE_HOLD_MS);
      },
      // DA-1 lane moves → LY-1 quadrant selection: this grid asks the
      // coordinator; the target quadrant's surface consumes the request.
      onLaneMove: (dir, from) =>
        requestLaneFocus(lane, dir, from.row, from.step),
      // DA-1 audition key: Shift+Enter sounds the focused cell, no toggle.
      onAudition: (row) => {
        if (lane === "drums") {
          void session.audition(lane, DRUM_PIECES[row] as DrumPiece);
        } else if (degrees[row] !== undefined) {
          void session.audition(lane, degrees[row]);
        }
      },
    });

    rendererRef = renderer;
    renderer.sync(syncPatternFor(pattern));

    // Refinement-4 (critique P2-5): register for the viewport-budget fit —
    // the quadrant's vertical row tracks flex within the 100dvh budget
    // (see fitQuadrantRows). The strip is this quadrant's own (queried
    // inside its lane-floor) so edit-tier toggles re-fit its budget.
    // MB-1: the PHONE stage never registers — it scrolls by law, so there
    // is no budget to fit (the guard in fitQuadrantRows is the twin).
    const surface: QuadrantSurface = {
      row: lane === "drums" || lane === "bass" ? 0 : 1,
      rowCount: rowLabels.length,
      minRowPx: geo.minRowPx,
      maxRowPx: geo.cellPx,
      renderer: () => rendererRef,
      scrollEl: container,
      stripEl:
        container
          .closest(".lane-floor")
          ?.querySelector<HTMLElement>(".lane-head-strip") ?? null,
    };
    if (mode !== "phone") {
      registerQuadrantSurface(surface);
      onCleanup(() => unregisterQuadrantSurface(surface));
    }

    // LY-1 quadrant state: flip editable when the selection moves. O(1) in
    // the renderer (tab stop + names); the rAF loop never restarts.
    createEffect(() => {
      rendererRef?.setEditable(activeLane() === lane);
    });

    // MB-2 (mobile slice): the fill-rails reveal — the drums grid's overlay
    // slots show/hide with the strip FILL toggle (grid.css keys off this
    // class; desktop never carries .is-overlay slots, so the class is
    // visually inert there and the desktop law stays byte-identical).
    if (lane === "drums") {
      const scrollHost = container;
      createEffect(() => {
        scrollHost?.classList.toggle("fill-rails-open", fillRailsOpen());
      });
    }

    // DA-1 cross-lane focus: consume requests addressed to THIS quadrant and
    // move DOM focus + roving tabindex to the carried cell (clamped by the
    // renderer to this grid's rows/steps). "roving" requests land on the
    // grid's remembered cursor (the strip ]/[ escape hatch).
    createEffect(() => {
      const req = focusRequest();
      if (!req || req.lane !== lane) return;
      if (req.mode === "roving") rendererRef?.focusRoving();
      else rendererRef?.focusCell(req.row, req.step);
    });

    const unsubscribe = docStore.subscribe((state, prev) => {
      // Re-sync on pattern-content identity only: IN-2 renders notes
      // natively (no gate/BPM-derived view left to invalidate).
      if (state.doc.patterns[lane] === prev.doc.patterns[lane]) return;
      const next = state.doc.patterns[lane].find((p) => p.id === pattern.id);
      if (next) renderer.sync(syncPatternFor(next));
    });

    onCleanup(() => {
      unsubscribe();
      for (const dispose of fillDisposers) dispose();
      stopSounding(); // T5: never strand a lit rim across a remount
      renderer.dispose();
    });
  });

  return (
    <div
      class="lane-grid-scroll"
      data-help={`grid.${props.lane}`}
      ref={(el) => {
        container = el;
      }}
    />
  );
}

export default function LaneGrid(props: { lane: LaneId }) {
  // Store writes (e.g. the selected pattern being removed) re-derive the
  // pattern; the selection signal drives pattern switches.
  const [docVersion, setDocVersion] = createSignal(0);
  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc !== prev.doc) setDocVersion((v) => v + 1);
    });
    onCleanup(unsubscribe);
  });

  const pattern = createMemo(() => {
    void docVersion();
    return currentPattern(props.lane);
  });
  const key = () => {
    const p = pattern();
    // MB-1: the stage mode rides the key — geometry is pinned at mount, so a
    // phone↔tablet↔desktop crossing (rotation, window resize) remounts the
    // grid surface with the right preset (the pattern-shape remount law).
    return p ? `${p.id}:${p.kind}:${p.bars}:${stageMode()}` : "none";
  };

  // LY-1 pointer law: a click on any part of a VIEW-ONLY quadrant selects it
  // (control clicks keep their own action + focus; the announcement carries
  // the change). The selected quadrant's own clicks are left alone.
  const onQuadrantClick = () => {
    if (activeLane() !== props.lane) selectQuadrantFromPointer(props.lane);
  };

  return (
    <section
      class="lane-floor"
      data-lane={props.lane}
      data-editing={activeLane() === props.lane}
      aria-label={LANE_NAMES[props.lane]}
      onClick={onQuadrantClick}
    >
      <LaneHeader lane={props.lane} />
      <Show when={key()} keyed>
        {(keyed: string) =>
          (() => {
            void keyed;
            const p = pattern();
            return p ? (
              <GridSurface lane={props.lane} pattern={p} />
            ) : (
              <div class="lane-grid-scroll" />
            );
          })()
        }
      </Show>
    </section>
  );
}
