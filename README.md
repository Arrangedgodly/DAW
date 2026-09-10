# Bitbounce

[![CI](https://github.com/Arrangedgodly/DAW/actions/workflows/ci.yml/badge.svg)](https://github.com/Arrangedgodly/DAW/actions/workflows/ci.yml)

A music studio in your browser for people who don't read music. Draw beats on a
grid, shape them with live effects, and export a loop-perfect WAV for your game
— no installs, no accounts, no wrong notes. On screen, it's all one machined
console: a single page of panels, keys, and meters that reacts to the music it
plays.

**Play with it right now: <https://bitbounce-d2d.pages.dev/>**

## Why you'd want it

Bitbounce fuses two ideas that usually live far apart:

- **1BITDRAGON-style grid sequencing** — four lanes (drums, bass, chords,
  lead), each grid locked to a scale so every cell you tap is in key. Music
  theory is optional; it is never required.
- **An Ableton-style effects workflow** — every lane carries its own chain of
  filter, drive, delay, and reverb devices you can add, reorder, and tweak
  while the loop plays.

It's built for game developers and anyone who wants a tight loop in minutes
instead of an afternoon: draw a pattern, chain a few sections — each lane can
run its own length, so a two-bar beat can cycle under an eight-bar chord
progression — and export a WAV that loops with an invisible seam, or a MIDI
file that opens in any DAW. Everything runs locally; nothing you make leaves
your machine unless you export it.

## Make your first loop

1. **Press PLAY.** First run loads the WELCOME SONG demo — a POLY-LOOP
   arrangement where the lanes cycle at their own lengths (chords every 8
   bars while drums, bass, and lead run 4) and weave out of sync and back —
   everything you hear is editable, so poke at it.
2. **Draw notes.** Click a cell to place one; click and drag to stretch a
   note across steps; grab its right edge (or press `+` / `-`) to resize. On
   the drums lane, dragging paints hits. Each pitched lane shows one octave
   of its scale at a time: scroll the window with `Shift+↑` / `Shift+↓` to
   reach the rest, and transpose the whole lane by octaves with `o` /
   `Shift+o` — up to three either way, heard live and written into exports.
3. **Switch lanes.** The stage is a 2×2 grid of lane quadrants: one quadrant
   is your editing lane, the other three stay visible and playing in their
   own colors. Click a quadrant — or press `]` / `[` — to edit another lane.
4. **Arrange.** Each lane has a pattern rail. `+` appends a new blank
   pattern (next letter: A, B, C…); `d` duplicates the current one — the
   only duplication path. Grow a pattern with the LENGTH ladder `b` /
   `Shift+b` anywhere from 1 to 128 bars; a shrink that would cut notes is
   refused and tells you which note blocks it. Each lane loops its own
   chain, so lengths can drift apart — press `p` any time to hear where you
   are (`POSITION BAR 5 OF 8 · CHORDS BAR 1 OF 8`). Then drag across the
   rail during playback to cue several lanes into their next section
   together, quantized to the beat.
5. **Shape the sound.** Step through each lane's presets, open its FX
   console, and set the mix — volume, mute, and solo per lane.
6. **Export.** EXPORT WAV hands you a sample-exact render of exactly one
   full cycle of your arrangement — however long your lanes are, their
   least-common multiple, with effect tails folded into the start so the
   seam is silent. EXPORT MIDI writes a Type-1 file — one track per lane,
   drums on General MIDI channel 10 — spanning that same cycle, and it
   opens anywhere.

> [!TIP]
> Stuck on anything? **KEYS ?** shows every shortcut. **INFO ?** turns on
> help mode: hover (or tap, on touch) any control and it explains itself —
> Ableton info-view style.

## Feature tour

**Desktop — the whole studio is one page.**

- 2×2 lane quadrants, all four lanes visible and playing, editable one at a
  time; the stage fills the viewport — one page at 1280×800 and 1440×900,
  and wider screens get denser grids, not empty margins.
- Equal register windows: every pitched lane edits a one-octave window of
  its scale (scroll with `Shift+↑` / `Shift+↓`) and carries its own OCTAVE
  transpose, ±3 — audible the moment you press it and reflected in WAV and
  MIDI exports.
- Sustained notes: drag to create, resize by the edge or keyboard; drums
  drag-paint.
- Pattern rail with per-lane chains: blank `+` appends the next pattern
  letter, DUP is the only duplication path, lengths run powers of two from
  1 to 128 bars, shrinks that would lose notes are refused by default,
  switching is quantized with pending indication, and one gesture cues
  several lanes at once.
- Poly-loop transport: each lane loops its own cycle length with its own
  playhead sweep; the song cycle is the lanes' least-common multiple,
  tracked by the bar readout and announced by `p`.
- Per-lane mix (volume / mute / solo) — WAV exports honor it; MIDI exports
  every note regardless.
- 42 pitched presets — chiptune staples plus Karplus–Strong plucked strings —
  and 14 drum kits, four of them built from recorded CC0 one-shot samples
  (808 CLASSIC, ACOUSTIC, DUSTY TAPE, TIGHT PUNCH).
- Per-lane FX consoles: filter, drive, synced delay, reverb — reorderable and
  bypassable per device.
- Euclidean fill for drum rows: dial in pulses and rotation, preview, commit,
  then hand-edit.
- Autosave to IndexedDB as you work, plus versioned `.bitbounce.json` project
  files (SAVE FILE / OPEN FILE) for backup and sharing. Undo for 50 steps.

**It reads like a machine.** The console reacts to the track instead of
sitting still: cells glow as the playhead crosses them, each beat pulses the
sounding lane's rim and name LED, and the lit rail tile is the pattern slot
sounding right now — it walks the chain as the song plays. Each FX device
carries a recessed meter that reads back its defining parameter (cutoff,
drive, feedback, …) and dims to an idle register when bypassed; mute, solo,
and bypass are switches that physically throw in milled slots. A faint sheen
breathes across the desktop chassis — slower at standby, quicker in playback
— carrying no information, and every animation yields to
`prefers-reduced-motion`.

**Mobile — the same studio at phone width.** Lane tabs replace the
quadrants, and every editing gesture works by touch: tap, drag-create,
edge-resize, rail sweep, mix sliders, exports. Android Chrome is the
supported target; iOS Safari is best-effort and the app says so honestly
with a banner.

**Experimental: VIZ.** The booth's VIZ toggle (key `v`) swaps the console
for a full-screen, MIDI-driven light show — newly merged, still being tuned,
and not yet part of the polished tour above.

**Keyboard-first.** Every action has a keyboard path — grid navigation, note
resizing, register scrolling, octave transpose, lane switching, cueing,
exports, help. A starter set:

| Keys             | Action                                             |
| ---------------- | -------------------------------------------------- |
| Space            | play / stop (outside the grid)                     |
| Arrows           | move the focused cell                              |
| Enter / Space    | toggle the focused cell (inside a grid)            |
| `Shift+↑` / `↓`  | scroll the lane's note window one octave           |
| `]` / `[`        | edit the next / previous lane                      |
| `+` / `-`        | resize the focused note                            |
| `o` / `Shift+o`  | transpose the lane ±1 octave                       |
| `b` / `Shift+b`  | grow / shrink the pattern (1–128 bars)             |
| `p`              | announce the position (song cycle · lane cycle)    |
| Ctrl/⌘ Z         | undo (add Shift to redo)                           |
| `?`              | the complete keyboard map                          |

The in-app KEYS overlay is the always-current map — this table is just the
escape hatch.

## Exports

| Format | What you get                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WAV    | 16-bit stereo 44.1 kHz — renders exactly one full cycle of your arrangement (the least-common multiple of the lane lengths), sample-exact, effect tails folded into the loop start, per-lane mix applied. Drop it straight into a game engine. |
| MIDI   | Type-1 SMF — tempo track plus one track per lane, drums on GM channel 10, instrument program hints; spans that same cycle, each lane's patterns repeating at their own length inside it. Every note exports, mute and solo notwithstanding. |

## Privacy: local-first, forever

Bitbounce never calls a third party while you use it — the
Content-Security-Policy forbids it (`connect-src 'self'`: the only network is
fetching Bitbounce's own bundled sound files, and even that is optional and
lazy). No accounts, no analytics, no cloud. Projects live in your browser's
IndexedDB and leave only as files you explicitly export. The full stance:
[docs/dev/privacy.md](docs/dev/privacy.md).

**Browsers:** desktop Chromium (Chrome, Edge) is the target; Firefox is
best-effort; Safari gets a warn-and-attempt banner. Mobile: Android Chrome.

## Licensing

- **Bundled audio** — the 33 one-shot samples behind the four sample-backed
  drum kits are public domain (CC0), with per-file provenance recorded and
  test-enforced in [PROVENANCE.md](PROVENANCE.md). Use them in your games,
  royalty-free, no attribution needed.
- **Project code** — no license has been declared for Bitbounce's own source
  yet, so the default (all rights reserved) applies until one is chosen.

## Run it locally

Node.js 22+ and npm.

```bash
git clone https://github.com/Arrangedgodly/DAW.git bitbounce
cd bitbounce
npm install
npm run dev
```

Open the printed localhost URL. Other handy scripts:

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm run build`        | type-check + production build to `dist/`  |
| `npm test`             | unit suite (1,726 tests)                  |
| `npm run test:browser` | browser suite against the built app (204) |
| `npm run lint`         | ESLint                                    |
| `npm run typecheck`    | TypeScript, no emit                       |

Bug reports and pull requests are welcome on
[GitHub](https://github.com/Arrangedgodly/DAW). Developer docs — keyboard
spec, accessibility audit, performance budgets, content rules — live in
[docs/dev/](docs/dev/).

## Principles

1. **No wrong notes** — the grid makes musical correctness the default.
2. **Constraint is the charm** — four lanes, four devices, one screen.
3. **Sound design is play** — tweak the FX while the loop runs and hear
   every change land.
4. **Loop-perfect or it didn't happen** — exports are sample-exact; seams are
   bugs.
5. **Local-first forever** — nothing leaves your device unless you export it.
