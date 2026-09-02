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
import { startAutosave, type AutosaveController, type AutosaveStatus } from "./autosave";
import { BOOT_PROJECT_ID, type ProjectDb, openProjectDb } from "./db";
import { mostRecentProject, saveProject } from "./projectStore";

const [status, setStatus] = createSignal<AutosaveStatus>("idle");
let controller: AutosaveController | null = null;

/** Autosave status for the saved indicator; "idle" until boot finishes. */
export function autosaveStatus(): AutosaveStatus {
  return status();
}

/** The running controller (diagnostics/tests); null before boot completes. */
export function getAutosaveController(): AutosaveController | null {
  return controller;
}

export interface BootResult {
  readonly db: ProjectDb;
  readonly projectId: string;
  readonly restored: boolean;
  readonly controller: AutosaveController;
}

/** Options: `db` injects a pre-opened handle (browser tests isolate DB names). */
export async function initPersistence(
  opts: { db?: ProjectDb } = {},
): Promise<BootResult> {
  const db = opts.db ?? (await openProjectDb());
  const recent = await mostRecentProject(db);
  let projectId = BOOT_PROJECT_ID;
  let restored = false;
  if (recent) {
    projectId = recent.id;
    loadDocument(decode(recent.json)); // throws surface to HU-2 failure states later
    restored = true;
  } else {
    // First boot: persist the default document so the row exists and the
    // saved indicator starts from a truthful "saved".
    await saveProject(db, projectId, docStore.getState().doc);
  }
  controller = startAutosave({
    db,
    projectId,
    store: docStore,
    windowImpl: typeof window !== "undefined" ? window : undefined,
    onStatus: setStatus,
  });
  return { db, projectId, restored, controller };
}
