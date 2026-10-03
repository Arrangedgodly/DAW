import type { VoicePreset, WaveKind } from "./presets";

// A second authored bank. These styles deliberately use different articulation
// and spectral settings from the first bank; existing presets stay untouched.
type Style = readonly [number, number, number, number, number, number, number];
const STYLES: readonly Style[] = [
  [0.07, 0, 0.0015, 0.075, 0.04, 0.065, 0.012],
  [0.35, -1, 0.022, 0.44, 0.56, 0.33, 0.09],
  [0.81, 1, 0.0035, 0.73, 0.1, 0.95, 0.018],
  [0.57, 0, 0.055, 0.27, 0.88, 0.21, 0.025],
  [0.93, -1, 0.007, 0.19, 0.26, 0.13, 0.12],
  [0.21, 1, 0.16, 0.54, 0.76, 0.78, 0.02],
  [0.69, 0, 0.0025, 1.32, 0.06, 1.45, 0.035],
  [0.41, -1, 0.032, 0.115, 0.96, 0.075, 0.055],
  [0.87, 1, 0.095, 0.39, 0.46, 0.52, 0.14],
  [0.11, 0, 0.38, 0.88, 0.64, 1.75, 0.03],
  [0.51, -1, 0.0055, 0.24, 0.15, 0.42, 0.07],
  [0.74, 1, 0.019, 0.66, 0.82, 0.29, 0.016],
  [0.29, 0, 0.24, 0.46, 0.9, 0.92, 0.05],
  [0.97, -1, 0.0045, 1.75, 0.08, 1.9, 0.11],
  [0.46, 1, 0.011, 0.055, 0.02, 0.035, 0.045],
  [0.64, 0, 0.065, 0.92, 0.52, 1.08, 0.085],
  [0.17, -1, 0.135, 0.31, 0.84, 0.46, 0.022],
  [0.79, 1, 0.009, 0.155, 0.32, 0.19, 0.16],
  [0.37, 0, 0.52, 1.45, 0.58, 2.2, 0.065],
  [0.91, -1, 0.028, 0.58, 0.42, 0.67, 0.04],
  [0.26, 1, 0.0018, 0.34, 0.18, 0.48, 0.1],
  [0.62, 0, 0.18, 0.75, 0.94, 1.25, 0.027],
  [0.84, -1, 0.014, 0.145, 0.62, 0.11, 0.13],
  [0.43, 1, 0.042, 1.05, 0.24, 1.35, 0.06],
  [0.99, 0, 0.003, 0.48, 0.38, 0.57, 0.075],
  [0.14, -1, 0.31, 1.6, 0.72, 2.1, 0.033],
  [0.55, 1, 0.006, 0.095, 0.12, 0.055, 0.15],
  [0.77, 0, 0.075, 0.36, 0.86, 0.38, 0.048],
  [0.33, -1, 0.21, 0.62, 0.68, 1.02, 0.08],
  [0.89, 1, 0.016, 0.82, 0.28, 0.72, 0.023],
  [0.49, 0, 0.008, 0.205, 0.48, 0.155, 0.095],
  [0.67, -1, 0.11, 1.18, 0.92, 1.55, 0.052],
  [0.19, 1, 0.027, 0.41, 0.36, 0.61, 0.125],
  [0.59, 0, 0.0038, 0.98, 0.16, 0.87, 0.038],
];

interface Bank {
  family: string;
  waves: readonly WaveKind[];
  octave: number;
  attack: number;
  tail: number;
  color: number;
  names: string;
}

// Counts match the complete first release of each category, including its
// legacy and sample presets. No runtime fill-to-count or cloning is involved.
const BANKS: readonly Bank[] = [
  {
    family: "bass",
    waves: ["triangle", "saw", "pluck", "reed"],
    octave: 2,
    attack: 0.45,
    tail: 0.62,
    color: 0.89,
    names:
      "TRI THUMP|RUBBER SAW|SHORT FRET|BASS BUZZ|TRI KNOCK|ANALOG LOW|BASS HARP|REED FLOOR|TRI CHUG|SAW FOG|DAMPED BASS|REED CRUNCH|TRI SWELL|SAW TAIL|FRET TICK|BASS CHANT|TRI HUM|SAW EDGE|FRET CLOUD|REED RUMBLE|TRI PICK|SAW LANTERN|FRET PUNCH|BASS RASP|TRI STRIDE|SAW HUM|FRET CLICK|REED ROAR|TRI ROLL|SAW GLASS|FRET STAB|REED WAVE|TRI SPARK",
  },
  {
    family: "bells",
    waves: ["bell", "mallet"],
    octave: 4,
    attack: 0.32,
    tail: 1.23,
    color: 0.84,
    names:
      "BELL PIN|COPPER CHIME|SILVER BELL|RINGING BAR|TIN BELL|AMBER CHIME|BELL RIBBON|NIGHT CHIME|BELL DUST|CHIME MIST|BELL PEARL|CHIME ARC|BELL LANTERN|MALLET GONG|BELL PIP|CHIME RAIN|BELL EMBER|CHIME SHARD|BELL AURORA|CHIME HUM|BELL DROP|CHIME WAVE|BELL TWIG|CHIME PULSE",
  },
  {
    family: "bowed",
    waves: ["bowed"],
    octave: 3,
    attack: 1.75,
    tail: 1.12,
    color: 0.79,
    names:
      "BOW TIP|GUT STRING|VIOLIN FLARE|VIOLA CHANT|CELLO BARK|BOWED AMBER|STRING RIBBON|BASS BOW|VIOLIN GRAIN|BOWED MIST|CELLO PICK|VIOLA EDGE|STRING SWELL|BASS ROSIN|BOW TICK|VIOLIN RAIN|CELLO HUM|BOWED SHOUT|VIOLA CLOUD|STRING RUMBLE",
  },
  {
    family: "brass",
    waves: ["brass", "reed"],
    octave: 3,
    attack: 0.72,
    tail: 0.83,
    color: 0.76,
    names:
      "CORNET HIT|REED BUGLE|TRUMPET FLARE|LOW FLUGEL|TROMBONE BARK|BRASS LEGATO|HORN RIBBON|REED PEDAL|BRASS EDGE|HORN MIST|TUBA PICK|BRASS REPLY|HORN SWELL|LOW BRASS TAIL|BRASS TICK|BRASS RAIN|CORNET HUM|REED SHOUT|BRASS AURORA|HORN RUMBLE|TRUMPET PIN|BRASS WAVE|BRASS KNOCK|HORN ARC",
  },
  {
    family: "chords",
    waves: ["brass", "pluck", "organ", "triangle"],
    octave: 3,
    attack: 0.8,
    tail: 1.18,
    color: 0.74,
    names:
      "HORN COMP|HARP STACK|PIPE CHORD|TRI CHORD|BRASS KNOCK|FRET STACK|ORGAN RIBBON|TRI COMP|HORN GRAIN|PLUCK MIST|PIPE PICK|TRI ANSWER|BRASS WASH|HARP TAIL|PIPE TICK|TRI CHANT|HORN HUM|FRET CHORD|PIPE CLOUD|TRI RUMBLE|BRASS PIN|HARP WAVE|PIPE KNOCK|TRI ARC|HORN STRIDE|FRET WASH|PIPE CLICK|TRI EDGE|BRASS ROLL|HARP AURORA",
  },
  {
    family: "guitars",
    waves: ["pluck", "pulse", "saw", "pluck"],
    octave: 3,
    attack: 0.24,
    tail: 0.73,
    color: 0.81,
    names:
      "PICK TIP|SQUARE GUITAR|DRIVE STRING|SOFT FRET|NYLON KNOCK|PULSE AMP|FUZZ RIBBON|LOW STEEL|PICK GRAIN|SQUARE WASH|DRIVE PICK|FRET ANSWER|NYLON WASH|PULSE TAIL|FUZZ TICK|STEEL RAIN|PICK HUM|SQUARE BITE|DRIVE CLOUD|FRET RUMBLE",
  },
  {
    family: "keys",
    waves: ["mallet", "organ", "bell", "pluck"],
    octave: 4,
    attack: 0.3,
    tail: 0.93,
    color: 0.78,
    names:
      "TINE PIN|PIPE KEYS|CHIME KEYS|CLAV COMP|TINE KNOCK|KEYS LEGATO|GLASS TINES|LOW CLAV|TINE GRAIN|PIPE MIST|KEYS PEARL|CLAV REPLY|TINE WASH|PIPE TAIL|CHIME TICK|CLAV RAIN|KEYS HUM|PIPE BITE|KEYS AURORA|CLAV RUMBLE|TINE DROP",
  },
  {
    family: "lead",
    waves: ["pulse", "brass", "bell", "flute"],
    octave: 4,
    attack: 0.52,
    tail: 0.72,
    color: 0.85,
    names:
      "PULSE PIN|HORN SOLO|CHIME SOLO|PIPE SOLO|PULSE KNOCK|HORN LEGATO|BELL RIBBON|LOW PIPE SOLO|PULSE GRAIN|HORN MIST|CHIME PICK|PIPE ANSWER|PULSE WASH|HORN TAIL|CHIME TICK|PIPE RAIN|PULSE HUM|HORN BITE|CHIME AURORA|PIPE RUMBLE|PULSE DROP|HORN WAVE|CHIME KNOCK|PIPE ARC|PULSE STRIDE|HORN WASH|CHIME CLICK|PIPE EDGE|PULSE ROLL|HORN AURORA|CHIME STAB|PIPE CHANT|PULSE SPARK|HORN ECHO",
  },
  {
    family: "mallets",
    waves: ["mallet", "bell"],
    octave: 4,
    attack: 0.28,
    tail: 0.84,
    color: 0.83,
    names:
      "MARIMBA PIN|TUBE CHIME|WOOD FLARE|VIBE CHANT|MALLET KNOCK|METAL LEGATO|MARIMBA ROLL|LOW TUBE|WOOD GRAIN|VIBE MIST|MALLET PEARL|TUBE ANSWER|WOOD WASH|VIBE TAIL|MALLET TICK|TUBE RAIN|MARIMBA HUM|VIBE SHARD|WOOD AURORA|METAL RUMBLE",
  },
  {
    family: "organs",
    waves: ["organ", "reed"],
    octave: 3,
    attack: 0.33,
    tail: 0.77,
    color: 0.87,
    names:
      "PIPE PIN|HARMONIUM HIT|DRAWBAR FLARE|REED CHANT|PIPE KNOCK|REED LEGATO|ORGAN RIBBON|LOW REED BED|PIPE GRAIN|REED MIST|ORGAN PICK|REED ANSWER|PIPE WASH|REED TAIL|ORGAN TICK|REED RAIN|DRAWBAR HUM|REED BITE|PIPE AURORA|REED RUMBLE",
  },
  {
    family: "pads",
    waves: ["brass", "bowed", "reed", "triangle"],
    octave: 3,
    attack: 2.2,
    tail: 1.75,
    color: 0.62,
    names:
      "HORN VEIL|ROSIN PAD|REED VEIL|TRI HALO|BRASS SHADE|BOWED LEGATO|REED RIBBON|LOW TRI BED|HORN GLOW|BOWED MIST|REED AURA|TRI CHOIR|HORN WASH|BOWED TAIL|REED MIST PAD|TRI RAIN|BRASS HUM|ROSIN GLOW|REED AURORA|TRI FOG|HORN SHADOW|BOWED WAVE|REED WASH|TRI ARC|BRASS TIDE|ROSIN DRONE",
  },
  {
    family: "strings",
    waves: ["pluck"],
    octave: 4,
    attack: 0.22,
    tail: 0.98,
    color: 0.82,
    names:
      "HARP PIN|GUT PLUCK|KOTO FLARE|LYRE CHANT|STRING KNOCK|HARP LEGATO|WIRE RIBBON|LOW LYRE|KOTO GRAIN|HARP MIST|STRING PEARL|LYRE ANSWER|WIRE WASH|HARP TAIL|KOTO TICK|LYRE RAIN|STRING HUM|HARP SHARD|WIRE AURORA|LYRE RUMBLE|KOTO DROP|HARP WAVE",
  },
  {
    family: "fx",
    waves: ["pulse", "noise", "mallet", "saw"],
    octave: 4,
    attack: 0.85,
    tail: 1.3,
    color: 0.69,
    names:
      "ARCADE ZAP|SAND BURST|METAL DIVE|SAW BEACON|PULSE FALL|WIND LIFT|METAL RIBBON|SAW WOBBLE|RADAR DROP|DUST MIST|METAL PEARL|SAW REPLY|PULSE WASH|SURF TAIL|METAL CLICK|SAW RAIN|PULSE HUM FX|STATIC BITE|METAL AURORA|SAW RUMBLE|ARCADE PIN|WIND WAVE|METAL KNOCK|SAW PORTAL",
  },
  {
    family: "vocals",
    waves: ["bowed", "reed", "organ", "flute"],
    octave: 3,
    attack: 1.4,
    tail: 1.16,
    color: 0.58,
    names:
      "CHOIR PIN|VOX UH|VOX OH|AIR VOX|CHOIR KNOCK|VOX LEGATO|HUM CHOIR|LOW AIR VOX|CHOIR GRAIN|VOX MIST|VOX PEARL|AIR CHANT|CHOIR WASH|VOX TAIL|VOX CLICK|AIR CHOIR|CHOIR HUM|VOX SHOUT|VOX AURORA|AIR DRONE",
  },
  {
    family: "synths",
    waves: ["brass", "triangle", "pulse", "saw"],
    octave: 4,
    attack: 0.58,
    tail: 1.05,
    color: 0.86,
    names:
      "BRASS SEQ|TRI SEQ|PULSE GLASS|SAW CHANT|BRASS CLICK|TRI LEGATO|PULSE RIBBON|LOW SAW BED|BRASS GRAIN|TRI MIST|PULSE PEARL|SAW ANSWER|BRASS WASH|TRI TAIL|PULSE TICK|SAW SHOWER|BRASS HUM|TRI BITE|PULSE AURORA|SAW SHADOW",
  },
  {
    family: "textures",
    waves: ["noise", "organ", "bowed", "mallet"],
    octave: 3,
    attack: 2,
    tail: 1.62,
    color: 0.59,
    names:
      "PAPER TAP|PIPE THREAD|ROSIN THREAD|METAL THREAD|SAND KNOCK|ORGAN FOG|BOWED RIBBON|LOW METAL BED|DUST GRAIN|PIPE MIST|ROSIN GRAIN|METAL ANSWER|SURF VEIL|PIPE TAIL|BOWED TICK|METAL RAIN|STATIC HUM|PIPE SHARD|BOWED AURORA|METAL SHADOW",
  },
  {
    family: "woodwinds",
    waves: ["flute", "reed"],
    octave: 4,
    attack: 0.62,
    tail: 0.95,
    color: 0.73,
    names:
      "PIPE PIN|REED OBOE|FLUTE FLARE|CLARINET CHANT|FLUTE KNOCK|OBOE LEGATO|PIPE RIBBON|LOW BASSOON|FLUTE GRAIN|CLARINET MIST|PIPE PEARL|OBOE ANSWER|FLUTE WASH|BASSOON TAIL|PIPE TICK|CLARINET RAIN|FLUTE HUM|OBOE BITE|PIPE AURORA|REED SHADOW",
  },
  {
    family: "world",
    waves: ["reed", "pluck", "flute", "mallet"],
    octave: 4,
    attack: 0.48,
    tail: 0.89,
    color: 0.71,
    names:
      "SHENG PIN|OUD PICK|BAMBOO FLARE|MBIRA CHANT|REED KNOCK|KORA LEGATO|PIPE RIBBON|LOW MBIRA|SHENG GRAIN|OUD MIST|BAMBOO PEARL|LOG ANSWER|REED WASH|KORA TAIL|PIPE TICK|MBIRA RAIN|SHENG HUM|OUD SHARD|BAMBOO AURORA|LOG RUMBLE",
  },
];

export const ADDITIONAL_PRESETS: readonly VoicePreset[] = BANKS.flatMap(
  (bank, bankIndex) =>
    bank.names.split("|").map((name, i): VoicePreset => {
      const [brightness, register, attack, decay, sustain, release, noise] =
        STYLES[i];
      const wave = bank.waves[i % bank.waves.length];
      return {
        id: `preset-${bank.family}-${name.toLowerCase().replaceAll(" ", "-")}`,
        name,
        wave,
        duty: brightness * bank.color,
        pitchRange: {
          octaveBase: Math.max(1, Math.min(6, bank.octave + register)),
        },
        envelope: {
          attack: attack * bank.attack,
          decay: decay * bank.tail,
          sustain,
          release: release * bank.tail,
        },
        noiseMix: wave === "noise" ? 1 : noise * bank.color,
        noiseMode: i % 4 === 1 ? "short" : "long",
        noiseRate: 1 + ((i * 11 + bankIndex * 5 + 17) % 64),
        level:
          wave === "noise"
            ? 0.21
            : wave === "pulse" || wave === "saw"
              ? 0.4
              : 0.62,
        seed: 12001 + bankIndex * 100 + i,
        ...(bank.family === "fx" && wave !== "noise"
          ? {
              pitchSweep: {
                endRatio: i % 3 === 0 ? 0.09 : 2.6,
                seconds: 0.07 + decay * 0.8,
              },
            }
          : {}),
      };
    }),
);
