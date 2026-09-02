/**
 * HW-3 — manifest hygiene + corrupted-golden tripwires.
 *
 * Hygiene: every manifest entry carries a human `note` (what it pins, why it
 * exists) and the right shape for its kind (render entries carry renderEnv).
 *
 * Tripwire: for every HARD byte golden (kind absent or "bytes"), a tampered
 * manifest (hash flipped) must make expectGolden THROW — proving that
 * flipping any manifest hash fails the corresponding golden test. Render
 * fingerprints (kind: "render") are deliberately soft canaries: a flipped
 * hash yields a console DRIFT warning, never a failure (verified by the
 * manual tamper-evidence run recorded in production-log.md "HW-3").
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encode } from "../../src/document/codec";
import { createDefaultProject } from "../../src/document/schema";
import { createDemoProject } from "../../src/document/demoSong";
import { encodeWav16 } from "../../src/audio/wav";
import { encodeMidi } from "../../src/audio/exportMidi";
import { referenceMidiProject } from "../midiReference";
import { expectGolden, __forTests_setManifestPath } from "./golden";
import { RENDER_FP_GOLDEN_NAME, WAV_EXPORT_FP_GOLDEN_NAME } from "./render-fp-protocol";

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "manifest.json"), "utf8"),
) as {
  env: { node: string; regeneratedVia: string };
  goldens: Record<string, {
    sha256: string;
    byteLength: number;
    kind?: "bytes" | "render";
    note?: string;
    renderEnv?: Record<string, unknown>;
  }>;
};

/** The real bytes each HARD golden pins (same producers as the golden tests). */
function realBytesFor(name: string): Uint8Array {
  switch (name) {
    case "codec/default-project-canonical-v1":
      return new TextEncoder().encode(encode(createDefaultProject()));
    case "codec/demo-project-canonical-v1":
      return new TextEncoder().encode(encode(createDemoProject()));
    case "wav/encoder-stereo-2frame-v1":
      return encodeWav16(
        [new Float32Array([0, 0.5]), new Float32Array([-1, 1])],
        44100,
      );
    case "midi/reference-project-v1":
      return encodeMidi(referenceMidiProject());
    default:
      throw new Error(`test gap: no producer wired for golden '${name}'`);
  }
}

/** Write a tampered copy of the manifest (one entry's hash flipped) to tmp. */
function tamperedManifestPath(name: string): string {
  const copy = structuredClone(manifest);
  const entry = copy.goldens[name];
  entry.sha256 =
    entry.sha256.startsWith("00")
      ? entry.sha256.replace(/^00/, "11")
      : `00${entry.sha256.slice(2)}`;
  const dir = mkdtempSync(join(tmpdir(), "golden-tamper-"));
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(copy), "utf8");
  return path;
}

afterEach(() => __forTests_setManifestPath(null));

describe("HW-3 golden manifest hygiene", () => {
  it("has environment metadata (node + regeneration command)", () => {
    expect(manifest.env.node).toMatch(/^v\d+/);
    expect(manifest.env.regeneratedVia).toContain("goldens:update");
  });

  it("every entry carries a human note of what it pins", () => {
    for (const [name, entry] of Object.entries(manifest.goldens)) {
      expect(entry.note, `note for '${name}'`).toBeTruthy();
      expect(entry.note!.length, `note for '${name}'`).toBeGreaterThan(20);
    }
  });

  it("render-fingerprint entries are kind:render with renderEnv", () => {
    for (const name of [RENDER_FP_GOLDEN_NAME, WAV_EXPORT_FP_GOLDEN_NAME]) {
      const entry = manifest.goldens[name];
      expect(entry?.kind, `${name} kind`).toBe("render");
      expect(entry?.renderEnv?.playwright, `${name} renderEnv.playwright`).toBeTruthy();
      expect(entry?.renderEnv?.sampleRate, `${name} renderEnv.sampleRate`).toBe(44100);
    }
  });
});

describe("HW-3 corrupted-golden tripwires (tamper → test fails)", () => {
  const hardGoldens = Object.entries(manifest.goldens)
    .filter(([, e]) => e.kind !== "render")
    .map(([name]) => name);

  it("manifest actually contains hard byte goldens to guard", () => {
    expect(hardGoldens.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of hardGoldens) {
    it(`flipping the manifest hash of '${name}' fails its golden check`, () => {
      const bytes = realBytesFor(name);
      // Sanity: the untampered manifest accepts the real bytes.
      expect(() => expectGolden(name, bytes)).not.toThrow();

      // Tampered: same bytes, flipped hash → must throw (this is exactly
      // what the corresponding *.golden.test.ts would report as a failure).
      __forTests_setManifestPath(tamperedManifestPath(name));
      expect(() => expectGolden(name, bytes)).toThrowError(/SHA-256 mismatch/);
    });
  }
});
