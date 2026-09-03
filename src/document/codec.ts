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

/**
 * Prototype-pollution-proof key copy (CA-2). A plain assignment
 * `out[key] = v` would, for the key "__proto__", replace the object's
 * PROTOTYPE instead of defining an own property — a pollution vector if a
 * hostile key ever reached this function. defineProperty always creates an
 * own enumerable property, so `{"__proto__":{...}}` survives as inert data
 * (and is then rejected by strict validation as an unknown key).
 */
function defineOwn(
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(out, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      defineOwn(out, key, sortValue((value as Record<string, unknown>)[key]));
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
// DoS guards (CA-2): applied to the raw text BEFORE JSON.parse
// ---------------------------------------------------------------------------

export class DecodeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DecodeError";
  }
}

/**
 * Hard cap on canonical text size at the codec layer (1 MB). This is a second
 * layer below MF-3's 10 MB File-size guard: even a small File (or a hostile
 * IndexedDB row / autosave string) cannot push a mega-string through the
 * parser. The largest real doc (4 lanes × 3 max-FX × 4-bar patterns) is a few
 * hundred KB; 1 MB leaves ample headroom while bounding parse work.
 */
export const DECODE_MAX_CHARS = 1_048_576;

/**
 * Hard cap on JSON nesting depth. JSON.parse itself has NO depth limit — a
 * few-KB `[[[[…]]]]` bomb parses to a stack-crushing structure and then
 * recurses again inside valibot/canonicalize. Legitimate documents nest at
 * most ~7 levels (root → patterns → lane → pattern → rows → row → steps), so
 * 64 is generous. Enforced by a linear pre-scan (scanJsonDepth) BEFORE
 * JSON.parse is ever called.
 */
export const DECODE_MAX_DEPTH = 64;

/** Thrown by the pre-parse guards; subclasses DecodeError so callers see one type. */
export class TextTooLargeError extends DecodeError {
  constructor(readonly length: number) {
    super(
      `Project text exceeds the ${DECODE_MAX_CHARS / 1024} KB decode limit (${length} chars)`,
    );
    this.name = "TextTooLargeError";
  }
}

/** Thrown when the pre-scan finds nesting deeper than DECODE_MAX_DEPTH. */
export class DepthLimitError extends DecodeError {
  constructor(readonly depth: number) {
    super(
      `Project JSON nests ${depth} levels deep (limit ${DECODE_MAX_DEPTH})`,
    );
    this.name = "DepthLimitError";
  }
}

/**
 * Iterative single-pass nesting scan (no recursion, O(n) time, O(1) memory
 * beyond the string): tracks bracket depth while skipping JSON string
 * literals (with escape handling). Returns the maximum depth seen; callers
 * above the cap reject before parsing. Because it is strictly linear with no
 * backtracking, it doubles as the operation-count bound for the fuzz harness
 * (a case cannot "hang" in the scan — it touches each char exactly once).
 */
export function scanJsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\")
        i++; // skip escaped char (handles \" and \\ correctly)
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) return max; // malformed: let JSON.parse report it properly
    }
  }
  return max;
}

/** Document → canonical JSON string (sorted keys, deterministic bytes). */
export function encode(doc: ProjectDocument): string {
  return canonicalize(doc);
}

/**
 * Canonical text → live document. Pipeline (RES-6): JSON.parse → migrate
 * (ascending by schemaVersion) → strict validate → normalize. Throws DecodeError
 * on malformed JSON, MigrationError on version problems, ProjectValidationError
 * on shape/semantic problems. Never executes content.
 */
export function decode(text: string): ProjectDocument {
  // CA-2 DoS guards, before any parsing: size cap + linear depth pre-scan.
  // JSON.parse/valibot recursion is unbounded; these two checks bound both
  // total work (<=1 MB input) and recursion depth (<=64) up front.
  if (text.length > DECODE_MAX_CHARS) {
    throw new TextTooLargeError(text.length);
  }
  const depth = scanJsonDepth(text);
  if (depth > DECODE_MAX_DEPTH) {
    throw new DepthLimitError(depth);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DecodeError("Project file is not valid JSON", cause);
  }
  if (!isPlainObject(parsed)) {
    throw new ProjectValidationError("Project file is not a JSON object", [
      "(root): expected an object",
    ]);
  }
  const migrated = migrate(parsed as Record<string, unknown>);
  return validateProject(migrated);
}
