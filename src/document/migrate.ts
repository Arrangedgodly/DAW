/**
 * Doc-level migration framework (RES-6 decision: migrations run ascending by
 * schemaVersion BEFORE validation; DB-level idb upgrades are a separate concern).
 *
 * Registry maps a source version N → migration producing version N+1. `migrate`
 * walks from the document's `version` up to LATEST_SCHEMA_VERSION, then stamps
 * the final version. v1 = identity (registry has no v1 entry — nothing below 1
 * shipped). Synthetic older versions can be registered in tests (and, later,
 * here) without touching the walk.
 */

import { SCHEMA_VERSION } from "./schema";

export type Migration = (
  doc: Record<string, unknown>,
) => Record<string, unknown>;

/** version N → transform to N+1. */
export type MigrationRegistry = Readonly<Record<number, Migration>>;

/** Production registry. v1 is the base schema: no migrations yet. */
export const MIGRATIONS: MigrationRegistry = {};

export const LATEST_SCHEMA_VERSION = SCHEMA_VERSION;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export function migrateWith(
  registry: MigrationRegistry,
  doc: Record<string, unknown>,
  latest: number = LATEST_SCHEMA_VERSION,
): Record<string, unknown> {
  const version = doc["version"];
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 0
  ) {
    throw new MigrationError(
      `Document has no integer schema version >= 0 (got ${String(version)})`,
    );
  }
  if (version > latest) {
    throw new MigrationError(
      `Document version ${version} is newer than supported version ${latest} (future doc — refuse to load)`,
    );
  }
  let current = doc;
  for (let v = version; v < latest; v++) {
    const step = registry[v];
    if (!step) {
      throw new MigrationError(
        `No migration registered from version ${v} to ${v + 1}`,
      );
    }
    current = step(current);
    const next = current["version"];
    if (next !== v + 1) {
      throw new MigrationError(
        `Migration ${v}→${v + 1} did not stamp version ${v + 1} (got ${String(next)})`,
      );
    }
  }
  return current;
}

/** Production entry point: migrate an unknown-shape doc to the latest version. */
export function migrate(doc: Record<string, unknown>): Record<string, unknown> {
  return migrateWith(MIGRATIONS, doc);
}
