/**
 * Pattern-rail logic (DES-6, pure — no DOM, no store import).
 *
 * The rail is the song arrangement surface: per lane, one row of TILES —
 * chain INSTANCES (slot index → pattern), not the pattern library — plus the
 * lane's pattern pool for management actions. Named cue states (the raise):
 * every tile can carry a text label ("VERSE", "DROP") that reads as a section
 * cue, text-equivalent (never color-only). Pending quantized switches map
 * from the engine's getPendingSwitch snapshot onto tile state.
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
