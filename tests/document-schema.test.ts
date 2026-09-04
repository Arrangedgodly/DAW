import { describe, expect, it } from "vitest";
import {
  DRUM_PIECES,
  LANE_IDS,
  PATTERN_BAR_VOCABULARY,
  createDefaultProject,
  type ProjectDocument,
} from "../src/document/schema";
import { encode, decode } from "../src/document/codec";
import { v1DefaultProjectText } from "./v1Project";
import {
  ProjectValidationError,
  normalizeProject,
  validateProject,
} from "../src/document/validate";
import {
  isModeName,
  MODE_NAMES,
  toEffectiveScale,
} from "../src/document/scales";

const TRANSFORMS: ReadonlyArray<
  [label: string, mutate: (d: Record<string, unknown>) => void]
> = [
  ["wrong type: name as number", (d) => (d["name"] = 7)],
  [
    "wrong type: bpm as string",
    (d) => ((d["transport"] as Record<string, unknown>)["bpm"] = "120"),
  ],
  [
    "out of range: bpm 300",
    (d) => ((d["transport"] as Record<string, unknown>)["bpm"] = 300),
  ],
  [
    "out of range: bpm 40",
    (d) => ((d["transport"] as Record<string, unknown>)["bpm"] = 40),
  ],
  [
    "out of range: swing 1.5",
    (d) => ((d["transport"] as Record<string, unknown>)["swing"] = 1.5),
  ],
  [
    "out of range: negative swing",
    (d) => ((d["transport"] as Record<string, unknown>)["swing"] = -0.1),
  ],
  [
    "v3: retired transport key loopBars (strict reject)",
    (d) => ((d["transport"] as Record<string, unknown>)["loopBars"] = 1),
  ],
  [
    "metronome not boolean",
    (d) => ((d["transport"] as Record<string, unknown>)["metronome"] = "on"),
  ],
  ["extra root key", (d) => (d["surprise"] = true)],
  [
    "extra transport key",
    (d) => ((d["transport"] as Record<string, unknown>)["extra"] = 1),
  ],
  [
    "extra fx param key",
    (d) => {
      const lane = (d["lanes"] as Record<string, unknown>[])[1];
      (lane["fxChain"] as unknown[]).push({
        type: "drive",
        bypassed: false,
        params: { amount: 0.5, extra: 1 },
      });
    },
  ],
  ["wrong schema version literal", (d) => (d["version"] = 99)],
  [
    "unknown mode name",
    (d) => ((d["scale"] as Record<string, unknown>)["mode"] = "aeolian-exotic"),
  ],
  [
    "unknown root pitch class 12",
    (d) => ((d["scale"] as Record<string, unknown>)["root"] = 12),
  ],
  ["lane count 3", (d) => (d["lanes"] = (d["lanes"] as unknown[]).slice(0, 3))],
  [
    "lane order swapped",
    (d) => {
      const lanes = d["lanes"] as unknown[];
      const tmp = lanes[0];
      lanes[0] = lanes[1];
      lanes[1] = tmp;
    },
  ],
  [
    "drums pattern kind pitched",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      patterns["drums"] = [
        {
          kind: "pitched",
          id: "x",
          name: "x",
          bars: 1,
          rowDegrees: [],
          notes: [],
        },
      ];
    },
  ],
  [
    "v2 note: start outside the pattern (16 steps)",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({ degree: 0, start: 16, length: 1 });
    },
  ],
  [
    "v2 note: length off the quarter-step grid",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({ degree: 0, start: 3, length: 1.3 });
    },
  ],
  [
    "v2 note: length above the cap",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({ degree: 0, start: 0, length: 2100 });
    },
  ],
  [
    "v3 note: start above the 2047 space bound",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({ degree: 0, start: 2048, length: 1 });
    },
  ],
  [
    "v3 bars: 3 is not in the powers-of-two vocabulary",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      (patterns["bass"] as Record<string, unknown>[])[0]!["bars"] = 3;
    },
  ],
  [
    "v3 bars: 5 is not in the powers-of-two vocabulary",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      (patterns["bass"] as Record<string, unknown>[])[0]!["bars"] = 5;
    },
  ],
  [
    "v3 bars: 96 is not in the powers-of-two vocabulary",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      (patterns["drums"] as Record<string, unknown>[])[0]!["bars"] = 96;
    },
  ],
  [
    "v3 octave: +4 above the register domain",
    (d) => {
      const lanes = d["lanes"] as Record<string, unknown>[];
      lanes[1]!["octave"] = 4;
    },
  ],
  [
    "v3 octave: non-integer",
    (d) => {
      const lanes = d["lanes"] as Record<string, unknown>[];
      lanes[2]!["octave"] = 1.5;
    },
  ],
  [
    "v3 octave: drums lane carries the pitched-only field",
    (d) => {
      const lanes = d["lanes"] as Record<string, unknown>[];
      lanes[0]!["octave"] = 1;
    },
  ],
  [
    "v2 note: degree out of range",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({ degree: 24, start: 0, length: 1 });
    },
  ],
  [
    "v2 note: extra key",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({
        degree: 0,
        start: 0,
        length: 1,
        velocity: 127,
      });
    },
  ],
  [
    "v2 pattern: legacy v1 rows key",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      bass["rows"] = [];
    },
  ],
  [
    "v2 pattern: rowDegrees out of range",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      bass["rowDegrees"] = [0, 99];
    },
  ],
  [
    "pitched pattern kind drums",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      patterns["bass"] = [
        { kind: "drums", id: "x", name: "x", bars: 1, steps: {} },
      ];
    },
  ],
  [
    "duplicate pattern id in lane",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      patterns["bass"] = [
        ...(patterns["bass"] as unknown[]),
        (patterns["bass"] as unknown[])[0],
      ];
    },
  ],
  [
    "song chain references unknown pattern",
    (d) => {
      const chain = d["songChain"] as Record<string, unknown>;
      chain["lead"] = ["nope"];
    },
  ],
  [
    "drum piece steps not booleans",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const drums = (patterns["drums"] as Record<string, unknown>[])[0];
      ((drums["steps"] as Record<string, unknown>)["kick"] as unknown[])[0] =
        "yes";
    },
  ],
  [
    "v2 note: start negative",
    (d) => {
      const patterns = d["patterns"] as Record<string, unknown>;
      const bass = (patterns["bass"] as Record<string, unknown>[])[0];
      (bass["notes"] as unknown[]).push({ degree: 0, start: -1, length: 1 });
    },
  ],
  [
    "4 fx devices exceeds max",
    (d) => {
      const lane = (d["lanes"] as Record<string, unknown>[])[1];
      lane["fxChain"] = [1, 2, 3, 4].map(() => ({
        type: "drive",
        bypassed: false,
        params: { amount: 0.1 },
      }));
    },
  ],
  [
    "fx variant type misspelled",
    (d) => {
      const lane = (d["lanes"] as Record<string, unknown>[])[1];
      lane["fxChain"] = [{ type: "distortion", bypassed: false, params: {} }];
    },
  ],
  [
    "delay feedback > 0.95",
    (d) => {
      const lane = (d["lanes"] as Record<string, unknown>[])[1];
      lane["fxChain"] = [
        {
          type: "delay",
          bypassed: false,
          params: { timeSteps: 3, feedback: 0.99, mix: 0.3 },
        },
      ];
    },
  ],
  [
    "laneOverrides with unknown mode",
    (d) => {
      d["laneOverrides"] = { bass: { root: 2, mode: "ionian-but-wrong" } };
    },
  ],
  // PS-3 sample provenance: rejection rows (strict shape, id grammar, caps).
  [
    "sampleProvenance not an object",
    (d) => (d["sampleProvenance"] = ["nope"]),
  ],
  [
    "sampleProvenance entry as array",
    (d) => (d["sampleProvenance"] = { "voice.bass.lowtone": [] }),
  ],
  [
    "sampleProvenance entry with an extra key",
    (d) =>
      (d["sampleProvenance"] = {
        "voice.bass.lowtone": {
          license: "CC0",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
          file: "voice-bass-lowtone.ogg",
        },
      }),
  ],
  [
    "sampleProvenance key not an asset id (URL)",
    (d) =>
      (d["sampleProvenance"] = {
        "https://bitbounce.test/asset.ogg": {
          license: "CC0",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance key without a dot separator",
    (d) =>
      (d["sampleProvenance"] = {
        voicebass: {
          license: "CC0",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance key uppercase",
    (d) =>
      (d["sampleProvenance"] = {
        "Voice.Bass.Tone": {
          license: "CC0",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance empty license",
    (d) =>
      (d["sampleProvenance"] = {
        "voice.bass.lowtone": {
          license: "",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance license over the cap",
    (d) =>
      (d["sampleProvenance"] = {
        "voice.bass.lowtone": {
          license: "CC0 " + "x".repeat(40),
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance sourceUrl not https",
    (d) =>
      (d["sampleProvenance"] = {
        "voice.bass.lowtone": {
          license: "CC0",
          sourceUrl: "http://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance sourceUrl over the cap",
    (d) =>
      (d["sampleProvenance"] = {
        "voice.bass.lowtone": {
          license: "CC0",
          sourceUrl: "https://" + "x".repeat(300) + ".test/a",
          author: "Kenney Vleugels (Kenney.nl)",
        },
      }),
  ],
  [
    "sampleProvenance author not a string",
    (d) =>
      (d["sampleProvenance"] = {
        "voice.bass.lowtone": {
          license: "CC0",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: 7,
        },
      }),
  ],
  [
    "sampleProvenance over the entry cap (65 > 64)",
    (d) => {
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < 65; i++)
        entries[`voice.bass.tone${i}`] = {
          license: "CC0",
          sourceUrl: "https://kenney.nl/assets/digital-audio",
          author: "Kenney Vleugels (Kenney.nl)",
        };
      d["sampleProvenance"] = entries;
    },
  ],
];

function clone(doc: ProjectDocument): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

describe("validateProject (strict)", () => {
  it("accepts the default project", () => {
    expect(() => validateProject(createDefaultProject())).not.toThrow();
  });

  it("accepts a project with lane overrides and fx chains", () => {
    const doc = clone(createDefaultProject());
    doc["laneOverrides"] = { bass: { root: 2, mode: "dorian" }, lead: null };
    const lanes = doc["lanes"] as Record<string, unknown>[];
    lanes[3]["fxChain"] = [
      { type: "filter", bypassed: false, params: { cutoffHz: 2000, q: 1 } },
      {
        type: "bitcrusher",
        bypassed: true,
        params: { bits: 6, downsample: 2 },
      },
      { type: "reverb", bypassed: false, params: { size: 0.4, mix: 0.25 } },
    ];
    const out = validateProject(doc);
    expect(out.laneOverrides?.bass?.mode).toBe("dorian");
    expect(out.lanes[3].fxChain).toHaveLength(3);
  });

  for (const [label, mutate] of TRANSFORMS) {
    it(`rejects malformed doc: ${label}`, () => {
      const doc = clone(createDefaultProject());
      mutate(doc);
      let error: unknown;
      try {
        validateProject(doc);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ProjectValidationError);
      const issues = (error as ProjectValidationError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => typeof i === "string" && i.length > 0)).toBe(
        true,
      );
    });
  }

  it("rejects non-object input outright", () => {
    for (const bad of [null, 42, "nope", [], true]) {
      expect(() => validateProject(bad)).toThrow(ProjectValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// SV-1: schema v3 — vocabulary widening, note-bound law, octave field, and
// the loopBars retirement's zero-churn proof.
// ---------------------------------------------------------------------------

describe("validateProject schema v3 (SV-1)", () => {
  it("accepts every pattern-bars vocabulary member (powers of two to 128)", () => {
    for (const bars of [1, 2, 4, 8, 16, 32, 64, 128]) {
      const doc = clone(createDefaultProject());
      (doc["patterns"] as Record<string, unknown>)["bass"] = [
        {
          kind: "pitched",
          id: "bass-1",
          name: "A",
          bars,
          rowDegrees: [0, 1, 2, 3, 4, 5, 6],
          notes: [{ degree: 0, start: 0, length: 1 }],
        },
      ];
      const out = validateProject(doc);
      expect(out.patterns.bass[0]!.bars, `bars ${bars}`).toBe(bars);
    }
  });

  it("the picklist IS the exported vocabulary constant", () => {
    expect([1, 2, 4, 8, 16, 32, 64, 128]).toEqual([
      ...PATTERN_BAR_VOCABULARY,
    ]);
  });

  it("note bounds: start 2047 + length 2048 valid on a 128-bar pattern; 2048 start rejected", () => {
    const wide = clone(createDefaultProject());
    (wide["patterns"] as Record<string, unknown>)["bass"] = [
      {
        kind: "pitched",
        id: "bass-1",
        name: "A",
        bars: 128,
        rowDegrees: [0, 1, 2, 3, 4, 5, 6],
        notes: [
          { degree: 0, start: 2047, length: 2048 }, // both ceilings at once
          { degree: 1, start: 64, length: 0.25 }, // > v2's 63 bound, legal in v3
        ],
      },
    ];
    expect(() => validateProject(wide)).not.toThrow();

    const over = clone(wide);
    (
      ((over["patterns"] as Record<string, unknown>)["bass"] as Record<
        string,
        unknown
      >[])[0]!["notes"] as unknown[]
    ).push({ degree: 2, start: 2048, length: 1 });
    expect(() => validateProject(over)).toThrow(ProjectValidationError);
  });

  it("per-pattern width still binds placement: start 16 on a 1-bar pattern rejected (two-layer law)", () => {
    const doc = clone(createDefaultProject());
    const patterns = doc["patterns"] as Record<string, unknown>;
    const bass = (patterns["bass"] as Record<string, unknown>[])[0];
    (bass["notes"] as unknown[]).push({ degree: 0, start: 16, length: 1 });
    expect(() => validateProject(doc)).toThrow(ProjectValidationError);
  });

  it("octave: −3 and +3 accepted on pitched lanes; 0 canonicalizes to the omitted key", () => {
    const doc = clone(createDefaultProject());
    const lanes = doc["lanes"] as Record<string, unknown>[];
    lanes[1]!["octave"] = -3;
    lanes[3]!["octave"] = 3;
    lanes[2]!["octave"] = 0; // canonical-empty form
    const out = validateProject(doc);
    const bassOut = out.lanes.find((l) => l.id === "bass")!;
    const chordsOut = out.lanes.find((l) => l.id === "chords")!;
    const leadOut = out.lanes.find((l) => l.id === "lead")!;
    expect(bassOut.octave).toBe(-3);
    expect(leadOut.octave).toBe(3);
    expect("octave" in chordsOut).toBe(false); // stripped: byte-stable law
  });

  it("v3 default carries no loopBars and no octave (byte-stable canonical empty)", () => {
    const doc = createDefaultProject();
    expect("loopBars" in doc.transport).toBe(false);
    expect(encode(doc)).not.toContain("loopBars");
    expect(encode(doc)).not.toContain("octave");
    expect(doc.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PS-3: in-project sample provenance — acceptance, canonical-empty, and the
// no-migration proof for pre-PS-3 v2 documents.
// ---------------------------------------------------------------------------

describe("validateProject sampleProvenance (PS-3)", () => {
  const kenneyEcho = {
    license: "CC0",
    sourceUrl: "https://kenney.nl/assets/digital-audio",
    author: "Kenney Vleugels (Kenney.nl)",
  };

  it("accepts a project recording the assets its sample voices use (self-describing export)", () => {
    const doc = clone(createDefaultProject());
    doc["sampleProvenance"] = {
      "voice.bass.lowtone": kenneyEcho,
      "drums.808.kick": {
        license: "CC0",
        sourceUrl: "https://github.com/sgossner/VCSL",
        author: "Sam Gossner (VCSL)",
      },
    };
    const out = validateProject(doc);
    expect(out.sampleProvenance).toEqual({
      "voice.bass.lowtone": kenneyEcho,
      "drums.808.kick": {
        license: "CC0",
        sourceUrl: "https://github.com/sgossner/VCSL",
        author: "Sam Gossner (VCSL)",
      },
    });
  });

  it("canonicalizes an entry-less map to the omitted field (byte-stable default law)", () => {
    const doc = clone(createDefaultProject());
    doc["sampleProvenance"] = {};
    const out = validateProject(doc);
    expect("sampleProvenance" in out).toBe(false);
  });

  it("trims padded echo strings through the parse (cue-label precedent), then round-trips stably", () => {
    const doc = clone(createDefaultProject());
    doc["sampleProvenance"] = {
      "voice.bass.lowtone": { ...kenneyEcho, license: " CC0 " },
    };
    const once = validateProject(doc);
    expect(once.sampleProvenance?.["voice.bass.lowtone"]?.license).toBe("CC0");
    // Canonical stability holds from the first canonical form onward.
    expect(validateProject(once)).toEqual(once);
  });

  it("pre-PS-3 v2 documents decode with no migration: the field is purely additive (AC)", () => {
    // A v2 synth-only project exactly as written before PS-3 — no
    // sampleProvenance key anywhere. Validation must accept it unchanged and
    // NOT inject the field (byte-identical canonical output).
    const pre = encode(createDefaultProject());
    expect(pre).not.toContain("sampleProvenance");
    const out = decode(pre);
    expect("sampleProvenance" in out).toBe(false);
    expect(encode(out)).toBe(pre);
    // Same law for the v1→v2 migration path: migrated docs gain no field.
    const migrated = decode(v1DefaultProjectText());
    expect("sampleProvenance" in migrated).toBe(false);
    expect(encode(migrated)).toBe(encode(createDefaultProject()));
  });

  it("a provenance-carrying document exports self-describing bytes (license visible in the file)", () => {
    const doc = clone(createDefaultProject()) as unknown as ProjectDocument;
    doc.sampleProvenance = { "voice.bass.lowtone": kenneyEcho };
    const bytes = encode(doc);
    expect(bytes).toContain('"sampleProvenance"');
    expect(bytes).toContain('"license":"CC0"');
    expect(decode(bytes).sampleProvenance).toEqual(doc.sampleProvenance);
  });
});

describe("normalizeProject", () => {
  it("pads short drum step arrays and truncates long ones (v2 pitched has no arrays to repair)", () => {
    const doc = clone(createDefaultProject()) as unknown as ProjectDocument;
    const drums = doc.patterns.drums[0] as { steps: Record<string, boolean[]> };
    drums.steps.kick = [true]; // 1 step instead of 16
    drums.steps.snare = new Array(20).fill(true); // 20 instead of 16
    const bass = doc.patterns.bass[0];
    if (bass.kind !== "pitched") throw new Error("expected pitched");
    bass.notes = [{ degree: 0, start: 2, length: 4.5 }];
    const out = normalizeProject(doc);
    const drumsOut = out.patterns.drums[0];
    expect(drumsOut.kind === "drums" && drumsOut.steps.kick).toHaveLength(16);
    expect(drumsOut.kind === "drums" && drumsOut.steps.kick[0]).toBe(true);
    expect(drumsOut.kind === "drums" && drumsOut.steps.kick[15]).toBe(false);
    expect(drumsOut.kind === "drums" && drumsOut.steps.snare).toHaveLength(16);
    const bassOut = out.patterns.bass[0];
    if (bassOut.kind !== "pitched") throw new Error("expected pitched");
    expect(bassOut.notes).toEqual([{ degree: 0, start: 2, length: 4.5 }]);
    expect(bassOut).toBe(bass); // pitched normalize is identity-preserving
  });

  it("adds missing drum pieces as silent rows", () => {
    const doc = clone(createDefaultProject()) as unknown as ProjectDocument;
    const drums = doc.patterns.drums[0] as { steps: Record<string, boolean[]> };
    delete drums.steps.tom;
    const out = normalizeProject(doc);
    const drumsOut = out.patterns.drums[0];
    expect(drumsOut.kind === "drums" && drumsOut.steps.tom).toEqual(
      new Array(16).fill(false),
    );
  });
});

describe("default factory", () => {
  it("builds one 1-bar pattern per lane, chained once", () => {
    const doc = createDefaultProject();
    expect(doc.lanes.map((l) => l.id)).toEqual([...LANE_IDS]);
    for (const laneId of LANE_IDS) {
      expect(doc.patterns[laneId]).toHaveLength(1);
      expect(doc.patterns[laneId][0].bars).toBe(1);
      expect(doc.songChain[laneId]).toHaveLength(1);
      expect(doc.songChain[laneId][0]).toBe(doc.patterns[laneId][0].id);
    }
    const drums = doc.patterns.drums[0];
    if (drums.kind !== "drums") throw new Error("expected drums pattern");
    expect(Object.keys(drums.steps).sort()).toEqual([...DRUM_PIECES].sort());
  });

  it("uses a real mode as the default scale", () => {
    const doc = createDefaultProject();
    expect(isModeName(doc.scale.mode)).toBe(true);
    expect(toEffectiveScale(doc.scale).intervals.length).toBe(7);
  });

  it("declares every mode the schema promises", () => {
    expect(MODE_NAMES).toEqual(
      expect.arrayContaining([
        "major",
        "minor",
        "dorian",
        "pentatonicMinor",
        "pentatonicMajor",
        "phrygian",
        "lydian",
        "mixolydian",
        "harmonicMinor",
      ]),
    );
  });
});
