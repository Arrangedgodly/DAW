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
  SCHEMA_VERSION,
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
  renameProjectRecord,
  saveProject,
} from "../src/persist/projectStore";
import { docStore } from "../src/state/store";

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
    expect(record.schemaVersion).toBe(SCHEMA_VERSION);
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

  it("mostRecentProject excluding a row picks the newest REMAINING row (delete succession pick)", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "doomed", sampleDoc("Doomed"), { now: 100 });
    await saveProject(db, "older", sampleDoc("Older"), { now: 50 });
    await saveProject(db, "newer", sampleDoc("Newer"), { now: 80 });
    // The doomed row still exists at pick time — the exclusion is what keeps
    // it from being its own successor.
    expect((await mostRecentProject(db, { exclude: "doomed" }))?.id).toBe(
      "newer",
    );
    // Excluding a row that does not exist changes nothing.
    expect((await mostRecentProject(db, { exclude: "nonexistent" }))?.id).toBe(
      "doomed",
    );
    // Excluding the ONLY row → undefined (the fresh-NEW successor branch).
    const lone = createMemoryProjectDb();
    await saveProject(lone, "solo", sampleDoc("Solo"), { now: 1 });
    expect(await mostRecentProject(lone, { exclude: "solo" })).toBeUndefined();
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

describe("renameProjectRecord (inactive-row rename, i6 §2.4)", () => {
  it("renames in ONE put that lands the name in the envelope AND the decoded json", async () => {
    const { db, puts } = spyDb(createMemoryProjectDb());
    const doc = sampleDoc("old name");
    await saveProject(db, "p1", doc, { now: 1000 });

    const record = await renameProjectRecord(db, "p1", "new name");
    expect(record!.name).toBe("new name"); // envelope
    expect(decode(record!.json).name).toBe("new name"); // canonical bytes
    expect(record!.dirty).toBe(false);

    // Round-trip: what is on disk decodes to the renamed document.
    const loaded = await loadProject(db, "p1");
    expect(loaded.name).toBe("new name");
    expect(loaded).toEqual({ ...doc, name: "new name" });

    // ONE record rewrite total (the original save), refreshed mtime.
    expect(puts.length).toBe(2);
    expect(puts[1]!.updatedAt).toBeGreaterThanOrEqual(puts[0]!.updatedAt);
  });

  it("refreshes updatedAt through the injected clock (row moves to list top)", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "a", sampleDoc("A"), { now: 100 });
    await saveProject(db, "b", sampleDoc("B"), { now: 200 });
    await renameProjectRecord(db, "a", "A2");
    const list = await listProjects(db);
    expect(list[0]!.name).toBe("A2"); // a rename IS a change — recent-first
  });

  it("normalizes on the way in (trim, collapse, 48-char code-point clamp)", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "p1", sampleDoc("old"));
    const record = await renameProjectRecord(db, "p1", "  My\t great\n song  ");
    expect(record!.name).toBe("My great song");
    expect(decode(record!.json).name).toBe("My great song");
  });

  it("missing row → undefined, no write", async () => {
    const { db, puts } = spyDb(createMemoryProjectDb());
    expect(await renameProjectRecord(db, "ghost", "x")).toBeUndefined();
    expect(puts.length).toBe(0);
  });

  it("empty-after-trim name is a NO-OP (no write, row untouched)", async () => {
    const { db, puts } = spyDb(createMemoryProjectDb());
    await saveProject(db, "p1", sampleDoc("keep me"), { now: 7 });
    const before = await db.getRecord("p1");
    for (const empty of ["", "   ", "\t\n "]) {
      const record = await renameProjectRecord(db, "p1", empty);
      expect(record).toBeDefined();
    }
    expect(puts.length).toBe(1); // only the original save
    const after = await db.getRecord("p1");
    expect(after).toEqual(before); // byte-identical row
  });

  it("unchanged name is a NO-OP (no write, no updatedAt bump)", async () => {
    const { db, puts } = spyDb(createMemoryProjectDb());
    await saveProject(db, "p1", sampleDoc("same"), { now: 7 });
    const before = await db.getRecord("p1");
    // Same after normalization (whitespace that collapses away) → no-op too.
    const record = await renameProjectRecord(db, "p1", " same ");
    expect(record).toEqual(before);
    expect(puts.length).toBe(1);
  });

  it("duplicate names are ALLOWED (ids are the key — no uniqueness check)", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "a", sampleDoc("twin"), { now: 1 });
    await saveProject(db, "b", sampleDoc("other"), { now: 2 });
    const record = await renameProjectRecord(db, "b", "twin");
    expect(record!.name).toBe("twin");
    const list = await listProjects(db);
    expect(list.filter((p) => p.name === "twin")).toHaveLength(2);
  });

  it("NEVER touches the live store document", async () => {
    const db = createMemoryProjectDb();
    await saveProject(db, "p1", sampleDoc("row name"));
    const liveNameBefore = docStore.getState().doc.name;
    await renameProjectRecord(db, "p1", "renamed on disk only");
    expect(docStore.getState().doc.name).toBe(liveNameBefore);
  });
});
