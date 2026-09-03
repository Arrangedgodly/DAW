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
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { decode } from "../../src/document/codec";
import { docStore } from "../../src/state/store";
import { clearToasts } from "../../src/state/toasts";
import Projects from "../../src/components/Projects";
import Toasts from "../../src/components/Toasts";
import { getAutosaveController, initPersistence } from "../../src/persist/boot";
import { openRawProjectDb } from "../../src/persist/db";
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
