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
