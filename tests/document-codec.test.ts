import { describe, expect, it } from "vitest";
import {
  canonicalize,
  contentHash,
  decode,
  encode,
} from "../src/document/codec";
import {
  SCHEMA_VERSION,
  createDefaultProject,
  type ProjectDocument,
} from "../src/document/schema";
import { ProjectValidationError } from "../src/document/validate";
import { MigrationError } from "../src/document/migrate";
import { v1DefaultProjectText } from "./v1Project";

describe("encode/decode round-trip", () => {
  it("default project survives encode → decode unchanged", () => {
    const doc = createDefaultProject();
    const roundTripped = decode(encode(doc));
    expect(roundTripped).toEqual(doc);
  });

  it("mutated project round-trips", () => {
    const doc: ProjectDocument = JSON.parse(
      JSON.stringify(createDefaultProject()),
    );
    doc.transport.bpm = 174;
    doc.scale = { root: 9, mode: "phrygian" };
    doc.laneOverrides = { chords: { root: 4, mode: "lydian" } };
    doc.lanes[3].fxChain = [
      {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 6, feedback: 0.4, mix: 0.2 },
      },
    ];
    expect(decode(encode(doc))).toEqual(doc);
  });

  it("decode rejects invalid JSON with DecodeError", () => {
    expect(() => decode("{not json")).toThrow(/not valid JSON/);
    expect(() => decode("42")).toThrow(ProjectValidationError);
  });

  it("decode rejects structurally valid JSON of the wrong shape", () => {
    // No version field → migration layer refuses before validation ever runs.
    expect(() => decode(JSON.stringify({ hello: "world" }))).toThrow(
      /schema version/,
    );
    // Current version but wrong body → strict validation refuses.
    expect(() => decode(JSON.stringify({ version: 2 }))).toThrow(
      ProjectValidationError,
    );
    // v1 body without v1 pattern shape → typed migration refusal.
    expect(() => decode(JSON.stringify({ version: 1 }))).toThrow(
      MigrationError,
    );
  });

  it("SC-1: decode migrates v1 bytes to the current schema", () => {
    const migrated = decode(v1DefaultProjectText());
    expect(migrated.version).toBe(SCHEMA_VERSION);
    expect(migrated).toEqual(createDefaultProject());
  });
});

describe("canonical bytes", () => {
  it("sorts keys at every level", () => {
    expect(canonicalize({ b: 1, a: { z: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"z":1},"b":1}',
    );
  });

  it("is stable regardless of key insertion order", () => {
    const x = { z: 1, a: 2 };
    const y = { a: 2, z: 1 };
    expect(canonicalize(x)).toBe(canonicalize(y));
  });

  it("produces byte-identical output for the same logical doc", () => {
    const doc = createDefaultProject();
    const copy: ProjectDocument = JSON.parse(JSON.stringify(doc));
    expect(encode(doc)).toBe(encode(copy));
  });

  it("keeps array order (arrays are ordered, not sorted)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("contentHash", () => {
  it("is deterministic across key order", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it("changes when content changes", () => {
    const doc = createDefaultProject();
    const changed: ProjectDocument = JSON.parse(JSON.stringify(doc));
    changed.transport.bpm = 121;
    expect(contentHash(changed)).not.toBe(contentHash(doc));
  });

  it("is stable across calls and looks like 8 hex chars", () => {
    const h = contentHash(createDefaultProject());
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(h).toBe(contentHash(createDefaultProject()));
  });

  it('known-vector check (FNV-1a of canonical "1")', () => {
    // FNV-1a 32-bit of the byte '1' (0x31): documented reference value.
    expect(contentHash(1)).toBe("340ca71c");
  });
});
