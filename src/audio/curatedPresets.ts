import type { VoicePreset, WaveKind } from "./presets";

// These are synthesized interpretations. No preset claims a recorded instrument.
// Each row supplies a playing style: timbre, register, envelope and breath/grit.
type Style = readonly [number, number, number, number, number, number, number];
const STYLES: readonly Style[] = [
  [0.12, 0, 0.002, 0.12, 0, 0.08, 0],
  [0.28, 0, 0.008, 0.35, 0.35, 0.24, 0.015],
  [0.48, 1, 0.015, 0.6, 0.65, 0.4, 0],
  [0.72, 0, 0.04, 0.18, 0.8, 0.18, 0.035],
  [0.9, -1, 0.08, 0.8, 0.5, 0.7, 0.01],
  [0.18, 1, 0.001, 0.28, 0.08, 0.3, 0.06],
  [0.38, 0, 0.12, 0.4, 0.85, 0.6, 0],
  [0.6, -1, 0.003, 1.1, 0.18, 1.2, 0.02],
  [0.82, 1, 0.025, 0.22, 0.4, 0.16, 0.08],
  [0.23, 0, 0.3, 0.65, 0.7, 1.4, 0.045],
  [0.44, -1, 0.006, 0.16, 0.92, 0.09, 0.025],
  [0.66, 1, 0.002, 0.85, 0.12, 0.85, 0],
  [0.95, 0, 0.06, 0.32, 0.6, 0.36, 0.05],
  [0.15, -1, 0.18, 0.95, 0.78, 1.6, 0.015],
  [0.32, 1, 0.001, 0.08, 0, 0.045, 0.1],
  [0.54, 0, 0.09, 0.48, 0.72, 0.55, 0.03],
  [0.76, -1, 0.004, 1.5, 0.2, 1.8, 0],
  [0.98, 1, 0.035, 0.14, 0.55, 0.12, 0.065],
  [0.36, 0, 0.45, 1.2, 0.65, 2, 0.04],
  [0.58, -1, 0.012, 0.55, 0.3, 0.8, 0.075],
];

interface Family {
  id: string;
  waves: readonly WaveKind[];
  octave: number;
  attack: number;
  tail: number;
  color: number;
  names: string;
}

const FAMILIES: readonly Family[] = [
  {
    id: "bass",
    waves: ["sine", "saw", "reed", "pulse", "pluck"],
    octave: 2,
    attack: 0.5,
    tail: 0.5,
    color: 0.92,
    names:
      "DEEP SUB|ROUND SAW|REED BASS|ACID PULSE|WOOD BASS|SNAP SUB|VELVET SAW|LOW REED|PULSE PICK|PLUCK SWELL|DUB SINE|SAW DROP|GRIT REED|HOLLOW PULSE|MUTED STRING|SINE BLOOM|SAW GROWL|REED SNAP|PULSE DRONE|FRET BASS",
  },
  {
    id: "chords",
    waves: ["organ", "saw", "bowed", "mallet", "reed"],
    octave: 3,
    attack: 1,
    tail: 1,
    color: 0.83,
    names:
      "ORGAN STAB|SAW COMP|STRING CHORD|MALLET STACK|REED STACK|GOSPEL HIT|SOFT SAW BED|LOW STRING|GLASS CHORD|REED SWELL|ORGAN COMP|SAW ARP|STRING COMP|MALLET CLOUD|REED STAB|ORGAN BLOOM|SAW CHORALE|STRING HIT|MALLET HAZE|REED CHORALE",
  },
  {
    id: "lead",
    waves: ["saw", "flute", "reed", "pulse", "bell"],
    octave: 4,
    attack: 0.6,
    tail: 0.6,
    color: 0.97,
    names:
      "SAW SOLO|FLUTE SOLO|REED SOLO|SYNC PULSE|BELL SOLO|SAW PICK|FLUTE LEGATO|LOW REED SOLO|PULSE GLINT|BELL SWELL|SAW WHISTLE|FLUTE SPARK|REED CALL|PULSE BLOOM|BELL TICK|SAW SING|FLUTE GLOW|REED SHOUT|PULSE CLOUD|BELL ANSWER",
  },
  {
    id: "bells",
    waves: ["bell", "mallet"],
    octave: 4,
    attack: 0.25,
    tail: 1.4,
    color: 0.95,
    names:
      "TINY CHIME|CELESTA|GLASS BELL|SOFT CHIME|IRON BELL|TOY CHIME|BELL CHOIR|LOW CHIME|ICE BELL|CHIME CLOUD|BRONZE BELL|STAR CHIME|HAND BELL|CHIME SWELL|BELL CLICK|BELL BLOOM|DEEP GONG|BRIGHT CHIME|GLASS CLOUD|DARK CHIME",
  },
  {
    id: "brass",
    waves: ["brass", "reed"],
    octave: 3,
    attack: 0.85,
    tail: 0.65,
    color: 0.88,
    names:
      "MUTED TRUMPET|FLUGEL SYNTH|PICCOLO BRASS|BRASS FANFARE|LOW TROMBONE|BRASS FALL|FRENCH SYNTH|TUBA SYNTH|BRASS SHAKE|BRASS SWELL|SOFT CORNET|BRASS CHIME|BRASS BARK|WARM SECTION|BRASS PUNCH|BRASS BLOOM|LOW SECTION|BRASS CALL|BRASS CLOUD|VALVE SYNTH",
  },
  {
    id: "fx",
    waves: ["noise", "saw", "bell", "pulse", "mallet"],
    octave: 4,
    attack: 1,
    tail: 1.1,
    color: 0.76,
    names:
      "STATIC HIT|SAW ZAP|GLASS DROP|PULSE ZAP|METAL IMPACT|DUST BURST|SAW LIFT|BELL FALL|RADAR PING|METAL SWELL|RADIO HISS|SAW DIVE|GLASS CRACK|SPACE BEACON|METAL TICK|SURF WASH|SAW SIREN|BELL STREAK|PULSE PORTAL|METAL TRAIL",
  },
  {
    id: "keys",
    waves: ["mallet", "bell", "reed", "pluck", "sine"],
    octave: 4,
    attack: 0.25,
    tail: 0.8,
    color: 0.87,
    names:
      "TINE KEYS|FM KEYS|REED KEYS|CLAV SYNTH|SOFT KEYS|BARK KEYS|GLASS KEYS|LOW REED KEYS|PICK KEYS|SINE KEYS|DRY TINES|BELL KEYS|REED COMP|MUTED CLAV|TOY KEYS|TINE BLOOM|DARK FM KEYS|BRIGHT CLAV|KEYS CLOUD|ROUND KEYS",
  },
  {
    id: "strings",
    waves: ["pluck"],
    octave: 4,
    attack: 0.15,
    tail: 1.2,
    color: 0.93,
    names:
      "SHORT ZITHER|SOFT HARP|HIGH KOTO|PICKED LYRE|LOW DULCIMER|BANJO SYNTH|HARP BLOOM|LOW ZITHER|BRIGHT KOTO|STRING CLOUD|PALM PLUCK|LONG HARP|WIRE PLUCK|LYRE SWELL|DEAD STRING|GENTLE ZITHER|LOW HARP|SHARP PLUCK|ZITHER CLOUD|WORN STRING",
  },
  {
    id: "pads",
    waves: ["bowed", "organ", "flute", "saw", "bell"],
    octave: 3,
    attack: 3,
    tail: 2,
    color: 0.7,
    names:
      "STRING VEIL|ORGAN PAD|FLUTE VEIL|SAW HAZE|BELL VEIL|DUST STRINGS|ORGAN CLOUD|LOW FLUTE PAD|SAW GLOW|BELL CLOUD|STRING BED|ORGAN HALO|FLUTE HALO|SAW SWELL|BELL MIST|STRING BLOOM|LOW ORGAN PAD|FLUTE AURA|SAW CLOUD|BELL DRONE",
  },
  {
    id: "organs",
    waves: ["organ", "reed"],
    octave: 3,
    attack: 0.4,
    tail: 0.6,
    color: 0.98,
    names:
      "DRAWBAR SHORT|SOFT HARMONIUM|HIGH DRAWBAR|COMBO ORGAN|LOW PIPE|REED CLICK|GOSPEL ORGAN|LOW HARMONIUM|ROCK ORGAN|REED CHOIR|JAZZ DRAWBAR|BRIGHT PIPE|DIRTY DRAWBAR|REED SWELL|PIPE TICK|DRAWBAR BLOOM|PEDAL ORGAN|COMBO HIT|CATHEDRAL|REED DRONE",
  },
  {
    id: "woodwinds",
    waves: ["flute", "reed"],
    octave: 4,
    attack: 0.7,
    tail: 0.8,
    color: 0.82,
    names:
      "PICCOLO SYNTH|CLARINET SOFT|RECORDER|OBOE SYNTH|ALTO FLUTE|REED TONGUE|FLUTE LEGATO|BASSOON SYNTH|PANPIPE SYNTH|REED BREATH|FLUTE SHORT|HIGH CLARINET|BREATH FLUTE|LOW OBOE|PIPE CLICK|REED BLOOM|BASS FLUTE|SHARP REED|FLUTE CHOIR|REED WHISPER",
  },
  {
    id: "bowed",
    waves: ["bowed"],
    octave: 3,
    attack: 2,
    tail: 1.5,
    color: 0.91,
    names:
      "VIOLIN HIT|VIOLA SYNTH|HIGH VIOLIN|STRING MARCATO|CELLO SYNTH|BOW SCRATCH|VIOLA LEGATO|DOUBLE BASS|SPICCATO|VIOLIN SWELL|BOWED SHORT|HIGH HARMONIC|STRING ROSIN|CELLO SWELL|STRING TICK|VIOLA BLOOM|LOW HARMONIC|BOWED ATTACK|STRING CLOUD|CELLO DRONE",
  },
  {
    id: "mallets",
    waves: ["mallet", "bell", "pluck"],
    octave: 4,
    attack: 0.2,
    tail: 1,
    color: 0.9,
    names:
      "MARIMBA SYNTH|VIBE SYNTH|WOOD BLOCK|XYLO SYNTH|METAL BAR|LOG DRUM|SOFT MARIMBA|LOW VIBE|BAMBOO HIT|WOOD SWELL|TUBE HIT|WIRE MALLET|BRIGHT MARIMBA|VIBE CLOUD|WOOD TICK|XYLO BLOOM|LOW METAL BAR|HARD LOG DRUM|MALLET CLOUD|DARK MARIMBA",
  },
  {
    id: "guitars",
    waves: ["pluck", "saw", "pluck", "reed"],
    octave: 3,
    attack: 0.2,
    tail: 0.9,
    color: 0.86,
    names:
      "NYLON SYNTH|FUZZ PICK|STEEL SYNTH|AMPED PLUCK|JAZZ PICK|DRIVE STAB|HIGH NYLON|LOW AMP|MUTED PICK|FUZZ SWELL|STEEL HARMONIC|SUSTAIN PICK|SOFT NYLON|LOW DRIVE|DEAD PICK|AMP BLOOM|BARITONE PICK|FUZZ BITE|GUITAR CLOUD|LOW JAZZ PICK",
  },
  {
    id: "synths",
    waves: ["pulse", "saw", "sine", "bell", "organ"],
    octave: 4,
    attack: 0.65,
    tail: 0.85,
    color: 0.94,
    names:
      "PULSE SEQ|SAW SEQ|SINE SPARK|FM SPARK|ORGAN SEQ|PULSE CHIP|SAW LEGATO|LOW SINE|FM GLINT|ORGAN SWELL|PULSE COMP|SAW PLINK|SINE SING|FM CLOUD|ORGAN CLICK|PULSE BLOOM|LOW SAW|SINE SNAP|FM HALO|ORGAN DRONE",
  },
  {
    id: "textures",
    waves: ["noise", "bowed", "bell", "flute", "reed"],
    octave: 3,
    attack: 2.5,
    tail: 2,
    color: 0.68,
    names:
      "DUST TAP|ROSIN BED|GLASS THREAD|AIR THREAD|REED GRAIN|STATIC VEIL|BOWED FOG|LOW GLASS|AIR GLOW|REED FOG|TAPE HISS|STRING THREAD|GLASS GRAIN|AIR SWELL|REED TICK|SURF BED|LOW BOWED FOG|GLASS SHARD|AIR CLOUD|REED SHADOW",
  },
  {
    id: "world",
    waves: ["pluck", "flute", "reed", "mallet", "bell"],
    octave: 4,
    attack: 0.55,
    tail: 1.1,
    color: 0.8,
    names:
      "KORA SYNTH|BAMBOO FLUTE|SHENG SYNTH|KALIMBA SYNTH|GAMELAN SYNTH|OUD SYNTH|PAN FLUTE|LOW SHENG|MBIRA SYNTH|TEMPLE CHIME|SITAR SYNTH|HIGH BAMBOO|MELODICA|LOG MALLET|TEMPLE TICK|KORA BLOOM|LOW PAN FLUTE|SHENG CALL|MBIRA CLOUD|TEMPLE GONG",
  },
  {
    id: "vocals",
    waves: ["reed", "organ", "flute", "bowed"],
    octave: 3,
    attack: 1.6,
    tail: 1.4,
    color: 0.65,
    names:
      "VOX AH|VOX OO|VOX EE|CHOIR HIT|LOW VOX|VOX BREATH|CHOIR LEGATO|LOW CHOIR|VOX CALL|CHOIR SWELL|VOX SHORT|HIGH CHOIR|VOX HUM|LOW VOX SWELL|VOX TICK|CHOIR BLOOM|VOX DRONE|CHOIR ATTACK|CHOIR CLOUD|VOX WHISPER",
  },
];

export const CURATED_PRESETS: readonly VoicePreset[] = FAMILIES.flatMap(
  (family, familyIndex) =>
    family.names.split("|").map((name, i): VoicePreset => {
      const [brightness, register, attack, decay, sustain, release, noise] =
        STYLES[i];
      const wave = family.waves[i % family.waves.length];
      const isNoise = wave === "noise";
      return {
        id: `preset-${family.id}-${name.toLowerCase().replaceAll(" ", "-")}`,
        name,
        wave,
        duty: brightness * family.color,
        pitchRange: {
          octaveBase: Math.max(1, Math.min(6, family.octave + register)),
        },
        envelope: {
          attack: attack * family.attack,
          decay: decay * family.tail,
          sustain,
          release: release * family.tail,
        },
        noiseMix: isNoise ? 1 : noise * family.color,
        noiseMode: i % 3 === 0 ? "short" : "long",
        noiseRate: 2 + ((i * 7 + familyIndex * 3) % 61),
        level: isNoise
          ? 0.22
          : wave === "pulse" || wave === "saw"
            ? 0.42
            : 0.65,
        seed: 9001 + familyIndex * 100 + i,
        ...(family.id === "fx" && wave !== "noise"
          ? {
              pitchSweep: {
                endRatio: i % 2 === 0 ? 0.18 : 3.2,
                seconds: 0.12 + decay,
              },
            }
          : {}),
      };
    }),
);
