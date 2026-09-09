---
version: 3
slug: "route"
primary_target: "route:/"
related_targets: []
---

Scope: the DAW main screen — the app's single surface (transport booth, pattern rail, the 2×2 lane-quadrant stage, FX console overlays, info view, project actions). Visitor mode: Operate.

Audience & job: a solo game-dev / hobbyist at a desktop, making loop-perfect game music without music theory (primary: the builder themself; public slice later). Task: press play on the demo loop, survey the whole song at a glance, select a quadrant and edit its scale-locked grid, tweak any lane's controls or FX live while the loop runs, arrange pattern chains, export WAV/MIDI. Proof: the sounding grid itself — every interaction is audibly and visibly musical; no marketing surface exists.

Chosen direction: Arcade Stage Floor. The whole screen is a dark stage; lanes are LED pad floors that light as they sound under a sweeping playhead light bar; the transport is the booth; FX chains are lit console strips beside each lane. Pixel-inspired palette (~6 colors: near-black ground, four lane hues, warm white); Teenage Engineering-style silkscreened chassis labels carry print-level craft; industrial-playful, never gamified-carnival.

Memorable moment: the sounding grid — cells pulse on trigger under the sweeping playhead, live in all four quadrants at once; the whole song is visible while it plays.

Named raises kept from declined challengers: song sections read as named cue states (labeled, text-equivalent, never color alone); collapse-to-pattern / expand-to-chain views never lose your place; note duration reads as literal cell width.

Interaction intent: everything happens while the loop runs — quantized pattern switches with pending indication; scale-override affordance: each lane header carries an effective-scale chip ("PROJECT · C min" vs "LANE · D dorian"), one action to detach or return to project scale; keyboard operability is first-class (ARIA grid, arrows + toggles); contrast discipline survives the glow (shape/pattern coding, reduced-motion honored).

Iteration-2 surface record (v0.1, 2026-09-02/03 — layout/interaction iteration; the visual world is unchanged by recorded decision):

- **2×2 lane quadrants (I2-1, LY-1)**: the stage splits into four quadrants in reading order (drums · bass / chords · lead), one per lane. Each quadrant holds a two-tier control strip — the compact row (preset stepper · VOLUME · MUTE · SOLO) present and operable in ALL four quadrants; the edit row (scale chip · GATE · FX) only in the selected one. The selected quadrant's grid is editable (lane-hue border + fill tint + "· EDIT" word); the other three render view-only with live notes/playhead (playhead liveness is perf-pinned per quadrant). Quadrant selection IS the lane selector; view-only grids ignore cell clicks (no traps, no focus loss). One-page law: booth + rail + all four quadrants fit 1440×900 with zero page scroll (browser-asserted); long patterns scroll inside quadrants.
- **Drag interactions (IN-2, IN-4)**: pitched lanes create sustained notes by press-drag (one dashed preview during the gesture, one commit on release), edge-drag (≤5px inside the right edge) and keyboard ± resize; drums drag-paint hits. Single click keeps the lane-gate default length.
- **Multi-clip cueing (IN-3)**: one sweep across rail tiles cues every touched lane at its last-touched tile, all landing on one quantized boundary ("QUEUED n LANES"); keyboard twin = Shift+arrows range + Enter CUE ALL.
- **Info view (HP-1/HP-2)**: booth "INFO ?" toggle + global `i` light a fixed bottom status bar (pointer-events: none — it never blocks a click/drag) showing plain-language, music-first help for the hovered/focused control; Escape exits first; zero DOM/listeners when off (perf-pinned). 80 registry entries across 12 components; anti-rot coverage gate.
- **FX console as overlay chassis (LY-1)**: the per-lane FX strip opens as a 6px-radius overlay INSIDE the selected quadrant (internal scroll, never grows the page) — opening a strip no longer hides the other lanes.
- **Sample-backed voices (PS-1..PS-4)**: 12 synth presets/lane + 10 synth kits + 6 sample presets + 4 sample kits (33 CC0 OGGs, 345 KB, lazy same-origin, PROVENANCE-pinned); sample presets audition-await their assets (≤1 interaction).

Unresolved decisions: ~~exact palette hex values and pixel face~~ resolved at build time inside the committed world (tokens.css is now the law; DESIGN.md + .impeccable/design.json record it). Open: quadrant-scale grid readability at 1440×900 (the i2-AC#1 pending-human half); freesound preview→original swap (wizard-lane).

Closing surface record (v0.2 shipped, 2026-09-04 — refinement queue + mobile slice; the visual world is unchanged by recorded decision, tokens/typography/corners byte-identical):

- **Refinement outcomes folded into the surface (entries 1–7):** the FX console is now a real console — pinned below the whole control strip, opaque chassis + lane-hue LED title + CLOSE, page-level Escape slotted (KEYS → help → inline → console → region pop); the euclid fill rail is pinned 220px so SET self-hits; LOOP re-enable re-arms the compile cursor (no dead-air-while-playing); the one-page law holds exactly at 1440×900 AND 1280×800 (quadrant rows flex to per-lane floors: drums 20 / pitched 11px); the rail's six-tool row distilled behind ONE 45px PAT trigger per lane (popover vocabulary; `+` stays with the tiles; `n`/`d`/`r` unchanged); the rail's active tile now FOLLOWS the sounding pattern (natural advance + stopped park, announced like a switch); tile flag 10px (the label floor).
- **Responsive/mobile stage (MB-1..6, town-hall mobile addendum m1–m5):** one `stageMode()` seam — desktop ≥1024×600 (2×2 quadrants, byte-identical to pre-mobile builds), tablet 768–1024 (responsive 2×2), phone <768 or <1024×<600 (single-lane stage: lane-switcher tabs = quadrant selection, ONE sticky `.phone-chrome` <50% viewport height, scrolling grid — rows vertical, 2/4-bar horizontal, 1-bar default view; page never h-scrolls). At the phone stage the VIZ surface (the visualizer second page, VZ-DD-4) is a GATE: a centered message ("THE LIGHT SHOW RUNS ON A LARGER SCREEN") + a ≥44px EXIT — the committed desktop-first fallback; zero engine footprint over the mobile stage, live viewport flips boot/dispose cleanly, and the wide stage (≥768) keeps the full show unchanged.
- **Touch interactions (m1/m3):** full editing parity by touch — tap place/remove, drag-create, edge-resize, drums paint, rail sweep, euclid FILL reveal→arm→SET, MIX/FX/exports/projects; per-origin `touch-action` (vertical pan = browser's from anywhere; horizontal on gesture surfaces reserved for editing); double-tap = rename/cue edit; no edit-mode toggle, no hover-only functionality.
- **Help tap model (m3):** touch tap = inspect AND activate (one tap does both; INFO ? is the touch enter/exit; phone hint "TAP INFO ? TO EXIT"); desktop hover/focus unchanged.
- **Touch targets (m2):** ≥44px painted in the scrolling stage/overlays; the pinned booth stays compact behind invisible ±8px hit straps; sliders 44px hit; euclid overlay clamps to the grid scrollport and spreads drum rows; position/beat LEDs condense away at phone (SR announcements continue).
- **Resilience/perf/gates (m4/m5):** rotation/visibility recovery + first-touch unlock pinned by trusted gates (no source change needed — laws held); frame budget gated at 390×844 (0 frames over budget at phone worst case; CI-emulation caveat documented, real-device verification stays with the user); m1–m5 gate matrix = docs/dev/definition-of-done.md §6.

Shipped-state open items: unchanged (i2-AC#1 quadrant readability human half; freesound wizard-lane; iOS Safari warn-banner stance; real-device perf).
