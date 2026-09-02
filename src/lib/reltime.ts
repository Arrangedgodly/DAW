/**
 * Relative-time formatting (HU-3): one pure helper for every "… ago" surface
 * (save indicator, draft-recovery toast, projects popover). Pure in `now` so
 * unit tests pin the clock; no Intl.RelativeTimeFormat dependency needed for
 * these coarse buckets. `fullTimestamp` gives the keyboard/screen-reader
 * absolute form (aria-labels) so relative shorthand never hides information.
 */

const JUST_NOW_MS = 5_000;
const S = 1_000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Coarse relative age: "just now", "12s ago", "3m ago", "2h ago", "4d ago". */
export function relativeTime(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < JUST_NOW_MS) return "just now";
  if (age < MIN) return `${Math.floor(age / S)}s ago`;
  if (age < HOUR) return `${Math.floor(age / MIN)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
}

/** Locale absolute form for aria-labels and old rows relative shorthand hides. */
export function fullTimestamp(at: number): string {
  return new Date(at).toLocaleString();
}
