/**
 * MF-2 unit tests — persistence envelope over a fake idb (in-memory ProjectDb
 * implementing exactly the narrow surface projectStore consumes). Round-trips
 * go through the real codec, so these cover the byte-format contract
 * (canonical json, schemaVersion stamp, dirty flag) without IndexedDB; the
 * browser suite covers the real database.
 */

import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/document/codec";
import {
  createDefaultProject,
  type ProjectDocument,
} from "../src/document/schema";
import {
  createMemoryProjectDb,
  type ProjectDb,
  type ProjectRecord,
} from "../src/persist/db";
import {
  deleteProject,
  listProjects,
  loadProject,
  mostRecentProject,
  saveProject,
} from "../src/persist/projectStore";

function sampleDoc(name = "Untitled"): ProjectDocument {
  return { ...createDefaultProject(), name };
}

/** Spy wrapper: records puts without changing semantics. */
function spyDb(base: ProjectDb) {
  const puts: ProjectRecord[] = [];
  return {
    db: {
      ...base,
      async putRecord(record: ProjectRecord) {
        puts.push(record);
        return base.putRecord(record);
      },
    } as ProjectDb,
    puts,
  };
}

describe("projectStore envelope (fake idb)", () => {
  it("save→load round-trips the document through the canonical codec", async () => {
    const db = createMemoryProjectDb();
    const doc = sampleDoc("round trip");
    const record = await saveProject(db, "p1", doc, { now: 1000 });
    expect(record.id).toBe("p1");
    expect(record.name).toBe("round trip");
    expect(record.schemaVersion).toBe(1);
    expect(record.updatedAt).toBe(1000);
    expect(record.dirty).toBe(false);
    expect(record.json).toBe(encode(doc)); // canonical bytes, one format

    const loaded = await loadProject(db, "p1");
    expect(loaded).toEqual(doc);
  });

  it("re-saving the same content is atomic and idempotent at the API level", async () => {
    const db = createMemoryProjectDb();
    const doc = sampleDoc();
    await saveProject(db, "p1", doc, { now: 1 });
    const again = await saveProject(db, "p1", doc, { now: 2, dirty: true });
    expect(again.updatedAt).toBe(2);
    const loaded = await loadProject(db, "p1");
    expect(loaded).toEqual(doc);
  });

  it("listProjects returns metadata only, most recent first", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "old", sampleDoc("Old"), { now: 100 });
    await saveProject(db, "new", sampleDoc("New"), { now: 300 });
    await saveProject(db, "mid", sampleDoc("Mid"), { now: 200, dirty: true });

    const list = await listProjects(db);
    expect(list.map((p) => p.id)).toEqual(["new", "mid", "old"]);
    expect(list[1]).toEqual({
      id: "mid",
      name: "Mid",
      updatedAt: 200,
      dirty: true,
    });
    // Metadata only — no document bytes leak into the listing.
    expect(JSON.stringify(list)).not.toContain("songChain");
  });

  it("mostRecentProject picks the newest row", async () => {
    const db = createMemoryProjectDb();
    expect(await mostRecentProject(db)).toBeUndefined();
    await saveProject(db, "a", sampleDoc("A"), { now: 5 });
    await saveProject(db, "b", sampleDoc("B"), { now: 9 });
    expect((await mostRecentProject(db))?.id).toBe("b");
  });

  it("deleteProject removes a row and reports whether one existed", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "p1", sampleDoc());
    expect(await deleteProject(db, "p1")).toBe(true);
    expect(await deleteProject(db, "p1")).toBe(false);
    await expect(loadProject(db, "p1")).rejects.toThrow(/no project/);
  });

  it("corrupt json fails decoding at load (not at save) with DecodeError", async () => {
    const db = createMemoryProjectDb();
    await db.putRecord({
      id: "bad",
      name: "bad",
      schemaVersion: 1,
      updatedAt: 1,
      dirty: false,
      json: "{not json",
    });
    await expect(loadProject(db, "bad")).rejects.toThrow();
    try {
      await loadProject(db, "bad");
      expect.unreachable("should throw");
    } catch (error) {
      expect((error as Error).name).toBe("DecodeError");
    }
  });

  it("spy records see full-envelope puts (single put per save)", async () => {
    const { db, puts } = spyDb(createMemoryProjectDb());
    await saveProject(db, "p1", sampleDoc());
    expect(puts.length).toBe(1);
    expect(decode(puts[0]!.json).name).toBe("Untitled");
  });
});
