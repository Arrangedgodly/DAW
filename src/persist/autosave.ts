/**
 * Autosave controller (MF-2, RES-6): subscribes to document-store commits and
 * persists through projectStore with a content-hash dirty check — a commit
 * whose canonical hash equals the last SAVED hash never touches IndexedDB
 * (undo back to the saved state is a no-op write).
 *
 * Cadence: ~800 ms trailing debounce after a change, a 30 s interval flush for
 * anything still pending, and a synchronous best-effort flush on
 * visibilitychange→hidden / pagehide. Crash-safety: the autosaved row IS the
 * crash-recovery draft — while edits are pending, the row carries `dirty: true`
 * (metadata-only write) so a later boot (HU-3) can offer recovery; a successful
 * flush writes the full record with `dirty: false`.
 *
 * Framework-free and DB-injected: unit tests drive a fake store seam and the
 * in-memory ProjectDb with fake timers; the app layer (boot.ts) supplies the
 * real docStore, IndexedDB handle, and window.
 */

import { contentHash, encode } from "../document/codec";
import type { ProjectDocument } from "../document/schema";
import type { ProjectDb } from "./db";
import { makeRecord } from "./db";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/** The narrow store seam (zustand/vanilla docStore satisfies this). */
export interface DocStoreLike {
  subscribe(
    listener: (
      state: { doc: ProjectDocument },
      prev: { doc: ProjectDocument },
    ) => void,
  ): () => void;
  getState(): { doc: ProjectDocument };
}

export interface AutosaveOptions {
  /** Unsaved built-in content: do not create a row until it is edited. */
  readonly previewDocument?: ProjectDocument;
  readonly onPreviewEdited?: () => void;
  readonly db: ProjectDb;
  readonly projectId: string;
  /** Trailing debounce after a change (default 800 ms). */
  readonly debounceMs?: number;
  /** Interval flush while changes stay pending (default 30 s). */
  readonly intervalMs?: number;
  readonly store?: DocStoreLike;
  /** Window-like event target for flush-on-hide; omit in tests. */
  readonly windowImpl?: Pick<
    Window,
    "addEventListener" | "removeEventListener"
  >;
  readonly onStatus?: (status: AutosaveStatus) => void;
  /** Clock for `updatedAt` stamps (tests). */
  readonly now?: () => number;
}

export interface LastSavedInfo {
  readonly at: number;
  readonly hash: string;
}

export interface AutosaveController {
  /** Best-effort immediate persist of pending changes (also clears timers). */
  flush(): Promise<void>;
  /** Unsubscribe + clear all timers/listeners. Implicitly flushes. */
  stop(): Promise<void>;
  getStatus(): AutosaveStatus;
  /** True while committed edits have not been flushed to disk. */
  isPending(): boolean;
  /** Last successful flush (null before the first save). */
  getLastSaved(): LastSavedInfo | null;
  /** Test/diagnostics: hash of the current store document. */
  currentHash(): string;
}

const DEFAULT_DEBOUNCE_MS = 800;
const DEFAULT_INTERVAL_MS = 30_000;

export function startAutosave(opts: AutosaveOptions): AutosaveController {
  const { db, projectId } = opts;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = opts.now ?? (() => Date.now());
  const store = opts.store ?? null;

  let status: AutosaveStatus = "idle";
  let savedHash: string | null = opts.previewDocument ? contentHash(opts.previewDocument) : null;
  let preview = opts.previewDocument !== undefined;
  let lastSaved: LastSavedInfo | null = null;
  let pending = false; // committed-but-unflushed edits exist
  let dirtyMarked = false; // row currently carries dirty:true
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  // All writes serialized through one chain so a dirty-mark can never land
  // after the flush that supersedes it (order-preserving even under await).
  let writeChain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(write: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(write, write);
    writeChain = next.catch(() => undefined);
    return next;
  };

  function setStatus(next: AutosaveStatus): void {
    if (next === status) return;
    status = next;
    opts.onStatus?.(status);
  }

  function currentHash(): string {
    if (!store) return "";
    return contentHash(store.getState().doc);
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  /** Metadata-only write flagging the row as a crash draft. */
  function markDirty(): void {
    if (dirtyMarked) return;
    dirtyMarked = true;
    enqueue(async () => {
      const doc = store!.getState().doc;
      const existing = await db.getRecord(projectId);
      // Keep the last SAVED json; only the flag and mtime move.
      const record =
        existing ?? makeRecord(projectId, doc, encode(doc), now(), true);
      await db.putRecord({ ...record, dirty: true, updatedAt: now() });
    }).catch(() => undefined);
  }

  /** Metadata-only write clearing the crash-draft flag (content unchanged). */
  function clearDirtyMark(): Promise<void> {
    if (!dirtyMarked) return Promise.resolve();
    dirtyMarked = false;
    return enqueue(async () => {
      const existing = await db.getRecord(projectId);
      if (existing?.dirty) {
        await db.putRecord({ ...existing, dirty: false, updatedAt: now() });
      }
    });
  }

  async function flush(): Promise<void> {
    clearDebounce();
    if (!store) return;
    const doc = store.getState().doc;
    const hash = contentHash(doc);
    if (hash === savedHash) {
      // Hash-skip: nothing to write — a stale dirty mark still clears.
      await clearDirtyMark().catch(() => undefined);
      pending = false;
      setStatus("saved");
      return;
    }
    setStatus("saving");
    try {
      await enqueue(async () => {
        await db.putRecord(
          makeRecord(projectId, doc, encode(doc), now(), false),
        );
      });
      savedHash = hash;
      lastSaved = { at: now(), hash };
      dirtyMarked = false;
      pending = false;
      setStatus("saved");
    } catch (error) {
      // Hulk: never lose the pending state on a failed write — the interval
      // and the next commit both retry.
      pending = true;
      setStatus("error");
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  function onCommit(
    state: { doc: ProjectDocument },
    prev: { doc: ProjectDocument },
  ): void {
    if (state.doc === prev.doc) return;
    const hash = contentHash(state.doc);
    if (hash === savedHash) {
      // Back to the saved state (e.g. undo): nothing to persist, the pending
      // debounce is pointless, and any crash-draft mark is stale.
      clearDebounce();
      void clearDirtyMark().catch(() => undefined);
      pending = false;
      setStatus("saved");
      return;
    }
    pending = true;
    if (preview) {
      preview = false;
      // The baseline was never saved. Even an immediate undo must persist
      // the resulting document once this preview has become a local copy.
      savedHash = null;
      opts.onPreviewEdited?.();
    }
    setStatus("dirty");
    markDirty();
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flush().catch(() => undefined);
    }, debounceMs);
  }

  const unsubscribe = store?.subscribe(onCommit) ?? null;

  // Seed the hash baseline from the existing row (a restored project): undo
  // back to the last PERSISTED state is a no-op write even before the first
  // flush of this session. If commits raced ahead of the seed, reconcile.
  if (store) {
    void db
      .getRecord(projectId)
      .then((existing) => {
        if (!existing || savedHash !== null) return;
        savedHash = contentHash(JSON.parse(existing.json) as ProjectDocument);
        if (pending && currentHash() === savedHash) {
          clearDebounce();
          pending = false;
          setStatus("saved");
        }
      })
      .catch(() => undefined);
  }

  if (intervalMs > 0) {
    intervalTimer = setInterval(() => {
      if (pending) void flush().catch(() => undefined);
    }, intervalMs);
  }

  const onHidden = () => {
    if (pending) void flush().catch(() => undefined);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") onHidden();
  };
  opts.windowImpl?.addEventListener("visibilitychange", onVisibilityChange);
  opts.windowImpl?.addEventListener("pagehide", onHidden);

  async function stop(): Promise<void> {
    clearDebounce();
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    unsubscribe?.();
    opts.windowImpl?.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
    opts.windowImpl?.removeEventListener("pagehide", onHidden);
    if (pending) await flush().catch(() => undefined);
  }

  return {
    flush,
    stop,
    getStatus: () => status,
    isPending: () => pending,
    getLastSaved: () => lastSaved,
    currentHash,
  };
}
