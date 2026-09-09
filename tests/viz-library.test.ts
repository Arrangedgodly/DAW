/**
 * VZ-MF-2 unit tests — effect-node vocabulary + built-in preset library:
 * integrity (ids/names/kinds/field specs validate against the model's
 * normalization — no silently-degenerate blueprints), R1 budget laws
 * (envelope window, anchor sizes, per-lane hit cost, rig size), arrangement
 * validity over a seed sweep, golden-ish determinism pins (sha256 digests at
 * a canonical seed, MF-1's golden strategy in miniature), and the
 * cycle/canary/default registry contract. Source fence mirrors VZ-MF-1's
 * (no Math.random, no schema/valibot/document imports in the data modules).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANE_IDS } from "../src/document/schema";
import {
  VIZ_PRESETS,
  VIZ_CANARY_PRESET_IDS,
  VIZ_DEFAULT_PRESET_ID,
  arrangementEnvelope,
  cycleVizPreset,
  generateArrangement,
  type VizField,
  type VizFieldSpec,
  type VizPreset,
} from "../src/viz/presets";
import {
  VIZ_ENVELOPE_DECAY_MAX_SECONDS,
  VIZ_ENVELOPE_DECAY_MIN_SECONDS,
  VIZ_KIND_DOCS,
  VIZ_LANE_BINDINGS,
  VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS,
  VIZ_MAX_HIT_OBJECTS_PER_LANE,
  VIZ_MAX_RIG_NODES,
  VIZ_NODE_KINDS,
  isVizNodeKind,
  vizBlueprintHitCost,
  vizKindDoc,
} from "../src/viz/vocabulary";

const CANONICAL_SEED = 20260904; // the run date — the golden pin seed.

/** Deterministic seed sweep: MF-1's edge values + a shorter LCG tail. */
const SWEEP: number[] = [
  0, 1, 2, 3, 5, 7, 11, 42, 255, 256, 65535, 65536, 123456789, 2147483647,
  2147483648, 4294967295,
];
{
  let s = 1;
  for (let i = 0; i < 24; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    SWEEP.push(s);
  }
}

/** Every field of a blueprint, flattened with its group. */
function fieldsOf(preset: VizPreset) {
  const out: Array<{
    group: "placement" | "motion" | "params";
    field: VizField;
    kind: string;
  }> = [];
  for (const bp of preset.nodeBlueprints) {
    (["placement", "motion", "params"] as const).forEach((group) => {
      for (const field of bp[group] ?? [])
        out.push({ group, field, kind: bp.kind });
    });
  }
  return out;
}

/** The lane(s) a blueprint can ignite on (from its placement.lane enum). */
function lanesOf(preset: VizPreset, blueprintIndex: number): string[] {
  const laneField = preset.nodeBlueprints[blueprintIndex]!.placement?.find(
    (f) => f.key === "lane",
  );
  if (!laneField || laneField.spec.type !== "enum") return ["any"]; // unset → default
  return laneField.spec.values as readonly string[];
}

/** sha256-based arrangement digest (the tests/golden strategy, in miniature). */
function digestOf(preset: VizPreset, seed: number): string {
  return createHash("sha256")
    .update(JSON.stringify(generateArrangement(preset, seed)))
    .digest("hex")
    .slice(0, 16);
}

describe("library integrity (VZ-MF-2)", () => {
  it("ships 8–12 presets (the lean-fence library band)", () => {
    expect(VIZ_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(VIZ_PRESETS.length).toBeLessThanOrEqual(12);
  });

  it("has unique kebab ids and unique speakable names (DD-2 announces them)", () => {
    const ids = VIZ_PRESETS.map((p) => p.id);
    const names = VIZ_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const preset of VIZ_PRESETS) {
      expect(preset.id).toMatch(/^[a-z][a-z0-9-]*$/);
      // Speakable: short Title Case-ish label ("First Light"), not an id.
      expect(preset.name).toMatch(/^[A-Z][A-Za-z0-9' ,.-]{2,23}$/);
      expect(preset.name).not.toMatch(/[-_]/);
    }
  });

  it("every preset has at least one blueprint and every kind is known", () => {
    for (const preset of VIZ_PRESETS) {
      expect(preset.nodeBlueprints.length).toBeGreaterThan(0);
      for (const bp of preset.nodeBlueprints) {
        expect(isVizNodeKind(bp.kind)).toBe(true);
      }
    }
  });

  it("field specs are well-formed — nothing the model would silently normalize", () => {
    for (const preset of VIZ_PRESETS) {
      for (const bp of preset.nodeBlueprints) {
        const doc = vizKindDoc(bp.kind);
        expect(doc, `unknown kind ${bp.kind}`).toBeDefined();
        for (const group of ["placement", "motion", "params"] as const) {
          const fields = bp[group] ?? [];
          // No duplicate keys inside a group (the model keeps the last only).
          expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
          for (const field of fields) {
            // Keys must exist in the kind's documented vocabulary (typo fence).
            const documented = doc!.fields.some(
              (d) => d.key === field.key && d.group === group,
            );
            expect(
              documented,
              `${preset.id}/${bp.kind}/${group}.${field.key} not in vocabulary`,
            ).toBe(true);
            const spec: VizFieldSpec = field.spec;
            if (spec.type === "range") {
              expect(Number.isFinite(spec.min)).toBe(true);
              expect(Number.isFinite(spec.max)).toBe(true);
              expect(spec.min).toBeLessThanOrEqual(spec.max); // no silent swap
              if (spec.step !== undefined) {
                expect(spec.step).toBeGreaterThan(0);
                expect(Number.isFinite(spec.step)).toBe(true);
              }
            } else {
              expect(spec.values.length).toBeGreaterThan(0); // no silent ""
              for (const value of spec.values) {
                expect(value.length).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }
  });

  it("every blueprint carries the shared placement trio and an explicit decay", () => {
    for (const preset of VIZ_PRESETS) {
      for (const bp of preset.nodeBlueprints) {
        const keys = (group: "placement" | "params") =>
          new Set((bp[group] ?? []).map((f) => f.key));
        for (const key of ["x", "y", "lane"]) {
          expect(
            keys("placement").has(key),
            `${preset.id}/${bp.kind} placement.${key}`,
          ).toBe(true);
        }
        expect(
          keys("params").has("decay"),
          `${preset.id}/${bp.kind} params.decay`,
        ).toBe(true);
      }
    }
  });

  it("counts stay inside the rig discipline (Σ max ≤ VIZ_MAX_RIG_NODES)", () => {
    for (const preset of VIZ_PRESETS) {
      let total = 0;
      for (const bp of preset.nodeBlueprints) {
        if (bp.count) {
          expect(bp.count.min).toBeGreaterThanOrEqual(1);
          expect(bp.count.max).toBeGreaterThanOrEqual(bp.count.min);
        }
        total += Math.max(1, bp.count?.max ?? 1);
      }
      expect(total).toBeLessThanOrEqual(VIZ_MAX_RIG_NODES);
    }
  });

  it("lane bindings are legal and match the real schema lanes", () => {
    // Vocabulary bindings: the four real LaneId strings + "any", nothing else.
    expect([...VIZ_LANE_BINDINGS].sort()).toEqual([...LANE_IDS, "any"].sort());
    for (const preset of VIZ_PRESETS) {
      for (const { field } of fieldsOf(preset)) {
        if (field.key !== "lane") continue;
        expect(field.spec.type).toBe("enum");
        for (const value of (field.spec as { values: readonly string[] })
          .values) {
          expect(VIZ_LANE_BINDINGS).toContain(value);
        }
      }
    }
  });
});

describe("R1 budget laws in the data (VZ-MF-2)", () => {
  it("every decay spec sits inside the committed [0.1, 0.4] s window", () => {
    for (const preset of VIZ_PRESETS) {
      for (const { field, kind } of fieldsOf(preset)) {
        if (field.key !== "decay" || field.spec.type !== "range") continue;
        expect(field.spec.min, `${preset.id}/${kind}`).toBeGreaterThanOrEqual(
          VIZ_ENVELOPE_DECAY_MIN_SECONDS,
        );
        expect(field.spec.max, `${preset.id}/${kind}`).toBeLessThanOrEqual(
          VIZ_ENVELOPE_DECAY_MAX_SECONDS,
        );
      }
    }
  });

  it("filled-area sizes respect the R1 anchor ceiling (0.3 stage units)", () => {
    const CAPPED: Record<string, readonly string[]> = {
      bloom: ["radius"],
      ripple: ["rEnd"],
      spark: ["reach"],
      orbit: ["radius"],
    };
    for (const preset of VIZ_PRESETS) {
      for (const { field, kind } of fieldsOf(preset)) {
        if (field.spec.type !== "range") continue;
        if (CAPPED[kind]?.includes(field.key)) {
          expect(
            field.spec.max,
            `${preset.id}/${kind}.${field.key}`,
          ).toBeLessThanOrEqual(VIZ_MAX_ANCHOR_RADIUS_STAGE_UNITS);
        }
      }
    }
  });

  it("ripple initial radii never exceed their expansion limit", () => {
    for (const preset of VIZ_PRESETS) {
      for (const bp of preset.nodeBlueprints) {
        if (bp.kind !== "ripple") continue;
        const max = (key: string) =>
          (
            bp.params?.find((f) => f.key === key)?.spec as
              { max: number } | undefined
          )?.max;
        expect(max("r0max")).toBeLessThanOrEqual(max("rEnd")!);
        expect(max("r0min")).toBeLessThanOrEqual(max("r0max")!);
      }
    }
  });

  it("worst-case objects per ignited lane ≤ 8 (R1 burst budget)", () => {
    for (const preset of VIZ_PRESETS) {
      const perLane = new Map<string, number>(
        [...LANE_IDS, "any"].map((lane) => [lane, 0]),
      );
      preset.nodeBlueprints.forEach((bp, index) => {
        const cost = vizBlueprintHitCost(bp);
        for (const lane of lanesOf(preset, index)) {
          perLane.set(lane, (perLane.get(lane) ?? 0) + cost);
        }
      });
      for (const [lane, cost] of perLane) {
        expect(
          cost,
          `${preset.id} lane ${lane} hit cost ${cost}`,
        ).toBeLessThanOrEqual(VIZ_MAX_HIT_OBJECTS_PER_LANE);
      }
    }
  });
});

describe("arrangement validity across the seed sweep (VZ-MF-2)", () => {
  it("every resolved value is finite / non-empty; x,y on-stage; decay in window", () => {
    for (const preset of VIZ_PRESETS) {
      for (const seed of SWEEP) {
        const arr = generateArrangement(preset, seed);
        expect(arr.presetId).toBe(preset.id);
        const ids = new Set<string>();
        for (const node of arr.nodes) {
          expect(isVizNodeKind(node.kind)).toBe(true);
          expect(ids.has(node.id)).toBe(false);
          ids.add(node.id);
          for (const group of ["placement", "motion", "params"] as const) {
            for (const [key, value] of Object.entries(node[group])) {
              if (typeof value === "number") {
                expect(
                  Number.isFinite(value),
                  `${preset.id} ${node.id} ${group}.${key}`,
                ).toBe(true);
              } else {
                expect(
                  value.length,
                  `${preset.id} ${node.id} ${group}.${key}`,
                ).toBeGreaterThan(0);
              }
            }
          }
          const x = node.placement["x"] as number;
          const y = node.placement["y"] as number;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
          const decay = node.params["decay"] as number;
          expect(decay).toBeGreaterThanOrEqual(VIZ_ENVELOPE_DECAY_MIN_SECONDS);
          expect(decay).toBeLessThanOrEqual(VIZ_ENVELOPE_DECAY_MAX_SECONDS);
        }
      }
    }
  });

  it("deals at least one node per blueprint group of lanes (rigs are never empty)", () => {
    for (const preset of VIZ_PRESETS) {
      for (const seed of SWEEP) {
        const arr = generateArrangement(preset, seed);
        expect(arr.nodes.length).toBeGreaterThanOrEqual(
          preset.nodeBlueprints.length,
        );
      }
    }
  });

  it("presets and one arrangement per preset round-trip as plain JSON", () => {
    expect(JSON.parse(JSON.stringify(VIZ_PRESETS))).toEqual(VIZ_PRESETS);
    for (const preset of VIZ_PRESETS) {
      const arr = generateArrangement(preset, 42);
      expect(JSON.parse(JSON.stringify(arr))).toEqual(arr);
    }
  });
});

describe("golden-ish determinism pins (VZ-MF-2)", () => {
  it("identical (preset, seed) ⇒ deep-equal arrangement, every preset", () => {
    for (const preset of VIZ_PRESETS) {
      for (const seed of [0, 1, 42, CANONICAL_SEED, 4294967295]) {
        expect(generateArrangement(preset, seed)).toEqual(
          generateArrangement(preset, seed),
        );
      }
    }
  });

  it("matches the pinned canonical-seed digests (update deliberately: data changed ⇒ new pin)", () => {
    const PINNED: Record<string, string> = {
      // layout (2026-09-05): placement blueprints widened to full bleed —
      // pins updated deliberately ("data changed ⇒ new pin").
      "first-light": "cbf9cf7a710b47f6",
      "spark-fan": "a67676273bf5474b",
      orrery: "1f4dd81c3eb53797",
      "river-glass": "a8f7f4cc814dcc90",
      "halo-rings": "b62ec55352bc29de",
      "comet-run": "aa217c834309a690",
      "wash-field": "00ab75f94aed2c6d",
      lighthouse: "d01096267fa9b3df",
      "slow-tide": "c6968aba59cab6d6",
      "kit-fires": "59ee1a8666df726f",
    };
    for (const preset of VIZ_PRESETS) {
      expect(digestOf(preset, CANONICAL_SEED)).toBe(PINNED[preset.id]);
    }
  });

  it("matches the pinned canonical-seed node counts", () => {
    const PINNED: Record<string, number> = {
      "first-light": 8, // bolder: 2 blooms/lane
      "spark-fan": 4,
      orrery: 4,
      "river-glass": 4,
      "halo-rings": 8, // bolder: rings paired
      "comet-run": 4,
      "wash-field": 10,
      lighthouse: 5, // bolder: drums beacon paired
      "slow-tide": 5,
      "kit-fires": 7,
    };
    for (const preset of VIZ_PRESETS) {
      expect(generateArrangement(preset, CANONICAL_SEED).nodes.length).toBe(
        PINNED[preset.id],
      );
    }
  });

  it("different seeds ⇒ distinct arrangements (statistical spot check)", () => {
    for (const preset of VIZ_PRESETS) {
      const digests = new Set<string>();
      for (let i = 0; i < 20; i++) digests.add(digestOf(preset, i * 7919 + 1));
      // 20 draws over rigs with randomizable placement — collisions are
      // float-impossible; one tolerated is still a red flag, so pin ≥ 19.
      expect(digests.size).toBeGreaterThanOrEqual(19);
    }
  });

  it("the persistence envelope re-deals the exact rig for every preset", () => {
    for (const preset of VIZ_PRESETS) {
      const original = generateArrangement(preset, 777);
      const env = arrangementEnvelope(original);
      expect(generateArrangement(preset, env.seed)).toEqual(original);
    }
  });
});

describe("registry contract: default, canary, cycle order (VZ-MF-2)", () => {
  it("the default is the first cycle entry and exists in the library", () => {
    expect(VIZ_DEFAULT_PRESET_ID).toBe(VIZ_PRESETS[0]!.id);
    expect(VIZ_PRESETS.some((p) => p.id === VIZ_DEFAULT_PRESET_ID)).toBe(true);
  });

  it("the canary set is the first three cycle entries, in order", () => {
    expect(VIZ_CANARY_PRESET_IDS).toEqual(
      VIZ_PRESETS.slice(0, 3).map((p) => p.id),
    );
    expect(new Set(VIZ_CANARY_PRESET_IDS).size).toBe(3);
  });

  it("cycles forward and backward with wrap, from known and unknown ids", () => {
    const ids = VIZ_PRESETS.map((p) => p.id);
    const last = ids.length - 1;
    expect(cycleVizPreset(ids[last]!, 1).id).toBe(ids[0]);
    expect(cycleVizPreset(ids[0]!, -1).id).toBe(ids[last]);
    expect(cycleVizPreset(ids[0]!, 1).id).toBe(ids[1]);
    expect(cycleVizPreset(ids[2]!, -2).id).toBe(ids[0]);
    expect(cycleVizPreset(ids[0]!, ids.length).id).toBe(ids[0]); // full turn
    expect(cycleVizPreset(ids[1]!, 0).id).toBe(ids[1]);
    expect(cycleVizPreset("no-such-preset", 1).id).toBe(ids[1]); // from default
  });
});

describe("vocabulary table sanity (VZ-MF-2)", () => {
  it("the kind list is closed, unique and fully documented", () => {
    expect(new Set(VIZ_NODE_KINDS).size).toBe(VIZ_NODE_KINDS.length);
    expect(VIZ_NODE_KINDS.length).toBe(6); // small enough that VZ-IM-5 stays L
    for (const doc of VIZ_KIND_DOCS) {
      expect(doc.intent.length).toBeGreaterThan(0);
      expect(doc.restMark.length).toBeGreaterThan(0);
      expect(doc.pitchLaw.length).toBeGreaterThan(0);
      expect(doc.hitObjects.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const field of doc.fields) {
        expect(field.doc.length).toBeGreaterThan(0);
        expect(field.unit.length).toBeGreaterThan(0);
        expect(seen.has(`${field.group}.${field.key}`)).toBe(false);
        seen.add(`${field.group}.${field.key}`);
      }
      // The shared trio is present exactly once, in placement.
      for (const key of ["x", "y", "lane"]) {
        expect(
          doc.fields.filter((f) => f.group === "placement" && f.key === key)
            .length,
        ).toBe(1);
      }
    }
  });

  it("defaults are typed honestly: lane is a legal binding, the rest are numbers", () => {
    for (const doc of VIZ_KIND_DOCS) {
      const lane = doc.fields.find(
        (f) => f.group === "placement" && f.key === "lane",
      )!;
      expect(VIZ_LANE_BINDINGS).toContain(lane.default);
      for (const field of doc.fields) {
        if (field.key === "lane") continue;
        expect(typeof field.default, `${doc.kind}.${field.key}`).toBe("number");
        expect(Number.isFinite(field.default as number)).toBe(true);
      }
      // The envelope window default obeys the committed decay range.
      const decay = doc.fields.find(
        (f) => f.group === "params" && f.key === "decay",
      )!;
      expect(decay.default as number).toBeGreaterThanOrEqual(
        VIZ_ENVELOPE_DECAY_MIN_SECONDS,
      );
      expect(decay.default as number).toBeLessThanOrEqual(
        VIZ_ENVELOPE_DECAY_MAX_SECONDS,
      );
    }
  });
});

describe("data-module fence (VZ-MF-2 acceptance: grep-clean source)", () => {
  const SOURCES = ["src/viz/presets.ts", "src/viz/vocabulary.ts"].map(
    (path) => [path, readFileSync(path, "utf8")] as const,
  );

  it("imports no schema / valibot / document module", () => {
    for (const [path, source] of SOURCES) {
      expect(source, path).not.toMatch(
        /from\s+"[^"]*(document\/schema|valibot)/,
      );
      expect(source, path).not.toMatch(/from\s+"[^"]*document/);
    }
  });

  it("never calls Math.random — library data is static, arrangements are seeded", () => {
    for (const [path, source] of SOURCES) {
      expect(source, path).not.toMatch(/Math\.random\s*\(/);
    }
  });
});
