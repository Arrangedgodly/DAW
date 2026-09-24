# Offline WAV render throughput

P-07 measurement report, 2026-09-24. This measures offline export throughput. It does not measure live audio rendering deadlines or speaker latency.

## Source attribution before measurement

`renderProjectToBuffer` in `src/audio/render.ts` compiles lane schedules, determines the linear arrangement and FX tail, creates an `OfflineAudioContext`, loads the voice worklet and any referenced samples, builds the lane and master processing graph, posts events, waits for explicit worklet `loaded` acknowledgments, and gives the message loop a settle turn. `startRendering()` then renders the entire graph. Afterward, the function copies the stereo channels and optional stems, folds the tail for cycle renders, and returns. `encodeWav16` interleaves and quantizes the returned stereo channels.

The production WAV path uses a linear arrangement, so its release and FX tail stays in the file. The deterministic serial lane sum, worklet acknowledgment, sample preloading, master and lane mix, and optional stem paths are correctness constraints. This slice does not change their behavior to shorten the native render.

R-03's three dev-server Chromium passes put median native `startRendering()` at 1008.3 ms for Welcome and 2954.1 ms for Glass Arcade. Work outside that call inside `renderProjectToBuffer` took about 80.3 and 122.6 ms respectively; WAV encoding took about 17 to 19 ms. Glass Arcade has eight lanes and multiple reverb and delay chains. Its larger render time cannot be assigned to one node type from those two workloads alone. Native rendering is the only phase large enough to support the required 15% reduction in both projects, so setup and encoding work are not a production candidate on the R-03 evidence.

## Probe protocol

`tests/perf/offline-render-throughput.mjs` is opt-in. It starts Vite in development mode on an ephemeral local port and runs six serial linear WAV renders of each built-in project in one headless Chromium page. Run baseline and any candidate with the same browser, mode, viewport, and host timing conditions. No timed run starts until R-05 releases its slot and the manager grants P-07's slot.

The probe records each native render's start, end, frame count, channel count and sample rate. It also records the last worklet event post before native rendering. `setupMs` ends at that post; `ackAndSettleMs` runs from that post to `startRendering()`. The latter interval includes any work after the final post as well as acknowledgment and settling, so it is an upper bound on acknowledgment plus settle. `copyAndFoldMs` runs from native resolution to `renderProjectToBuffer` resolution. The script records encoding time and a SHA-256 hash of the complete WAV bytes separately. Hashing is outside the reported encoding interval. If there is no worklet event post, setup and acknowledgment intervals are null while `preNativeMs` remains available.

## Six-pass baseline

The manager granted the uncontended slot after R-05 released it. The baseline command below exited 0 in 24.6 seconds:

```powershell
$env:GIT_COMMIT = (git rev-parse HEAD); node tests/perf/offline-render-throughput.mjs --label baseline --out docs/dev/offline-render-baseline-samples.json
```

Revision was `a292f3d733cd32e65fbb0dffb20afdd78686c6ed`. The run used headless Chromium 151.0.7922.34 on Windows `win32/x64`, a 1280 x 720 page, and Vite's development server. Vite logged a dependency re-optimization at startup. Each project ran six passes serially in one page. [Raw samples](offline-render-baseline-samples.json) contain every pass, browser user agent, frame and tail counts, event posts, and full WAV hashes.

| Workload     | Median setup | Median ACK and settle upper bound | Median native render | Median copy and fold | Median WAV encode | Median render total |
| ------------ | -----------: | --------------------------------: | -------------------: | -------------------: | ----------------: | ------------------: |
| Welcome      |      21.0 ms |                           54.8 ms |             839.6 ms |               1.7 ms |           16.9 ms |            915.4 ms |
| Glass Arcade |      49.8 ms |                           59.9 ms |            2327.1 ms |               1.8 ms |           16.6 ms |           2440.4 ms |

Welcome's six native samples were 818.5, 826.4, 828.3, 850.9, 855.3 and 868.1 ms. Glass Arcade's were 2295.3, 2300.7, 2311.6, 2342.7, 2610.2 and 2804.8 ms. All six WAV byte hashes agreed within each workload. Welcome rendered 869,637 frames including 113,637 tail frames; Glass Arcade rendered 844,227 including 150,194 tail frames. Both outputs were stereo at 44.1 kHz. These results establish deterministic repeats for these two fixed projects in this run. They do not establish source parity for arbitrary sample-backed projects or stems; the focused browser suites cover those paths.

Native rendering accounted for about 92% of Welcome's median render wall time and 95% of Glass Arcade's. The one-run R-03 medians were higher despite the same browser version and development mode. They are historical context, not a candidate comparison. The six-pass baseline is the comparison point for any future candidate.

## Candidate decision and timing-slot release

Source review and the baseline did not identify a material controllable native-render phase in `render.ts`. Worklet ACK, setup, channel copying and WAV encoding happen outside `startRendering()` and cannot lower its median. The native graph's remaining work is voice synthesis, FX, lane mixing, deterministic serial summation, and the required tail. Shortening the tail, bypassing active FX, reducing channels or sample rate, or changing summation order would violate the export or byte-parity contract. FX implementation and worklet DSP are outside P-07 ownership. No candidate was applied, so no candidate timing series was run and the 15% production acceptance gate is unmet.

P-07 released the host timing slot after this baseline and decision. Heavy validation follows separately. The result for this slice is a measurement-only PR with no production source change.

## Verification

The focused unit command passed 3 files and 28 tests:

```powershell
& .\node_modules\.bin\vitest.cmd run --project unit tests/render.test.ts tests/exportWav.test.ts tests/wav.test.ts
```

After the manager granted the validation slot, the focused browser command passed 8 files and 40 tests. It covered WAV export, linear export, audio determinism, render parity, lane mix, fingerprints, sample-backed voices, and video export with stems:

```powershell
& .\node_modules\.bin\vitest.cmd run --project browser tests/browser/exportWav.test.ts tests/browser/linear-export.test.ts tests/browser/audio-determinism.test.ts tests/browser/render-parity.test.ts tests/browser/render-mix.test.ts tests/browser/render-fingerprint.test.ts tests/browser/sample-voice.test.tsx tests/browser/exportVideo.test.tsx
```

Four fingerprint cases warned that the checked-in reference hashes are pinned to another browser environment. They did not fail the suite. The result establishes the existing runtime laws on this branch and browser; it does not prove cross-environment fingerprint equality. Syntax check, changed-file ESLint, TypeScript `--noEmit`, and Vite production build also passed. Typecheck and build ran after the browser suite, sequentially. Vite reported two ineffective dynamic imports in unrelated persistence modules but built successfully. No source change means these checks guard the measurement PR rather than validate a speedup.
