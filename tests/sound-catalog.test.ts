import { describe, expect, it } from "vitest";
import {
  CHARACTER_GROUPS,
  SOUND_CATALOG,
  filterSounds,
} from "../src/audio/soundCatalog";

describe("sound browser catalog", () => {
  it("covers every kit and pitched sound with a category and one tag per character dimension", () => {
    expect(SOUND_CATALOG.filter((s) => s.drums)).toHaveLength(80);
    expect(SOUND_CATALOG.filter((s) => !s.drums)).toHaveLength(836);
    expect(new Set(SOUND_CATALOG.map((s) => s.id)).size).toBe(916);
    expect(
      new Set(SOUND_CATALOG.filter((s) => s.drums).map((s) => s.category)).size,
    ).toBe(8);
    expect(
      new Set(SOUND_CATALOG.filter((s) => !s.drums).map((s) => s.category))
        .size,
    ).toBe(18);
    for (const sound of SOUND_CATALOG)
      for (const group of CHARACTER_GROUPS)
        expect(
          sound.characters.filter((tag) =>
            (group as readonly string[]).includes(tag),
          ),
        ).toHaveLength(1);
  });
  it("combines category, character and every search word", () => {
    const bass = filterSounds(SOUND_CATALOG, {
      category: "Bass",
      characters: ["Dark", "Soft"],
    });
    expect(bass.length).toBeGreaterThan(0);
    expect(
      bass.every(
        (s) =>
          s.category === "Bass" &&
          s.characters.includes("Dark") &&
          s.characters.includes("Soft"),
      ),
    ).toBe(true);
    const search = filterSounds(SOUND_CATALOG, { query: "dark bass" });
    expect(search.length).toBeGreaterThan(0);
    expect(
      search.every(
        (s) => s.category === "Bass" && s.characters.includes("Dark"),
      ),
    ).toBe(true);
    expect(filterSounds(SOUND_CATALOG, { query: "808 classic" })[0]?.id).toBe(
      "kit-808",
    );
  });
  it("keeps recent order and excludes unknown or inapplicable IDs", () => {
    const result = filterSounds(
      SOUND_CATALOG.filter((s) => !s.drums),
      { ids: ["preset-lead-2", "kit-808", "missing", "preset-bass-1"] },
    );
    expect(result.map((s) => s.id)).toEqual(["preset-lead-2", "preset-bass-1"]);
  });
});
