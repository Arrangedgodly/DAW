# Visualizer test migration

The 2026-09-12 redesign replaces the House Lights scene-wide preset UI with the
user-approved per-instrument canvas and inspector. Its old app journeys asserted
removed controls, density phases, node/sprite registries, v1 memory, and a phone
refusal screen. Those journeys have been replaced, not left skipped.

- `viz-composition.test.tsx`: instrument selection, independent effect edits,
  keyboard edits, motion/blending selection, conditional orbit strength,
  saved settings, all effect draw paths,
  reroll coalescing, exit with a pending reroll, renderer/pipeline/announcer
  teardown, hidden-tab parking/resume, reduced-motion pixel stability, draw fault
  containment, desktop/phone fit, axe checks and hide/show controls.
- `viz-composition-journeys.test.tsx`: production bundle, actual playback and canvas
  activity, no additional AudioContext on entry, focus return, reroll during
  playback, stop/idle stability, and persisted composition on a fresh boot.
- `viz-fingerprint.test.ts`: all 24 effects produce distinct reproducible pixels;
  geometric variations alter each effect.
- `viz-composition.test.ts`: data validation, local persistence failures,
  lane-isolated edits, 250 reproducible rerolls, complete library coverage,
  orbit/scale bounds, motion migration, MIDI routing and bounded event state.
- `viz-phrasing.test.ts`: short drum impulses, sustained MIDI gates, finite
  silence cutoff, mute handling, and activity across all effect families.

The existing unit suites for audible-time queueing, pipeline isolation, renderer
lifecycle, and legacy pure effect/preset math remain. The old source-regex teardown
checks in `viz-state-machine.test.ts` were replaced by actual mounted teardown
checks. No unrelated audio or editing tests were removed.

The built-bundle canvas probe is warmed before idle comparisons because repeated
pixel readback can switch Chromium's raster backend and alter anti-aliasing once.
Frame measurements from that probe include readback overhead; they are not a
low-end hardware performance guarantee.
