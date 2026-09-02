/**
 * Boot wiring (MF-2): open the projects DB, restore the most recent project
 * (or keep the store's default when nothing was ever saved), and start the
 * autosave controller. Exposes Solid signals with the autosave status and
 * last-saved mtime for the booth-corner SaveIndicator (HU-3), the active
 * project id + listProjects metadata for the projects popover, and the
 * draft-recovery reassurance toast when the restored row was left dirty.
 */

import { createSignal } from "solid-js";
import { decode } from "../document/codec";
import { createDemoProject } from "../document/demoSong";
import { docStore, loadDocument } from "../state/store";
import { armFirstRunNudge } from "../state/firstRun";
import { showInfo, showError } from "../state/toasts";
import { relativeTime } from "../lib/reltime";
import { startAutosave, type AutosaveController, type AutosaveStatus } from "./autosave";
import { BOOT_PROJECT_ID, type ProjectDb, openProjectDb } from "./db";
import { listProjects, mostRecentProject, saveProject, type ProjectMeta } from "./projectStore";
import { createNewProject } from "./newProject";
import {
  exportQuarantinedBytes,
  quarantineProjectRecord,
  type QuarantineResult,
} from "./quarantine";

const [status, setStatus] = createSignal<AutosaveStatus>("idle");
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

function startController(projectId: string): void {
  if (!activeDb) throw new Error("startController: persistence not booted");
  activeProjectId = projectId;
  controller = startAutosave({
    db: activeDb,
    projectId,
    store: docStore,
    windowImpl: typeof window !== "undefined" ? window : undefined,
    onStatus: (next) => {
      if (next === "saved") {
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
      if (row && controller !== null) setLastSavedAt(row.updatedAt);
    })
    .catch(() => undefined);
}

/**
 * Point autosave at a different project row (MF-3 import flow + HU-3 project
 * switching): flush + stop the old controller, then start a fresh one for the
 * target project. The document itself is loaded by the caller — AFTER this
 * call, so the old row can never receive the new bytes.
 */
export async function switchToProject(projectId: string): Promise<void> {
  if (!activeDb) throw new Error("switchToProject: persistence not booted");
  await controller?.stop();
  startController(projectId);
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
): Promise<BootResult> {  const db = opts.db ?? (await openProjectDb());
  activeDb = db;
  const recent = await mostRecentProject(db);
  let projectId = BOOT_PROJECT_ID;
  let restored = false;
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
            suggestion: "Your edits survived the crash. Autosave kept this project.",
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
      console.warn("[persist] stored project failed validation; quarantining", error);
      quarantined = await quarantineProjectRecord(db, recent, { now: opts.now });
      const fresh = await createNewProject(db, { newId: opts.newId, now: opts.now });
      projectId = fresh.record.id;
      loadDocument(fresh.doc);
      showError(
        `Saved project "${recent.name}" was damaged and could not be loaded.`,
        {
          suggestion: "A fresh project was started instead. The damaged data was kept.",
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
    // project (autosaves, exports) that teaches by example. NEW still creates
    // the empty default (newProject.ts). Persist immediately so the row
    // exists and the saved indicator starts from a truthful "saved".
    const demo = createDemoProject();
    loadDocument(demo);
    const now = opts.now?.() ?? Date.now();
    await saveProject(db, projectId, demo, { now });
    setLastSavedAt(now);
    armFirstRunNudge();
  }
  startController(projectId);
  // Narrow for the result type (startController always assigns synchronously).
  const started = controller as AutosaveController;
  return { db, projectId, restored, controller: started, ...(quarantined ? { quarantined } : {}) };
}
