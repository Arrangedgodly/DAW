import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  DRUM_KITS,
  PRESET_LIBRARY,
  VoicePresetSchema,
  WAVE_CODE,
  getDrumKit,
  getPreset,
  noteParamsFor,
  type VoicePreset,
} from "../src/audio/presets";
import { DRUM_PIECES, createDefaultProject } from "../src/document/schema";

function validatePreset(p: VoicePreset): void {
  expect(typeof p.id).toBe("string");
  expect(
    p.wave === "pulse" ||
      p.wave === "triangle" ||
      p.wave === "noise" ||
      p.wave === "pluck",
  ).toBe(true);
  expect(p.duty).toBeGreaterThan(0);
  expect(p.duty).toBeLessThanOrEqual(1);
  expect(p.noiseMix).toBeGreaterThanOrEqual(0);
  expect(p.noiseMix).toBeLessThanOrEqual(1);
  expect(p.level).toBeGreaterThan(0);
  expect(p.level).toBeLessThanOrEqual(1);
  expect(p.seed).toBeGreaterThanOrEqual(1);
  expect(p.seed).toBeLessThanOrEqual(32767);
  expect(p.noiseRate).toBeGreaterThan(0);
  const { attack, decay, sustain, release } = p.envelope;
  for (const seg of [attack, decay, release])
    expect(seg).toBeGreaterThanOrEqual(0);
  expect(sustain).toBeGreaterThanOrEqual(0);
  expect(sustain).toBeLessThanOrEqual(1);
}

/**
 * PS-1 distinctness law (Professor X lens): within a lane, no two presets
 * may share the same audible archetype. The signature spans every axis an
 * owner can hear — wave family (pulse duty kept, since 12.5/25/50 duty ARE
 * different instruments), octave placement, pitch-sweep direction, audible
 * noise texture, envelope attack class, and release class. Two presets with
 * one signature would be "parameter nudges of one voice", which the plan
 * forbids; this makes the rule executable.
 */
function presetSignature(p: VoicePreset): string {
  const attackClass =
    p.envelope.attack <= 0.002
      ? "perc"
      : p.envelope.attack < 0.02
        ? "mid"
        : p.envelope.attack < 0.1
          ? "slow"
          : "swell";
  const releaseClass = p.envelope.release <= 0.1 ? "rel-short" : "rel-long";
  const sweep = p.pitchSweep
    ? p.pitchSweep.endRatio < 1
      ? "down"
      : "up"
    : "flat";
  const noise = p.noiseMix > 0.05 ? "airy" : "clean";
  const dutyAxis = p.wave === "pulse" || p.wave === "pluck" ? p.duty : "";
  return [
    p.wave,
    dutyAxis,
    p.pitchRange?.octaveBase ?? "-",
    sweep,
    noise,
    attackClass,
    releaseClass,
  ].join("|");
}

describe("preset library", () => {
  it("has at least 12 presets per pitched lane type (bass/chords/lead) — PS-1 target", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const ids = Object.keys(PRESET_LIBRARY).filter((id) => id.includes(lane));
      expect(ids.length).toBeGreaterThanOrEqual(12);
      for (const id of ids) validatePreset(getPreset(id)!);
    }
  });

  it("presets within a lane are musically distinct (unique audible signatures)", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const presets = Object.values(PRESET_LIBRARY).filter((p) =>
        p.id.includes(lane),
      );
      const seen = new Map<string, string>();
      for (const p of presets) {
        const sig = presetSignature(p);
        expect(
          seen.has(sig),
          `${p.id} sounds like ${seen.get(sig)} (signature ${sig}) — parameter nudge, not a new voice`,
        ).toBe(false);
        seen.set(sig, p.id);
      }
      // Palette breadth: every lane spans ≥3 wave families (pulse/triangle +
      // at least one of noise-texture or Karplus–Strong pluck).
      const waves = new Set(presets.map((p) => p.wave));
      expect(waves.size, `${lane} palette too narrow`).toBeGreaterThanOrEqual(3);
    }
  });

  it("names are unique and ≤14 chars within a lane (stepper reads one clear label)", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const names = new Set<string>();
      for (const p of Object.values(PRESET_LIBRARY)) {
        if (!p.id.includes(lane)) continue;
        expect(p.name.length).toBeLessThanOrEqual(14);
        expect(names.has(p.name), `${lane} duplicate name ${p.name}`).toBe(
          false,
        );
        names.add(p.name);
      }
    }
    const kitNames = new Set<string>();
    for (const kit of Object.values(DRUM_KITS)) {
      expect(kitNames.has(kit.name), `duplicate kit name ${kit.name}`).toBe(
        false,
      );
      kitNames.add(kit.name);
    }
  });

  it("every preset record is VoicePresetSchema-valid (PX-2 data validity)", () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      expect(() => v.parse(VoicePresetSchema, p), p.id).not.toThrow();
    }
    for (const kit of Object.values(DRUM_KITS)) {
      for (const piece of DRUM_PIECES) {
        expect(
          () => v.parse(VoicePresetSchema, kit.pieces[piece]),
          `${kit.id}.${piece}`,
        ).not.toThrow();
      }
    }
  });

  it("ids are unique and library keys match record ids", () => {
    const seen = new Set<string>();
    for (const [key, p] of Object.entries(PRESET_LIBRARY)) {
      expect(seen.has(p.id), p.id).toBe(false);
      seen.add(p.id);
      expect(key).toBe(p.id);
    }
    for (const kit of Object.values(DRUM_KITS)) {
      for (const piece of DRUM_PIECES) {
        const p = kit.pieces[piece];
        expect(seen.has(p.id), p.id).toBe(false);
        seen.add(p.id);
        expect(p.id.startsWith(`${kit.id}-`)).toBe(true);
      }
    }
  });

  it("all ids referenced by the default project exist in the libraries", () => {
    for (const lane of createDefaultProject().lanes) {
      if (lane.id === "drums") {
        expect(getDrumKit(lane.kitId), lane.kitId).toBeDefined();
      } else {
        expect(getPreset(lane.presetId), lane.presetId).toBeDefined();
      }
    }
  });

  it("pitched presets carry a pitch range with a sane octave", () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      expect(p.pitchRange?.octaveBase).toBeDefined();
      expect(p.pitchRange!.octaveBase).toBeGreaterThanOrEqual(1);
      expect(p.pitchRange!.octaveBase).toBeLessThanOrEqual(6);
    }
  });

  it("has ≥10 drum kits (PS-1 target), each mapping every drum piece to a preset", () => {
    const kits = Object.values(DRUM_KITS);
    expect(kits.length).toBeGreaterThanOrEqual(10);
    for (const kit of kits) {
      for (const piece of DRUM_PIECES) {
        const p = kit.pieces[piece];
        expect(p, `${kit.id}.${piece}`).toBeDefined();
        validatePreset(p);
      }
    }
  });

  it("kits vary the committed character axes (kick sweep, snare mix, hat decay)", () => {
    const kits = Object.values(DRUM_KITS);
    const kickRatios = new Set(
      kits.map((k) => k.pieces.kick.pitchSweep!.endRatio),
    );
    const snareMixes = new Set(kits.map((k) => k.pieces.snare.noiseMix));
    const hatDecays = new Set(kits.map((k) => k.pieces.hat.envelope.decay));
    const kickDecays = new Set(
      kits.map((k) => k.pieces.kick.envelope.decay),
    );
    // 10 kits, each claiming a distinct groove — the axes must actually
    // separate them (≥8 distinct values per axis leaves honest headroom).
    expect(kickRatios.size).toBeGreaterThanOrEqual(8);
    expect(snareMixes.size).toBeGreaterThanOrEqual(8);
    expect(hatDecays.size).toBeGreaterThanOrEqual(8);
    expect(kickDecays.size).toBeGreaterThanOrEqual(8);
  });

  it("drum kit characters follow the D2/D3 recipes", () => {
    const kit = getDrumKit("kit-default")!;
    expect(kit.pieces.kick.wave).toBe("pulse");
    expect(kit.pieces.kick.pitchSweep?.endRatio).toBeLessThan(1); // pitch-swept
    expect(kit.pieces.snare.noiseMix).toBeGreaterThan(0.5); // noise + tone
    expect(kit.pieces.snare.wave).not.toBe("noise"); // keeps a tone component
    expect(kit.pieces.hat.wave).toBe("noise");
    expect(kit.pieces.hat.noiseMode).toBe("short"); // LFSR short
    expect(kit.pieces.clap.wave).toBe("noise");
    expect(kit.pieces.tom.pitchSweep?.endRatio).toBeLessThan(1);
  });

  it("lookup miss returns undefined; hits return the record", () => {
    expect(getPreset("nope")).toBeUndefined();
    expect(getDrumKit("nope")).toBeUndefined();
    expect(getPreset("preset-bass-1")!.id).toBe("preset-bass-1");
    expect(getDrumKit("kit-default")!.id).toBe("kit-default");
  });
});

describe("noteParamsFor", () => {
  const preset = getPreset("preset-bass-1")!;

  it("derives freq from midi and clamps to the voice cap", () => {
    const ev = noteParamsFor(preset, { time: 1, midi: 36, holdSeconds: 0.2 });
    expect(ev.freq).toBeCloseTo(440 * Math.pow(2, (36 - 69) / 12), 9);
    const high = noteParamsFor(preset, {
      time: 1,
      midi: 127,
      holdSeconds: 0.2,
    });
    expect(high.freq).toBe(12400);
  });

  it("baseFreq overrides midi; sweep target follows endRatio", () => {
    const kick = getDrumKit("kit-default")!.pieces.kick;
    const ev = noteParamsFor(kick, { time: 0, holdSeconds: 0.2 });
    expect(ev.freq).toBe(kick.baseFreq);
    expect(ev.freqEnd).toBeCloseTo(
      kick.baseFreq! * kick.pitchSweep!.endRatio,
      9,
    );
    expect(ev.sweepSeconds).toBe(kick.pitchSweep!.seconds);
  });

  it("noise presets force noiseMix 1; seed is deterministic and in range", () => {
    const hat = getDrumKit("kit-default")!.pieces.hat;
    const a = noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 3 });
    const b = noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 3 });
    expect(a.noiseMix).toBe(1);
    expect(a.noiseShort).toBe(true);
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBeGreaterThanOrEqual(1);
    expect(a.seed).toBeLessThanOrEqual(32767);
    expect(
      noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 4 }).seed,
    ).not.toBe(a.seed);
  });

  it("maps wave names to stable wire codes", () => {
    expect(WAVE_CODE.pulse).toBe(0);
    expect(WAVE_CODE.triangle).toBe(1);
    expect(WAVE_CODE.noise).toBe(2);
    expect(WAVE_CODE.pluck).toBe(3);
    expect(
      noteParamsFor(preset, { time: 0, midi: 60, holdSeconds: 0.1 }).wave,
    ).toBe(0);
  });

  it("pluck presets ride the wire unchanged: wave 3, duty = string decay", () => {
    const pluck = getPreset("preset-bass-7")!;
    const ev = noteParamsFor(pluck, { time: 0.5, midi: 40, holdSeconds: 0.3 });
    expect(ev.wave).toBe(WAVE_CODE.pluck);
    // duty passes through untouched — the worklet derives the KS damping
    // from it (duty × 4 s); no wire-format field was added for pluck.
    expect(ev.duty).toBe(pluck.duty);
    expect(ev.noiseMix).toBe(0); // pure string: excitation is the seeded fill
    expect(ev.freq).toBeCloseTo(440 * Math.pow(2, (40 - 69) / 12), 9);
  });

  it("pluck presets ship without pitchSweep (KS loop length is fixed at trigger)", () => {
    const plucks = Object.values(PRESET_LIBRARY).filter(
      (p) => p.wave === "pluck",
    );
    expect(plucks.length).toBeGreaterThanOrEqual(5); // 2 bass + 2 chords + 2 lead lanes use it
    for (const p of plucks) {
      expect(p.pitchSweep, `${p.id} must not pair pluck with pitchSweep`).toBe(
        undefined,
      );
    }
  });
});
