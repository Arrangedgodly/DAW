# Browser repair follow-up

These changes address the fourteen failures and dependency-scan warning in the [investigation](../ci-followup-2026-09-12.md), starting from commit `e2543be`.

## Repairs

- The grid navigation now occupies one 44px row. Back and Forward use labeled SVG chevrons, the step range remains visible, and Draw/Scroll keep their pressed states. All four navigation targets retain a 44px minimum width and height.
- The phone Add new instrument button sits beside the instrument tabs with an accessible name and tooltip. Removing its separate row recovers space for navigation without reducing note-row heights.
- Tablet and coarse-pointer desktop panels use smaller padding and gaps. Register controls no longer waste vertical padding. The full octave stays visible and the document fits the tested viewports.
- Navigation, Draw, and Scroll have registered contextual help. The help-coverage checks remain unchanged.
- The browser setup resets CDP touch emulation after every test, including failures. The desktop layout regression now explicitly runs with touch capability both enabled and disabled, so cleanup cannot hide a real touch-desktop defect.
- The long-press test checks the documented hold-to-pan transition, context-menu suppression, unchanged document identity and undo history, and cleanup of pan feedback on release. Separate navigation tests retain quick-draw and resize coverage.
- Four explicit raw imports replace the `import.meta.glob` in the TSX help test. Vite's dependency scanner rewrote that glob and returned `moduleType: "js"` despite preserved JSX. Forced scanning reproduced the exact CI error before the change and completed without it afterward. Source coverage is unchanged; no dependency upgrade or warning suppression was needed.
- The browser project pre-bundles `@tonejs/midi`, `midi-file`, and `axe-core`. Earlier runtime discovery reloaded long-running browser tests; these test dependencies now load before the journeys begin.
- The active pan cue replaces the step readout within the same navigation row. A regression asserts that the cue is visibly unclipped, the row stays 44px tall, and lost pointer capture removes the cue. It also works with reduced motion.

## Integration with clip length

The separate clip-length task added its component while this investigation's full suite was running. Its expanded inline editor then caused five failures in a combined follow-up: missing help on desktop and phone, phone height, pitch-test geometry, and touch-desktop height. That failed combined run is preserved in [final-followup.log](final-followup.log).

After the other task finished, the integration was repaired locally. Bars is now a compact disclosure that opens its existing typed field and minus/plus buttons on the same instrument page. Its closed panel explicitly uses `display: none`, keeping it out of layout and focus-order probes. Its trigger uses border-box sizing, and the phone tools row uses smaller horizontal gaps. The component registers help, supports Escape with focus return, and closes on outside pointer presses. Arbitrary 1–128 whole-bar counts, note protection, invalid-input feedback, and undo remain covered by the feature's browser tests.

The original repairs were also verified separately in an isolated snapshot: [49 passing tests across 14 files](isolated-final.log), with a forced clean dependency scan and no reload warning. No concurrent feature was removed from the real workspace.

## Evidence

- [Initial targeted repair run](repair-targeted.log): 21 passed, 2 tablet-layout failures. The subsequent spacing repair addresses those remaining failures.
- [Tablet and desktop layout checks](repair-layout-tests.log): all 8 passed.
- [Mouse and touch desktop regression](repair-touch-layout.log): both cases passed, including resize recovery and phone checks.
- [Cold scanner before repair](cold-scan-forced.log) and [after repair](cold-scan-fixed.log): the exact JSX warning is reproduced and removed; all 5 help-mode tests pass.
- The earlier full browser run reported [238 passing tests across 80 files](final-browser.log). It began before the concurrent clip-length changes and had dependency reload warnings, so it is not the final proof of the combined workspace.
- [Combined unit suite](combined-unit.log): 1,811 tests passed across 96 files.
- TypeScript and ESLint passed on the combined code. [ESLint output](combined-lint.log) is empty on success.
- [Combined clip-length and mouse/touch layout checks](combined-clip-final.log): all 5 tests passed.
- [Final built-app measurements](combined-final-layout.jsonl) and [screenshots](screenshots/) cover phones, tablets, and mouse/touch desktops. All eight measured contexts fit their viewport on both axes before the probe's diagnostic hiding step.
- [Combined bundle budget](combined-bundle.log): initial JavaScript is 100.66 KB gzipped against 300 KB, with 37.02 KB fonts against 50 KB.

## Scope

No tests were skipped or timing budgets raised. The temporary forced-cache configuration was removed. The retained layout probe changes only disposable browser DOM and closes its browser and local server afterward. Dependencies and lockfile are unchanged. No commit, push, or deployment is part of this repair request.

## Final validation

The final combined browser suite ran from `%TEMP%/daw-browser-combined-20260912`, with its own `dist`, to prevent workspace changes or unrelated builds from contaminating results. [The full run](combined-browser.log) completed all 241 tests across 81 files in 739.37 seconds, with 239 passing and two failures, with no skips. [Machine-readable results](combined-browser-results.json) preserve that result.

One failure was the help registry's source audit: the newly registered `clip.length` entry needed `ClipLengthControl.tsx` added to the explicit raw-source list. That audit was corrected. The other was the existing column-window prototype benchmark, which measured 94.17% of sweep frames under 33.4ms against the unchanged 95% requirement. This same timing sensitivity is documented in the earlier `ci-repairs-2026-09-12.md` report.

[Both failed checks passed on the final targeted rerun](final-failed-checks-rerun.log). The unchanged prototype measured 100% of idle frames and 99.2% of sweep frames within budget. The audit passed with the new component source included. Eight unrelated tests were excluded by that invocation's name filter; no test definitions were skipped or disabled. There was no subsequent complete-suite run after the source-list correction, and the timing benchmark remains a known intermittent risk rather than a claimed performance fix.

All fourteen failures from the supplied deployment log, and the additional clip-length integration failures, passed in the final combined validation. The complete run had no dependency-scan errors or unexpected test reloads. TypeScript, lint, formatting, unit tests, and the production bundle budget passed. The workspace's source and test files were compared against the final snapshot; [the comparison](snapshot-differences.json) records no differences.

These are local Windows Chromium results. GitHub's Linux runner and the deployed website were not rerun or republished.
