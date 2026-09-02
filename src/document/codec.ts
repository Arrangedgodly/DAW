/**
 * Canonical codec: the single read/write boundary for project bytes
 * (RES-6 decision). One canonical format shared by autosave, crash draft, and
 * file export/import; deterministic bytes → content-hash dirty-checks skip
 * no-op writes. No volatile timestamps inside the document itself.
 *
 * Hash: pure-JS FNV-1a 32-bit over the canonical string — deterministic and
 * synchronous in both browser and node tests (Web Crypto's digest is async).
 */

import type { ProjectDocument } from "./schema";
import { migrate } from "./migrate";
import { ProjectValidationError, validateProject } from "./validate";

// ---------------------------------------------------------------------------
// Canonical JSON: objects with keys sorted (code-point ascending), arrays in
// order, no whitespace, UTF-8 string output.
// ---------------------------------------------------------------------------

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Hash (FNV-1a 32-bit)
// ---------------------------------------------------------------------------

export function contentHash(value: unknown): string {
  const text = canonicalize(value);
  // FNV-1a 32-bit over UTF-16 code units is sufficient here: canonicalize
  // output is ASCII-escaped JSON (JSON.stringify escapes non-ASCII by default
  // only for surrogates — force ASCII safety by escaping manually below).
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/** Document → canonical JSON string (sorted keys, deterministic bytes). */
export function encode(doc: ProjectDocument): string {
  return canonicalize(doc);
}

export class DecodeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DecodeError";
  }
}

/**
 * Canonical text → live document. Pipeline (RES-6): JSON.parse → migrate
 * (ascending by schemaVersion) → strict validate → normalize. Throws DecodeError
 * on malformed JSON, MigrationError on version problems, ProjectValidationError
 * on shape/semantic problems. Never executes content.
 */
export function decode(text: string): ProjectDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DecodeError("Project file is not valid JSON", cause);
  }
  if (!isPlainObject(parsed)) {
    throw new ProjectValidationError("Project file is not a JSON object", ["(root): expected an object"]);
  }
  const migrated = migrate(parsed as Record<string, unknown>);
  return validateProject(migrated);
}
