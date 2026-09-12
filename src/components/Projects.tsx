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
 * Rename + delete (i6, honoring the recorded Hulk law at the old "NO delete
 * UI" comment): every saved row grows always-visible RENAME + DELETE controls.
 * RENAME swaps the row into the InlineEdit twin (Enter commits, Escape
 * cancels, blur commits — the shared normalizer is the authority); the
 * CURRENT row commits through the store's setProjectName, every other row
 * through renameProjectRecord, which never touches the working doc. DELETE
 * arms the deliberately slow two-step confirm — the row's content becomes a
 * danger-styled CONFIRM DELETE until a second press, with Escape,
 * click-away, or a 5 s auto-revert standing it down — and the completed
 * delete raises a sticky DELETED toast whose one-shot UNDO re-puts the exact
 * held record (undoable + deliberate, both halves of the law). Deleting the
 * row being worked in runs deleteProjectSafe: retarget autosave to the
 * successor BEFORE the row is removed — the same ordering law as
 * open/NEW/import, so a pending flush can never resurrect the deleted row.
 *
 * Keyboard contract (same as ScalePopover): Esc closes, Tab is trapped while
 * open, focus lands on the first item on open and returns to the button.
 * Two i6 extensions the popover owes its new states: while a rename editor
 * or a delete confirm is open, the document-level CAPTURE-phase Esc close is
 * gated (Esc cancels THAT state only — a target-phase stopPropagation cannot
 * reach a capture-phase listener), and the Tab trap's focusables() selector
 * includes the rename <input> so the editor joins the cycle.
 */

import { For, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import AgentAccess from "./AgentAccess";
import { docStore, loadDocument, setProjectName } from "../state/store";
import { exportProjectFile, importProjectFile } from "../persist/fileIO";
// TH-2 code-splitting: the export pipelines (offline render + WAV encoder,
// MIDI encoder + midi-file framing) are loaded ON DEMAND via dynamic import
// — the initial bundle never pays for them (CI gate: check:bundle). Both
// modules are pure/typed-result, so a load failure surfaces as the same
// error toast shape as any export failure.
import {
  deleteProjectSafe,
  getActiveProjectId,
  getBootDb,
  savedProjects,
  switchToProject,
} from "../persist/boot";
import { createNewProject } from "../persist/newProject";
import { BUILT_IN_DEMOS, type DemoId } from "../document/builtInDemos";
import { openBuiltInDemo } from "../persist/boot";
import {
  loadProject,
  renameProjectRecord,
  type ProjectMeta,
  type ProjectRecord,
} from "../persist/projectStore";
import {
  PROJECT_NAME_MAX_CHARS,
  normalizeProjectName,
} from "../state/projectName";
import {
  showInfo,
  showError,
  showSuccess,
  dismissToast,
} from "../state/toasts";
import { registerHelp } from "../help/registry";
import { relativeTime } from "../lib/reltime";
import "../styles/projects.css";

/**
 * HP-2 help content for the projects popover + its booth entry (Professor X
 * voice on HP-1's registry; I2-6 colocated law).
 */
registerHelp([
  {
    id: "projects.demos",
    title: "BUILT-IN DEMOS",
    text: "Open a demo to listen and explore its instruments and arrangement. Demos are previews until you edit them. Your first edit creates a local copy, so the original demo stays available.",
  },
  {
    id: "projects.open",
    title: "PROJECTS",
    text: "Opens the projects panel: everything you have saved, plus new project, exports and file save/open. Escape closes it.",
  },
  {
    id: "projects.item",
    title: "SAVED PROJECT",
    text: "Switches to this saved project — each one keeps its own autosave. A damaged row fails safely: your current work is never overwritten.",
  },
  {
    id: "projects.rename",
    title: "RENAME",
    text: "Turns this song's title into an editable field — Enter keeps the new name, Escape keeps the old one. Names trim and collapse spaces to 48 characters; two songs may share a name.",
  },
  {
    id: "projects.delete",
    title: "DELETE",
    text: "Arms the deliberate second step: the row becomes CONFIRM DELETE until you press it. Escape, a click elsewhere, or five seconds stands it down — nothing is removed by the first press.",
  },
  {
    id: "projects.confirm",
    title: "CONFIRM DELETE",
    text: "The deliberate second step — this press removes the song for real. The notification that follows carries UNDO, which puts the song back exactly as it was, byte for byte.",
  },
  {
    id: "projects.new",
    title: "NEW",
    text: "Starts a fresh, empty project in its own saved slot — nothing existing is overwritten. Pick a preset and paint the grid.",
  },
  {
    id: "projects.wav",
    title: "EXPORT WAV",
    text: "Renders the song offline to a stereo WAV — exactly ONE FULL CYCLE of what you hear: every lane's chain has come round once (the longest lane, when lanes differ), seam-free. Playback is never interrupted.",
  },
  {
    id: "projects.midi",
    title: "EXPORT MIDI",
    text: "Saves the notes and section cues as a Standard MIDI File, one track per lane, spanning the same ONE FULL CYCLE as the WAV — shorter lanes repeat within it. It carries no sounds — other apps play it with their own instruments.",
  },
  {
    id: "projects.save",
    title: "SAVE FILE",
    text: "Downloads the current project as a .bitbounce.json file — the whole song, openable here on any machine.",
  },
  {
    id: "projects.openfile",
    title: "OPEN FILE",
    text: "Opens a .bitbounce.json project file as a NEW project — an import never touches what you are working on.",
  },
]);

export default function Projects(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [items, setItems] = createSignal<readonly ProjectMeta[]>([]);
  /** i6 §2.5: the saved row whose inline rename editor is mounted (null = none). */
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  /** i6 §3.1: the saved row sitting in its two-step CONFIRM DELETE state. */
  const [confirmId, setConfirmId] = createSignal<string | null>(null);
  /** §3.1: the 5 s auto-revert (the toasts AUTO_DISMISS_MS precedent). */
  const CONFIRM_REVERT_MS = 5000;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let anchorBtn: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  const refresh = async (): Promise<void> => {
    const list = await savedProjects();
    // Most-recent-first; skip rows mid-quarantine naming is irrelevant here
    // (quarantined rows are normal rows the user may still export via RECOVER).
    setItems(list);
  };

  /** §3.1: stand the confirm down and clear its timer (close/exit path). */
  function clearConfirm(): void {
    if (confirmTimer !== undefined) {
      clearTimeout(confirmTimer);
      confirmTimer = undefined;
    }
    setConfirmId(null);
  }

  /** Focus one control of a saved row (Esc-exit refocus: the editor's origin). */
  function focusRowControl(id: string, selector: string): void {
    if (!panel) return;
    const row = panel.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    row?.querySelector<HTMLElement>(selector)?.focus();
  }

  const startConfirm = (id: string) => {
    setRenamingId(null); // one row in a special state at a time
    if (confirmId() === id) return;
    setConfirmId(id);
    if (confirmTimer !== undefined) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      confirmTimer = undefined;
      setConfirmId(null); // deliberate slowness expires — the row stands down
    }, CONFIRM_REVERT_MS);
    // Keyboard flow: the confirm control takes over the focus the DELETE
    // button held (Esc/click-away revert below hands it back).
    queueMicrotask(() => focusRowControl(id, ".projects-confirm"));
  };

  onMount(() => {
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open()) return;
      // i6 §2.5 Esc layering — THE trap: this CAPTURE-phase document listener
      // runs BEFORE any target-phase handler, so the rename editor's own
      // Escape stopPropagation() can never reach it. While an editor or a
      // confirm is open, Esc must cancel THAT state only (the popover stays,
      // keeping the edit's focus context); ungated, Esc-to-cancel would close
      // the whole popover.
      if (renamingId() !== null || confirmId() !== null) return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onDocKeydown, true);

    // §3.1 click-away: any pointer press outside the confirming row stands
    // the confirm down — inside the popover counts (clicking another row
    // reverts first, then the click's own handler runs). Capture phase so
    // the revert always lands before the press's click handler.
    const onDocPointerDown = (e: PointerEvent) => {
      const id = confirmId();
      if (id === null || !panel) return;
      const row = panel.querySelector(`li[data-id="${CSS.escape(id)}"]`);
      if (row && e.target instanceof Node && row.contains(e.target)) return;
      clearConfirm();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);

    onCleanup(() => {
      document.removeEventListener("keydown", onDocKeydown, true);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      clearConfirm(); // no orphan timer outlives the component
    });
  });

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    // i6 §2.5 Tab-trap law: this selector enumerated BUTTONS only, so a
    // mounted rename <input> was invisible to the trap — Tab skipped it and
    // escaped the panel. The editor joins the cycle by selector (DOM order
    // keeps the walk natural).
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([tabindex="-1"]), summary',
      ),
    ).filter(
      (el) => el.tagName === "SUMMARY" || !el.closest("details:not([open])"),
    );
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      const focusable = focusables();
      if (focusable.length === 0) return;
      e.preventDefault();
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? focusable[(idx - 1 + focusable.length) % focusable.length]
        : focusable[(idx + 1) % focusable.length];
      next.focus();
      return;
    }
    // §3.1: Esc stands a confirm down (the document-level close listener is
    // gated while confirming — this is the handler that acts). The rename
    // editor's own Escape consumed the event first, so the states never
    // collide on one press.
    if (e.key === "Escape" && confirmId() !== null) {
      const id = confirmId();
      clearConfirm();
      if (id !== null) {
        queueMicrotask(() => focusRowControl(id, ".projects-del"));
      }
    }
  };

  function close(): void {
    clearConfirm();
    setRenamingId(null);
    setOpen(false);
    anchorBtn?.focus();
  }

  const toggle = () => {
    const next = !open();
    if (next) {
      // i6 critique A3: the mount-time focus pass below races the list —
      // on FIRST open items() is still empty (focus lands on NEW, an
      // action, not the first row), and on REOPEN the stale rows render,
      // take the focus, then the refresh()'s re-read replaces the For rows
      // (new ProjectMeta objects remount every li) and destroys the focused
      // button — focus fell to <body>, the role=dialog unannounced and the
      // Tab trap disengaged until focus re-entered the panel. Re-assert the
      // first-control focus AFTER the list lands, so the popover's own law
      // ("focus lands on the first item on open") holds every open. Only
      // this open path — the other refresh() callers (rename/delete) own
      // their own refocus and must not be raced.
      void refresh().then(() => {
        queueMicrotask(() => {
          if (open()) focusables()[0]?.focus();
        });
      });
      setOpen(true);
      // Focus the first control once the panel exists.
      queueMicrotask(() => focusables()[0]?.focus());
    } else {
      // §3.1: closing stands any confirm down (timer cleared, no orphans).
      // An open rename editor unmounts with the panel — and the disconnect
      // blur COMMITS it (the §2.5 blur-commits choice; the settled guard
      // only shields a resolved Enter/Escape).
      clearConfirm();
      setRenamingId(null);
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

  const handleDemo = async (id: DemoId) => {
    const db = getBootDb();
    if (!db || busy()) return;
    setBusy(true);
    try {
      await openBuiltInDemo(id);
      showSuccess(`OPENED ${docStore.getState().doc.name}`, {
        suggestion: "A local copy is saved when you edit the song.",
      });
      close();
    } catch {
      showError("Could not open the demo.", {
        suggestion: "Try again from Projects.",
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

  /**
   * i6 §2.5: mount the row's rename editor. One special row state at a time —
   * starting a rename stands any confirm down.
   */
  const startRename = (meta: ProjectMeta) => {
    clearConfirm();
    setRenamingId(meta.id);
  };

  /**
   * Commit a rename (i6 §2.3/§2.4 — the dispatch rule is LAW): the CURRENT
   * row goes through the store's `setProjectName` (one commit; the next
   * autosave flush re-reads the live doc and lands the name in the record
   * envelope AND the encoded json — one put, both surfaces); every OTHER row
   * through `renameProjectRecord` (full record rewrite that NEVER touches
   * the working doc or the autosave controller). Both paths run the shared
   * normalizer first: empty-after-trim and unchanged names are no-ops.
   */
  const commitRename = (meta: ProjectMeta, value: string) => {
    setRenamingId(null);
    if (meta.id === getActiveProjectId()) {
      setProjectName(value);
      // The db row catches up on the next ~800 ms flush; patch the list
      // signal so the new name is visible immediately, then re-read the db
      // once the flush window has passed (a reopen inside the window would
      // otherwise resurrect the stale envelope name on screen).
      const next = normalizeProjectName(value);
      if (next !== undefined && next !== meta.name) {
        setItems((list) =>
          list.map((row) =>
            row.id === meta.id ? { ...row, name: next } : row,
          ),
        );
        window.setTimeout(() => void refresh(), 1200);
      }
      return;
    }
    const db = getBootDb();
    if (!db) return;
    void renameProjectRecord(db, meta.id, value)
      .then(() => void refresh())
      .catch(() => {
        showError(`Could not rename "${meta.name}".`, {
          suggestion: "The row was left untouched — it may be damaged.",
        });
      });
  };

  /** §2.5: Escape keeps the old name — no write anywhere. */
  const cancelRename = (meta: ProjectMeta) => {
    setRenamingId(null);
    queueMicrotask(() => focusRowControl(meta.id, ".projects-ren"));
  };

  /**
   * §3.4: the sticky DELETED toast + one-shot UNDO. run() re-puts the EXACT
   * held record — byte-identical json, original name/updatedAt/dirty, so the
   * row returns to its exact list position — then refreshes. UNDO never
   * auto-switches: the restored row comes back INACTIVE wherever the user
   * now is (restoring is not reopening). §4.6: a failed re-put resolves
   * false and keeps THIS toast armed — the hold lives in the closure, so the
   * user can retry after freeing space.
   */
  const showDeletedToast = (held: ProjectRecord, wasActive: boolean) => {
    showError(`DELETED "${held.name}"`, {
      suggestion: wasActive
        ? "You are now in the next saved song. UNDO puts the deleted one back exactly as it was."
        : "The song is gone. UNDO puts it back exactly as it was.",
      sticky: true, // XP-1: the undo window stays open until dismissed
      action: {
        label: "UNDO",
        run: async () => {
          const db = getBootDb();
          if (!db) return false;
          try {
            await db.putRecord(held);
            void refresh();
          } catch {
            showError(`Could not restore "${held.name}".`, {
              suggestion:
                "The song is still held in memory — free up space and press UNDO again.",
            });
            return false;
          }
          return undefined;
        },
      },
    });
  };

  /**
   * The CONFIRM DELETE press (i6 §3.1 second step → §3.2/§3.3). All the
   * ordering law lives in deleteProjectSafe: inactive rows delete plainly;
   * the ACTIVE row retargets first (successor = most-recent remaining, else
   * a fresh NEW project), flushes + disarms every writer via
   * switchToProject, loads the successor doc, re-fills the hold AFTER the
   * final flush (so UNDO carries every committed edit), and only then
   * deletes — a pending flush can never resurrect the row.
   */
  const handleDelete = async (meta: ProjectMeta) => {
    const db = getBootDb();
    if (!db || busy()) return;
    clearConfirm();
    setBusy(true);
    try {
      const deleted = await deleteProjectSafe(meta.id);
      await refresh();
      if (!deleted) return; // row already gone — nothing to hold or say
      // Deleting the working row switched the app to the successor inside
      // deleteProjectSafe; the confirm control just unmounted, so refocus
      // the list's first control (most-recent-first: the successor) to keep
      // the Tab trap anchored.
      queueMicrotask(() => focusables()[0]?.focus());
      showDeletedToast(deleted.held, deleted.wasActive);
    } catch {
      showError(`Could not delete "${meta.name}".`, {
        suggestion: "Nothing was removed — try again.",
      });
      void refresh();
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
   * XP-1 (i3-5): the render is EXACTLY one LCM cycle — up to ~4.3 min of
   * audio at a 128-bar worst case (12-15 s wall), so the busy-guard must
   * span the whole render: the RENDERING WAV… toast is STICKY (dismissed
   * here when the render lands) and the buttons stay disabled throughout.
   * PX-4 final toast wording (XP-1 deferred it here): the success toast
   * names WHAT the file is in cycle vocabulary — `· 32-BAR CYCLE` — the
   * bars being the LCM of the lane chain totals (the longest lane).
   */
  const handleExportWav = async () => {
    if (busy()) return;
    setBusy(true);
    const renderingId = showInfo("RENDERING WAV…", { sticky: true });
    try {
      const { exportWav } = await import("../audio/exportWav");
      const result = await exportWav(docStore.getState().doc);
      if (result.ok) {
        showSuccess(`WAV EXPORTED · ${result.bars}-BAR CYCLE`);
      } else {
        showError(result.message, { suggestion: result.suggestion });
      }
    } catch {
      // HL-1 honesty fix (2026-09-04): the typed-result contract covers
      // failures INSIDE the export module (render/encode/io); REACHING the
      // module can also fail — a stale deploy's index.html outliving its
      // chunk is the real-world class. Without this catch the sticky
      // RENDERING toast vanished with no explanation and the rejection went
      // unhandled. Same error-toast shape as any export failure (TH-2's
      // stated contract, now actually implemented); busy clears in finally.
      showError("WAV export could not start.", {
        suggestion:
          "The app may have been updated — reload the page, then try again.",
      });
    } finally {
      dismissToast(renderingId);
      setBusy(false);
    }
  };

  /**
   * MIDI export (MF-5): pure synchronous encode → typed result → download.
   * Same one-shot busy flag as WAV so the two exports can't interleave.
   * XP-1 (i3-5): the file spans EXACTLY one LCM cycle (shorter chains
   * repeat within it); PX-4 final toast wording — the CYCLE word closes
   * the line, same vocabulary as the WAV toast.
   */
  const handleExportMidi = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const { exportMidi } = await import("../audio/exportMidi");
      const result = exportMidi(docStore.getState().doc);
      if (result.ok) {
        showSuccess(
          `MIDI EXPORTED \u00b7 ${result.trackCount} TRACKS \u00b7 ${result.noteCount} NOTES \u00b7 ${result.bars}-BAR CYCLE`,
        );
      } else {
        showError(result.message, { suggestion: result.suggestion });
      }
    } catch {
      // Same class as the WAV twin above (HL-1): a chunk that fails to LOAD
      // gets the same honest toast as one that fails inside.
      showError("MIDI export could not start.", {
        suggestion:
          "The app may have been updated — reload the page, then try again.",
      });
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
        data-help="projects.open"
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
                <li data-id={meta.id}>
                  {/* §3.1/§5.3: the confirm state and the rename editor each
                      REPLACE the row's content — the 232px-min popover never
                      widens for a special state. */}
                  {renamingId() === meta.id ? (
                    <ProjectRenameInput
                      initial={meta.name}
                      onCommit={(value) => commitRename(meta, value)}
                      onCancel={() => cancelRename(meta)}
                    />
                  ) : confirmId() === meta.id ? (
                    <button
                      type="button"
                      class="projects-confirm"
                      data-help="projects.confirm"
                      disabled={busy()}
                      onClick={() => void handleDelete(meta)}
                    >
                      CONFIRM DELETE
                    </button>
                  ) : (
                    <div class="projects-row">
                      <button
                        type="button"
                        class="projects-item"
                        data-help="projects.item"
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
                      <button
                        type="button"
                        class="projects-x projects-ren"
                        data-help="projects.rename"
                        aria-label={`Rename ${meta.name}`}
                        disabled={busy()}
                        onClick={() => startRename(meta)}
                      >
                        RENAME
                      </button>
                      <button
                        type="button"
                        class="projects-x projects-del"
                        data-help="projects.delete"
                        aria-label={`Delete ${meta.name}`}
                        disabled={busy()}
                        onClick={() => startConfirm(meta.id)}
                      >
                        DELETE
                      </button>
                    </div>
                  )}
                </li>
              )}
            </For>
          </ul>
          <AgentAccess />
          <details class="projects-demos" data-help="projects.demos">
            <summary>Built-in demos</summary>
            <p>Try a demo. A local copy is saved only when you edit it.</p>
            <For each={BUILT_IN_DEMOS}>
              {(demo) => (
                <button
                  type="button"
                  class="projects-item projects-demo"
                  disabled={busy()}
                  onClick={() => void handleDemo(demo.id)}
                >
                  <span class="projects-name">{demo.name}</span>
                  <span class="projects-demo-description">
                    {demo.description}
                  </span>
                </button>
              )}
            </For>
          </details>
          <div class="projects-actions">
            <button
              type="button"
              class="booth-btn projects-action"
              data-help="projects.new"
              disabled={busy()}
              onClick={() => void handleNew()}
            >
              NEW
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              data-help="projects.wav"
              disabled={busy()}
              onClick={() => void handleExportWav()}
            >
              EXPORT WAV
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              data-help="projects.midi"
              disabled={busy()}
              onClick={() => void handleExportMidi()}
            >
              EXPORT MIDI
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              data-help="projects.save"
              onClick={handleSave}
            >
              SAVE FILE
            </button>
            <button
              type="button"
              class="booth-btn projects-action"
              data-help="projects.openfile"
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

/**
 * The saved row's inline rename editor — the PatternRail InlineEdit twin
 * (PatternRail.tsx:513-560 contract) with the project-name normalizer as the
 * authority: Enter commits, Escape cancels (both consume the key ahead of
 * the popover's gated capture-phase close — see the header law), blur
 * commits (the audit's stated click-away choice), maxLength as UX only, and
 * focus+select on mount with the IN-4 0 ms re-assert past the click's
 * default focus finalization. The committed value runs through
 * normalizeProjectName inside both write paths (§2.2): empty-after-trim and
 * unchanged names never write.
 */
function ProjectRenameInput(props: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = createSignal(props.initial);
  // Escape/Enter settle the edit BEFORE the unmount — and this Chromium
  // fires a NATIVE blur on a focused element being disconnected, so without
  // the guard an Esc-cancelled editor would re-commit its typed value on the
  // way out (verified by probe). Once settled, the blur is machinery, not a
  // user intent: cancel stays a cancel.
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    props.onCommit(value());
  };
  return (
    <input
      class="projects-edit"
      type="text"
      value={value()}
      maxLength={PROJECT_NAME_MAX_CHARS}
      aria-label="Rename project"
      data-help="projects.rename"
      ref={(el) => {
        el.focus();
        el.select();
        // IN-4 twin: the click that opened the editor finalizes focus on the
        // origin button after this ref already focused the input — re-assert
        // past that finalization so the first keystroke lands in the field.
        window.setTimeout(() => {
          if (el.isConnected) {
            el.focus();
            el.select();
          }
        }, 0);
      }}
      onInput={(e) => setValue(e.currentTarget.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          commit();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          settled = true;
          props.onCancel();
        }
      }}
    />
  );
}
