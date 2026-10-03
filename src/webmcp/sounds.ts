import * as v from "valibot";
import {
  CHARACTER_GROUPS,
  SOUND_CATALOG,
  filterSounds,
} from "../audio/soundCatalog";
import { DRUM_KITS, PRESET_LIBRARY } from "../audio/presets";
import { DRUM_PIECES } from "../document/schema";

const characters = CHARACTER_GROUPS.flat();
export const soundInputSchema = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 200 },
    type: { type: "string", enum: ["drums", "pitched"] },
    category: {
      type: "string",
      enum: [...new Set(SOUND_CATALOG.map((s) => s.category))],
    },
    characters: {
      type: "array",
      maxItems: 8,
      items: { type: "string", enum: characters },
    },
    offset: { type: "integer", minimum: 0, maximum: 10000 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};
const schema = v.strictObject({
  query: v.optional(v.pipe(v.string(), v.maxLength(200))),
  type: v.optional(v.picklist(["drums", "pitched"])),
  category: v.optional(
    v.picklist([...new Set(SOUND_CATALOG.map((s) => s.category))]),
  ),
  characters: v.optional(
    v.pipe(v.array(v.picklist(characters)), v.maxLength(8)),
  ),
  offset: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10000)),
    0,
  ),
  limit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
    50,
  ),
});

/** Pagination applies independently to kits and presets, retaining both legacy keys. */
export function listSounds(input: unknown) {
  const args = v.parse(schema, input);
  const matches = filterSounds(
    SOUND_CATALOG.filter(
      (s) => !args.type || s.drums === (args.type === "drums"),
    ),
    args,
  );
  const kits = matches.filter((s) => s.drums);
  const presets = matches.filter((s) => !s.drums);
  const page = (items: typeof matches) =>
    items.slice(args.offset, args.offset + args.limit).map((sound) => {
      if (sound.drums)
        return {
          ...sound,
          source: Object.values(DRUM_KITS[sound.id].pieces).some(
            (p) => p.sampleRef,
          )
            ? "includes-recordings"
            : "synthesized",
        };
      const preset = PRESET_LIBRARY[sound.id];
      return {
        ...sound,
        source: preset.voiceType === "sample" ? "recorded" : "synthesized",
        pitchRange: preset.pitchRange,
        octaveBase: preset.pitchRange!.octaveBase,
        ...(preset.rootMidi !== undefined ? { rootMidi: preset.rootMidi } : {}),
      };
    });
  const hasMore =
    Math.max(kits.length, presets.length) > args.offset + args.limit;
  return {
    kits: page(kits),
    presets: page(presets),
    drumPieces: DRUM_PIECES,
    total: { kits: kits.length, presets: presets.length },
    offset: args.offset,
    limit: args.limit,
    hasMore,
    nextOffset: hasMore ? args.offset + args.limit : null,
    categories: [...new Set(matches.map((s) => s.category))].sort(),
    characters,
  };
}
