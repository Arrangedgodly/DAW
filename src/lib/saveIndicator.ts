/**
 * SaveIndicator label machine (HU-3): pure status × last-saved mtime × now →
 * visible text, kept OUT of the .tsx (the unit project does not transform
 * JSX) so the state machine is unit-testable in node without DOM.
 * "idle" with a persisted row is a truthful saved (boot just wrote/restored).
 */

import { relativeTime } from "./reltime";

export function indicatorLabel(
  status: string,
  lastSavedAt: number | null,
  now: number,
): string {
  switch (status) {
    case "dirty":
      return "UNSAVED CHANGES";
    case "saving":
      return "SAVING…";
    case "error":
      return "SAVE FAILED — RETRYING";
    case "saved":
    case "idle":
      if (lastSavedAt === null) return status === "idle" ? "AUTOSAVE ON" : "SAVED";
      return `SAVED ${relativeTime(lastSavedAt, now).toUpperCase()}`;
    default:
      return "AUTOSAVE ON";
  }
}
