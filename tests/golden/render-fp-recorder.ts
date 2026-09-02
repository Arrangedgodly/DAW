/**
 * HW-2 render-fingerprint recorder — NODE side (imported by vite.config.ts).
 *
 * Browser-mode tests cannot touch the filesystem, but their console is
 * forwarded to the vitest server where this onConsoleLog hook runs in node.
 * The browser fingerprint test (tests/browser/render-fingerprint.test.ts)
 * emits one machine-readable `RENDER_FINGERPRINT_RECORD <json>` line; this
 * hook writes it into tests/golden/manifest.json — ONLY when the vitest
 * process was launched with UPDATE_GOLDENS=1 (i.e. `npm run goldens:update`).
 * In normal runs the record line is consumed silently (return false) so it
 * never pollutes output.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { RENDER_FP_PREFIX } from "./render-fp-protocol.ts";

export { RENDER_FP_PREFIX };

const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(GOLDEN_DIR, "manifest.json");

interface RecordPayload {
  name: string;
  sha256: string;
  byteLength: number;
  sampleRate: number;
  loopSamples: number;
}

function envMetadata(): { playwright: string; chromium: string } {
  try {
    const require = createRequire(import.meta.url);
    const pw = require("playwright/package.json") as { version: string };
    let chromium = "chromium (revision unknown)";
    try {
      const path = require("playwright").chromium.executablePath() as string;
      chromium = `chromium (${path.split("/").slice(-2).join("/")})`;
    } catch {
      // executablePath throws when the browser isn't installed on this
      // machine (e.g. regenerating on a fresh clone before
      // `playwright install`) — version pinning is the important half.
    }
    return { playwright: `playwright ${pw.version}`, chromium };
  } catch {
    return { playwright: "unknown", chromium: "chromium (unknown)" };
  }
}

/**
 * vitest onConsoleLog handler for the browser project. Consumes fingerprint
 * record lines; writes the manifest only under UPDATE_GOLDENS=1.
 */
export function onRenderFingerprintConsoleLog(log: string): boolean {
  if (!log.startsWith(RENDER_FP_PREFIX)) return true; // not ours — print it
  if (process.env.UPDATE_GOLDENS === "1") {
    try {
      const payload = JSON.parse(log.slice(RENDER_FP_PREFIX.length)) as RecordPayload;
      const manifest = existsSync(MANIFEST_PATH)
        ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
            manifestVersion: number;
            env: Record<string, string>;
            goldens: Record<string, unknown>;
          })
        : { manifestVersion: 1, env: {}, goldens: {} };
      const previous = (manifest.goldens[payload.name] ?? {}) as {
        note?: string;
      };
      manifest.goldens[payload.name] = {
        ...(previous.note ? { note: previous.note } : {}), // HW-3: editorial notes survive regen
        sha256: payload.sha256,
        byteLength: payload.byteLength,
        kind: "render",
        renderEnv: {
          ...envMetadata(),
          sampleRate: payload.sampleRate,
          loopSamples: payload.loopSamples,
        },
      };
      manifest.env.regeneratedVia =
        "npm run goldens:update (UPDATE_GOLDENS=1 vitest run tests/golden && UPDATE_GOLDENS=1 vitest run --project browser tests/browser/render-fingerprint.test.ts)";
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
       
      console.log(`[render-fingerprint] recorded '${payload.name}' → ${payload.sha256}`);
    } catch (err) {
       
      console.error("[render-fingerprint] failed to record:", err);
    }
  }
  return false; // consumed — do not echo the machine line
}
