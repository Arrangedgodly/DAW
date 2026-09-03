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

import type { LaneId, ProjectDocument } from "../document/schema";
import type { PendingSwitchSnapshot } from "../engine/session";

/** One chain slot as the rail renders it. */
export interface RailTile {
  readonly slot: number;
  readonly patternId: string;
  readonly name: string;
  readonly bars: number;
  /** Named cue label for this chain position (null = unlabeled). */
  readonly cue: string | null;
}

/** The lane's pattern pool entry (management column). */
export interface PoolEntry {
  readonly patternId: string;
  readonly name: string;
  readonly bars: number;
}

export function railTiles(doc: ProjectDocument, lane: LaneId): RailTile[] {
  const cues = doc.chainCues?.[lane];
  return doc.songChain[lane].map((patternId, slot) => {
    const pattern = doc.patterns[lane].find((p) => p.id === patternId);
    return {
      slot,
      patternId,
      name: pattern?.name ?? "?",
      bars: pattern?.bars ?? 1,
      cue: cues?.[slot] ?? null,
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
// Tile state mapping
// ---------------------------------------------------------------------------

export type TileState = "active" | "pending" | "selected" | "idle";

export interface TileStateInput {
  /** Engine's active pattern id for the lane (session.getActivePattern). */
  readonly activePatternId: string | null;
  /** Engine pending switch snapshot (session.getPendingSwitch). */
  readonly pending: PendingSwitchSnapshot | null;
  /** Engine has a deferred chain-structure edit (session.hasPendingSchedule). */
  readonly structurePending: boolean;
  /** Ephemeral editing selection (selection.getActivePattern). */
  readonly selectedPatternId: string;
}

/**
 * State of one tile (chain slot). ACTIVE = the engine is playing this slot's
 * pattern now; PENDING = a quantized switch will land on this pattern at the
 * next boundary; SELECTED = the editing selection (while stopped this is what
 * the grid edits). Precedence: pending > active > selected > idle — a pending
 * target is the most time-critical state (Hulk: pending must be visible).
 */
export function tileState(tile: RailTile, input: TileStateInput): TileState {
  if (input.pending && input.pending.toPatternId === tile.patternId)
    return "pending";
  if (
    input.activePatternId != null &&
    input.activePatternId === tile.patternId
  ) {
    return input.selectedPatternId === tile.patternId ? "selected" : "active";
  }
  if (input.selectedPatternId === tile.patternId) return "selected";
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
      : pending.mode === "boundary"
        ? `at step ${pending.appliesAtStep}`
        : `at step ${pending.appliesAtStep} (next chain pass)`;
  return `${laneName}: switching to ${pending.toPatternId} ${when}`;
}

export function structurePendingAnnouncement(laneName: string): string {
  return `${laneName}: chain change queued — lands at the next chain pass`;
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
