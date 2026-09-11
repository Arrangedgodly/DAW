/**
 * HU-3 unit tests — autosave/recovery UX:
 *  - relativeTime buckets (pure clock math);
 *  - SaveIndicator label machine (pure status × lastSavedAt × now);
 *  - draft-recovery toast conditionality (dirty row announces, clean row
 *    silent) through the real initPersistence against the in-memory ProjectDb;
 *  - project-switch ordering + no-clobber through boot.switchToProject;
 *  - delete succession (i6): a pending flush can never resurrect the deleted
 *    active row, the last song lands on a fresh NEW successor, inactive rows
 *    delete through the plain path, missing rows no-op.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime, fullTimestamp } from "../src/lib/reltime";
import { indicatorLabel } from "../src/lib/saveIndicator";
import { createMemoryProjectDb, type ProjectDb } from "../src/persist/db";
import { saveProject, getProjectRecord } from "../src/persist/projectStore";
import { createNewProject } from "../src/persist/newProject";
import {
  deleteProjectSafe,
  getActiveProjectId,
  initPersistence,
  getAutosaveController,
  switchToProject,
} from "../src/persist/boot";
import { docStore, loadDocument } from "../src/state/store";
import { clearToasts, toastStack } from "../src/state/toasts";
import { decode } from "../src/document/codec";
import type { ProjectDocument } from "../src/document/schema";

const T0 = 1_700_000_000_000;

describe("relativeTime", () => {
  it("buckets coarse ages", () => {
    expect(relativeTime(T0, T0)).toBe("just now");
    expect(relativeTime(T0 - 4_999, T0)).toBe("just now");
    expect(relativeTime(T0 - 12_000, T0)).toBe("12s ago");
    expect(relativeTime(T0 - 65_000, T0)).toBe("1m ago");
    expect(relativeTime(T0 - 3 * 60_000, T0)).toBe("3m ago");
    expect(relativeTime(T0 - 2 * 3_600_000, T0)).toBe("2h ago");
    expect(relativeTime(T0 - 4 * 86_400_000, T0)).toBe("4d ago");
  });

  it("never returns negative ages", () => {
    expect(relativeTime(T0 + 5_000, T0)).toBe("just now");
  });

  it("fullTimestamp is a non-empty locale string", () => {
    expect(fullTimestamp(T0).length).toBeGreaterThan(0);
  });
});

describe("SaveIndicator label machine", () => {
  it("walks the state machine with and without a last-saved mtime", () => {
    expect(indicatorLabel("idle", null, T0)).toBe("AUTOSAVE ON");
    expect(indicatorLabel("idle", T0 - 12_000, T0)).toBe("SAVED 12S AGO");
    expect(indicatorLabel("saved", T0, T0)).toBe("SAVED JUST NOW");
    expect(indicatorLabel("saved", null, T0)).toBe("SAVED");
    expect(indicatorLabel("dirty", T0, T0)).toBe("UNSAVED CHANGES");
    expect(indicatorLabel("saving", T0, T0)).toBe("SAVING…");
    expect(indicatorLabel("error", T0, T0)).toBe("SAVE FAILED — RETRYING");
  });
});

describe("draft-recovery toast conditionality (boot)", () => {
  const restore = docStore.getState().doc;

  afterEach(async () => {
    await getAutosaveController()?.stop();
    loadDocument(restore);
    clearToasts();
    vi.useRealTimers();
  });

  it("a dirty most-recent row still loads AND announces recovery, then clears the flag", async () => {
    const db = createMemoryProjectDb();
    const crashed: ProjectDocument = { ...restore, name: "crashed song" };
    await saveProject(db, "recent", crashed, { now: T0, dirty: true });
    // An older clean row must lose to the dirty one.
    await saveProject(
      db,
      "older",
      { ...crashed, name: "older" },
      { now: T0 - 999, dirty: false },
    );

    const result = await initPersistence({ db, now: () => T0 });
    expect(result.restored).toBe(true);
    expect(result.projectId).toBe("recent");
    expect(docStore.getState().doc).toEqual(crashed); // STILL loads the draft

    const toasts = toastStack();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.kind).toBe("info");
    expect(toasts[0]!.message).toContain("RECOVERED UNSAVED WORK");
    expect(toasts[0]!.message).toContain("last change");

    // Recovery consumes the flag: bytes untouched, dirty cleared.
    const row = await getProjectRecord(db, "recent");
    expect(row!.dirty).toBe(false);
    expect(decode(row!.json)).toEqual(crashed);
  });

  it("a clean most-recent row loads silently (no toast)", async () => {
    const db = createMemoryProjectDb();
    await saveProject(
      db,
      "recent",
      { ...restore, name: "tidy song" },
      { now: T0, dirty: false },
    );

    const result = await initPersistence({ db, now: () => T0 });
    expect(result.restored).toBe(true);
    expect(docStore.getState().doc.name).toBe("tidy song");
    expect(toastStack()).toHaveLength(0);
  });
});

describe("project switching ordering (no-clobber)", () => {
  const restore = docStore.getState().doc;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await getAutosaveController()?.stop();
    loadDocument(restore);
    clearToasts();
    vi.useRealTimers();
  });

  it("retargets autosave BEFORE the new doc lands — the old row never receives new bytes", async () => {
    const db = createMemoryProjectDb();
    await initPersistence({ db, now: () => T0 });

    // Edit project A (the boot row), leave it pending (dirty-marked, no flush).
    docStore.setState({ doc: { ...docStore.getState().doc, name: "alpha" } });
    await vi.advanceTimersByTimeAsync(0); // microtasks: dirty-mark write settles

    // Start project B and switch exactly like the popover does.
    const b = await createNewProject(db, { now: () => T0 + 1 });
    await switchToProject(b.record.id); // flush+stop A, start B — BEFORE load
    loadDocument(b.doc); // only now does the store carry B's bytes

    // Edit B and let its debounce flush.
    docStore.setState({ doc: { ...b.doc, name: "beta" } });
    await vi.advanceTimersByTimeAsync(800);

    const rowA = await getProjectRecord(db, "default");
    const rowB = await getProjectRecord(db, b.record.id);
    expect(decode(rowA!.json).name).toBe("alpha"); // A got A's edits (stop-flush)
    expect(rowA!.dirty).toBe(false);
    expect(decode(rowB!.json).name).toBe("beta"); // B got B's edits only
    expect(rowB!.dirty).toBe(false);
  });
});

describe("delete succession (i6 — anti-resurrection)", () => {
  const restore = docStore.getState().doc;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await getAutosaveController()?.stop();
    loadDocument(restore);
    clearToasts();
    vi.useRealTimers();
  });

  it("a pending debounced flush can never resurrect the deleted ACTIVE row — the writeChain ordering wins", async () => {
    // Teeth: every put of the DOOMED row is delayed by a fake timer, so the
    // flush is genuinely in-flight (writeChain not drained) when the delete
    // starts; ops records the interleaving. The delete must observe every
    // put settle BEFORE the row is removed — and nothing may put after.
    const base = createMemoryProjectDb();
    const ops: string[] = [];
    const doomedId = "default"; // the row an empty boot activates
    const db: ProjectDb = {
      ...base,
      async putRecord(record) {
        ops.push(`put:${record.id}`);
        if (record.id === doomedId) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return base.putRecord(record);
      },
      async deleteRecord(id) {
        ops.push(`del:${id}`);
        return base.deleteRecord(id);
      },
    };

    const booted = initPersistence({ db, now: () => T0 }); // demo row "default"
    await vi.advanceTimersByTimeAsync(20); // drive the delayed boot save
    await booted;
    expect(getActiveProjectId()).toBe(doomedId);

    // A successor row, older than the boot row (most-recent REMAINING pick).
    await saveProject(
      db,
      "other",
      { ...docStore.getState().doc, name: "other song" },
      { now: T0 - 1000 },
    );

    // Arm the race: edit the ACTIVE doc. The dirty-mark put queues on the
    // writeChain and the 800 ms debounce timer is live when delete starts.
    docStore.setState({ doc: { ...docStore.getState().doc, name: "alpha" } });
    await vi.advanceTimersByTimeAsync(10); // dirty-mark write settles

    // Run the succession WHILE the doomed row's final flush is in flight.
    const deleting = deleteProjectSafe(doomedId);
    await vi.advanceTimersByTimeAsync(100); // stop()'s final flush + chain
    const result = await deleting;

    expect(result!.wasActive).toBe(true);
    expect(result!.successorId).toBe("other");
    expect(result!.held.id).toBe(doomedId);
    // The hold carries the FINAL flushed state — every committed edit ("alpha"
    // included) survives into the UNDO payload; no work is lost.
    expect(decode(result!.held.json).name).toBe("alpha");
    expect(result!.held.dirty).toBe(false);

    // The delete landed after the last put of the doomed row (order-of-ops).
    expect(ops.lastIndexOf(`del:${doomedId}`)).toBeGreaterThan(
      ops.lastIndexOf(`put:${doomedId}`),
    );

    // The app switched to the successor BEFORE the delete: active id, live doc.
    expect(getActiveProjectId()).toBe("other");
    expect(docStore.getState().doc.name).toBe("other song");

    // THE pin: the row is gone and STAYS gone past every writer cadence
    // (800 ms debounce, 30 s interval) — no resurrection.
    expect(await db.getRecord(doomedId)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await db.getRecord(doomedId)).toBeUndefined();

    // The successor row was never touched by the doomed writer, and the NEW
    // controller writes the successor row normally.
    const otherRow = await db.getRecord("other");
    expect(decode(otherRow!.json).name).toBe("other song");
    docStore.setState({ doc: { ...docStore.getState().doc, name: "beta" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(decode((await db.getRecord("other"))!.json).name).toBe("beta");
    expect(await db.getRecord(doomedId)).toBeUndefined();
  });

  it("deleting the LAST remaining song lands on a fresh NEW successor (never zero rows)", async () => {
    const db = createMemoryProjectDb();
    const booted = initPersistence({ db, now: () => T0 }); // only row: demo
    await vi.advanceTimersByTimeAsync(20);
    await booted;
    const doomedId = getActiveProjectId()!;

    // Leave a pending edit behind — the delete must still succeed cleanly.
    docStore.setState({ doc: { ...docStore.getState().doc, name: "solo" } });

    const deleting = deleteProjectSafe(doomedId);
    await vi.advanceTimersByTimeAsync(50);
    const result = await deleting;

    expect(result!.wasActive).toBe(true);
    expect(result!.successorId).toBeTruthy();
    expect(result!.successorId).not.toBe(doomedId);

    // Fresh successor: a real row, Untitled, and the app is IN it.
    const successorRow = await db.getRecord(result!.successorId!);
    expect(successorRow).toBeDefined();
    expect(decode(successorRow!.json).name).toBe("Untitled");
    expect(decode(result!.held.json).name).toBe("solo"); // hold kept the work
    expect(getActiveProjectId()).toBe(result!.successorId);
    expect(docStore.getState().doc.name).toBe("Untitled");

    expect(await db.getRecord(doomedId)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await db.getRecord(doomedId)).toBeUndefined();
  });

  it("deleting an INACTIVE row is the plain path: gone, active row and its controller untouched", async () => {
    const db = createMemoryProjectDb();
    await initPersistence({ db, now: () => T0 }); // active: "default"
    await saveProject(
      db,
      "other",
      { ...docStore.getState().doc, name: "other song" },
      { now: T0 + 5 },
    );

    // Pending edit on the ACTIVE row at delete time.
    docStore.setState({ doc: { ...docStore.getState().doc, name: "wip" } });
    await vi.advanceTimersByTimeAsync(0);

    const result = await deleteProjectSafe("other");
    expect(result!.wasActive).toBe(false);
    expect(result!.successorId).toBeNull();
    expect(result!.held.id).toBe("other");
    expect(decode(result!.held.json).name).toBe("other song");

    expect(await db.getRecord("other")).toBeUndefined();
    expect(getActiveProjectId()).toBe("default"); // no retarget happened

    // The active controller kept running: the pending edit flushes normally.
    await vi.advanceTimersByTimeAsync(800);
    expect(decode((await db.getRecord("default"))!.json).name).toBe("wip");
  });

  it("a missing row is a no-op (null, nothing deleted, nothing switched)", async () => {
    const db = createMemoryProjectDb();
    await initPersistence({ db, now: () => T0 });

    expect(await deleteProjectSafe("ghost")).toBeNull();
    expect(getActiveProjectId()).toBe("default");
    expect((await db.allRecords()).map((r) => r.id)).toEqual(["default"]);
  });
});
