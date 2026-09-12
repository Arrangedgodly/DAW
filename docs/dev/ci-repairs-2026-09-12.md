# CI repair work — September 12, 2026

This follows [the investigation of run 34708018855](ci-investigation-2026-09-12.md). The linked GitHub run failed its browser-test job; its install, lint, typecheck, unit, production-build, and bundle-budget job passed. These repairs are local working-tree changes. A successful publishing run has not been established.

## Application repairs

- Give the BPM unit the display's high-contrast ink color.
- Register contextual help for the workspace navigation, theme, track color, instrument adder, demo library, and agent-access controls.
- Position the FX panel after DOM attachment and track header resizing, keeping the panel below the actual controls.
- Restore 44px mobile controls without overlapping invisible hit areas. Put the color control in the title row's DOM order, matching the visual focus order.
- Remove unnecessary mobile transport/register padding so the seven-row pitch editor fits the tested viewport, while retaining the saved-status footer reserve.
- Reduce lane padding at desktop heights of 850px or less. A four-bar pattern's horizontal scrollbar otherwise pushed the lower quadrant seven pixels past a 1280x800 viewport.
- Allow compact desktop drum rows to use the current layout's minimum height, and expand the FILL controls within a scrolling drum pane.
- Reduce the narrow drum-label gutter enough to fit a one-bar pattern without reducing the cell-size floor.
- Preserve fractional row dimensions when pinning a zoomed register window. Integer rounding exposed an eighth-row sliver at 1.5x and clipped a row in the synthetic pinch scenario.
- Suspend playback auto-follow across all grids while a pointer interaction is held. Re-windowing another lane during an edit caused non-preview DOM mutations in the gesture stress tests.
- Drive register feedback from the chromatic pitch origin, including semitone shifts that leave the visible scale rows unchanged. Explicit register shifts also request a fresh scroll seat in this case.
- Use MIDI pitch names with octaves in pattern-shrink refusals. The previous formatter assumed nonnegative degrees in an ascending row list and could disagree with the expanded editor.

## Test and diagnostic repairs

- Use the current desktop destination tabs and phone toggle through a shared workspace selector.
- Resolve musical fixture degrees into the full MIDI domain and seat their rows before addressing cells. Off-window row shells are not evidence that cells are mounted.
- Read a native preset selector's selected value, not the text of every option.
- Wait for the selected welcome-song kit at boot. Finding its name among all dropdown options allowed tests to start against the temporary fresh document before persistence finished loading the demo.
- Test imports from both an untouched preview and a saved project. Opening the welcome demo does not itself create a saved-project record.
- Create real saved-project fixtures before testing rename, deletion, undo, and saved-project help.
- Test the two-row lane header and pitch readouts that the app now displays.
- Use trusted touch down/up streams in Chromium. The previous synthesized-tap command delivered pointer/touch events without a compatibility click even on a plain native button in the diagnostic probe.
- Address the section-selection region separately from the nested loop/next control in touch journeys.
- Use the visible FILL control instead of attempting to hover a cell covered by its open overlay.
- Re-query the phone grid after pattern creation; the previously retained element can be detached during the remount.
- Prepare native scroll targets with Playwright hover before measuring CDP coordinates. A screenshot had incidentally performed this preparation in an earlier diagnostic run.
- Wait against the audible loop position for the one-shot tail test, rather than sleeping after several variable-duration input actions. Close the options drawer in teardown, including failure paths, so it cannot cover the next test's grid.
- Explicitly request touch for the touch-scroll probe and keep the horizontal swipe inside the phone viewport, starting from an asserted nonzero scroll position.
- Save screenshots under relative paths with bounded task-ID filenames. Preserve JSON results and failure screenshots as GitHub Actions artifacts.

No failing tests were newly skipped, and timing budgets were not raised.

## Validation method

Browser validation uses an isolated snapshot at `%TEMP%/daw-ci-repair-20260912`, with its own production `dist` and the repository's installed dependencies. This prevents the user's running development app and unrelated builds from replacing test assets mid-run. Each browser invocation builds the snapshot before testing it. Results are local Chromium on Windows; existing Linux-only skips mean their totals are not a direct one-for-one comparison with GitHub's Ubuntu run.

The unit suite passed **1,802 tests across 95 files**. TypeScript and ESLint passed. The production build used by browser validation passed; its bundle check reported **98.67 KB initial JavaScript gzipped** against a 300 KB limit and **37.02 KB fonts** against 50 KB.

The final complete browser run passed **229 tests across all 79 files**, with **zero failures and zero skipped tests**, in **705.94 seconds**. It ran on September 12, 2026, starting at 15:13:28 local time. The runner exited with code 0 and the JSON report records success.

- [Complete browser results](ci-repair-browser-results.json)
- [Complete browser log](ci-repair-browser-final.log)
- [Unit test log](ci-repair-unit-final.log)

An earlier complete run passed 227 tests and failed two. The help touch test needed stable target preparation, followed by recording the current help entry after pointer preparation for its unregistered-target assertion. The separate column-window prototype benchmark missed its existing 95% frame requirement once, at 91.6%. It passed an unchanged direct rerun at 100%, then the final complete run at 97.5%. Its budget and implementation were not changed. This is a measured timing sensitivity to keep in mind when reading future CI results, not an outstanding failure in the final run.

TypeScript, ESLint, and git diff whitespace checks passed. No tests were disabled to obtain the final result. Filtered diagnostic runs naturally reported excluded tests as skipped; the complete final run did not.

These results validate the local working tree on Windows Chromium. GitHub's Ubuntu runner and the published website have not been revalidated with these changes. No commit, push, or deployment was performed.
