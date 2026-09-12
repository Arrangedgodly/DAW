# Browser failure follow-up, September 12, 2026

Repair follow-up: [implemented changes and final validation](browser-followup-2026-09-12/repairs.md). The findings below describe the original failing state.

Investigated the supplied CI log against local commit `e2543becd5d911fcb5df86625a5ca67eeb088d08`, `Fix mobile MIDI grid navigation and touch panning`. The pasted log does not identify its commit or deployment URL. Its totals are **14 failed, 219 passed, 4 skipped tests across 80 files**, with 9 failed files. This report investigates the test failures; it does not verify publication status.

## Findings

### 1. Navigation height causes the viewport failures

`src/styles/grid.css:27` displays the new navigation at widths up to 1024px **or** whenever `(any-pointer: coarse)` matches. Its two control rows, gap, and padding measure 112px per lane locally. This exceeds the existing page budget on phones, tablets, and touch-enabled desktops. The grid fitter measures the space above the grid, but its minimum row sizes cannot absorb all the added controls.

A disposable Chromium probe loaded the production build with separate touch and mouse contexts. It measured each page, hid only `.grid-navigation` through DOM styles, and measured again. No application file changed.

| Viewport      | Touch capability | Original page height | Navigation hidden |
| ------------- | ---------------- | -------------------: | ----------------: |
| 1280x800      | No               |                  800 |               800 |
| 1440x900      | No               |                  900 |               900 |
| 1280x800      | Yes              |                 1014 |               800 |
| 1440x900      | Yes              |                 1054 |               900 |
| 768x1024      | Either           |                 1189 |              1024 |
| 390x844, lead | Either           |                  955 |               844 |

The phone measurement exactly matches the supplied failure. Linux's desktop measurement was 1036px rather than Windows's 1014px, so the local probe establishes the mechanism rather than claiming platform-identical pixels.

Ten of the supplied failures stop at page/grid geometry: `e2e-iteration2`, four `mobile-viewport` cases, `pitch-direction`, both `quadrant-layout` cases, `vertical-fill`, and `viewport-utilization`. Several full journeys never reach their later musical assertions. A font-settle timeout in these tests does not establish a font-loading bug; the wait also requires the page to fit.

### 2. Touch emulation makes desktop results depend on earlier tests

`tests/browser/mobile-resilience.test.tsx:179` enables CDP touch emulation. Its disposer at line 337 removes the app but does not disable that emulation. In the targeted run, the following `vertical-fill` test failed at 1014px. Running the unchanged `vertical-fill` test alone passed every desktop resize and phone check.

The independent-context probe above confirms that touch capability alone exposes the desktop overflow. Restore touch emulation in asynchronous teardown and explicitly cover both pointer modes. Resetting test state alone would hide a real problem for touch-capable computers, since showing those controls on coarse-pointer devices is documented behavior in `DESIGN.md:54`.

### 3. New controls lack contextual help

Both help-coverage failures reproduce. `src/components/LaneGrid.tsx:1676` renders Back, Forward, Draw, and Scroll without help bindings. The existing `data-help` applies to the separate grid container below these controls. The failures list four missing controls on phone and sixteen across the desktop's four lanes.

Add registered help and bindings for navigation and touch modes. Keep the existing coverage checks. Explain that navigation changes the view without editing notes, Draw supports quick edits and hold-to-pan, and Scroll pans immediately.

### 4. The long-press assertion contradicts the new interaction

`src/grid/renderer.ts:2300` schedules hold-to-pan after 320ms. `beginTouchPan` cancels the drawing gesture and begins view navigation. This behavior is documented in both PRODUCT.md and DESIGN.md.

The older T4 case in `mobile-resilience.test.tsx` holds for 600ms, suppresses a context menu, then expects a note at step 2. The context-menu suppression succeeds; the expected note never appears because the hold has already switched to panning.

The current navigation test file passed all eight tests locally, including trusted hold-to-pan. A disposable copy of the resilience test retained the original gesture and context-menu assertions but replaced T4's note expectation with unchanged document identity and undo-history depth. All five resilience cases then passed, including the later cancellation/undo checks that the original failure prevented from running. Update this assertion to the documented gesture contract and retain separate quick-draw coverage.

### 5. Focus-order failure follows the extra navigation height

`target-size.test.tsx` reproduces the exact reported transition: the BASS slot control at roughly y=855 precedes the fixed BUILT-IN DEMO status at y=809 in DOM order. The added height places the earlier control below the fixed footer in visual coordinates.

A disposable copy of this test added only a style hiding `.grid-navigation`. The complete target-size, focus-order, and rotation test then passed. This isolates navigation height as the trigger. Resolve the layout and footer relationship before relaxing the focus-order assertion. Hiding navigation was a diagnostic intervention, not a proposed product fix.

### 6. Dependency-scan warning remains unconfirmed locally

The supplied log reports `Unexpected JSX expression` while scanning `help-mode.test.tsx`, then continues running all test files. `help-mode` itself is not among the fourteen failed tests. The targeted local runs did not reproduce the scan warning; these were not clean-cache Linux runs. Treat it as a separate dependency-scanning investigation. The supplied warning does not account for the observed geometry, help, and gesture assertion failures.

## Evidence and reproduction

All runs below used headless Chromium on Windows and the repository's installed dependencies. Each Vitest invocation builds the production bundle through the existing global setup. Initial sandbox execution failed to launch Chromium with `spawn EPERM`; the runs below completed after execution permission was granted.

Set `$env:CI='true'` in PowerShell, then run:

```text
node node_modules/vitest/vitest.mjs run --project browser tests/browser/help-coverage.test.tsx tests/browser/vertical-fill.test.ts tests/browser/mobile-resilience.test.tsx --reporter=default
```

Result: **4 failed, 4 passed**, reproducing help, long press, and touch-enabled desktop layout failures. [Baseline log](browser-followup-2026-09-12/baseline.log).

```text
node node_modules/vitest/vitest.mjs run --project browser tests/browser/vertical-fill.test.ts --reporter=default
```

Result: **1 passed**. [Isolated layout log](browser-followup-2026-09-12/layout-alone.log).

```text
node node_modules/vitest/vitest.mjs run --project browser tests/browser/grid-navigation.test.tsx tests/browser/mobile-viewport.test.ts tests/browser/pitch-direction.test.tsx tests/browser/target-size.test.tsx --reporter=default
```

Result: **5 failed, 11 passed**. This reproduces phone/tablet/rotation overflow, pitch-test geometry, and focus-order failures while the new navigation tests pass. [Mobile log](browser-followup-2026-09-12/mobile.log).

```text
node scripts/probe-navigation-layout.mjs
```

The retained diagnostic script compares mouse and touch contexts against the existing `dist` build, on local port 4187. It changes only disposable browser DOM and closes the browser/server afterward. [Measurements](browser-followup-2026-09-12/layout-probe.jsonl).

The disposable focus and long-press diagnostic copies passed **6 tests across 2 files**. They were removed after recording [the confirmation log](browser-followup-2026-09-12/confirmation.log). These modified diagnostic runs are causal evidence, not a passing result for the unchanged suite.

## Repair order

1. Fit navigation into the phone/tablet/touch-desktop layout while preserving documented controls, useful grid rows, and 44px targets. Recheck the fixed footer and full focus order.
2. Restore touch-emulation state in test teardown and explicitly test desktop geometry with and without touch capability.
3. Register help for all four navigation controls.
4. Update the stale long-press expectation to view-only panning, with document and undo preservation.
5. Investigate the scanner warning on a clean-cache Linux run, and run the complete browser suite after repairs.

No application source, existing tests, dependencies, or configuration changed during this investigation. No tests were skipped, no timing limits were raised, and no commit, push, CI rerun, or deployment was performed. The full suite was not rerun; the current failures remain open.
