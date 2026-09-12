<!--
Regenerated 2026-09-11 by $impeccable document v4.3.1 (scan mode, OVERWRITE —
user choice; North Star "Machined Console" — user choice). Tokens re-extracted
from src/styles/tokens.css (the law: "Do not hardcode these values") and the
component sheets; the retired "Arcade Stage Floor" frontmatter (ground
#0d0b10) is superseded by the Machined Console ground #111014 that has
shipped since 2026-09-04. Includes The Full Unit pass of 2026-09-11
(material, keycaps, readouts, status screen, channel meters, all-quadrant
pointer editing). Sidecar: .impeccable/design.json (schemaVersion 2).

MERGE NOTE 2026-09-12: this file merges the Machined Console regeneration
(the visual world wins — material, readouts, phone SONG page, follow marks)
with ultron-supreme iteration 7's phone MIDI laws (semitone-snap one-octave
register windows; ONE OCT + ONE SEMI register row with the sound-transpose
OCT fenced into the OPTIONS drawer; pitch-anchored notes; pinch-to-zoom
[1,2]× with chip + double-tap reset; the two-tier phone card header). Where
the two disagree on FUNCTION, the iteration-7 law below is the shipped
truth. The next closing refresh will re-derive this file against the merged
world.
-->

---
name: Bitbounce
description: Machined Console — a premium hardware DAW unit in the browser; milled graphite plates, sculpted keys, recessed LCD readouts, four lane hues as its signal system.
colors:
  ground: "#111014"
  ink: "#f5f2e9"
  ink-on-fill: "#0d0b10"
  metal-panel: "#1a191d"
  metal-raised: "#232128"
  metal-recess: "#0a090c"
  lane-drums: "#f23d4c"
  lane-bass: "#ffb300"
  lane-chords: "#35d07f"
  lane-lead: "#4da6ff"
typography:
  panel-label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  panel-label-lg:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  legend:
    fontFamily: "Silkscreen, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.05em"
  value:
    fontFamily: "Departure Mono, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1
  body:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  numeric-field:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: "tnum"
  led:
    fontFamily: "VT323, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
  viz-heading:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  viz-instrument:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  viz-label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5

rounded:
  popover: "6px"
  chassis: "4px"
  control: "3px"
  beat-led: "2px"
  hairline: "1px"
spacing:
  "1": "2px"
  "2": "4px"
  "3": "8px"
  "4": "12px"
  "5": "16px"
  "6": "24px"
  "7": "32px"
  "8": "48px"
components:
  viz-button:
    backgroundColor: "{colors.metal-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px"
  viz-reroll:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-on-fill}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px"

  machined-key:
    backgroundColor: "{colors.metal-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.panel-label}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px"
  machined-key-lit:
    backgroundColor: "{colors.lane-chords}"
    textColor: "{colors.ink-on-fill}"
    typography: "{typography.panel-label}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px"
  stepper-key:
    backgroundColor: "{colors.metal-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "20px"
  pad:
    backgroundColor: "color-mix(in srgb, {colors.ink} 7%, {colors.ground})"
    rounded: "{rounded.control}"
  pad-on:
    backgroundColor: "{colors.lane-chords}"
    rounded: "{rounded.control}"
  readout-window:
    backgroundColor: "{colors.metal-recess}"
    textColor: "{colors.ink}"
    typography: "{typography.led}"
    rounded: "{rounded.chassis}"
  scale-chip:
    backgroundColor: "{colors.metal-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.panel-label}"
    rounded: "{rounded.chassis}"
    padding: "4px 8px"
  rail-tile:
    backgroundColor: "{colors.metal-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.value}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
  lane-plate:
    backgroundColor: "{colors.metal-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chassis}"
    padding: "4px 8px"
  popover:
    backgroundColor: "{colors.metal-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.popover}"
    padding: "12px"
---

# Design System: Bitbounce

## Overview

**Creative North Star: "Machined Console"**

Bitbounce is one premium hardware DAW unit that happens to run in a browser: the kind of large-ticket standalone instrument you hold, weigh, and play, that still answers like a lightning-fast digital machine. The whole viewport is the unit's anodized graphite deck, bead-blasted rather than brushed. The transport booth is its faceplate, the pattern rail its arrangement strip, and each of the four lane quadrants a milled plate with a pad display set into a machined pocket. Every surface is lit from one studio seat at the unit's top-left shoulder, so each chamfer, keycap wall and pocket lip agrees on where the light comes from. The four lane hues are the unit's signal system: LED values, anodized rim tints, lit pads. They are never paint and never decoration.

The register is industrial-precise with a chiptune soul. Controls are machined keys with sculpted caps that seat and light on the very frame your finger lands. Readouts are recessed LCD windows with scanlines, a glass glint and ghosted unlit cells. The booth carries a status screen that echoes every control you touch with its read-back value, and a channel meter on each quadrant strikes at the exact moment each note is heard. Motion is instant or mechanical: key travel with a spring return, detent ticks, switch throws, rolling value windows, a phosphor scan when a surface opens. Nothing drifts or breathes for show, and no light follows the cursor. Density is instrument-grade: the whole DAW fits one screen at 1280×800 and 1440×900, and that constraint is the charm.

State is carried by form, never by hue alone. Rims change line form (solid, dashed or doubled), fills light, pads carry a corner notch and sustain tails a hatch, pending switches fly a diamond flag, and every state has a text or aria equivalent. Glow is a single decorative layer laid over that coding. Faithful to the product's roots (1BITDRAGON's no-wrong-notes grid, Ableton's device chains), the palette stays tiny: one graphite family, one warm white, four lane hues.

Iteration 7 (phone MIDI section rework) put the register under law. The phone pitched grid's window is a SEMITONE-SNAP window: exactly one scale-octave of COMPLETE rows (modeSize rows — 7 heptatonic, 5 pentatonic) at every rest, at any semitone offset, seated on the row grid after every intentional move and every settled scroll (scroll-end snap); the pane's box is pinned to exactly that many row pitches, so a partial row can never intersect it. ONE register row owns the view — ONE OCT −/+ (a whole scale-octave) beside ONE SEMI −/+ (one semitone) and an aria-live "ROWS a–b OF n" readout that always agrees with the grid's own range — and the strip's sound-transpose OCT stepper, the old duplicate, is render-guarded away at phone and lives in the OPTIONS drawer under the E9 fence ("Changes what you HEAR, not what you SEE"). Notes are pitch-anchored: a note's identity is its scale DEGREE, so every window, scroll, or zoom change rides the same rows — out of and back into view — never a re-pitch, and scale edits relabel rows in place. A two-finger pinch zooms the grid [1,2]× by re-fitting the actual geometry (never a CSS transform), with a ≥44px factor chip that resets and a double-tap reset that never eats the note under it. The phone card header re-tiers into two edge-anchored rows (LED + name left / MUTE + SOLO right; PRESET/KIT left / VOLUME right — the · EDIT word hidden at phone scope), collapsing to one line in landscape. Desktop and tablet surfaces remain byte-identical — the existing gates are the fence.

**Key Characteristics:**
- Bead-blasted graphite deck; milled plates with two-facet chamfered edges and two-layer casts; everything lit from the top-left.
- Sculpted keycaps drawn in inset shadow that seat and light instantly under the finger (zero-ramp acknowledgement).
- Recessed LCD readouts: scanlines, glass glint, ghosted 8s behind the lit VT323 digits.
- Four lane hues as signal (LEDs, rims, lit pads); warm white carries every piece of information.
- State = line form + fill + shape mark + text — never glow alone, never color alone.
- A fast digital unit: rolling value windows, scan-on surfaces, a booth status screen, channel meters striking at audible time.

The VIZ composition editor extends this console with lane-colored procedural linework on the graphite deck. Its control panels use flat tonal separation so overlapping contours, meshes, arcs, and point trails remain the focal content. The approved interactive option B and route-specific composition live in .impeccable/surfaces/route-viz.md; they do not replace the DAW's arrangement layout.

## Colors

A graphite hardware family, one warm white, and four lane signal hues — the palette is the world's law.

### Primary

- **Warm Chassis White** (#f5f2e9): every piece of info-critical text on the deck and panels (16.93:1 on the graphite ground), the playhead's phosphor edge, focus rings, lit readout digits, the lit INFO/VIZ lamps. The default voice of the unit.

### Secondary (the lane signal hues)

- **Drums Signal Red** (#f23d4c): drums lane identity; lit drum pads, the drums rim tint, the world's only danger key (CONFIRM DELETE). As text only at ≤10px Silkscreen 700 (5.01:1).
- **Bass Console Amber** (#ffb300): bass lane identity; the beat LEDs and METRONOME lamp; the fader-cap edge accent (10.56:1).
- **Chords Pad Green** (#35d07f): chords lane identity; the lit PLAY/STOP key; the text-selection fill (9.46:1).
- **Lead Signal Blue** (#4da6ff): lead lane identity; the lit LOOP key; the first-run PLAY nudge (7.41:1).

### Neutral

- **Anodized Graphite Deck** (#111014): the ground everything is milled from — the app deck and the stage between plates.
- **Panel Graphite** (#1a191d): booth faceplate, rail strip, lane plates, popovers and the FX console.
- **Raised Key Graphite** (#232128): every machined key, the FX modules, the serial plate.
- **Recess Black** (#0a090c): readout windows, grid pockets, fader slots, meter wells.
- **Ink-on-Fill Near-Black** (#0d0b10): the glyph color on every lane-hue and warm-white fill (≥5.17:1).

### Named Rules

**The Ink Law.** Lit keys and filled pads set glyphs in Ink-on-Fill, never warm white. Info-critical text is warm white on graphite, never lane-hued and never dimmed below the 62% legend mix (7.00:1). No lane-hue text on lane fills.

**The Signal Rule.** A lane hue appears only where it carries that lane's signal (a lit pad, an LED, a rim tint, a lit key, a meter). It is never used as a decorative accent. Tints are `color-mix()` of a hue into graphite at 5–28%.

**The No-New-Color Rule.** No color enters the unit without a lane or a material role to own it. Material lighting (grain, panel light, chamfers, pocket, glass glint) is built only from warm-white or black alpha, never from a new hue.

### VIZ color application

The canvas reads the four lane colors directly from the console tokens. Its additive overlap belongs to the geometric content. Editor borders mix 24% warm ink into Panel Graphite; secondary copy mixes 72%. Selected instrument tabs use a warm outline and retain warm text on graphite. Motion and blending controls reuse the panel and ink tokens.

## Typography

**Body/UI Font:** IBM Plex Mono (ui-monospace fallback), the panel workhorse
**Legend Font:** Silkscreen (IBM Plex Mono fallback), engraved legends ≤10px
**Value Font:** Departure Mono (IBM Plex Mono fallback)
**LED Font:** VT323 (IBM Plex Mono fallback)
**Reserved Display Font:** Press Start 2P, 16px+ brand moments only (loaded, not applied)

**Character:** Five monospaced faces, one machine voice. Printed panel labels (Plex 500, tracked uppercase), engraved section legends (Silkscreen), terminal value readouts (Departure Mono), and vacuum-fluorescent LED numerals (VT323) behind glass. The fonts are self-hosted Latin subsets (37 KB woff2, budget ≤50 KB).

### Hierarchy

- **Panel label** (500, 10px/1.2, +0.08em, uppercase, Plex): every control and group name — KIT, GATE, TEMPO, lane names, key legends.
- **Panel label large** (500, 11px/1.2, +0.08em, uppercase, Plex): stepper glyphs, phone lane tabs, register shift keys.
- **Legend** (700, 10px/1, +0.05em, uppercase, Silkscreen): engraved accents — SONG CHAIN, the euclid E tag, cue names, screen annunciators. Decorative furniture engravings (serial plate, section legends) may drop to 8px.
- **Value** (400, 11px/1, Departure Mono): live values — pattern bars, FX params, VOL %, swing/master %; monospaced, so tabular by construction.
- **Body** (400, 13px/1.5, Plex, always warm white): help text, toasts, banners.
- **Numeric field** (500, 13px/1.2, Plex, tabular-nums): off-grid numeric inputs.
- **LED** (400, 20–24px/1, VT323): BAR.BEAT.STEP, TEMPO, the status screen value and BPM. It gets one ≤2px emissive text-shadow, and only at this size.

### Named Rules

**The Size-Law Rule.** Each face keeps its band: Silkscreen 10–12px (8px engravings only), Departure Mono 11px, Plex 10–14px, VT323 20–24px, Press Start 2P 16px+ in multiples of 8. The ramp is exactly 10 / 11 / 13 / 16 / 22 — no 12px step.

### VIZ type exception

VIZ uses the scoped heading, instrument, and label roles in the frontmatter alongside the existing body and value roles. These extend the console's engraved-label ramp only inside the composition editor. At the phone breakpoint, the page heading becomes 16px and the selected instrument heading becomes 18px. Controls use sentence case, and instrument names use capitalization rather than the console's tracked uppercase legends.

## Layout

**One page, one screen — the one-page law (desktop).** At 1440×900 and 1280×800 the booth, the pattern rail and all four lane quadrants fit the viewport exactly. Long patterns scroll inside their quadrant, never the page. The shell is a 100dvh flex column:
- the sticky booth faceplate: two rows at 1280 and 1440 (99px), one row at 1920 (55px);
- the SONG page with four horizontal chain strips, or the EDIT page below;
- the 2×2 quadrant grid (`1fr 1fr`, 8px gutter), filling the rest edge to edge. Reading order is drums · bass / chords · lead.

The floors fill the viewport width at every desktop width, with ≥95% utilization at 1280, 1440 and 1920. Width buys more visible steps, never bigger cells. Rows share the vertical budget (`minmax(auto, 1fr)`): register-window rows grow first, then the row scale within its 24px clamp, down to the per-lane readability floors (drums 20px / pitched 11px) when a real deficit demands it. The spacing rhythm is a 2px-base scale (2/4/8/12/16/24/32/48).

The stage is responsive across three device classes (one `stageMode()` seam decides, the layout itself stays one law per class): **desktop** (≥1024×600) is the 2×2 quadrant stage above — pointer + keyboard, one-page at both committed viewports, quadrant rows flex within the 100dvh budget down to per-lane readability floors (drums 20px / pitched 11px tracks) when a real deficit demands it, never on provisional font metrics. Since v0.2 every pitched lane's grid shows through one equal one-octave REGISTER WINDOW (the lane's scale-mode row count, view state only — never a document field, never undo history); the full row manifest stays one scroll away (Shift+arrows move the window, announced "VIEW … ROWS a–b", focus never moves), and patterns longer than 64 steps render virtualized — the visible column window sits inside a pattern-wide scroll extent, so the grid reads as one long floor while the DOM stays bounded. **Tablet** (768–1024) is a responsive scale of the same 2×2 stage, still one page, register windows included. **Phone** (<768, or <1024 with height <600 so a rotated phone keeps the phone law) collapses to a single-lane stage: the quadrant selection becomes a lane-switcher tab row above one sticky `.phone-chrome` block whose centerpiece is the always-visible, horizontally centered PLAY/STOP transport (never scrolls away); KEYS/INFO do not render on phone at all (a render guard, not a hide). Every booth option that the thin chrome sheds — LOOP, METRO, VIZ, TEMPO, SCALE, SWING, MASTER — lives in a collapsible OPTIONS drawer under the chrome, built from the shared BoothOptions parts, mounting zero DOM while closed. Since iteration 7 the phone pitched grids show through the SAME one-octave register window as desktop (the `registerWindowStarts` seam), now a SEMITONE-SNAP window: exactly `modeSize` COMPLETE rows at every rest — boot, steppers, wheel, settled scroll-end snap — at any semitone offset (octave multiples are not required), with the pane box pinned to the renderer's inline height (`windowRows × track`) so no partial row can ever intersect it; leftover grows row tracks first (the [44,64] fill clamp measured on the PAINTED window, not the manifest) and then the page, never the pane. The window moves by the ONE register row — ONE OCT −/+ stepper (a whole scale-octave, `modeSize` rows) beside ONE SEMI −/+ stepper (one semitone) — that disable at their clamps and confirm every change with an aria-live "ROWS a–b OF n" readout chip (ONE source of truth with the grid's aria: the MOUNTED pattern's manifest, 0-based) plus a transient fill+border+shape-coded direction cue (▲/▼; never stamped under reduced motion); the row also carries the ZOOM chip (factor readout + ≥44px reset target). The strip's SOUND-transpose OCT stepper does not render at phone — it lives in the OPTIONS drawer (the E9 fence spoken where the control lives) so one card never carries two same-labeled octave controls. A two-finger pinch zooms the pitched grid [1,2]× — the fill-law geometry re-fit LIVE through the renderer seams (cell [15,24]px × factor, row fill × factor; never a CSS transform, hit-math stays honest), exactly `modeSize` complete rows at every factor, committed on release and persistent until reset (double-tap ≤350ms/≤32px, consumed pre-activation, or the chip). Since iteration 5 the phone grids FILL the measured well: cell width is the exact fraction (well − label − (n−1)·gap)/n clamped to [15,24]px, so a 1-bar row spans 100% of the width with a 0px dead-right edge (cells 17.6/15.7/20.1px drums and 18.3/16.4/20.8px pitched at 390/360/430), while 2-bar patterns keep the 15px readability floor and scroll horizontally inside the well; rows are finger-sized targets grown into the measured leftover, clamped [44,64]px (44 the floor law), and the stage's grow-only flex chain gives the card bottom ownership of the viewport bottom at scroll end (Δ0 — the page-scroll law is unchanged). The grid owns ≥47.5% of the viewport at 390×844 (measured 52.1/49.5/56.7% at 390/360/430) and the chrome stays <50% of viewport height. Touch is a first-class input everywhere (see Components); the phone scroll-vs-gesture law is per-origin `touch-action` (vertical pan stays the browser's from anywhere; horizontal on gesture surfaces is reserved for editing drags).

**Editing model.** On the 2×2 stages every quadrant's pads are live under the pointer: a press on any floor edits it, and the same click then selects that quadrant, so its edit row (scale chip, GATE, FX) and keyboard cursor follow. The keyboard law is stricter: only the selected grid owns a tab stop. `]`/`[` or PageUp/PageDown move the selection, and focus never lives in a non-selected grid.

### VIZ canvas and inspector

The fixed viewport contains a header, a flexible workspace, and a footer. Desktop gives the canvas remaining width beside one 304px scrolling inspector. The header and footer keep exit, viewing mode, and reroll reachable. The inspector starts with four lane buttons in two columns, followed by the selected lane's effect, description, scale and, in Orbit mode, orbit strength. The header carries permanent Motion and Composition selectors.

At widths of 700px or less, the inspector sits below the canvas in its own scrolling region. The workspace rows use minmax(200px, 1fr) and minmax(160px, 38%); the four lane buttons form one sticky row. Header actions wrap onto a full-width row. Hide controls removes the motion controls, orbit guide and inspector, letting the canvas occupy the workspace while the header and footer remain available.

## Elevation & Depth

Milled plates under one studio light. Surfaces step through the graphite family: deck → panel → raised key, with recess black for everything sunk into the unit. Every elevation is a static, paint-once `box-shadow` stack, never animated, and applied only to chassis surfaces and keys (never per pad). One light direction governs everything: a catch-light on top and left walls, dark lower and right walls, and casts falling down.

### Shadow Vocabulary

- **Chamfer** (`inset 0 1px 0 rgb(255 255 255/16%), inset 0 2px 0 rgb(255 255 255/4%), inset 1px 0 0 rgb(255 255 255/5%), inset -1px 0 0 rgb(0 0 0/30%), inset 0 -1px 0 rgb(0 0 0/68%), inset 0 -2px 0 rgb(0 0 0/22%)`): the two-facet machined plate edge, composed into every panel elevation.
- **Plate cast** (chamfer + `0 1px 1px rgb(0 0 0/55%), 0 12px 24px -10px rgb(0 0 0/72%)`): booth, rail, lane plates, phone chrome — contact shadow plus ambient fall.
- **Floating cast** (chamfer + `0 2px 3px rgb(0 0 0/50%), 0 20px 42px -14px rgb(0 0 0/80%)`): popovers (scale, PAT tools, FX add, projects), the FX console, the euclid overlay.
- **Keycap** (`inset 0 1px 0 rgb(255 255 255/20%), inset 1px 0 0 rgb(255 255 255/6%), inset -1px 0 0 rgb(0 0 0/32%), inset 0 -2px 0 rgb(0 0 0/40%), inset 0 9px 10px -8px rgb(255 255 255/9%), 0 1px 0 rgb(0 0 0/70%), 0 3px 6px -2px rgb(0 0 0/55%)`): every raised key. It's drawn entirely in inset shadow, so it layers over any fill.
- **Keycap lit** (`inset 0 1px 0 rgb(255 255 255/45%), inset 0 -2px 0 rgb(0 0 0/26%), inset 0 9px 10px -8px rgb(255 255 255/28%), 0 1px 0 rgb(0 0 0/70%)`): the backlit cap on lane-hue and warm-white fills.
- **Keycap down** (`inset 0 0 0 1px rgb(245 242 233/75%), inset 0 0 10px rgb(255 255 255/16%), inset 0 1px 3px rgb(0 0 0/60%)`): the seated, lit cap — swapped in on `:active`.
- **Readout window** (`inset 0 3px 8px rgb(0 0 0/85%), inset 0 -1px 0 rgb(255 255 255/16%)`): LCD windows and the booth screen; **micro-recess** (`inset 0 1px 2px rgb(0 0 0/70%), inset 0 -1px 0 rgb(255 255 255/16%)`) for LED wells, fader slots, meter wells.
- **Milled pocket** (`inset 0 2px 2px -1px rgb(0 0 0/90%), inset 0 10px 18px rgb(0 0 0/62%), inset 0 -1px 0 rgb(255 255 255/9%), 0 1px 0 rgb(255 255 255/8%), 0 -1px 0 rgb(0 0 0/55%)`): the grid well cut into each lane plate.

### Named Rules

**The Static Elevation Rule.** Elevation is never animated. A key seats by an instant swap to the seated cap on the pointerdown frame and lifts on the release frame — zero ramp is the digital half of the brief.

**The Decoration-Only Glow Rule.** Glow never counts toward contrast and is never the only state signal. Exactly one glow layer, ≤3px blur, lane hue at 45–60% alpha, no glow on text under 18px. One-shot glows decay in ≤180ms as the opacity of a pre-painted layer.

### VIZ depth

The editor panels are flat, divided by thin borders. Buttons use the existing seated keycap shadow while pressed; reroll uses the keycap shadow on hover. The canvas draws procedural paths with additive compositing and no blur or pixel readbacks. Geometry supplies its own projected depth.

## Shapes

Square-ish hardware geometry whose corner radius steps with importance: 1px hairlines (fader caps, meter segments), 2px beat LEDs and the serial plate, 3px controls, pads and rail tiles, 4px chassis (booth keys, lane plates, FX modules, readout windows), 6px floating surfaces (popovers, FX console). Pads carry a shape language of state: the on-state clips an 8px corner notch (bottom-left), sustain tails render a 135° hatch, euclid and drag previews are a 2px dashed lane-hue outline (never the committed fill), and pending pattern switches fly a 10px diamond flag. Rims carry the emission grammar in line form: solid = idle, dashed = pending/cued, doubled = sounding (two 1px lines, the second drawn as an inset outline). The playhead is a 2px warm-white phosphor edge dragging a 14px decaying wake, moved by transform only (a wider trail was tried and reverted: it widened the overlap-compositing band and cost the 128-bar fling budget).

VIZ uses 44px minimum controls and the 4px editor button radius. Manual placement handles and position-map keys are retired. The Orbit guide is a noninteractive dashed circle with a center mark, visible only while editing Orbit mode. Keyboard focus uses a 2px warm-white outline with a 3px offset in this editor.

## Components

Every component is a labeled hardware control: a machined key or window at rest, a lit lane-hue fill when active, ink-on-fill glyphs, and a 2px warm-white focus ring (offset 2px) on keyboard focus.

### Buttons

- **Shape:** 4px booth-grade or 3px control-grade, 1px ink-mix border (30–40%).
- **Machined key:** raised graphite fill, the keycap stack, panel-label legend, padding 8px 12px (booth) or 0 8px at 20px tall (strip keys).
- **Lit:** lane-hue fill + 2px hue border + ink-on-fill legend + the backlit keycap + one ≤3px glow. PLAY = green, LOOP = blue, METRONOME = amber, INFO/VIZ = warm white (stage-global modes).
- **Press:** 80ms travel (1.5px down, scale 0.985) with a 140ms spring return (`cubic-bezier(0.2, 0.9, 0.3, 1.15)`), plus the instant seated-and-lit cap. Steppers flash a detent tick and settle their value 2px. MUTE/SOLO/bypass are latching slide switches whose rider throws 3px with a 1px end-bounce.
- **Hover/Focus:** hover lifts the face 12% toward warm white; focus is the 2px warm-white ring and never depends on glow.

### Chips

- **Scale chip:** a machined key reading "PROJECT · C MIN" or "LANE · D DORIAN". A lane override lights it: lane-hue border, 14% hue fill tint, one ≤3px glow. It opens the 6px scale popover.

### Cards / Containers

- **Lane plate (quadrant):** panel graphite dyed 5% toward its lane hue, bead-blasted grain under a top-down studio light, the plate cast, a 1px solid rim at 22% hue. The selected plate carries the doubled rim (65% border + 55% inset outline) and a 7% tint. A beat-rate rim pulse (120ms opacity decay) lights whichever plate is sounding. An engraved section legend (SEC A · PERCUSSION …) sits in its bottom edge. (Iteration-7 carve-out: the "· EDIT/· VIEW" state word is hidden at phone scope — exactly one card is mounted there, so the LED + name carry the card.)
- **FX console:** opens inside the selected plate below its whole control strip — an opaque 6px floating chassis with a lane-hue LED title strip and CLOSE; modules are raised keys with a 2px 60% hue border when active; internal scroll, never grows the page.
- **Popovers:** 6px panel-graphite chassis with the floating cast; they SCAN ON — a phosphor refresh line sweeps them top to bottom in 200ms while the surface is fully present and hit-testable from its first frame.

### Inputs / Fields

- **LED readout windows (TEMPO, BAR.BEAT.STEP, AUTOSAVE):** recess black, the readout-window stack, VT323 warm-white digits with a 2px emission, display scanlines under a split glass glint; BAR.BEAT.STEP shows ghosted unlit 8s cell-for-cell behind the lit digits.
- **Faders:** custom chassis parts — a 4px milled slot (recess + micro-recess) and a 10px square warm-white cap with an amber edge accent and a 1px cast; one vocabulary for booth, lane VOL and FX params.
- **Steppers:** 20px square machined keys with a 38% lane-hue rim; their value windows ROLL on change (the new value drops in over ~110ms with an over-bright landing). They serve presets/kits, OCT (±3, what a lane SOUNDS), GATE, the phone register row's OCT/SEMI VIEW steppers (44×44 painted at phone), and the pattern LENGTH ladder (1·2·4·8·16·32·64·128 bars; shrinking refuses while a note would be lost). The E9 fence is explicit: the header's OCT (desktop strip / phone OPTIONS drawer) changes the octave a lane SOUNDS; the register row's OCT/SEMI and Shift+arrows scroll the octave you SEE.

### Navigation

- **Pattern rail:** single-line rows per lane — lane name, bar-length tiles, the `+` blank-pattern key, one PAT tools trigger; the row names the lane's cycle ("· 8-BAR CYCLE"). Tiles are 3px raised keys; the sounding tile wears the doubled hairline + underglow and STROBES once when its pattern takes the floor; pending = dashed rim + hatch + diamond flag; a drag-sweep cues many lanes on one quantized boundary. Every tile carries a ⟲/→ FOLLOW MARK in its bottom-trailing corner — ⟲ replays that slot until another is cued, → plays it once and moves on (the last slot wraps to the first) — flipped by a click on the mark or `M` on a focused tile. A tile press while playing CUES ITS SLOT: the lane jumps there at the end of the pattern sounding now, then follows that slot's mark.
- **Projects popover:** the library chassis; every saved row is a machined key with always-visible RENAME/DELETE keys; special states (rename editor, the drums-red CONFIRM DELETE) replace the row's content and never widen the popover; titles ellipsize inside a fixed width (one shared normalizer: trim + collapse + 48 code-point clamp, duplicates allowed); a sticky DELETED toast carries a one-shot byte-exact UNDO (a failed re-put keeps it armed). Keyboard contract as the popover family: Escape gated while an editor/confirm is open, Tab trapped with the editor in the cycle, focus lands on the first row, 2px focus rings, ≥44px on phone.
- **Phone chrome:** the unit's top plate — lane-switcher tabs (the active tab lit in its hue), the centered PLAY/STOP with OPTIONS on one edge column and the SONG key on the other, and the OPTIONS drawer in the same key vocabulary; every phone target paints ≥44px or carries an invisible ±8px hit strap. The drawer carries the ACTIVE lane's sound-transpose OCTAVE stepper (the E9 fence spoken where the control lives: "Changes what you HEAR, not what you SEE"), and the REGISTER row (ONE OCT + ONE SEMI steppers, the ROWS readout chip, the zoom chip) sits directly under the card header in the stepper language — one control voice, no phone-only idiom.
- **Phone card header (iteration 7):** TWO edge-anchored nowrap tier rows — identity (LED + name LEFT at the card padding, MUTE + SOLO right at the trailing edge) over mix (PRESET/KIT stepper LEFT, VOLUME right-anchored), the edit tier (SCALE/GATE/FX) below with consistent left alignment; every control paints ≥44px and overflow SHRINKS through the flex chain — it never re-wraps into a third row. DOM order = visual order (tab order), and the desktop/tablet strip keeps the incumbent single-row child sequence. At the rotated phone (≥768px wide inside phone scope) the two tier groups share ONE line, keeping the strip at its one-line height.
- **Stage pages (the session/arrangement split):** EDIT is the quadrant grid on desktop/tablet or the switcher plus one lane's grid on phone; SONG is the dedicated sequencer — every lane's chain as large tiles (cue, section label, `+`, the PAT tools, and a 44px ⟲/→ mark). The SONG key toggles them from the desktop booth or pinned phone transport row. The EDIT page keeps the whole stage for pads; its hidden grids stay mounted to preserve register and scroll state. SONG lays out four instrument strips with horizontally scrolling chains. Playback selection and the LOOP/NEXT footer follow the audible slot, including repeated uses of one pattern.
- **Lane follow footer:** the bottom line of every lane plate — a machined key reading ⟲ LOOP (lit in the lane hue) or → NEXT (dim), beside "SLOT n · NAME". It names the slot the lane is ON (sounding while playing, selected while stopped) and clicking it flips that slot's mark.

### Signature: the sounding grid

Scale-locked pad rows in a milled, recessed pocket. Pads fill with the lane hue as they trigger, and each crossed step blooms for ≤180ms. Sustain tails are hatched and note length reads as literal bar width. The phosphor playhead sweeps all four quadrants live, each lane wrapping at its own cycle length (the poly-loop law), re-aligning at the song's LCM, which is exactly the length WAV/MIDI export renders. All four grids are live under the pointer. Reduced motion replaces the sweep with a quantized column highlight plus a "BAR n · BEAT n" readout.

### Signature: the status screen and channel meters

A recessed LCD set into the booth's status module. It costs zero layout px: it has no intrinsic width, grows only into its booth row's free space (up to 600px), and sheds parts under container queries when narrow. It carries:
- PLAY/LOOP annunciators, lit from the transport and ghosted when off;
- the live tempo;
- an echo of the last control touched with its read-back value ("BASS GATE · 2ST");
- a four-lane meter bank.

Each lane plate carries a segmented channel meter in its left padding. Meters strike at a note's audible time (instant attack, a short hold, a segment-quantized fall), rise with chord density, and stay dark for muted or solo-silenced lanes. It's all Web Animations: nothing that moves during playback writes the DOM.

### Signature: the info view

Help mode is a fixed bottom status bar: a VT323 "?" badge, the control's name in legend dim, and a plain-language explanation. It is `pointer-events: none`, so it never blocks the stage, and it mounts only while on. On desktop, hover/focus explains; on touch, a tap both activates and explains, and INFO ? toggles the mode.

### VIZ composition controls

Four instrument tabs select the inspector. Motion chooses Fluid folds, Flowing trails or Orbit; Composition chooses Blended or Distinct. Fluid folds and Blended are the defaults. Composition is disabled in Orbit, which uses the selected lane's orbit strength instead. A 0% orbit remains centered; 100% reaches a radius of 32% of the shorter canvas dimension. Scale is independent. Escape restores editing and focus to the selected instrument tab, or returns to the DAW when already editing.

The effect selector offers 24 procedural effects with seeded geometric variations. The range input sets the selected lane's visual scale from 35% to 130%, without changing audio volume. Reroll assigns every lane another seeded effect, starting angle, and variation while preserving motion, blending, scale and orbit strength; repeated effect assignments are valid. Its warm-white fill identifies the main exploration action, and the footer displays the composition seed.

The motion, composition and effect selects and the scale/orbit ranges intentionally retain browser-native interaction inside the styled console panels. This is a VIZ-specific exception to the console's native-appearance prohibition. All interactive controls have 44px minimum height.

**The VIZ Signal Rule.** Real audible-time MIDI updates only the matching lane's pitch and velocity response. Silent lanes draw no artwork. Note releases fade to zero, and stop clears every lane. Muted, zero-volume and non-soloed lanes are hidden using the shared effective-gain law. Reduced motion omits artwork and supplies bounded textual activity summaries.

The composition restores from bitbounce.viz.composition.v2 in localStorage, separate from project saves and undo. Motion and blending changes persist immediately; range changes update live and persist on completion. Old local compositions default to Fluid folds and Blended while retaining their effects and variations. Invalid stored data falls back to the default composition; storage failures leave editing usable in the current session. The retired scene-wide preference is ignored and left untouched.

## Do's and Don'ts

### Do:

- **Do** take every value from `tokens.css`; its own law says "Do not hardcode these values."
- **Do** code state as line form + fill + shape mark + text (notch, hatch, diamond flag, doubled rim, "· EDIT", aria-label), and let hue ride on top as signal.
- **Do** light every surface from the top-left seat: catch-light on top and left walls, dark walls below and right, casts falling down.
- **Do** seat and light a key on the pointerdown frame (instant swap to the seated cap) and lift it on release; digital acknowledgement has zero ramp.
- **Do** keep every text pair ≥ AA: warm white on graphite 16.93:1, ink-on-fill ≥5.17:1, dim legends at 62% ink, never 45%.
- **Do** gate motion in both the CSS media query and the JS path (matchMedia); every animation ships its prefers-reduced-motion twin in the same change.
- **Do** keep the register contract honest: every pitched lane's window always seats exactly `modeSize` COMPLETE rows (any semitone offset, snapped at every rest — boot, steppers, wheel, scroll-end); the readout, the grid aria, and the pixels derive from ONE manifest (the mounted pattern's). OCT changes what a lane SOUNDS (±3 octave clamp, exports follow — the strip on desktop/tablet, the OPTIONS drawer on phone); the register row's OCT/SEMI and window scrolling change what you SEE — never conflate the two in copy, help, or control placement.
- **Do** keep a note's identity its scale DEGREE: window, scroll, and zoom changes re-map rows and runs through the renderer seams (a scale edit relabels rows in place, same-length only) — a note's apparent pitch never changes with scrolling, and runs always ride their row's pixels.
- **Do** zoom by re-fitting geometry (cell/track px through the renderer seams), never a CSS transform — hit-math honesty; the factor clamps [1,2]× the fill, the window keeps exactly `modeSize` complete rows at every factor, and the double-tap reset is consumed before cell activation so it never places or removes a note under it.
- **Do** give touch targets ≥44px: painted in the scrolling stage and overlays (phone grid rows are ≥44px-tall targets by law, grown into the measured leftover up to 64px — the [44,64] fill clamp, 44 the floor), or an invisible ±8px hit strap on the pinned phone chrome (straps meet, never overlap).
- **Do** keep the phone options drawer zero-DOM while closed (it mounts only on open) and keep the register shift rows' bounds honest: disabled at the clamp, aria-live "ROWS a–b OF n" on every change, never a bare recall-only cue.
- **Do** keep floating surfaces inside the viewport and independent of content length (an ellipsized name owns its intrinsic width with `contain: inline-size`; the projects popover stays at its committed width for a 68-codepoint title exactly as for "Untitled").
- **Do** keep every pad live under the pointer on the 2×2 stages, with only the selected grid owning the keyboard tab stop.
- **Do** let a DRAG-CREATED note length become that lane's next placement length (click or Enter). The gate stays the explicit default: editing it clears the memory, as does loading a project.
- **Do** carry the ⟲/→ follow on the SLOT, in shape plus text (the arrow mark, the LOOP/NEXT footer, the tile's "loops" aria suffix) — never hue alone, and never as a mode the transport LOOP switch has to explain.

### Don't:

- **Don't** put warm-white text on a lane-hue fill, or lane-hue text on graphite for info-critical copy (red text only at ≤10px Silkscreen 700).
- **Don't** introduce a new color, a decorative gradient, or an OS-native control appearance. The only permitted gradients are material lighting (grain, panel light, chamfer, pocket, glass glint), built from warm-white or black alpha.
- **Don't** animate an elevation, add a second glow layer, exceed a 3px glow, or run an infinite pulse (the first-run PLAY nudge is the one exception, static under reduced motion).
- **Don't** light the unit from the cursor; the pointer-follow studio light was tried and rejected.
- **Don't** write the DOM from anything that moves during playback. Meters, rolls and strobes are Web Animations or CSS on existing seams, so the gates' mutation set never grows.
- **Don't** paint inside a grid scroller: no per-pad or per-note-bar gradients or insets, and no image background on the scroller. The 128-bar virtualized grids render thousands of pads (measured: fling frames collapsed to 84% over budget).
- **Don't** break the one-page law: at 1440×900 and 1280×800, quadrant content scrolls inside quadrants and the page never scrolls. The phone stage's sticky chrome plus scrolling page is the deliberate exception.
- **Don't** let a decorative addition cost layout px. The status screen takes only leftover width, meters sit in padding, ghosts and scans are pseudo-elements, and a tile's follow mark is absolutely positioned inside the tile's own padding so tile widths never move.
- **Don't** give the lane follow footer a content-sized box. It is a FIXED 14px line: the quadrant fill budget subtracts exactly that under the bed, so a footer that grows with its font or text breaks the one-page fit (measured: the floors stopped 8px short of the viewport bottom).


Visualizer phrasing refinement: MIDI observers carry the compiled note hold and release durations without altering audio scheduling. Drums use a sharp outward impulse and rapid decay; bass punches and holds, while lead and chords stretch and evolve through their MIDI gates, then release. Up to 16 overlapping notes per lane preserve long sustains beneath short retriggers. Energy drives deformation and motion speed across all 24 effects without adding geometry or rendering passes. Stop clears the active envelopes; reduced motion omits artwork and retains textual activity summaries. The previously recorded dense-playback performance limitation remains unresolved.


Silence is part of the visual composition: lane artwork exists only during a note and its brief release. Releases fade to full transparency and then skip drawing entirely. Instrument tabs remain available to edit silent lanes; Hide controls leaves only sounding artwork. Muted lanes, zero-volume lanes, and lanes excluded by Solo are hidden immediately. Unmuting waits for the next note instead of replaying a hidden hit.


Permanent motion controls: Fluid folds applies nonlinear folds and ripples inside the geometry. Flowing trails elongates paths and offsets their phase to form moving tails without retaining a framebuffer. Blended puts moving centers in a shared region; Distinct gives them more separation. Orbit retains gradual rotation around a shared center. The selected mode and blending preference persist and survive rerolls. The old motion-study query parameter no longer gates any feature.
