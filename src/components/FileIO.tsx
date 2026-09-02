/**
 * FileIO — booth-corner project file buttons (MF-3): SAVE FILE exports the
 * current document's canonical bytes; OPEN FILE imports a .bitbounce.json
 * through the codec into a NEW project (never clobbers the working one).
 *
 * Failure UX seed (HU-2 will generalize): a dismissible role=alert toast with
 * the typed message + recovery suggestion. Keyboard operable end to end —
 * OPEN FILE is a real <button> that forwards to a visually-hidden file input,
 * and the toast's dismiss is a focused real button.
 */

import { createSignal } from "solid-js";
import { docStore, loadDocument } from "../state/store";
import { exportProjectFile, importProjectFile, type ImportFailure } from "../persist/fileIO";
import { getBootDb, switchToProject } from "../persist/boot";
import "../styles/file-io.css";

interface ToastState {
  readonly message: string;
  readonly suggestion: string;
  readonly issues?: readonly string[];
}

export default function FileIO() {
  const [toast, setToast] = createSignal<ToastState | null>(null);
  const [busy, setBusy] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const handleSave = () => {
    // Never throws: export is a pure encode + programmatic download.
    exportProjectFile(docStore.getState().doc);
  };

  const handleFile = async (file: File) => {
    const db = getBootDb();
    if (!db) return; // persistence not booted — nothing to import into
    setBusy(true);
    try {
      const result = await importProjectFile(file, db);
      if (result.ok) {
        setToast(null);
        // Order matters: retarget autosave BEFORE the new document lands in
        // the store, so the old controller's final flush cannot write the
        // imported doc into the old project's row.
        await switchToProject(result.record.id);
        loadDocument(result.doc);
      } else {
        setToast(toastState(result));
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
      {toast() && (
        <div class="file-io-toast" role="alert" aria-label="Project file error">
          <div class="file-io-toast-body">
            <p class="file-io-toast-message">{toast()!.message}</p>
            {toast()!.issues && toast()!.issues!.length > 0 && (
              <ul class="file-io-toast-issues">
                {toast()!.issues!.slice(0, 3).map((issue) => (
                  <li>{issue}</li>
                ))}
              </ul>
            )}
            <p class="file-io-toast-suggestion">{toast()!.suggestion}</p>
          </div>
          <button
            type="button"
            class="file-io-dismiss"
            aria-label="Dismiss error"
            onClick={() => setToast(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function toastState(failure: ImportFailure): ToastState {
  return { message: failure.message, suggestion: failure.suggestion, issues: failure.issues };
}
