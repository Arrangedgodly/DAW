/**
 * Boot wiring (MF-2): open the projects DB, restore the most recent project
 * (or keep the store's default when nothing was ever saved), and start the
 * autosave controller. Exposes a Solid signal with the autosave status for
 * the booth-corner "saved" indicator (SaveIndicator.tsx). No project-list UI
 * yet — one implicit working project per install is the MF-2 scope.
 */

import { createSignal } from "solid-js";
import { decode } from "../document/codec";
import { docStore, loadDocument } from "../state/store";
import { showError } from "../state/toasts";
import { startAutosave, type AutosaveController, type AutosaveStatus } from "./autosave";
import { BOOT_PROJECT_ID, type ProjectDb, openProjectDb } from "./db";
import { mostRecentProject, saveProject } from "./projectStore";
import { createNewProject } from "./newProject";
import {
  exportQuarantinedBytes,
  quarantineProjectRecord,
  type QuarantineResult,
} from "./quarantine";

const [status, setStatus] = createSignal<AutosaveStatus>("idle");
let controller: AutosaveController | null = null;
let activeDb: ProjectDb | null = null;

/** Autosave status for the saved indicator; "idle" until boot completes. */
export function autosaveStatus(): AutosaveStatus {
  return status();
}

/** The running controller (diagnostics/tests); null before boot completes. */
export function getAutosaveController(): AutosaveController | null {
  return controller;
}

/** The DB handle boot opened (MF-3 import consumers); null before boot. */
export function getBootDb(): ProjectDb | null {
  return activeDb;
}

/**
 * Point autosave at a different project row (MF-3 import flow): flush + stop
 * the old controller, then start a fresh one for the imported project so it
 * starts autosaving immediately. The document itself is loaded by the caller.
 */
export async function switchToProject(projectId: string): Promise<void> {
  if (!activeDb) throw new Error("switchToProject: persistence not booted");
  await controller?.stop();
  controller = startAutosave({
    db: activeDb,
    projectId,
    store: docStore,
    windowImpl: typeof window !== "undefined" ? window : undefined,
    onStatus: setStatus,
  });
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
  let quarantined: QuarantineResult | undefined;
  if (recent) {
    try {
      loadDocument(decode(recent.json));
      projectId = recent.id;
      restored = true;
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
    // First boot: persist the default document so the row exists and the
    // saved indicator starts from a truthful "saved".
    await saveProject(db, projectId, docStore.getState().doc, { now: opts.now?.() });
  }
  controller = startAutosave({
    db,
    projectId,
    store: docStore,
    windowImpl: typeof window !== "undefined" ? window : undefined,
    onStatus: setStatus,
  });
  return { db, projectId, restored, controller, ...(quarantined ? { quarantined } : {}) };
}
