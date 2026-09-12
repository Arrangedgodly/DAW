/**
 * SaveIndicator (HU-3 upgrade of the MF-2 dot): booth-corner autosave state —
 * SAVED <rel> / SAVING… / UNSAVED CHANGES / SAVE FAILED — RETRYING. The
 * relative "SAVED 12s AGO" text rides a slow 5 s tick (paused while the tab is
 * hidden); text-only, so it is reduced-motion safe by construction (no dot
 * animation exists — fill/shape carry state per the DES-1 contract). Fully
 * keyboard-inspectable: the container's aria-label carries the state plus the
 * ABSOLUTE last-saved timestamp (relative shorthand never hides information).
 * The label machine is a pure exported function (unit-tested without DOM).
 */

import { createSignal, onCleanup, onMount } from "solid-js";
import { autosaveStatus, getLastSavedAt, builtInDemo } from "../persist/boot";
import { fullTimestamp } from "../lib/reltime";
import { indicatorLabel } from "../lib/saveIndicator";
import { registerHelp } from "../help/registry";

/** Slow tick cadence for the relative-time text (s, not ms of accuracy). */
const TICK_MS = 5_000;

// HP-2 help content (Professor X voice on HP-1's registry; I2-6 colocated law).
registerHelp([
  {
    id: "save.status",
    title: "AUTOSAVE",
    text: "Your work writes itself to this browser as you edit — no save button needed. SAVED with a rough time is healthy; if SAVE FAILED appears it keeps retrying, and SAVE FILE always exports a copy regardless.",
  },
]);

export default function SaveIndicator() {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    // Slow tick; skip work while hidden (the text catches up on next paint).
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, TICK_MS);
    onCleanup(() => clearInterval(id));
  });

  const label = () =>
    builtInDemo()
      ? "BUILT-IN DEMO"
      : indicatorLabel(autosaveStatus(), getLastSavedAt(), now());
  const aria = () => {
    const savedAt = getLastSavedAt();
    return savedAt === null
      ? label()
      : `${label()} (last saved ${fullTimestamp(savedAt)})`;
  };

  return (
    <div
      class="save-indicator"
      data-status={autosaveStatus()}
      data-help="save.status"
      role="status"
      tabindex="0"
      aria-label={aria()}
      title={
        getLastSavedAt() === null ? label() : fullTimestamp(getLastSavedAt()!)
      }
    >
      <span class="save-dot" aria-hidden="true" />
      <span class="save-label" aria-hidden="true">
        {label()}
      </span>
    </div>
  );
}
