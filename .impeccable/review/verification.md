# Visualizer composition verification

Implemented in isolated worktree `viz-composition-20260912`, branch `codex/viz-composition-20260912`. The sibling song-page-and-follow worktree was not modified.

## Passed

- Full unit suite: 88 files, 1763 tests (maxWorkers=2).
- Earlier browser regression batch: 5 files, 19 tests passed, covering composition controls, trusted pointer dragging, persistence, reroll coalescing, disposal, visibility, reduced motion, render fault recovery, production playback, 24 distinct deterministic fingerprints, accessibility and help coverage.
- TypeScript, production build, changed-source ESLint and git diff whitespace check.
- Impeccable visual review: ship, based on desktop 1440x900, desktop 1280x800 and phone 390x844 captures. This is a visual disposition, not a performance approval.

## Unresolved performance gate

The existing unmodified VZ-TH-4 dense 200 BPM playback test at DPR 2 fails its requirement that at least 95% of frames stay below 33.4ms. Initial final-design measurement: median 52.2ms, p95 61.3ms, 77 of 78 frames over budget, canvas 2272x1508. Playback remained active and the canvas changed on 77 frames. A temporary no-geometry control reached median 16.7ms, implicating the rendering workload; timing varied considerably across subsequent experiments.

Source-over compositing, particle batching, software raster selection and an intermediate raster did not establish a passing result. All experimental changes were removed. The performance test and renderer are unchanged. The reviewed detailed additive geometry remains implemented. Do not describe this change as fully performance-verified or release-ready until this gate is resolved.

Final rerun after restoring the reviewed source: 18 passed, 1 failed. The production journey measured only 7 changing frames in its 1.1-second moving-canvas sample (assertion requires more than 10), so it stopped before rechecking its later persistence steps. All other mounted composition, fingerprint, axe and help tests passed. This is a second timing-related unresolved check; the earlier production journey passed in full.

## MIDI phrasing refinement

Added observation-only hold/release metadata, lane-specific transient and sustain envelopes, bounded overlapping voices, stronger geometric expansion/stretch and energy-driven phase speed. Full unit suite: 88 files / 1766 tests passed. Browser phrasing, composition and fingerprint batch: 3 files / 10 tests passed, including all 24 effects, reduced motion, responsive controls and render-error containment. TypeScript and changed-source ESLint passed; browser global setup rebuilt the production bundle. Live preview was refreshed and inspected during real playback. Existing performance failures above remain unresolved; no performance thresholds changed.

## Silence gating

Lane artwork now fades through its release to a finite cutoff, then skips drawing. No idle geometry remains. Effective mute/solo/zero-volume uses documentLaneMixGains; hidden hits are ignored and unmute waits for a new note. Stop clears artwork. Editing handles remain, viewing mode hides them, and reduced motion uses the existing textual summaries with no artwork. Browser canvas/phrasing/composition/fingerprint checks: 11 passed. Targeted composition, pipeline and lane-mix unit checks: 44 passed. TypeScript and ESLint passed. Live stopped/editing and playing/viewing states inspected. Earlier dense-playback performance limitation has not been remeasured or declared fixed.


## Permanent advanced motion controls

User approved Blended and retaining every motion-study control. Fluid folds and Blended are now defaults in the regular visualizer. Motion, blending, per-lane scale and orbit strength persist locally and survive reroll. Orbit strength appears only in Orbit mode; blending is disabled there and its saved value returns in the other modes. Product/design context and the route brief describe this permanent workflow.

Full unit suite: 88 files / 1768 tests passed. Browser batch: 22 of 23 initially passed; the remaining reduced-motion test needed canvas-readback warmup and a specific effect-selector query after adding header selects. The affected composition file then passed all 8 tests, completing the 23-check set across six browser files. Exact reduced-motion pixel equality remains asserted. Production playback, fresh-boot persistence, all 24 effect fingerprints, phrasing/silence, keyboard controls, axe and help coverage passed. The production journey now samples a full bar (2.6 seconds), avoiding silent gaps under the intentional silence gating; its original changing-frame threshold remains intact. That earlier journey failure is resolved.

TypeScript and changed-source ESLint passed; browser setup rebuilt the production bundle. Desktop and phone captures reviewed with permanent controls; normal live playback shows Fluid folds and Blended. The earlier dense DPR-2 performance gate remains unresolved and was not claimed fixed by this controls refinement.


## Main integration verification (2026-09-11 local)

Fetched origin; local main and origin/main both at 173e8f1 before integration. The visualizer branch has the same base and needs no conflict resolution. Main's tracked files were clean; the untracked .claude worktree directory was preserved. No changes were made in song-page-and-follow.

Fresh checks: full ESLint and TypeScript passed; unit suite 88 files / 1768 tests passed; 50,000-case codec fuzz soak 21 tests passed through the direct Vitest entrypoint (the shell wrapper cannot locate its POSIX executable on this Windows worktree). Production build passed and initial JS measured 98.35 KB gzip / 300 KB budget, fonts 37.02 KB / 50 KB.

Full browser suite: 198 passed, 16 failed across 76 files / 214 tests. One integration issue was the help source census omitting VizPage after controls moved there. Added VizPage to the census without excluding any help IDs. Confirmation run passed the help and composition files (13 tests), plus the frame suite's selected hook test, 14 passes total.

Failure disposition:
- Ten timing/touch failures reproduce on unchanged main at 173e8f1: TH-5 long-chain fling, VZ-TH-4, both LP-1 sweep tests, mobile-resilience touch cancellation, both mobile-touch-trusted journeys, projects-trusted, register-window-snap, and touch-gestures. The baseline comparison selected these ten tests and all ten failed with the same failure class; 17 unrelated tests were filtered out.
- Five zz-shots screenshot helpers fail because their unchanged destinations are hard-coded to /Users/arrangedgodly/Documents/Projects/daw. This Windows host cannot write those paths. No screenshot gate was removed or weakened.
- The help census issue is fixed and its confirmation passes.

Performance remains a material limitation. With preview stopped and no other test jobs running, redesigned VZ-TH-4 measured median 43.6 ms, p95 63.5 ms, max 66.9 ms, 60/108 frames at or over 33.4 ms. Baseline main measured median 27.6 ms, p95 39.6 ms, max 49.6 ms, 33/149 over budget. Both fail, and the redesign is heavier; baseline failure does not establish performance equivalence. The user's requested local merge carries this previously disclosed limitation; no release-readiness claim, push, deployment, or threshold change accompanies it.
