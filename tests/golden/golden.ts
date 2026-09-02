/**
 * Golden-file helper (D8 / RES-7, task HW-1).
 *
 * Strategy: goldens are SHA-256 manifests, not committed byte blobs, for
 * encoders whose output is derived deterministically from pure TS (e.g. the
 * canonical codec). The manifest maps golden name → { sha256, byteLength }.
 *
 * Regeneration: the ONLY sanctioned path is `npm run goldens:update`
 * (package.json), which sets UPDATE_GOLDENS=1 for a vitest run. Without that
 * env var this helper only compares. CI never regenerates.
 *
 * Rendered-audio goldens (HW-2/HW-3) use the same manifest shape but are
 * tolerance-checked, never byte-compared cross-engine (see res-7-testing.md).
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(GOLDEN_DIR, "manifest.json");

export interface GoldenEntry {
  sha256: string;
  byteLength: number;
}

export interface GoldenManifest {
  manifestVersion: 1;
  /** Environment metadata recorded at regeneration time (never asserted). */
  env: {
    node: string;
    regeneratedVia: string;
  };
  goldens: Record<string, GoldenEntry>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readManifest(): GoldenManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as GoldenManifest;
}

function writeManifest(manifest: GoldenManifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

const regenerating = process.env.UPDATE_GOLDENS === "1";

/**
 * Assert `bytes` match the manifest entry for `name` — or, when running under
 * UPDATE_GOLDENS=1, record/refresh the entry and pass.
 */
export function expectGolden(name: string, bytes: Uint8Array): void {
  const digest = sha256Hex(bytes);
  if (regenerating) {
    const manifest = readManifest();
    manifest.env.node = process.version;
    manifest.goldens[name] = { sha256: digest, byteLength: bytes.byteLength };
    writeManifest(manifest);
    return;
  }
  const manifest = readManifest();
  const entry = manifest.goldens[name];
  if (!entry) {
    throw new Error(
      `Golden '${name}' missing from manifest. Regenerate locally with: npm run goldens:update`,
    );
  }
  if (entry.byteLength !== bytes.byteLength) {
    throw new Error(
      `Golden '${name}' byteLength mismatch: expected ${entry.byteLength}, got ${bytes.byteLength}. ` +
        `If intentional, regenerate with: npm run goldens:update`,
    );
  }
  if (entry.sha256 !== digest) {
    throw new Error(
      `Golden '${name}' SHA-256 mismatch: expected ${entry.sha256}, got ${digest}. ` +
        `If intentional, regenerate with: npm run goldens:update`,
    );
  }
}
