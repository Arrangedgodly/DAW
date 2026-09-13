# R4 current instrument names

Status: implemented; finish reviewer disposition `ship`; independent verifier `PASS`. R1–R3 remain approved.

## Naming policy

Simulated (auto mode), derived from the approved finding: use current visible category first, then the stable track number. For example, `Keys, track 4` and `Keys, track 8` remain distinguishable when both use Keys presets. Musical IDs and visible category titles remain unchanged. The original fixed order assigns Drums=1, Bass=2, Chords=3, Lead=4, extra1–4=5–8.

`createLaneAccessibleNames` reuses the existing reactive display-name source. Editor regions, preset/sound controls, mute/solo, volume, scale/gate, View/Transpose, phone tabs/Options, color controls, lane footer, FX controls and matching Song chain/tool names now use it. The imperative grid renderer has an idempotent `setLaneLabel` method that updates its accessible name while retaining editing/window semantics.

## Files

- `src/state/laneDisplayNames.ts`: shared current-category plus stable-number accessor.
- `src/grid/renderer.ts`: stored current label and name-only setter.
- `src/components/LaneHeader.tsx`, `LaneGrid.tsx`, `PhoneOptions.tsx`, `StageFloor.tsx`, `TrackColorControl.tsx`, `LaneFollow.tsx`, `FxStrip.tsx`, `PatternRail.tsx`: live names where those instrument controls already appear.
- `scripts/verify-r4-names.mjs`: dynamic behavior/DOM/AX probe.

No CSS, IDs, keyboard commands, audio behavior or musical-state handlers were changed. Historical help registry explanations and VIZ composition names are not a whole-product terminology migration.

## Evidence

`evidence.json` contains four passing states: original lead and extra4 at1280x800 and390x844. Each state switches Keys→Bells→Keys and checks:

- Region, visible title, imperative grid, preset, mute and solo names follow each change immediately.
- Exactly three musical document writes occur for the three intended preset changes; naming adds none.
- Pattern identity remains unchanged.
- The grid DOM node remains the same for the selected same-pitch-domain presets.
- One roving gridcell tab stop remains; the grid name retains EDITING and its row-window range.
- Phone duplicate categories have distinct accessible tab names (`Keys, track 2/4` or `Keys, track 5/8`). Phone Options Transpose follows the current name.
- Song arrangement chain names match the current category plus track number.

Same-domain fixture: Keys Reed Organ and Bells Vibes both use octave base4. Switching presets with different octave bases already changes the pitch-domain shape key and legitimately remounts the grid. That existing behavior was preserved; this proof does not claim every preset switch retains its grid node.

AX files: `ax-1280-lead.txt`, `ax-1280-extra4.txt`, `ax-390-lead.txt`, `ax-390-extra4.txt`, `song-ax.txt`. Required captures: `final-1280x800-lead.png`, `final-1280x800-extra4.png`, `final-390x844-extra4.png`; additional `final-390x844-lead.png`. Phone images intentionally include scrolling content. All captures use local Chromium and fresh browser contexts.

## Checks

Focused dynamic probe: pass. TypeScript no-emit: pass. Full ESLint: pass. Production build: pass, retaining the existing ineffective dynamic import warnings for persist/newProject.ts and persist/boot.ts. Layout detector: `[]`. Independent verifier reran instrument-feedback and extra-instruments tests:8/8 pass.

Existing broad browser suites with fixed historical instrument-name expectations were not rerun or wholesale rewritten. Earlier R1 phone no-scroll failure remains outside this naming change. No actual assistive-technology speech output, exhaustive screen-reader audit or new audio-performance claim is made; AX snapshots and DOM semantics are the direct evidence.

Task-owned server4194 is stopped after verification. No commit, push or deployment.
