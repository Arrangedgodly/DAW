/**
 * Boot wiring (MF-2): open the projects DB, restore the most recent project
 * (or keep the store's default when nothing was ever saved), and start the
 * autosave controller. Exposes Solid signals with the autosave status and
 * last-saved mtime for the booth-corner SaveIndicator (HU-3), the active
 * project id + listProjects metadata for the projects popover, and the
 * draft-recovery reassurance toast when the restored row was left dirty.
 */

import { createSignal } from "solid-js";
import { disableAgentAccess } from "../webmcp/access";
import { decode } from "../document/codec";
import type { ProjectDocument } from "../document/schema";
import { createDemoProject } from "../document/demoSong";
import { createBuiltInDemo, type DemoId } from "../document/builtInDemos";
import { docStore, loadDocument } from "../state/store";
import { armFirstRunNudge } from "../state/firstRun";
import { showInfo, showError } from "../state/toasts";
import { relativeTime } from "../lib/reltime";
import {
  startAutosave,
  type AutosaveController,
  type AutosaveStatus,
} from "./autosave";
import { BOOT_PROJECT_ID, type ProjectDb, type ProjectRecord, openProjectDb } from "./db";
import {
  deleteProject,
  listProjects,
  loadProject,
  mostRecentProject,
  type ProjectMeta,
} from "./projectStore";
import { createNewProject } from "./newProject";
import {
  exportQuarantinedBytes,
  quarantineProjectRecord,
  type QuarantineResult,
} from "./quarantine";

const [status, setStatus] = createSignal<AutosaveStatus>("idle");
const [builtInDemo, setBuiltInDemo] = createSignal(false);
export { builtInDemo };
// HU-3: mtime of the last persisted row (seeded from the restored record on
// boot, advanced on every successful flush) — drives "SAVED 12s AGO".
const [lastSavedAt, setLastSavedAt] = createSignal<number | null>(null);
let controller: AutosaveController | null = null;
let activeDb: ProjectDb | null = null;
let activeProjectId: string | null = null;

/** Autosave status for the saved indicator; "idle" until boot completes. */
export function autosaveStatus(): AutosaveStatus {
  return status();
}

/** Mtime of the last persisted row (null before anything was ever saved). */
export function getLastSavedAt(): number | null {
  return lastSavedAt();
}

/** Row autosave currently targets (null before boot completes). */
export function getActiveProjectId(): string | null {
  return activeProjectId;
}

/** Most-recent-first saved projects (HU-3 projects popover source). */
export async function savedProjects(): Promise<ProjectMeta[]> {
  if (!activeDb) return [];
  return listProjects(activeDb);
}

/** The running controller (diagnostics/tests); null before boot completes. */
export function getAutosaveController(): AutosaveController | null {
  return controller;
}

/** The DB handle boot opened (MF-3 import consumers); null before boot. */
export function getBootDb(): ProjectDb | null {
  return activeDb;
}

function startController(projectId: string, previewDocument?: ProjectDocument): void {
  if (!activeDb) throw new Error("startController: persistence not booted");
  activeProjectId = previewDocument ? null : projectId;
  setBuiltInDemo(!!previewDocument);
  setStatus("idle");
  if (previewDocument) setLastSavedAt(null);
  controller = startAutosave({
    db: activeDb,
    projectId,
    previewDocument,
    onPreviewEdited: () => {
      activeProjectId = projectId;
      setBuiltInDemo(false);
    },
    store: docStore,
    windowImpl: typeof window !== "undefined" ? window : undefined,
    onStatus: (next) => {
      if (next === "saved" && !builtInDemo()) {
        // The controller exists by the time any transition fires (transitions
        // are async; startAutosave assigns synchronously below) — prefer its
        // stamped flush time over wall-clock.
        setLastSavedAt(controller?.getLastSaved()?.at ?? Date.now());
      }
      setStatus(next);
    },
  });
  // Seed the indicator from the target row so a freshly switched project
  // doesn't briefly claim the previous project's last-saved time.
  void activeDb
    .getRecord(projectId)
    .then((row) => {
      if (row && activeProjectId === projectId && !builtInDemo()) setLastSavedAt(row.updatedAt);
    })
    .catch(() => undefined);
}

/**
 * Point autosave at a different project row (MF-3 import flow + HU-3 project
 * switching): flush + stop the old controller, then start a fresh one for the
 * target project. The document itself is loaded by the caller — AFTER this
 * call, so the old row can never receive the new bytes.
 */
export async function switchToProject(projectId: string, options: { requireSaved?: boolean } = {}): Promise<void> {
  if (!activeDb) throw new Error("switchToProject: persistence not booted");
  disableAgentAccess();
  await controller?.stop();
  if (options.requireSaved && controller && (controller.getStatus() === "error" || controller.isPending())) {
    // A failed final flush must keep the old project and its autosave active.
    if (activeProjectId) startController(activeProjectId);
    throw new Error("Current work could not be saved. The current project is still open.");
  }
  startController(projectId);
}

/** Preview built-in content; first document edit promotes it to an autosaved copy. */
export async function openBuiltInDemo(id: DemoId): Promise<void> {
  if (!activeDb) throw new Error("Persistence is not ready");
  disableAgentAccess();
  await controller?.stop();
  if (controller && (controller.getStatus() === "error" || controller.isPending())) {
    if (activeProjectId) startController(activeProjectId);
    throw new Error("Current work could not be saved");
  }
  const doc = createBuiltInDemo(id);
  loadDocument(doc);
  startController(crypto.randomUUID(), doc);
}

/** What a completed delete hands the UI (i6 §3): the held row is the UNDO payload. */
export interface DeletedProject {
  /** The exact pre-delete record — S-3's UNDO re-puts these bytes verbatim. */
  readonly held: ProjectRecord;
  /** True when the doomed row was the one autosave was writing (succession ran). */
  readonly wasActive: boolean;
  /** When wasActive: the row the app switched to before deleting (null otherwise). */
  readonly successorId: string | null;
}

/**
 * Delete one saved project, safe even when it is the row being worked in
 * (i6 §3.2/§3.3 — the S-2 orchestration S-3's delete button calls).
 *
 * Active row — the succession sequence, in the ONLY safe order:
 *   1. HOLD the record (the UNDO payload). Missing row → null, nothing done.
 *   2. PICK the successor: the most-recent REMAINING row (`mostRecentProject`
 *      excluding the doomed id — picked BEFORE the delete, while the doomed
 *      row still exists), else a fresh NEW project (the app never boots into
 *      zero rows).
 *   3. RETARGET FIRST: decode the successor, `await switchToProject`
 *      (stop() = final flush of the CURRENT doc into the doomed row, then
 *      every writer disarmed: debounce, 30 s interval, pagehide listeners),
 *      then `loadDocument`. After the switch returns, NO writer exists for
 *      the doomed id — a pending debounced flush can never resurrect it.
 *   4. THEN `deleteProject`.
 *
 * Inactive row — the plain path: the active controller only ever writes
 * `activeProjectId`, so no retarget is needed; hold → delete. The working
 * song is untouched.
 */
export async function deleteProjectSafe(
  id: string,
): Promise<DeletedProject | null> {
  if (!activeDb) throw new Error("deleteProjectSafe: persistence not booted");
  const db = activeDb;

  // 1. HOLD (the missing-row gate; the UNDO payload for the inactive path).
  const early = await db.getRecord(id);
  if (!early) return null;

  if (id !== activeProjectId) {
    await deleteProject(db, id);
    return { held: early, wasActive: false, successorId: null };
  }

  // 2. PICK the successor (excluding the doomed row — it still exists here).
  const remaining = await mostRecentProject(db, { exclude: id });
  let successorId: string;
  let successorDoc: ProjectDocument;
  if (remaining) {
    successorId = remaining.id;
    successorDoc = await loadProject(db, remaining.id);
  } else {
    const fresh = await createNewProject(db);
    successorId = fresh.record.id;
    successorDoc = fresh.doc;
  }

  // 3. RETARGET FIRST (the ordering law): stop() flushes the doomed row one
  //    last time with the CURRENT doc — any just-committed rename included —
  //    and disarms every writer; only then does the new doc land.
  await switchToProject(successorId);

  // Re-fill the hold AFTER the final flush has settled (stop() awaited the
  // whole writeChain): the row now carries every committed edit, so UNDO
  // restores the complete song — a slip cannot cost work (Projects.tsx law).
  const held = (await db.getRecord(id)) ?? early;
  loadDocument(successorDoc);

  // 4. THEN delete — no writer remains that could resurrect the row.
  await deleteProject(db, id);
  return { held, wasActive: true, successorId };
}

export interface BootResult {
  readonly db: ProjectDb;
  readonly projectId: string;
  readonly restored: boolean;
  readonly controller: AutosaveController;
  /** Set when the most-recent row failed codec validation and was quarantined. */
  readonly quarantined?: QuarantineResult;
}

/** Options: `db` injects a pre-opened handle (browser tests isolate DB names). */
export async function initPersistence(
  opts: { db?: ProjectDb; newId?: () => string; now?: () => number } = {},
): Promise<BootResult> {
  const db = opts.db ?? (await openProjectDb());
  activeDb = db;
  const recent = await mostRecentProject(db);
  let projectId = BOOT_PROJECT_ID;
  let restored = false;
  let previewDocument: ProjectDocument | undefined;
  let quarantined: QuarantineResult | undefined;
  if (recent) {
    try {
      loadDocument(decode(recent.json));
      projectId = recent.id;
      restored = true;
      setLastSavedAt(recent.updatedAt);
      if (recent.dirty) {
        // HU-3 draft-recovery reassurance: the row IS the draft — nothing to
        // restore. Say so once, with when the last change survived, so a
        // crash doesn't feel like data loss. Info toasts carry a DISMISS and
        // auto-dismiss; a clean row stays silent.
        showInfo(
          `RECOVERED UNSAVED WORK — last change ${relativeTime(recent.updatedAt, Date.now())}`,
          {
            suggestion:
              "Your edits survived the crash. Autosave kept this project.",
          },
        );
        // The draft HAS been recovered — clear the stale flag so a later boot
        // (where the user touches nothing) doesn't re-announce it. Content
        // bytes unchanged; metadata-only write.
        await db.putRecord({ ...recent, dirty: false });
      }
    } catch (error) {
      // Corrupt/future-version row (HU-2): quarantine (rename, never delete),
      // continue with a FRESH default project, and surface a sticky error
      // toast whose RECOVER action downloads the original raw bytes.
      console.warn(
        "[persist] stored project failed validation; quarantining",
        error,
      );
      quarantined = await quarantineProjectRecord(db, recent, {
        now: opts.now,
      });
      const fresh = await createNewProject(db, {
        newId: opts.newId,
        now: opts.now,
      });
      projectId = fresh.record.id;
      loadDocument(fresh.doc);
      showError(
        `Saved project "${recent.name}" was damaged and could not be loaded.`,
        {
          suggestion:
            "A fresh project was started instead. The damaged data was kept.",
          action: {
            label: "RECOVER",
            run: () => {
              exportQuarantinedBytes(quarantined!);
            },
          },
        },
      );
    }
  } else {
    // First boot (PX-1): the WELCOME SONG demo — a real, fully editable
    // project that teaches by example. It remains a preview until edited;
    // NEW still creates the empty saved default (newProject.ts).
    const demo = createDemoProject();
    loadDocument(demo);
    previewDocument = demo;
    armFirstRunNudge();
  }
  startController(projectId, previewDocument);
  // Narrow for the result type (startController always assigns synchronously).
  const started = controller as AutosaveController;
  return {
    db,
    projectId,
    restored,
    controller: started,
    ...(quarantined ? { quarantined } : {}),
  };
}
