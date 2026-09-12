/**
 * Pattern-rail logic (DES-6 + IN-3, pure — no DOM, no store import).
 *
 * The rail is the song arrangement surface: per lane, one row of TILES —
 * chain INSTANCES (slot index → pattern), not the pattern library — plus the
 * lane's pattern pool for management actions. Named cue states (the raise):
 * every tile can carry a text label ("VERSE", "DROP") that reads as a section
 * cue, text-equivalent (never color-only). Pending quantized switches map
 * from the engine's getPendingSwitch snapshot onto tile state.
 *
 * IN-3 adds the multi-clip cue range math (keyboard.md v2): Shift+arrow
 * range selection between an anchor and a focus cell, carried + clamped
 * across lane rows, committed per touched row at the focus-edge column.
 *
 * Everything here is testable without a browser (scaleChip.ts pattern).
 */

import {
  DRUM_PIECES,
  PITCH_CLASS_NAMES,
  type LaneId,
  type PatternBars,
  type ProjectDocument,
} from "../document/schema";
import { effectiveScale, modeSize } from "../document/scales";
import type { PendingSwitchSnapshot } from "../engine/session";

/** One chain slot as the rail renders it. */
export interface RailTile {
  readonly slot: number;
  readonly patternId: string;
  readonly name: string;
  readonly bars: number;
  /** Named cue label for this chain position (null = unlabeled). */
  readonly cue: string | null;
  /** ⟲ "loop" replays this slot; → "next" plays it once and moves on. */
  readonly mode: "loop" | "next";
}

/** The lane's pattern pool entry (management column). */
export interface PoolEntry {
  readonly patternId: string;
  readonly name: string;
  readonly bars: number;
}

export function railTiles(doc: ProjectDocument, lane: LaneId): RailTile[] {
  const cues = doc.chainCues?.[lane];
  const modes = doc.chainModes?.[lane];
  return doc.songChain[lane].map((patternId, slot) => {
    const pattern = doc.patterns[lane].find((p) => p.id === patternId);
    return {
      slot,
      patternId,
      name: pattern?.name ?? "?",
      bars: pattern?.bars ?? 1,
      cue: cues?.[slot] ?? null,
      mode: modes?.[slot] ?? "next",
    };
  });
}

export function patternPool(doc: ProjectDocument, lane: LaneId): PoolEntry[] {
  return doc.patterns[lane].map((p) => ({
    patternId: p.id,
    name: p.name,
    bars: p.bars,
  }));
}

// ---------------------------------------------------------------------------
// LL-1 (iteration 3, i3-4): the LENGTH ladder — powers-of-two navigation +
// the E10 announcement texts (docs/dev/keyboard.md §"Pattern resize").
// Pure; the UI funnel (PatternRail.tsx stepPatternLength) composes these
// with the store's resizePattern.
// ---------------------------------------------------------------------------

/** The powers-of-two length ladder (schema PATTERN_BAR_VOCABULARY order). */
export const PATTERN_LENGTH_LADDER: readonly PatternBars[] = [
  1, 2, 4, 8, 16, 32, 64, 128,
];

/**
 * One vocabulary step along the ladder (KL-1: `b` grows 1→2→…→128,
 * Shift+`b` shrinks 128→…→1). Null at the ladder's end — the caller's
 * no-op that still announces the limit (never a silent no-op).
 */
export function nextPatternLength(
  bars: PatternBars,
  dir: 1 | -1,
): PatternBars | null {
  const index = PATTERN_LENGTH_LADDER.indexOf(bars);
  if (index < 0) return null;
  const next = index + dir;
  return next >= 0 && next < PATTERN_LENGTH_LADDER.length
    ? PATTERN_LENGTH_LADDER[next]!
    : null;
}

const barsText = (bars: number): string => `${bars} BAR${bars === 1 ? "" : "S"}`;

/** E10 success (grow or clean shrink), through the lane's rail status region. */
export function resizeSuccessAnnouncement(
  label: string,
  bars: number,
): string {
  return `PATTERN ${label} · ${barsText(bars)}`;
}

/** E10 limit no-op (`PATTERN B · 128 BARS · AT LIMIT`, singular at 1). */
export function resizeLimitAnnouncement(
  label: string,
  bars: number,
): string {
  return `PATTERN ${label} · ${barsText(bars)} · AT LIMIT`;
}

/**
 * E10 refusal — never silent, never truncating:
 * `CANNOT SHRINK PATTERN B TO 4 BARS · <ROW LABEL> NOTE AT BAR 5 WOULD BE
 * LOST · MOVE OR SHORTEN IT FIRST`. `bar` is the blocking note's ANCHOR bar
 * (1-based — the note's identity; the store's determinism rule picked the
 * note: greatest end, ties by latest start).
 */
export function resizeRefusalAnnouncement(
  label: string,
  toBars: number,
  rowLabel: string,
  bar: number,
): string {
  return `CANNOT SHRINK PATTERN ${label} TO ${barsText(toBars)} · ${rowLabel} NOTE AT BAR ${bar} WOULD BE LOST · MOVE OR SHORTEN IT FIRST`;
}

/** The 1-based bar a step belongs to (the announcement's addressing). */
export function barOfStep(step: number): number {
  return Math.floor(step / 16) + 1;
}

/**
 * The ROW LABEL a refusal names — the grid's own row vocabulary: drum
 * pieces uppercase (KICK…), pitched rows as the pitch-name labels the grid
 * renders (LaneGrid.pitchedLabels' law: pitch class + ′ above the first
 * octave). `fallback` covers a degree outside the manifest (not
 * UI-reachable; validation ties notes to rows in practice).
 */
export function resizeRowLabel(
  doc: ProjectDocument,
  lane: LaneId,
  row: number | string,
): string {
  if (typeof row === "string") return row.toUpperCase();
  if (lane === "drums") return (DRUM_PIECES[row] ?? `ROW ${row}`).toUpperCase();
  const scale = effectiveScale(doc, lane);
  const size = modeSize(scale.mode);
  const pc = (scale.root + scale.intervals[row % size]) % 12;
  const octave = Math.floor(row / size);
  return PITCH_CLASS_NAMES[pc] + (octave > 0 ? "′" : "");
}

// ---------------------------------------------------------------------------
// Tile state mapping
// ---------------------------------------------------------------------------

export type TileState = "active" | "pending" | "selected" | "idle";

export interface TileStateInput {
  /** Engine's active pattern id for the lane (session.getActivePattern). */
  readonly activePatternId: string | null;
  /**
   * 2026-09-11: the SLOT sounding now (soundingFollow's slot read). When
   * present it is the authority — a chain repeats patterns, so matching the
   * pattern id lit every tile holding it and the old section stayed lit
   * after the chain moved on. Null before anything has sounded: the
   * pattern-id match below is the pre-follow fallback, unchanged.
   */
  readonly activeSlot: number | null;
  /** Engine pending switch snapshot (session.getPendingSwitch). */
  readonly pending: PendingSwitchSnapshot | null;
  /** Engine has a deferred chain-structure edit (session.hasPendingSchedule). */
  readonly structurePending: boolean;
  /** Ephemeral editing selection (selection.getActivePattern). */
  readonly selectedPatternId: string;
  /**
   * The selected CHAIN SLOT (selection.getActiveSlot), when the selection
   * addressed one. Null = selected by pattern alone → id match.
   */
  readonly selectedSlot: number | null;
}

/**
 * State of one tile (chain slot). ACTIVE = the engine is playing this slot's
 * pattern now; PENDING = a quantized switch will land on this pattern at the
 * next boundary; SELECTED = the editing selection (while stopped this is what
 * the grid edits). Precedence: pending > active > selected > idle — a pending
 * target is the most time-critical state (Hulk: pending must be visible).
 */
export function tileState(tile: RailTile, input: TileStateInput): TileState {
  // A slot cue names its exact chain position (repeats of one pattern are
  // distinct slots); a legacy pattern switch names the pattern.
  if (
    input.pending &&
    (input.pending.toSlot !== undefined
      ? input.pending.toSlot === tile.slot
      : input.pending.toPatternId === tile.patternId)
  )
    return "pending";
  // ACTIVE and SELECTED both resolve slot-first, pattern-id only as the
  // fallback for a selection that never named a slot. Slot-first is what
  // makes "exactly one lit section" true across a chain that repeats a
  // pattern, and across the natural advance the follow now tracks.
  const isActive =
    input.activeSlot != null
      ? input.activeSlot === tile.slot
      : input.activePatternId != null &&
        input.activePatternId === tile.patternId;
  const isSelected =
    input.selectedSlot != null
      ? input.selectedSlot === tile.slot
      : input.selectedPatternId === tile.patternId;
  if (isActive) return isSelected ? "selected" : "active";
  if (isSelected) return "selected";
  return "idle";
}

// ---------------------------------------------------------------------------
// Announcements (aria-live text — states are text-equivalent, Daredevil)
// ---------------------------------------------------------------------------

export function pendingAnnouncement(
  laneName: string,
  pending: PendingSwitchSnapshot,
): string {
  const when =
    pending.appliesAtStep == null
      ? "when playback starts"
      : pending.mode === "iteration"
        ? `at step ${pending.appliesAtStep} (next chain pass)`
        : `at step ${pending.appliesAtStep}`;
  if (pending.mode === "jump" && pending.toSlot !== undefined)
    return `${laneName}: jumping to slot ${pending.toSlot + 1} (${pending.toPatternId}) ${when}`;
  return `${laneName}: switching to ${pending.toPatternId} ${when}`;
}

export function structurePendingAnnouncement(laneName: string): string {
  return `${laneName}: chain change queued — lands at the next chain pass`;
}

// ---------------------------------------------------------------------------
// BC-1 (I3-a): rail `+` = new blank clip — naming + creation announcement
// ---------------------------------------------------------------------------

/**
 * The next pattern label for a lane whose pool holds `poolCount` patterns:
 * A..Z by pool index, then P27+ — the established addPattern call-site
 * naming, ONE authority now that three creation paths must agree (the PAT
 * menu's +N B tools, the global `n`, and the rail `+`).
 */
export function nextPatternLabel(poolCount: number): string {
  return poolCount < 26
    ? String.fromCharCode(65 + poolCount)
    : `P${poolCount + 1}`;
}

/**
 * E11 (BC-1): the creation announcement through the lane's rail status
 * region — `PATTERN B CREATED · 1 BAR · APPENDED` (label = the actual next
 * letter; bars pluralized; the appended+selected state rides the same line —
 * one announcement, not three).
 */
export function patternCreatedAnnouncement(
  label: string,
  bars: number,
): string {
  return `PATTERN ${label} CREATED · ${bars} BAR${bars === 1 ? "" : "S"} · APPENDED`;
}

// ---------------------------------------------------------------------------
// Keyboard navigation (roving tabindex along a lane's row)
// ---------------------------------------------------------------------------

export function clampSlot(count: number, slot: number, delta: number): number {
  if (count === 0) return 0;
  return Math.min(count - 1, Math.max(0, slot + delta));
}

/** Cue input clamp for the edit field (schema authority: CUE_MAX_CHARS). */
export function clampCue(text: string, maxChars: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// IN-3 multi-clip cue range (keyboard.md v2 §"Rail multi-clip cue selection")
// ---------------------------------------------------------------------------

/** The rail's lane rows in visual order, top→bottom. */
export const RAIL_ROWS: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

/** One rail tile address: lane row + chain slot. */
export interface RailCell {
  readonly lane: LaneId;
  readonly slot: number;
}

/** An active multi-clip selection between an anchor and a focus cell. */
export interface RailRange {
  readonly anchor: RailCell;
  readonly focus: RailCell;
}

export type RailRangeKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown";

/** Clamp a slot into a row of `length` tiles (carry-clamp law; no wrap). */
export function clampSlotTo(length: number, slot: number): number {
  return Math.min(Math.max(slot, 0), Math.max(0, length - 1));
}

/**
 * Shift+arrow range extension from the focused tile: the anchor is where
 * the shift began; the FOCUS edge moves, clamped — along the row for ←/→,
 * carried to the adjacent row (clamped to that row's length) for ↑/↓.
 * Never wraps: Shift+↑ at the top row stays (the focus cell is unchanged).
 */
export function rangeExtend(
  range: RailRange | null,
  focused: RailCell,
  key: RailRangeKey,
  rowLengths: Record<LaneId, number>,
): RailRange {
  const anchor = range?.anchor ?? focused;
  let lane = focused.lane;
  let slot = focused.slot;
  if (key === "ArrowLeft") {
    slot = clampSlotTo(rowLengths[lane], slot - 1);
  } else if (key === "ArrowRight") {
    slot = clampSlotTo(rowLengths[lane], slot + 1);
  } else {
    const index = RAIL_ROWS.indexOf(focused.lane);
    const next = key === "ArrowUp" ? index - 1 : index + 1;
    if (next >= 0 && next < RAIL_ROWS.length) {
      lane = RAIL_ROWS[next];
      slot = clampSlotTo(rowLengths[lane], slot); // carried, clamped
    }
  }
  return { anchor, focus: { lane, slot } };
}

/** The lane rows the range touches, top→bottom (RAIL_ROWS order). */
export function rangeRows(range: RailRange): LaneId[] {
  const a = RAIL_ROWS.indexOf(range.anchor.lane);
  const f = RAIL_ROWS.indexOf(range.focus.lane);
  return RAIL_ROWS.slice(Math.min(a, f), Math.max(a, f) + 1) as LaneId[];
}

/**
 * The CUE ALL commit target for one touched row: the FOCUS-edge column,
 * clamped to that row's length (keyboard.md v2 — identical funnel + effect
 * class as the pointer sweep's per-lane last-touched tile).
 */
export function rangeCommitSlot(range: RailRange, rowLength: number): number {
  return clampSlotTo(rowLength, range.focus.slot);
}

/** Whether one tile renders inside the active range (2D anchor↔focus box). */
export function rangeIncludes(
  range: RailRange,
  lane: LaneId,
  slot: number,
): boolean {
  const r = RAIL_ROWS.indexOf(lane);
  const a = RAIL_ROWS.indexOf(range.anchor.lane);
  const f = RAIL_ROWS.indexOf(range.focus.lane);
  if (r < 0 || r < Math.min(a, f) || r > Math.max(a, f)) return false;
  return (
    slot >= Math.min(range.anchor.slot, range.focus.slot) &&
    slot <= Math.max(range.anchor.slot, range.focus.slot)
  );
}

/**
 * E5 (a11y §7): the one rail summary line both paths announce IDENTICALLY —
 * `QUEUED <n> LANES` for the lanes whose switch the multi-clip commit
 * requested. No announcement may depend on pointer-only events.
 */
export function queuedLanesAnnouncement(count: number): string {
  return `QUEUED ${count} LANES`;
}
