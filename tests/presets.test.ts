import { describe, expect, it } from "vitest";
import {
  DRUM_KITS,
  PRESET_LIBRARY,
  WAVE_CODE,
  getDrumKit,
  getPreset,
  noteParamsFor,
  type VoicePreset,
} from "../src/audio/presets";
import { DRUM_PIECES } from "../src/document/schema";

function validatePreset(p: VoicePreset): void {
  expect(typeof p.id).toBe("string");
  expect(p.wave === "pulse" || p.wave === "triangle" || p.wave === "noise").toBe(true);
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
  for (const seg of [attack, decay, release]) expect(seg).toBeGreaterThanOrEqual(0);
  expect(sustain).toBeGreaterThanOrEqual(0);
  expect(sustain).toBeLessThanOrEqual(1);
}

describe("preset library", () => {
  it("has at least 2 presets per pitched lane type (bass/chords/lead)", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const ids = Object.keys(PRESET_LIBRARY).filter((id) => id.includes(lane));
      expect(ids.length).toBeGreaterThanOrEqual(2);
      for (const id of ids) validatePreset(getPreset(id)!);
    }
  });

  it("pitched presets carry a pitch range with a sane octave", () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      expect(p.pitchRange?.octaveBase).toBeDefined();
      expect(p.pitchRange!.octaveBase).toBeGreaterThanOrEqual(1);
      expect(p.pitchRange!.octaveBase).toBeLessThanOrEqual(6);
    }
  });

  it("has 2 drum kits, each mapping every drum piece to a preset", () => {
    const kits = Object.values(DRUM_KITS);
    expect(kits.length).toBeGreaterThanOrEqual(2);
    for (const kit of kits) {
      for (const piece of DRUM_PIECES) {
        const p = kit.pieces[piece];
        expect(p, `${kit.id}.${piece}`).toBeDefined();
        validatePreset(p);
      }
    }
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
    const high = noteParamsFor(preset, { time: 1, midi: 127, holdSeconds: 0.2 });
    expect(high.freq).toBe(12400);
  });

  it("baseFreq overrides midi; sweep target follows endRatio", () => {
    const kick = getDrumKit("kit-default")!.pieces.kick;
    const ev = noteParamsFor(kick, { time: 0, holdSeconds: 0.2 });
    expect(ev.freq).toBe(kick.baseFreq);
    expect(ev.freqEnd).toBeCloseTo(kick.baseFreq! * kick.pitchSweep!.endRatio, 9);
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
    expect(noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 4 }).seed).not.toBe(a.seed);
  });

  it("maps wave names to stable wire codes", () => {
    expect(WAVE_CODE.pulse).toBe(0);
    expect(WAVE_CODE.triangle).toBe(1);
    expect(WAVE_CODE.noise).toBe(2);
    expect(noteParamsFor(preset, { time: 0, midi: 60, holdSeconds: 0.1 }).wave).toBe(0);
  });
});
