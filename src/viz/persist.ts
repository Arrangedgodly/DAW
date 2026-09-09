/**
 * VZ-IM-3 — the viz prefs STORE: last-preset + last-seed memory in ONE
 * versioned localStorage key, with the silent fallback law.
 *
 * WHAT THIS MODULE IS (and is not):
 * - It IS the product's lightweight viz memory: the envelope
 *   `{ version: 1, presetId, seed }` (VizArrangementEnvelope, VZ-MF-1) is
 *   everything needed to re-deal the exact rig the user left — nodes are
 *   never persisted, they are recomputed from (preset, seed) by
 *   generateArrangement, so the key stays ~60 bytes forever.
 * - It is NOT project persistence: nothing here touches docStore,
 *   IndexedDB, or schema v3 (the two-tier state law, plan Preamble 7).
 *   The project persist/ layer owns document data; this is a separate
 *   single-key store with its own tiny laws.
 *
 * THE SILENT FALLBACK LAW (plan VZ-IM-3 + Doctor Strange contingency 4 —
 * tripwire: a storage error escaping to UI/console as a crash):
 * localStorage unavailable, quota-exceeded, cookies-blocked, serialization
 * failure — every outcome degrades to "no memory" (defaults), never throws,
 * never toasts, never logs an error. Storage is a privilege, not a
 * dependency: the viz is fully functional with zero persistence.
 *
 * VALIDATION ON READ (one place, total): a stored value is usable ONLY if
 * it is valid JSON, an object, `version === 1` (an unknown FUTURE version
 * is discarded, not guessed at), `presetId` a KNOWN library id (stale
 * envelopes from older libraries — and corrupt or hand-edited ones — fall
 * back to the default deal, so boot can never render an arrangement that
 * fails model validation), and `seed` an integer in u32 range (matching
 * the envelope contract; the generator's `>>> 0` normalization would
 * silently change a negative/fractional seed's meaning, so those are
 * discarded instead). Anything else → null → the caller's defaults.
 *
 * WRITE TIMING (the no-amplification law): writes happen ONLY for
 * committed deals (VizPage wires `arranger.subscribe` — one emission per
 * COMMIT, the coalescing law already collapses spam bursts). This module
 * never writes on read/restore, never writes defaults at boot, and writes
 * exactly the three JSON-safe fields — a fresh object literal, never a
 * stringified live value that could carry stray properties.
 *
 * Determinism law: no Math.random, no Date.now — the values persisted are
 * the deterministic stream's seeds (xorshift32, src/audio/fx.ts); the
 * store adds no entropy of its own.
 */

import { VIZ_PRESETS, type VizArrangementEnvelope } from "./presets";

// ---------------------------------------------------------------------------
// The key (one, versioned, product-namespaced)
// ---------------------------------------------------------------------------

/**
 * The ONE localStorage key viz memory lives under (plan VZ-IM-3): the
 * `bitbounce.` product namespace (collision law), the `viz` surface, the
 * `v1` ENVELOPE VERSION — bump only on a breaking shape change (the
 * envelope's own `version` field moves with it; unknown versions are
 * discarded on read, so a v2 writer can never confuse a v1 reader).
 * Exported as the single source of truth — the browser harness imports
 * this constant instead of re-declaring the planned name.
 */
export const VIZ_PREFS_STORAGE_KEY = "bitbounce.viz.v1";

// ---------------------------------------------------------------------------
// The storage seam (injectable; every access guarded)
// ---------------------------------------------------------------------------

/**
 * The narrow structural seam over localStorage (the autosave DbStore-like
 * idiom): unit tests inject in-memory/throwing fakes; the real seam is
 * resolved per call. `null`/`undefined as storage` = absent storage
 * (node, sandboxes) — a legal state, handled by the fallback law.
 */
export interface VizPrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The default storage seam: the host's `localStorage`, or null when there
 * is none. The PROPERTY ACCESS itself is guarded — some privacy modes
 * throw on the mere `window.localStorage` touch — and per-operation
 * failures are caught by the readers/writers below.
 */
export function defaultVizPrefsStorage(): VizPrefsStorage | null {
  try {
    return (globalThis as { localStorage?: VizPrefsStorage }).localStorage
      ?? null;
  } catch {
    return null; // storage sandboxed off — the fallback law's province
  }
}

/** Resolve the seam: explicit argument wins; undefined = the default. */
function resolveStorage(
  storage: VizPrefsStorage | null | undefined,
): VizPrefsStorage | null {
  return storage === undefined ? defaultVizPrefsStorage() : storage;
}

// ---------------------------------------------------------------------------
// Validation (total — readVizPrefs returns a USABLE envelope or null)
// ---------------------------------------------------------------------------

/** The known library ids (the unknown-preset guard; stale → discard). */
const KNOWN_PRESET_IDS: ReadonlySet<string> = new Set(
  VIZ_PRESETS.map((preset) => preset.id),
);

/**
 * Parse + validate one stored string into a usable v1 envelope. PURE
 * (no storage, no throw): any deviation from the contract returns null —
 * the caller never sees a half-valid envelope.
 */
function parseVizPrefsEnvelope(raw: string): VizArrangementEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt JSON — discard, never crash
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null; // envelopes are objects; arrays/primitives are corruption
  }
  const { version, presetId, seed } = parsed as Record<string, unknown>;
  if (version !== 1) return null; // missing, or an unknown future version
  if (typeof presetId !== "string" || !KNOWN_PRESET_IDS.has(presetId)) {
    return null; // unknown/stale preset — fall back, never render a ghost rig
  }
  if (
    typeof seed !== "number" ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  ) {
    return null; // outside the u32 envelope contract — discard, don't reinterpret
  }
  return { version: 1, presetId, seed };
}

// ---------------------------------------------------------------------------
// Read / write / clear (all silent-law)
// ---------------------------------------------------------------------------

/**
 * Read the persisted envelope: a VALIDATED v1 envelope, or null (absent
 * key, absent storage, corrupt data, unknown version, unknown preset, bad
 * seed — every failure mode is the same answer). Never throws.
 */
export function readVizPrefs(
  storage?: VizPrefsStorage | null,
): VizArrangementEnvelope | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(VIZ_PREFS_STORAGE_KEY);
  } catch {
    return null; // storage threw on read (privacy modes) — no memory
  }
  if (typeof raw !== "string") return null; // absent key — fresh install
  return parseVizPrefsEnvelope(raw);
}

/**
 * Persist one envelope under the versioned key. Returns true on success;
 * false for absent storage or a throwing setItem (quota, privacy modes) —
 * silently, per the fallback law. Writes a FRESH three-field literal in
 * fixed order (`version, presetId, seed`) — JSON-safe values only.
 */
export function writeVizPrefs(
  envelope: VizArrangementEnvelope,
  storage?: VizPrefsStorage | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(
      VIZ_PREFS_STORAGE_KEY,
      JSON.stringify({
        version: envelope.version,
        presetId: envelope.presetId,
        seed: envelope.seed >>> 0,
      }),
    );
    return true;
  } catch {
    return false; // quota/serialization/privacy — memory is a privilege
  }
}

/**
 * Remove the key (best-effort, silent). Used by tests/harness hygiene;
 * the product never clears user memory on its own — a discarded read
 * leaves the stale value in place and simply ignores it (the next
 * committed deal overwrites it).
 */
export function clearVizPrefs(storage?: VizPrefsStorage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(VIZ_PREFS_STORAGE_KEY);
  } catch {
    /* absent/unwritable storage — nothing to clear */
  }
}
