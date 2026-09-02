import { describe, expect, it } from "vitest";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  MigrationError,
  migrate,
  migrateWith,
  type MigrationRegistry,
} from "../src/document/migrate";
import { createDefaultProject } from "../src/document/schema";
import { decode } from "../src/document/codec";
import { ProjectValidationError } from "../src/document/validate";

describe("migration framework", () => {
  it("v1 is identity: current-version docs pass through untouched", () => {
    const doc = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    expect(migrate(doc)).toEqual(doc);
  });

  it("production registry is empty at v1 (no migrations shipped yet)", () => {
    expect(Object.keys(MIGRATIONS)).toHaveLength(0);
    expect(LATEST_SCHEMA_VERSION).toBe(1);
  });

  it("refuses docs with no integer version >= 1", () => {
    expect(() => migrate({})).toThrow(MigrationError);
    expect(() => migrate({ version: "1" })).toThrow(MigrationError);
    expect(() => migrate({ version: 0 })).toThrow(MigrationError);
    expect(() => migrate({ version: 1.5 })).toThrow(MigrationError);
  });

  it("refuses future versions", () => {
    expect(() => migrate({ version: 2, name: "x" })).toThrow(/newer than supported/);
  });

  it("applies a synthetic v0 → v1 migration ascending", () => {
    // Synthetic historical shape: a pre-release doc where lanes were called
    // "tracks" and there was no transport.metronome flag.
    const v0 = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    v0["version"] = 0;
    v0["tracks"] = v0["lanes"];
    delete v0["lanes"];
    delete (v0["transport"] as Record<string, unknown>)["metronome"];

    const registry: MigrationRegistry = {
      0: (doc) => {
        const { tracks: lanes, ...rest } = doc;
        return {
          ...rest,
          version: 1,
          lanes,
          transport: { ...(doc["transport"] as Record<string, unknown>), metronome: false },
        };
      },
    };

    const migrated = migrateWith(registry, v0, 1);
    expect(migrated["version"]).toBe(1);
    expect(migrated["lanes"]).toBeDefined();
    expect((migrated["transport"] as Record<string, unknown>)["metronome"]).toBe(false);

    // And the migrated doc now validates through the full codec pipeline.
    const revived = decode(JSON.stringify(migrated));
    expect(revived.transport.metronome).toBe(false);
  });

  it("walks multiple steps in order and enforces version stamping", () => {
    const order: number[] = [];
    const registry: MigrationRegistry = {
      1: (doc) => {
        order.push(1);
        return { ...doc, version: 2 };
      },
      2: (doc) => {
        order.push(2);
        return { ...doc, version: 3 };
      },
    };
    const doc = { version: 1, name: "x" };
    const out = migrateWith(registry, doc, 3);
    expect(out["version"]).toBe(3);
    expect(order).toEqual([1, 2]);

    const badRegistry: MigrationRegistry = {
      1: (doc) => ({ ...doc }), // forgot to stamp version 2
    };
    expect(() => migrateWith(badRegistry, { version: 1 }, 2)).toThrow(/did not stamp/);
  });

  it("errors when a migration step is missing", () => {
    expect(() => migrateWith({}, { version: 1 }, 2)).toThrow(/No migration registered/);
  });

  it("decode still validates strictly after migration (migrations are not a bypass)", () => {
    const registry: MigrationRegistry = {
      0: (doc) => ({ ...doc, version: 1, evil: "payload" }),
    };
    const v0 = { version: 0 };
    const migrated = migrateWith(registry, v0, 1);
    expect(() => decode(JSON.stringify(migrated))).toThrow(ProjectValidationError);
  });
});
