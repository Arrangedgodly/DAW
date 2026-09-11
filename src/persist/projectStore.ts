/**
 * Project store API (MF-2): list/save/load/delete over the `projects` store.
 * All document bytes flow through the canonical codec (RES-6): saveProject
 * encodes, loadProject decodes through migrate + validate, so IndexedDB rows,
 * crash drafts, and (MF-3) exported files share one byte format.
 *
 * No destructive UI is wired to deleteProject yet — the method exists for the
 * future project list (HU-3/MF-1 consumers).
 */

import { contentHash, decode, encode } from "../document/codec";
import { SCHEMA_VERSION, type ProjectDocument } from "../document/schema";
import { normalizeProjectName } from "../state/projectName";
import {
  type ProjectDb,
  type ProjectMeta,
  type ProjectRecord,
  makeRecord,
  recordMeta,
} from "./db";

export { BOOT_PROJECT_ID } from "./db";
export type { ProjectDb, ProjectMeta, ProjectRecord } from "./db";

/** Most-recent-first project metadata (no document bytes). */
export async function listProjects(db: ProjectDb): Promise<ProjectMeta[]> {
  const records = await db.allRecords();
  return records.map(recordMeta).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Atomically persist one document (single IndexedDB transaction per put). */
export async function saveProject(
  db: ProjectDb,
  id: string,
  doc: ProjectDocument,
  opts: { dirty?: boolean; now?: number } = {},
): Promise<ProjectRecord> {
  const json = encode(doc);
  const record = makeRecord(
    id,
    doc,
    json,
    opts.now ?? Date.now(),
    opts.dirty ?? false,
  );
  await db.putRecord(record);
  return record;
}

/** Load + decode one project. Throws DecodeError/MigrationError on bad rows. */
export async function loadProject(
  db: ProjectDb,
  id: string,
): Promise<ProjectDocument> {
  const record = await db.getRecord(id);
  if (!record) throw new Error(`loadProject: no project '${id}'`);
  return decode(record.json);
}

/** Raw row access (autosave dirty-marking; crash-draft inspection for HU-3). */
export async function getProjectRecord(
  db: ProjectDb,
  id: string,
): Promise<ProjectRecord | undefined> {
  return db.getRecord(id);
}

/**
 * Delete one project row. NOT wired to any UI in MF-2 (destructive; the
 * project-list UX arrives later). Resolves to true when a row was removed.
 */
export async function deleteProject(
  db: ProjectDb,
  id: string,
): Promise<boolean> {
  const existing = await db.getRecord(id);
  await db.deleteRecord(id);
  return existing !== undefined;
}

/**
 * Rename a NON-ACTIVE project row (i6 §2.4): getRecord → decode → normalize →
 * saveProject (full record rewrite — envelope name + re-encoded json land
 * together in one put, `updatedAt` refreshed so the row moves to the top of
 * the most-recent-first list). NEVER touches the live store or the autosave
 * controller — applying it to the ACTIVE row would be overwritten by the next
 * autosave flush (which re-reads the live doc); the dispatch rule is LAW:
 * current row → store `setProjectName`, every other row → this function.
 *
 * No-ops (missing row → undefined; empty/unchanged name → the existing
 * record, no write). A damaged row throws from `decode`, leaving the row
 * untouched for the caller (S-3) to surface.
 */
export async function renameProjectRecord(
  db: ProjectDb,
  id: string,
  name: string,
): Promise<ProjectRecord | undefined> {
  const record = await db.getRecord(id);
  if (!record) return undefined;
  const doc = decode(record.json);
  const normalized = normalizeProjectName(name);
  if (normalized === undefined || normalized === doc.name) return record;
  return saveProject(db, id, { ...doc, name: normalized });
}

/** The most recently updated row, or undefined when nothing was ever saved. */
export async function mostRecentProject(
  db: ProjectDb,
  opts: { exclude?: string } = {},
): Promise<ProjectRecord | undefined> {
  const records = (await db.allRecords()).filter(
    (record) => record.id !== opts.exclude,
  );
  if (records.length === 0) return undefined;
  return records.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
}

/** Content hash of a document — autosave's no-op-write dirty check. */
export function documentHash(doc: ProjectDocument): string {
  return contentHash(doc);
}

export { SCHEMA_VERSION };
