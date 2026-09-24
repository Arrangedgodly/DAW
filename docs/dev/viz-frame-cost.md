# P-06 visualizer frame cost

## Trace and test plan

R-03 observed a 5.6 ms visualizer rAF callback p95 in a short Glass Arcade eight-track window, versus 0.4 ms for Grid. The wrapper timed every page callback, without function attribution, layout/paint time, GPU cost, or audio rendering deadlines. P-06 traces the full callback path: `VizRenderer` resize/ground fill, `VizPage` pipeline, per-lane waveform/timbre sampling, and `compositionEngine.draw` geometry.

The dedicated [probe](../../tests/perf/viz-frame.mjs) runs five sequential 1.2-second grid/visualizer pairs during Glass Arcade playback, recording all callback durations, unique frame timestamps, and posted audio event counts. It runs a separate sampled CPU profile and DevTools trace after the unprofiled comparison windows, so profiler overhead is excluded from the p95 comparison. Representative canvas PNGs give visual context. The [fixed-frame browser test](../../tests/browser/viz-frame-pixels.test.ts) hashes four deterministic frames with eight active lanes and distinct lane timbres; the existing `viz-fingerprint` test covers all 24 effect geometries. A production change requires at least 25% lower repeated visualizer callback p95, unchanged fixed pixels, no worse dropped-frame ratio or posted-event delivery, and preserved frame-budget gates.

## Capture history

The first baseline and contour-cache candidate runs finished while P-05 was also running browser audio verification and a build on the Windows host. Their raw JSON, CPU profiles, and representative PNGs are retained locally at `C:\Users\arran\Projects\DAW-perf-viz-frame-traces\overlapping`, but **are excluded from the PR's speed decision**. The manager then confirmed an idle host. I restored `src/viz/compositionEngine.ts` to the assigned base and ran the baseline, applied one narrow contour second-harmonic scratch reuse, and ran the candidate sequentially:

```powershell
git diff --exit-code -- src/viz/compositionEngine.ts
$env:GIT_COMMIT = (git rev-parse HEAD)
node tests/perf/viz-frame.mjs --out docs/dev/viz-frame-baseline-clear.json
# Apply the contour second-harmonic reuse candidate.
$env:GIT_COMMIT = (git rev-parse HEAD)
node tests/perf/viz-frame.mjs --out docs/dev/viz-frame-contour-reuse-clear.json
```

Both commands exited 0 in 23.5 and 23.1 seconds. Their outputs were then losslessly compressed to `viz-frame-baseline-clear.json.gz` and `viz-frame-contour-reuse-clear.json.gz` for review. The decoded raw JSON records browser 151.0.7922.34, HeadlessChrome user agent, `win32/x64`, 1280 × 720 viewport, base commit `a292f3d733cd32e65fbb0dffb20afdd78686c6ed`, every callback, and every posted event batch. To decode both from the repository root in PowerShell:

```powershell
node -e "const fs=require('node:fs'); const z=require('node:zlib'); for (const n of ['viz-frame-baseline-clear','viz-frame-contour-reuse-clear']) { const p='docs/dev/'+n+'.json.gz'; fs.writeFileSync(p.slice(0,-3), z.gunzipSync(fs.readFileSync(p))); }"
```

The candidate was uncommitted during capture and has since been reverted. The decoded JSON files are local review copies; the committed `.json.gz` files preserve the original bytes.

| Idle-host measure, five visualizer windows | Baseline | Contour cache |
| --- | ---: | ---: |
| Per-window callback p95, ms | 4.4, 5.6, 6.6, 6.3, 5.4 | 4.4, 5.6, 5.6, 5.1, 5.4 |
| Median of window p95 values | 5.6 ms | 5.4 ms |
| Pooled callback p95 | 5.7 ms / 2,204 callbacks | 5.3 ms / 2,267 callbacks |
| Intervals ≥33.4 ms | 6 / 309 (1.94%) | 8 / 318 (2.52%) |
| Posted notes by pass | 26, 31, 25, 35, 34 | 26, 31, 25, 35, 34 |

The median p95 difference is about 3.6%, far below the 25% gate. The observed dropped-interval ratio is also higher in the candidate run. The candidate is therefore **not shipped**. These short windows do not prove a true regression; they show that this change lacks support under the acceptance rule. The comparison is sequential rather than randomized, so host and song-time drift remain possible.

## Attribution and frame evidence

The initial sampled visualizer profile had 263 samples under `compositionEngine.ts`, 32 under timbre/listening, and three under other visualizer code. Thus draw code is a material share of sampled visualizer CPU work. This is stack sampling, not an exact wall-time split. The trace includes layout, paint, and raster events, but the headless trace does not establish target-device GPU time. The fixed eight-lane pixel hashes were `3372253067`, `3672592734`, `2858053307`, and `3234583933` before and after the candidate; the browser test passed both times. Playing PNGs are representative only and are not pixel comparisons because their song times differ.

The clear-run DevTools traces are committed as `viz-frame-baseline-clear-attribution-trace.json.gz` and `viz-frame-contour-reuse-clear-attribution-trace.json.gz` (about 1.1 MB each). Decompress either with the same Node `gunzipSync` approach, then open the JSON in Chrome tracing or Perfetto. The four original uncompressed trace JSON files are retained locally at `C:\Users\arran\Projects\DAW-perf-viz-frame-traces`; they are not part of the PR. Only the two decisive clear-host histories have committed raw samples, CPU profiles, and representative PNGs.

No phone, physical GPU, audible-onset, or audio render-deadline improvement follows from headless rAF timing. Event posts show control-side delivery, not worklet consumption or speaker output. No manual device or listening check was performed.
