# Instrument workspace

Scope: DAW EDIT panels, shared chrome, and light/dark visual tokens. Mode: Operate.

## Direction contract

THESIS: Preserve the current four-panel desktop and single-lane phone workflow; give the grids visual priority with consistent control positions.

OWN-WORLD: User selected a combination of prototype B Vector and C Alloy. Sharp, compact geometry and clear sans-serif labels are shared. Dark mode uses near-black fields and bright instrument colors; light mode uses cool silver surfaces, dark ink, and saturated notes. Crisp inset musical displays and one audible signal line per lane define the hybrid treatment; grain and redundant decorative animation remain retired.

STORY: Select an instrument, compose scale notes, change the visible register freely, adjust sound, and arrange or visualize the same song.

FIRST VIEWPORT: Transport and theme selector above the existing four instrument panels. Sound and mix controls share a consistent header; gate/scale/FX share a second row; pitched lanes have octave/semitone navigation adjacent to the grid. Phone preserves existing navigation and uses larger touch controls.

FORM: Explicit user-selected blend of rendered Vector and Alloy prototypes supersedes the earlier schematic round, seed 468b71e9. Code-led. Playback motion remains musical and reduced-motion aware. Theme persists locally outside project data.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Pitch contract: scale notes only, viewport movement in one or twelve semitones, real MIDI range boundaries, stable note identity, no document writes when browsing, valid placement and save/export in newly reached registers.

Pitch orientation: all pitched grids place higher MIDI pitches above lower pitches. Display ordering never rewrites stored note degrees.


Approved overdrive: hybrid performance console with supplied Bitbounce emblem and wordmark, locally hosted distinctive titles, inset tempo/position displays and audible-note-driven header signal lines. Dark luminous; light polished silver. Preserve current navigation, MIDI orientation, note identity and reduced-motion support.

## Hybrid performance console closeout

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
