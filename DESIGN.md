<!--
Refreshed 2026-09-11 by $impeccable document (closing refresh, scan mode) for
the finishing phase of ultron-supreme iteration 6 (saved-song management,
auto mode: choice recorded as `simulated (auto mode)` — refresh). This
refresh captures iteration 6's shipped projects law: every saved row in the
PROJECTS popover carries always-visible RENAME/DELETE machined keys; the
rename editor and the drums-red CONFIRM DELETE REPLACE the row's content
(the popover never widens for a special state); song titles run one shared
normalizer (trim + whitespace-collapse + 48 CODE-POINT clamp, duplicates
allowed); delete-ACTIVE retargets autosave to a successor before the row is
removed, and the sticky DELETED toast carries a one-shot byte-exact UNDO.
The closing critique's refinement (i6-crit1 A1) is now DESIGN LAW: the
popover's width is independent of song-title length — the ellipsized name
owns its intrinsic width (`contain: inline-size`; a 68-codepoint title keeps
the popover at its committed 320.4px phone width with every edge inside the
viewport), and floating surfaces carry the world's 2px focus ring on
keyboard focus (the popover rows' `outline: none` was the only suppression
in the codebase — removed). Layout/interaction additions only: palette,
typography, and corner language are untouched; the frontmatter tokens are
unchanged.
Prior refresh 2026-09-10 by $impeccable document (closing refresh, scan mode) for
the finishing phase of ultron-supreme iteration 5 (phone horizontal grid fill,
auto mode: choice recorded as `simulated (auto mode)` — refresh). This refresh
captures iteration 5's shipped phone fill law: the exact-fraction width-fit
(cells = (well − label − (n−1)·gap)/n, clamp [15,24] — a 1-bar row fills the
well 100% with zero dead-right edge; 2-bar keeps the 15px floor + internal
scroll), the [44,64] grown row tracks (44 stays the finger-size floor), and
bottom ownership (the stage's grow chain docks the card bottom to the viewport
bottom at scroll end) — superseding the i4 record of 44px rows + ~35% grid
share (now measured 52.1/49.5/56.7% at 390/360/430). Layout/interaction
iteration only again: palette, typography, and corner language are untouched;
the frontmatter tokens are unchanged.
Prior refresh 2026-09-10 by $impeccable document (closing refresh, scan mode) for
the finishing phase of ultron-supreme iteration 4 (mobile UI rework, auto mode:
choice recorded as `simulated (auto mode)` — refresh). This refresh captures
iteration 4's shipped phone law: KEYS/INFO removed from the phone stage, the
centered always-visible transport, the collapsible options drawer, the phone
one-octave register window with ±octave/±semitone shift rows, the register-
change feedback cue, and the 44px finger-sized row law. As with iterations 2
and 3, this was a layout/interaction iteration only: palette, typography, and
corner language are byte-identical — the frontmatter tokens are unchanged; the
drift was in the Layout phone paragraph (the full-manifest page-scroll law that
M-5 retired) and the phone surface prose below it.
Prior refresh 2026-09-05 by $impeccable document (closing refresh, scan mode) for
the finishing phase of ultron-supreme iteration 3 (v0.2). Qualitative language
(North Star, color names, elevation/component philosophy) carried from the
incumbent file via the auto-mode simulated-user proxy (.impeccable/surfaces/
route.md + PRODUCT.md). World facts extracted from src/styles/ and
src/components (tokens.css is the law; unchanged since v0 by recorded
decision — iteration 3 was again a layout/interaction iteration only;
palette, typography, and corners are byte-identical).
FOLD NOTE: the working tree carried the prior iteration-2 closing refresh
UNCOMMITTED (DESIGN.md + .impeccable/design.json were deliberately held out
of the 76bc5da docs sweep). That refresh is folded into this one deliberately
— its content (the responsive stage family, touch gestures, the help tap
model, the rail PAT distill, the FX console affordance) is preserved below,
plus the v0.1 closing finishing pass (machined static paint). This refresh
adds iteration 3's shipped surfaces: the equal register windows + OCT
transpose controls, the blank-clip rail `+`, the 128-bar length vocabulary
on virtualized windowed grids, the per-lane poly-loop sweeps + LCM
one-shot/export law, the full-viewport width law, and the chords-led
poly-loop demo.
-->

---
name: Bitbounce
description: Arcade Stage Floor — a dark stage where four lit LED pad floors play under a sweeping playhead.
colors:
  ground: "#0d0b10"
  ink: "#f5f2e9"
  ink-on-fill: "#0d0b10"
  lane-drums: "#f23d4c"
  lane-bass: "#ffb300"
  lane-chords: "#35d07f"
  lane-lead: "#4da6ff"
typography:
  label:
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
  ui:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  numeric-field:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
  led:
    fontFamily: "VT323, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
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
  booth-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px"
  booth-button-lit:
    backgroundColor: "{colors.lane-chords}"
    textColor: "{colors.ink-on-fill}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px"
  grid-cell:
    backgroundColor: "color-mix(in srgb, {colors.ink} 7%, {colors.ground})"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  grid-cell-on:
    backgroundColor: "{colors.lane-chords}"
    textColor: "{colors.ink-on-fill}"
    rounded: "{rounded.control}"
  stepper-button:
    backgroundColor: "color-mix(in srgb, {colors.ink} 7%, {colors.ground})"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "20px"
  chip-scale:
    backgroundColor: "color-mix(in srgb, {colors.ink} 7%, {colors.ground})"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  fx-module:
    backgroundColor: "color-mix(in srgb, {colors.ink} 5%, {colors.ground})"
    textColor: "{colors.ink}"
    rounded: "{rounded.chassis}"
    padding: "8px 12px 16px"
  info-tag:
    backgroundColor: "color-mix(in srgb, {colors.ink} 8%, {colors.ground})"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "2px 5px"
---

# Design System: Bitbounce

## Overview

**Creative North Star: "Arcade Stage Floor"**

The whole screen is a dark stage. Four lane quadrants are LED pad floors that light as they sound under a sweeping playhead light bar; the transport is the booth — a silkscreened chassis bolted across the top; per-lane FX chains open as lit console modules inside the selected quadrant. Teenage Engineering-style silkscreened labels carry print-level craft: every control is named, uppercase, tracked, and machine-honest. The palette is deliberately tiny — a near-black ground, four lane hues, and one warm white — and every glow is a decoration laid over fill+border+shape state coding, never a substitute for it.

The register is industrial-playful: arcade hardware, not arcade carnival. Nothing pulses at rest, nothing gradients, nothing borrows OS-native chrome (the sliders are custom-drawn chassis parts, not native thumbs). Density is instrument-grade — the whole DAW fits one page at 1440×900 — and the constraint is the charm.

Iteration 2 (v0.1) rebuilt the layout into 2×2 lane quadrants, added an Ableton-style info view, and (closing addendum) took the same stage mobile: below tablet width the 2×2 collapses to a single-lane stage behind a lane switcher, with full touch parity — same world, smaller floor. The closing finishing pass machined the static paint only (idle-register amplitude, milled micro-recesses, the normalized type ramp) with zero new motion. By recorded design decision none of this touched the world itself: palette, typography, and corner language are byte-identical to v0.

Iteration 3 (v0.2) made time itself polyphonic. Every pitched lane now shows through the same one-octave register window (the full row manifest one scroll away) with an OCT transpose control beside it; patterns stretch across powers of two from 1 to 128 bars on windowed, virtualized grids; each lane sweeps at its own cycle length, the lanes weaving against each other and re-aligning at the song's LCM — which is exactly the length WAV/MIDI export. The 1400px width cap is retired: the floors fill the viewport at every desktop width, and the first-run demo song is a chords-led 8-bar cycle demonstrating the whole poly-loop law by ear.

Iteration 4 (mobile rework) put the whole instrument in one hand. The phone stage dropped its KEYS/INFO buttons, pinned a centered always-visible PLAY/STOP transport in the chrome, and folded every booth option (LOOP, METRO, VIZ, TEMPO, SCALE, SWING, MASTER) into a collapsible options drawer that renders zero DOM while closed; the phone grid now shows through the same one-octave register window as desktop, moved by explicit ±octave/±semitone shift rows that disable at their bounds and announce every change with a fill+border+shape-coded cue (reduced-motion falls back to the static ROWS readout). Rows grew to 44px finger-sized targets and the gutters condensed, lifting the grid from ~20% to ~35% of the phone viewport. Desktop surfaces are untouched — the existing gates are the fence.

Iteration 5 (phone fill) gave the grid the whole floor. Phone pad rows now fit the measured well width exactly — the exact-fraction cell law (cell = (well − label − (n−1)·gap)/n, clamp [15,24]; a 1-bar row fills 100% of the width with zero dead-right edge, while 2-bar patterns keep the 15px readability floor and scroll horizontally inside the well) — row tracks grow into the measured leftover within [44,64]px (44 stays the finger-size floor), and the stage's grow chain docks the card bottom to the viewport bottom at scroll end (bottom ownership; the phone page-scroll law itself is unchanged), lifting the grid from ~35% to 52.1% of the viewport at 390 (49.5% at 360, 56.7% at 430). Desktop surfaces remain untouched — byte-identical gates.

Iteration 6 (saved-song management) made the library self-managing. Every saved row in the PROJECTS popover grew always-visible RENAME and DELETE machined keys (no hover-only law — touch has no hover); RENAME swaps the row into the rail's inline-edit twin (Enter commits, Escape cancels, blur commits; one shared title normalizer — trim, whitespace-collapse, 48 code-point clamp, duplicates allowed, empty is a no-op), and DELETE arms a deliberate two-step confirm whose danger state (the world's only red) REPLACES the row's content — Escape, click-away, or five seconds stands it down. The completed delete raises a sticky DELETED toast whose one-shot UNDO re-puts the exact held record byte for byte; deleting the working song retargets autosave to a successor first, so a pending flush can never resurrect the row. The popover's width is independent of song-title length (the i6-critique refinement): the ellipsized name owns its intrinsic width, so a 68-codepoint title keeps the committed 320.4px phone popover with every edge inside the viewport.

**Key Characteristics:**
- Dark stage ground; four lane hues carry identity; warm white carries information.
- Silkscreened uppercase labels on every control; mono value readouts are tabular by construction.
- State = fill + border + shape mark (corner notch, diagonal hatch, diamond flag) — never glow alone, never color alone.
- One glow layer max, ≤3px blur, lane hue at 45–60% alpha, decoration-only.
- Flat chassis with 1px ink-mix borders; floating surfaces (popovers, FX overlay) get one offset shadow, not a stack.

## Colors

Six colors, no more — the palette IS the world's law (res-9 contrast table, enforced in review).

### Primary

- **Warm Chassis White** (#f5f2e9): all info-critical text on ground (17.49:1), playhead light bar, focus rings, lit info-mode lamp. The default voice of the interface.

### Secondary (the four lane hues — identity + state)

- **Drums Neon Red** (#f23d4c): drums lane identity. As text: 5.17:1, restricted to ≤10px Silkscreen 700 only; otherwise lives on fills/borders.
- **Bass Console Amber** (#ffb300): bass lane identity; metronome + beat-LED fills; slider-thumb edge accent (10.91:1, any size).
- **Chords Pad Green** (#35d07f): chords lane identity; the PLAY button's lit fill; text selection background (9.77:1).
- **Lead Signal Blue** (#4da6ff): lead lane identity; the LOOP button's lit fill; first-run PLAY nudge border (7.66:1).

### Neutral

- **Stage Ground Near-Black** (#0d0b10): the one background everything sits on; also the ink used on all lane fills.
- **Ink-on-Fill** (#0d0b10): near-black glyphs on ALL lane-hue fills (5.17–10.91:1) — the same value as ground, named separately because the law differs.

### Named Rules

**The Ink Law.** (1) Filled cells and lit buttons set glyphs in ink-on-fill, never warm white on lane fills. (2) Info-critical text is warm white on ground — never lane-hued, never dimmed. (3) No lane-hue text on lane fills. (4) Red text ≤10px, Silkscreen 700 only.

**The Six-Color Rule.** No new color enters the stage without a lane to own it. Tints and dims are `color-mix()` of ink or a lane hue into ground — never new hex values.

## Typography

**Display Font:** Press Start 2P (IBM Plex Mono fallback) — reserved; 16/24px+ only, never 10–14px. Currently loaded (`font-display: optional`) but not applied by any shipped component CSS.
**Body/UI Font:** IBM Plex Mono (ui-monospace fallback)
**Label Font:** Silkscreen (IBM Plex Mono fallback)
**Value Font:** Departure Mono (IBM Plex Mono fallback)
**LED Font:** VT323 (IBM Plex Mono fallback)

**Character:** All-mono, five faces, one voice: silkscreen prints (labels), terminal readouts (values), service-manual prose (help/UI text), and vacuum-fluorescent LEDs (big numerals). Self-hosted latin subsets, ≤50 KB total (~44.6 KB committed).

### Hierarchy

- **Label** (700, 10px/1, +0.05em uppercase tracking, Silkscreen): chassis silkscreens — lane names, booth groups, button text.
- **Value** (400, 11px/1, Departure Mono): live readouts — BPM, pattern counts, FX params; monospaced = tabular, no tabular-nums needed.
- **UI/Body** (400, 13px/1.5, IBM Plex Mono, always warm white): help-mode prose, toasts, banners.
- **Numeric field** (500, 13px/1.2, IBM Plex Mono, tabular-nums): off-grid numeric inputs.
- **LED** (400, 22px/1, VT323; 20–24px only): position readout, tempo field, help title.

### Named Rules

**The Size-Law Rule.** Each face has a size band it may never leave: Silkscreen 10–12px, Departure Mono 11px, Plex Mono 13–14px, VT323 20–24px, Press Start 2P 16px+ in multiples of 8. Glow on text only ≥18px.

## Layout

One page, one screen, no page scroll — the one-page law (desktop): at 1440×900 and 1280×800 the booth, the pattern rail, and all four lane quadrants with their control strips fit the viewport exactly (browser-asserted; long patterns scroll INSIDE quadrants, never the page). The shell is a fixed-height (100dvh) flex column: sticky booth chassis (1px ink border-bottom + soft drop shadow) on top; the compact single-line pattern rail under it; a 2×2 quadrant grid (`grid-template-columns: 1fr 1fr`, 8px gutter) filling the rest edge to edge — the former 1400px cap is retired (v0.2): the floors fill the viewport width at every desktop width (≥95% width utilization browser-asserted at 1280, 1440, and 1920), and width growth buys more visible steps before a grid's internal h-scroll, never bigger cells — the committed cell scale is the readability law. Each quadrant is a lane floor: a two-tier control strip (compact row always operable: preset stepper, VOLUME, MUTE, SOLO; edit row — scale chip, GATE, FX — only in the selected quadrant) above the pad grid. Reading order: drums · bass / chords · lead. Spacing rhythm is a 2px-base scale (2/4/8/12/16/24/32/48).

The stage is responsive across three device classes (one `stageMode()` seam decides, the layout itself stays one law per class): **desktop** (≥1024×600) is the 2×2 quadrant stage above — pointer + keyboard, one-page at both committed viewports, quadrant rows flex within the 100dvh budget down to per-lane readability floors (drums 20px / pitched 11px tracks) when a real deficit demands it, never on provisional font metrics. Since v0.2 every pitched lane's grid shows through one equal one-octave REGISTER WINDOW (the lane's scale-mode row count, view state only — never a document field, never undo history); the full row manifest stays one scroll away (Shift+arrows move the window, announced "VIEW … ROWS a–b", focus never moves), and patterns longer than 64 steps render virtualized — the visible column window sits inside a pattern-wide scroll extent, so the grid reads as one long floor while the DOM stays bounded. **Tablet** (768–1024) is a responsive scale of the same 2×2 stage, still one page, register windows included. **Phone** (<768, or <1024 with height <600 so a rotated phone keeps the phone law) collapses to a single-lane stage: the quadrant selection becomes a lane-switcher tab row above one sticky `.phone-chrome` block whose centerpiece is the always-visible, horizontally centered PLAY/STOP transport (never scrolls away); KEYS/INFO do not render on phone at all (a render guard, not a hide). Every booth option that the thin chrome sheds — LOOP, METRO, VIZ, TEMPO, SCALE, SWING, MASTER — lives in a collapsible OPTIONS drawer under the chrome, built from the shared BoothOptions parts, mounting zero DOM while closed. Since iteration 4 the phone pitched grids show through the SAME one-octave register window as desktop (the `registerWindowStarts` seam — the full-manifest page-scroll law is retired); the window moves only by explicit REGISTER shift rows (OCT −/+ whole octaves, ST −/+ semitones) that disable at their clamps and confirm every change with an aria-live "ROWS a–b OF n" readout chip plus a transient fill+border+shape-coded direction cue (▲/▼; never stamped under reduced motion). Since iteration 5 the phone grids FILL the measured well: cell width is the exact fraction (well − label − (n−1)·gap)/n clamped to [15,24]px, so a 1-bar row spans 100% of the width with a 0px dead-right edge (cells 17.6/15.7/20.1px drums and 18.3/16.4/20.8px pitched at 390/360/430), while 2-bar patterns keep the 15px readability floor and scroll horizontally inside the well; rows are finger-sized targets grown into the measured leftover, clamped [44,64]px (44 the floor law), and the stage's grow-only flex chain gives the card bottom ownership of the viewport bottom at scroll end (Δ0 — the page-scroll law is unchanged). The grid owns ≥47.5% of the viewport at 390×844 (measured 52.1/49.5/56.7% at 390/360/430) and the chrome stays <50% of viewport height. Touch is a first-class input everywhere (see Components); the phone scroll-vs-gesture law is per-origin `touch-action` (vertical pan stays the browser's from anywhere; horizontal on gesture surfaces is reserved for editing drags).

## Elevation & Depth

Flat stage, tonal layering. Surfaces differentiate by `color-mix()` of ink into ground (4–12%), not by shadow stacks. Exactly two shadows exist: the booth's soft drop (`0 2px 8px rgb(0 0 0 / 60%)`) and the floating-chassis offset (`4px 4px 12px rgba(0,0,0,0.55)`) used by popovers and the FX overlay — an arcade-cabinet cast, one layer, no ambient bloom. Glow is NOT elevation: it is a ≤3px decorative halo on triggered cells and lit buttons (lane hue 45–60% alpha, ≤180ms one-shot decay, no infinite pulses except the first-run PLAY nudge, which goes static under reduced motion).

### Shadow Vocabulary

- **Booth drop** (`0 2px 8px rgb(0 0 0 / 60%)`): the transport chassis floats above the stage. The only downward ambient shadow at rest.
- **Chassis cast** (`4px 4px 12px rgba(0,0,0,0.55)`): popovers (scale, FX add, projects) and the FX console overlay — offset, hard-ish, single layer.
- **Module lift** (`0 2px 4px rgba(0,0,0,0.45)`): FX modules inside a chassis.

### Named Rules

**The Decoration-Only Glow Rule.** Glow never counts toward contrast and never substitutes for it; glow is never the only state signal; exactly one glow layer, ≤3px blur, lane hue 45–60% alpha; no glow on text <18px; trigger glow decays ≤180ms.

## Shapes

Square-ish hardware geometry: the corner vocabulary steps with importance — 1px hairlines (beat LEDs, slider thumbs' inner edge), 2px beat LEDs, 3px controls and grid cells, 4px chassis (booth buttons, quadrant floors, FX strips/modules), 6px floating popovers/overlays. Cells carry a shape language of state: the on-state clips an 8px corner notch (bottom-left), sustained note-tails render a 135° diagonal hatch, the euclid/drag preview is always a 2px dashed lane-hue outline (never the committed fill), and pending pattern switches fly a diamond flag. The playhead is a 2px warm-white light bar with a 3px halo, compositor-moved (transform only).

## Components

Every component is a labeled hardware control: outline chassis at rest, lit lane-hue fill when active, ink-on-fill glyphs, 2px warm-white focus ring always visible.

### Buttons

- **Shape:** 4px radius (booth-grade) or 3px (control-grade), 1px ink-mix border
- **Primary (chassis):** transparent ground, warm-white Silkscreen label, 1px 40%-ink border, padding 8px 12px
- **Lit state:** lane-hue fill + 2px hue border + ink-on-fill text + one ≤3px glow (PLAY=green, LOOP=blue, METRO=amber; INFO lit = warm-white fill — a stage-global mode, deliberately not a lane hue)
- **Hover/Focus:** 2px solid warm-white outline, offset 1–2px; focus never glow-dependent

### Chips

- **Scale chip:** 3px radius, 7%-ink fill, warm-white value text ("PROJECT · C min" / "LANE · D dorian"), 22%-ink border; opens the 6px scale popover

### Cards / Containers

- **Quadrant lane floor:** 4px radius, 1px 12%-ink border; selected = 55% lane-hue border + 3% hue fill tint + "· EDIT" text word; view-only quadrants dim but keep every pair ≥ AA
- **FX module:** 4px radius, 5%-ink fill, 2px 60%-lane-hue border when active, dimmed chassis when bypassed; draggable (cursor: grab); inside the overlay chassis
- **FX console overlay (chassis):** opens INSIDE the selected quadrant, pinned below the whole control strip (never over its own toggle/scale chip/GATE) — an opaque-ground console chassis (6px radius, 1px 25%-ink border, the popover vocabulary + one chassis cast) with a sticky title strip: lane-hue LED + Silkscreen name ("DRUMS FX") + a CLOSE button in the `.fx-mod-btn` control language; internal scroll, never grows the page. The empty console is visibly open. Page-level Escape closes it (slotted: KEYS modal → help mode → inline edits/popovers → FX console → region-head pops).

### Inputs / Fields

- **LED input (tempo):** VT323 22px, 6%-ink fill, 4px radius, centered, 5ch
- **Sliders:** custom chassis parts — 4px 2px-radius track (14%-ink) + 10px square warm-white thumb (1px radius) with an amber edge accent; identical language in booth and FX strip
- **Steppers:** 20px square 3px buttons with lane-hue border accent (35%), 7%-ink fill — the one stepper vocabulary serves preset stepping, the per-lane OCT −/+ transpose (popover-free in the lane header; one octave per press, clamped −3/+3, undoable, exports follow — the fence is explicit: OCT changes the octave a lane SOUNDS, Shift+arrows scroll the octave you SEE), and the pattern LENGTH ladder (BARS 1·2·4·8·16·32·64·128; grow always works, shrink refuses while a note would be lost past the new end, naming the blocking note)

### Navigation

- **Phone chrome (iteration 4):** centered PLAY/STOP transport flanked by the lane-switcher tabs and an OPTIONS trigger; the drawer that opens is the shared BoothOptions in the committed chassis vocabulary (6px floating-surface radius, chassis cast, internal scroll, Escape closes), and the REGISTER shift rows (OCT/ST steppers + ROWS readout chip) sit directly under the chrome in the stepper language — one control voice, no phone-only idiom.

- **Projects popover (iteration 6):** the booth-corner PROJECTS button opens the library chassis (the scale-pop twin treatment: metal panel, 6px radius, one chassis cast, 232px min-width capped by the viewport). Every saved row is a machined key (name + relative-time meta, the working song border-marked and `aria-current`) with ALWAYS-VISIBLE RENAME/DELETE keys — no hover-only controls. Special states REPLACE the row's content, never widen the popover: the rename editor is the rail's inline-edit twin in a recessed readout well (Enter/Esc/blur; focus+select on mount), and the CONFIRM DELETE state is a full-width drums-red danger key. Titles run one shared normalizer (trim + collapse + 48 code-point clamp, duplicates allowed); the popover's width never depends on title length — the ellipsized name owns its intrinsic width, keeping the committed 320.4px phone width for any title. Deleting the working song switches to the successor (most-recent remaining, else a fresh NEW) before the row is removed; the sticky DELETED toast carries a one-shot byte-exact UNDO (a failed re-put keeps the toast armed). Keyboard contract as the popover family: Escape closes (gated while an editor or confirm is open — Esc cancels THAT state only), Tab is trapped with the editor in the cycle, focus lands on the first row on every open and returns to the button on close; every control keeps the 2px focus ring on keyboard focus and paints ≥44px on phone.

- **Pattern rail:** single-line rows per lane carrying lane name + tiles + `+` (one press creates a NEW blank pattern — next letter, 1 bar — appended to the chain and selected for editing; the `=` key on a focused tile is the twin; DUP, in the PAT popover and on `d`, stays the only duplicator) + ONE small PAT trigger (Silkscreen label, `.rail-tool`, ~45px) opening the pattern-tools popover (REN/+1B/+2B/+4B/DUP/RM in the committed popover vocabulary — 3×2, focus lands on REN, actions commit and close, Escape returns to the trigger; the `n`/`d`/`r` keyboard fast paths are unchanged); the row's group name carries the lane's cycle length ("… · 8-BAR CYCLE") — the lane's total chain bars, the vocabulary that makes unequal lane lengths readable at a glance. Tiles are 3px chips with bar-length literal fill width; active = lane-hue border+fill on the slot SOUNDING now — the tile follows each lane's chain position as it advances naturally during playback (switches, natural advance, and the stopped park all light the same state) and parks on the last-sounded slot while stopped; pending = dashed border + diamond flag (10px, the label floor) + aria text; drag-sweep cues many lanes at once (last-touched tile each). Phone inherits one PAT per row (the condensed rail keeps the same distill).

### Signature: the sounding grid

The product's focal moment: scale-locked pad rows whose cells fill with the lane hue as they trigger, sustain tails hatched, the 2px playhead sweeping across all four quadrants live (including the three view-only ones) — each lane's sweep wrapping at its OWN cycle length (v0.2: the poly-loop law), so lanes of different lengths weave against each other and re-align at the song's LCM; WAV/MIDI export renders exactly one full LCM cycle, loop-perfect by construction. Note duration reads as literal cell width (`.note-run` bars over the grid). Reduced motion replaces the sweep with a quantized column highlight + "BAR n · BEAT n" text readout.

### Signature: the info view

Help mode is a fixed bottom status bar (HP-1): ground chassis, 1px ink border-top, VT323 "?" badge + Silkscreen control name at the 62% dim-legend mix, warm-white plain-language text. `pointer-events: none` — the mode explains the stage without ever blocking it; mounted only while on. Input model: desktop = hover/focus explains the control; touch = TAP IS INSPECT-AND-ACTIVATE (one tap both activates the control and shows its explanation; re-taps no-op the explain; INFO ? is the touch enter/exit; phone hint "TAP INFO ? TO EXIT").

## Do's and Don'ts

### Do:

- **Do** take every value from `tokens.css` — the file's own law says "Do not hardcode these values."
- **Do** code state as fill + border + shape mark + text equivalent (notch, hatch, diamond flag, "· EDIT" word, aria-label).
- **Do** keep the register contract honest: every pitched lane defaults to the same one-octave register window; OCT changes what a lane SOUNDS (±3 octave clamp, exports follow), window scroll changes what you SEE — never conflate the two in copy, help, or control placement.
- **Do** keep every text pair ≥ AA by the res-9 table (warm white on ground 17.49:1; ink-on-fill ≥5.17:1; dim legends at 62% ink = 7.00:1, never 45%).
- **Do** gate motion in BOTH CSS media query and the render loop via matchMedia; honor `prefers-reduced-motion` by construction (static states, text readouts).
- **Do** keep floating surfaces inside the viewport law: overlays never grow the page.
- **Do** give touch a target ≥44px: painted ≥44px in the scrolling stage/overlays; phone grid rows are ≥44px-tall targets by law, grown into the measured leftover up to 64px (the [44,64] fill clamp — 44 stays the floor); the pinned phone booth stays compact behind invisible ±8px hit straps (straps meet, never overlap); sliders take a 44px input-height hit; the euclid overlay sizes to content within the grid scrollport and SPREADS drum rows when revealed (no rail-on-rail stacking).
- **Do** keep the phone options drawer zero-DOM while closed (it mounts only on open) and keep the register shift rows' bounds honest: disabled at the clamp, aria-live "ROWS a–b OF n" on every change, never a bare recall-only cue.
- **Do** keep every floating surface's width independent of its content's longest unwrapped string: an ellipsized name must own its intrinsic width (`contain: inline-size` on the nowrap span — `min-width: 0` is a floor, not a ceiling), and the projects popover stays at its committed width for a 68-codepoint title exactly as for "Untitled" (gated with a long-titled seeded row).

### Don't:

- **Don't** put warm-white text on a lane-hue fill, or lane-hue text on ground for info-critical copy (red text ≤10px Silkscreen 700 only).
- **Don't** add a second glow layer, a glow >3px, or an infinite pulse (the first-run nudge is the one sanctioned exception, static under reduced motion).
- **Don't** introduce a new color, gradient, or OS-native control appearance (custom slider parts are the committed answer to native thumbs).
- **Don't** break the one-page law on desktop: at 1440×900 AND 1280×800 (and the floors filling the viewport width at every desktop width — 1920 included), quadrant content scrolls inside quadrants; the page never scrolls (the phone stage is the deliberate exception — sticky chrome + scrolling grid is its law).
- **Don't** restyle the world for a layout need — iteration 2's own non-goal: palette, typography, corner language stay untouched; layout problems get layout answers (the mobile slice obeyed: one seam decides the stage, no new tokens; iteration 3 obeyed too: full-viewport densification, register windows, and virtualized long grids changed layout only — no token moved).
