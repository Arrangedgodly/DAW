/**
 * Pure mappings between booth UI values (integers, percents) and engine
 * values (clamped floats). No DOM/audio/framework dependencies.
 */

import { MAX_BPM, MIN_BPM, type Position, clampSwing } from "../audio/time";
import { clamp } from "../lib/clamp";

/** UI tempo control: integer BPM clamped to the transport range. */
export function clampBpmUi(value: number): number {
  return Math.round(clamp(value, MIN_BPM, MAX_BPM));
}

/** 0–100 percent → 0..1 swing amount (clamped). */
export function swingPercentToAmount(percent: number): number {
  return clamp(percent, 0, 100) / 100;
}

/** 0..1 swing amount → 0–100 percent (rounded for display). */
export function swingAmountToPercent(amount: number): number {
  return Math.round(clampSwing(amount) * 100);
}

/** 0–100 percent slider → 0..1 linear master gain. */
export function volumePercentToGain(percent: number): number {
  return clamp(percent, 0, 100) / 100;
}

/** 0..1 master gain → 0–100 percent (rounded for display). */
export function gainToVolumePercent(gain: number): number {
  return Math.round(clamp(gain, 0, 1) * 100);
}

/**
 * "BAR.BEAT.STEP" LED text, 1-based (DAW convention). The position
 * readout writes this string at most once per step change.
 */
export function formatPosition(pos: Position): string {
  return `${pos.bar + 1}.${pos.beat + 1}.${pos.step + 1}`;
}

/** Screen-reader beat announcement, e.g. "BAR 2 · BEAT 3". */
export function formatBeatAnnouncement(pos: Position): string {
  return `BAR ${pos.bar + 1} · BEAT ${pos.beat + 1}`;
}

/** One half of the LL-2 `p` position announcement (0-based bar inputs). */
export interface PositionAnnounceHalf {
  readonly bar: number;
  readonly bars: number;
}

/**
 * LL-2 (KL-1 §"Position & playhead at unequal cycle lengths", a11y E12):
 * the on-demand `p` readout — the GLOBAL LCM-cycle position, then the
 * ACTIVE lane's position within ITS cycle: `POSITION BAR 12 OF 64 · BASS
 * BAR 4 OF 4`. The lane half is omitted when every lane shares one cycle
 * length (`POSITION BAR 3 OF 4` — the equal-lengths zero-drift shape).
 * `lane` is null exactly then; a degenerate zero-cycle lane never reaches
 * the lane half (the global bar alone is spoken).
 */
export function formatPositionAnnouncement(
  global: PositionAnnounceHalf,
  lane: ({ readonly name: string } & PositionAnnounceHalf) | null,
): string {
  const head = `POSITION BAR ${global.bar + 1} OF ${Math.max(1, global.bars)}`;
  if (!lane) return head;
  return `${head} · ${lane.name} BAR ${lane.bar + 1} OF ${Math.max(1, lane.bars)}`;
}
