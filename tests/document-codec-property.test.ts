/**
 * Serialization round-trip property suite (HW-1, RES-7 strategy).
 *
 * No fast-check dependency (justified): the valid-document space is deeply
 * schema-constrained; a tiny deterministic LCG generator that mutates a valid
 * base document into N pseudo-random valid variants gives the same coverage
 * for the three properties under test (round-trip losslessness, canonical-byte
 * stability, hash stability) without a new dep or shrink-path maintenance.
 * Determinism: fixed seed → failures reproduce exactly.
 */

import { describe, expect, it } from "vitest";
import {
  DECODE_MAX_CHARS,
  canonicalize,
  contentHash,
  decode,
  encode,
} from "../src/document/codec";
import {
  DRUM_PIECES,
  LANE_IDS,
  type FxDevice,
  type Note,
  type SampleProvenanceEntry,
} from "../src/document/schema";
import type { ProjectDocument } from "../src/document/schema";
import { createDefaultProject } from "../src/document/schema";
import { MODE_NAMES } from "../src/document/scales";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — seeded, no Math.random anywhere.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xbee7_1e55;
const N_PROJECTS = 40;

// ---------------------------------------------------------------------------
// Generator: pseudo-random valid projects (all mutations stay schema-valid).
// ---------------------------------------------------------------------------

type Rng = () => number;
const pick = <T>(rng: Rng, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)]!;
const range = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));
const quantize = (x: number, steps: number): number =>
  Math.round(x * steps) / steps;

function randomFx(rng: Rng): FxDevice {
  const bypassed = rng() < 0.5;
  switch (range(rng, 0, 4)) {
    case 0:
      return {
        type: "filter",
        bypassed,
        params: {
          cutoffHz: range(rng, 20, 20000),
          q: quantize(range(rng, 1, 180) / 10, 10),
        },
      };
    case 1:
      return {
        type: "drive",
        bypassed,
        params: { amount: quantize(rng(), 100) },
      };
    case 2:
      return {
        type: "bitcrusher",
        bypassed,
        params: { bits: range(rng, 1, 16), downsample: range(rng, 1, 64) },
      };
    case 3:
      return {
        type: "delay",
        bypassed,
        params: {
          timeSteps: range(rng, 1, 64),
          feedback: quantize(rng() * 0.95, 100),
          mix: quantize(rng(), 100),
        },
      };
    default:
      return {
        type: "reverb",
        bypassed,
        params: { size: quantize(rng(), 100), mix: quantize(rng(), 100) },
      };
  }
}

function generateProject(rng: Rng): ProjectDocument {
  const doc: ProjectDocument = JSON.parse(
    JSON.stringify(createDefaultProject()),
  );
  doc.name = `prop-${range(rng, 0, 9999)}`;
  doc.transport = {
    bpm: range(rng, 60, 200),
    swing: quantize(rng(), 4),
    metronome: rng() < 0.5,
  };
  doc.scale = { root: range(rng, 0, 11), mode: pick(rng, MODE_NAMES) };
  doc.laneOverrides =
    rng() < 0.5
      ? null
      : Object.fromEntries(
          LANE_IDS.filter(() => rng() < 0.5).map((id) => [
            id,
            { root: range(rng, 0, 11), mode: pick(rng, MODE_NAMES) },
          ]),
        );
  for (const lane of doc.lanes) {
    const fxCount = range(rng, 0, 3);
    lane.fxChain = Array.from({ length: fxCount }, () => randomFx(rng));
    lane.gate =
      rng() < 0.5
        ? { unit: "steps", value: pick(rng, [0.25, 0.5, 1, 2, 4, 8]) }
        : { unit: "seconds", value: quantize(rng() * 4, 100) };
  }
  // Randomize pattern content (SC-1 v2 notes; SV-1 v3 bars): drums flip
  // steps; pitched patterns get random on-grid notes across their row
  // manifests. SV-1 (J7): pattern bars pick from the FULL v3 powers-of-two
  // vocabulary (arrays/notes rebuilt at the pattern's real width — the
  // generator never leans on the old 1-bar default).
  for (const laneId of LANE_IDS) {
    for (const pattern of doc.patterns[laneId]) {
      pattern.bars = pick(rng, [1, 2, 4, 8, 16, 32, 64, 128]);
      const len = pattern.bars * 16;
      if (pattern.kind === "drums") {
        for (const piece of DRUM_PIECES) {
          pattern.steps[piece] = new Array(len).fill(false);
          for (let i = 0; i < len; i++)
            if (rng() < 0.3) pattern.steps[piece][i] = !pattern.steps[piece][i];
        }
      } else {
        const notes: Note[] = [];
        for (const degree of pattern.rowDegrees) {
          for (let i = 0; i < len; i++) {
            if (rng() >= 0.2) continue;
            notes.push({
              degree,
              start: i,
              length: pick(rng, [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8]),
            });
          }
        }
        notes.sort((a, b) => a.degree - b.degree || a.start - b.start);
        pattern.notes = notes;
      }
    }
  }
  // SV-1 (i3-2): some pitched lanes carry an octave transpose (nonzero only —
  // 0 is the canonical-empty form the writer law omits; both states occur,
  // asserted in generator sanity below).
  for (const lane of doc.lanes) {
    if (lane.id !== "drums" && rng() < 0.25) {
      lane.octave = pick(rng, [-3, -2, -1, 1, 2, 3]);
    }
  }
  // PS-3: most projects are synth-only (canonical-empty — field omitted);
  // the rest record a sample-voice provenance echo map of pseudo assets.
  if (rng() < 0.5) {
    const entries: Record<string, SampleProvenanceEntry> = {};
    const count = range(rng, 1, 6);
    for (let i = 0; i < count; i++) {
      entries[`voice.${pick(rng, ["bass", "chords", "lead"])}.p${i}`] = {
        license: pick(rng, ["CC0", "CC0 1.0", "MIT"]),
        sourceUrl: `https://sources.test/${range(rng, 1, 999)}`,
        author: `Author ${range(rng, 1, 99)}`,
      };
    }
    doc.sampleProvenance = entries;
  } else {
    delete doc.sampleProvenance;
  }
  return doc;
}

/** Value-equal copy with object keys re-inserted in reverse order at every level. */
function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort().reverse()) {
      out[key] = reverseKeyOrder((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const CASES: ProjectDocument[] = Array.from({ length: N_PROJECTS }, (_, i) =>
  generateProject(mulberry32(SEED + i)),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("property: encode → decode round-trip is lossless", () => {
  for (let i = 0; i < CASES.length; i++) {
    it(`case ${i}: deep-equal after round-trip`, () => {
      expect(decode(encode(CASES[i]!))).toEqual(CASES[i]);
    });
  }
});

describe("property: canonical bytes are stable", () => {
  for (let i = 0; i < CASES.length; i++) {
    it(`case ${i}: repeated encodes identical + key-order invariant`, () => {
      const first = encode(CASES[i]!);
      expect(encode(CASES[i]!)).toBe(first); // repeated encode
      expect(
        encode(JSON.parse(JSON.stringify(CASES[i])) as ProjectDocument),
      ).toBe(first); // JSON copy
      expect(encode(reverseKeyOrder(CASES[i]) as ProjectDocument)).toBe(first); // shuffled keys
    });
  }
});

describe("property: content hash is stable", () => {
  for (let i = 0; i < CASES.length; i++) {
    it(`case ${i}: hash stable across calls and key order`, () => {
      const h = contentHash(CASES[i]!);
      expect(contentHash(CASES[i]!)).toBe(h);
      expect(contentHash(reverseKeyOrder(CASES[i]))).toBe(h);
      expect(h).toMatch(/^[0-9a-f]{8}$/);
    });
  }
});

describe("generator sanity", () => {
  it("produces distinct documents across seeds", () => {
    const hashes = new Set(CASES.map((doc) => contentHash(doc)));
    expect(hashes.size).toBeGreaterThan(N_PROJECTS / 2);
  });

  it("PS-3: both provenance states occur — synth-only (field omitted) AND sample-echo projects", () => {
    const withEcho = CASES.filter((doc) => doc.sampleProvenance !== undefined);
    // Both branches must be exercised so the round-trip/canonical/hash
    // properties genuinely cover the new field (not just its absence).
    expect(withEcho.length).toBeGreaterThan(0);
    expect(withEcho.length).toBeLessThan(N_PROJECTS);
    for (const doc of withEcho) {
      expect(Object.keys(doc.sampleProvenance!).length).toBeGreaterThan(0);
    }
  });

  it("the legacy length presets and both octave states occur across seeds", () => {
    const barsSeen = new Set<number>();
    for (const doc of CASES)
      for (const lane of LANE_IDS)
        for (const p of doc.patterns[lane]) barsSeen.add(p.bars);
    expect([...barsSeen].sort((a, b) => a - b)).toEqual([
      1, 2, 4, 8, 16, 32, 64, 128,
    ]);
    const withOctave = CASES.filter((doc) =>
      doc.lanes.some((l) => l.octave !== undefined),
    );
    expect(withOctave.length).toBeGreaterThan(0);
    expect(withOctave.length).toBeLessThan(N_PROJECTS);
  });
});

// ---------------------------------------------------------------------------
// SC-1: v1 → v2 migration properties (random v1 cell docs decode cleanly)
// ---------------------------------------------------------------------------

describe("property: v1 documents decode through the migration (SC-1)", () => {
  for (let i = 0; i < N_PROJECTS; i++) {
    it(`case ${i}: random v1 cell docs migrate, validate, and stay stable`, () => {
      const rng = mulberry32(0x5c1_0000 + i);
      const doc = generateProject(rng);
      // Rebuild every pitched pattern as a RANDOM v1 cell pattern (note-ons,
      // sustain runs, orphans — exactly the v0 generator's cell flips).
      const v1 = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      v1["version"] = 1;
      const patterns = v1["patterns"] as Record<string, unknown>;
      // Drums: re-pick v1-legal bars and re-fit the step arrays (the v3
      // generator may have widened them past the v1 vocabulary).
      for (const p of patterns["drums"] as Record<string, unknown>[]) {
        const bars = pick(rng, [1, 2, 4]);
        p["bars"] = bars;
        const steps = p["steps"] as Record<string, boolean[]>;
        for (const piece of Object.keys(steps)) {
          steps[piece] = Array.from(
            { length: 16 * bars },
            (_, i) => steps[piece]![i] ?? false,
          );
        }
      }
      for (const lane of ["bass", "chords", "lead"] as const) {
        patterns[lane] = (patterns[lane] as Record<string, unknown>[]).map(
          (p) => {
            // v1-legal bars only ([1,2,4] — the v1 picklist; the v3 generator
            // may have widened the pattern, so the v1 CORPUS re-picks).
            const bars = pick(rng, [1, 2, 4]);
            const degrees = (p["rowDegrees"] as number[]) ?? [
              0, 1, 2, 3, 4, 5, 6,
            ];
            const rows = degrees.map((degree) => ({
              degree,
              steps: Array.from({ length: 16 * bars }, () => {
                const roll = rng();
                return roll < 0.12 ? 1 : roll < 0.22 ? 2 : 0;
              }),
            }));
            return { ...p, bars, rows };
          },
        );
      }
      const text = canonicalize(v1);
      const migrated = decode(text);
      expect(migrated.version).toBe(3);
      // Every v1 note-on became exactly one note.
      for (const lane of ["bass", "chords", "lead"] as const) {
        const v1Patterns = patterns[lane] as Record<string, unknown>[];
        const allNoteOns = v1Patterns.reduce(
          (n, p) =>
            n +
            (p["rows"] as { steps: number[] }[])
              .flatMap((r) => r.steps)
              .filter((c) => c === 1).length,
          0,
        );
        const migratedNotes = migrated.patterns[lane].reduce(
          (n, p) => n + (p.kind === "pitched" ? p.notes.length : 0),
          0,
        );
        expect(migratedNotes, lane).toBe(allNoteOns);
      }
      // Canonical stability through the migrated form.
      expect(decode(encode(migrated))).toEqual(migrated);
    });
  }
});

// ---------------------------------------------------------------------------
// SV-1: v3 boundary shapes (the widened bound law) + the codec-cap
// measurement that sized the 4 MB raise (D5).
// ---------------------------------------------------------------------------

describe("property: v3 boundary shapes (SV-1)", () => {
  function boundaryDoc(): ProjectDocument {
    const doc: ProjectDocument = JSON.parse(
      JSON.stringify(createDefaultProject()),
    );
    doc.patterns.bass = [
      {
        kind: "pitched",
        id: "bass-1",
        name: "A",
        bars: 128,
        rowDegrees: [0, 1, 2, 3, 4, 5, 6],
        notes: [
          { degree: 0, start: 2047, length: 2048 }, // both ceilings at once
          { degree: 1, start: 64, length: 0.25 }, // past v2's 63 bound
          { degree: 2, start: 2046, length: 2 }, // 0.25-grid neighbor
        ],
      },
    ];
    doc.patterns.lead = [
      {
        kind: "pitched",
        id: "lead-1",
        name: "A",
        bars: 8,
        rowDegrees: [0, 1, 2, 3, 4, 5, 6],
        notes: [{ degree: 3, start: 127, length: 128 }],
      },
    ];
    doc.patterns.drums = [
      {
        kind: "drums",
        id: "drums-1",
        name: "A",
        bars: 128,
        steps: Object.fromEntries(
          DRUM_PIECES.map((piece) => [piece, new Array(2048).fill(false)]),
        ) as (typeof doc.patterns.drums)[number]["steps"],
      },
    ];
    doc.patterns.drums[0]!.steps.kick[2047] = true;
    return doc;
  }

  it("the 2047/2048 boundary doc validates and round-trips losslessly", () => {
    const doc = boundaryDoc();
    const text = encode(doc);
    const back = decode(text);
    expect(back).toEqual(doc);
    expect(encode(back)).toBe(text); // canonical stability at the boundary
  });

  it("out-of-bound neighbors reject typed", () => {
    // start 128 on an 8-bar pattern sits OUTSIDE the pattern (width = 128 —
    // the semantic layer's binder; the schema's 2047 only bounds the SPACE).
    const outside = boundaryDoc();
    outside.patterns.lead = [
      {
        ...outside.patterns.lead[0]!,
        notes: [{ degree: 3, start: 128, length: 1 }],
      },
    ];
    expect(() => decode(encode(outside))).toThrow();

    const over = boundaryDoc();
    over.patterns.bass = [
      {
        ...over.patterns.bass[0]!,
        notes: [{ degree: 0, start: 2048, length: 1 }], // over the space bound
      },
    ];
    expect(() => decode(encode(over))).toThrow();
  });
});

describe("SV-1 codec-cap measurement (D5 — the 4 MB raise's demand)", () => {
  /**
   * The synthetic worst case from the plan's sizing anchor: a dense 128-bar
   * 4-lane canonical doc — ONE pattern per lane, maximally dense (a note on
   * every step of every row; every drum step on), 3 max-FX per lane. This
   * measured 2,693,153 chars under the OLD 1 MB cap, which is what demanded
   * the raise to 4 MB (see codec.ts for the full measurement record).
   */
  function maximallyDenseV3Doc(): ProjectDocument {
    const doc: ProjectDocument = JSON.parse(
      JSON.stringify(createDefaultProject()),
    );
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
        steps: Object.fromEntries(
          DRUM_PIECES.map((piece) => [piece, new Array(2048).fill(true)]),
        ) as (typeof doc.patterns.drums)[number]["steps"],
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

  it("the maximally dense legal v3 doc stays under the cap (silent growth trips CI)", () => {
    const text = encode(maximallyDenseV3Doc());
    // The demand for the raise, pinned: the worst case exceeds the OLD cap…
    expect(text.length).toBeGreaterThan(1_048_576);
    // …and fits the new one with headroom (4 MB = 4,194,304).
    expect(text.length).toBeLessThan(DECODE_MAX_CHARS);
    // And it is a REAL document: decode round-trips it losslessly.
    expect(decode(text).patterns.bass[0]!.bars).toBe(128);
  });
});
