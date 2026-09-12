# CI run 34708018855 investigation

Source: https://github.com/Arrangedgodly/DAW/actions/runs/34708018855/job/103591510692

Commit: `17a6cdfdc4450bf782dc6670acefb190b76a07e5` (main). Examined the GitHub job log and public job/annotation API on September 12, 2026.

## Outcome of the linked run

- `ci`: passed installation, lint, typecheck, unit tests, production build, and bundle budget.
- `browser`: installation and Chromium setup passed; `npm run test:browser` failed after 508.68 seconds.
- Browser results: **65 failed, 158 passed, 4 skipped**, across **38 failed, 38 passed, 3 skipped files**.
- The workflow contains CI checks, not a Cloudflare deployment step. Its red status does not itself establish that publishing failed.
- GitHub's displayed **10 errors and 1 warning** is the annotation summary, not the total number of failed tests.
- The preceding published commit `ed1d52e8fcc4174e380b341b626cc1a1be3a282a` also had a failed browser job and passed `ci` job, verified through the public Actions API for run https://github.com/Arrangedgodly/DAW/actions/runs/34701754736. This establishes a pre-existing red baseline, not that every current failure is pre-existing.

## Findings and repair order

### 1. Restore useful test diagnostics

Five failures in `zz-shots.test.tsx` are attempts to write evidence PNGs under `/Users/arrangedgodly/Documents/Projects/daw/.impeccable/review/`. This is a hard-coded macOS checkout path; Linux CI correctly refuses it. Use repository-relative evidence destinations. Do not relax Vite filesystem security to accommodate a foreign absolute path.

Automatic failure screenshots also report `ENAMETOOLONG` because full, very long test titles become filenames. These are secondary diagnostic errors, not extra application failures. Shorten test titles or provide bounded screenshot names, and retain report/screenshots as CI artifacts on failure. The workflow currently does not upload those artifacts.

### 2. Update obsolete test setup without weakening behavior assertions

- **Navigation:** desktop tests still query `.booth-btn-song` or `.phone-page-toggle`; desktop now has workspace tabs. All four failed `frame-budget` cases stop on `timed out waiting for song page`, so these four results are not evidence of slow rendering. Two rail tests fail at the same old navigation assumption.
- **Virtual MIDI register:** many interaction fixtures assume row 0 or row 1 is mounted. The editor now seats a visible window in the full MIDI register. Failures such as `missing bass cell 0:2` and null `parentElement`/`getBoundingClientRect` happen before the gesture under test. Select a visible row or deliberately scroll the requested pitch into view, then keep the original edit/undo/audio assertions.
- **Register labels and controls:** tests expect `ROWS 6–12 OF 14`, start row 6, and no desktop register controls. Current controls expose actual pitches (`C4 – B4`), a wider register (observed start 33), and desktop controls. These assertions contradict the current interface.
- **Removed status labels:** `phone-header` queries `.lane-state`, which was removed at the user's request. Assert the absence of VIEW/EDIT text and the active title treatment instead.
- **Preset readout:** the full keyboard journey reads `.head-ctl-value.textContent`. That element is now a native select, so its text contains every option and does not change when the selection changes. Assert `select.value` or the selected option, and retain the keyboard activation check.
- **Fill controls:** both Euclidean geometry tests expect an inline `220px` rail. `LaneGrid` now explicitly uses overlay mode; the renderer only writes an inline width for non-overlay mode. Preserve the real hit-target/SET behavior checks and update the layout expectation.
- **Demo persistence:** both `fileIO` failures are saved-row counts. A fresh demo is now a preview with no stored row until edited. Successful import yields one row instead of two; corrupt import leaves zero instead of one. The successful import's document assertion and the corrupt-file toast assertions precede these failures. Test preview behavior explicitly and separately test preservation of an already-saved project.
- **Geometry constants:** `per-lane-sweep` calculates expected positions with hard-coded 22px/17px column widths. The current renderer adapts its column width. Compare against actual renderer/DOM geometry and account for scroll before treating the 30px mismatch as a transport bug.
- **Windowed columns:** `pattern-rail` and `pattern-resize` wait for all 64/32 columns to exist in the DOM. Verify the complete pattern extent and a window bounded DOM instead. `lp1-perf-spike` expects the view to remain at column zero while playback-follow is active; inspect that interaction before changing its assertion.

### 3. Address actual UI findings

These should not be dismissed by blanket snapshot updates or looser thresholds:

- **BPM contrast:** four axe cases identify the same `.screen-bpm-unit` contrast violation. `unit.css` uses an older ink/recess color mix while the themed display uses separate display colors. Give the BPM unit an appropriate theme-aware foreground and rerun axe in both themes.
- **Missing help entries:** the coverage tests identify the new workspace tabs, theme switch, track-color controls, and mobile Add new instrument control. Add meaningful registered help content and bindings.
- **Viewport overflow:** the linked Linux run measures 1280×874 content at a 1280×800 viewport, and 867px content height on a 390×844 phone. This stops several full journeys before their musical checks. Re-budget stage/header/grid height for the current navigation and controls; retain useful grid rows and touch targets.
- **Mobile space usage:** the drum grid occupies 34.8% of a 390×844 viewport against the previous 47.5% minimum. Review the current design budget before changing the requirement; added chrome must not silently consume the usable editor.
- **Mobile hit targets:** the metronome hit-area probe lands on Decrease tempo instead. Reproduce drawer layout and target ownership, then fix overlap if confirmed. The options-drawer backdrop test also reports that an outside point is not owned by its backdrop.
- **Pinch/window seating:** trusted pinch intersects eight rows where seven are expected, while the synthetic case fully contains six. Check settled row edges and scroll position with the current full-register design; this may expose a real clipping/seating defect.
- **FX console coverage:** the trusted test's `elementFromPoint` probe at the FX toggle center resolves to another element while the console is open. This is a target-ownership failure, not a proven failure of the FX state handler. Check actual target coverage under the open console before deciding whether its coordinate assumptions are obsolete.

### 4. Non-blocking log noise

- `checkout@v4` and `setup-node@v4` produce an action-runtime Node 20 deprecation warning. The application's configured Node version is 22. This warning did not fail either job; update the actions as separate maintenance after checking their supported versions.
- Audio/WAV fingerprint drift is explicitly a soft warning tied to platform/browser goldens. The associated tests passed. Do not regenerate audio goldens merely to hide Linux versus macOS differences.
- Invalid-project quarantine messages come from intentional corrupt-data recovery fixtures; those recovery cases passed.

## Complete failed-file inventory (linked Linux run)

Counts below total 65. A long scenario stops at its first failure; later assertions in that scenario remain unverified.

| Test file under `tests/browser` | Failed | First cause / investigation group |
| --- | ---: | --- |
| axe-a11y.test.tsx | 4 | BPM unit contrast |
| drag-notes-trusted.test.tsx | 1 | Unmounted bass row 0 |
| drag-notes.test.tsx | 1 | Unmounted bass row 0 |
| e2e-iteration2.test.ts | 1 | Initial viewport overflow |
| e2e-iteration3.test.ts | 1 | Initial viewport overflow |
| euclid-fill-trusted.test.tsx | 1 | Obsolete inline 220px rail |
| euclid-fill.test.tsx | 1 | Obsolete inline 220px rail |
| fileIO.test.ts | 2 | Preview demo saved-row assumptions |
| frame-budget.test.ts | 4 | Old Song navigation; performance assertions not reached |
| fx-console-trusted.test.tsx | 1 | FX toggle click ownership/state |
| help-coverage.test.tsx | 2 | New controls lack help bindings |
| help-mode.test.tsx | 1 | Unmounted bass row 0 |
| help-touch.test.tsx | 1 | Missing target before touch dispatch |
| keyboard-journey-full.test.ts | 1 | Preset readout/stepper expectation |
| lp1-perf-spike.test.tsx | 1 | Column-zero seating versus playback follow |
| mobile-options-drawer.test.tsx | 2 | Backdrop ownership; old register readout |
| mobile-register-feedback.test.tsx | 3 | Old register readout and desktop-control assumptions |
| mobile-register-window.test.tsx | 2 | Old register bounds and desktop-control assumptions |
| mobile-resilience.test.tsx | 4 | Unmounted cell targets before tested gestures |
| mobile-viewport.test.ts | 5 | Overflow, geometry and removed Song control |
| pattern-rail.test.ts | 1 | Expects all 64 columns mounted |
| pattern-resize.test.ts | 1 | Expects all 32 columns mounted |
| per-lane-sweep.test.ts | 1 | Hard-coded column geometry |
| phone-header.test.tsx | 1 | Removed lane-state element |
| pitch-direction.test.tsx | 1 | Phone overflow before pitch checks |
| pointer-edge-states.test.tsx | 3 | Unmounted cells/register/columns |
| quadrant-layout.test.ts | 2 | Desktop overflow |
| rail-active-follow.test.ts | 1 | Removed Song button |
| rail-density.test.ts | 1 | Removed Song button |
| register-pinch-zoom-trusted.test.tsx | 1 | Eight intersecting rows after pinch |
| register-pinch-zoom.test.tsx | 1 | Six fully contained rows |
| register-pitch-anchor.test.tsx | 1 | Old default register start 6 |
| register-window-quantize.test.ts | 1 | Desktop fit never settles |
| register-window-snap.test.tsx | 1 | Old default register start 6 |
| target-size.test.tsx | 1 | Metronome target overlaps tempo decrement |
| vertical-fill.test.ts | 1 | Desktop fit never settles |
| viewport-utilization.test.ts | 2 | Desktop overflow; mobile grid space budget |
| zz-shots.test.tsx | 5 | Absolute macOS screenshot paths |

## Scope

This is an investigation, not a claim that CI is repaired. No application changes, assertion removals, test skips, CI re-runs, commits, pushes, or deployments were made for this investigation.

A local browser-suite reproduction was launched at 12:10 MDT against the current working tree using `CI=true node node_modules/vitest/vitest.mjs run --project browser --reporter=json --outputFile=docs/dev/browser-investigation-results.json`. It was deliberately interrupted without a final test total: concurrent work modified `src/grid/renderer.ts` at 12:17:24 and replaced `dist/index.html` at 12:17:37, during the run. Browser tests load the shared production bundle from `dist`; subsequent setup failures cannot be interpreted as a clean regression comparison. The interrupted diagnostic output is in `browser-investigation.log`. No JSON result was completed.

The 65-failure inventory in this report is from the complete, immutable GitHub log, not extrapolated from that interrupted run. A clean local validation should run from an isolated snapshot, or after the other work has finished and no process is rebuilding its `dist` directory.

## Repair follow-up

See [the repair and verification report](ci-repairs-2026-09-12.md) for the completed local repairs and final test evidence. The failure inventory above describes the original GitHub run.
