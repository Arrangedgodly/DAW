# P-08 visualizer deformation hotpath

## Decision

No production change is supported. A single mode-specialized per-point deformation candidate missed the required 25% reduction in the median of five visualizer-window callback p95 values. The current-session baseline was 4.3 ms and the candidate was 4.5 ms. One candidate window also posted two fewer notes. The candidate was reverted, and `src/viz/compositionEngine.ts` again matches its P-06 base blob `a59cbd340169bdb291110aead434fda8e4537be3` at `eccd6645157203272db8d1d9a523e0a1bd1378fb`. No point counts, visual quality, playback behavior, or audio source were changed in this PR.

## Source analysis and candidate

P-06's [clear-host profile](viz-frame-baseline-clear-attribution.cpuprofile) attributes 151 self samples to `deform`, 54 to `drawLayer`, and 17 to `scatter` in `compositionEngine.ts`. These are sampled stack counts, not wall-time shares. The existing `deform` closure branches on motion mode for each geometry point, then calculates the selected orbit, fluid, or elastic equation. `line`, `move`, projected geometry and particles call it repeatedly. The prior contour harmonic cache had yielded only 5.6 to 5.4 ms and was reverted by P-06.

The one P-08 candidate selected a mode-specific closure once per layer, and moved frame-constant `t` and pulse scalar calculations out of the point loop. It retained each point equation's arithmetic order and left `scatter` call sites, lane ordering, geometry modes and particle counts in place. Its source blob during capture was `486e5c0fd9373f5193aeb7ce2f020975b7f1e03e`. The patch is retained locally outside the PR at `C:\Users\arran\Projects\DAW-perf-viz-deform-local-evidence\viz-deform-candidate.patch`; no candidate source remains in the branch.

## Clear-host comparison

After R-06 released the shared host, the manager explicitly granted a timing slot. The P-06 [probe](../../tests/perf/viz-frame.mjs) ran against the clean base, then the candidate, sequentially. No build or other browser suite ran between them. Both commands exited 0 in about 23 seconds. Both used Headless Chromium `151.0.7922.34` on Windows `win32/x64`, a `1280 × 720` viewport, Glass Arcade with eight tracks, and five 1.2-second visualizer windows paired with grid windows. The probe records all callback durations, unique frame timestamps and audio event posts. It starts CPU profiling and DevTools tracing only after the unprofiled comparison windows.

```powershell
git diff --exit-code -- src/viz/compositionEngine.ts
$env:GIT_COMMIT = (git rev-parse HEAD)
node tests/perf/viz-frame.mjs --out docs/dev/viz-deform-baseline-clear.json
# Apply the saved candidate patch; verify source blob 486e5c0f.
$env:GIT_COMMIT = 'eccd6645157203272db8d1d9a523e0a1bd1378fb+candidate-486e5c0f'
node tests/perf/viz-frame.mjs --out docs/dev/viz-deform-candidate-clear.json
```

| Five visualizer windows | Base | Candidate |
| --- | ---: | ---: |
| Callback p95 values, ms | 4.0, 4.1, 5.3, 5.2, 4.3 | 4.0, 4.5, 5.4, 4.4, 4.7 |
| Median of window p95 values | 4.3 ms | 4.5 ms |
| Intervals >=33.4 ms | 2 / 343 (0.58%) | 1 / 339 (0.29%) |
| Notes posted by window | 26, 30, 24, 34, 21 | 26, 28, 24, 34, 21 |
| Total notes posted | 135 | 133 |
| Recorded callbacks | 2,442 | 2,414 |

The candidate is about 4.7% *slower* on the decision metric in this capture; the required upper bound was 3.225 ms relative to the 4.3 ms baseline. The interval ratio was lower, but did not offset the failed speed and post gates. Song-time and host drift may affect short sequential captures; the result is far from the required 25% gain, so a third baseline was not warranted. This fresh 4.3 ms baseline differs from P-06's earlier 5.6 ms because these are separate sessions, and neither is treated as a portable device constant. The P-08 profiles had 148 baseline and 159 candidate self samples in `deform`; their sampling overhead was outside the timing windows and the counts are not a paired duration comparison.

The decisive raw callback, frame-interval and post histories are losslessly compressed in [baseline JSON](viz-deform-baseline-clear.json.gz) and [candidate JSON](viz-deform-candidate-clear.json.gz). The separate [baseline trace](viz-deform-baseline-clear-attribution-trace.json.gz) and [candidate trace](viz-deform-candidate-clear-attribution-trace.json.gz) are also compressed. Each `.json.gz` decodes to the original raw JSON bytes, and the compressed artifacts passed gzip and JSON parsing checks. Uncompressed trace copies, CPU profiles and representative PNGs are retained locally at `C:\Users\arran\Projects\DAW-perf-viz-deform-local-evidence`, outside the PR. The PNGs are not pixel parity evidence because playback times differ.

## Final source and validation

The final branch has no production source or test edit. `git hash-object src/viz/compositionEngine.ts` and `git rev-parse HEAD:src/viz/compositionEngine.ts` both returned `a59cbd340169bdb291110aead434fda8e4537be3`; `git diff --exit-code -- src/viz/compositionEngine.ts` passed. On that reverted source, the existing fixed-frame test passed with four eight-lane hashes `3372253067`, `3672592734`, `2858053307`, `3234583933`. The existing fingerprint suite passed for all 24 geometry effects. Candidate pixels were not separately certified because the speed gate had already failed and the candidate was removed.

| Sequential command after validation grant | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --project unit tests/viz-composition.test.ts tests/viz-renderer-lifecycle.test.ts tests/viz-pipeline.test.ts tests/viz-timbre.test.ts` | 4 files, 90 tests passed |
| `node node_modules/vitest/vitest.mjs run --project browser tests/browser/viz-frame-pixels.test.ts tests/browser/viz-fingerprint.test.ts` | 2 files, 3 tests passed |
| `node node_modules/vitest/vitest.mjs run --project browser tests/browser/frame-budget.test.ts -t "VZ-TH-4"` | 1 test passed, 11 unrelated tests skipped |
| `node node_modules/typescript/bin/tsc --noEmit` | Exit 0 |
| `node node_modules/eslint/bin/eslint.js src/viz/compositionEngine.ts tests/perf/viz-frame.mjs tests/browser/viz-frame-pixels.test.ts tests/browser/viz-fingerprint.test.ts` | Exit 0 |
| `node node_modules/vite/bin/vite.js build` | Exit 0; two existing ineffective dynamic-import warnings |

The browser checks built the app through their existing global setup. Headless callback cost and frame cadence do not measure target-device GPU work, audio rendering deadlines, or physical speaker latency. Event posts show control-side delivery, not worklet consumption or audible output. No phone, loopback, listening, or manual target-device check was performed.
