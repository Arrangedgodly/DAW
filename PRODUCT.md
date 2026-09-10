# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: final framework and library choices are deferred to the Ultron deep-research
phase (user decision, recorded 2026-09-01). Confirmed bias: TypeScript + Vite-based,
minimal dependencies, static hosting, local-first with no backend ever (v0/v1).

## Users

1. **The builder (primary)** — the developer of this tool, using it as a personal
   instrument, dogfooded from day 1 on a desktop Chromium browser.
2. **Game developers / non-musicians (public slice, v1)** — people who want
   loop-perfect, royalty-free music for games without music-theory knowledge, 1BITDRAGON's
   audience.
3. **Peers / reviewers (portfolio slice)** — engineers and designers evaluating the app
   as evidence of web-audio and application-architecture craft.

## Product Purpose

A browser-based DAW that fuses 1BITDRAGON's playful, no-theory grid sequencing with
Ableton's device/FX-chain sound-design workflow. Success anchor: the builder scores a
real game or game-jam entry end-to-end using a v0 export (loop-tight WAV into a game
engine). Secondary success: a first-run visitor alters a demo song into a likeable loop
within five minutes.

## Positioning

The only browser-native tool that combines scale-locked "no wrong notes" grid
sequencing (1BITDRAGON mechanic) with live per-lane FX chains (Ableton mechanic), runs
entirely local with zero setup or accounts, and exports sample-exact loop-perfect WAV
plus per-lane MIDI. Neighboring products offer either heavyweight DAWs or toy
sequencers — not both mechanics fused, and not with game-dev-grade exports.

## Operating Context

- Single-user desktop use; pointer + keyboard; Chromium-first, Firefox best-effort,
  Safari deferred to v1 (warn-and-attempt banner).
- Projects live in IndexedDB with autosave; explicit versioned-JSON project files for
  backup/sharing. Zero network calls at runtime.
- Exports flow into game engines (WAV, loop-tight) and other DAWs (Type-1 MIDI, GM
  drum channel 10).
- Audio starts only after a user gesture (play click); background-tab playback must
  survive via AudioContext-time scheduling.

## Capabilities and Constraints

Confirmed v0 scope (approved brief, `docs/ultron/town-hall.md`):

- One screen; transport (play/stop, loop, BPM 60–200, swing, metronome, master
  volume); 4 fixed lanes: Drums, Bass, Chords, Lead.
- Scale system: project-wide key/scale default + optional per-lane override; pitched
  grids show only scale-degree rows; chords lane shows diatonic chord rows; drums
  exempt.
- Multiple patterns per lane (1/2/4 bars, 16th resolution); drums = step grid;
  pitched = scale rows; toggle cells; per-lane gate/note length.
- Song arrangement = linear pattern chain per lane; quantized live pattern switching
  with pending indication.
- Synth-only sound engine (Web Audio), chiptune-leaning presets: ≥6 per pitched lane,
  4–6 drum kits. Architecture reserves a voice-type slot for future samples.
- Per-lane FX chains: Filter, Bitcrusher/Drive, Synced Delay, Reverb — reorderable,
  per-device bypass; params global per lane; no automation.
- Euclidean fill tool for drum rows (paint-into-grid, not live).
- Audition on cell placement/click; no live performance keyboard or recording.
- Undo/redo (~50 steps); demo song preloaded on first run.

In-flight on branch `visualizer` (approved brief `docs/ultron/town-hall.md`, 2026-09-04;
scoping defaults recorded by the coordinator after the user went unattended mid-run —
labeled inferred, correctable at delivery):

- VIZ second surface: full-screen MIDI-driven visual instrument; every audible note-on
  fires the active preset's generative reactions (lane hue, pitch, intensity shape them);
  audio engine and FX chains untouched by visuals.
- Built-in visual preset library (~8–12); user cycles presets and rerolls the current
  preset's node arrangement with seeded randomness (reproducible); no preset save/share,
  no node editor, no audio-analysis input in v1.
- Last preset + seed remembered in lightweight local state only — never in the project
  document schema.

Explicit v0 non-goals: samples, flexible tracks, arrangement timeline, session-clip
launcher, master FX chain, automation, live performance/recording, arpeggiator, live
Euclidean mode, stems export, mobile/touch, accounts/cloud/collab/backend, plugin SDK,
non-4/4 time signatures, Safari hardening.

Performance/quality constraints: notes within ±2 ms of musical time; WAV length
sample-exact and loop-tight; 60 fps with 4 lanes ≥16 voices + full FX chains on
low-end hardware; initial bundle ≤ ~300 KB gz, no audio assets; projects save/load
losslessly through a versioned schema with strict validation (no code execution from
file contents).

## Brand Commitments

- Product name: **Bitbounce** (user-chosen 2026-09-01 in the design phase).
- Binding inspiration references: 1BITDRAGON (playful grid, no-theory workflow, retro
  1-bit spirit) and Ableton (device-chain flow). The user named both as the soul of
  the product.
- Chiptune-leaning synth character (pulse/square/triangle/noise-family timbres) is a
  binding sound-design commitment for v0.
- Binding visual mandate (user, 2026-09-04): upgrade the site UI toward a hardware
  feel — "like you just got access to a $5000 hardware DAW unit, like a standalone
  Akai unit" — alive, breathing, responding to the user's inputs and the track as
  they build it. Recorded without expansion; visual/interaction layer only, the
  audio engine contract unchanged. (Carried from the hardware-ui worktree's
  uncommitted PRODUCT.md; the Machined Console redesign shipped it.)

## Evidence on Hand

- Approved scoping brief: `docs/ultron/town-hall.md` (2026-09-01, all 10 hero lanes
  signed off). The authoritative product record behind this file. On the `visualizer`
  branch checkout, that path holds the 2026-09-04 visualizer brief (gitignored artifact
  directory; the 2026-09-01 original lives in the main checkout).
- No shipped assets yet: demo song, presets, and drum kits are to be created during
  production. No testimonials, usage data, or press exist — future work must not
  fabricate them.

## Product Principles

1. **No wrong notes.** The grid makes musical correctness the default; theory is
   optional, never required.
2. **Constraint is the charm.** 4 lanes, 4 devices, one screen — small surface, deep
   play.
3. **Sound design is play.** FX chains are tweakable live while the loop runs; hearing
   beats configuring.
4. **Loop-perfect or it didn't happen.** Exports are sample-exact; seams are bugs.
5. **Local-first forever.** Zero network at runtime; projects never leave the device
   except as files the user exports.

## Accessibility & Inclusion

Confirmed product-level requirements: grid editing fully keyboard-operable (arrows +
toggles, lane navigation), ARIA grid semantics with beat announcements, focus
management on mode switches, reduced-motion support for playhead/pulse animation, and
a palette that passes contrast checks using shape/pattern coding (not color alone).
