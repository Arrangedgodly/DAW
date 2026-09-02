/**
 * CA-2: codec fuzzing suite (unit). Runs the deterministic mutational harness
 * (tests/fuzz-harness.ts) over the codec's parse surface — 2000 cases in the
 * normal unit run (fast, bounded); scripts/fuzz.mjs re-runs this file with
 * FUZZ_CASES=50000 for the long soak, same seeds → same cases plus extensions.
 *
 * Every case must either validate to a ProjectDocument or throw one of the
 * typed errors (DecodeError / ProjectValidationError / MigrationError) —
 * never an unhandled exception, never a hang (operation-counted, see harness
 * header), never Object.prototype pollution, and never a dangerous own key
 * (__proto__ / constructor) on a validated doc. Validating docs must satisfy
 * encode(decode(encode(x))) === encode(x).
 */

import { describe, expect, it } from "vitest";
import {
  DECODE_MAX_CHARS,
  DECODE_MAX_DEPTH,
  DepthLimitError,
  TextTooLargeError,
  canonicalize,
  decode,
  encode,
  scanJsonDepth,
} from "../src/document/codec";
import { createDefaultProject } from "../src/document/schema";
import { referenceMidiProject } from "./midiReference";
import { FUZZ_SEED, runFuzz, seedCorpus } from "./fuzz-harness";

const CASES = Number.parseInt(process.env.FUZZ_CASES ?? "2000", 10);

describe("CA-2 fuzz: decode parse surface is total (validate or typed-reject)", () => {
  it(
    `every one of ${CASES} seeded mutation cases is safe`,
    async () => {
      const summary = await runFuzz(seedCorpus(referenceMidiProject), CASES, FUZZ_SEED);
      if (process.env.FUZZ_VERBOSE) {
        console.log(
          `[fuzz] cases=${CASES} valid=${summary.valid} rejected=${summary.rejected} crashes=${summary.crashes.length}\n[fuzz] byMutation=${JSON.stringify(summary.byMutation)}`,
        );
      }
      expect(summary.crashes).toEqual([]);
      expect(summary.valid + summary.rejected).toBe(CASES);
      // Determinism guardrail: the corpus must actually yield both outcomes so
      // the fuzzer isn't trivially rejecting everything.
      expect(summary.valid).toBeGreaterThan(0);
      expect(summary.rejected).toBeGreaterThan(0);
    },
    // Bounded work, but 50k cases (scripts/fuzz.mjs soak) need wall-room for
    // the awaited importProjectFile path; budget scales with case count.
    Math.max(5_000, Math.ceil(CASES * 0.5)),
  );

  it("is deterministic: same seed replays identically", async () => {
    const corpus = seedCorpus(referenceMidiProject);
    const a = await runFuzz(corpus, 200, 0x5eed_1234);
    const b = await runFuzz(corpus, 200, 0x5eed_1234);
    expect(a).toEqual(b);
  });
});

describe("CA-2 DoS guards", () => {
  it("rejects nesting deeper than the cap BEFORE JSON.parse (typed)", () => {
    const deep = `{"name":${'{"a":'.repeat(DECODE_MAX_DEPTH + 1)}1${"}".repeat(DECODE_MAX_DEPTH + 1)}}`;
    expect(() => decode(deep)).toThrow(DepthLimitError);
    // Via array nesting too.
    const deepArr = `[${"[".repeat(DECODE_MAX_DEPTH + 40)}]`;
    expect(() => decode(deepArr)).toThrow(DepthLimitError);
  });

  it("accepts nesting at the cap (guard is a cap, not a ban)", () => {
    // Exactly-at-cap valid JSON under the schema's real depth (~6) is normal;
    // at-cap deep JSON still parses fine (it then fails validation as corrupt).
    const deep = `{"version":1,"x":${'{"a":'.repeat(DECODE_MAX_DEPTH - 2)}1${"}".repeat(DECODE_MAX_DEPTH - 2)}}`;
    expect(() => decode(deep)).toThrowError(/Invalid project document/); // typed validation error, not a depth crash
  });

  it("rejects text over the 1 MB codec cap (double layer under MF-3's 10 MB File guard)", () => {
    const huge = `{"name":"${"a".repeat(DECODE_MAX_CHARS)}"}`;
    expect(() => decode(huge)).toThrow(TextTooLargeError);
  });

  it("scanJsonDepth skips string literals and escapes correctly", () => {
    expect(scanJsonDepth('{"a":"{{{ [[[ \\" "}')).toBe(1);
    expect(scanJsonDepth('["\\\\["]')).toBe(1); // escaped backslash then real close
    expect(scanJsonDepth('{"s":"\\""}')).toBe(1); // escaped quote inside string
    expect(scanJsonDepth("")).toBe(0);
  });
});

describe("CA-2 prototype-pollution proofs", () => {
  it("canonicalize treats __proto__ as inert data, never a prototype write", () => {
    const before = JSON.stringify(Object.prototype);
    const out = JSON.parse(
      canonicalize({ safe: 1, __proto__: { polluted: "yes" } }),
    ) as Record<string, unknown>;
    // The canonical form carries it as an own key (sorted: __proto__ first);
    // re-canonicalizing must not pollute and must round-trip byte-stably.
    expect(canonicalize(out)).toBe(canonicalize({ safe: 1, __proto__: { polluted: "yes" } }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(Object.prototype)).toBe(before);
  });

  it("decode rejects __proto__/constructor keys at the root (strict schema)", () => {
    const base = JSON.parse(encode(createDefaultProject())) as Record<string, unknown>;
    for (const key of ["__proto__", "constructor"]) {
      const hostile = { ...base, [key]: { polluted: true } } as Record<string, unknown>;
      expect(() => decode(JSON.stringify(hostile))).toThrowError(/Invalid project document/);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it("deep-nested __proto__ carriers are stopped by the depth guard, not parsed", () => {
    const deep = `{"__proto__":${'{"a":'.repeat(500)}1${"}".repeat(500)}}`;
    expect(() => decode(deep)).toThrow(DepthLimitError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
