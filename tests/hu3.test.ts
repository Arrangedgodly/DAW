/**
 * HU-3 unit tests — autosave/recovery UX:
 *  - relativeTime buckets (pure clock math);
 *  - SaveIndicator label machine (pure status × lastSavedAt × now);
 *  - draft-recovery toast conditionality (dirty row announces, clean row
 *    silent) through the real initPersistence against the in-memory ProjectDb;
 *  - project-switch ordering + no-clobber through boot.switchToProject.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime, fullTimestamp } from "../src/lib/reltime";
import { indicatorLabel } from "../src/lib/saveIndicator";
import { createMemoryProjectDb } from "../src/persist/db";
import { saveProject, getProjectRecord } from "../src/persist/projectStore";
import { createNewProject } from "../src/persist/newProject";
import {
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
