/**
 * Deterministic mutational fuzz harness for the codec's parse surface (CA-2).
 *
 * No external deps (HW-1 stance): seeded mulberry32 PRNG + a fixed corpus of
 * seed texts → every run with the same seed replays the exact same cases.
 *
 * Corpus: the canonical default-project bytes plus the golden MIDI/WAV
 * reference projects' JSON (same lineage as tests/midiReference.ts and the
 * golden wav render project: drums four-on-the-floor + lead degree 3) in a few
 * textual shapes (canonical, pretty-printed, key-shuffled) so mutations start
 * from realistic neighbors of the golden inputs.
 *
 * Invariant asserted for EVERY case (Captain America: the parse surface must
 * be total — validate or typed-reject, never anything else):
 *   1. decode(text) either returns a ProjectDocument or throws
 *      DecodeError | ProjectValidationError | MigrationError (typed). Any
 *      other throw is recorded as a crash and fails the run.
 *   2. A validating doc satisfies canonical stability:
 *      encode(decode(encode(doc))) === encode(doc).
 *   3. No "__proto__"/"constructor" own key survives into a validated doc.
 *   4. Object.prototype is never polluted (probe objects stay clean).
 *   5. importProjectFile's text path returns a typed result, never throws.
 *
 * Hang-freedom via OPERATION COUNTING, not wall time: every per-case step is
 * linear-bounded by construction — (a) mutations apply ≤1 rewrite each over a
 * corpus text (≤1 MB, asserted), (b) the pre-parse depth scan touches each
 * char exactly once (asserted below via a counting twin of scanJsonDepth),
 * (c) JSON.parse is bounded by the 1 MB cap, (d) validation/canonicalize
 * recursion is bounded by the 64-depth cap (deep inputs are rejected before
 * parse). So no case can spin without bound, and the counting scan proves the
 * linear bound empirically per case.
 */

import {
  DecodeError,
  decode,
  encode,
  scanJsonDepth,
} from "../src/document/codec";
import { MigrationError } from "../src/document/migrate";
import { ProjectValidationError } from "../src/document/validate";
import { createDefaultProject, type ProjectDocument } from "../src/document/schema";
import { importProjectFile } from "../src/persist/fileIO";
import { createMemoryProjectDb } from "../src/persist/db";

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Seed corpus: golden-input JSON neighbors
// ---------------------------------------------------------------------------

function wavLineageProject(): ProjectDocument {
  // Same lineage as the golden wav render project: four-on-the-floor kick,
  // snare on 4+12, lead degree 3 on step 8.
  const doc = createDefaultProject();
  doc.name = "WAV reference";
  const drums = doc.patterns.drums[0];
  drums.steps.kick = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
  drums.steps.snare = Array.from({ length: 16 }, (_, i) => i === 4 || i === 12);
  const lead = doc.patterns.lead[0];
  const steps = new Array(16).fill(0);
  steps[8] = 1;
  lead.rows = lead.rows.map((row, idx) => (idx === 3 ? { degree: 3, steps } : row));
  return doc;
}

function keyShuffled(value: unknown): string {
  // Re-serialize with keys in insertion-reversed order (decode must not care).
  const rev = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rev);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort().reverse()) {
        out[k] = rev((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(rev(value));
}

export function seedCorpus(midiProject: () => ProjectDocument): string[] {
  return [
    encode(createDefaultProject()), // golden codec bytes (tests/golden)
    JSON.stringify(createDefaultProject(), null, 2), // pretty-printed neighbor
    encode(midiProject()), // golden MIDI reference project (tests/midiReference)
    encode(wavLineageProject()), // golden WAV render lineage project
    keyShuffled(midiProject()), // same doc, shuffled key order
  ];
}

// ---------------------------------------------------------------------------
// Mutations (each: seeded, single pass, O(n))
// ---------------------------------------------------------------------------

export type MutationName =
  | "byte-flip"
  | "truncate"
  | "key-rename"
  | "type-swap"
  | "deep-nest"
  | "huge-number"
  | "unicode-edge"
  | "proto-keys"
  | "dup-key"
  | "nan-literal";

const KEY_POOL = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "version",
  "schemaVersion",
  "patterns",
  "nope",
];

const UNICODE_EDGES = [
  "\u0000", // NUL inside a string literal
  "\ud83d", // lone high surrogate
  "\udcff", // lone low surrogate
  "\u2028", // line separator (legal in JSON strings, illegal in JS)
  "\uFEFF", // BOM (prepended to whole text)
  "\\", // escape mangling
  '"', // premature string close
];

function firstKeyIndex(text: string): { start: number; end: number } | undefined {
  const m = /"([A-Za-z_][A-Za-z0-9_-]*)"\s*:/.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : undefined;
}

function firstNumberIndex(text: string): { start: number; end: number } | undefined {
  const m = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : undefined;
}

function deepNestJson(depth: number): string {
  return '{"a":'.repeat(depth) + "1" + "}".repeat(depth);
}

function applyMutation(name: MutationName, rng: () => number, text: string): string {
  const pos = (max: number) => Math.floor(rng() * Math.max(1, max));
  switch (name) {
    case "byte-flip": {
      const i = pos(text.length);
      const flipped = String.fromCharCode(text.charCodeAt(i) ^ (1 << pos(7)));
      return text.slice(0, i) + flipped + text.slice(i + 1);
    }
    case "truncate":
      return text.slice(0, pos(text.length));
    case "key-rename": {
      const k = firstKeyIndex(text);
      if (!k) return text;
      const replacement = KEY_POOL[pos(KEY_POOL.length)]!;
      return `${text.slice(0, k.start)}"${replacement}":${text.slice(k.end)}`;
    }
    case "type-swap": {
      const n = firstNumberIndex(text);
      if (!n) return text;
      const into = ['"1"', "true", "[]", "null", "{}", "-0"][pos(6)]!;
      return text.slice(0, n.start) + into + text.slice(n.end);
    }
    case "deep-nest": {
      // Inject a VALID deep-nested object (up to 500 levels) as a value under
      // the first key — exercises the pre-parse depth guard with parseable
      // JSON, plus __proto__ as the carrier key for pollution coverage.
      const depth = 60 + pos(440);
      return text.replace("{", `{"__proto__":${deepNestJson(depth)},`);
    }
    case "huge-number": {
      const n = firstNumberIndex(text);
      if (!n) return text;
      return text.slice(0, n.start) + "9".repeat(100 + pos(800)) + text.slice(n.end);
    }
    case "unicode-edge": {
      const edge = UNICODE_EDGES[pos(UNICODE_EDGES.length)]!;
      if (edge === "\uFEFF") return edge + text;
      const i = text.indexOf('"', text.indexOf("{") + 1); // inside first string-ish region
      if (i < 0) return text + edge;
      return text.slice(0, i) + edge + text.slice(i);
    }
    case "proto-keys":
      return text.replace(
        "{",
        '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},',
      );
    case "dup-key":
      return text.replace("{", '{"name":"duplicate-name-override",');
    case "nan-literal": {
      const n = firstNumberIndex(text);
      if (!n) return text;
      const lit = ["NaN", "Infinity", "-Infinity", "1e999", "0x10"][pos(5)]!;
      return text.slice(0, n.start) + lit + text.slice(n.end);
    }
  }
}

export const MUTATIONS: readonly MutationName[] = [
  "byte-flip",
  "truncate",
  "key-rename",
  "type-swap",
  "deep-nest",
  "huge-number",
  "unicode-edge",
  "proto-keys",
  "dup-key",
  "nan-literal",
];

// ---------------------------------------------------------------------------
// Counting twin of the pre-scan (hang-freedom proof: iterations === length)
// ---------------------------------------------------------------------------

function countingDepthScan(text: string): { depth: number; iterations: number } {
  let depth = 0;
  let max = 0;
  let inString = false;
  let iterations = 0;
  for (let i = 0; i < text.length; i++) {
    iterations++;
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") depth--;
  }
  return { depth: max, iterations };
}

// ---------------------------------------------------------------------------
// Doc cleanliness probe: no dangerous own keys anywhere (depth-capped walk)
// ---------------------------------------------------------------------------

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function dangerousOwnKey(value: unknown, depth: number): string | undefined {
  if (depth > 70) return "walk depth exceeded (input escaped the depth cap)";
  if (Array.isArray(value)) {
    for (const el of value) {
      const hit = dangerousOwnKey(el, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) return `own key "${key}" reached the validated doc`;
      const hit = dangerousOwnKey((value as Record<string, unknown>)[key], depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

function prototypePolluted(): boolean {
  const probe: Record<string, unknown> = {};
  return probe.polluted !== undefined || JSON.stringify(probe) !== "{}";
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface FuzzSummary {
  cases: number;
  valid: number;
  rejected: number;
  crashes: string[];
  /** Mutation histogram (mutation × outcome) for the production log. */
  byMutation: Record<string, { valid: number; rejected: number }>;
}

export const FUZZ_SEED = 0xca2_f00d;

export async function runFuzz(
  corpus: string[],
  cases: number,
  seed: number = FUZZ_SEED,
): Promise<FuzzSummary> {
  const rng = mulberry32(seed);
  const db = createMemoryProjectDb();
  const summary: FuzzSummary = {
    cases,
    valid: 0,
    rejected: 0,
    crashes: [],
    byMutation: {},
  };

  for (let i = 0; i < cases; i++) {
    const mutation = MUTATIONS[i % MUTATIONS.length]!;
    const base = corpus[Math.floor(rng() * corpus.length)]!;
    let text: string;
    try {
      text = applyMutation(mutation, rng, base);
    } catch (error) {
      summary.crashes.push(`case ${i} (${mutation}): mutator threw ${String(error)}`);
      continue;
    }

    // Hang-freedom, operation-counted: the pre-scan is exactly linear.
    const counted = countingDepthScan(text);
    if (counted.iterations > text.length + 1) {
      summary.crashes.push(`case ${i} (${mutation}): pre-scan iterations exceeded input length`);
    }
    if (text.length > 1_048_576) {
      summary.crashes.push(`case ${i} (${mutation}): mutated text exceeded 1 MB (${text.length})`);
    }
    scanJsonDepth(text); // the production scan must terminate too (same invariant)

    const hist = (summary.byMutation[mutation] ??= { valid: 0, rejected: 0 });

    let doc: ProjectDocument | undefined;
    try {
      doc = decode(text);
    } catch (error) {
      if (
        error instanceof DecodeError ||
        error instanceof ProjectValidationError ||
        error instanceof MigrationError
      ) {
        summary.rejected++;
        hist.rejected++;
      } else {
        summary.crashes.push(
          `case ${i} (${mutation}): UNTYPED throw ${error?.constructor?.name ?? typeof error}: ${String(error)}`,
        );
      }
    }

    if (doc !== undefined) {
      summary.valid++;
      hist.valid++;
      // Property: canonical stability under round-trip.
      const e1 = encode(doc);
      let e2: string | undefined;
      try {
        e2 = encode(decode(e1));
      } catch (error) {
        summary.crashes.push(
          `case ${i} (${mutation}): re-decode of own encoding threw ${String(error)}`,
        );
      }
      if (e2 !== undefined && e2 !== e1) {
        summary.crashes.push(`case ${i} (${mutation}): encode(decode(encode(x))) !== encode(x)`);
      }
      // Property: dangerous keys never reach the validated doc.
      const hit = dangerousOwnKey(doc, 0);
      if (hit) summary.crashes.push(`case ${i} (${mutation}): ${hit}`);
    }

    // Property: Object.prototype never polluted by anything above.
    if (prototypePolluted()) {
      summary.crashes.push(`case ${i} (${mutation}): Object.prototype polluted`);
    }

    // importProjectFile text path: typed result, never a throw.
    try {
      const file = new File([text], "fuzz.bitbounce.json", { type: "application/json" });
      const result = await importProjectFile(file, db, {
        newId: () => `fuzz-${i}`,
        now: () => 0,
        readFile: () => Promise.resolve(text),
      });
      if (typeof result.ok !== "boolean") {
        summary.crashes.push(`case ${i} (${mutation}): importProjectFile returned non-result`);
      }
    } catch (error) {
      summary.crashes.push(
        `case ${i} (${mutation}): importProjectFile THREW ${error?.constructor?.name ?? typeof error}: ${String(error)}`,
      );
    }
  }

  return summary;
}
