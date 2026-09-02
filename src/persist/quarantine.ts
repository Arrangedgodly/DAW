/**
 * Corrupt-row quarantine (HU-2, Hulk: every failure needs a visible,
 * RECOVERABLE state). When a persisted project row fails codec validation at
 * boot, we never delete the bytes: the row is RENAMED in place to
 * `<id>.corrupt-<timestamp>` (name suffixed "(corrupt)", dirty cleared) and
 * the original key is freed so the app can continue with a fresh default
 * without re-tripping over the bad row on every boot. The raw `json` is
 * preserved byte-for-byte and exportable via `exportQuarantinedBytes` (the
 * RECOVER toast action) — a non-destructive recovery path.
 */

import { FILE_EXTENSION, downloadTextFile, safeFileStem, type DownloadSeam } from "./fileIO";
import type { ProjectDb, ProjectRecord } from "./db";

export const QUARANTINE_MARK = ".corrupt";
export const QUARANTINE_NAME_SUFFIX = " (corrupt)";

export interface QuarantineResult {
  /** The renamed row's id (`<original>.corrupt-<timestamp>`). */
  readonly quarantineId: string;
  readonly originalId: string;
  readonly name: string;
  /** The original raw bytes, preserved verbatim for RECOVER. */
  readonly json: string;
}

export interface QuarantineOptions {
  readonly now?: () => number;
}

/** Rename one bad row to a quarantine id; nothing is ever deleted. */
export async function quarantineProjectRecord(
  db: ProjectDb,
  record: ProjectRecord,
  opts: QuarantineOptions = {},
): Promise<QuarantineResult> {
  const now = opts.now?.() ?? Date.now();
  // Unique quarantine id: timestamp base, counter on (unlikely) collision.
  let quarantineId = `${record.id}${QUARANTINE_MARK}-${now}`;
  let suffix = 0;
  while (await db.getRecord(quarantineId)) {
    suffix += 1;
    quarantineId = `${record.id}${QUARANTINE_MARK}-${now}-${suffix}`;
  }
  await db.putRecord({
    ...record,
    id: quarantineId,
    name: `${record.name}${QUARANTINE_NAME_SUFFIX}`,
    dirty: false,
  });
  // "Rename": the original KEY goes away so the next boot does not pick the
  // bad row again — the BYTES live on untouched under the quarantine id.
  await db.deleteRecord(record.id);
  return {
    quarantineId,
    originalId: record.id,
    name: `${record.name}${QUARANTINE_NAME_SUFFIX}`,
    json: record.json,
  };
}

/** Download filename for quarantined bytes: `<name>.corrupt.bitbounce.json`. */
export function quarantineFilename(name: string): string {
  const base = name.endsWith(QUARANTINE_NAME_SUFFIX)
    ? name.slice(0, -QUARANTINE_NAME_SUFFIX.length)
    : name;
  return `${safeFileStem(base)}${QUARANTINE_MARK}${FILE_EXTENSION}`;
}

/**
 * RECOVER action: download the ORIGINAL raw json (never re-encoded) so the
 * user can keep/inspect exactly what was stored. Returns the filename.
 */
export function exportQuarantinedBytes(
  quarantine: Pick<QuarantineResult, "name" | "json">,
  seam?: DownloadSeam,
): string {
  return downloadTextFile(quarantineFilename(quarantine.name), quarantine.json, seam);
}
