/**
 * Selection/focus state (IM-6/IM-7, D1 two-tier law): ephemeral UI state lives in
 * Solid signals and NEVER in the document store or undo history. Active lane,
 * the active pattern per lane, and the focused grid cell are pure view state —
 * they change at interaction speed, are not persisted, and are not part of the
 * project document (two users could focus different cells in the same doc).
 *
 * IM-7 model (documented): the CHAIN is document state (songChain); the ACTIVE
 * pattern for playback is ENGINE state (Session), fed from this selection via
 * engineBridge.requestPatternSwitch — which quantizes the switch to the lane's
 * next pattern boundary and exposes the pending state for the DES-6 rail.
 *
 * Signal accessors are named getSomething/setSomething (plus the bare signals
 * for JSX use) so call sites read clearly outside JSX.
 */

import { createSignal } from "solid-js";
import type { DrumPiece, LaneId, Pattern, PitchedLane } from "../document/schema";
import { LANE_NAMES } from "../components/laneMeta";
import { docStore, onDocumentReplaced, setLaneOctave } from "./store";

/** A focused grid cell: lane + row identity + step column. */
export interface FocusedCell {
  readonly lane: LaneId;
  /** Drum piece for the drums lane; scale degree for pitched lanes. */
  readonly row: DrumPiece | number;
  readonly step: number;
}

function defaultActivePatterns(): Record<LaneId, string> {
  const doc = docStore.getState().doc;
  const first = (lane: LaneId) =>
    doc.songChain[lane][0] ?? doc.patterns[lane][0]!.id;
  return {
    drums: first("drums"),
    bass: first("bass"),
    chords: first("chords"),
    lead: first("lead"),
  };
}

const [activeLane, setActiveLane] = createSignal<LaneId>("drums");
const [activePatterns, setActivePatterns] = createSignal<
  Record<LaneId, string>
>(defaultActivePatterns());
const [focusedCell, setFocusedCell] = createSignal<FocusedCell | null>(null);

/**
 * DES-6 view mode — the collapse/expand raise. FOCUS = collapse-to-pattern
 * (rail slim, grids larger); CHAIN = expand-to-chain (rail prominent).
 * Toggling NEVER clears selection (the raise's law): activeLane,
 * activePatterns and focusedCell are independent signals, so the editing
 * place survives both directions.
 */
export type ViewMode = "focus" | "chain";
const [viewMode, setViewMode] = createSignal<ViewMode>("chain");

/* ---------------------------------------------------------------------------
 * MB-1 (mobile slice): the RESPONSIVE STAGE MODE — pure viewport-derived view
 * state (the same two-tier law as the rest of this file: never document
 * state, never undo history). ONE source of truth for the breakpoint, read by
 * the App shell (data-stage attribute + the phone chrome group), StageFloor
 * (quadrant stage vs single-lane stage + lane switcher), LaneGrid (geometry
 * preset + the viewport-budget fit's stand-down) and PatternRail (the
 * condensed phone rail) — CSS keys entirely off .app[data-stage], so the JS
 * mode and the stylesheet can never drift.
 *
 * Breakpoints (the committed law, town-hall mobile addendum):
 *   phone   — width < 768, OR width < 1024 with height < 600 (a ROTATED
 *             phone keeps the phone law: sticky chrome + single-lane stage;
 *             the 2×2 quadrant stage is meaningless at phone heights).
 *   tablet  — 768 ≤ width < 1024 (and height ≥ 600): the 2×2 quadrant stage
 *             responsively scaled (the refinement-4 flex fit owns the
 *             vertical budget).
 *   desktop — width ≥ 1024: the one-page law, byte-identical (m4).
 * ------------------------------------------------------------------------- */
export type StageMode = "phone" | "tablet" | "desktop";

const PHONE_MQ = "(max-width: 767.98px)";
const SHORT_NARROW_MQ =
  "(min-width: 768px) and (max-width: 1023.98px) and (max-height: 599.98px)";
const UNDER_DESKTOP_MQ = "(max-width: 1023.98px)";

function deriveStageMode(): StageMode {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (
    window.matchMedia(PHONE_MQ).matches ||
    window.matchMedia(SHORT_NARROW_MQ).matches
  ) {
    return "phone";
  }
  return window.matchMedia(UNDER_DESKTOP_MQ).matches ? "tablet" : "desktop";
}

const [stageMode, setStageMode] = createSignal<StageMode>(deriveStageMode());

// Rotation/resize re-derives the mode live (the refinement-4 re-fit law).
if (typeof window !== "undefined" && window.matchMedia) {
  for (const query of [PHONE_MQ, SHORT_NARROW_MQ, UNDER_DESKTOP_MQ]) {
    window
      .matchMedia(query)
      .addEventListener("change", () => setStageMode(deriveStageMode()));
  }
}

/** The lane selection follows the latest grid interaction. */
export {
  activeLane,
  focusedCell,
  activePatterns,
  viewMode,
  stageStatus,
  stageMode,
};

export function toggleViewMode(): ViewMode {
  setViewMode((m) => (m === "chain" ? "focus" : "chain"));
  return viewMode();
}

/**
 * LY-1 (a11y gate E1): the ONE stage-level announcement text. Every actual
 * quadrant-selection change speaks `NOW EDITING <LANE>` through the stage
 * role=status region (StageFloor renders it); solo changes speak through the
 * same region (keyboard.md v2). HP-1: the help-mode toggle announcements
 * (`INFO MODE ON …` / `INFO MODE OFF`, state/helpMode.ts) also ride this
 * region — the info region itself is unmounted the instant the mode turns
 * off, so it cannot announce its own departure. Pure ephemeral text — never
 * a document.
 */
const [stageStatus, setStageStatus] = createSignal("");

/** Write the stage status region (selection/solo announcements). */
export function announceStage(text: string): void {
  setStageStatus(text);
}

export function selectLane(lane: LaneId): void {
  if (activeLane() === lane) return;
  setActiveLane(lane);
  setStageStatus(`NOW EDITING ${LANE_NAMES[lane]}`);
}

export function selectPattern(lane: LaneId, patternId: string): void {
  setActivePatterns((prev) => ({ ...prev, [lane]: patternId }));
}

export function getActivePattern(lane: LaneId): string {
  return activePatterns()[lane];
}

/**
 * The pattern a lane's grid is editing (IM-6/DES-6, PX-3 reuse): the
 * ephemeral selection if it still exists, else the chain's first slot, else
 * the lane's first pattern. Pure read over the current store snapshot.
 */
export function currentPatternFor(lane: LaneId): Pattern | undefined {
  const doc = docStore.getState().doc;
  const selected = activePatterns()[lane];
  if (selected) {
    const byId = doc.patterns[lane].find((p) => p.id === selected);
    if (byId) return byId;
  }
  const id = doc.songChain[lane][0];
  return doc.patterns[lane].find((p) => p.id === id) ?? doc.patterns[lane][0];
}

/** Focus a cell (keyboard navigation / pointer hover per DES-5). */
export function focusCell(cell: FocusedCell): void {
  setFocusedCell(cell);
}

export function clearFocus(): void {
  setFocusedCell(null);
}

/* ---------------------------------------------------------------------------
 * RC-1 (v3, I3-c): the REGISTER WINDOW — per-pitched-lane VIEW state on the
 * two-tier law (docs/dev/keyboard.md §"Register window scroll"): ephemeral
 * Solid signals, NEVER a document field, NEVER undo history. Every pitched
 * lane's grid shows the SAME one-octave window by default (equal-by-default
 * across fresh + demo + migrated projects, ZERO document churn); the full
 * row manifest stays reachable by scrolling INSIDE the quadrant.
 *
 * `start` is the manifest index of the first visible row. The grid clamps it
 * against its own manifest at mount (patterns of one lane may differ in
 * height); drums never window (manifest ≤ window — m1's phone law and the
 * quadrant law both keep full-manifest drums grids).
 * ------------------------------------------------------------------------- */

export type PitchedLaneId = Exclude<LaneId, "drums">;

const [registerWindowStarts, setRegisterWindowStarts] = createSignal<
  Partial<Record<PitchedLaneId, number>>
>({});

/** The lane's stored window start (undefined = not yet placed). */
export function registerWindowStart(
  lane: PitchedLaneId,
): number | undefined {
  return registerWindowStarts()[lane];
}

/** The reactive map (LaneGrid's effect tracks this). */
export { registerWindowStarts };

/** Store a window start (view-only; clamped by the grid against its rows). */
export function setRegisterWindowStart(lane: PitchedLaneId, start: number): void {
  setRegisterWindowStarts((prev) =>
    prev[lane] === start ? prev : { ...prev, [lane]: start },
  );
}

/**
 * The DEFAULT window position (RC-1's recorded production decision — the
 * KL-1 text pins the window's SIZE equality, not its default position): the
 * one-octave window that shows the MOST noted rows of the lane's patterns,
 * ties broken toward the LOWEST window; a lane with no notes starts at 0.
 * This keeps every shipped project's principal content visible by default
 * (demo: bass window 0–6 shows the root hits, lead window 6–12 shows the
 * melody) while every window stays the same SIZE. Row positions equal
 * degrees for the shipped ascending 0..n manifests; exotic manifests simply
 * clamp — every row stays reachable by scroll either way.
 */
export function defaultRegisterWindowStart(
  lane: PitchedLaneId,
  windowRows: number,
): number {
  const doc = docStore.getState().doc;
  const noted = new Set<number>();
  let rows = 0;
  for (const p of doc.patterns[lane]) {
    if (p.kind !== "pitched") continue;
    rows = Math.max(rows, p.rowDegrees.length);
    for (const note of p.notes) noted.add(note.degree);
  }
  const maxStart = Math.max(0, rows - windowRows);
  if (noted.size === 0) return 0;
  let best = 0;
  let bestCount = -1;
  for (let s = 0; s <= maxStart; s++) {
    let count = 0;
    for (let d = s; d < s + windowRows; d++) if (noted.has(d)) count++;
    if (count > bestCount) {
      bestCount = count;
      best = s;
    } // ties keep the earlier (lower) window
  }
  return best;
}

/** Read-or-initialize the lane's window (the memoized default). */
export function getOrCreateRegisterWindow(
  lane: PitchedLaneId,
  windowRows: number,
): number {
  const existing = registerWindowStarts()[lane];
  if (existing !== undefined) return existing;
  const start = defaultRegisterWindowStart(lane, windowRows);
  setRegisterWindowStart(lane, start);
  return start;
}

/**
 * A document REPLACEMENT (boot restore, project switch, NEW) re-defaults the
 * windows: the new project's content decides where the default windows sit.
 * Wired through store.loadDocument's listener seam (no store→selection
 * import; ordinary edits never fire it — undo/redo are not replacements).
 */
onDocumentReplaced(() => {
  setRegisterWindowStarts({});
});

/* ---------------------------------------------------------------------------
 * RC-1 (v3, i3-2): the OCTAVE transpose FUNNEL — the one path every input
 * takes (strip OCT −/+ buttons, global `o`/Shift+`o`; E5's pointer/keyboard
 * parity law). Writes the v3 lane `octave` field through the store action
 * (clamped −3..+3, canonical-empty at 0, undo family `octave:<lane>`, live
 * recompile via engineBridge's lane-config identity) and speaks E8's value +
 * clamp text through the strip-local aria-live region below. Transpose is
 * SOUND: it never scrolls the register window and never auditions (the
 * conflation fence, E9).
 * ------------------------------------------------------------------------- */

/** Signed octave text: 0 → "0", +1 → "+1", −3 → "−3" (E8's exact formats). */
export function octaveText(octave: number): string {
  return octave > 0 ? `+${octave}` : String(octave);
}

const [octaveStatuses, setOctaveStatus] = createSignal<
  Partial<Record<LaneId, string>>
>({});

/** The lane's strip-local OCT announcement text (LaneHeader renders it). */
export function octaveStatus(lane: LaneId): string {
  return octaveStatuses()[lane] ?? "";
}

function announceOctave(lane: LaneId, text: string): void {
  setOctaveStatus((prev) => ({ ...prev, [lane]: text }));
}

/**
 * Step a PITCHED lane one octave. The domain clamp (−3..+3) is a NO-OP that
 * still announces (`<LANE> OCTAVE +3 · AT LIMIT` — never a silent no-op).
 */
export function stepLaneOctave(
  lane: PitchedLaneId,
  delta: -1 | 1,
): void {
  const conf = docStore
    .getState()
    .doc.lanes.find((l) => l.id === lane) as PitchedLane;
  const current = conf.octave ?? 0;
  const next = Math.min(3, Math.max(-3, current + delta));
  const atLimit = next === current;
  if (!atLimit) setLaneOctave(lane, next);
  announceOctave(
    lane,
    `${LANE_NAMES[lane]} OCTAVE ${octaveText(next)}${atLimit ? " · AT LIMIT" : ""}`,
  );
}

/**
 * The global `o`/Shift+`o` guard twin for the drums lane: the drum voice
 * model has no pitch resolution (schema law), so the press announces
 * `DRUMS HAS NO OCTAVE` through the same strip-local region and writes
 * nothing.
 */
export function announceDrumsNoOctave(): void {
  announceOctave("drums", "DRUMS HAS NO OCTAVE");
}
