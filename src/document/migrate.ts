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

import {
  LANE_IDS,
  type LaneGate,
  type PitchedRow,
  SCHEMA_VERSION,
  notesFromRowCells,
  resolveGateSteps,
} from "./schema";

export type Migration = (
  doc: Record<string, unknown>,
) => Record<string, unknown>;

/** version N → transform to N+1. */
export type MigrationRegistry = Readonly<Record<number, Migration>>;

/**
 * v1 → v2 (SC-1): pitched patterns move from cell rows to explicit notes
 * (duration-preserving law — see the SCHEMA v2 header in schema.ts): a v1 run
 * of note-on+sustain cells becomes ONE note of length `gateSteps + sustains`;
 * a lone note-on becomes a gate-length note. Drums patterns are untouched.
 * Everything else is carried verbatim; strict validation still runs after.
 * Throws MigrationError (never an untyped crash) on v1 shapes this cannot
 * faithfully convert — those documents were invalid in v1 too (validation
 * would have rejected the cells), and the caller reports a typed result with
 * the project untouched.
 */
function isPitchedRow(value: unknown): value is PitchedRow {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const row = value as Record<string, unknown>;
  return typeof row["degree"] === "number" && Array.isArray(row["steps"]);
}

function migrateV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  const transport = doc["transport"] as Record<string, unknown> | undefined;
  const bpm =
    typeof transport?.["bpm"] === "number" ? (transport["bpm"] as number) : 120;
  const patterns = doc["patterns"];
  if (
    patterns !== undefined &&
    (patterns === null ||
      typeof patterns !== "object" ||
      Array.isArray(patterns))
  ) {
    throw new MigrationError("migrate v1→v2: 'patterns' is not an object");
  }
  const nextPatterns: Record<string, unknown> = { ...(patterns as object) };
  const lanes = Array.isArray(doc["lanes"]) ? doc["lanes"] : [];
  for (const laneId of LANE_IDS) {
    if (laneId === "drums") continue; // drums patterns are unchanged in v2
    const laneConf = lanes.find(
      (l) =>
        l !== null &&
        typeof l === "object" &&
        (l as Record<string, unknown>)["id"] === laneId,
    ) as Record<string, unknown> | undefined;
    // Gate resolution needs the lane gate; missing/malformed lane → let the
    // migration fail typed (v1 validation would have rejected the doc too).
    if (
      !laneConf ||
      typeof laneConf["gate"] !== "object" ||
      laneConf["gate"] === null
    ) {
      throw new MigrationError(
        `migrate v1→v2: lane '${laneId}' has no gate object (cannot resolve note lengths)`,
      );
    }
    const gate = laneConf["gate"] as LaneGate;
    const gateSteps = resolveGateSteps(gate, bpm);
    const lanePatterns = nextPatterns[laneId];
    if (!Array.isArray(lanePatterns)) {
      throw new MigrationError(
        `migrate v1→v2: patterns.${laneId} is not an array`,
      );
    }
    nextPatterns[laneId] = lanePatterns.map((p, i) => {
      const pattern = p as Record<string, unknown>;
      if (pattern?.["kind"] !== "pitched") return p;
      const rows = pattern["rows"];
      if (!Array.isArray(rows) || !rows.every(isPitchedRow)) {
        throw new MigrationError(
          `migrate v1→v2: patterns.${laneId}[${i}].rows is not a v1 pitched row array (degree + steps) — cannot migrate`,
        );
      }
      const bars = pattern["bars"];
      const maxSteps =
        typeof bars === "number" && Number.isInteger(bars) ? bars * 16 : 16;
      let notes;
      try {
        notes = notesFromRowCells(rows, gateSteps, maxSteps);
      } catch (cause) {
        throw new MigrationError(
          `migrate v1→v2: patterns.${laneId}[${i}]: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      const { rows: _drop, ...rest } = pattern;
      void _drop;
      return {
        ...rest,
        rowDegrees: rows.map((row) => (row as PitchedRow).degree),
        notes,
      };
    });
  }
  return { ...doc, version: 2, patterns: nextPatterns };
}

/** Production registry. 1→2 = the SC-1 note-model migration. */
export const MIGRATIONS: MigrationRegistry = { 1: migrateV1ToV2 };

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
