/**
 * IndexedDB access layer (MF-2, RES-6 decision): `idb` with a typed DBSchema,
 * one `projects` store keyed by `id` with a `by-updated` index for
 * most-recent-first listing. Records are JSON-envelope strings produced by the
 * canonical codec — one byte format, one read/write boundary (codec.ts).
 *
 * DB-level version 1 (store layout only; document migrations live in the
 * codec and are decoupled — a future store-layout change bumps DB_VERSION and
 * adds an upgrade branch here). Every write is a single IndexedDB transaction:
 * a mid-write crash leaves the old or the new record, never corruption
 * (Hulk's crash-safety concern).
 *
 * Testability: the narrow `ProjectDb` surface is what projectStore/autosave
 * consume; `createMemoryProjectDb` is an in-memory implementation of exactly
 * that surface for unit tests, and `openProjectDb` falls back to it when the
 * real DB cannot open (iOS Safari private mode, RES-6 watch item).
 */

import { openDB as idbOpen, type DBSchema, type IDBPDatabase } from "idb";
import { SCHEMA_VERSION } from "../document/schema";
import type { ProjectDocument } from "../document/schema";

/** The persisted envelope (RES-6): canonical JSON, never structured clone. */
export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly updatedAt: number;
  /** Crash-draft marker: true while unsaved edits exist that were never flushed. */
  dirty: boolean;
  /** Canonical codec output — the only form `json` ever takes. */
  readonly json: string;
}

export interface ProjectMeta {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: number;
  readonly dirty: boolean;
}

export const DB_NAME = "bitbounce";
export const DB_VERSION = 1;
export const PROJECTS_STORE = "projects";

interface BitbounceDb extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
    indexes: { "by-updated": number };
  };
}

/** The narrow database surface the persistence layer consumes. */
export interface ProjectDb {
  getRecord(id: string): Promise<ProjectRecord | undefined>;
  putRecord(record: ProjectRecord): Promise<void>;
  allRecords(): Promise<ProjectRecord[]>;
  deleteRecord(id: string): Promise<void>;
}

export function recordMeta(record: ProjectRecord): ProjectMeta {
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, dirty: record.dirty };
}

/** The id the boot flow uses when no project exists yet (MF-2 wiring). */
export const BOOT_PROJECT_ID = "default";

// ---------------------------------------------------------------------------
// Real IndexedDB implementation
// ---------------------------------------------------------------------------

function toProjectDb(db: IDBPDatabase<BitbounceDb>): ProjectDb {
  return {
    async getRecord(id) {
      return (await db.get(PROJECTS_STORE, id)) as ProjectRecord | undefined;
    },
    async putRecord(record) {
      await db.put(PROJECTS_STORE, record);
    },
    async allRecords() {
      return (await db.getAll(PROJECTS_STORE)) as ProjectRecord[];
    },
    async deleteRecord(id) {
      await db.delete(PROJECTS_STORE, id);
    },
  };
}

/**
 * Open (and upgrade, currently a no-op create) the projects DB. Throws only
 * on unexpected failures; callers decide the fallback. `name` overrides the
 * database name (browser tests isolate per-suite).
 */
export async function openRawProjectDb(name: string = DB_NAME): Promise<ProjectDb> {
  const db = await idbOpen<BitbounceDb>(name, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        const store = database.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        store.createIndex("by-updated", "updatedAt");
      }
      // Future store-layout migrations branch here on database.oldVersion.
    },
  });
  return toProjectDb(db);
}

/**
 * Open the projects DB with the RES-6 crash-safety fallback: if IndexedDB is
 * unavailable (private mode, quota-disabled contexts), persist to memory so
 * the session still autosaves and the app boots — data just won't survive.
 */
export async function openProjectDb(): Promise<ProjectDb> {
  try {
    return await openRawProjectDb();
  } catch (error) {
    console.warn("[persist] IndexedDB unavailable, using in-memory fallback", error);
    return createMemoryProjectDb();
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (unit tests + unavailability fallback)
// ---------------------------------------------------------------------------

export function createMemoryProjectDb(): ProjectDb {
  const rows = new Map<string, ProjectRecord>();
  return {
    async getRecord(id) {
      return rows.get(id);
    },
    async putRecord(record) {
      // Structural-clone semantics: store a copy so later mutation of the
      // caller's object never leaks into the "persisted" row.
      rows.set(record.id, { ...record });
    },
    async allRecords() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async deleteRecord(id) {
      rows.delete(id);
    },
  };
}

/** Convenience for tests + boot: an envelope from a live document. */
export function makeRecord(
  id: string,
  doc: ProjectDocument,
  json: string,
  updatedAt: number,
  dirty: boolean,
): ProjectRecord {
  return { id, name: doc.name, schemaVersion: SCHEMA_VERSION, updatedAt, dirty, json };
}
