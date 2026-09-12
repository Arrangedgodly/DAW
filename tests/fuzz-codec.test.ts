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
import { SCHEMA_VERSION, createDefaultProject } from "../src/document/schema";
import { referenceMidiProject } from "./midiReference";
import {
  FUZZ_SEED,
  dense128DrumsProject,
  maximallyDenseV3Doc,
  runFuzz,
  seedCorpus,
  v3BoundaryProject,
} from "./fuzz-harness";
import { IMPORT_MAX_BYTES } from "../src/persist/fileIO";

const CASES = Number.parseInt(process.env.FUZZ_CASES ?? "2000", 10);

describe("CA-2 fuzz: decode parse surface is total (validate or typed-reject)", () => {
  it(
    `every one of ${CASES} seeded mutation cases is safe`,
    async () => {
      const summary = await runFuzz(
        seedCorpus(referenceMidiProject),
        CASES,
        FUZZ_SEED,
      );
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
    // Bounded work, but the soak needs wall-room for the awaited
    // importProjectFile path AND the SV-2 dense 128-bar rotation seeds
    // (~1.7 s / 2k cases measured; budget scales with case count).
    Math.max(5_000, Math.ceil(CASES * 3)),
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
    const deep = `{"version":${SCHEMA_VERSION},"x":${'{"a":'.repeat(DECODE_MAX_DEPTH - 2)}1${"}".repeat(DECODE_MAX_DEPTH - 2)}}`;
    expect(() => decode(deep)).toThrowError(/Invalid project document/); // typed validation error, not a depth crash
  });

  it("rejects text over the 4 MB codec cap (double layer under MF-3's 10 MB File guard)", () => {
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
    expect(canonicalize(out)).toBe(
      canonicalize({ safe: 1, __proto__: { polluted: "yes" } }),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(Object.prototype)).toBe(before);
  });

  it("decode rejects __proto__/constructor keys at the root (strict schema)", () => {
    const base = JSON.parse(encode(createDefaultProject())) as Record<
      string,
      unknown
    >;
    for (const key of ["__proto__", "constructor"]) {
      const hostile = { ...base, [key]: { polluted: true } } as Record<
        string,
        unknown
      >;
      expect(() => decode(JSON.stringify(hostile))).toThrowError(
        /Invalid project document/,
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it("deep-nested __proto__ carriers are stopped by the depth guard, not parsed", () => {
    const deep = `{"__proto__":${'{"a":'.repeat(500)}1${"}".repeat(500)}}`;
    expect(() => decode(deep)).toThrow(DepthLimitError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SV-2: the 4 MB cap boundary — near-cap, just-over, cap+hostile combos
// ---------------------------------------------------------------------------

/** Cached canonical bytes of the max-dense doc (encode ≈ 70 ms — build once). */
let maxDenseCanonical: string | undefined;
function maxDenseText(): string {
  return (maxDenseCanonical ??= encode(maximallyDenseV3Doc()));
}

describe("SV-2 4 MB cap boundary (near-cap, just-over, hostile combos)", () => {
  it("near-cap: the max-dense legal doc padded EXACTLY to the cap decodes and round-trips canonically", () => {
    const canonical = maxDenseText();
    // The demand for the raise restated at the boundary: the worst case sits
    // over the OLD 1 MB cap and under the new one (the margin itself is
    // pinned in document-codec-property.test.ts §"SV-1 codec-cap measurement").
    expect(canonical.length).toBeGreaterThan(1_048_576);
    expect(canonical.length).toBeLessThan(DECODE_MAX_CHARS);
    // Trailing whitespace is legal JSON — pad to EXACTLY the cap.
    const text = canonical.padEnd(DECODE_MAX_CHARS, " ");
    expect(text.length).toBe(DECODE_MAX_CHARS);
    const doc = decode(text); // exactly-at-cap passes (the guard is `>`, not `>=`)
    expect(doc.patterns.bass[0]!.bars).toBe(128);
    // Round-trip canonical property at v3 shape AND at the cap.
    expect(encode(decode(encode(doc)))).toBe(encode(doc));
  });

  it("just-over: one char past the cap rejects typed at the size layer (trailing AND leading padding)", () => {
    const atCap = maxDenseText().padEnd(DECODE_MAX_CHARS, " ");
    expect(() => decode(`${atCap} `)).toThrow(TextTooLargeError);
    expect(() => decode(` ${atCap}`)).toThrow(TextTooLargeError);
  });

  it("guard order: an over-cap DEEP tower rejects as too-large, not deep (size check before the scan)", () => {
    // 500 levels is far past the depth cap; if the depth scan ever ran
    // before the size check this would throw DepthLimitError instead.
    const deepOverCap = "[".repeat(500).padEnd(DECODE_MAX_CHARS + 1, " ");
    expect(() => decode(deepOverCap)).toThrow(TextTooLargeError);
  });

  it("over-cap + invalid JSON rejects at the size layer (the parser is never reached)", () => {
    const overCap = `{"name":"${"a".repeat(DECODE_MAX_CHARS)}`; // unterminated string
    expect(overCap.length).toBeGreaterThan(DECODE_MAX_CHARS);
    expect(() => decode(overCap)).toThrow(TextTooLargeError);
  });

  it("over-cap + prototype-pollution payload rejects at the size layer and never pollutes", () => {
    const overCap =
      `{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},` +
      `"name":"${"a".repeat(DECODE_MAX_CHARS)}`;
    expect(() => decode(overCap)).toThrow(TextTooLargeError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SV-2: depth pre-scan + prototype pollution re-proven at v3 shapes
// ---------------------------------------------------------------------------

describe("SV-2 depth pre-scan + prototype pollution re-proven at v3 shapes", () => {
  it("deep tower inside the dense v3 seed rejects typed BEFORE JSON.parse", () => {
    const hostile = encode(dense128DrumsProject()).replace(
      "{",
      `{"__proto__":${'{"a":'.repeat(500)}1${"}".repeat(500)},`,
    );
    expect(scanJsonDepth(hostile)).toBeGreaterThan(DECODE_MAX_DEPTH);
    expect(() => decode(hostile)).toThrow(DepthLimitError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("nesting AT the cap inside a v3 doc passes the scan and typed-rejects in validation", () => {
    // A tower of (cap - 1) levels under the root sits at exactly depth 64:
    // the scan passes (`>` not `>=`), JSON.parse succeeds, and the unknown
    // carrier key then rejects through strict validation — typed end to end.
    const text = encode(v3BoundaryProject()).replace(
      "{",
      `{"tower":${'{"a":'.repeat(DECODE_MAX_DEPTH - 1)}1${"}".repeat(DECODE_MAX_DEPTH - 1)},`,
    );
    expect(scanJsonDepth(text)).toBe(DECODE_MAX_DEPTH);
    expect(() => decode(text)).toThrowError(/Invalid project document/);
  });

  it("proto-keys on the v3 boundary seed reject typed; the prototype stays clean", () => {
    const hostile = encode(v3BoundaryProject()).replace(
      "{",
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},',
    );
    expect(() => decode(hostile)).toThrowError(/Invalid project document/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("v3 per-field caps reject their out-of-band neighbors through the real decode path", () => {
    type Json = Record<string, unknown>;
    const clone = () => JSON.parse(encode(v3BoundaryProject())) as Json;
    const bassPattern = (doc: Json) => (doc.patterns as Json).bass[0] as Json;
    const bassLane = (doc: Json) => (doc.lanes as Json[])[1]! as Json;
    const reject = (doc: Json, why: string) =>
      expect(() => decode(JSON.stringify(doc)), why).toThrowError(
        /Invalid project document/,
      );

    // Bar counts outside the supported whole-number range.
    for (const bars of [0, 1.5, 129]) {
      const doc = clone();
      bassPattern(doc).bars = bars;
      reject(doc, `bars ${bars}`);
    }
    // note start past the 2047 space ceiling.
    {
      const doc = clone();
      bassPattern(doc).notes = [{ degree: 0, start: 2048, length: 1 }];
      reject(doc, "start 2048");
    }
    // length past MAX_NOTE_LENGTH (2048) or off the 0.25 grid.
    for (const length of [2049, 2048.1]) {
      const doc = clone();
      bassPattern(doc).notes = [{ degree: 0, start: 0, length }];
      reject(doc, `length ${length}`);
    }
    // octave out of ±3 or off-integer (the seed carries the accepted −3).
    for (const octave of [4, -4, 1.5]) {
      const doc = clone();
      bassLane(doc).octave = octave;
      reject(doc, `octave ${octave}`);
    }
    // degree past the 128 ceiling.
    {
      const doc = clone();
      bassPattern(doc).notes = [{ degree: 129, start: 0, length: 1 }];
      reject(doc, "degree 129");
    }
    // And the accepted edges ride the seed's own bytes (also exercised by
    // the corpus rotation above and the near-cap case).
    const doc = decode(encode(v3BoundaryProject()));
    expect(doc.patterns.lead[2]!.bars).toBe(128);
    expect(doc.lanes[1]!.octave).toBe(-3);
  });
});

// ---------------------------------------------------------------------------
// SV-2: guard parity — every size/depth guard scaled or pinned deliberately
// ---------------------------------------------------------------------------

describe("SV-2 guard parity (the cap-raise scale-up record, executable)", () => {
  it("DECODE_MAX_CHARS is the SV-1 measured 4 MB (4,194,304 chars) — silent drift trips CI", () => {
    // Raised 1 MB → 4 MB against the measured 2.63 MB worst case (1.56x
    // headroom). Changing this number is a policy decision: it must update
    // codec.ts's measurement record + docs/dev/fuzz-corpus.md together.
    expect(DECODE_MAX_CHARS).toBe(4_194_304);
  });

  it("layering: the codec cap stays 2.5x under MF-3's 10 MB file guard", () => {
    expect(IMPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DECODE_MAX_CHARS).toBeLessThan(IMPORT_MAX_BYTES);
    // The recorded relationship: a hostile file BETWEEN the bounds (e.g.
    // HL-1's 4.5 MB probe) passes the file guard and lands on the codec
    // layer with the honest too-large message — never "not valid JSON".
    expect(IMPORT_MAX_BYTES / DECODE_MAX_CHARS).toBeGreaterThanOrEqual(2.5);
  });

  it("DECODE_MAX_DEPTH stays 64; real v3 documents (incl. max-dense) nest far below", () => {
    expect(DECODE_MAX_DEPTH).toBe(64);
    expect(scanJsonDepth(encode(maximallyDenseV3Doc()))).toBeLessThanOrEqual(
      10,
    );
    expect(scanJsonDepth(encode(v3BoundaryProject()))).toBeLessThanOrEqual(10);
  });
});
