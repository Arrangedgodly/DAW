/**
 * Help-mode (info view) UI state (HP-1): ONE ephemeral Solid signal — never
 * document state, never persisted, never undoable (the selection.ts two-tier
 * law). keyboard.md v2 §"Help mode": toggled by the booth "INFO ?" button or
 * the global `i` key; while on, Escape exits the mode FIRST (cancel-first)
 * and nothing is trapped — every control stays reachable and operable.
 *
 * Zero-cost clause (docs/dev/perf-budget.md §8, TH-4 c): the InfoView
 * component is mounted by App ONLY while this signal is true — help mode off
 * means zero listeners, zero rAF loops, zero reactive help subscriptions and
 * zero help DOM. This module itself is one signal + two functions.
 *
 * Toggle announcements (a11y §7 E6) ride the ONE stage-level status region
 * (selection.ts announceStage): the info region cannot announce "INFO MODE
 * OFF" itself because it is — correctly — unmounted the instant the mode
 * turns off.
 */

import { createSignal } from "solid-js";
import { announceStage } from "./selection";

export const INFO_MODE_ON_ANNOUNCEMENT =
  "INFO MODE ON — FOCUS OR TAP A CONTROL TO HEAR WHAT IT DOES";
export const INFO_MODE_OFF_ANNOUNCEMENT = "INFO MODE OFF";

const [helpMode, setHelpModeSignal] = createSignal(false);

export { helpMode };

/** Set the mode; every actual change announces through the stage region. */
export function setHelpMode(next: boolean): void {
  if (helpMode() === next) return;
  setHelpModeSignal(next);
  announceStage(next ? INFO_MODE_ON_ANNOUNCEMENT : INFO_MODE_OFF_ANNOUNCEMENT);
}

/** Toggle help mode (booth INFO button + global `i`). */
export function toggleHelp(): void {
  setHelpMode(!helpMode());
}
