import { describe, expect, it } from "vitest";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  MigrationError,
  migrate,
  migrateWith,
  type MigrationRegistry,
} from "../src/document/migrate";
import {
  createDefaultProject,
  pitchedCellAt,
  resolveGateSteps,
} from "../src/document/schema";
import { laneCycleSteps } from "../src/audio/song";
import { createDemoProject } from "../src/document/demoSong";
import { decode, encode } from "../src/document/codec";
import { ProjectValidationError } from "../src/document/validate";
import { compileLaneEvents } from "../src/audio/compile";
import { secondsPerStep, timeAtStep } from "../src/audio/time";
import { getPreset } from "../src/audio/presets";
import { degreeToMidi, toEffectiveScale } from "../src/document/scales";
import {
  sustainHeavyV1ProjectText,
  v1DefaultProjectText,
  v1DemoProjectText,
} from "./v1Project";
import {
  boundaryV2ProjectText,
  v2DefaultProjectText,
  v2DemoProjectText,
} from "./v2Project";

describe("migration framework", () => {
  it("v3 (current) docs pass through untouched", () => {
    const doc = JSON.parse(JSON.stringify(createDefaultProject())) as Record<
      string,
      unknown
    >;
    expect(migrate(doc)).toEqual(doc);
  });

  it("production registry ships exactly the 1→2 note-model and 2→3 widening migrations", () => {
    expect(Object.keys(MIGRATIONS)).toEqual(["1", "2"]);
    expect(LATEST_SCHEMA_VERSION).toBe(3);
  });

  it("refuses docs with no integer version >= 1", () => {
    expect(() => migrate({})).toThrow(MigrationError);
    expect(() => migrate({ version: "1" })).toThrow(MigrationError);
    expect(() => migrate({ version: 0 })).toThrow(MigrationError);
    expect(() => migrate({ version: 1.5 })).toThrow(MigrationError);
  });

  it("refuses future versions", () => {
    expect(() => migrate({ version: 4, name: "x" })).toThrow(
      /newer than supported/,
    );
  });

  it("applies a synthetic v0 → v1 migration ascending (registry overrides compose)", () => {
    // Synthetic historical shape: a pre-release doc where lanes were called
    // "tracks" and there was no transport.metronome flag. NOTE: with the real
    // 1→2 step registered, a v0 doc now walks 0→1→2 (its v1-shaped pitched
    // rows migrate to v2 notes) — exactly the ascending-walk contract.
    const v0 = JSON.parse(v1DefaultProjectText()) as Record<string, unknown>;
    v0["version"] = 0;
    v0["tracks"] = v0["lanes"];
    delete v0["lanes"];
    delete (v0["transport"] as Record<string, unknown>)["metronome"];

    const registry: MigrationRegistry = {
      0: (doc) => {
        const { tracks: lanes, ...rest } = doc;
        return {
          ...rest,
          version: 1,
          lanes,
          transport: {
            ...(doc["transport"] as Record<string, unknown>),
            metronome: false,
          },
        };
      },
    };

    const migrated = migrateWith(registry, v0, 1);
    expect(migrated["version"]).toBe(1);
    expect(migrated["lanes"]).toBeDefined();
    expect(
      (migrated["transport"] as Record<string, unknown>)["metronome"],
    ).toBe(false);

    // And the migrated doc now validates through the full codec pipeline.
    const revived = decode(JSON.stringify(migrated));
    expect(revived.transport.metronome).toBe(false);
  });

  it("walks multiple steps in order and enforces version stamping", () => {
    const order: number[] = [];
    const registry: MigrationRegistry = {
      1: (doc) => {
        order.push(1);
        return { ...doc, version: 2 };
      },
      2: (doc) => {
        order.push(2);
        return { ...doc, version: 3 };
      },
    };
    const doc = { version: 1, name: "x" };
    const out = migrateWith(registry, doc, 3);
    expect(out["version"]).toBe(3);
    expect(order).toEqual([1, 2]);

    const badRegistry: MigrationRegistry = {
      1: (doc) => ({ ...doc }), // forgot to stamp version 2
    };
    expect(() => migrateWith(badRegistry, { version: 1 }, 2)).toThrow(
      /did not stamp/,
    );
  });

  it("errors when a migration step is missing", () => {
    expect(() => migrateWith({}, { version: 1 }, 2)).toThrow(
      /No migration registered/,
    );
  });

  it("decode still validates strictly after migration (migrations are not a bypass)", () => {
    const registry: MigrationRegistry = {
      0: (doc) => ({ ...doc, version: 1, evil: "payload" }),
    };
    const v0 = JSON.parse(v1DefaultProjectText()) as Record<string, unknown>;
    v0["version"] = 0;
    const migrated = migrateWith(registry, v0, 1);
    // The real 1→2 step runs next (fine — the doc carries v1 rows), and then
    // strict validation rejects the smuggled key.
    expect(() => decode(JSON.stringify(migrated))).toThrow(
      ProjectValidationError,
    );
  });
});

describe("v1 → v2 (SC-1): the note-model migration", () => {
  it("migrates a v1 default project to EXACTLY the shipped default (deep equal)", () => {
    const migrated = decode(v1DefaultProjectText());
    expect(migrated).toEqual(createDefaultProject());
  });

  it("migrates the v1 WELCOME SONG demo to EXACTLY the shipped demo (byte equal)", () => {
    const migrated = decode(v1DemoProjectText());
    expect(encode(migrated)).toBe(encode(createDemoProject()));
  });

  it("view ∘ migration = identity: the engine's v1 view of the migrated demo matches its v1 bytes", () => {
    const migrated = decode(v1DemoProjectText());
    // The demo's sustained notes re-project onto the authored v1 cells.
    const chords = migrated.patterns.chords[0];
    if (chords.kind !== "pitched") throw new Error("expected pitched");
    expect(chords.notes).toEqual([{ degree: 0, start: 0, length: 15 }]);
    const gateSteps = resolveGateSteps(
      { unit: "steps", value: 6 },
      migrated.transport.bpm,
    );
    expect(pitchedCellAt(chords, gateSteps, 0, 0)).toBe(1);
    for (let step = 1; step <= 9; step++)
      expect(pitchedCellAt(chords, gateSteps, 0, step)).toBe(2);
    expect(pitchedCellAt(chords, gateSteps, 0, 10)).toBe(0);
  });

  it("sustain-heavy neighbor: runs become one note of gate + sustains; lone hits take the gate length", () => {
    const doc = decode(sustainHeavyV1ProjectText());

    // bass gate = 3 steps: run [1,2,2] → length 5; lone hits → length 3.
    const bass = doc.patterns.bass[0];
    if (bass.kind !== "pitched") throw new Error("expected pitched");
    expect(bass.notes).toEqual([
      { degree: 0, start: 0, length: 5 },
      { degree: 0, start: 8, length: 3 },
      { degree: 0, start: 12, length: 3 },
    ]);

    // chords gate = 0.25 s at 112 BPM → 1.75 steps (quantization corner).
    const chords = doc.patterns.chords[0];
    if (chords.kind !== "pitched") throw new Error("expected pitched");
    expect(chords.notes).toEqual([
      { degree: 0, start: 0, length: 1.75 },
      { degree: 0, start: 2, length: 2.75 },
    ]);

    // lead gate = 2: run to the pattern end → 3; a head ON the last step
    // keeps its full length (plays past the loop, exactly as v1 gates did).
    const lead = doc.patterns.lead[0];
    if (lead.kind !== "pitched") throw new Error("expected pitched");
    expect(lead.notes).toEqual([
      { degree: 7, start: 14, length: 3 },
      { degree: 9, start: 15, length: 2 },
    ]);
  });

  it("drops orphan sustain markers (audio-dead v1 artifacts) — no phantom notes", () => {
    const doc = decode(sustainHeavyV1ProjectText());
    const bass = doc.patterns.bass[0];
    if (bass.kind !== "pitched") throw new Error("expected pitched");
    // Degree 4 carried only orphan 2s; degree 0's orphan at step 14 is gone.
    expect(bass.notes.filter((n) => n.degree === 4)).toEqual([]);
    expect(bass.notes.some((n) => n.degree === 0 && n.start === 14)).toBe(
      false,
    );
  });

  it("AUDIO-LOSSLESS: migrated documents compile to the exact {time, freq} and holds within the documented bound", () => {
    const texts = [
      v1DemoProjectText(),
      sustainHeavyV1ProjectText(),
      v1DefaultProjectText(),
    ];
    const preset = getPreset("preset-bass-1")!;
    const scale = toEffectiveScale({ root: 0, mode: "minor" });
    const octaveBase = preset.pitchRange?.octaveBase ?? 4;

    /** The v0 sustain-walk law, computed independently from the v1 cells. */
    const v0Law = (
      rows: readonly { degree: number; steps: number[] }[],
      gate: { unit: "seconds" | "steps"; value: number },
      groove: { bpm: number; swing: number },
      stack: boolean,
    ): { time: number; freq: number; hold: number }[] => {
      const stepSec = secondsPerStep(groove.bpm);
      const gateSec =
        gate.unit === "seconds" ? gate.value : gate.value * stepSec;
      const out: { time: number; freq: number; hold: number }[] = [];
      for (const row of rows) {
        for (let step = 0; step < row.steps.length; step++) {
          if (row.steps[step] !== 1) continue;
          let sustain = 0;
          while (
            step + 1 + sustain < row.steps.length &&
            row.steps[step + 1 + sustain] === 2
          )
            sustain++;
          for (const off of stack ? [0, 2, 4] : [0]) {
            const midi = degreeToMidi(scale, row.degree + off, octaveBase);
            out.push({
              time: timeAtStep(step, groove),
              freq: 440 * Math.pow(2, (midi - 69) / 12),
              hold: gateSec + sustain * stepSec,
            });
          }
        }
      }
      return out.sort((a, b) => a.time - b.time || a.freq - b.freq);
    };

    for (const text of texts) {
      const v2 = decode(text);
      const v1 = JSON.parse(text) as {
        patterns: Record<
          string,
          { rows?: { degree: number; steps: number[] }[] }[]
        >;
      };
      for (const lane of ["bass", "chords", "lead"] as const) {
        const conf = v2.lanes.find((l) => l.id === lane)!;
        if (conf.id === "drums") continue;
        const groove = {
          bpm: v2.transport.bpm,
          swing: v2.transport.swing,
        };
        const events = compileLaneEvents({
          pattern: v2.patterns[lane][0]!,
          preset,
          gate: conf.gate,
          groove,
          scale,
          stackChord: lane === "chords",
        });
        const actual = events
          .map((e) => ({ time: e.time, freq: e.freq, hold: e.holdSeconds }))
          .sort((a, b) => a.time - b.time || a.freq - b.freq);
        const expected = v0Law(
          v1.patterns[lane][0]!.rows ?? [],
          conf.gate,
          groove,
          lane === "chords",
        );
        // SC-2 law change: holds now come from note.length in ONE
        // multiplication (length × stepSec) where the v0 law summed
        // gateSec + k × stepSec. Steps-gate lanes agree to float
        // reassociation noise (1 ulp); seconds-gate lanes additionally carry
        // the documented SC-1 migration quantization (≤ half of the 0.25-step
        // grid). time/freq stay EXACTLY equal.
        expect(actual, `${text.slice(0, 40)} ${lane}`).toHaveLength(
          expected.length,
        );
        const holdTolerance =
          conf.gate.unit === "seconds"
            ? 0.125 * secondsPerStep(groove.bpm) + 1e-9
            : 1e-9;
        for (let i = 0; i < actual.length; i++) {
          expect(actual[i].time, `${lane}[${i}].time`).toBe(expected[i].time);
          expect(actual[i].freq, `${lane}[${i}].freq`).toBe(expected[i].freq);
          expect(
            Math.abs(actual[i].hold - expected[i].hold),
            `${lane}[${i}].hold ${actual[i].hold} vs ${expected[i].hold}`,
          ).toBeLessThanOrEqual(holdTolerance);
        }
      }
    }
  });

  it("is idempotent and stable: re-decoding migrated bytes changes nothing", () => {
    for (const text of [
      v1DefaultProjectText(),
      v1DemoProjectText(),
      sustainHeavyV1ProjectText(),
    ]) {
      const once = decode(text);
      const twice = decode(encode(once));
      expect(twice).toEqual(once);
    }
  });

  it("carries everything else verbatim (name, transport minus loopBars, FX, cues, chains, drums)", () => {
    const before = JSON.parse(v1DemoProjectText()) as Record<string, unknown>;
    const after = decode(v1DemoProjectText()) as unknown as Record<
      string,
      unknown
    >;
    expect(after["name"]).toBe(before["name"]);
    // v3 (SV-1): the retired field drops somewhere along the 1→2→3 walk;
    // every SURVIVING transport member is carried verbatim.
    const { loopBars: _drop, ...v1Transport } = before[
      "transport"
    ] as Record<string, unknown>;
    void _drop;
    expect(after["transport"]).toEqual(v1Transport);
    expect("loopBars" in (after["transport"] as object)).toBe(false);
    expect(after["chainCues"]).toEqual(before["chainCues"]);
    expect(after["songChain"]).toEqual(before["songChain"]);
    expect(after["lanes"]).toEqual(before["lanes"]);
    expect(after["patterns"]["drums"]).toEqual(before["patterns"]["drums"]);
  });

  it("unmigratable v1 input → typed MigrationError (never an untyped crash)", () => {
    const base = JSON.parse(v1DefaultProjectText()) as Record<string, unknown>;
    const clone = () =>
      JSON.parse(JSON.stringify(base)) as Record<string, unknown>;

    const badCell = clone();
    (
      (badCell["patterns"] as Record<string, unknown>)["bass"] as Record<
        string,
        unknown
      >[]
    )[0]!["rows"] = [{ degree: 0, steps: [3, ...Array(15).fill(0)] }];
    expect(() => migrate(badCell)).toThrow(MigrationError);
    expect(() => migrate(badCell)).toThrow(/invalid pitched cell 3/);

    const noRows = clone();
    (
      (noRows["patterns"] as Record<string, unknown>)["bass"] as Record<
        string,
        unknown
      >[]
    )[0]!["rows"] = "nope";
    expect(() => migrate(noRows)).toThrow(MigrationError);
    expect(() => migrate(noRows)).toThrow(/not a v1 pitched row array/);

    const noPatterns = clone();
    noPatterns["patterns"] = 7;
    expect(() => migrate(noPatterns)).toThrow(MigrationError);

    const noGate = clone();
    delete (
      (noGate["lanes"] as Record<string, unknown>[])[1] as Record<
        string,
        unknown
      >
    )["gate"];
    expect(() => migrate(noGate)).toThrow(MigrationError);
    expect(() => migrate(noGate)).toThrow(/bass.*no gate/);

    // And through the codec the same inputs throw typed (no laundering of
    // invalid v1 cells into valid v2 documents).
    expect(() => decode(JSON.stringify(badCell))).toThrow(MigrationError);
  });

  it("v1 row arrays of the wrong length behave exactly like v0 (truncate past the grid, keep in-range note-ons)", () => {
    const base = JSON.parse(v1DefaultProjectText()) as Record<string, unknown>;
    const bass = (base["patterns"] as Record<string, unknown>)[
      "bass"
    ] as Record<string, unknown>[];
    // 20-cell rows: note-ons at 0 (kept) and 19 (beyond the 16-step bar —
    // v0 normalize truncated it to silence; the migration drops it).
    bass[0]!["rows"] = [
      { degree: 0, steps: [1, ...Array(18).fill(0), 1] },
      ...Array.from({ length: 6 }, (_, d) => ({
        degree: d + 1,
        steps: Array(20).fill(0),
      })),
    ];
    const doc = decode(JSON.stringify(base));
    const migrated = doc.patterns.bass[0];
    if (migrated.kind !== "pitched") throw new Error("expected pitched");
    expect(migrated.notes).toEqual([{ degree: 0, start: 0, length: 2 }]);
  });
});

describe("v2 → v3 (SV-1): the long-loop widening migration", () => {
  it("migrates a v2 default project to EXACTLY the shipped v3 default (deep equal)", () => {
    const migrated = decode(v2DefaultProjectText());
    expect(migrated).toEqual(createDefaultProject());
    expect(migrated.version).toBe(3);
  });

  it("migrates the v2 WELCOME SONG demo to EXACTLY the shipped v3 demo (byte equal)", () => {
    const migrated = decode(v2DemoProjectText());
    expect(encode(migrated)).toBe(encode(createDemoProject()));
  });

  it("the v2 bytes themselves are the pre-SV-1 canonical form (loopBars re-added by the fixture, nothing else)", () => {
    // The fixture only re-stamps version + loopBars over the live v3 doc,
    // so this pins that the v2 SOURCE texts did not churn with v3: they are
    // exactly what a v2 app would have saved for the same content.
    const v2 = JSON.parse(v2DefaultProjectText()) as Record<string, unknown>;
    expect(v2["version"]).toBe(2);
    expect((v2["transport"] as Record<string, unknown>)["loopBars"]).toBe(1);
    const v3 = JSON.parse(JSON.stringify(createDefaultProject())) as Record<
      string,
      unknown
    >;
    const { loopBars: _drop, ...v2Transport } = v2[
      "transport"
    ] as Record<string, unknown>;
    void _drop;
    expect(v2Transport).toEqual(v3["transport"]);
  });

  it("LOSSLESS BY CONSTRUCTION: decode → encode round-trips every v2 fixture byte-stably", () => {
    for (const text of [
      v2DefaultProjectText(),
      v2DemoProjectText(),
      boundaryV2ProjectText(),
    ]) {
      const once = decode(text);
      expect(once.version).toBe(3);
      expect(decode(encode(once))).toEqual(once);
    }
  });

  it("drops transport.loopBars wherever it appears — including out-of-picklist values (permissive, no rejection class)", () => {
    // A v2 doc with loopBars 3 was invalid v2; v3 has no field to validate,
    // so the drop is total and strict v3 validation passes. There is
    // deliberately NO rejection class (v2's [1,2,4] ⊂ the v3 vocabulary).
    const base = JSON.parse(v2DefaultProjectText()) as Record<string, unknown>;
    (base["transport"] as Record<string, unknown>)["loopBars"] = 3;
    const migrated = decode(JSON.stringify(base));
    expect("loopBars" in migrated.transport).toBe(false);
    expect(migrated.transport).toEqual(createDefaultProject().transport);
  });

  it("v2 docs with loopBars 2/4 migrate with the paired pattern bars intact (LL-2 engine basis re-derives the same value)", () => {
    const doc = decode(boundaryV2ProjectText()); // 4-bar patterns + loopBars 4
    for (const lane of ["drums", "bass", "lead"] as const) {
      expect(doc.patterns[lane][0]!.bars).toBe(4);
    }
    // LL-2 (the derivation retired): the LCM-of-chain-totals basis
    // reproduces the retired field's value engine-side — 4-bar chains →
    // 64 steps per lane → LCM 64 = loopBars 4's 64 steps exactly.
    for (const lane of ["drums", "bass", "lead"] as const) {
      expect(laneCycleSteps(doc, lane)).toBe(64);
    }
  });

  it("v2 boundary-note values survive unchanged (widening is a no-op on v2-legal values)", () => {
    const doc = decode(boundaryV2ProjectText());
    const bass = doc.patterns.bass[0];
    if (bass.kind !== "pitched") throw new Error("expected pitched");
    expect(bass.notes).toEqual([
      { degree: 0, start: 0, length: 128 },
      { degree: 6, start: 63, length: 0.25 },
    ]);
    const drums = doc.patterns.drums[0];
    if (drums.kind !== "drums") throw new Error("expected drums");
    expect(drums.steps.kick).toHaveLength(64);
    expect(drums.steps.kick[63]).toBe(true);
  });

  it("PERMISSIVE-WIDEN: a v2 doc with out-of-v2-vocab bars (invalid in v2) migrates and validates as v3", () => {
    const base = JSON.parse(boundaryV2ProjectText()) as Record<string, unknown>;
    const patterns = base["patterns"] as Record<string, unknown>;
    (patterns["bass"] as Record<string, unknown>[])[0]!["bars"] = 8;
    // v2's picklist would have rejected 8; the migration carries it verbatim
    // and the widened v3 vocabulary accepts it (no laundering guard needed —
    // the value was only ever invalid because the vocabulary was smaller).
    const migrated = decode(JSON.stringify(base));
    expect(migrated.patterns.bass[0]!.bars).toBe(8);
  });

  it("does not inject the octave field (canonical-empty law for pre-v3 docs)", () => {
    const migrated = decode(v2DefaultProjectText());
    for (const lane of migrated.lanes) {
      expect("octave" in lane).toBe(false);
    }
    expect(encode(migrated)).not.toContain("octave");
  });

  it("a v2 doc whose transport is malformed reaches typed validation rejection (no untyped crash)", () => {
    const base = JSON.parse(v2DefaultProjectText()) as Record<string, unknown>;
    base["transport"] = null;
    expect(() => decode(JSON.stringify(base))).toThrow(
      ProjectValidationError,
    );
    const noTransport = JSON.parse(
      v2DefaultProjectText(),
    ) as Record<string, unknown>;
    delete noTransport["transport"];
    expect(() => decode(JSON.stringify(noTransport))).toThrow(
      ProjectValidationError,
    );
  });

  it("v1 sources walk the full ladder 1→2→3 (one parse path, LATEST stamp)", () => {
    const migrated = decode(v1DefaultProjectText());
    expect(migrated.version).toBe(3);
    expect(migrated).toEqual(createDefaultProject());
  });
});
