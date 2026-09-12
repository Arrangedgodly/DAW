---
name: Bitbounce Membrane
description: A continuous four-instrument surface with quiet controls, luminous note buttons and shared track colors.
colors:
  ground: "#080b0d"
  panel: "#10191d"
  raised: "#1b282e"
  recess: "#0c1419"
  ink: "#e8eff2"
  muted: "#a0b1b9"
  accent: "#b7eeeb"
  drums: "#dfaaa1"
  bass: "#c4d49e"
  chords: "#93cfc7"
  lead: "#aabbe7"
---

# Bitbounce design

## Direction

Membrane is the approved production direction, selected from prototype A with prototype C's glowing note buttons. The user explicitly rejected moving background sheen. The surface stays still; musical notes, the existing playhead and lane meters carry playback activity.

The implementation is `src/styles/membrane.css`, imported after the older component and theme styles. Those older files retain structural rules and compatibility selectors; Membrane owns the final material, palette, typography and control appearance. This supersedes Vector/Alloy's raised keys, inset displays and separate panel borders.

## Instrument surface

Desktop has one continuous instrument with a rounded top transport, four connected quadrants and fine dividing seams. EDIT and SONG remain separate pages. The arrangement inherits the same material and control language. Use the available viewport; keep internal grid scrolling inside the instrument. At 1280 by 800 and 1440 by 1000 the editor fits without page scrolling.

Dark mode uses a charcoal blue-green surface, pale text and subdued track colors. Light mode retains a pale silver-green surface with darker track defaults. The theme remains a local preference under `bitbounce.theme.v1`.

Use thin borders and quiet fills for functional controls. Retire sculpted keycaps, decorative screws, inset display shadows, scanning overlays and moving background reflections. Preserve visible hover, focus, disabled, selected, muted and bypass states. The play button has a rounded shape and clear active fill.

## Typography

The supplied Bitbounce logo and local favicon remain. The wordmark uses Unbounded 500 at 19px on desktop and 15px on phones. Instrument titles use Unbounded 500 at 20px with -0.025em tracking and title case; arrangement titles use 18px and mobile instrument tabs use 10px. Its wide letterforms and distinctive joins carry the instrument identity. Utility controls use Barlow 600 with slight 0.015em tracking; body and supporting text use Barlow 400/500. IBM Plex Mono is reserved for musical positions, pitch labels and numeric readouts. Fonts are bundled locally with swap loading and their OFL licenses; the main control weight is preloaded. Existing bundled retro fonts are compatibility assets, not the visual voice of new controls.

## Note glow and motion

Filled notes have a soft halo in their instrument color. Audible step crossings brighten the existing prepainted cell overlay; only opacity animates. No new animation loop, audio subscription or scheduling behavior was added. Long notes retain their duration representation and resize affordances.

The lane meter follows the existing audible-note bus at the bottom edge. No decorative chassis or header breathing is used. Reduced motion disables animated note bloom while keeping static fills, selection and playback information. Keep glow restrained enough to preserve cell boundaries and dense-grid legibility.

## Track colors

The selected track and VIZ inspector use `TrackColorControl`. Its native popover offers 30 named swatches: Light, Middle and Dark variants of red, orange, yellow, green, cyan, blue, purple, pink, brown and gray. Values live in `src/state/trackColorSwatches.ts`. A check mark and outline identify selection; arrow keys navigate; Escape closes the palette before leaving VIZ. Use theme default removes the individual override.

The same color updates grid notes, track accents, arrangement accents and live visualizer geometry. Color changes do not restart visualizer envelopes or audio. Custom note fills choose black or white text for readability. Color never replaces labels or selection semantics.

Preferences persist locally under `bitbounce.track-colors.v1`, outside project documents, musical undo and exports. Previously saved valid custom colors remain readable; the UI offers only swatches. The development prototype shares these appearance preferences.

## Phone layout

The grid navigation row sits above the notes. Back and Forward move by up to one bar, with overlap at narrow widths; a step range shows the current position. Draw and Scroll use pressed-button states and 44px minimum targets. Draw supports a 320ms hold before panning, with a static grid outline and "Drag to scroll" cue. Scroll pans immediately on touch. Keep vertical native scrolling and quick note drawing available. Show these controls on narrow layouts and devices with a coarse pointer.

One selected instrument occupies the phone stage. The sticky top area holds the brand, Projects, theme, instrument tabs, Options, Play and page navigation. The track-color control sits beside the instrument title.

Autosave has one fixed bottom-center status strip displaying the complete status text. The top transport does not contain a duplicate. The status retains its accessible label and saved timestamp. Reserve bottom space through `--mobile-bottom-reserve` and safe-area padding so the musical footer remains reachable. Hide this status while the dedicated VIZ page is open.

Pitched grids retain complete scale-octave rows with a 44px base row floor. Fit whole rows between the real control stack and reserved bottom area. Short phones scroll rather than compressing editing targets. View changes preserve pitch identity and do not transpose notes or create undo entries. The full MIDI 0 through 127 scale-note range remains vertically virtualized.

## Effects and visualizer

The FX overlay is positioned against the lane floor, below its measured control strip. The header must not become its containing block. Keep title, close, add, reorder, bypass, remove and parameter controls usable in empty and populated chains. Modules use the same quiet material and circular slider thumbs.

VIZ retains all 24 effects, lane-local MIDI phrasing, Fluid folds / Flowing trails / Orbit, composition blending, independent scale, orbit strength and hide-controls behavior. The renderer DPR cap stays 0.75. Its panels and controls inherit Membrane, and lane color changes update geometry live. Silence and excluded lanes retain their existing no-artwork behavior.

## Verification

See `docs/dev/membrane-review/verification.md` for the completed checks and the older register tests with obsolete expectations. No deployment is implied by local verification.

## Optional instrument workspace

Desktop tabs are Instruments 1–4, Instruments 5–8, then Song arrangement. The second instrument page uses the same four-quadrant MIDI editor, with a fixed slot per quadrant and an Add instrument action in empty slots. All lane headers use two consistent rows: name and mute/solo, then sound and mix controls. The selected instrument title takes its lane color; redundant Edit/View labels are omitted. On phones, the sticky header shows default instrument tabs followed by up to four added track tabs and an Add new instrument button until all slots are occupied. One SONG/NOTES button switches views and preserves track selection. Phone Song sections have discreet centered titles and wrapping pattern tiles with content-sized spacing.

Preset names are native grouped selects with the existing minus/plus steppers. Families organize the shared pitched library. Extra track colors follow the existing user swatches; defaults are lavender, warm sand, pale blue and yellow green. The default four-grid editor and four-layer visualizer retain their roles.

During playback, note grids follow the sounding column horizontally, including longer virtualized patterns. Follow pauses while a note or pinch gesture is active and stops with transport. The desktop activity meter bank includes every existing lane and uses the selected track colors.
