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

Desktop has one continuous instrument with a rounded top transport, four connected quadrants and fine dividing seams. Instruments 1–4 and Instruments 5–8 are separate editor pages, followed by Song arrangement. The arrangement inherits the same material and control language. Use the available viewport; keep internal grid scrolling inside the instrument. The existing layout target is an editor that fits without page scrolling at 1280 by 800 and 1440 by 1000; the finishing critique checks current behavior against that target.

At desktop heights up to 850px, reclaim space from transport padding, header gaps and register padding while preserving control sizes and the aligned instrument tools tier. Grid fitting includes instrument borders and refreshes after selection changes. The R1 matrix verified complete rows and reachable footers at the two desktop targets, including touch-enabled 1280 by 800 layouts.

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

The grid navigation occupies one 44px row above the notes. Labeled chevrons move backward and forward by up to one bar, with overlap at narrow widths; a step range shows the current position. Draw and Scroll use pressed-button states and 44px minimum targets. Draw supports a 320ms hold before panning, with a static grid outline and "Drag to scroll" cue. Scroll pans immediately on touch. Keep vertical native scrolling and quick note drawing available. Show these controls on narrow layouts and devices with a coarse pointer. On those tablet and desktop layouts, reduce panel padding and register spacing to preserve the complete pitch window. Contextual help explains all navigation controls.

One selected instrument occupies the phone stage. The sticky top area holds the brand, Projects, theme, instrument tabs, Options, Play and page navigation. The track-color control sits beside the instrument title.

Autosave has one fixed bottom-center status strip displaying the complete status text. The top transport does not contain a duplicate. Saved projects retain the accessible status label and saved timestamp. Untouched built-in demos display Built-in demo instead of implying that a project has been saved. Reserve bottom space through `--mobile-bottom-reserve` and safe-area padding so the musical footer remains reachable. Hide this status while the dedicated VIZ page is open.

Pitched grids retain complete scale-octave rows with a 44px base row floor. Fit whole rows between the real control stack and reserved bottom area. Short phones scroll rather than compressing editing targets. View changes preserve pitch identity and do not transpose notes or create undo entries. The full MIDI 0 through 127 scale-note range remains vertically virtualized.

Phone Options includes optional Help. A native topic picker reveals one registered explanation at a time for drawing, navigation, pitch controls and effects. Help and the picker retain 44px targets; long explanations scroll inside a bounded text region. Close help returns to Options; Escape closes Help first and restores its trigger, then closes Options on the next press. Reading help does not require touching a musical control or changing the song. Pitched help topics follow the active instrument, including extra tracks; drums omit them.

## Effects and visualizer

The FX overlay is positioned against the lane floor, below its measured control strip. The header must not become its containing block. Keep title, close, add, reorder, bypass, remove and parameter controls usable in empty and populated chains. Modules use the same quiet material and circular slider thumbs.

VIZ retains all 24 effects, lane-local MIDI phrasing, Fluid folds / Flowing trails / Orbit, composition blending, independent scale, orbit strength and hide-controls behavior. The renderer DPR cap stays 0.75. Its panels and controls inherit Membrane, and lane color changes update geometry live. Silence and excluded lanes retain their existing no-artwork behavior.

## Verification

See `docs/dev/membrane-review/verification.md` for the earlier completed checks and older register tests with obsolete expectations. The ultron-impeccable refresh checked current source for tokens, navigation, instrument naming, drum navigation and demo copy. This documentation refresh does not rerun or extend those historical test results. Fresh critique evidence is recorded separately under `.impeccable/critique/`. No deployment is implied by local verification.

The finishing refinements have separate fresh evidence in `docs/dev/r1-desktop-fit/`, `r2-control-labels/`, `r3-phone-help/` and `r4-instrument-names/`. Each records its focused checks, independent verification and finish review. R1's legacy phone no-scroll test failed identically with the original files; phone scrolling remains permitted. The full regression suite and physical screen-reader speech have not been established by these focused passes. A constrained CSS viewport capture does not establish actual browser-zoom behavior.

## Optional instrument workspace

Bars is a compact disclosure in the selected instrument's tools row. Its field and minus/plus buttons open over the grid without growing the page or navigating away. On phones and coarse-pointer devices, the trigger and editing targets are at least 44px tall. Escape returns focus to the trigger; outside pointer presses dismiss the panel. Keep the panel out of layout and focus navigation while closed. The phone Add instrument action sits beside the instrument tabs as a labeled plus button.

Desktop tabs are Instruments 1–4, Instruments 5–8, then Song arrangement. The second instrument page uses the same four-quadrant MIDI editor, with a fixed slot per quadrant and an Add instrument action in empty slots. All lane headers use two consistent rows: name and mute/solo, then sound and mix controls. The selected instrument title takes its lane color; redundant Edit/View labels are omitted. On phones, the sticky header shows default instrument tabs followed by up to four added track tabs and an Add new instrument button until all slots are occupied. One SONG/NOTES button switches views and preserves track selection. Phone Song sections have discreet centered titles and wrapping pattern tiles with content-sized spacing.

Preset names are native grouped selects with the existing minus/plus steppers. Families organize the shared pitched library. Every pitched instrument title follows the selected preset's category, including the original three pitched lanes. Pads and Chords are distinct categories; long category names shorten to Plucks and FX in instrument titles. Track identity and saved IDs stay stable when the title changes. Extra track colors follow the existing user swatches; defaults are lavender, warm sand, pale blue and yellow green. The default four-grid editor and four-layer visualizer retain their roles.

Runtime accessible names use the visible category first, followed by the stable track number, such as Keys, track 4. Apply the same identity to instrument regions, presets, mix controls, grid navigation, phone controls and arrangement chains. Names update when presets change. Update the grid's accessible label in place; do not rebuild it merely to change its name. Existing preset changes that alter the pitch domain retain their normal grid behavior. Static help entries keep stable registry IDs.

During playback, note grids follow the sounding column horizontally, including longer virtualized patterns. Follow pauses while a note or pinch gesture is active and stops with transport. The desktop activity meter bank includes every existing lane and uses the selected track colors.

Sound-changing octave controls read Transpose (Oct), both beside desktop presets and in phone Options. Grid navigation reads View Oct and View Semi. Keep these labels and their accessible action names distinct: Transpose changes playback and exports; View only changes the visible register. Help uses the same terms.

## Drum sound window

The drum editor exposes 16 percussion voices through a scrollable row window. Its register strip shows Percussion, the voice count and the visible row range. Previous drum sounds and Next drum sounds move the window and disable at the boundaries. Navigation changes the visible voices without changing the pattern. Keep the row labels, editing targets and Euclidean fill controls aligned with the visible sounds.

## Demo previews

Projects contains a Built-in demos disclosure with named examples and descriptions. Opening a demo starts a temporary preview. Playback, navigation and appearance changes leave it temporary; the first document edit creates a local copy and starts normal autosave. Explain that behavior beside the demo choices and preserve the Built-in demo status until editing begins. Welcome Song remains the first-run demo. Glass Arcade and After Hours demonstrate eight-bar, eight-lane arrangements.
