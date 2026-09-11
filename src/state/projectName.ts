/**
 * Project-name law (i6 audit §2.1/§2.2): the ONE shared normalizer both
 * rename paths (store `setProjectName` + persist `renameProjectRecord`) and
 * the S-3 rename editor run first. Pure — no store, no db, no clock.
 *
 * The bound is normalizer/UI law, deliberately NOT schema law:
 * `ProjectDocumentSchema.name` stays a plain `v.string()` (every legacy
 * "Untitled" row and any overlong future import stays schema-valid); only
 * writes made through the rename surface are normalized.
 *
 * Emoji-safe clamp: unlike `clampCue`'s UTF-16 slice (patternRail.ts), the
 * 48-char cut counts CODE POINTS (`[...s].slice(0, 48).join("")`) — a
 * mid-surrogate-pair cut would produce a lone surrogate that UTF-8 consumers
 * choke on even though JSON.stringify serializes it.
 */

/** Max project-title length, counted in code points (i6 §2.1). */
export const PROJECT_NAME_MAX_CHARS = 48;

/**
 * Normalize a project name: collapse internal whitespace runs to one space,
 * trim the ends, clamp to `PROJECT_NAME_MAX_CHARS` code points.
 *
 * Returns `undefined` when the result would be empty — the no-op signal both
 * rename paths refuse the write on (§2.2 rule 2). Duplicate names are ALLOWED
 * (ids are the key; the list disambiguates) — there is no uniqueness check
 * here by design.
 */
export function normalizeProjectName(name: string): string | undefined {
  const collapsed = name.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return [...collapsed].slice(0, PROJECT_NAME_MAX_CHARS).join("");
}
