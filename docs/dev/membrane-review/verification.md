# Membrane verification

Completed locally on 2026-09-12. This is implementation verification, not a deployment record.

- TypeScript and ESLint pass for changed application modules.
- All 90 unit files have passed across the full run and targeted recovery: 89 files / 1762 tests passed in the full run; the initially failing help-language file then passed all 14 tests after guarding color initialization against its partial DOM stubs. The 4 track-color tests were also rerun and passed. Total unit coverage is 1776 tests.
- Browser happy path and VIZ composition: 9 tests pass.
- Pitch direction, keyboard editing, both themes and complete seven-row phone windows: passes after reserving the mobile autosave area.
- Dense phone playback/editing/scroll and wide 1920px playback performance: both pass their existing >=95% frames below 33.4ms gates. Uses the existing renderer and audio timing.
- Manual browser checks cover 1440x1000, 1280x800, 390x844, dark and light, note editing, populated FX, add/close FX, arrangement navigation, swatches and VIZ colors. Desktop has no page overflow. Browser runtime reported no errors in the final checks.
- Phone status: exactly one autosave indicator, none in the transport, centered at x=195 in a 390px viewport. At 390x844 the lane footer ends at y=789 and the status begins at y=797, with no page overflow. Status remains accessible and includes its timestamp.

## Older assertions not passing

Two quadrant-layout tests still assert the retired full-DOM 7/15-row manifests and exact 24px tracks. The current editor virtualizes the full pitch domain. A browser check with Membrane CSS removed still reports `BASS grid · VIEW ONLY · ROWS 47–53 OF 74`, contradicting the test's old `BASS grid · VIEW ONLY` expectation. Exact track dimensions also need reconciliation with the approved layout's fit range; these legacy tests are not reported as passing.

One mobile-options cross-surface case expects `ROWS 6–12 OF 14`, then `ROWS 8–14 OF 14`. The actual current readout is musical pitch (`A♯4 – A5`), including with Membrane CSS removed. The other two mobile-options tests passed. This older case needs migration to the pitch readout contract.

The tests were not weakened during the visual implementation. The newer pitch-direction suite validates pitch identity, octave navigation, keyboard edits, theme changes, row completeness and viewport fit.

## Header review fixes

Four lane meters now use two rows with full instrument names. Desktop navigation exposes Edit notes and Song arrangement with an active state. The status display ignores VIZ controls and resets on visualizer transitions.

Browser checks at 1438x1272 and 1280x800 confirmed every meter is inside the display, Song navigation opens the arrangement, and returning from VIZ restores LOCAL SESSION / READY. A 390x844 check confirmed the phone header has no horizontal overflow. TypeScript, changed-source ESLint and the production build passed.

