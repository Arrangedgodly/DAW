/**
 * MF-2 browser tests — REAL IndexedDB in the served Chromium page:
 * save → fresh open (reload-context equivalent) → load → deep-equal, and the
 * crash-draft dirty flag under a controlled fake clock (marked after an
 * unflushed edit, cleared by the flush). DB names are unique per test so
 * suites never share rows.
 */

import { describe, expect, it, vi } from "vitest";
import { decode } from "../../src/document/codec";
import { docStore } from "../../src/state/store";
import { startAutosave } from "../../src/persist/autosave";
import { openRawProjectDb } from "../../src/persist/db";
import {
  getProjectRecord,
  loadProject,
  saveProject,
} from "../../src/persist/projectStore";

async function freshDb(name: string) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  return openRawProjectDb(name);
}

/**
 * Pump the REAL event loop so pending IndexedDB requests settle while fake
 * timers own setTimeout (fake clocks freeze timer-based settling, but IDB
 * success events still need turns). HU-3 deflake: this used to be a FIXED
 * turn count (12 macrotasks), which intermittently under-settled on loaded
 * CI — the dirty-mark's get+put chain needs a variable number of turns.
 * Polling until the assertion holds (generous cap) removes the race.
 */
async function waitForIdb(
  predicate: () => boolean | Promise<boolean>,
  maxTurns = 250,
): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });
  }
  throw new Error("IndexedDB state never settled within macrotask budget");
}

describe("IndexedDB persistence (real browser database)", () => {
  it("save → fresh open (reload context) → load → deep-equal", async () => {
    const db1 = await freshDb("bitbounce-test-roundtrip");
    const doc = docStore.getState().doc;
    const record = await saveProject(db1, "p1", doc, { now: 1234 });
    expect(record.schemaVersion).toBe(1);
    expect(record.dirty).toBe(false);

    // Reload-context equivalent: a brand-new connection to the same database
    // (fresh upgrade path, no cached state).
    const db2 = await openRawProjectDb("bitbounce-test-roundtrip");
    const loaded = await loadProject(db2, "p1");
    expect(loaded).toEqual(doc);
    expect(decode(record.json)).toEqual(loaded);
  });

  it("boot restore loads the most recent row into the store", async () => {
    const db = await freshDb("bitbounce-test-boot");
    const saved = { ...docStore.getState().doc, name: "boot-restore" };
    await saveProject(db, "recent", saved, { now: 50 });
    // An older row must lose to the newer one.
    await saveProject(db, "older", { ...saved, name: "older" }, { now: 10 });

    const { initPersistence } = await import("../../src/persist/boot");
    const result = await initPersistence({ db });
    expect(result.restored).toBe(true);
    expect(result.projectId).toBe("recent");
    expect(docStore.getState().doc).toEqual(saved);
    await result.controller.stop();
  });

  it("crash-draft dirty flag: set after an edit without flush, cleared after", async () => {
    vi.useFakeTimers();
    try {
      const db = await freshDb("bitbounce-test-crash");
      const before = docStore.getState().doc;
      const ctl = startAutosave({
        db,
        projectId: "draft",
        store: docStore,
        debounceMs: 800,
      });

      // Simulate a document commit (the autosave subscription observes it).
      docStore.setState({ doc: { ...before, name: "crash-draft" } });
      await waitForIdb(
        async () => (await getProjectRecord(db, "draft"))?.dirty === true,
      );

      expect(ctl.isPending()).toBe(true);

      await vi.advanceTimersByTimeAsync(800); // debounce flush
      await waitForIdb(async () => {
        const row = await getProjectRecord(db, "draft");
        return (
          row !== undefined &&
          row.dirty === false &&
          decode(row.json).name === "crash-draft"
        );
      });
      expect(ctl.getStatus()).toBe("saved");

      // Restore the store doc so later suites see the pre-test document.
      docStore.setState({ doc: before });
      await ctl.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
