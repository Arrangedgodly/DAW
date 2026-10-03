# Sound library

The picker offers 836 pitched presets in 18 categories and 80 drum kits with
16 slots each. Every pitched track can select every pitched preset.

| Category        | Presets |
| --------------- | ------: |
| Bass            |      66 |
| Bells           |      48 |
| Bowed strings   |      40 |
| Brass           |      48 |
| Chords          |      60 |
| Guitars         |      40 |
| Keys            |      42 |
| Leads           |      68 |
| Mallets         |      40 |
| Organs          |      40 |
| Pads            |      52 |
| Plucked strings |      44 |
| Sound effects   |      48 |
| Synth vocals    |      40 |
| Synths          |      40 |
| Textures        |      40 |
| Woodwinds       |      40 |
| World           |      40 |

## Sources and sound design

`curatedPresets.ts` contains the first bank of 360 synthesized presets.
`additionalPresets.ts` adds a second bank of 418 presets with its own playing
styles, names, timbre settings and envelope shapes. The second bank doubles
every category exactly, including the categories that already had more than
twenty choices. Existing sounds keep their IDs and parameters. The tonal engines are
sine, saw, additive organ, reed, flute, bowed and inharmonic mallet. Instrument
names describe synthesized interpretations, including choir and world sounds.
They are not recordings of those instruments. The existing six pitched sample
presets and all existing content assets remain in the library.

`drumCharacters.ts` gives each kit explicit tuning, decay, noise grain, body,
metal and brightness settings. The extra percussion uses these settings rather
than a small seed-derived variation of the same shared recipes. Six new kits
are Electro Grid, Deep Sub Room, Factory Floor, Wood & Skin, Glass Machine and
Minimal Clicks. The second expansion adds Warehouse, Tape Club, Digital Snap,
Rattle Box, Round House, Wire Room, Circuit Break, Velvet Room, Copper Hits,
Subway, Carbon Punch, Neon Drive, Sand Room, Hollow Body, Spark Kit, Rust Machine,
Bamboo Room, Ceramic Hits, Vacuum Step and Orbit Room. Each has sixteen slots
and an explicit character profile. Their primary drum bodies vary as well as
their added percussion; the original twenty kits are unchanged.

`nextDrumBank.ts` adds forty more synthesized kits, bringing the total to eighty.
This drum-only expansion leaves all 836 pitched presets intact. Added kits
include Break Room, Dry Funk, Halftime, Jungle Wire, Synth Jazz, Porcelain,
Steel Ring, Laser Grid, Cold Storage, Satellite, Solar Punch and Frost Byte.
Each design supplies its own tuning, decay, noise grain, body and metallic
voice profile. All forty existing kits retain every slot and parameter.

The 808 kit now uses its three bundled alternate kick/snare/hat recordings.
It has nine recorded slots and seven synthesized slots. Acoustic, Dusty Tape
and Tight Punch each have six recorded slots and ten synthesized slots. The
other seventy-six kits are synthesized. Added slots are not advertised as new
recordings. Existing kit IDs, pitched preset IDs and the original six drum
slots are preserved. The first expansion intentionally changed the extra drum slots. The second
expansion adds kits without changing any existing slot.

## Verification and maintenance

- `tests/library-expansion.test.ts` enforces exactly doubled counts in all
  eighteen categories, 836 total presets, unique names and recipes, eighty complete kits, and
  no repeated extra drum recipes across kits. Identity, level and random seed
  do not qualify as recipe differences. A SHA-256 fixture captured before the
  eighty-kit expansion verifies that all forty prior kit records are unchanged.
- `tests/browser/preset-library.test.ts` renders every pitched preset and
  all 1,280 drum slots through the real worklet or native sample host. It checks
  non-silence, finite output, peak bounds and audio fingerprints using a fixed
  pitch, excitation seed and four-second comparison window. Pitched fingerprints
  are unique within each category; drum fingerprints are unique within each
  kit and across all extra slots.
- `tests/browser/sample-voice.test.tsx` checks real sample loading, decoding,
  audition, provenance, failure feedback and offline project rendering.
- `tests/worklet-parity.test.ts` checks the extended tonal DSP against its
  worklet twin at low, middle and high frequencies.
- Every new preset has a GM family hint for MIDI export. MIDI hints describe
  an approximate family; MIDI cannot carry the custom synthesized timbre.
- `tests/session-audition.test.ts` checks that a preview loads only the clicked
  drum sample and that a selection change during decoding discards the stale
  preview. Selection still preloads the full kit for transport playback.

These checks detect broken playback and exact duplicates. They do not prove
that every sound is musically useful or that two different fingerprints sound
sufficiently different to a listener. Listening and curation remain necessary
when replacing or adding sound designs. No newly downloaded sample pack is
part of this expansion.
