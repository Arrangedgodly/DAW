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
import { contentHash, decode, encode } from "../src/document/codec";
import { DRUM_PIECES, LANE_IDS, type FxDevice } from "../src/document/schema";
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
const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const range = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const quantize = (x: number, steps: number): number => Math.round(x * steps) / steps;

function randomFx(rng: Rng): FxDevice {
  const bypassed = rng() < 0.5;
  switch (range(rng, 0, 4)) {
    case 0:
      return { type: "filter", bypassed, params: { cutoffHz: range(rng, 20, 20000), q: quantize(range(rng, 1, 180) / 10, 10) } };
    case 1:
      return { type: "drive", bypassed, params: { amount: quantize(rng(), 100) } };
    case 2:
      return { type: "bitcrusher", bypassed, params: { bits: range(rng, 1, 16), downsample: range(rng, 1, 64) } };
    case 3:
      return { type: "delay", bypassed, params: { timeSteps: range(rng, 1, 64), feedback: quantize(rng() * 0.95, 100), mix: quantize(rng(), 100) } };
    default:
      return { type: "reverb", bypassed, params: { size: quantize(rng(), 100), mix: quantize(rng(), 100) } };
  }
}

function generateProject(rng: Rng): ProjectDocument {
  const doc: ProjectDocument = JSON.parse(JSON.stringify(createDefaultProject()));
  doc.name = `prop-${range(rng, 0, 9999)}`;
  doc.transport = {
    bpm: range(rng, 60, 200),
    swing: quantize(rng(), 4),
    loopBars: pick(rng, [1, 2, 4]),
    metronome: rng() < 0.5,
  };
  doc.scale = { root: range(rng, 0, 11), mode: pick(rng, MODE_NAMES) };
  doc.laneOverrides =
    rng() < 0.5
      ? null
      : Object.fromEntries(
          LANE_IDS.filter(() => rng() < 0.5).map((id) => [id, { root: range(rng, 0, 11), mode: pick(rng, MODE_NAMES) }]),
        );
  for (const lane of doc.lanes) {
    const fxCount = range(rng, 0, 3);
    lane.fxChain = Array.from({ length: fxCount }, () => randomFx(rng));
    lane.gate = rng() < 0.5
      ? { unit: "steps", value: pick(rng, [0.25, 0.5, 1, 2, 4, 8]) }
      : { unit: "seconds", value: quantize(rng() * 4, 100) };
  }
  // Flip pattern cells in place (lengths stay canonical: 16 x bars).
  for (const laneId of LANE_IDS) {
    for (const pattern of doc.patterns[laneId]) {
      const len = pattern.bars * 16;
      if (pattern.kind === "drums") {
        for (const piece of DRUM_PIECES) {
          for (let i = 0; i < len; i++) if (rng() < 0.3) pattern.steps[piece][i] = !pattern.steps[piece][i];
        }
      } else {
        for (const row of pattern.rows) {
          for (let i = 0; i < len; i++) if (rng() < 0.2) row.steps[i] = pick(rng, [0, 1, 2]);
        }
      }
    }
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

const CASES: ProjectDocument[] = Array.from({ length: N_PROJECTS }, (_, i) => generateProject(mulberry32(SEED + i)));

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
      expect(encode(JSON.parse(JSON.stringify(CASES[i])) as ProjectDocument)).toBe(first); // JSON copy
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
});
