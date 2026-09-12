# Product

## Mobile grid navigation

Touch grids have Back and Forward controls with a visible step range. Draw mode keeps tap-to-place and quick drag-to-lengthen; holding for 320 milliseconds switches that touch to horizontal panning without editing notes. Scroll mode pans immediately and does not edit on touch. Vertical swipes retain native scrolling. Navigation changes only the view, and the controls support drum and pitched tracks, including optional instruments.

## Instrument library and optional tracks

The preset name is a native dropdown with sound-family groups. Minus and plus remain available for stepping, and both paths preview the selected sound. All pitched tracks share 58 presets, including 16 new synthesized bell, brass, keys, plucked-string, pad and sound-effect sounds. The drum track retains its 14 kits.

Desktop opens with Instruments 1–4 and Instruments 5–8 tabs, followed by Song arrangement. Users can add up to four independent pitched tracks, for eight tracks total. Each extra track has its own notes, preset, octave, scale override, mix and effects. The Instruments page is a second four-quadrant editor, using the same grid component and sizing as Edit notes. Each empty quadrant adds its own fixed track slot when clicked; populated quadrants select and edit in place. Phones edit one track at a time, selected from the default row and a second row of added instrument tabs in the header. Add new instrument fills up to four extra lanes. A single SONG/NOTES button switches between editing and arrangement while retaining the selected track. Song arrangement includes every active track. Adding and removing tracks is undoable, and optional lane data persists in project files and autosaves. WAV and MIDI exports include all active tracks. Existing four-track projects remain valid without adding empty slots to their files.

The visualizer continues to represent the four default tracks. Extra tracks contribute to audio playback and exports but do not yet have visualizer layers. Bell and brass voices are synthesized approximations rather than acoustic recordings. These capabilities supersede the original fixed-four-lane scope below.

## Track appearance preferences

Each instrument has 30 predefined color swatches: light, middle and dark shades of red, orange, yellow, green, cyan, blue, purple, pink, brown and gray. The same color control appears in the DAW's selected-track controls and visualizer inspector. A selection updates the track and its visualizer geometry live without restarting playback. Use theme default clears the individual override.

Colors persist locally under `bitbounce.track-colors.v1`, separate from project files, musical undo and exports. Valid previously saved custom hex colors remain readable, but the interface offers only swatches. Note text chooses black or white for custom fills. The Membrane prototype shares this preference; the selected Membrane design is now implemented in the DAW.

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Current implementation uses SolidJS, TypeScript and Vite. Confirmed bias:
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

Visualizer composition (user-approved option B and advanced motion controls, 2026-09-12):

- VIZ is a local MIDI-driven composition editor. Each of Drums, Bass, Chords and
  Lead owns one of 24 selectable geometric effects, scale and seeded variation.
- Permanent motion choices are Fluid folds, Flowing trails and Orbit. Fluid folds
  with Blended composition is the default. Blended overlaps the instruments;
  Distinct separates their moving centers. Orbit instead uses each lane's
  0-100% orbit strength around one shared center. Scale is independent (35-130%).
- Four instrument tabs select one inspector. Manual placement handles and the
  position map are retired. Hide controls removes motion controls, the inspector
  and orbit guide. On phones the inspector scrolls below the canvas.
- Reroll changes effects, geometric variations and starting angles while retaining
  motion, blending, scale and orbit strength. These settings persist in
  `bitbounce.viz.composition.v2`, outside project saves and undo. Legacy local
  compositions acquire Fluid folds + Blended without losing their lane effects.
- Actual audible MIDI gate and release durations drive lane-local phrasing:
  explosive drum transients, held bass/lead/chords, then full disappearance.
  Silent, muted, zero-volume and non-soloed lanes draw no artwork. Reduced motion
  omits artwork and uses bounded textual summaries. No simulated notes or changes
  to audio scheduling, sound generation or the project schema.
- No visual preset sharing, node-graph editor, recording, streaming, or video export.

Explicit v0 non-goals: samples, flexible tracks, arrangement timeline, session-clip
launcher, master FX chain, automation, live performance/recording, arpeggiator, live
Euclidean mode, stems export, accounts/cloud/collab/backend, plugin SDK,
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
- Approved visual direction, 2026-09-12: Membrane from prototype A with C's note-button glow. One continuous four-panel desktop surface, quiet controls and the existing single-lane phone flow. Moving background sheen is rejected. The supplied logo, Barlow wordmark and local favicon remain. Full editor, song, effects and VIZ control styling use the new treatment; audio-engine behavior is unchanged.

- Theme is a device preference stored in `bitbounce.theme.v1`, separate from
  project documents, undo and export. The shared Booth exposes the theme switch.


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

Visualizer phrasing refinement: MIDI observers carry the compiled note hold and release durations without altering audio scheduling. Drums use a sharp outward impulse and rapid decay; bass punches and holds, while lead and chords stretch and evolve through their MIDI gates, then release. Up to 16 overlapping notes per lane preserve long sustains beneath short retriggers. Energy drives deformation and motion speed across all 24 effects without adding geometry or rendering passes. Stop clears the active envelopes; reduced motion omits artwork and retains textual activity summaries. The VIZ DPR cap is now 0.75 and passing VZ-TH-4 closes the previously recorded dense-playback performance limitation.

Silence is part of the visual composition: lane artwork exists only during a note and its brief release. Releases fade to full transparency and then skip drawing entirely. Instrument tabs remain available to edit silent lanes; Hide controls leaves only sounding artwork. Muted lanes, zero-volume lanes, and lanes excluded by Solo are hidden immediately. Unmuting waits for the next note instead of replaying a hidden hit.

## Arrangement pages and playback follow

EDIT and SONG are separate pages on desktop, tablet and phone. EDIT keeps the note grids and their register/scroll state mounted while SONG shows all four instrument chains as horizontal strips. The SONG button in the desktop booth or phone transport switches pages and returns the page scroll to the top.

Playback follows chain-slot identity, including consecutive slots that reference the same pattern. The sounding tile, editing selection and lane LOOP/NEXT footer identify the same slot at audible audio time. While stopped, the footer targets the user's selected slot. Page changes and visualizer entry do not interrupt audio. These controls remain view state outside the saved project schema; existing chain modes keep their current persistence and undo behavior.

## Register navigation and phone editing

The approved phone workflow uses a single instrument stage, sticky playback controls
and touch editing. This supersedes the original v0 mobile/touch exclusion; it does
not expand the audio or recording scope.

Pitched grids browse scale notes throughout MIDI 0 through 127. Higher notes appear
above lower notes. OCT view navigation moves by twelve semitones and SEMI by one,
with real pitch boundaries. View movement, scroll and zoom preserve note identity
and do not transpose sound, change saved project data or add undo entries. The
sound-transpose control remains a separate musical edit.

The editable pitch domain is independent of a pattern's historical row list. Notes
can use negative and high scale degrees within the schema's -128 through 128 safe
envelope; placement also rejects resolved pitches outside MIDI range. Valid newly
reached notes must survive project round trips, compilation and MIDI/WAV export.

Phone grids retain complete scale-octave rows and a 44px base row floor. Height
fitting bounds available space by the viewport and reserves the following footer;
short screens scroll when needed. Theme spacing and header density must preserve
this behavior. These are product requirements; this record does not assert that
release or regression verification is complete.

## Historical hybrid performance console closeout

Approved and implemented: supplied Bitbounce logo, Barlow wordmark and local favicon;
Barlow 700 instrument names at 23px, wordmark at 25px desktop / 19px phone;
Segoe UI utility controls; IBM Plex Mono for inset musical, transport and register
displays. Bundled Silkscreen, Departure Mono, VT323 and Press Start 2P remain
legacy base/fallback roles documented in DESIGN.md. Functional controls use 3px
radii and inset transport/status windows use 4px. Dark Vector is luminous and
light Alloy polished silver. One top-edge LaneMeter line per lane follows audible
note activity; there is no redundant decorative header animation.

Theme preference persists in `bitbounce.theme.v1`, outside musical documents.
Pitch rows descend from high to low, show only scale notes across MIDI 0 through
127, and browse by +/-1 or +/-12 semitones without transposing stored music.
Vertical virtualization preserves the full semantic pitch range while materializing
only the seated octave. Hidden phone grid scrollbars preserve complete seven-row
heptatonic windows and the footer while touch panning remains available.

VIZ retains its 24 effects, motion controls and separate composition preferences.
Its backing-store DPR cap is 0.75. Passing VZ-TH-4 closes the prior dense-frame
performance limitation. Historical measurements remain in docs/dev/perf-budget.md.

Closeout verification, 2026-09-12: finish review returned ship with no material interface defect. Parent-task results: typecheck, lint, 89 unit files / 1772 tests, 21 fuzz tests, production build, pitch-direction, isolated target-size, focused accessibility/VIZ/happy-path pack, LP1 5/5, and full frame-budget 12/12 in 178.49 seconds. These are recorded completed results, not reruns by the documentation pass. No commit, push or deployment is claimed.

## Membrane implementation and mobile autosave

Membrane is implemented in the full DAW. Track swatches carry to VIZ live. On phones, autosave status is displayed once in a fixed bottom-center strip, with full readable text and reserved layout space. Projects and theme remain in the top transport. The phone color control sits beside the instrument title. VIZ hides the phone autosave strip. Styling, layout fitting and appearance preferences do not change song data or audio scheduling. Current verification is recorded in docs/dev/membrane-review/verification.md.

Built-in demos are available under Projects. Welcome Song remains the unchanged first-run song. Glass Arcade and After Hours are eight-bar, eight-lane arrangements that demonstrate named presets, independent extra tracks, section cues and per-lane effects. Each demo opens as a temporary preview, including the first-run Welcome Song. Playback, navigation and appearance changes do not create a saved project. The first document edit creates a local copy and enables normal autosave; switching away from an untouched demo leaves no copy. The indicator reads Built-in demo until editing begins. Existing saved projects are preserved.
