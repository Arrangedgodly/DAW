/**
 * Help registry (HP-1, town-hall I2-6) — the anti-rot help architecture.
 *
 * LAW (I2-6, the "help-text rot" risk): help text is DEFINED NEXT TO the
 * controls it describes, never in a central help document. Components
 * register typed entries at module scope (colocated with the JSX that stamps
 * `data-help="<id>"` on the element) and the InfoView — the only consumer —
 * resolves hovered/focused elements to entries at interaction time. A control
 * without a colocated registration simply never explains itself, and the
 * coverage gates (tests/browser/help-mode.test.tsx) fail on empty text,
 * stale ids, or missing entries.
 *
 * Cost contract (TH-4 c / docs/dev/perf-budget.md §8): registering is pure
 * static data — while help mode is OFF there are no listeners, no rAF, no
 * reactive subscriptions and no help DOM anywhere (the InfoView component is
 * mounted by App only while the mode is on).
 *
 * Content (HP-2): the `text` strings shipped here by HP-1 are terse
 * STRUCTURAL placeholders — HP-2 rewrites them in the plain-language,
 * music-first voice via TEXT-ONLY edits to the colocated constants (the
 * registry API is frozen: id + title + text).
 */

export interface HelpEntry {
  /** Stable registry id; also the `data-help` value stamped on the element. */
  readonly id: string;
  /** Short control name shown at the head of the info region. */
  readonly title: string;
  /** Plain-language explanation (HP-2 owns the final voice). */
  readonly text: string;
}

const entries = new Map<string, HelpEntry>();

/**
 * Register entries. Idempotent for identical re-registration (module-scope
 * calls can run again under test mounts); a CONFLICTING duplicate — same id,
 * different content — throws at import time so a copy-paste id bug can never
 * ship silently.
 */
export function registerHelp(items: readonly HelpEntry[]): void {
  for (const item of items) {
    const existing = entries.get(item.id);
    if (
      existing &&
      (existing.title !== item.title || existing.text !== item.text)
    ) {
      throw new Error(
        `[help] conflicting registration for "${item.id}" — ids must be unique`,
      );
    }
    entries.set(item.id, item);
  }
}

/** Look up the entry a `data-help` id refers to (undefined = unregistered). */
export function getHelp(id: string): HelpEntry | undefined {
  return entries.get(id);
}

/** All registered entry ids, sorted (the coverage gates' enumeration). */
export function helpEntryIds(): string[] {
  return [...entries.keys()].sort();
}
