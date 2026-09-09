/**
 * VZ-MF-1 unit tests — preset/node model + seeded arrangement generator:
 * determinism over a seed sweep, computable seed distinctness (statistical),
 * model-owned clamps, JSON round-trip losslessness, and the no-schema /
 * no-Math.random fence (source-pinned, CA-1 csp.test.ts pattern).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_BLUEPRINT_NODES,
  VIZ_ARRANGEMENT_VERSION,
  arrangementEnvelope,
  generateArrangement,
  type VizArrangement,
  type VizPreset,
} from "../src/viz/presets";

/** Representative rig — placeholder kinds; the vocabulary is VZ-MF-2's. */
const FIXTURE: VizPreset = {
  id: "fixture",
  name: "Fixture Rig",
  nodeBlueprints: [
    {
      kind: "anchor",
      count: { min: 2, max: 5 },
      placement: [
        { key: "x", spec: { type: "range", min: 0, max: 1 } },
        { key: "y", spec: { type: "range", min: 0, max: 1 } },
      ],
      params: [
        { key: "size", spec: { type: "range", min: 10, max: 20, step: 0.25 } },
        { key: "mode", spec: { type: "enum", values: ["a", "b", "c", "d"] } },
      ],
    },
    {
      kind: "runner",
      placement: [{ key: "x", spec: { type: "range", min: 0, max: 1 } }],
      motion: [{ key: "speed", spec: { type: "range", min: 0.1, max: 2 } }],
    },
  ],
};

/** Deterministic seed sweep: hand-picked edge u32 values + an LCG tail. */
const SWEEP: number[] = [
  0,
  1,
  2,
  3,
  5,
  7,
  11,
  42,
  255,
  256,
  65535,
  65536,
  123456789,
  2147483647,
  2147483648,
  4294967295,
];
{
  let s = 1;
  for (let i = 0; i < 64; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    SWEEP.push(s);
  }
}

function anchorField(arr: VizArrangement, group: "placement" | "params", key: string) {
  return arr.nodes.find((n) => n.kind === "anchor")?.[group][key];
}

describe("seeded arrangement determinism (VZ-MF-1)", () => {
  it("identical seed ⇒ deep-equal arrangement, over the whole seed sweep", () => {
    for (const seed of SWEEP) {
      const a = generateArrangement(FIXTURE, seed);
      const b = generateArrangement(FIXTURE, seed);
      expect(a).toEqual(b);
    }
  });

  it("different seeds ⇒ computably distinct arrangements across the sweep", () => {
    const serialized = new Set(SWEEP.map((s) => JSON.stringify(generateArrangement(FIXTURE, s))));
    // 80 seeds, dozens of random draws each — collisions are float-impossible.
    expect(serialized.size).toBe(SWEEP.length);
  });

  it("normalizes the seed to u32 (negative === its unsigned form)", () => {
    expect(generateArrangement(FIXTURE, -1)).toEqual(
      generateArrangement(FIXTURE, 0xffffffff),
    );
    expect(generateArrangement(FIXTURE, 42).seed).toBe(42);
  });
});

describe("seed distinctness is statistical, not accidental (VZ-MF-1)", () => {
  it("continuous range fields spread across their declared range", () => {
    const N = 400;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      // Continuous [0,1] placement — not a step-quantized field.
      samples.push(anchorField(generateArrangement(FIXTURE, i * 7919 + 1), "placement", "x") as number);
    }
    // Model-owned clamp: never outside the declared [min, max].
    for (const v of samples) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Uniform-ish spread: wide observed support, near-mid mean, many distinct.
    expect(Math.min(...samples)).toBeLessThanOrEqual(0.05);
    expect(Math.max(...samples)).toBeGreaterThanOrEqual(0.95);
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
    expect(new Set(samples).size).toBeGreaterThan(N / 2);
  });

  it("enum fields hit every option without collapsing onto one", () => {
    const N = 200;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const mode = anchorField(generateArrangement(FIXTURE, i * 2654435761 + 7), "params", "mode");
      counts.set(mode as string, (counts.get(mode as string) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    for (const n of counts.values()) {
      // Expected N/4 = 50 each; ±30 is a very tolerant uniformity band.
      expect(n).toBeGreaterThan(20);
      expect(n).toBeLessThan(80);
    }
  });
});

describe("model-owned clamps (VZ-MF-1)", () => {
  it("range values stay in [min, max] across the sweep", () => {
    for (const seed of SWEEP) {
      const arr = generateArrangement(FIXTURE, seed);
      for (const node of arr.nodes) {
        const x = node.placement["x"];
        expect(typeof x).toBe("number");
        expect(x as number).toBeGreaterThanOrEqual(0);
        expect(x as number).toBeLessThanOrEqual(1);
        if (node.motion["speed"] !== undefined) {
          expect(node.motion["speed"]).toBeGreaterThanOrEqual(0.1);
          expect(node.motion["speed"]).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("step-quantized ranges land on step multiples (still in range)", () => {
    for (let seed = 0; seed < 100; seed++) {
      const size = anchorField(generateArrangement(FIXTURE, seed), "params", "size") as number;
      // 0.25 is binary-exact: the multiple check is exact, not epsilon.
      expect(Number.isInteger(size / 0.25)).toBe(true);
      expect(size).toBeGreaterThanOrEqual(10);
      expect(size).toBeLessThanOrEqual(20);
    }
  });

  it("count resolves inside [1, MAX_BLUEPRINT_NODES] whatever the spec says", () => {
    const clampTest: VizPreset = {
      id: "clamp",
      name: "Clamp Rig",
      nodeBlueprints: [
        { kind: "floor", count: { min: 0, max: 0 } }, // degenerate min ⇒ 1
        { kind: "ceil", count: { min: 1e9, max: 1e9 } }, // absurd ⇒ capped
        { kind: "fixed", count: { min: 3, max: 3 } }, // exact ⇒ exact
      ],
    };
    for (const seed of SWEEP) {
      const arr = generateArrangement(clampTest, seed);
      const byKind = (kind: string) => arr.nodes.filter((n) => n.kind === kind).length;
      expect(byKind("floor")).toBe(1);
      expect(byKind("ceil")).toBe(MAX_BLUEPRINT_NODES);
      expect(byKind("fixed")).toBe(3);
    }
  });

  it("degenerate field specs normalize, never throw", () => {
    const degenerate: VizPreset = {
      id: "degenerate",
      name: "Degenerate Rig",
      nodeBlueprints: [
        {
          kind: "weird",
          params: [
            { key: "reversed", spec: { type: "range", min: 9, max: 3 } }, // swapped
            { key: "nan", spec: { type: "range", min: Number.NaN, max: 5 } }, // → 0..5
            { key: "empty", spec: { type: "enum", values: [] } }, // → ""
          ],
        },
      ],
    };
    for (const seed of SWEEP) {
      const node = generateArrangement(degenerate, seed).nodes[0]!;
      const reversed = node.params["reversed"] as number;
      expect(reversed).toBeGreaterThanOrEqual(3);
      expect(reversed).toBeLessThanOrEqual(9);
      const nan = node.params["nan"] as number;
      expect(nan).toBeGreaterThanOrEqual(0);
      expect(nan).toBeLessThanOrEqual(5);
      expect(Number.isFinite(nan)).toBe(true);
      expect(node.params["empty"]).toBe("");
    }
  });
});

describe("arrangement structure (VZ-MF-1)", () => {
  it("deals count nodes per blueprint, carries kinds through, unique ids", () => {
    for (const seed of SWEEP) {
      const arr = generateArrangement(FIXTURE, seed);
      const anchors = arr.nodes.filter((n) => n.kind === "anchor");
      const runners = arr.nodes.filter((n) => n.kind === "runner");
      expect(anchors.length).toBeGreaterThanOrEqual(2);
      expect(anchors.length).toBeLessThanOrEqual(5);
      expect(runners.length).toBe(1); // no count spec ⇒ exactly one
      expect(arr.presetId).toBe("fixture");
      expect(arr.seed).toBe(seed >>> 0);
      const ids = new Set(arr.nodes.map((n) => n.id));
      expect(ids.size).toBe(arr.nodes.length);
      for (const node of anchors) {
        expect(node.placement["x"]).toBeDefined();
        expect(node.placement["y"]).toBeDefined();
        expect(node.params["size"]).toBeDefined();
        expect(node.params["mode"]).toBeDefined();
      }
    }
  });

  it("an empty preset deals an empty (still deterministic) rig", () => {
    const empty: VizPreset = { id: "empty", name: "Empty", nodeBlueprints: [] };
    const a = generateArrangement(empty, 123);
    expect(a).toEqual({ presetId: "empty", seed: 123, nodes: [] });
    expect(a).toEqual(generateArrangement(empty, 123));
  });
});

describe("JSON round-trip + persistence envelope (VZ-MF-1)", () => {
  it("arrangements round-trip losslessly (plain JSON, no hidden state)", () => {
    for (const seed of SWEEP) {
      const arr = generateArrangement(FIXTURE, seed);
      const revived = JSON.parse(JSON.stringify(arr)) as VizArrangement;
      expect(revived).toEqual(arr);
    }
  });

  it("presets themselves are plain JSON data", () => {
    expect(JSON.parse(JSON.stringify(FIXTURE))).toEqual(FIXTURE);
  });

  it("envelope is exactly { version, presetId, seed } and round-trips", () => {
    const arr = generateArrangement(FIXTURE, 987654321);
    const env = arrangementEnvelope(arr);
    expect(env).toEqual({ version: 1, presetId: "fixture", seed: 987654321 });
    expect(env.version).toBe(VIZ_ARRANGEMENT_VERSION);
    expect(JSON.parse(JSON.stringify(env))).toEqual(env);
  });

  it("the envelope is sufficient to re-deal the exact same rig", () => {
    const original = generateArrangement(FIXTURE, 424242);
    const env = arrangementEnvelope(original);
    const reDealt = generateArrangement(FIXTURE, env.seed);
    expect(reDealt).toEqual(original);
  });
});

describe("model fence (VZ-MF-1 acceptance: grep-clean source)", () => {
  const SOURCE = readFileSync("src/viz/presets.ts", "utf8");

  it("imports no schema / valibot / document module", () => {
    expect(SOURCE).not.toMatch(/from\s+"[^"]*(document\/schema|valibot)/);
    expect(SOURCE).not.toMatch(/from\s+"[^"]*document/);
  });

  it("never calls Math.random — randomness only via the shared xorshift32", () => {
    expect(SOURCE).not.toMatch(/Math\.random\s*\(/);
    expect(SOURCE).toMatch(
      /import\s+\{[^}]*xorshift32[^}]*\}\s+from\s+"\.\.\/audio\/fx"/,
    );
  });
});
