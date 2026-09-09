# Bitbounce

[![CI](https://github.com/Arrangedgodly/DAW/actions/workflows/ci.yml/badge.svg)](https://github.com/Arrangedgodly/DAW/actions/workflows/ci.yml)

A music studio in your browser for people who don't read music. Draw beats on a
grid, shape them with live effects, and export a loop-perfect WAV for your game
— no installs, no accounts, no wrong notes.

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
instead of an afternoon: draw a pattern, chain a few sections, export a WAV
that loops with an invisible seam — or a MIDI file that opens in any DAW.
Everything runs locally; nothing you make leaves your machine unless you
export it.

## Make your first loop

1. **Press PLAY.** First run loads the WELCOME SONG demo — everything you
   hear is editable, so poke at it.
2. **Draw notes.** Click a cell to place one; click and drag to stretch a
   note across steps; grab its right edge (or press `+` / `-`) to resize. On
   the drums lane, dragging paints hits.
3. **Switch lanes.** The stage is a 2×2 grid of lane quadrants: one quadrant
   is your editing lane, the other three stay visible and playing in their
   own colors. Click a quadrant — or press `]` / `[` — to edit another lane.
4. **Arrange.** Each lane has a pattern rail. Duplicate a pattern (`d`),
   chain sections with `+`, then drag across the rail during playback to cue
   several lanes into their next section together, quantized to the beat.
5. **Shape the sound.** Step through each lane's presets, open its FX
   console, and set the mix — volume, mute, and solo per lane.
6. **Export.** EXPORT WAV hands you a sample-exact loop (effect tails are
   folded into the loop start, so the seam is silent). EXPORT MIDI writes a
   Type-1 file — one track per lane, drums on General MIDI channel 10 — that
   opens anywhere.

> [!TIP]
> Stuck on anything? **KEYS ?** shows every shortcut. **INFO ?** turns on
> help mode: hover (or tap, on touch) any control and it explains itself —
> Ableton info-view style.

## Feature tour

**Desktop — the whole studio is one page.**

- 2×2 lane quadrants, all four lanes visible and playing, editable one at a
  time; fits a single page from 1280×800 up.
- Sustained notes: drag to create, resize by the edge or keyboard; drums
  drag-paint.
- Pattern rail with per-lane pattern chains, quantized switching with pending
  indication, and one-gesture multi-lane cueing.
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

**Mobile — the same studio at phone width.** Lane tabs replace the
quadrants, and every editing gesture works by touch: tap, drag-create,
edge-resize, rail sweep, mix sliders, exports. Android Chrome is the
supported target; iOS Safari is best-effort and the app says so honestly
with a banner.

**VIZ — the light show.** Press `v` (or the booth VIZ toggle) while the loop
plays and the whole screen becomes a full-bleed, MIDI-driven light rig: every
note lands as lane-hued light the instant you hear it, and the stage brightens
as the groove fills. Three controls on a small remote, and that's all there
is:

- **PRESET** — step through the 10 built-in looks (First Light, Orrery, Comet
  Run, …).
- **REROLL** — re-hang the current preset's light rig live, into a fresh
  arrangement.
- **EXIT** — back to the studio (Escape and `v` work too).

The music never stops: entering, switching, or leaving VIZ never touches the
transport or the audio. With reduced motion preferred, the show swaps to
static light marks instead of animation. VIZ wants room — on a phone it
politely says the light show runs on a larger screen.

**Keyboard-first.** Every action has a keyboard path — grid navigation, note
resizing, lane switching, cueing, exports, help. A starter set:

| Keys          | Action                                  |
| ------------- | --------------------------------------- |
| Space         | play / stop (outside the grid)          |
| Arrows        | move the focused cell                   |
| Enter / Space | toggle the focused cell (inside a grid) |
| `]` / `[`     | edit the next / previous lane           |
| `+` / `-`     | resize the focused note                 |
| Ctrl/⌘ Z      | undo (add Shift to redo)                |
| `v`           | the VIZ light show (open or exit)         |
| `?`           | the complete keyboard map               |

The in-app KEYS overlay is the always-current map — this table is just the
escape hatch.

## Exports

| Format | What you get                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WAV    | 16-bit stereo 44.1 kHz, sample-exact loop length, effect tails folded into the loop start, per-lane mix applied. Drop it straight into a game engine.  |
| MIDI   | Type-1 SMF — tempo track plus one track per lane, drums on GM channel 10, instrument program hints. Every note exports, mute and solo notwithstanding. |

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
| `npm test`             | unit suite (1,127 tests)                  |
| `npm run test:browser` | browser suite against the built app (128) |
| `npm run lint`         | ESLint                                    |
| `npm run typecheck`    | TypeScript, no emit                       |

Bug reports and pull requests are welcome on
[GitHub](https://github.com/Arrangedgodly/DAW). Developer docs — keyboard
spec, accessibility audit, performance budgets, content rules — live in
[docs/dev/](docs/dev/).

## Principles

1. **No wrong notes** — the grid makes musical correctness the default.
2. **Constraint is the charm** — four lanes, four devices, one screen.
3. **Sound design is play** — tweak the FX while it runs; hearing beats
   configuring.
4. **Loop-perfect or it didn't happen** — exports are sample-exact; seams are
   bugs.
5. **Local-first forever** — nothing leaves your device unless you export it.
