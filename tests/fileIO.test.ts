/**
 * MF-3 unit tests — project file export/import over a fake idb.
 * Export must produce the canonical codec bytes (one byte format); import
 * covers every taxonomy branch (corrupt / future-version / not-json /
 * too-large / io) and the fresh-uuid no-clobber guarantee. The browser suite
 * (tests/browser/fileIO.test.ts) covers the real IndexedDB + toast path.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/document/codec";
import { createDefaultProject, type ProjectDocument } from "../src/document/schema";
import { createMemoryProjectDb } from "../src/persist/db";
import { saveProject } from "../src/persist/projectStore";
import {
  IMPORT_MAX_BYTES,
  exportProjectFile,
  importProjectFile,
  safeFileStem,
  type DownloadSeam,
} from "../src/persist/fileIO";

function sampleDoc(name = "Untitled"): ProjectDocument {
  return { ...createDefaultProject(), name };
}

function jsonFile(text: string, name = "p.bitbounce.json"): File {
  return new File([text], name, { type: "application/json" });
}

/** Captures the exported blob bytes without a real download. */
function captureSeam() {
  const blobs: Blob[] = [];
  const seam: DownloadSeam = {
    createObjectURL(blob) {
      blobs.push(blob);
      return `blob:fake-${blobs.length}`;
    },
    revokeObjectURL() {
      /* immediate revoke — bytes captured synchronously */
    },
    createElement() {
      return {
        click() {
          /* programmatic download — nothing to observe here */
        },
        href: "",
        download: "",
      };
    },
  };
  return { seam, blobs };
}

describe("exportProjectFile", () => {
  it("downloads the canonical codec bytes as <name>.bitbounce.json", async () => {
    const doc = sampleDoc("My Song");
    const { seam, blobs } = captureSeam();
    const filename = exportProjectFile(doc, seam);
    expect(filename).toBe("My Song.bitbounce.json");
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("application/json");
    const bytes = await blobs[0].text();
    expect(bytes).toBe(encode(doc)); // canonical bytes, one format
    expect(decode(bytes)).toEqual(doc); // and they round-trip
  });

  it("sanitizes path separators and empty names in the file stem", () => {
    expect(safeFileStem("a/b\\c")).toBe("abc");
    expect(safeFileStem("   ")).toBe("project");
  });
});

describe("importProjectFile — happy path (fake idb)", () => {
  it("imports as a NEW project: fresh uuid, suffixed name, original untouched", async () => {
    const db = createMemoryProjectDb();
    const original = sampleDoc("working");
    await saveProject(db, "working-id", original, { now: 1 });

    const exported = sampleDoc("from friend");
    const result = await importProjectFile(jsonFile(encode(exported)), db, {
      newId: () => "fresh-uuid",
      now: () => 500,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.id).toBe("fresh-uuid");
    expect(result.record.name).toBe("from friend (imported)");
    expect(result.doc.name).toBe("from friend (imported)");
    expect(result.doc).toEqual({ ...exported, name: "from friend (imported)" });

    // No clobber: both rows exist, the working project is byte-identical.
    const rows = await db.allRecords();
    expect(rows).toHaveLength(2);
    const working = await db.getRecord("working-id");
    expect(working?.json).toBe(encode(original));
  });
});

describe("importProjectFile — error taxonomy (no exceptions cross the API)", () => {
  it("not-json: malformed text", async () => {
    const result = await importProjectFile(jsonFile("{oops"), createMemoryProjectDb());
    expect(result).toMatchObject({ ok: false, kind: "not-json" });
  });

  it("corrupt: valid JSON that fails validation, first issues listed", async () => {
    const db = createMemoryProjectDb();
    const doc = sampleDoc();
    const bad = { ...doc, transport: { ...doc.transport, bpm: 9999 } };
    const result = await importProjectFile(jsonFile(JSON.stringify(bad)), db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("corrupt");
    expect(result.issues!.length).toBeGreaterThan(0);
    expect(result.issues!.length).toBeLessThanOrEqual(3);
    expect(result.suggestion.length).toBeGreaterThan(0);
    // Nothing was written.
    expect(await db.allRecords()).toHaveLength(0);
  });

  it("corrupt: unreadable schema version", async () => {
    const result = await importProjectFile(
      jsonFile(JSON.stringify({ name: "x", version: "one" })),
      createMemoryProjectDb(),
    );
    expect(result).toMatchObject({ ok: false, kind: "corrupt" });
  });

  it("future-version: version > current, message names both versions", async () => {
    const doc = sampleDoc();
    const future = JSON.stringify({ ...doc, version: 99 });
    const result = await importProjectFile(jsonFile(future), createMemoryProjectDb());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("future-version");
    expect(result.fileVersion).toBe(99);
    expect(result.appVersion).toBe(1);
    expect(result.message).toContain("v99");
    expect(result.message).toContain("v1");
  });

  it("too-large: rejects >10 MB before reading any text", async () => {
    let readFileCalled = false;
    const huge = { size: IMPORT_MAX_BYTES + 1 } as File;
    const result = await importProjectFile(huge, createMemoryProjectDb(), {
      readFile: () => {
        readFileCalled = true;
        return Promise.resolve("{}");
      },
    });
    expect(result).toMatchObject({ ok: false, kind: "too-large" });
    expect(readFileCalled).toBe(false); // guard fires before text is read
  });

  it("io: unreadable file and failed saves", async () => {
    const unreadable = await importProjectFile(jsonFile("{}"), createMemoryProjectDb(), {
      readFile: () => Promise.reject(new Error("gone")),
    });
    expect(unreadable).toMatchObject({ ok: false, kind: "io" });

    const failingDb = {
      ...createMemoryProjectDb(),
      putRecord: () => Promise.reject(new Error("quota")),
    };
    const unsavable = await importProjectFile(jsonFile(encode(sampleDoc())), failingDb);
    expect(unsavable).toMatchObject({ ok: false, kind: "io" });
  });
});

describe("import path security (Captain America)", () => {
  it("fileIO source contains no eval / Function constructors", () => {
    const source = readFileSync(new URL("../src/persist/fileIO.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\b/);
    expect(source).not.toMatch(/\bFunction\s*\(/);
  });
});
