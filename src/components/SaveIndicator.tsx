/**
 * SaveIndicator — the booth-corner saved dot (MF-2 minimal in-world affordance
 * for autosave; the full recovery UX is HU-3). Shape+fill coded, glow
 * decoration only: filled warm-white = saved, hollow = pending edit, dimmed
 * hollow = write error. Label text for screen readers + title tooltip.
 */

import { autosaveStatus } from "../persist/boot";

const LABELS: Record<string, string> = {
  idle: "Save not started",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
};

export default function SaveIndicator() {
  return (
    <div class="save-indicator" data-status={autosaveStatus()} title={LABELS[autosaveStatus()]}>
      <span class="save-dot" aria-hidden="true" />
      <span class="save-label">{LABELS[autosaveStatus()]}</span>
      <span aria-live="polite" class="visually-hidden">
        {LABELS[autosaveStatus()]}
      </span>
    </div>
  );
}
