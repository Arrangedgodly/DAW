/**
 * MF-3 browser tests — import through the REAL codec + IndexedDB path with
 * the real FileIO component: a constructed File is set on the hidden input
 * (DataTransfer) and the change event fires, exercising the same handler the
 * user's OPEN FILE click does. Verifies: import lands as a new persisted
 * project + store doc + autosave retargeted; corrupt input raises the
 * dismissible role=alert toast.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { encode } from "../../src/document/codec";
import { createDefaultProject } from "../../src/document/schema";
import { docStore } from "../../src/state/store";
import FileIO from "../../src/components/FileIO";
import Toasts from "../../src/components/Toasts";
import { clearToasts } from "../../src/state/toasts";
import { getAutosaveController, initPersistence } from "../../src/persist/boot";
import { openRawProjectDb } from "../../src/persist/db";

async function freshDb(name: string) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  return openRawProjectDb(name);
}

/** Render FileIO + the shared Toasts (HU-2 bus) standalone and get their DOM. */
function mountFileIO(): { root: HTMLElement; input: HTMLInputElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const toastHost = document.createElement("div");
  document.body.append(toastHost);
  // No JSX in the test file (the browser-mode test transform has no JSX
  // step): the component function itself is the render fn, evaluated inside
  // render's reactive root so its signals work.
  const dispose = render(FileIO, host);
  const disposeToasts = render(Toasts, toastHost);
  const root = host;
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  return {
    root,
    input,
    cleanup: () => {
      dispose();
      disposeToasts();
      clearToasts();
      host.remove();
      toastHost.remove();
    },
  };
}

function setInputFiles(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(predicate: () => boolean, turns = 40): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe("project file import (real codec + IndexedDB + component)", () => {
  it("imports a valid file into a new project, loads it, and retargets autosave", async () => {
    const db = await freshDb("bitbounce-test-fileio-ok");
    const before = docStore.getState().doc;
    const boot = await initPersistence({ db });

    const exported = { ...createDefaultProject(), name: "friend song" };
    const file = new File([encode(exported)], "friend.bitbounce.json", {
      type: "application/json",
    });

    const ui = mountFileIO();
    try {
      setInputFiles(ui.input, file);

      await waitFor(() => docStore.getState().doc.name === "friend song (imported)");
      expect(docStore.getState().doc).toEqual({ ...exported, name: "friend song (imported)" });

      // No error toast on success.
      expect(document.body.querySelector('[role="alert"] .toast')).toBeNull();

      // New row persisted under a fresh id; the boot row untouched.
      const rows = await db.allRecords();
      expect(rows).toHaveLength(2);
      const importedRow = rows.find((r) => r.name === "friend song (imported)");
      expect(importedRow).toBeDefined();
      expect(importedRow!.id).not.toBe(boot.projectId);

      // Autosave retargeted: an edit after import flushes into the NEW row.
      docStore.setState({ doc: { ...docStore.getState().doc, name: "friend song (imported)" } });
      const edited = { ...docStore.getState().doc, transport: { ...docStore.getState().doc.transport, bpm: 140 } };
      docStore.setState({ doc: edited });
      await new Promise((r) => setTimeout(r, 1200)); // debounce (800ms) + idb
      const row = (await db.allRecords()).find((r) => r.name.startsWith("friend song"));
      expect(row).toBeDefined();
      expect(JSON.parse(row!.json).transport.bpm).toBe(140);
      expect(row!.dirty).toBe(false);
    } finally {
      ui.cleanup();
      clearToasts();
      // Stop whatever controller the boot module CURRENTLY holds — a
      // successful import replaced it via switchToProject, and a leaked
      // subscription would pollute later suites' autosave observations.
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });

  it("shows a dismissible role=alert toast for a corrupt file", async () => {
    const db = await freshDb("bitbounce-test-fileio-corrupt");
    const before = docStore.getState().doc;
    await initPersistence({ db });

    const bad = { ...createDefaultProject(), transport: { ...createDefaultProject().transport, bpm: 9999 } };
    const file = new File([JSON.stringify(bad)], "bad.bitbounce.json", { type: "application/json" });

    const ui = mountFileIO();
    try {
      setInputFiles(ui.input, file);

      const toast = await (async () => {
        for (let i = 0; i < 40; i++) {
          const el = document.body.querySelector<HTMLElement>('[role="alert"] .toast');
          if (el) return el;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error("toast never appeared");
      })();

      expect(toast.textContent).toContain("damaged");
      expect(toast.textContent).toContain("Re-export");
      // Store untouched, nothing persisted.
      expect(docStore.getState().doc).toBe(before);
      expect(await db.allRecords()).toHaveLength(1);

      // Dismiss (a real, keyboard-reachable button) removes the toast.
      const dismiss = toast.querySelector<HTMLButtonElement>("button");
      expect(dismiss).not.toBeNull();
      dismiss!.click();
      await waitFor(() => document.body.querySelector('[role="alert"] .toast') === null);
      expect(document.body.querySelector('[role="alert"] .toast')).toBeNull();
    } finally {
      ui.cleanup();
      clearToasts();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: before });
    }
  });
});
