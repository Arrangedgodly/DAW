/**
 * Euclidean fill session (PX-3) — the pure state machine behind the per-row
 * fill control. Lives in state/ (not the component) so the preview/commit
 * contract is unit-testable in node without a DOM:
 *
 *   - PREVIEW never touches the store: `fillPreview` derives the overlay
 *     pattern from the session params; only `applyEuclidFill` (store.ts)
 *     writes cells.
 *   - The control does not fight hand edits: `readFillSession` re-derives
 *     the baseline from the row on every store change; once the row matches
 *     no Euclidean pattern the display falls back to CUSTOM ('—') and the
 *     session re-arms the moment parameters change again.
 *
 * NOT a live engine mode — a fill is a one-shot grid paint; after commit the
 * cells are ordinary hand-editable document data.
 */

import { euclid, matchEuclid, type EuclidMatch } from "../audio/euclid";

/** Parameters the two steppers drive. */
export interface FillParams {
  readonly pulses: number;
  readonly rotation: number;
}

/**
 * The session state for one drum row.
 *  - `match`: the row's canonical Euclid parameterisation, or null when the
 *    row is CUSTOM (hand-edited away from every pattern).
 *  - `armed`: parameters have changed since the last commit → a preview is
 *    pending and Apply is live. Unarmed sessions just mirror the match.
 */
export interface FillSession {
  readonly params: FillParams;
  readonly match: EuclidMatch | null;
  readonly armed: boolean;
}

/** Read a session from a row: unarmed, params mirroring the match (if any). */
export function readFillSession(row: readonly boolean[]): FillSession {
  const match = matchEuclid(row);
  // Re-arm baseline for a custom row: keep the row's density (popcount) so
  // the first stepper nudge starts near the current feel instead of zero.
  const popcount = row.reduce((n, on) => (on ? n + 1 : n), 0);
  return {
    params: match ? { ...match } : { pulses: popcount, rotation: 0 },
    match,
    armed: false,
  };
}

/** Step one parameter (the steppers' pure core). Returns the armed session. */
export function stepFillParam(
  session: FillSession,
  which: keyof FillParams,
  delta: number,
  steps: number,
): FillSession {
  const min = which === "pulses" ? 0 : 0;
  const max = which === "pulses" ? steps : Math.max(0, steps - 1);
  const value = session.params[which];
  const next = Math.min(max, Math.max(min, value + delta));
  if (next === value && session.armed) return session;
  return {
    ...session,
    params: { ...session.params, [which]: next },
    armed: true,
  };
}

/**
 * The preview overlay for an armed session (the pattern Apply would paint).
 * Unarmed sessions preview nothing (null) — the committed cells already show
 * the pattern.
 */
export function fillPreview(
  session: FillSession,
  steps: number,
): boolean[] | null {
  if (!session.armed) return null;
  return euclid(session.params.pulses, steps, session.params.rotation);
}

/** The pattern a commit paints (armed or not — callers pass armed sessions). */
export function fillPattern(session: FillSession, steps: number): boolean[] {
  return euclid(session.params.pulses, steps, session.params.rotation);
}

/**
 * Keyboard mapping for the fill control group: Enter commits an armed
 * session, Escape cancels the preview back to the row's baseline. Arrow
 * handled per-stepper by native buttons/aria; this is the group-level map.
 */
export function fillKeyAction(key: string): "commit" | "cancel" | null {
  if (key === "Enter") return "commit";
  if (key === "Escape") return "cancel";
  return null;
}

/** Display value for the pulses readout: '—' when custom and unarmed. */
export function fillDisplay(session: FillSession, steps: number): string {
  if (!session.armed && session.match === null) return "—";
  return session.armed
    ? `${session.params.pulses}/${steps}`
    : `${session.match!.pulses}/${steps}`;
}
