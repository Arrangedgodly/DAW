/**
 * Projects (HU-3, absorbing MF-3's FileIO): one booth-corner "PROJECTS" button
 * opening a popover with every saved project (name + relative time, from
 * listProjects metadata) plus NEW / EXPORT WAV / SAVE FILE / OPEN FILE — the
 * former booth buttons relocated here so the booth stays uncluttered (TE-style).
 *
 * Opening a project follows the ONE ordering law shared with import and NEW:
 * `switchToProject` (flush + stop the old autosave controller, start the new
 * one) BEFORE `loadDocument` — the old row can never receive the new bytes.
 * A corrupt row fails decode inside loadProject and shows an error toast;
 * the working project is untouched.
 *
 * Deliberately NO delete UI (Hulk): deletion is destructive and unrecoverable
 * in a local-first app with no backend — a slip cannot cost work. Rows can
 * always be removed via dev tools; removal UX, if ever wanted, belongs behind
 * an undoable, deliberately slow confirmation of its own.
 *
 * Keyboard contract (same as ScalePopover): Esc closes, Tab is trapped while
 * open, focus lands on the first item on open and returns to the button.
 */

import { For, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { docStore, loadDocument } from "../state/store";
import { exportProjectFile, importProjectFile } from "../persist/fileIO";
// TH-2 code-splitting: the export pipelines (offline render + WAV encoder,
// MIDI encoder + midi-file framing) are loaded ON DEMAND via dynamic import
// — the initial bundle never pays for them (CI gate: check:bundle). Both
// modules are pure/typed-result, so a load failure surfaces as the same
// error toast shape as any export failure.
import {
  getActiveProjectId,
  getBootDb,
  savedProjects,
  switchToProject,
} from "../persist/boot";
import { createNewProject } from "../persist/newProject";
import { loadProject, type ProjectMeta } from "../persist/projectStore";
import { showInfo, showError, showSuccess } from "../state/toasts";
import { relativeTime } from "../lib/reltime";
import "../styles/projects.css";

export default function Projects(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [items, setItems] = createSignal<readonly ProjectMeta[]>([]);
  let anchorBtn: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  const refresh = () => {
    void savedProjects().then((list) => {
      // Most-recent-first; skip rows mid-quarantine naming is irrelevant here
      // (quarantined rows are normal rows the user may still export via RECOVER).
      setItems(list);
    });
  };

  onMount(() => {
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open()) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onDocKeydown, true);
    onCleanup(() =>
      document.removeEventListener("keydown", onDocKeydown, true),
    );
  });

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = focusables();
    if (focusable.length === 0) return;
    e.preventDefault();
    const idx = focusable.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey
      ? focusable[(idx - 1 + focusable.length) % focusable.length]
      : focusable[(idx + 1) % focusable.length];
    next.focus();
  };

  function close(): void {
    setOpen(false);
    anchorBtn?.focus();
  }

  const toggle = () => {
    const next = !open();
    if (next) {
      refresh();
      setOpen(true);
      // Focus the first control once the panel exists.
      queueMicrotask(() => focusables()[0]?.focus());
    } else {
      setOpen(false);
    }
  };

  const handleOpenProject = async (meta: ProjectMeta) => {
    const db = getBootDb();
    if (!db || busy()) return;
    if (meta.id === getActiveProjectId()) {
      close();
      return; // already working in it — a no-op, not a reload
    }
    setBusy(true);
    try {
      const doc = await loadProject(db, meta.id); // decode throws on bad rows
      await switchToProject(meta.id); // flush+retarget BEFORE the doc lands
      loadDocument(doc);
      showInfo(`OPENED "${doc.name}"`);
      close();
    } catch {
      showError(`Could not open "${meta.name}".`, {
        suggestion:
          "Your current project is untouched — the row may be damaged.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleNew = async () => {
    const db = getBootDb();
    if (!db) return;
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
      close();
    } catch {
      showError("Could not start a new project.", {
        suggestion: "Your current project is untouched — try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    // Never throws: export is a pure encode + programmatic download.
    exportProjectFile(docStore.getState().doc);
  };

  /**
   * WAV export (MF-4): offline render (own OfflineAudioContext — playback is
   * untouched even while playing) → loop-tight stereo file download. Typed
   * result → success or error toast; busy flag keeps the action one-shot.
   */
  const handleExportWav = async () => {
    if (busy()) return;
    setBusy(true);
    showInfo("RENDERING WAV…");
    try {
      const { exportWav } = await import("../audio/exportWav");
      const result = await exportWav(docStore.getState().doc);
      if (result.ok) {
        showSuccess(
          `WAV EXPORTED · ${result.bars} BAR${result.bars === 1 ? "" : "S"}`,
        );
      } else {
        showError(result.message, { suggestion: result.suggestion });
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * MIDI export (MF-5): pure synchronous encode → typed result → download.
   * Same one-shot busy flag as WAV so the two exports can't interleave.
   */
  const handleExportMidi = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const { exportMidi } = await import("../audio/exportMidi");
      const result = exportMidi(docStore.getState().doc);
      if (result.ok) {
        showSuccess(
          `MIDI EXPORTED \u00b7 ${result.trackCount} TRACKS \u00b7 ${result.noteCount} NOTES`,
        );
      } else {
        showError(result.message, { suggestion: result.suggestion });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    const db = getBootDb();
    if (!db) return;
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
        close();
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
    <div class="projects" role="group" aria-label="Projects">
      <button
        type="button"
        ref={(el) => {
          anchorBtn = el;
        }}
        class="booth-btn projects-btn"
        aria-haspopup="dialog"
        aria-expanded={open()}
        disabled={busy()}
        onClick={toggle}
      >
        PROJECTS
      </button>
      {open() && (
        <div
          ref={(el) => {
            panel = el;
          }}
          class="projects-pop"
          role="dialog"
          aria-label="Projects"
          onKeyDown={handleKeydown}
        >
          <ul class="projects-list" aria-label="Saved projects">
            <For each={items()}>
              {(meta) => (
                <li>
                  <button
                    type="button"
                    class="projects-item"
                    classList={{
                      "is-current": meta.id === getActiveProjectId(),
                    }}
                    aria-current={
                      meta.id === getActiveProjectId() ? "true" : undefined
                    }
                    disabled={busy()}
                    onClick={() => void handleOpenProject(meta)}
                  >
                    <span class="projects-name">{meta.name}</span>
                    <span class="projects-when">
                      {meta.dirty
                        ? "unsaved"
                        : relativeTime(meta.updatedAt, Date.now())}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <div class="projects-actions">
            <button
              type="button"
              class="booth-btn projects-action"
              disabled={busy()}
              onClick={() => void handleNew()}
            >
              NEW
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              disabled={busy()}
              onClick={() => void handleExportWav()}
            >
              EXPORT WAV
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              disabled={busy()}
              onClick={() => void handleExportMidi()}
            >
              EXPORT MIDI
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              onClick={handleSave}
            >
              SAVE FILE
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              disabled={busy()}
              onClick={() => fileInput?.click()}
            >
              OPEN FILE
            </button>
          </div>
          {/* R3 (DES-7): the MIDI-limitation note, in-world silkscreen copy —
              GM programs are hint-only, so the same file sounds different in
              any other DAW's instruments. Lives with the button it qualifies. */}
          <p class="projects-note">
            MIDI CARRIES NOTES + CUES, NOT THIS SYNTH — SOUNDS VARY IN OTHER
            DAWS
          </p>
        </div>
      )}
      <input
        ref={(el) => {
          fileInput = el;
        }}
        class="projects-input"
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
