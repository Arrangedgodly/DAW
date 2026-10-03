import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DRUM_KITS, PRESET_LIBRARY, noteParamsFor } from "../src/audio/presets";
import { DRUM_PIECES } from "../src/document/schema";
import { soundOptionsFor } from "../src/components/laneMeta";

// Ignore identity, gain and seed. Changing a label or random seed does not
// qualify as a new sound. Render tests separately enforce audio distinctness.
function signature(id: string, drum = false): string {
  const preset = drum
    ? Object.values(DRUM_KITS)
        .flatMap((k) => Object.values(k.pieces))
        .find((p) => p.id === id)!
    : PRESET_LIBRARY[id];
  const { time, seed, level, ...event } = noteParamsFor(preset, {
    time: 0,
    midi: 60,
    holdSeconds: 1,
  });
  void time;
  void seed;
  void level;
  if (event.noiseMix === 0) {
    event.noiseRate = 1;
    event.noiseShort = false;
  }
  return JSON.stringify(event);
}

describe("expanded sound library", () => {
  it("preserves every sound and parameter in the previous forty kits", () => {
    const baseline: Record<string, string> = JSON.parse(
      readFileSync(
        new URL("./fixtures/drum-kits-before-80.json", import.meta.url),
        "utf8",
      ),
    );
    expect(Object.keys(baseline)).toHaveLength(40);
    for (const [id, hash] of Object.entries(baseline)) {
      expect(DRUM_KITS[id], id).toBeDefined();
      expect(
        createHash("sha256")
          .update(JSON.stringify(DRUM_KITS[id]))
          .digest("hex"),
        id,
      ).toBe(hash);
    }
  });
  it("doubles every pitched category and offers exactly 836 presets on every track", () => {
    const options = soundOptionsFor("bass");
    const families = new Set(options.map((p) => p.family));
    expect(families.size).toBe(18);
    expect(families.has("Other")).toBe(false);
    expect(options).toHaveLength(836);
    const expected: Record<string, number> = {
      Bass: 66,
      Bells: 48,
      "Bowed strings": 40,
      Brass: 48,
      Chords: 60,
      Guitars: 40,
      Keys: 42,
      Leads: 68,
      Mallets: 40,
      Organs: 40,
      Pads: 52,
      "Plucked strings": 44,
      "Sound effects": 48,
      "Synth vocals": 40,
      Synths: 40,
      Textures: 40,
      Woodwinds: 40,
      World: 40,
    };
    for (const family of families) {
      const voices = options.filter((p) => p.family === family);
      expect(voices.length, family).toBe(expected[family]);
      expect(new Set(voices.map((p) => p.name)).size, family).toBe(
        voices.length,
      );
      expect(new Set(voices.map((p) => signature(p.id))).size, family).toBe(
        voices.length,
      );
    }
    for (const lane of ["chords", "lead", "extra1", "extra4"] as const)
      expect(soundOptionsFor(lane)).toEqual(options);
  });

  it("offers eighty complete kits with sixteen unique sounds each and no shared extra recipes", () => {
    expect(Object.keys(DRUM_KITS)).toHaveLength(80);
    const extras = new Set<string>();
    for (const kit of Object.values(DRUM_KITS)) {
      expect(Object.keys(kit.pieces).sort()).toEqual([...DRUM_PIECES].sort());
      const signatures = DRUM_PIECES.map((p) =>
        signature(kit.pieces[p].id, true),
      );
      expect(new Set(signatures).size, kit.id).toBe(16);
      for (const p of DRUM_PIECES.slice(6)) {
        const sig = signature(kit.pieces[p].id, true);
        expect(
          extras.has(sig),
          `${kit.id}.${p} repeats an extra from another kit`,
        ).toBe(false);
        extras.add(sig);
      }
    }
  });
});
