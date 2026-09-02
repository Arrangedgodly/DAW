/**
 * FileIO (MF-3 + HU-2) — booth-corner project buttons: SAVE FILE exports the
 * current document's canonical bytes; OPEN FILE imports a .bitbounce.json
 * through the codec into a NEW project (never clobbers the working one);
 * NEW starts a fresh default project (HU-2 empty-project flow) via the same
 * no-clobber + autosave-retarget ordering as import.
 *
 * Failures now push onto the shared toast bus (src/state/toasts.ts) rendered
 * by the App shell's <Toasts/>: sticky role=alert errors with the typed
 * message + recovery suggestion + first issues, keyboard dismissible.
 */

import { createSignal } from "solid-js";
import { docStore, loadDocument } from "../state/store";
import { exportProjectFile, importProjectFile } from "../persist/fileIO";
import { getBootDb, switchToProject } from "../persist/boot";
import { createNewProject } from "../persist/newProject";
import { showInfo, showError, showSuccess } from "../state/toasts";
import "../styles/file-io.css";

export default function FileIO() {
  const [busy, setBusy] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const handleSave = () => {
    // Never throws: export is a pure encode + programmatic download.
    exportProjectFile(docStore.getState().doc);
  };

  const handleNew = async () => {
    const db = getBootDb();
    if (!db) return; // persistence not booted — nothing to switch
    setBusy(true);
    try {
      const { record, doc } = await createNewProject(db);
      // Same ordering law as import: retarget autosave BEFORE the new
      // document lands, so the old row can never receive the new bytes.
      await switchToProject(record.id);
      loadDocument(doc);
      showSuccess("NEW PROJECT READY", {
        suggestion: "Pick a preset, paint the grid.",
      });
    } catch {
      showError("Could not start a new project.", {
        suggestion: "Your current project is untouched — try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    const db = getBootDb();
    if (!db) return; // persistence not booted — nothing to import into
    setBusy(true);
    try {
      const result = await importProjectFile(file, db);
      if (result.ok) {
        // Order matters: retarget autosave BEFORE the new document lands in
        // the store, so the old controller's final flush cannot write the
        // imported doc into the old project's row.
        await switchToProject(result.record.id);
        loadDocument(result.doc);
        showInfo(`OPENED "${result.doc.name}"`);
      } else {
        showError(result.message, {
          suggestion: result.suggestion,
          details: result.issues,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="file-io" role="group" aria-label="Project file">
      <button
        type="button"
        class="booth-btn file-io-btn"
        onClick={handleSave}
        disabled={busy()}
      >
        SAVE FILE
      </button>
      <button
        type="button"
        class="booth-btn file-io-btn"
        disabled={busy()}
        onClick={() => fileInput?.click()}
      >
        OPEN FILE
      </button>
      <button
        type="button"
        class="booth-btn file-io-btn"
        disabled={busy()}
        onClick={() => void handleNew()}
      >
        NEW
      </button>
      <input
        ref={(el) => {
          fileInput = el;
        }}
        class="file-io-input"
        type="file"
        accept="application/json,.json,.bitbounce.json"
        aria-hidden="true"
        tabindex="-1"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ""; // allow re-selecting the same file
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
