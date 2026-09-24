# Cold Play repeat and attribution (P-05)

Measured 2026-09-24 in an uncontended slot on Windows x64, headless Chromium 151.0.7922.34, 1280 × 720. Base was `perf/latency-map` at `a292f3d` (its R-03 observation was one 94.5 ms Vite first Play). Each pass used a new browser context and page, loaded the Welcome demo, clicked Play once, observed the first nonempty voice-worklet `events` port post, stopped, then clicked Play again for a warm-path observation. Passes ran serially. The script records capture-click, context resume, each worklet `addModule`, post, fetch, decode, warm click and errors in browser `performance.now()` time. The built runs served `dist` through Vite preview; they did not use a deployed site.

Run with `node tests/perf/cold-start.mjs --out <file> --runs 12`; add `--mode built` after `vite build` for the release-asset check. Raw, individual passes are in [dev baseline](cold-start-baseline-dev.json), [built baseline](cold-start-baseline-built.json), [dev candidate](cold-start-candidate-dev.json), and [built candidate](cold-start-candidate-built.json). Candidate files were collected with an uncommitted ordering experiment on top of `a292f3d`, then that experiment was reverted. Their `revision` field therefore names the base commit, not a production commit containing the candidate.

| Run, 12 fresh contexts each | First post samples, ms, in pass order | Median | p95* | Warm median |
| --- | --- | ---: | ---: | ---: |
| Vite baseline | 131.9, 51.4, 57.5, 50.8, 46.5, 47.8, 48.4, 68.7, 52.7, 53.1, 58.5, 50.4 | 52.05 | 131.9 | 0.3 |
| Vite candidate | 67.6, 73.0, 73.6, 63.8, 51.8, 60.7, 51.0, 48.1, 53.2, 47.5, 46.2, 46.3 | 52.50 | 73.6 | 0.3 |
| Built baseline | 77.4, 56.5, 54.3, 47.1, 57.7, 60.1, 67.3, 62.8, 56.1, 48.6, 48.9, 53.2 | 56.30 | 77.4 | 0.3 |
| Built candidate | 60.8, 65.2, 64.9, 66.6, 55.0, 48.4, 49.2, 46.2, 57.8, 64.4, 68.3, 62.0 | 61.40 | 68.3 | 0.3 |

*Nearest-rank p95 for 12 observations is the highest sample. The 131.9 ms first Vite pass included a 62.7 ms resume and 35.3 ms voice-module load while Vite logged dependency re-optimization. Removing it after the fact would distort the requested fresh-context series, so it remains in the raw result and p95.

## Phase attribution and decision

Baseline median phase durations were: resume 13.4 ms (Vite) / 16.25 ms (built), voice module 8.5 / 7.4 ms, mixer module 2.45 / 3.55 ms. The voice module began a median 13.95 / 16.95 ms after the click, following resume. From the later module completion to the first post was another median 26.4 / 26.1 ms; this includes graph setup and scheduler delivery, which this probe does not separate. The Welcome Play path made zero post-click sample fetches and zero decodes in all 48 passes. Every pass posted a first batch of two events and had no page error or null observation.

The one candidate moved the existing `ensureVoiceEngine()` start from after the awaited context unlock to immediately after calling `unlock()`, so worklet preparation could overlap an in-flight `resume()` without moving the gesture call. The candidate began its voice module around 0.6 ms after click, but its median measured `addModule` interval lengthened to 19.9 ms on Vite and 22.05 ms on built assets. Median first-post time changed by **+0.45 ms** on Vite and **+5.10 ms** on built assets. Warm median remained 0.3 ms. This ordering change fails the required 20% median reduction and was removed. No production audio code changed.

The result does not establish that overlap itself caused the slower module interval: runs were sequential by condition, not randomized, and the headless browser and OS may vary between series. It does establish that this measured candidate did not meet the acceptance gate. Resume, worklet loading, and the remaining graph/scheduler interval all contribute; the small mixer module interval alone cannot plausibly provide a 20% median gain in these runs. We did not shorten the scheduler horizon, change worklet initialization or voices, or change sample behavior.

This measures delivery to a worklet port, not worklet consumption or audible onset. There was no listening test, physical loopback, device-output capture, phone run, or sample-backed Play workload. The first batch count is a control-side check, not proof that all initial notes sounded. Browser audio tests and deterministic render tests passed separately; they do not turn these timing samples into audible-output evidence.
