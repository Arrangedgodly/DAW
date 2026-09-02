/**
 * HU-2 corrupt-row quarantine: a boot row that fails codec validation is
 * RENAMED (never deleted), a fresh default loads, a sticky error toast with a
 * RECOVER action is pushed, and RECOVER exports the ORIGINAL raw bytes.
 * Also covers the NEW-project flow's no-clobber + autosave-retarget law.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryProjectDb,
  makeRecord,
  type ProjectDb,
  type ProjectRecord,
} from "../src/persist/db";
import { encode } from "../src/document/codec";
import { createDefaultProject } from "../src/document/schema";
import {
  QUARANTINE_MARK,
  exportQuarantinedBytes,
  quarantineFilename,
  quarantineProjectRecord,
} from "../src/persist/quarantine";
import type { DownloadSeam } from "../src/persist/fileIO";
import { initPersistence, getAutosaveController } from "../src/persist/boot";
import { docStore, toggleDrumStep, createFreshProjectDocument } from "../src/state/store";
import { clearToasts, toastStack } from "../src/state/toasts";
import { createNewProject } from "../src/persist/newProject";
import { isProjectEmpty } from "../src/state/emptyProject";

function badRecord(id = "default", name = "broken song"): ProjectRecord {
  const base = createDefaultProject();
  const bad = JSON.stringify({ ...base, transport: { ...base.transport, bpm: 9999 } });
  return { id, name, schemaVersion: 1, updatedAt: 1000, dirty: false, json: bad };
}

describe("quarantineProjectRecord", () => {
  it("renames the bad row (never deletes the bytes) and frees the original key", async () => {
    const db = createMemoryProjectDb();
    const bad = badRecord("default", "my song");
    await db.putRecord(bad);

    const q = await quarantineProjectRecord(db, bad, { now: () => 42 });

    expect(q.originalId).toBe("default");
    expect(q.quarantineId).toBe(`default${QUARANTINE_MARK}-42`);
    expect(q.json).toBe(bad.json); // bytes preserved verbatim
    const rows = await db.allRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(q.quarantineId);
    expect(rows[0]!.name).toBe("my song (corrupt)");
    expect(rows[0]!.json).toBe(bad.json);
    expect(await db.getRecord("default")).toBeUndefined();
  });

  it("avoids quarantine-id collisions with a counter suffix", async () => {
    const db = createMemoryProjectDb();
    const bad = badRecord("default");
    await db.putRecord(bad);
    await db.putRecord({ ...bad, id: `default${QUARANTINE_MARK}-42` });

    const q = await quarantineProjectRecord(db, bad, { now: () => 42 });
    expect(q.quarantineId).toBe(`default${QUARANTINE_MARK}-42-1`);
    expect((await db.allRecords()).length).toBe(2);
  });

  it("RECOVER downloads the ORIGINAL raw bytes under a .corrupt filename", async () => {
    const bad = badRecord("default", "my/song");
    expect(quarantineFilename("my/song (corrupt)")).toBe("mysong.corrupt.bitbounce.json");

    const downloads: { name: string; blob: Blob }[] = [];
    const seam: DownloadSeam = {
      createObjectURL: (blob) => {
        downloads.push({ name: "", blob });
        return "blob:0";
      },
      revokeObjectURL: () => undefined,
      createElement: () => ({ click: () => undefined, href: "", download: "" }),
    };
    const name = exportQuarantinedBytes({ name: "my song (corrupt)", json: bad.json }, seam);
    expect(name).toBe("my song.corrupt.bitbounce.json");
    expect(downloads).toHaveLength(1);
    expect(await downloads[0]!.blob.text()).toBe(bad.json);
  });
});

describe("boot quarantine flow (fake db)", () => {
  beforeEach(() => {
    clearToasts();
  });
  afterEach(async () => {
    await getAutosaveController()?.stop();
    docStore.setState({ doc: createFreshProjectDocument() });
    clearToasts();
  });

  it("bad row → renamed not deleted → fresh default loads → toast with RECOVER", async () => {
    const db = createMemoryProjectDb();
    const bad = badRecord("default", "broken song");
    await db.putRecord(bad);

    const boot = await initPersistence({
      db,
      newId: () => "fresh-1",
      now: () => 42,
    });

    // Quarantined: renamed, bytes kept, original key gone.
    const rows = await db.allRecords();
    expect(rows).toHaveLength(2);
    const qrow = rows.find((r) => r.id.includes(QUARANTINE_MARK));
    expect(qrow).toBeDefined();
    expect(qrow!.json).toBe(bad.json);
    expect(await db.getRecord("default")).toBeUndefined();

    // Fresh default loaded + is the autosave target.
    expect(boot.restored).toBe(false);
    expect(boot.quarantined?.quarantineId).toBe(qrow!.id);
    expect(isProjectEmpty(docStore.getState().doc)).toBe(true);
    expect(boot.projectId).toBe("fresh-1");
    toggleDrumStep("kick", 0); // an edit…
    docStore.setState({ doc: createFreshProjectDocument() }); // …reset for other suites

    // Sticky error toast explaining recovery, with the RECOVER action.
    const toasts = toastStack();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.kind).toBe("error");
    expect(toasts[0]!.message).toContain("broken song");
    expect(toasts[0]!.action?.label).toBe("RECOVER");
    expect(toasts[0]!.suggestion).toBeDefined();
  });

  it("a second boot does not trip over the quarantined row", async () => {
    const db = createMemoryProjectDb();
    const bad = badRecord("default", "broken song");
    await db.putRecord(bad);
    await initPersistence({ db, newId: () => "fresh-1", now: () => 42 });
    await getAutosaveController()!.stop();
    clearToasts();

    // The fresh project is newer than the quarantine row (autosave bumps it).
    const freshRow = await db.getRecord("fresh-1");
    await db.putRecord({ ...freshRow!, updatedAt: 9000 });

    const boot2 = await initPersistence({ db, newId: () => "fresh-2", now: () => 50 });
    expect(boot2.quarantined).toBeUndefined();
    expect(boot2.restored).toBe(true);
    await getAutosaveController()!.stop();
  });
});

describe("NEW project flow (createNewProject)", () => {
  it("persists a fresh empty default under a NEW id without touching the old row", async () => {
    const db: ProjectDb = createMemoryProjectDb();
    const original = makeRecord("default", createDefaultProject(), encode(createDefaultProject()), 1, false);
    await db.putRecord(original);

    const { record, doc } = await createNewProject(db, { newId: () => "new-1", now: () => 99 });
    expect(record.id).toBe("new-1");
    expect(doc.name).toBe("Untitled");
    expect(isProjectEmpty(doc)).toBe(true);

    const rows = await db.allRecords();
    expect(rows).toHaveLength(2);
    const kept = rows.find((r) => r.id === "default")!;
    expect(kept.json).toBe(original.json); // byte-identical, no clobber
  });
});
