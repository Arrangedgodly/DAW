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
import { laneCycleSteps } from "../audio/song";
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
  defaultRegisterWindowStart,
  getOrCreateRegisterWindow,
  type PitchedLaneId,
  registerWindowStarts,
  selectLane,
  setRegisterWindowStart,
  stageMode,
} from "../state/selection";
import {
  carryGridFocusOnUnmount,
  focusRequest,
  requestLaneFocus,
  selectQuadrantFromPointer,
  takeCarriedGridFocus,
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
          : `Where ${LANE_NAMES[lane]}'s notes live. Click once for a note of the lane's GATE length; drag right to draw a longer one, then drag its right edge (or press + / −) to resize. Rows follow the lane's scale, so everything you place sits in key. The grid shows ONE OCTAVE of rows at a time: Shift+arrows scroll that window — the rows you SEE, view only, nothing moves — while plain arrows walk the whole manifest and the window follows. To change the octave ${LANE_NAMES[lane]} SOUNDS, use OCT in the strip.`,
    },
  ]);
}

/**
 * HP-2 help content — the M-5 phone register-window shift row (one entry per
 * pitched lane, colocated with the buttons that stamp the id; I2-6 law).
 */
for (const lane of ["bass", "chords", "lead"] as const) {
  registerHelp([
    {
      id: `lane.${lane}.regshift`,
      title: `${LANE_NAMES[lane]} REGISTER SHIFT`,
      text: `Moves the one-octave slice of the ${LANE_NAMES[lane]} grid you are viewing. OCT −/+ jumps the window one octave (12 rows); SEMI −/+ nudges it one row. The buttons disable at the top and bottom of the lane's row range. The readout beside the buttons shows the rows in view (ROWS start–end OF total) and flashes with a ▲/▼ arrow when the window moves. This is view only — your notes never move; to change the octave ${LANE_NAMES[lane]} SOUNDS, use OCT in the strip.`,
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
 * AND tablet (768–1024 quadrant stage) share one horizontal preset so
 * rotation between them re-fits without a geometry rethink:
 *   - cell 15 + gap 1 — i5 AMENDMENT (H-2/H-3, docs/dev/mobile-i5-audit.md
 *     §2): at PHONE the cell is no longer the pinned 15 — it is the
 *     WIDTH-FILL LAW's exact fraction of the measured well (fitPhoneGeometry
 *     below: cellPx = (well − labelBox − (n−1)·gap) / n, clamp [15, 24]),
 *     so a 1-bar row fills the well EXACTLY (0 px dead right) instead of
 *     the old 11–93 px dead band. The 15 here survives as the preset's
 *     committed FLOOR — the readability minimum below which the grid
 *     honestly h-scrolls (exactly the 2-bar treatment) — and as the TABLET
 *     pin, which stays byte-identical (m5): the fork is by stage mode at
 *     the mount + the phone-scoped fit observer, NEVER a preset retune;
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
 * PHONE_ROW_PX sizes the phone editing rows. M-7 (iteration 4) raises the
 * v0 24 px rows to 44 px: the single lane owns the whole viewport height
 * and the page scrolls (the committed scrolling law), so rows can be
 * finger-sized instead of quadrant-compressed — and the grid's share of
 * the viewport grows with them (the M-7 max-space law). 44 px = the
 * target-size law's own number: every cell's VERTICAL hit is the full row
 * (the renderer's hit test is row-exact), so a 44 px row is a 44 px-tall
 * cell target; H-3 (i5 §3) grows that track into the measured
 * bottom-ownership leftover up to PHONE_ROW_MAX_PX (64) — the track is the
 * clamp [44, 64], not the exact 44 pin. Cell WIDTH is the i5 fill law
 * above (15.69–20.81 px on the shipped viewports; the grid surface stays
 * the committed pan-y gesture surface, not a chrome control). Still ≥
 * every lane's minRowPx floor by a wide margin.
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
const PHONE_ROW_PX = 44;
/**
 * H-3 (i5 audit §3): the phone row-growth CEILING — the bottom-ownership
 * twin of the width clamp. Rows grow only into MEASURED leftover (never
 * below PHONE_ROW_PX, the M-7 law), capped at the top of the plan's 56-64
 * band: uncapped growth reads 61-83 px on the shipped viewports (83 px rows
 * against 20 px cells is beyond finger-comfort proportionality), and 64
 * keeps a 6-row drums pane ≤ 384 px. What the cap leaves stays as residual
 * recess INSIDE the stretched card (28 px at 390 drums — the audit's
 * recorded outcome), never as dead ground below the card.
 */
const PHONE_ROW_MAX_PX = 64;

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
 *     BYTE-IDENTICAL on the VERTICAL axis: 1440×900 and 1920×1080 keep their
 *     290 px quadrant rows and 16/20 px tracks). FV-1 (I3-b, 2026-09-04)
 *     RETIRES the full-page "1920 = 1440" byte-identity this line used to
 *     encode: the 1400px stage cap is gone, so at 1920 the quadrants are
 *     WIDER and their grids show more steps before the internal h-scroll —
 *     the retired law's deliberate densification choice, reversed by the
 *     user's approved direction. The vertical fit law itself is unchanged;
 *   - tracks compress toward minRowPx only by the measured deficit (no
 *     content loss: every row stays fully rendered, cells within
 *     readability);
 *   - horizontal laws untouched (long/1-bar patterns scroll INSIDE the
 *     quadrant exactly as before — entry-2's recorded 1280 trade stands);
 *   - rotation-safe: ResizeObservers on the stage/rail/every strip (booth
 *     wrap, rail growth, edit-row toggles — everything that changes the
 *     budget) re-run the fit, and the rAF-rendered playhead is untouched
 *     (the v0 resize law holds by construction).
 * MB-1 (the mobile slice) extends this seam: its tablet scale re-uses the
 * parameterized geometry + this fit; its phone stage replaces the 2×2 but
 * keeps the same 100dvh shell.
 *
 * Refinement i3-1 (iteration-3 critique P1, the VERTICAL FILL LAW — the
 * grow-to-fill twin refinement-4 lacked): the windowed grids shrank content
 * height (a 15-row lead manifest renders as a 7-row window) while the
 * quadrant rows stayed content-sized, so the default demo state left 283 px
 * (31.4%) dead at 1440×900, 161 px at 1280×800 and 507 px (47%) at 1920×1080
 * BELOW the floors — grow-on-miss without fill leaves the vacancy. The fit
 * now distributes the height budget across the two quadrant rows (an equal
 * rowH share per stage row): every lane fills its share by its own law —
 *   - REGISTER-WINDOW HEIGHT FIRST: a windowed lane's window grows in whole
 *     rows (quantized to the row pitch, so the pane edge never bisects a
 *     row by more than the recorded pane-padding delta — entry 2's own
 *     gate) in LOCKSTEP across windowed lanes (the RC-1 equal-window
 *     default, grown; a lane whose manifest caps it keeps the committed
 *     full-manifest law), never below the one-octave default;
 *   - THEN ROW SCALE within the committed clamp [cellPx, FILL_MAX_ROW_PX]:
 *     24 px is the world's own committed editing-row scale (the v0 floor
 *     and the phone stage's row law; pads stay pinned in WIDTH — width
 *     growth buys columns, never bigger cells);
 *   - per-lane readability floors and the grow-on-miss law are UNCHANGED:
 *     under a real deficit the window first returns to the one-octave
 *     default (the reverse order), then tracks compress toward minRowPx
 *     exactly as refinement-4 committed; past the floors the page grows.
 * Every target is computed from the CANONICAL state (cellPx tracks + the
 * default window), never from the current grown one — resize round-trips
 * converge with no hysteresis, and measurement stays write-free (the
 * TH-4(b) law): content heights are linear extrapolations of the live
 * offsetHeight (which includes pane-padding deltas and h-scrollbar
 * thickening), so a fit NEVER reads back its own writes.
 * ------------------------------------------------------------------------- */

/**
 * Refinement i3-1: the row-scale GROW ceiling — the committed clamp. 24 px is
 * the editing-row scale the world already ships (the v0 floor and the phone
 * stage's PHONE_ROW_PX); quadrant pads grow no taller than that law.
 */
const FILL_MAX_ROW_PX = 24;

/** One live grid surface registered for the budget fit (GridSurface scope). */
interface QuadrantSurface {
  /** Stage row (0 = drums|bass, 1 = chords|lead) — the 2×2 pairing. */
  readonly row: 0 | 1;
  /**
   * The one-octave DEFAULT window (the scale mode's row count) — null when
   * the lane never windows (drums, or a manifest that fits one octave). The
   * fill grows and shrinks the LIVE window around this default.
   */
  readonly defaultWindowRows: number | null;
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

/* ---------------------------------------------------------------------------
 * H-2 (mobile slice): the phone WIDTH-FIT law — the horizontal twin of the
 * quadrant budget fit above (i5 audit §2). Phone only; tablet/desktop never
 * register, so their geometry is byte-identical. THE LAW, from the measured
 * DOM (never restated constants — the refinement-2 drift lesson):
 *
 *   labelBox = the row label's own border-box width (pin + gutter, measured)
 *   cellPx   = (well.clientWidth − labelBox − (n−1)·gapPx) / n   // exact
 *                                                              // fraction
 *   cellPx   = clamp(cellPx, NARROW preset's 15 floor, 24 cap)
 *
 * The exact unrounded fraction is handed to the renderer seam (CSS Layout
 * quantizes tracks to 1/64 px → row-sum error ≤ n/128 px ≤ 0.25 at n=32,
 * inside every committed ±1 px gate), so a 1-bar row fills the well EXACTLY
 * (100%, 0 dead right edge — m1's no-h-scroll property holds by
 * construction, not ≤). ONE law, no special case: a pattern whose raw fit
 * falls below the 15 floor (2-bar chords: raw ≈ 8-10) keeps the floor pitch
 * and h-scrolls inside the well — today's committed behavior. The cap is
 * FILL_MAX_ROW_PX's own number: at the shipped viewports it never bites
 * (max raw ≈ 20.8); it bounds cells on 500-767 px phones still in phone
 * stage, where uncapped cells would read 25-41 px against 44 px rows.
 * H-3: DRUMS JOINS (labelBox 68 → cells 17.5625/15.6875/20.0625 at
 * 390/360/430; the 1-bar/16-visible raw fit never drops below the 15 floor
 * on those widths — floor-15 + internal scroll stays the 2-bar treatment
 * only). The remount key carries stage mode + pattern shape but NOT
 * container width — a within-phone width change (fold, devtools resize)
 * re-fits LIVE through the seam, never remounts.
 *
 * H-3 (i5 audit §3): the BOTTOM-OWNERSHIP twin, same pass. The phone shell
 * keeps flowing (height:auto; min-height:100dvh — the page-scroll law is
 * untouched) while the CSS chain stage → floors → lane-floor → well GROWS
 * into the shell remainder (app.css owns the flip; grow-only flex, so when
 * chrome + content EXCEED the viewport there is no free space anywhere and
 * every box stays content-sized — the page scrolls exactly as before). The
 * rows then grow into the MEASURED leftover the stretch created:
 *
 *   leftover  = well.clientHeight − natural pane content height (write-free)
 *   rowTrack  = clamp(44, 44 + floor(leftover / manifestRows), 64)
 *
 * The divisor is the MANIFEST rows (uniform growth across the whole
 * register — a windowed pane's painted window grows with the same track px
 * through setRowHeight's own re-pin; the audit's 430-lead arithmetic
 * 144/15 → 53). Growth ≤ leftover by construction, so no probed state
 * newly scrolls; the cap's remainder stays as recess INSIDE the stretched
 * well (the audit's recorded residuals), and the card bottom owns the
 * viewport bottom at scroll end.
 * ------------------------------------------------------------------------- */
const PHONE_CELL_MAX_PX = FILL_MAX_ROW_PX; // one readability ceiling

/** One live phone grid surface registered for the width + row fit. */
interface PhoneWidthSurface {
  readonly steps: number;
  readonly gapPx: number;
  /** The clamp floor = the NARROW preset's committed cellPx (readability). */
  readonly floorPx: number;
  /** The row-growth floor = PHONE_ROW_PX (the M-7 finger-size law). */
  readonly rowFloorPx: number;
  readonly renderer: () => DomGridRenderer | null;
  readonly well: () => HTMLElement | undefined;
}

const phoneWidthSurfaces = new Set<PhoneWidthSurface>();
let phoneWidthObserver: ResizeObserver | null = null;
let phoneWidthRaf = 0;

/**
 * H-3 (MB-5 census law): the phone fit defers while ANY pointer is held,
 * document-wide. The TH-4 (b) commit-on-release law forbids every
 * non-preview layout write inside an observed gesture window — including
 * windows the GRID does not own (the phone rail sweep holds its pointer
 * on the rail) and the chrome/save pulses that resize the well around
 * them (an in-flow sticky chrome means a save pulse or a page scrollbar
 * flipping on retargets the fit). Held-pointer counting at the document
 * level covers every owner; the release schedules the trailing rAF that
 * lands the deferred fit. Blur resets (a pointer lost to the OS never
 * delivered its up).
 */
let phoneHeldPointers = 0;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      phoneHeldPointers++;
    },
    true,
  );
  const release = (): void => {
    phoneHeldPointers = Math.max(0, phoneHeldPointers - 1);
    schedulePhoneWidthFit();
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  document.defaultView?.addEventListener("blur", () => {
    phoneHeldPointers = 0;
  });
}

function fitPhoneGeometry(): void {
  if (stageMode() !== "phone") return; // live re-fit is phone law only
  if (phoneHeldPointers > 0) {
    schedulePhoneWidthFit(); // trailing: one rAF past the release
    return;
  }
  for (const surface of phoneWidthSurfaces) {
    const well = surface.well();
    const renderer = surface.renderer();
    if (!well || !renderer || !well.isConnected || well.clientWidth === 0)
      continue; // no layout yet (jsdom / pre-first-frame) — preset stands
    const label = well.querySelector<HTMLElement>(".row-label");
    if (!label) continue;
    const labelBox = label.getBoundingClientRect().width;
    if (labelBox <= 0) continue;
    const raw =
      (well.clientWidth - labelBox - (surface.steps - 1) * surface.gapPx) /
      surface.steps;
    renderer.setCellWidth(
      Math.min(PHONE_CELL_MAX_PX, Math.max(surface.floorPx, raw)),
    );
    fitPhoneRows(surface, well, renderer);
  }
}

/**
 * H-3: the bottom-ownership row fit (i5 audit §3) — grows phone row tracks
 * into the MEASURED leftover the CSS stretch created, through the same
 * setRowHeight seam the quadrant budget fit uses. Natural pane height is
 * measured WRITE-FREE: a windowed pane's box is the renderer's inline pin
 * (the flex basis the stretch grows from); a full-manifest pane sizes to
 * its last row + the collapsed tail margin + the well's own bottom padding
 * (the in-well chrome growth never eats). The measure is then NORMALIZED
 * to the 44-basis — the leftover a fresh PHONE_ROW_PX grid would see — so
 * the target is idempotent across re-fits (a re-measure against
 * already-grown rows would otherwise collapse the target back toward the
 * floor and oscillate) and shrinks back honestly when the stretch
 * disappears (rotation, drawer): no free space reads leftover ≤ 0 and the
 * M-7 44 px law stands. The write never re-triggers the fit: growth ≤
 * leftover keeps the content inside the CSS-fixed well box, so the well's
 * own size (what the observer watches) does not move.
 */
function fitPhoneRows(
  surface: PhoneWidthSurface,
  well: HTMLElement,
  renderer: DomGridRenderer,
): void {
  const geo = renderer.fitGeometry();
  if (geo.manifestRows <= 0) return;
  const style = getComputedStyle(well);
  // The rows that actually paint pane height: the window for a windowed
  // grid, the manifest otherwise (the scrolled-out rows cost nothing).
  const paintedRows = geo.windowRows ?? geo.manifestRows;
  let natural: number;
  if (geo.windowRows != null) {
    // The renderer's inline pin is content-box (applyWindowHeight's law);
    // the stretch grew the box BEYOND it (padTop+padBottom both count).
    natural =
      (Number.parseFloat(well.style.height) || 0) +
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom);
  } else {
    const rows = well.querySelectorAll<HTMLElement>(".grid-row");
    const last = rows[rows.length - 1];
    if (!last) return;
    const lastRect = last.getBoundingClientRect();
    const marginBelow =
      Number.parseFloat(getComputedStyle(last).marginBottom) || 0;
    // The rect delta already spans the well's top edge → top padding; the
    // tail margin collapses out of the grid, so it re-adds explicitly.
    natural =
      lastRect.bottom -
      well.getBoundingClientRect().top +
      marginBelow +
      (Number.parseFloat(style.paddingBottom) || 0);
  }
  // Normalize: what the pane would measure if its rows sat at the floor.
  const natural44 =
    natural - (geo.trackPx - surface.rowFloorPx) * paintedRows;
  const leftover = well.clientHeight - natural44;
  const target = Math.max(
    surface.rowFloorPx,
    Math.min(
      PHONE_ROW_MAX_PX,
      surface.rowFloorPx + Math.floor(leftover / geo.manifestRows),
    ),
  );
  if (target !== geo.trackPx) renderer.setRowHeight(target);
}

/** rAF-coalesced (the scheduleFit twin — resize-time only). */
function schedulePhoneWidthFit(): void {
  if (phoneWidthRaf) return;
  phoneWidthRaf = requestAnimationFrame(() => {
    phoneWidthRaf = 0;
    fitPhoneGeometry();
  });
}

function registerPhoneWidthSurface(surface: PhoneWidthSurface): void {
  phoneWidthSurfaces.add(surface);
  const well = surface.well();
  if (well) ensurePhoneWidthObserver()?.observe(well);
  // The mount compute: onMount may run before first layout — the rAF lands
  // it one frame later (the renderer's own mountPending precedent).
  schedulePhoneWidthFit();
  // H-3: the boot measure can read PROVISIONAL font metrics (labels in the
  // fallback face wrap the rows taller before the Silkscreen webface
  // lands) — one re-fit when the document's fonts settle (rAF-coalesced;
  // jsdom has no document.fonts, the guard stands down).
  if (typeof document !== "undefined" && document.fonts?.ready) {
    void document.fonts.ready.then(() => schedulePhoneWidthFit());
  }
}

function unregisterPhoneWidthSurface(surface: PhoneWidthSurface): void {
  const well = surface.well();
  if (well) phoneWidthObserver?.unobserve(well);
  phoneWidthSurfaces.delete(surface);
}

/** Lazily, once (the ensureFitObservers precedent; jsdom stands down). */
function ensurePhoneWidthObserver(): ResizeObserver | null {
  if (
    phoneWidthObserver ||
    typeof window === "undefined" ||
    typeof window.ResizeObserver === "undefined"
  ) {
    return phoneWidthObserver;
  }
  phoneWidthObserver = new ResizeObserver(() => schedulePhoneWidthFit());
  return phoneWidthObserver;
}

/**
 * The fit itself — measured, never restated as constants (the refinement-2
 * drift lesson). THREE phases, per the refinement-4 compression law + the
 * i3-1 fill twin:
 *
 * Measure (write-free): every quadrant's chrome (strip above, card padding
 * below) + its CURRENT content height + live geometry through the
 * renderer's read seam (track px, window rows, manifest, pitch). Content
 * height at ANY (track, window) target is a linear extrapolation of the
 * live offsetHeight — the honest flow height, pane-padding deltas and
 * in-quadrant h-scrollbar thickening included — so the fit never reads back
 * its own writes (a layout write mid-gesture is the TH-4(b) law).
 *
 * Budget: rowsBudget = stage − rail − floors chrome; each of the two stage
 * rows owns an equal rowH share. Per quadrant, available = rowH − above −
 * below is what that lane's bed may fill. Targets are computed from the
 * CANONICAL state (maxRowPx tracks + the one-octave default window), so
 * grow/shrink round-trips converge with no hysteresis:
 *
 * Surplus (canonical fits the share) — GROW, i3-1's law: register-window
 * heights first (whole rows, LOCKSTEP across windowed lanes — the
 * equal-window default grown, capped by each manifest), then row scale
 * within [maxRowPx, FILL_MAX_ROW_PX].
 *
 * Deficit — refinement-4's law, in reverse order: the window returns to the
 * one-octave default (never below — the equal-window default is the floor),
 * then tracks compress by whole px toward the lane's readability floor;
 * past the floors the page honestly grows (the grow-on-miss law).
 *
 * Guards: no shell (bare component tests) or no layout (jsdom) → stand
 * down; provisional font metrics neither compress NOR grow (the swap would
 * undo either — tracks restore to the committed scale only).
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
  // Restores stay allowed (no-op at the committed scale); GROWTH waits for
  // the same final metrics (a grown window on provisional pitches would be
  // re-fit by the swap the same way).
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

  // Measure every quadrant's canonical + live geometry (no DOM writes).
  const measured: Array<{
    surface: QuadrantSurface;
    renderer: DomGridRenderer;
    /** Visible-row count at the CANONICAL state (the default window). */
    canonicalRows: number;
    manifest: number;
    /** Bed content height at (track, visibleRows) — write-free extrapolation. */
    contentAt: (track: number, rows: number) => number;
    available: number;
    /** Whole rows of window-growth headroom at maxRowPx (canonical base). */
    windowHeadroom: number;
  }> = [];
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
    const g = renderer.fitGeometry();
    // Live visible rows: the window when windowed, the manifest otherwise.
    const liveRows = g.windowRows ?? g.manifestRows;
    // The RC-1 default (one octave) is the canonical window; a lane whose
    // manifest fits never windows.
    const canonicalRows = Math.min(
      surface.defaultWindowRows ?? g.manifestRows,
      g.manifestRows,
    );
    // Linear extrapolation from the CURRENT pinned state (offsetHeight is
    // the honest flow height; pitch = track + gap + margin from the DOM).
    const contentAt = (track: number, rows: number): number =>
      scroll.offsetHeight +
      (rows - liveRows) * g.pitchPx +
      rows * (track - g.trackPx);
    const available = rowH - above - below;
    const canonicalContent = contentAt(surface.maxRowPx, canonicalRows);
    const windowHeadroom =
      surface.defaultWindowRows != null && g.manifestRows > canonicalRows
        ? Math.floor((available - canonicalContent) / g.pitchPx)
        : 0;
    measured.push({
      surface,
      renderer,
      canonicalRows,
      manifest: g.manifestRows,
      contentAt,
      available,
      windowHeadroom,
    });
  }

  // i3-1 lockstep: windowed surplus lanes grow their windows EQUALLY — the
  // RC-1 equal-window default, grown — capped by each lane's manifest.
  let lockstep = Infinity;
  for (const m of measured) {
    if (m.windowHeadroom <= 0) continue; // deficit/full lanes keep the default
    lockstep = Math.min(lockstep, m.windowHeadroom);
  }

  // Fit: restore under provisional metrics, else grow (surplus) / repay the
  // deficit (refinement-4's law, windows-first in reverse).
  for (const m of measured) {
    const { surface, renderer } = m;
    if (!fontsFinal) {
      // Restore-only: the committed track scale, windows untouched (the
      // mount's default; compression AND growth wait for final metrics).
      renderer.setRowHeight(surface.maxRowPx);
      continue;
    }
    const canonicalContent = m.contentAt(surface.maxRowPx, m.canonicalRows);
    if (canonicalContent <= m.available) {
      // Surplus — i3-1: windows first (whole rows, lockstep), then row
      // scale within the committed clamp.
      const rows =
        m.windowHeadroom > 0
          ? Math.min(m.canonicalRows + lockstep, m.manifest)
          : m.canonicalRows;
      const base = m.contentAt(surface.maxRowPx, rows);
      const track = Math.min(
        FILL_MAX_ROW_PX,
        surface.maxRowPx + Math.floor((m.available - base) / Math.max(1, rows)),
      );
      applyFit(renderer, surface, rows, track);
      continue;
    }
    // Deficit — reverse order: the window returns to the one-octave default
    // (never below), then tracks repay the remainder in whole px toward the
    // lane's readability floor (refinement-4's committed law).
    const deficit = canonicalContent - m.available;
    const track = Math.max(
      surface.minRowPx,
      surface.maxRowPx - Math.ceil(deficit / Math.max(1, m.canonicalRows)),
    );
    applyFit(renderer, surface, m.canonicalRows, track);
  }
}

/** Apply one lane's fit target (idempotent writes through the seams). */
function applyFit(
  renderer: DomGridRenderer,
  surface: QuadrantSurface,
  rows: number,
  track: number,
): void {
  const g = renderer.fitGeometry();
  const liveRows = g.windowRows ?? g.manifestRows;
  if (rows !== liveRows) {
    // The scroll STEP stays the lane's one-octave default (Shift+↑/↓ keep
    // their ONE OCTAVE meaning at any grown height — the i3-1 fence).
    renderer.setWindow(rows, g.windowStart, surface.defaultWindowRows ?? rows);
  }
  renderer.setRowHeight(track);
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

    // RC-1 (v3, I3-c): the REGISTER WINDOW. Every stage shows pitched lane
    // grids through the SAME one-octave window — view state on the
    // selection.ts two-tier law, never a document field, never undo
    // history. M-5 (iteration 4) FLIPPED the old phone full-manifest law:
    // the phone stage now windows at the same one-octave default, with the
    // shift row (RegisterShiftControls) moving it ±12/±1 through the same
    // setRegisterWindowStart seam as desktop Shift+arrow. Phone windows
    // never GROW: the fill compressor early-returns at phone (m1's
    // scrolling stage — no one-page budget), so the pinned default is the
    // height. Short manifests (h ≥ rows) keep the full manifest (window
    // null) — the chords/drums precedent.
    const windowed = pitched;
    const windowHeight = (): number =>
      windowed
        ? modeSize(effectiveScale(docStore.getState().doc, lane).mode)
        : 0;
    const applyRegisterWindow = (): number => {
      const h = windowHeight();
      if (!windowed || h >= rowLabels.length) {
        rendererRef?.setWindow(null);
        return rowLabels.length; // visible rows = the manifest
      }
      const start = getOrCreateRegisterWindow(
        lane as Exclude<LaneId, "drums">,
        h,
      );
      // i3-1: the window-scroll STEP is this one-octave default even when
      // the fill later grows the height (Shift+↑/↓ stay ONE OCTAVE).
      rendererRef?.setWindow(h, start, h);
      return h;
    };

    // LL-2 (seam G4 — the per-lane playhead basis): the sweep basis is the
    // LANE's OWN chain-cycle total. Primary source = the engine's LIVE
    // schedule (post-substitution, iteration-mode rebuilds included — the
    // honest sounding cycle); document fallback (song.ts laneCycleSteps)
    // covers the boot window before the bridge has pushed schedules. The
    // doc fallback is cached per patterns/songChain identity — readFrame
    // runs at 60 Hz and never scans the document.
    let docChainSteps = laneCycleSteps(docStore.getState().doc, lane);

    const readFrame = (): PlayheadFrame | null => {
      const snap = session.transport.snapshot;
      if (!snap.playing) return null;
      return {
        playing: true,
        loopTime: session.transport.getLoopTime(),
        options: {
          steps: session.getLaneCycleSteps(lane) ?? docChainSteps,
          bpm: snap.bpm,
          swing: snap.swing,
        },
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
      // RC-1: the grid moved its register window (keys / wheel / focus
      // follow) — persist the start as the lane's view state (never a
      // document write; equal-guarded in the setter so the echo no-ops).
      onWindowScroll: (start) => {
        if (lane !== "drums") setRegisterWindowStart(lane, start);
      },
    });

    rendererRef = renderer;
    renderer.sync(syncPatternFor(pattern));
    // LL-1 (the resize-remount carry law): when the previous surface held
    // DOM focus (its cleanup recorded the cursor), the fresh mount lands
    // focus on the CARRIED cell — same row, step clamped to the new extent
    // (focusCell clamps; the v0 carry-clamp law). Nothing consumed = focus
    // was elsewhere (the no-yank law — `b` pressed from the rail).
    const carried = takeCarriedGridFocus(lane);
    if (carried) renderer.focusCell(carried.row, carried.step);
    // RC-1: the equal default register window (mount-time; the effect below
    // tracks later view-state moves).
    applyRegisterWindow();

    // RC-1 (refinement-4 + i3-1): register for the viewport-budget fit — the
    // quadrant's vertical row tracks and register window flex within the
    // 100dvh budget (see fitQuadrantRows). The strip is this quadrant's own
    // (queried inside its lane-floor) so edit-tier toggles re-fit its budget.
    // The budget owns the VISIBLE WINDOW (a windowed grid's natural height is
    // its window — the scrolled-out manifest rows cost nothing), and the fit
    // reads the LIVE window through the renderer's geometry seam, so growth
    // never needs a re-registration. MB-1: the PHONE stage never registers —
    // it scrolls by law, so there is no budget to fit (the guard in
    // fitQuadrantRows is the twin).
    const surface: QuadrantSurface = {
      row: lane === "drums" || lane === "bass" ? 0 : 1,
      defaultWindowRows: windowed ? windowHeight() : null,
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

    // H-2 + H-3: the phone width-fit law (every lane — drums joined in H-3)
    // and the bottom-ownership row fit ride ONE registration and ONE
    // observer pass. Fills a 1-bar row to the well EXACTLY at the clamped
    // fraction; a below-floor pattern (2-bar) keeps the floor pitch and
    // h-scrolls (see fitPhoneGeometry for both laws). Registered separately
    // from the quadrant surface: the phone stage never registers for the
    // vertical budget fit, and this observer must survive the width-only
    // resizes the remount key does NOT cover (the live re-fit seam).
    if (mode === "phone") {
      const widthSurface: PhoneWidthSurface = {
        steps,
        gapPx: geo.gapPx,
        floorPx: geo.cellPx,
        rowFloorPx: PHONE_ROW_PX,
        renderer: () => rendererRef,
        well: () => container,
      };
      registerPhoneWidthSurface(widthSurface);
      onCleanup(() => unregisterPhoneWidthSurface(widthSurface));
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

    // RC-1: the lane's window start is lane-level view state — pattern
    // switches (remounts) and cross-surface moves land here. The renderer's
    // ≥1-row snap guard keeps the echo of its own wheel-derived writes inert.
    // A cleared entry (document replacement — selection resets the map)
    // re-derives the default for THIS grid instead of leaving the renderer
    // parked at the replaced document's window.
    if (lane !== "drums") {
      createEffect(() => {
        const start = registerWindowStarts()[lane];
        if (start === undefined) {
          if (windowed) getOrCreateRegisterWindow(lane, windowHeight());
          return;
        }
        rendererRef?.scrollWindowTo(start);
      });
    }

    let lastWindowHeight = windowHeight();
    const unsubscribe = docStore.subscribe((state, prev) => {
      // RC-1: a scale/mode change re-derives the window height (one octave =
      // the mode size) — the only document-side input of the window law.
      // i3-1: the reset shrinks a GROWN window back to the new default, so
      // the fill re-runs to redistribute the freed budget.
      const h = windowHeight();
      if (h !== lastWindowHeight) {
        lastWindowHeight = h;
        applyRegisterWindow();
        scheduleFit();
        return;
      }
      // LL-2: chain-total edits (a resize of a chained pattern, a rail +/RM
      // chain mutation) refresh the sweep-basis fallback for readFrame (the
      // engine's live schedule takes precedence once pushed).
      if (
        state.doc.patterns[lane] !== prev.doc.patterns[lane] ||
        state.doc.songChain[lane] !== prev.doc.songChain[lane]
      ) {
        docChainSteps = laneCycleSteps(state.doc, lane);
      }
      // Re-sync on pattern-content identity only: IN-2 renders notes
      // natively (no gate/BPM-derived view left to invalidate).
      if (state.doc.patterns[lane] === prev.doc.patterns[lane]) return;
      const next = state.doc.patterns[lane].find((p) => p.id === pattern.id);
      if (next) renderer.sync(syncPatternFor(next));
    });

    onCleanup(() => {
      // LL-1: record the resize-remount carry FIRST — while the dying
      // container still contains DOM focus (the renderer is disposed below).
      if (container)
        carryGridFocusOnUnmount(lane, container, rendererRef?.cursor() ?? null);
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

/**
 * M-5 (iteration 4): the phone REGISTER-WINDOW SHIFT ROW — one row of four
 * ≥44 px touch buttons (OCT − / SEMI − / SEMI + / OCT +) rendered between
 * the lane header and the grid on the phone stage. The window is VIEW-ONLY
 * (the RC-1 law): a shift writes ONLY `setRegisterWindowStart(lane,
 * clamp(start ± 12 / ± 1))` — the SAME selection.ts seam desktop
 * Shift+arrow uses, so the GridSurface effect (the registerWindowStarts
 * consumer) pushes it to the renderer; no note ever moves. Bounds are
 * computed eagerly from the lane's patterns (`rowDegrees` heights, the
 * defaultRegisterWindowStart input) so the buttons DISABLE at the manifest
 * edges before any click.
 *
 * M-6 (iteration 4): the CHANGE FEEDBACK rides this same start() state — no
 * second source of truth. Two layers: (1) the persistent window READOUT chip
 * (`ROWS start–end OF total`, an aria-live polite region — the label
 * re-anchor announced to SR) and (2) a TRANSIENT cue (data-cue up/down +
 * parity on the row root) that flashes the chip and the grid's visible row
 * labels — fill (hue-tinted background) + border (inset 2px hue ring) + shape
 * (a ▲/▼ direction glyph in the chip), never color-only (D9). Under
 * prefers-reduced-motion the transient cue is SKIPPED entirely in JS and the
 * CSS twin kills the animation: the static equivalent is the readout text +
 * arrow-free re-anchor, immediate with no animation (the RES-9 law).
 */
function RegisterShiftControls(props: { lane: PitchedLaneId }) {
  // The document store is zustand/vanilla (the LaneHeader law): mirror doc
  // identity into a signal so bounds re-derive on scale/pattern edits —
  // never inside the render loop.
  const [docVersion, setDocVersion] = createSignal(0);
  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc !== prev.doc) setDocVersion((v) => v + 1);
    });
    onCleanup(unsubscribe);
  });

  const bounds = createMemo(() => {
    void docVersion();
    const doc = docStore.getState().doc;
    const h = modeSize(effectiveScale(doc, props.lane).mode);
    let rows = 0;
    for (const p of doc.patterns[props.lane]) {
      if (p.kind === "pitched") rows = Math.max(rows, p.rowDegrees.length);
    }
    return { h, maxStart: Math.max(0, rows - h) };
  });

  const start = createMemo(() => {
    void docVersion();
    const { h, maxStart } = bounds();
    const stored = registerWindowStarts()[props.lane];
    const s = stored ?? defaultRegisterWindowStart(props.lane, h);
    return Math.min(maxStart, Math.max(0, s));
  });

  const shift = (delta: number) => {
    const maxStart = bounds().maxStart;
    const target = Math.min(maxStart, Math.max(0, start() + delta));
    setRegisterWindowStart(props.lane, target);
  };

  // M-6: the readout text (the re-anchor, announced via aria-live on the
  // chip itself — one element is both the visual readout and the SR region).
  const readout = (): string => {
    const { h, maxStart } = bounds();
    const s = start();
    return `ROWS ${s + 1}–${s + h} OF ${maxStart + h}`;
  };

  // M-6: the transient cue. Rides start() — any window move (buttons, a
  // later echo path) flashes, not just these clicks. Parity key: alternating
  // data-cue-parity values de-/re-match the CSS animation selectors so a
  // rapid second shift RESTARTS the flash. Reduced motion: never set.
  const [cue, setCue] = createSignal<{ dir: 1 | -1; key: number } | null>(null);
  const reducedMotion = (): boolean =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastStart: number | undefined;
  let cueTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const s = start();
    if (lastStart === undefined) {
      lastStart = s;
      return;
    }
    if (s === lastStart) return;
    const dir: 1 | -1 = s > lastStart ? 1 : -1;
    lastStart = s;
    if (reducedMotion()) {
      setCue(null);
      return;
    }
    setCue({ dir, key: (cue()?.key ?? 0) + 1 });
    if (cueTimer !== undefined) clearTimeout(cueTimer);
    cueTimer = setTimeout(() => setCue(null), 1200);
  });
  onCleanup(() => {
    if (cueTimer !== undefined) clearTimeout(cueTimer);
  });

  return (
    <Show when={bounds().maxStart > 0}>
      <div
        class="register-shift"
        role="group"
        aria-label={`${LANE_NAMES[props.lane]} register window shift`}
        data-cue={cue() ? (cue()!.dir === 1 ? "up" : "down") : undefined}
        data-cue-parity={cue() ? String(cue()!.key % 2) : undefined}
      >
        <button
          type="button"
          class="register-shift-btn"
          data-help={`lane.${props.lane}.regshift`}
          disabled={start() <= 0}
          onClick={() => shift(-12)}
        >
          OCT −
        </button>
        <button
          type="button"
          class="register-shift-btn"
          data-help={`lane.${props.lane}.regshift`}
          disabled={start() <= 0}
          onClick={() => shift(-1)}
        >
          SEMI −
        </button>
        <button
          type="button"
          class="register-shift-btn"
          data-help={`lane.${props.lane}.regshift`}
          disabled={start() >= bounds().maxStart}
          onClick={() => shift(1)}
        >
          SEMI +
        </button>
        <button
          type="button"
          class="register-shift-btn"
          data-help={`lane.${props.lane}.regshift`}
          disabled={start() >= bounds().maxStart}
          onClick={() => shift(12)}
        >
          OCT +
        </button>
        <span class="register-window-readout" aria-live="polite">
          <span class="register-window-arrow" aria-hidden="true">
            {cue()?.dir === 1 ? "▲" : cue()?.dir === -1 ? "▼" : "■"}
          </span>
          {readout()}
        </span>
      </div>
    </Show>
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
    // RC-1: the ROW-MANIFEST SIZE is shape too — a loaded document can put a
    // taller/same-id pattern under the same id:kind:bars key (default
    // lead-1 = 14 rows vs the demo's 15), and the renderer's row count is
    // fixed at build — the register window's clamp and the ROWS range in
    // the grid name are honest only against the real manifest.
    const rows = p && p.kind === "pitched" ? p.rowDegrees.length : 0;
    return p ? `${p.id}:${p.kind}:${p.bars}:${rows}:${stageMode()}` : "none";
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
      {/* M-5: the phone-only register-window shift row (pitched lanes). */}
      <Show
        when={
          stageMode() === "phone" &&
          props.lane !== "drums" &&
          pattern()?.kind === "pitched"
        }
      >
        <RegisterShiftControls lane={props.lane as PitchedLaneId} />
      </Show>
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
