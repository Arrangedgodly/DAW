import type { DrumCharacter } from "./drumCharacters";
import type { WaveKind } from "./presets";

// Forty additional synthesized kit designs. The tuning and decay coordinates
// are authored here, independently of the earlier banks and their seeds.
type KitRow = readonly [
  string,
  string,
  number,
  number,
  number,
  WaveKind,
  WaveKind,
  number,
];
const ROWS: readonly KitRow[] = [
  ["breakroom", "BREAK ROOM", 1.01, 0.29, 42, "triangle", "mallet", 0.44],
  ["dryfunk", "DRY FUNK", 0.87, 0.47, 43, "sine", "pluck", 0.26],
  ["halftime", "HALFTIME", 0.53, 0.59, 44, "sine", "reed", 0.13],
  ["shuffle", "SHUFFLE BOX", 1.14, 0.71, 45, "mallet", "pulse", 0.54],
  ["dubcellar", "DUB CELLAR", 0.57, 0.83, 46, "triangle", "organ", 0.21],
  ["garagesnap", "GARAGE SNAP", 1.29, 0.97, 47, "pulse", "mallet", 0.36],
  ["junglewire", "JUNGLE WIRE", 1.51, 1.09, 48, "saw", "pluck", 0.87],
  ["clubcrunch", "CLUB CRUNCH", 1.11, 1.21, 49, "brass", "reed", 0.79],
  ["afterhours", "AFTER HOURS", 0.69, 1.33, 50, "sine", "bell", 0.24],
  ["monoroom", "MONO ROOM", 0.93, 1.47, 51, "triangle", "pulse", 0.33],
  ["brushecho", "BRUSH ECHO", 0.76, 1.59, 52, "sine", "mallet", 0.15],
  ["synthjazz", "SYNTH JAZZ", 1.07, 1.71, 53, "mallet", "bell", 0.46],
  ["rhythmwoods", "RHYTHM WOODS", 1.24, 1.83, 4, "mallet", "pluck", 0.61],
  ["coastal", "COASTAL STEP", 0.81, 1.97, 5, "sine", "organ", 0.29],
  ["desert", "DESERT HITS", 1.43, 2.07, 6, "reed", "mallet", 0.71],
  ["clay", "CLAY ROOM", 0.91, 0.41, 7, "mallet", "reed", 0.38],
  ["porcelain", "PORCELAIN", 1.67, 0.53, 8, "bell", "mallet", 0.82],
  ["steelring", "STEEL RING", 1.83, 0.65, 9, "brass", "bell", 0.93],
  ["nickel", "NICKEL SNAP", 1.39, 0.77, 10, "pulse", "bell", 0.58],
  ["alloy", "ALLOY BOX", 1.56, 0.91, 11, "reed", "organ", 0.89],
  ["magnetic", "MAGNETIC", 0.97, 1.03, 12, "organ", "pulse", 0.47],
  ["lasergrid", "LASER GRID", 1.74, 1.17, 13, "pulse", "mallet", 0.09],
  ["robotbreak", "ROBOT BREAK", 1.31, 1.29, 14, "saw", "organ", 0.84],
  ["arcadedust", "ARCADE DUST", 1.17, 1.41, 15, "triangle", "reed", 0.35],
  ["plasticpop", "PLASTIC POP", 1.36, 1.53, 16, "mallet", "pulse", 0.66],
  ["softcircuit", "SOFT CIRCUIT", 0.73, 1.67, 17, "organ", "mallet", 0.2],
  ["coldstorage", "COLD STORAGE", 0.63, 1.79, 18, "bowed", "reed", 0.41],
  ["satellite", "SATELLITE", 1.63, 1.91, 19, "bell", "organ", 0.76],
  ["lunar", "LUNAR STEP", 0.59, 2.03, 20, "sine", "bell", 0.11],
  ["solarpunch", "SOLAR PUNCH", 1.49, 0.31, 21, "brass", "pulse", 0.95],
  ["comet", "COMET TRAIL", 1.78, 0.43, 22, "reed", "bell", 0.64],
  ["starrattle", "STAR RATTLE", 1.69, 0.55, 23, "bell", "pluck", 0.88],
  ["lowtide", "LOW TIDE", 0.51, 0.69, 24, "triangle", "organ", 0.16],
  ["deepcrunch", "DEEP CRUNCH", 0.67, 0.81, 25, "saw", "reed", 0.92],
  ["darkmatter", "DARK MATTER", 0.55, 0.95, 26, "bowed", "mallet", 0.48],
  ["shadowbox", "SHADOW BOX", 0.77, 1.07, 27, "sine", "pulse", 0.18],
  ["ember", "EMBER HITS", 1.13, 1.23, 28, "brass", "mallet", 0.72],
  ["volcanic", "VOLCANIC", 0.89, 1.37, 29, "saw", "bell", 0.99],
  ["vapor", "VAPOR ROOM", 0.71, 1.51, 30, "organ", "reed", 0.32],
  ["frostbyte", "FROST BYTE", 1.81, 1.89, 31, "pulse", "bell", 0.07],
];

export const NEXT_DRUM_BANK = ROWS.map(
  ([slug, name, pitch, length, grain, body, metal, bright]) => ({
    id: `kit-${slug}`,
    name,
    character: {
      pitch,
      length,
      grain,
      body,
      metal,
      bright,
    } satisfies DrumCharacter,
  }),
);
