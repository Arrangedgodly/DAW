/**
 * HU-3 browser tests — autosave/recovery UX against the REAL event loop +
 * REAL IndexedDB (no fake clocks):
 *  - pagehide fires a genuine flush (real DOM event on the real window, real
 *    IDB writes observed after);
 *  - draft-recovery toast conditionality through initPersistence + the real
 *    Toasts renderer (dirty row announces, clean row stays silent);
 *  - the Projects popover switches projects through the real component with
 *    the no-clobber ordering law (old row untouched, edits land in the new
 *    row).
 *
 * i6 S-3 (rename + delete + undo) extends the same family: both rename
 * paths persist through real flush windows, the two-step confirm stands down
 * on Esc/click-away/5 s, deleting the ACTIVE row switches to the successor
 * with NO resurrection after a full flush window, and UNDO re-puts the exact
 * held record byte-for-byte. The popover's keyboard contract (Esc/Tab-trap/
 * focus-return) is re-probed WITH an editor open — the two i6 traps.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { decode } from "../../src/document/codec";
import { docStore } from "../../src/state/store";
import { clearToasts, toastStack } from "../../src/state/toasts";
import Projects from "../../src/components/Projects";
import Toasts from "../../src/components/Toasts";
import {
  getActiveProjectId,
  getAutosaveController,
  initPersistence,
} from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { getProjectRecord, saveProject } from "../../src/persist/projectStore";
import { createNewProject } from "../../src/persist/newProject";

async function freshDb(name: string) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  return openRawProjectDb(name);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  ms = 4000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("condition never met within budget");
}

function mount(): {
  host: HTMLElement;
  toastHost: HTMLElement;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const toastHost = document.createElement("div");
  document.body.append(toastHost);
  const dispose = render(Projects, host);
  const disposeToasts = render(Toasts, toastHost);
  return {
    host,
    toastHost,
    cleanup: () => {
      dispose();
      disposeToasts();
      clearToasts();
      host.remove();
      toastHost.remove();
    },
  };
}

describe("HU-3 autosave/recovery UX (real events + real IndexedDB)", () => {
  it("pagehide (real DOM event) flushes pending edits", async () => {
    const db = await freshDb("bitbounce-test-hu3-pagehide");
    const before = docStore.getState().doc;
    const boot = await initPersistence({ db });

    // An edit whose 800 ms debounce has NOT elapsed when the page hides.
    docStore.setState({ doc: { ...before, name: "pagehide draft" } });
    await waitFor(
      async () => (await getProjectRecord(db, boot.projectId))?.dirty === true,
    );

    // The REAL pagehide event on the REAL window (the exact listener the app
    // registers through windowImpl: window).
    window.dispatchEvent(new Event("pagehide"));

    await waitFor(async () => {
      const row = await getProjectRecord(db, boot.projectId);
      return (
        row !== undefined &&
        row.dirty === false &&
        decode(row.json).name === "pagehide draft"
      );
    });

    await getAutosaveController()?.stop();
    docStore.setState({ doc: before });
  });

  it("boot on a dirty row announces recovery; a clean row stays silent", async () => {
    const dirtyDb = await freshDb("bitbounce-test-hu3-dirty");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      await saveProject(
        dirtyDb,
        "recent",
        { ...before, name: "crashed song" },
        { dirty: true },
      );
      const result = await initPersistence({ db: dirtyDb });
      expect(result.restored).toBe(true);
      expect(docStore.getState().doc.name).toBe("crashed song"); // STILL loads

      await waitFor(
        () =>
          ui.toastHost.textContent?.includes("RECOVERED UNSAVED WORK") === true,
      );
      expect(ui.toastHost.textContent).toContain("last change");
      await getAutosaveController()?.stop();
      clearToasts();

      // Clean row: no recovery toast.
      const cleanDb = await freshDb("bitbounce-test-hu3-clean");
      await saveProject(cleanDb, "recent", { ...before, name: "tidy song" });
      await initPersistence({ db: cleanDb });
      await new Promise((r) => setTimeout(r, 150));
      expect(ui.toastHost.textContent).not.toContain("RECOVERED");
      expect(docStore.getState().doc.name).toBe("tidy song");
      await getAutosaveController()?.stop();
    } finally {
      ui.cleanup();
      docStore.setState({ doc: before });
    }
  });

  it("Projects popover switches projects without clobbering the old row", async () => {
    const db = await freshDb("bitbounce-test-hu3-switch");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      // Make the boot project identifiable, flushed clean.
      docStore.setState({ doc: { ...before, name: "workshop A" } });
      await new Promise((r) => setTimeout(r, 1100)); // debounce + IDB

      // A second saved project to switch to.
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "workshop B" });

      // Open the popover and click B's item.
      const btn = ui.host.querySelector<HTMLButtonElement>(".projects-btn")!;
      btn.click();
      await waitFor(() => ui.host.querySelector(".projects-item") !== null);
      const items = [
        ...ui.host.querySelectorAll<HTMLButtonElement>(".projects-item"),
      ];
      const target = items.find((el) =>
        el.textContent?.includes("workshop B"),
      )!;
      target.click();

      await waitFor(() => docStore.getState().doc.name === "workshop B");

      // Edit B; the flush must land in B's row, never A's.
      docStore.setState({
        doc: {
          ...docStore.getState().doc,
          transport: { ...docStore.getState().doc.transport, bpm: 137 },
        },
      });
      await new Promise((r) => setTimeout(r, 1100));
      const rowA = await getProjectRecord(db, boot.projectId);
      const rowB = await getProjectRecord(db, b.record.id);
      expect(decode(rowA!.json).name).toBe("workshop A");
      expect(decode(rowB!.json).name).toBe("workshop B");
      expect(JSON.parse(rowB!.json).transport.bpm).toBe(137);
      expect(rowA!.dirty).toBe(false);
      expect(rowB!.dirty).toBe(false);
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });
});

describe("i6 S-3 — rename + delete + undo in the Projects popover", () => {
  /** Wait for a queried element to exist, then return it (typed). */
  async function waitForEl<T extends Element>(query: () => T | null): Promise<T> {
    await waitFor(() => query() !== null);
    return query()!;
  }

  /** Wait for a db row to exist again (the UNDO round-trip). */
  async function waitForRecord(db: ProjectDb, id: string) {
    await waitFor(async () => (await getProjectRecord(db, id)) !== undefined);
    return (await getProjectRecord(db, id))!;
  }

  /** Open the popover and wait for its rows (the real component, real list). */
  async function openPopover(ui: ReturnType<typeof mount>) {
    const btn = ui.host.querySelector<HTMLButtonElement>(".projects-btn")!;
    btn.click();
    await waitFor(() => ui.host.querySelector(".projects-pop") !== null);
    await waitFor(() => ui.host.querySelector(".projects-item") !== null);
    return btn;
  }

  /** One saved row's <li> by project id (rows carry data-id). */
  function rowOf(ui: ReturnType<typeof mount>, id: string) {
    return ui.host.querySelector(`li[data-id="${id}"]`)!;
  }

  /** Start the rename editor on a row and wait for it to be focused. */
  async function startRename(ui: ReturnType<typeof mount>, id: string) {
    rowOf(ui, id).querySelector<HTMLButtonElement>(".projects-ren")!.click();
    await waitFor(() => rowOf(ui, id).querySelector(".projects-edit") !== null);
    await waitFor(
      () =>
        document.activeElement === rowOf(ui, id).querySelector(".projects-edit"),
    );
    return rowOf(ui, id).querySelector<HTMLInputElement>(".projects-edit")!;
  }

  /** Type into the Solid editor (value + delegated input event). */
  function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function keyAt(el: Element, key: string) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  }

  /** Arm + press a row's two-step delete; resolves the CONFIRM button. */
  async function armConfirm(ui: ReturnType<typeof mount>, id: string) {
    rowOf(ui, id).querySelector<HTMLButtonElement>(".projects-del")!.click();
    return waitForEl(() =>
      rowOf(ui, id).querySelector<HTMLButtonElement>(".projects-confirm"),
    );
  }

  it("renames the CURRENT row through the store; empty is a no-op; the normalizer clamps to 48", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-rename-current");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      await openPopover(ui);
      const id = boot.projectId;

      // Enter-commit: the store carries the name, the flush persists it to
      // BOTH the envelope and the encoded json.
      const edit = await startRename(ui, id);
      typeInto(edit, "renamed live");
      keyAt(edit, "Enter");
      await waitFor(
        () => rowOf(ui, id).textContent?.includes("renamed live") === true,
      );
      await new Promise((r) => setTimeout(r, 1100)); // debounce + IDB
      const row = await getProjectRecord(db, id);
      expect(row!.name).toBe("renamed live");
      expect(decode(row!.json).name).toBe("renamed live");
      expect(docStore.getState().doc.name).toBe("renamed live");

      // Empty-after-trim commit: a NO-OP — the editor exits, the name stays.
      const empty = await startRename(ui, id);
      typeInto(empty, "   ");
      keyAt(empty, "Enter");
      await waitFor(() => rowOf(ui, id).querySelector(".projects-edit") === null);
      expect(docStore.getState().doc.name).toBe("renamed live");
      await new Promise((r) => setTimeout(r, 1100));
      expect((await getProjectRecord(db, id))!.name).toBe("renamed live");

      // The normalizer is the authority past maxLength UX (programmatic
      // values can exceed the attr): 60 chars clamp to 48 CODE POINTS.
      const long = await startRename(ui, id);
      typeInto(long, "a".repeat(60));
      keyAt(long, "Enter");
      await waitFor(
        () => docStore.getState().doc.name.length === 48,
      );
      await new Promise((r) => setTimeout(r, 1100));
      expect((await getProjectRecord(db, id))!.name.length).toBe(48);
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("renames an OTHER row via record rewrite (blur commits); duplicates allowed; the working doc is untouched", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-rename-other");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      docStore.setState({ doc: { ...before, name: "workshop A" } });
      await new Promise((r) => setTimeout(r, 1100));
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "workshop B" });
      await openPopover(ui);

      // Blur commits (the audit's stated click-away choice: focus leaving
      // the field commits — a real blur event through the real handler).
      const edit = await startRename(ui, b.record.id);
      typeInto(edit, "workshop B renamed");
      edit.blur();
      await waitFor(
        () =>
          rowOf(ui, b.record.id).textContent?.includes("workshop B renamed") ===
          true,
      );

      // The record carries the name in envelope AND json; the working doc
      // and its own row are untouched (renameProjectRecord never sees them).
      const rowB = await getProjectRecord(db, b.record.id);
      expect(rowB!.name).toBe("workshop B renamed");
      expect(decode(rowB!.json).name).toBe("workshop B renamed");
      const rowA = await getProjectRecord(db, boot.projectId);
      expect(rowA!.name).toBe("workshop A");
      expect(docStore.getState().doc.name).toBe("workshop A");

      // Duplicates are ALLOWED (ids are the key; no silent suffixing).
      const dup = await startRename(ui, b.record.id);
      typeInto(dup, "workshop A");
      keyAt(dup, "Enter");
      await waitFor(
        () =>
          rowOf(ui, b.record.id).querySelector(".projects-edit") === null,
      );
      await waitFor(async () => {
        const row = await getProjectRecord(db, b.record.id);
        return row?.name === "workshop A";
      });
      expect(docStore.getState().doc.name).toBe("workshop A");
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("delete is two-step: CONFIRM replaces the row; Esc, click-away, and 5 s all stand it down; the second press deletes an inactive row", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-confirm");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      docStore.setState({ doc: { ...before, name: "workshop A" } });
      await new Promise((r) => setTimeout(r, 1100));
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "workshop B" });
      await openPopover(ui);

      // First press: the row's CONTENT is replaced by CONFIRM DELETE.
      const confirm = await armConfirm(ui, b.record.id);
      expect(rowOf(ui, b.record.id).querySelector(".projects-item")).toBeNull();
      expect(confirm.textContent).toContain("CONFIRM DELETE");
      expect(ui.host.querySelector(".projects-pop")).not.toBeNull();

      // Esc stands the confirm down WITHOUT closing the popover (the §2.5
      // capture-phase gate) and returns focus to the row's DELETE key.
      await waitFor(() => document.activeElement === confirm);
      keyAt(confirm, "Escape");
      await waitFor(
        () => rowOf(ui, b.record.id).querySelector(".projects-confirm") === null,
      );
      expect(ui.host.querySelector(".projects-pop")).not.toBeNull();
      expect(rowOf(ui, b.record.id).querySelector(".projects-item")).not.toBeNull();
      await waitFor(
        () =>
          document.activeElement ===
          rowOf(ui, b.record.id).querySelector(".projects-del"),
      );

      // Click-away (a pointer press outside the confirming row — inside the
      // popover counts) stands it down too.
      await armConfirm(ui, b.record.id);
      rowOf(ui, boot.projectId)
        .querySelector(".projects-item")!
        .dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
          }),
        );
      await waitFor(
        () => rowOf(ui, b.record.id).querySelector(".projects-confirm") === null,
      );
      expect(ui.host.querySelector(".projects-pop")).not.toBeNull();

      // The 5 s deliberateness window auto-reverts.
      await armConfirm(ui, b.record.id);
      await new Promise((r) => setTimeout(r, 5300));
      expect(rowOf(ui, b.record.id).querySelector(".projects-confirm")).toBeNull();
      expect(rowOf(ui, b.record.id).querySelector(".projects-item")).not.toBeNull();

      // Second press deletes the INACTIVE row: gone from list and db, the
      // working song untouched, the sticky DELETED toast raised.
      const go = await armConfirm(ui, b.record.id);
      go.click();
      await waitFor(async () => (await getProjectRecord(db, b.record.id)) === undefined);
      await waitFor(
        () => ui.host.querySelector(`li[data-id="${b.record.id}"]`) === null,
      );
      expect(decode((await getProjectRecord(db, boot.projectId))!.json).name).toBe(
        "workshop A",
      );
      expect(docStore.getState().doc.name).toBe("workshop A");
      expect(ui.toastHost.textContent).toContain("DELETED");
      expect(ui.toastHost.textContent).toContain("UNDO");
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("deletes the ACTIVE row: successor switch, NO resurrection after a full flush window (armed debounce)", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-delete-active");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      docStore.setState({ doc: { ...before, name: "doomed song" } });
      await new Promise((r) => setTimeout(r, 1100));
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "survivor" });
      await openPopover(ui);

      // Arm the race: an edit whose 800 ms debounce is STILL PENDING when
      // the delete runs — the succession must flush it into the doomed row,
      // disarm every writer, and only then delete.
      docStore.setState({
        doc: {
          ...docStore.getState().doc,
          transport: { ...docStore.getState().doc.transport, bpm: 149 },
        },
      });
      const go = await armConfirm(ui, boot.projectId);
      go.click();

      // Visible switch to the successor (most-recent remaining row).
      await waitFor(() => docStore.getState().doc.name === "survivor");
      await waitFor(
        async () => (await getProjectRecord(db, boot.projectId)) === undefined,
      );

      // The resurrection window: a full debounce + IDB pass with the
      // successor's controller live — the doomed row must stay gone.
      await new Promise((r) => setTimeout(r, 1100));
      expect(await getProjectRecord(db, boot.projectId)).toBeUndefined();
      const rowB = await getProjectRecord(db, b.record.id);
      expect(decode(rowB!.json).name).toBe("survivor");
      expect(JSON.parse(rowB!.json).transport.bpm).not.toBe(149); // no clobber
      expect(ui.toastHost.textContent).toContain("DELETED");
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("UNDO re-puts the exact held record (byte-identical json, original updatedAt) and never auto-switches", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-undo");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      docStore.setState({ doc: { ...before, name: "byte song" } });
      await new Promise((r) => setTimeout(r, 1100)); // clean flush: stable bytes
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "after song" });
      // No edits after this snapshot: the held record === these exact bytes.
      const snapshot = await getProjectRecord(db, boot.projectId);
      expect(snapshot).toBeDefined();

      await openPopover(ui);
      const go = await armConfirm(ui, boot.projectId);
      go.click();
      await waitFor(() => docStore.getState().doc.name === "after song");
      await waitFor(
        async () => (await getProjectRecord(db, boot.projectId)) === undefined,
      );

      // The one-shot UNDO (the toast's action button).
      const undo = await waitForEl(() =>
        [...ui.toastHost.querySelectorAll<HTMLButtonElement>(".toast-action")].find(
          (btn) => btn.textContent?.trim() === "UNDO",
        ),
      );
      undo.click();
      const restored = await waitForRecord(db, boot.projectId);
      // EXACT record: byte-identical json, original updatedAt + dirty flags.
      expect(restored!.json).toBe(snapshot!.json);
      expect(restored!.name).toBe(snapshot!.name);
      expect(restored!.updatedAt).toBe(snapshot!.updatedAt);
      expect(restored!.dirty).toBe(snapshot!.dirty);

      // UNDO never auto-switches: the user stays in the successor.
      expect(docStore.getState().doc.name).toBe("after song");
      // One-shot by vehicle: the DELETED toast dismissed after the run.
      await waitFor(() => !ui.toastHost.textContent?.includes("DELETED"));
      expect(toastStack().some((t) => t.message.includes("DELETED"))).toBe(false);
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("deleting the LAST song boots into a fresh NEW successor (never zero rows)", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-delete-last");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      await openPopover(ui);

      const go = await armConfirm(ui, boot.projectId);
      go.click();

      await waitFor(() => docStore.getState().doc.name === "Untitled");
      await waitFor(
        () => ui.host.querySelectorAll(".projects-item").length === 1,
      );
      expect(await getProjectRecord(db, boot.projectId)).toBeUndefined();
      expect(ui.toastHost.textContent).toContain("DELETED");
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("popover contract with an editor open: the Tab trap enumerates the input, Esc cancels the edit ONLY, focus returns on close", async () => {
    const db = await freshDb("bitbounce-test-hu3-i6-keyboard");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      const boot = await initPersistence({ db });
      docStore.setState({ doc: { ...before, name: "keyboard song" } });
      await new Promise((r) => setTimeout(r, 1100));
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "other row" });
      const btn = await openPopover(ui);
      const id = boot.projectId;
      const panel = ui.host.querySelector(".projects-pop")!;

      // The CURRENT row sits SECOND (most-recent-first: the just-saved other
      // row is on top), so the trap's focus order is
      // [other-item, other-REN, other-DELETE, EDITOR, NEW, ...]. Tab FROM the
      // editor must land on NEW — proving the input is enumerated at its DOM
      // position. An input the trap cannot see resolves activeElement to -1
      // and wraps to the FIRST row's item instead.
      const edit = await startRename(ui, id);
      typeInto(edit, "tab song");
      keyAt(edit, "Tab");
      // Blur commits (the §2.5 stated choice): the editor closed, the name
      // landed in the store, and focus stayed inside the popover.
      await waitFor(() => ui.host.querySelector(".projects-edit") === null);
      expect(docStore.getState().doc.name).toBe("tab song");
      expect(document.activeElement).toBe(
        ui.host.querySelector(".projects-action"),
      );
      expect(panel.contains(document.activeElement)).toBe(true);

      // The remaining button cycle never escapes the panel (wrap included).
      const count = panel.querySelectorAll("button:not([disabled])").length;
      let focus: Element = document.activeElement as Element;
      for (let i = 0; i < count + 2; i++) {
        keyAt(focus, "Tab");
        const active = document.activeElement as Element;
        expect(panel.contains(active), "Tab never escapes the popover").toBe(true);
        focus = active;
      }

      // Esc DURING an edit cancels the edit only — the popover stays open,
      // the committed name is untouched, and focus returns to the row's
      // RENAME key (the §2.5 capture-phase gate: the doc-level Esc close
      // must NOT fire while the editor is open).
      const again = await startRename(ui, id);
      typeInto(again, "THROWN AWAY");
      keyAt(again, "Escape");
      await waitFor(() => ui.host.querySelector(".projects-edit") === null);
      expect(ui.host.querySelector(".projects-pop")).not.toBeNull();
      expect(docStore.getState().doc.name).toBe("tab song");
      await waitFor(
        () =>
          document.activeElement ===
          rowOf(ui, id).querySelector(".projects-ren"),
      );

      // Esc with no editor/confirm open: the popover closes and focus
      // returns to the anchor button (the unchanged contract).
      keyAt(document.activeElement as Element, "Escape");
      await waitFor(() => ui.host.querySelector(".projects-pop") === null);
      expect(document.activeElement).toBe(btn);
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("a FAILED UNDO re-put keeps the DELETED toast armed (i6 §4.6 storage-full): retry after the quota frees succeeds one-shot", async () => {
    const base = await freshDb("bitbounce-test-hu3-i6-undo-fail");
    const before = docStore.getState().doc;
    const ui = mount();
    try {
      // The quota-full injection (the fileIO/autosave spyDb convention): a
      // wrapped ProjectDb whose putRecord rejects — but ONLY once armed and
      // ONLY for the held row's id, so boot, the working row's flushes, and
      // the delete itself (deleteRecord, never a put) all run for real; the
      // failure lands exactly on UNDO's re-put, the moment §4.6 legislates.
      let failPuts = false;
      const heldId = { id: "" };
      const db: ProjectDb = {
        ...base,
        async putRecord(record) {
          if (failPuts && record.id === heldId.id) {
            throw new Error("QuotaExceededError: storage full (injected)");
          }
          return base.putRecord(record);
        },
      };
      const boot = await initPersistence({ db });
      docStore.setState({ doc: { ...before, name: "keeper song" } });
      await new Promise((r) => setTimeout(r, 1100));
      const b = await createNewProject(db);
      await saveProject(db, b.record.id, { ...b.doc, name: "doomed by quota" });
      heldId.id = b.record.id;
      // The exact pre-delete bytes (the retry's comparator).
      const held = (await getProjectRecord(db, b.record.id))!;

      await openPopover(ui);
      const go = await armConfirm(ui, b.record.id);
      go.click();
      await waitFor(
        async () => (await getProjectRecord(db, b.record.id)) === undefined,
      );
      await waitFor(() => ui.toastHost.textContent?.includes("DELETED") === true);

      const deletedCard = () =>
        [...ui.toastHost.querySelectorAll(".toast")].find((t) =>
          (t.textContent ?? "").includes("DELETED"),
        ) ?? null;
      const undoBtn = () =>
        deletedCard()?.querySelector<HTMLButtonElement>(".toast-action") ?? null;
      expect(undoBtn()?.textContent?.trim()).toBe("UNDO");

      // Arm the storage-full failure, then press UNDO: the re-put THROWS.
      failPuts = true;
      undoBtn()!.click();
      await waitFor(
        () => ui.toastHost.textContent?.includes("Could not restore") === true,
      );
      await waitFor(async () => (await getProjectRecord(db, b.record.id)) === undefined);
      // §4.6's law — the toast STAYS ARMED (run() resolved false; the
      // one-shot vehicle must not dismiss on a failed action), so the row
      // is still restorable from the in-memory hold after space is freed.
      expect(
        deletedCard(),
        "the DELETED toast is still rendered after the failed UNDO",
      ).not.toBeNull();
      expect(
        undoBtn(),
        "the armed toast still carries its UNDO button",
      ).not.toBeNull();

      // The retry: quota freed (injection disarmed) → the same toast's UNDO
      // succeeds, restores the EXACT held bytes, and only then dismisses.
      failPuts = false;
      undoBtn()!.click();
      const restored = await waitForRecord(db, b.record.id);
      expect(restored.json).toBe(held.json);
      expect(restored.name).toBe(held.name);
      expect(restored.updatedAt).toBe(held.updatedAt);
      expect(restored.dirty).toBe(held.dirty);
      await waitFor(() => deletedCard() === null);
      expect(
        toastStack().some((t) => t.message.includes("DELETED")),
        "one-shot on SUCCESS only: the toast dismissed after the retry",
      ).toBe(false);
      // The working song never moved (inactive delete; UNDO never switches).
      expect(docStore.getState().doc.name).toBe("keeper song");
      expect(boot.projectId).toBe(getActiveProjectId());
    } finally {
      ui.cleanup();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });
});
