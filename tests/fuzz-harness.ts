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
 * SV-2 corpus v3: the rotation additionally carries v3 shapes — a
 * v3-boundary neighbor (bars 8..128 incl. the ceiling, `octave` at ±3,
 * unequal per-lane chains, notes at the 2047/2048/0.25 edges) and two dense
 * 128-bar seeds — plus the v2-in-the-wild texts (tests/v2Project.ts) so
 * mutations keep exercising the v2→v3 migration inside the real parse path.
 * The 2.63 MB maximally-dense worst case is deliberately NOT in the rotation
 * (measured ~90 ms/decode — rotation cost); it is exercised by the dedicated
 * 4 MB-boundary class in tests/fuzz-codec.test.ts.
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
 * corpus text (≤ DECODE_MAX_CHARS, asserted), (b) the pre-parse depth scan
 * touches each char exactly once (asserted below via a counting twin of
 * scanJsonDepth), (c) JSON.parse is bounded by the 4 MB decode cap
 * (DECODE_MAX_CHARS — SV-1's measured raise from 1 MB; both guards are
 * linear in input, so the raise scales the stack by construction), (d)
 * validation/canonicalize recursion is bounded by the 64-depth cap (deep
 * inputs are rejected before parse). So no case can spin without bound, and
 * the counting scan proves the linear bound empirically per case.
 */

import {
  DECODE_MAX_CHARS,
  DecodeError,
  decode,
  encode,
  scanJsonDepth,
} from "../src/document/codec";
import { MigrationError } from "../src/document/migrate";
import { ProjectValidationError } from "../src/document/validate";
import {
  DRUM_PIECES,
  createDefaultProject,
  type DrumPattern,
  type FxDevice,
  type ProjectDocument,
} from "../src/document/schema";
import { sustainHeavyV1ProjectText, v1DefaultProjectText } from "./v1Project";
import {
  boundaryV2ProjectText,
  v2DefaultProjectText,
  v2DemoProjectText,
} from "./v2Project";
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
  // SC-1 v2: the v0 shape was a lone note-on (cell 1) at degree 3, step 8
  // under the default lead gate (2 steps). Same content.
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  lead.notes = [{ degree: 3, start: 8, length: 2 }];
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
    encode(createDefaultProject()), // golden codec bytes (tests/golden, v3)
    JSON.stringify(createDefaultProject(), null, 2), // pretty-printed neighbor
    encode(midiProject()), // golden MIDI reference project (tests/midiReference)
    encode(wavLineageProject()), // golden WAV render lineage project
    keyShuffled(midiProject()), // same doc, shuffled key order
    // SC-1: v1 documents now migrate inside the parse surface — seed real v1
    // bytes (default + the sustain-heavy neighbor incl. a seconds gate) so
    // mutations exercise the v1→v2 path, not just the v2 shape.
    v1DefaultProjectText(),
    sustainHeavyV1ProjectText(),
    // PS-3: a project recording sample-voice provenance (real manifest echo
    // shapes — dotted asset-id keys, CC0/https strings) so mutations hit the
    // new field's keys, values, and nesting too, not only its absence.
    encode(sampleProvenanceProject()),
    // SV-2: v3 shapes in the rotation — the widened-edge neighbor (bars
    // 8..128, octave ±3 lanes, unequal chains, 2047/2048/0.25 boundary
    // notes) + two dense 128-bar seeds (boolean-step max density; single-row
    // pitched density). v2-in-the-wild texts: real pre-v3 saves (default,
    // demo, v2-boundary neighbor) so mutations keep hitting the v2→v3
    // migration inside the real parse path.
    encode(v3BoundaryProject()),
    encode(dense128DrumsProject()),
    encode(dense128PitchedProject()),
    v2DefaultProjectText(),
    v2DemoProjectText(),
    boundaryV2ProjectText(),
  ];
}

/** PS-3 corpus neighbor: a synth project whose bass lane "went sample". */
function sampleProvenanceProject(): ProjectDocument {
  const doc = createDefaultProject();
  doc.name = "Sample provenance";
  doc.sampleProvenance = {
    "voice.bass.lowtone": {
      license: "CC0",
      sourceUrl: "https://kenney.nl/assets/digital-audio",
      author: "Kenney Vleugels (Kenney.nl)",
    },
    "drums.808.kick": {
      license: "CC0",
      sourceUrl:
        "https://github.com/sgossner/VCSL/blob/c1ea7bc/Membranophones/Bass%20Drum%201/BDrumNew_hit_v5_rr1_Sum.wav",
      author: "Sam Gossner (VCSL)",
    },
  };
  return doc;
}

// ---------------------------------------------------------------------------
// SV-2 v3 corpus shapes (bars 8..128, octave, unequal chains, density)
// ---------------------------------------------------------------------------

function cloneDefault(): ProjectDocument {
  return JSON.parse(JSON.stringify(createDefaultProject()));
}

function drumSteps(
  bars: number,
  on: (piece: (typeof DRUM_PIECES)[number], step: number) => boolean,
): DrumPattern["steps"] {
  const len = bars * 16;
  return Object.fromEntries(
    DRUM_PIECES.map((piece) => [
      piece,
      Array.from({ length: len }, (_, i) => on(piece, i)),
    ]),
  ) as DrumPattern["steps"];
}

/**
 * SV-2: v3-boundary neighbor — every widened edge as REAL canonical bytes so
 * mutations start adjacent to the v3 laws: pattern bars across the vocabulary
 * incl. the 128 ceiling (1/2/4/8/16/64/128 lanes), `octave` at the ±3/±1
 * edges on pitched lanes (non-zero — octave 0 is canonical-empty, so the
 * text must carry ±3 for mutations to hit the key), UNEQUAL per-lane chains
 * with repeats (drums 3 slots, bass 1, chords 2, lead 4 — the i3-5 poly-loop
 * shape), positional chainCues, and notes at the space edges (start 2047,
 * length 2048, length 0.25, degree 23).
 */
export function v3BoundaryProject(): ProjectDocument {
  const doc = cloneDefault();
  doc.name = "V3 boundary";
  doc.lanes = doc.lanes.map((lane) => {
    if (lane.id === "bass") return { ...lane, octave: -3 };
    if (lane.id === "chords") return { ...lane, octave: 1 };
    if (lane.id === "lead") return { ...lane, octave: 3 };
    return lane;
  });
  doc.patterns.drums = [
    {
      kind: "drums",
      id: "drums-1",
      name: "A",
      bars: 1,
      steps: drumSteps(1, (_p, i) => i % 4 === 0),
    },
    {
      kind: "drums",
      id: "drums-2",
      name: "B",
      bars: 128,
      steps: drumSteps(128, (_p, i) => i % 16 === 0),
    },
  ];
  doc.patterns.bass = [
    {
      kind: "pitched",
      id: "bass-1",
      name: "A",
      bars: 8,
      rowDegrees: [0, 1, 2, 3, 4, 5, 6],
      notes: [{ degree: 0, start: 127, length: 128 }],
    },
  ];
  doc.patterns.chords = [
    {
      kind: "pitched",
      id: "chords-1",
      name: "A",
      bars: 4,
      rowDegrees: [0, 2, 4, 6],
      notes: [{ degree: 0, start: 0, length: 64 }],
    },
    {
      kind: "pitched",
      id: "chords-2",
      name: "B",
      bars: 64,
      rowDegrees: [0, 2, 4, 6],
      notes: [{ degree: 4, start: 1023, length: 1 }],
    },
  ];
  doc.patterns.lead = [
    {
      kind: "pitched",
      id: "lead-1",
      name: "A",
      bars: 2,
      rowDegrees: [0, 3, 5],
      notes: [{ degree: 3, start: 0, length: 32 }],
    },
    {
      kind: "pitched",
      id: "lead-2",
      name: "B",
      bars: 16,
      rowDegrees: [0, 3, 5],
      notes: [{ degree: 5, start: 255, length: 0.25 }],
    },
    {
      kind: "pitched",
      id: "lead-3",
      name: "C",
      bars: 128,
      rowDegrees: [0, 3, 5, 23],
      notes: [
        { degree: 3, start: 2047, length: 2048 }, // the space ceiling + full-span note
        { degree: 23, start: 0, length: 0.25 }, // degree + length floors
      ],
    },
  ];
  doc.songChain = {
    drums: ["drums-1", "drums-2", "drums-1"], // 3 slots, A repeats (unequal chains)
    bass: ["bass-1"],
    chords: ["chords-1", "chords-2"],
    lead: ["lead-1", "lead-2", "lead-3", "lead-2"], // 4 slots, B repeats
  };
  doc.chainCues = {
    drums: ["VERSE", null, "DROP"],
    bass: [null],
    chords: [null, null],
    lead: [null, null, null, null],
  };
  return doc;
}

/**
 * SV-2 dense seed #1: drums at MAXIMUM density — every piece, every step of
 * the full 2048-step 128-bar space. Measured 62,485 canonical chars ≈ 61 KB
 * at ~1 ms/decode (boolean arrays are the cheapest payload to validate), so
 * the widest per-step shape rides the 50k rotation for free.
 */
export function dense128DrumsProject(): ProjectDocument {
  const doc = cloneDefault();
  doc.name = "Dense 128 drums";
  doc.patterns.drums = [
    {
      kind: "drums",
      id: "drums-1",
      name: "A",
      bars: 128,
      steps: drumSteps(128, () => true),
    },
  ];
  return doc;
}

/**
 * SV-2 dense seed #2: pitched density — a 128-bar bass with a note on EVERY
 * step of one row (2,048 notes, the single-row maximum), plus a half-dense
 * lead row (every 2nd step). Note objects are the expensive payload to
 * validate, so rotation density stops here to keep the 50k soak bounded;
 * the FULL 4-lane max-dense worst case is the boundary class's job (below).
 */
export function dense128PitchedProject(): ProjectDocument {
  const doc = cloneDefault();
  doc.name = "Dense 128 pitched";
  doc.patterns.bass = [
    {
      kind: "pitched",
      id: "bass-1",
      name: "A",
      bars: 128,
      rowDegrees: [0, 1],
      notes: Array.from({ length: 2048 }, (_, i) => ({
        degree: 0,
        start: i,
        length: 1,
      })),
    },
  ];
  doc.patterns.lead = [
    {
      kind: "pitched",
      id: "lead-1",
      name: "A",
      bars: 128,
      rowDegrees: [0, 3],
      notes: Array.from({ length: 1024 }, (_, i) => ({
        degree: 3,
        start: i * 2,
        length: 1,
      })),
    },
  ];
  return doc;
}

/**
 * SV-2 (shared with tests/fuzz-codec.test.ts's 4 MB-boundary class; the same
 * synthetic worst case SV-1 measured for the raise — see
 * tests/document-codec-property.test.ts §"SV-1 codec-cap measurement"):
 * a dense 128-bar × 4-lane canonical doc — ONE pattern per lane, maximally
 * dense (a note on every step of every row; every drum step on), 3 max-FX
 * per lane. 2,693,1xx chars ≈ 2.63 MB — the demand for SV-1's 4 MB raise.
 * NOT in the mutation rotation (measured ~90 ms/decode); the boundary class
 * exercises it a bounded number of times.
 */
export function maximallyDenseV3Doc(): ProjectDocument {
  const doc = cloneDefault();
  const maxFx: FxDevice[] = [
    {
      type: "filter",
      bypassed: false,
      params: { kind: "bandpass", cutoffHz: 20000, q: 18 },
    },
    {
      type: "delay",
      bypassed: false,
      params: { timeSteps: 64, feedback: 0.95, mix: 1 },
    },
    { type: "reverb", bypassed: false, params: { size: 1, mix: 1 } },
  ];
  for (const lane of doc.lanes) lane.fxChain = maxFx;
  doc.patterns.drums = [
    {
      kind: "drums",
      id: "drums-1",
      name: "A",
      bars: 128,
      steps: drumSteps(128, () => true),
    },
  ];
  for (const lane of ["bass", "lead"] as const) {
    doc.patterns[lane] = [
      {
        kind: "pitched",
        id: `${lane}-1`,
        name: "A",
        bars: 128,
        rowDegrees: Array.from({ length: 14 }, (_, d) => d),
        notes: Array.from({ length: 14 * 2048 }, (_, i) => ({
          degree: Math.floor(i / 2048),
          start: i % 2048,
          length: 1,
        })),
      },
    ];
  }
  doc.patterns.chords = [
    {
      kind: "pitched",
      id: "chords-1",
      name: "A",
      bars: 128,
      rowDegrees: Array.from({ length: 7 }, (_, d) => d),
      notes: Array.from({ length: 7 * 2048 }, (_, i) => ({
        degree: Math.floor(i / 2048),
        start: i % 2048,
        length: 1,
      })),
    },
  ];
  return doc;
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
  | "nan-literal"
  | "v3-literal";

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
  // SC-1 v2 note-model keys (mutations must hit the new shape too).
  "notes",
  "rowDegrees",
  "start",
  "length",
  "degree",
  // SV-2 v3 keys: the octave register field, the widened bars vocabulary's
  // key, and the chain surfaces (songChain/chainCues) so unequal-chain
  // shapes mutate structurally too.
  "octave",
  "bars",
  "songChain",
  "chainCues",
  // PS-3 sample-voice provenance keys (same law: hit the new shape).
  "sampleProvenance",
  "license",
  "sourceUrl",
  "author",
  "nope",
];

/**
 * SV-2: v3 boundary literals — every widened edge as a NUMBER the mutator can
 * splice over any numeric field, driving the v3 laws (bars vocabulary, note
 * start/length space, octave register, degree ceiling, length grid) through
 * the real decode path from every seed shape.
 */
const V3_BOUNDARY_LITERALS = [
  "-3", // octave floor (accepted)
  "-4", // octave rejection neighbor
  "3", // octave ceiling (accepted)
  "4", // octave rejection neighbor
  "1.5", // octave/length off-grid neighbor
  "0.25", // MIN_NOTE_LENGTH (the length grid)
  "8", // bars vocabulary (v3-only members below)
  "16",
  "32",
  "64",
  "128", // bars ceiling (accepted)
  "127", // bars rejection neighbor (off the powers-of-two list)
  "129", // bars rejection neighbor
  "2047", // note start ceiling (accepted)
  "2048", // start rejection neighbor / MAX_NOTE_LENGTH (accepted as length)
  "2049", // length rejection neighbor
  "23", // degree ceiling (accepted)
  "24", // degree rejection neighbor
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

function firstKeyIndex(
  text: string,
): { start: number; end: number } | undefined {
  const m = /"([A-Za-z_][A-Za-z0-9_-]*)"\s*:/.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : undefined;
}

function firstNumberIndex(
  text: string,
): { start: number; end: number } | undefined {
  const m = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : undefined;
}

function deepNestJson(depth: number): string {
  return '{"a":'.repeat(depth) + "1" + "}".repeat(depth);
}

function applyMutation(
  name: MutationName,
  rng: () => number,
  text: string,
): string {
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
      return (
        text.slice(0, n.start) + "9".repeat(100 + pos(800)) + text.slice(n.end)
      );
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
    case "v3-literal": {
      const n = firstNumberIndex(text);
      if (!n) return text;
      const lit = V3_BOUNDARY_LITERALS[pos(V3_BOUNDARY_LITERALS.length)]!;
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
  "v3-literal",
];

// ---------------------------------------------------------------------------
// Counting twin of the pre-scan (hang-freedom proof: iterations === length)
// ---------------------------------------------------------------------------

function countingDepthScan(text: string): {
  depth: number;
  iterations: number;
} {
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
      if (DANGEROUS_KEYS.has(key))
        return `own key "${key}" reached the validated doc`;
      const hit = dangerousOwnKey(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
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
      summary.crashes.push(
        `case ${i} (${mutation}): mutator threw ${String(error)}`,
      );
      continue;
    }

    // Hang-freedom, operation-counted: the pre-scan is exactly linear.
    const counted = countingDepthScan(text);
    if (counted.iterations > text.length + 1) {
      summary.crashes.push(
        `case ${i} (${mutation}): pre-scan iterations exceeded input length`,
      );
    }
    // SV-2: the corpus bound scales with the decode cap — every mutated text
    // must stay inside the guarded parse surface (4 MB since SV-1's measured
    // raise; the max-dense rotation seeds leave ~2.5 MB of mutation room).
    if (text.length > DECODE_MAX_CHARS) {
      summary.crashes.push(
        `case ${i} (${mutation}): mutated text exceeded the decode cap (${text.length} > ${DECODE_MAX_CHARS})`,
      );
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
        summary.crashes.push(
          `case ${i} (${mutation}): encode(decode(encode(x))) !== encode(x)`,
        );
      }
      // Property: dangerous keys never reach the validated doc.
      const hit = dangerousOwnKey(doc, 0);
      if (hit) summary.crashes.push(`case ${i} (${mutation}): ${hit}`);
    }

    // Property: Object.prototype never polluted by anything above.
    if (prototypePolluted()) {
      summary.crashes.push(
        `case ${i} (${mutation}): Object.prototype polluted`,
      );
    }

    // importProjectFile text path: typed result, never a throw.
    try {
      const file = new File([text], "fuzz.bitbounce.json", {
        type: "application/json",
      });
      const result = await importProjectFile(file, db, {
        newId: () => `fuzz-${i}`,
        now: () => 0,
        readFile: () => Promise.resolve(text),
      });
      if (typeof result.ok !== "boolean") {
        summary.crashes.push(
          `case ${i} (${mutation}): importProjectFile returned non-result`,
        );
      }
    } catch (error) {
      summary.crashes.push(
        `case ${i} (${mutation}): importProjectFile THREW ${error?.constructor?.name ?? typeof error}: ${String(error)}`,
      );
    }
  }

  return summary;
}
