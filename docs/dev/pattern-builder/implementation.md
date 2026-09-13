# Pattern builder and section launching

Implemented locally on 2026-09-13. No deployment is implied.

## Editing

- Open the rule beneath any arrangement block for Copy, Paste after, Duplicate block, Reuse pattern, and Double ×2.
- Copies contain independent notes. Reuse points at the same pattern. A copied snapshot remains available after its source changes.
- Paste at the lane's end appears after copying. Ctrl/Cmd+C and Ctrl/Cmd+V work on focused blocks. D inserts an independent copy after the selected block.
- Double ×2 is also beside Bars on instrument pages. It repeats all drum rows or pitched notes and preserves note attributes. Each operation is one undo step.

## Live playback

`playbackRules` is optional document data, indexed alongside each lane's song chain. Existing files without it retain Loop/Next behavior. Rules choose bars, repeats, or hold, followed by Next, Previous, Go to, Random other, Return, or Stop lane. Insertion and removal remap destinations. Removing a Go to destination changes that action to Next. Random choices omit removed destinations.

The session applies rules on the musical step clock, without expanding repeated patterns in memory. Exact bar durations can transition inside a longer pattern. Manual jumps take priority. Return remembers the previous playing block. Held progression pauses duration counters while allowing manual launches. Pending chain edits still land when Go to or Hold would otherwise prevent reaching a chain wrap.

`sections` stores optional column names and progression. The shared matrix maintains vertical alignment while scrolling. Headers queue a common launch step for every participating lane. Next bar uses the next unscheduled bar boundary; After current patterns uses the latest participating pattern end. Missing blocks leave their lanes alone. Section durations can queue another column or stop all lanes. Stopping ends new events; existing release tails remain.

WAV export plays each lane left to right using each block’s configured bars or pattern repeats. Held blocks play once. Shorter lanes finish; the longest lane determines the song length, followed by the release and effects tail. Live follow destinations, random actions, and section launches do not change export order. MIDI export lives in block options and the PAT menu, exporting only the selected pattern as a tempo track plus one note track. It preserves the full pattern length, including empty bars, and bounds notes at the pattern end. MIDI includes tempo, swing, scale, octave/transposition, chord stacks, and GM drum mapping; it does not include instrument audio or effects. The transport’s global cycle behavior is unchanged. Recording a live performance remains separate work.

## Verification

Final checks: 100 unit test files passed, 1,839 tests total. The focused arrangement browser regression passed. TypeScript and lint passed for the affected code. The production Vite build passed. The design detector returned no findings for the new controls and styles. Desktop and phone journeys passed with zero scoped WCAG A/AA axe violations and no page runtime errors.

- Store tests cover independent copies, shared reuse, arbitrary length doubling, every drum row, undo, the length limit, destination remapping, validation, and save/load.
- Audio tests use exact step attribution for timed and partial repeats, manual override, Previous, Go to, random choices, fill and return, hold, stop and relaunch, synchronized different-length lanes, missing blocks, section progression, section endings, and queued edits during repeated jumps.
- The existing arrangement browser regression verifies both keyboard D and the pattern-tools Duplicate action insert new blocks.
- `node scripts/check-pattern-builder.mjs` runs the real app at 1280×800 and 390×844 through copy, paste, double, rule editing, keyboard paste, section naming, and Escape focus restoration. It measures column alignment and page overflow, checks runtime errors, and runs WCAG A/AA axe checks over the arrangement and playback panel.
- Browser measurements and checks are in `browser-verification.json`. The adjacent desktop and phone PNGs show the resulting arrangement and playback panel.

The browser script expects the Vite preview at `http://127.0.0.1:5194/` and uses fresh browser contexts, not a personal browser profile.

## Export verification

The export update adds pure MIDI parse-back checks and linear schedule tests, plus real Chromium renders that verify finite repeats, silence after a shorter lane ends, and release audio after the song boundary. The WAV encoder honors the renderer’s exact output sample count. Legacy cycle rendering remains explicitly tested through the render injection seam.

`node scripts/check-pattern-exports.mjs` verifies a real MIDI download from the block panel with keyboard activation at 1280×800 and 390×844, checks the PAT menu control, parses the downloaded file, and runs scoped WCAG A/AA checks. See `export-verification.json` and the adjacent `*-pattern-export.png` screenshots.

Export validation result: 1,845 unit tests passed across 101 files; all 11 targeted Chromium tests passed across linear-export, exportWav, export-busy-guard, and long-render-failure. Desktop and phone download checks passed with zero scoped accessibility violations or runtime errors. TypeScript, affected-file lint, production build, and git diff whitespace checks passed. The four end-to-end journeys have now been repaired and passed together with the export regression tests: 8 Chromium files, 15 tests, in 96.25 seconds. This verifies the selected journeys and export suite, not the entire browser suite. See e2e-verification.log.


## End-to-end journey repairs

The journeys now address controls by stable track identity while checking the current accessible labels. Arrangement bar totals are still asserted separately from the new block-count group labels. Duplicate is expected to insert an independent block. Drum checks cover the 16-row grid and its visible window. The keyboard journey navigates to Song before opening PAT and uses keyboard activation for workspace changes.

The mix journey proves bass attenuation while soloed, then checks that combined mix edits change WAV bytes and restoring the mix restores identical bytes. This replaces the unsupported assumption that muting one lane must reduce the full mix RMS by ten percent. Pattern MIDI remains identical across mix edits. The arrangement journey checks exactly 12 linear bars plus the known effects tail and a single MIDI note at the selected pattern’s origin. Save/reload and migrated-project checks remain active.

Affected test lint, TypeScript, and patch whitespace checks passed. No application code changes were needed for these four journey repairs.
