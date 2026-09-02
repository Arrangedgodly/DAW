/**
 * Golden: canonical codec bytes of createDefaultProject() (HW-1).
 * Pure TS → deterministic bytes; pinned via SHA-256 manifest.
 */
import { describe, expect, it } from "vitest";
import { encode } from "../../src/document/codec";
import { createDefaultProject } from "../../src/document/schema";
import { expectGolden } from "./golden";

const GOLDEN_NAME = "codec/default-project-canonical-v1";

function canonicalDefaultProjectBytes(): Uint8Array {
  return new TextEncoder().encode(encode(createDefaultProject()));
}

describe("golden: canonical bytes of createDefaultProject()", () => {
  it("matches the manifest SHA-256 + byteLength", () => {
    expectGolden(GOLDEN_NAME, canonicalDefaultProjectBytes());
  });

  it("is plausible canonical JSON (non-empty, starts with '{', no whitespace)", () => {
    const bytes = canonicalDefaultProjectBytes();
    expect(bytes.byteLength).toBeGreaterThan(0);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("{")).toBe(true);
    expect(text).not.toMatch(/\s/);
  });
});
