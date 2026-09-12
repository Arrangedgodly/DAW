---
name: Bitbounce
description: Vector dark and Alloy light, a compact four-instrument sequencer with clear controls and scale-locked pitch grids.
colors:
  vector-ground: "#0c0c10"
  vector-ink: "#f4f5fa"
  vector-ink-on-fill: "#0c0c10"
  vector-panel: "#15151d"
  vector-raised: "#25252f"
  vector-recess: "#0d0d13"
  vector-line: "#393944"
  vector-muted: "#b8b8c9"
  vector-accent: "#c7b4ff"
  vector-drums: "#ff7893"
  vector-bass: "#e3ef88"
  vector-chords: "#70ded0"
  vector-lead: "#ba9aff"
  alloy-ground: "#dfe5ed"
  alloy-ink: "#182638"
  alloy-ink-on-fill: "#ffffff"
  alloy-panel: "#f6f8fb"
  alloy-raised: "#e5ebf2"
  alloy-recess: "#edf1f6"
  alloy-line: "#bac7d6"
  alloy-muted: "#506078"
  alloy-accent: "#4f48bd"
  alloy-drums: "#bb3055"
  alloy-bass: "#886000"
  alloy-chords: "#007967"
  alloy-lead: "#4f48bd"
  vector-brand-cyan: "#62dff9"
  vector-brand-violet: "#bc9cff"
  vector-display-ground: "#080d18"
  vector-display-ink: "#b4f0ff"
  vector-display-edge: "#394553"
  alloy-brand-cyan: "#007d97"
  alloy-brand-violet: "#6841c4"
  alloy-display-ground: "#e0e9f0"
  alloy-display-ink: "#123c51"
  alloy-display-edge: "#a4b6c6"
typography:
  musical-display:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "23px"
    fontWeight: 500
  wordmark:
    fontFamily: "Barlow, Segoe UI, sans-serif"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  instrument:
    fontFamily: "Barlow, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  panel-label:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.025em"
  panel-label-sm:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
  value:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  panel: "3px"
  display: "4px"
  note: "2px"
  cell: "1px"
spacing:
  compact: "4px"
  control: "6px"
  small: "8px"
  panel: "12px"
components:
  vector-panel:
    backgroundColor: "{colors.vector-panel}"
    textColor: "{colors.vector-ink}"
    rounded: "{rounded.panel}"
    padding: "12px"
  alloy-panel:
    backgroundColor: "{colors.alloy-panel}"
    textColor: "{colors.alloy-ink}"
    rounded: "{rounded.panel}"
    padding: "12px"
  vector-theme-button:
    backgroundColor: "{colors.vector-raised}"
    textColor: "{colors.vector-ink}"
    rounded: "{rounded.panel}"
    padding: "5px 9px"
  alloy-theme-button:
    backgroundColor: "{colors.alloy-raised}"
    textColor: "{colors.alloy-ink}"
    rounded: "{rounded.panel}"
    padding: "5px 9px"
---

# Design System: Bitbounce

## Overview

The approved visual direction combines prototype B Vector for dark mode and prototype C Alloy for light mode. The approved hybrid performance console adds the supplied Bitbounce emblem and wordmark, inset musical displays and one audible signal line per instrument. Dark Vector is luminous; light Alloy reads as polished silver.

This refresh supersedes the Machined Console material and typography prescriptions. The implementation source is `src/styles/themes.css`, layered after the base tokens and component styles. Crisp inset displays and note-driven light define the new material treatment. Grain, LCD ghosts and sculpted keycaps remain retired. Existing sequencing, audio, arrangement and visualizer behavior remains binding.

The first viewport keeps the transport above four instrument panels on desktop. The selected instrument owns the phone stage. Notes, playback position and the controls used to compose take visual priority.

## Colors

The frontmatter records the exact palettes in `themes.css`. Vector and Alloy share semantic roles; components read the active CSS custom properties rather than choosing a palette directly.

Primary text uses the active ink. The accent identifies focus and text selection. Muted ink is for secondary labels and pitch labels. Instrument colors identify Drums, Bass, Chords and Lead in their panel markers and filled notes. Filled notes use the theme's ink-on-fill. Selected transport and mix buttons use ink as their fill and ground as their text color.

Ground surrounds panels, raised surfaces distinguish controls, and the recess separates the grid from its panel. Thin borders use the theme line color. Keep state understandable through button labels, pressed states, selected borders and ARIA equivalents; color must not carry the only indication.

## Typography

Instrument names use locally hosted Barlow Bold from `src/assets/fonts/barlow-700.ttf`. The shared display token falls back to Segoe UI and sans-serif. Utility labels, buttons, values and body text use Segoe UI with Arial and sans-serif fallbacks. IBM Plex Mono is reserved in the hybrid controls for musical row labels and crisp transport, tempo, status and register displays; other label/value/LED aliases resolve to the utility stack.

Instrument headings use Barlow 700 at 23px/1.05 on desktop and phone. The wordmark is 25px/1 on desktop and 19px on phone. IBM Plex Mono uses 11px pitch/register labels, 19px status, 23px tempo and 25px transport position. Utility hierarchy uses 11px small labels, 12px controls and values, and 13px body text. Control captions and register-stepper labels use 10px. Keep the clear sans-serif hierarchy when adding controls; the old monospaced size bands are superseded.

The bundled legacy families remain documented assets: Silkscreen 400/700 for base engraved-label roles, Departure Mono 400 for base values, VT323 400 for base LED roles, and Press Start 2P 400 for the legacy display role. `fonts.css` registers them and `tokens.css` retains their fallback roles; the later hybrid theme overrides these aliases for the active workspace. Their presence does not authorize replacing Barlow or Plex in the new header. Legacy engravings and labels use 8/10/11px bands; utility and help content use 12/13/16px, with 18/22px roles retained in other components. Follow each component's existing type role rather than imposing the retired single size ramp.

## Layout

Keep the existing four-panel desktop and tablet flow in Drums/Bass then Chords/Lead order. The desktop shell budgets one viewport at 1280 by 800 and 1440 by 900; long patterns scroll inside grids. These are layout requirements, not a claim that this documentation pass verified them. The current theme uses 8px outer app padding, 12px stage gaps, 12px panel padding and a transport panel padded 8px by 12px.

Phone uses the existing single-lane stage with sticky chrome and visible playback transport. The phone app has no outer padding; the stage has 8px padding and each instrument panel has 8px. Keep sound and mix controls in the header, gate/scale/FX in their existing row, and register navigation adjacent to pitched grids. The sound-transpose control remains in phone OPTIONS, separate from view navigation.

Phone row fitting bounds available height by the viewport and subtracts panel padding, borders and all following siblings, including the playback-follow footer. It must not treat existing overflow as spare room. Base row tracks retain a 44px floor and may grow to 64px when space permits. The tighter phone header and register gaps preserve room for a full scale octave and the footer. Short screens may scroll rather than shrink touch rows below their floor. Pinch zoom uses actual grid geometry with a 1 to 2 factor, a 44px reset target and a double-tap reset that does not activate a note.

Pitched grids show only notes in the effective scale across MIDI 0 through 127. Highest pitches are at the top; lower pitches appear beneath them. The view domain derives from pitch space in `src/document/pitchWindow.ts`, independently of a pattern's saved row list. One view octave contains the scale's mode-size rows. OCT view navigation moves its origin by twelve semitones and SEMI by one, with physical MIDI boundary clamps. A semitone step can retain the same visible rows when the skipped pitch is outside the scale.

Vertical row virtualization retains the full semantic pitch range while materializing only the seated octave. Phone grid scrollbars are hidden so scrollbar thickness cannot steal a row or the footer; touch panning remains available. A heptatonic phone window keeps all seven rows complete.

Scrolling, register navigation and zoom are view state. They must not change stored notes, transpose sound or create undo entries. Notes keep their scale-degree identity when leaving and re-entering the viewport. The schema's degree envelope is -128 through 128; placement also checks the resolved physical MIDI pitch. Negative and high degrees within MIDI range remain valid through save/load, compilation and export. Sound-transpose remains a separate musical edit.

## Elevation & Depth

The hybrid console combines thin-bordered panels with crisp inset displays. Transport and status displays use a 1px display-edge border, 4px radius and `inset 0 2px 5px #00000026`; register readouts use a 3px radius. This depth groups musical information. Base grain, keycap and chamfer stacks remain disabled.

Controls acknowledge state through their fill, outline and labels. Existing playback timing remains tied to audible audio time. Preserve reduced-motion handling in CSS and JavaScript; do not add decorative continuous motion or pointer-follow lighting.

## Shapes

Panels and utility controls use the shared theme radius. Grids and sustained notes use the note radius; empty cells and instrument markers use the cell radius. The frontmatter records those values. Active note fills remain flat, without a clipped corner or a decorative inset. No per-cell gradients or shadows belong inside a virtualized grid.

## Components

The supplied Bitbounce logo and Barlow wordmark identify the shared header; the supplied favicon is wired in index.html. Logo assets remain local in src/assets/branding/.

The theme button lives in the shared Booth and displays Dark or Light with an icon. Its accessible name describes the switch destination. `src/state/theme.ts` stores the choice in `bitbounce.theme.v1`; absent or unavailable storage defaults to dark. Theme changes remain outside projects, undo history and exports, and still work for the current session if storage fails.

Instrument panels share control positions and use a colored marker beside the Barlow heading. Selected panels use their instrument color on the border. Grids carry scale labels, flat note fills and the existing playback/focus signals. Only the selected grid owns keyboard entry, while every desktop grid remains available to pointer editing. Drag-created note length remains the lane's next placement length; editing the gate or loading a project resets that memory.

EDIT and SONG remain separate pages on every device class. EDIT grids preserve register and scroll state while SONG shows all four horizontal pattern chains. Playback follows chain-slot identity even when neighboring slots refer to the same pattern. Sounding tile, editing selection and LOOP/NEXT footer agree at audible time. The stopped footer follows the selected slot. Preserve the compact footer budget and tile-local follow marks. Page switches and VIZ entry do not interrupt audio.

One top-edge LaneMeter signal line per lane responds to audible note activity. Its 3px track and horizontal fill replace redundant decorative header animation. The inset status readout retains control feedback. Playback animation must not introduce per-frame DOM writes. INFO remains nonblocking and follows the existing device guards.

VIZ retains its separate composition layout in `.impeccable/surfaces/route-viz.md` and inherits theme colors. Four instrument tabs select one inspector. Each lane owns one of 24 procedural effects, seeded variation and independent 35 to 130 percent scale. Fluid folds and Blended are defaults. Flowing trails and Orbit remain available; Composition is disabled in Orbit, which uses each lane's 0 to 100 percent orbit strength. At full strength the radius is 32 percent of the shorter canvas dimension. Reroll changes effects, variation and starting angles while retaining motion, blending, scale and orbit strength. Hide controls removes the motion controls, inspector and orbit guide. Phone inspectors scroll below the canvas. Escape restores editor focus or returns to the DAW.

VIZ settings persist separately in `bitbounce.viz.composition.v2`. Legacy compositions acquire Fluid folds and Blended without losing effects. Invalid storage falls back to defaults; unavailable storage leaves the current session usable. Native select/range interaction and 44px control targets remain valid.

Actual audible MIDI, including hold and release duration, drives only its lane's artwork. Up to 16 overlapping notes per lane preserve sustained phrases. Drums use a short outward impulse; pitched lanes hold and evolve through their gates, then fade fully away. Silent, muted, zero-volume and non-soloed lanes draw nothing. Stop clears envelopes; unmuting waits for the next note. Reduced motion omits artwork and retains bounded textual summaries. Keep the existing audio scheduler, synthesis and project contracts. The VIZ backing-store DPR cap is now 0.75. The passing VZ-TH-4 dense frame-budget gate closes the previously recorded dense-playback limitation; historical measurements remain in `docs/dev/perf-budget.md`.

## Do's and Don'ts

- Do use the semantic theme tokens from `themes.css` and preserve both palettes when adding controls.
- Do preserve keyboard editing, focus visibility, ARIA state, non-color state cues and reduced-motion behavior.
- Do keep higher pitch above lower pitch and keep view changes outside musical data.
- Do preserve the existing single-lane phone and four-panel desktop interaction flow.
- Do reserve footer space when fitting phone rows and retain the 44px base row floor.
- Don't restore grain, glass ghosts, sculpted keys or redundant decorative animation. Keep light tied to audible activity.
- Don't add expensive decoration inside virtualized grid cells or write the DOM on every playback frame.
- Don't infer commit, push or deployment status from verification.

Closeout verification, 2026-09-12: the fresh finish reviewer returned `ship` with no material interface defect. The parent task reports passing typecheck, lint, 89 unit files / 1772 tests, 21 fuzz tests, production build, pitch-direction checks, isolated target-size checks, the focused accessibility/VIZ/happy-path pack, LP1 5/5, and the full frame-budget suite 12/12 in 178.49 seconds. This closeout records those completed checks; it does not claim to have rerun them or committed, pushed or deployed the work.
