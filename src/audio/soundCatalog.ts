import { DRUM_KITS, PRESET_LIBRARY, type WaveKind } from "./presets";
import { DRUM_CHARACTERS } from "./drumCharacters";
import { soundFamily } from "../components/laneMeta";

export const CHARACTER_GROUPS = [
  ["Bright", "Dark"],
  ["Soft", "Punchy"],
  ["Clean", "Gritty"],
  ["Short", "Sustained"],
] as const;
export type SoundCharacter = (typeof CHARACTER_GROUPS)[number][number];
export interface CatalogSound {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly drums: boolean;
  readonly characters: readonly SoundCharacter[];
  readonly description: string;
}

// Explicit kit families. These describe the authored synthesis/recording design,
// not a promise that a named kit is a recording of an acoustic instrument.
const KIT_FAMILIES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    "Classic electronic":
      "default lab pop trap 808 electro neon digital circuit plasticpop lasergrid robotbreak",
    "Punch & club":
      "punch warehouse roundhouse carbon spark clubcrunch garagesnap breakroom dryfunk halftime shuffle junglewire coastal solarpunch ember volcanic",
    "Soft percussion":
      "soft velvet minimal vacuum afterhours monoroom brushecho synthjazz lowtide vapor frostbyte",
    "Lo-fi": "dust lofi dusty tapeclub sand arcadedust shadowbox",
    Metallic:
      "metal wire copper rust industrial glass porcelain steelring nickel alloy magnetic",
    "Wood & skin":
      "acoustic wood bamboo ceramic hollow rattle rhythmwoods desert clay",
    "Deep & dark":
      "technoir deep subway dubcellar coldstorage deepcrunch darkmatter",
    Experimental: "grit orbit softcircuit satellite lunar comet starrattle",
  }).flatMap(([family, slugs]) =>
    slugs.split(" ").map((slug) => [`kit-${slug}`, family]),
  ),
);

// Character metadata comes from actual synthesis controls: oscillator spectrum,
// envelope and noise mixture. It remains separate from saved preset recipes.
const WAVE_TONE: Readonly<Record<WaveKind, SoundCharacter>> = {
  sine: "Dark",
  triangle: "Dark",
  flute: "Dark",
  bowed: "Dark",
  organ: "Dark",
  pluck: "Bright",
  pulse: "Bright",
  saw: "Bright",
  bell: "Bright",
  brass: "Bright",
  reed: "Bright",
  mallet: "Bright",
  noise: "Bright",
};
export const SOUND_CATALOG: readonly CatalogSound[] = [
  ...Object.values(PRESET_LIBRARY)
    .filter((p) => p.pitchRange)
    .map((p): CatalogSound => {
      const characters: SoundCharacter[] = [
        WAVE_TONE[p.wave],
        p.envelope.attack >= 0.04 ? "Soft" : "Punchy",
        p.noiseMix >= 0.045 || p.wave === "noise" || p.wave === "saw"
          ? "Gritty"
          : "Clean",
        p.envelope.release >= 0.5 || p.envelope.sustain >= 0.5
          ? "Sustained"
          : "Short",
      ];
      const category = soundFamily(p.id);
      return {
        id: p.id,
        name: p.name,
        category,
        drums: false,
        characters,
        description: `${characters.join(" · ")} · ${p.voiceType === "sample" ? "Recorded" : "Synthesized"}`,
      };
    }),
  ...Object.values(DRUM_KITS).map((kit): CatalogSound => {
    const c = DRUM_CHARACTERS[kit.id];
    const characters: SoundCharacter[] = [
      c.bright >= 0.5 ? "Bright" : "Dark",
      c.body === "sine" || c.body === "triangle" ? "Soft" : "Punchy",
      c.body === "saw" || c.body === "noise" || c.grain <= 10
        ? "Gritty"
        : "Clean",
      c.length >= 1 ? "Sustained" : "Short",
    ];
    return {
      id: kit.id,
      name: kit.name,
      category: KIT_FAMILIES[kit.id] ?? "Experimental",
      drums: true,
      characters,
      description: `${characters.join(" · ")} · ${Object.values(kit.pieces).some((p) => p.sampleRef) ? "Includes recordings" : "Synthesized"}`,
    };
  }),
];

export interface SoundFilter {
  readonly category?: string;
  readonly characters?: readonly SoundCharacter[];
  readonly query?: string;
  readonly ids?: readonly string[];
}
export function filterSounds(
  sounds: readonly CatalogSound[],
  filter: SoundFilter,
): CatalogSound[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const characterNames = CHARACTER_GROUPS.flat().map((tag) =>
    tag.toLowerCase(),
  );
  const categoryNames = new Set(sounds.map((s) => s.category.toLowerCase()));
  return sounds
    .filter(
      (s) =>
        (!filter.category || s.category === filter.category) &&
        (!filter.ids || filter.ids.includes(s.id)) &&
        (filter.characters ?? []).every((tag) => s.characters.includes(tag)) &&
        (s.name.toLowerCase() === query ||
          terms.every((term) => {
            if (characterNames.includes(term))
              return s.characters.some((tag) => tag.toLowerCase() === term);
            if (categoryNames.has(term))
              return s.category.toLowerCase() === term;
            return `${s.name} ${s.category} ${s.description}`
              .toLowerCase()
              .includes(term);
          })),
    )
    .sort((a, b) => {
      if (filter.ids)
        return filter.ids.indexOf(a.id) - filter.ids.indexOf(b.id);
      const rank = (s: CatalogSound) =>
        !query
          ? 2
          : s.name.toLowerCase() === query
            ? 0
            : s.name.toLowerCase().includes(query)
              ? 1
              : 2;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}
