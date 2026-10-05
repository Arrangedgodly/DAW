# Full-system latency map

R-03 source and measurement report, 2026-09-24. Baseline is `main` at `27acaec`. The manager granted an uncontended slot for one sequential Chromium run. [Raw browser samples](latency-map-samples.json) include every captured event and individual pass. This report does not infer output latency from offline render speed.

## Terms and observation points

| Quantity | Start and stop | What it says |
| --- | --- | --- |
| Gesture to first posted note | Capture the Play click, then the first nonempty `MessagePort.postMessage({type: "events"})` batch | Control-side progress toward sound. The worklet still has to receive, render, and output it. |
| Worklet load | Each `AudioWorklet.addModule` call to settled promise | Module request, parse and installation as one browser-observed interval. The probe does not separate network, compilation and worklet startup. |
| Edit commit | Call `toggleDrumStep` to its return | Synchronous document validation, subscriptions and schedule update. A note already delivered inside the horizon cannot be replaced by this commit. |
| Frame work | Duration of each `requestAnimationFrame` callback and interval between timestamps, grouped by visible grid, mixer and visualizer scenario | Main-thread callback work and frame cadence. It does not measure browser layout, raster or GPU time after the callback. |
| Mixer poll | `AnalyserNode.getFloatFrequencyData` call duration and count | One part of the 80 ms mixer poll. Solid updates and graph drawing need a separate trace. |
| Autosave | Edit time, IDB `put` issue duration and request success | Storage request observation. It does not equal durable disk flush; dirty metadata and full-record writes must be distinguished by record inspection. |
| Offline render | `renderProjectToBuffer` wall time, `OfflineAudioContext.startRendering` wall time, and WAV encode wall time | Offline throughput. Worklet load, graph setup, ACK wait, settle, output copies and tail handling fall outside `startRendering`. |
| Output latency | `AudioContext.baseLatency` and `outputLatency` when exposed | Browser estimates on the active device. Physical click-to-speaker latency needs loopback and is not inferred here. |

## Source path map

| Path | Code evidence | Expected boundary and unresolved question |
| --- | --- | --- |
| First Play | `src/components/Booth.tsx:680-704` calls `Session.togglePlay`; `src/engine/session.ts:366-439` awaits `AudioEngineContext.unlock`, optionally preloads selected samples, requests voice-engine initialization, then calls `transport.play`; `src/audio/context.ts:19-58` lazily creates a 44.1 kHz context and resumes it. | First gesture can include context creation/resume and, for sample sounds, fetch/decode. There is no measured audible-onset time. |
| Worklet startup | `src/audio/voiceEngine.ts:185-219` awaits the voice/bitcrusher module, then creates lane nodes; `src/engine/session.ts:1857-1901` follows with `prepareMixer`; `src/audio/mixer.ts:22-32` caches the mixer module promise per context. | The two `addModule` intervals and graph creation may overlap pre-roll. The current probe sees module promises, not each node constructor or first render quantum. |
| Scheduling | `src/audio/transport.ts:104,139-156` defines a 100 ms play pre-roll and starts the scheduler; `src/audio/scheduler.ts:66-80,132-183` uses 25 ms refill, a 120 ms foreground horizon, and a 1.5 s hidden horizon. `src/engine/session.ts:518` routes ticks to note events. | Keep the 120 ms foreground horizon. A shorter horizon raises missed-note risk under busy main-thread or throttled timer conditions. Event post time is earlier than an audible note. |
| Live edit | `src/state/store.ts:291-314` commits a drum toggle through document validation; `src/state/engineBridge.ts` recompiles lane schedules; `src/engine/session.ts:810-839` swaps same-structure event maps for undelivered steps. | Measure commit wall time and the time to next deliverable note separately. The probe presently measures only commit wall time. |
| Mixer UI | `src/components/MixerPage.tsx:208-226` polls every 80 ms, reads all levels and reductions, allocates a 2048-bin output array, and reads selected spectrum; `src/engine/session.ts:1554-1569` reads two analysers and allocates a right-channel array in this baseline. | P-03 owns the right-channel scratch reuse. The R-03 poll sample is a baseline observation, not a competing implementation. |
| Grid and visualizer | `src/grid/renderer.ts:2886-2950` runs the grid animation loop; rewindow timing is exposed at `src/grid/renderer.ts:1767-1823`. `src/viz/renderer.ts:303,359-386` runs the visualizer draw loop when active. | The rAF wrapper records aggregate callback time by page scenario; callback attribution, layout, compositing and device GPU time remain unmeasured. Existing frame-budget gates in `tests/browser/frame-budget.test.ts` should stay the regression floor. |
| Persistence | `src/persist/autosave.ts:181-211` hashes each committed document, marks dirty, and starts an 800 ms trailing debounce. `flush` at lines 148-179 serializes full writes. A 30 s interval and page hide also flush at lines 234-249. | Hash work is on the edit path. IDB request success is later than issuing `put`. There is no crash/durability test in this probe. |
| WAV export | `src/audio/render.ts:283-580` builds an offline graph, loads worklets and samples, sends events, awaits ACK, calls `startRendering`, and copies/folds output. `src/audio/exportWav.ts:66-108` encodes 16-bit stereo WAV and downloads it. | Separate setup, render and encode; browser download/UI delay is outside the current probe. |
| Video export | `src/viz/exportVideo.ts:33-173` renders lane stems, draws frames, encodes audio/video, and finalizes MP4. | Source-mapped only. Codec availability, per-frame drawing, queue pressure and finalize time need a later browser trace. |

The R-01 FX audit at `docs/dev/fx-performance-audit.md` and R-02 Elementary diagnosis at `docs/dev/fx-benchmark-research.md` cover effect costs and offline engine parity. Their numbers are not live latency measurements. P-02 and P-04 handle FX control work; this PR makes no production FX changes.

## Reproduce the planned browser run

The manager granted an uncontended timing slot for the command below. Use this isolated checkout and close other benchmarks for any repeat. The script starts Vite on a local ephemeral port, launches headless Chromium, and runs all cases serially in one browser context. It writes raw JSON with browser version, user agent, OS/architecture, viewport, each pass, and timestamps. The `node_modules` directory in this checkout is a junction to the original checkout's installed packages; the probe writes only its requested output file.

```powershell
git rev-parse --short HEAD
$env:GIT_COMMIT = (git rev-parse HEAD)
node tests/perf/latency-map.mjs --out docs/dev/latency-map-samples.json
```

The workloads are the built-in `welcome` four-track demo and `glass-arcade` eight-track demo at 1280 x 720. Each gets one initial Play pass and two warm passes, a drum edit plus autosave wait, and roughly 600 ms grid, mixer and visualizer windows during playback. Three sequential linear WAV renders per project record total render, native offline render, and WAV encoding. Since the browser stays open, only the first Play is a truly cold module load. A separate fresh-context cold distribution would require fresh pages or contexts and was not run. P-04 had completed its timed checks before this run.

The first posted note may be absent if the chosen project has no event near the scheduler horizon. In that case the summary returns `null` and the raw event list remains available; the probe never reports zero milliseconds for a missing observation. The built-in demos are expected to contain active steps, but this has not yet been verified in a timed browser run.

The script uses a development Vite page. For a release-asset startup comparison, repeat against the built app in a later slice with the same click and worklet markers. Dev server module loading can differ from deployed assets. A headless browser cannot establish physical speaker latency or listening quality. A browser launch failure, audio unlock failure, or missing note event must stay an unrun or incomplete measurement.

## Browser samples

Command above exited 0 in 28.65 s. Browser was headless Chromium 151.0.7922.34 on Windows `win32/x64`; user agent and every raw sample are in the JSON. These are one machine and one browser run. The app ran through Vite's development server. The first Vite launch logged a dependency re-optimization before the page interaction.

| Workload | Gesture to first posted note, ms | Context resume, ms | Worklet `addModule`, ms |
| --- | --- | --- | --- |
| Welcome, first Play | 94.5 | 37.9, suspended to running | Voice 16.0; mixer 13.2 |
| Welcome, warm Play 1 and 2 | 0.4; 0.3 | Already running | Already loaded |
| Glass Arcade, warm Play 0, 1 and 2 | 0.5; 0.2; 0.3 | Already running | Already loaded |

The first Welcome event batch was posted at performance timestamp 2012.0 ms after a click at 1917.5 ms. The context resume ended at 1955.8 ms; voice module loading ended at 1972.3 ms; mixer module loading ended at 1986.3 ms. This sequence explains much of the first-post delay without assigning causality to a single phase. It does not say when the worklet consumed the batch or when a speaker produced sound. The context reported `baseLatency` 10 ms and `outputLatency` 0 ms in headless Chrome. Those are browser values for a virtual output device, not a measured speaker path.

| Workload and scenario | rAF callback p95 / max, ms | Unique frame timestamp p95 / max, ms | Analyser calls in mixer window |
| --- | --- | --- | --- |
| Welcome grid playing | 0.3 / 0.5 | 16.7 / 16.8 | n/a |
| Welcome mixer playing | 0.1 / 0.1 | 16.7 / 33.2 | 14, call p95 0.2 ms |
| Welcome visualizer playing | 2.9 / 5.9 | 16.8 / 16.8 | n/a |
| Glass Arcade grid playing | 0.4 / 0.7 | 16.8 / 16.8 | n/a |
| Glass Arcade mixer playing | 0.1 / 0.1 | 16.7 / 16.7 | 14, call p95 0.2 ms |
| Glass Arcade visualizer playing | 5.6 / 13.8 | 16.7 / 33.4 | n/a |

Each window contains only 34 to 39 distinct frame timestamps. The rAF wrapper measures callback time across the page, not a named renderer alone. The higher visualizer samples make it a candidate for attribution on a real device; they do not prove dropped frames or an audio render deadline miss. The mixer analyser count is two channels per 80 ms poll. The visualizer snapshot retained earlier analyser entries, so it is deliberately excluded from the analyser column.

The one drum edit per workload took 5.2 ms for Welcome and 4.8 ms for Glass Arcade. Two IDB `put` requests followed each edit: Welcome request-success intervals were 1.8 and 0.4 ms; Glass Arcade's were 0.4 and 0.7 ms. The probe did not classify which request was the dirty mark versus full autosave record, and IDB success is not a durability timestamp. This is too little edit sampling to rank a store rewrite.

| Workload, frames at 44.1 kHz | `renderProjectToBuffer` passes, ms | `startRendering` passes, ms | WAV encode passes, ms |
| --- | --- | --- | --- |
| Welcome, 869,637 | 1081.7; 1088.6; 1149.5 | 992.8; 1008.3; 1075.1 | 18.6; 16.9; 17.4 |
| Glass Arcade, 844,227 | 3091.7; 2872.8; 3080.8 | 2969.1; 2752.9; 2954.1 | 16.8; 18.4; 17.0 |

The median native render times were 1008.3 ms and 2954.1 ms respectively. The median non-`startRendering` portion of `renderProjectToBuffer` was 80.3 ms for Welcome and 122.6 ms for Glass Arcade. These projects have different arrangements, so the difference is not a controlled track-count scaling result. WAV encoding was about 17 to 19 ms. Browser download time and MP4 video export phases were not measured. The existing Elementary benchmark measures a different workload and should not be compared to these numbers.

No physical loopback, microphone capture, manual audio audition, real phone run, audio rendering deadline trace, missed-note count or background-tab timing run was available. The 120 ms foreground horizon and 1.5 s hidden horizon remain unchanged.

## Ranked follow-up PR contracts

The ranking uses the measured cold start and callback differences, with scope and acceptance that can be reviewed separately. It does not select an engine replacement.

| Rank | PR and ownership | Baseline and acceptance metric | Risk |
| --- | --- | --- | --- |
| 1 | Cold startup attribution and, only if a single phase dominates across fresh contexts, a narrow loader/graph setup change. Own `src/audio/voiceEngine.ts`, `src/audio/mixer.ts`, `src/engine/session.ts` and focused startup tests; avoid P-03/P-04 files while those PRs are open. | Baseline 94.5 ms first gesture to first posted note with 37.9 ms resume, 16.0 ms voice module and 13.2 ms mixer module from one cold run. Collect at least 10 fresh-context baseline samples on one browser/device. Target at least 20% lower median gesture-to-first-posted-note without higher p95, missed notes, changed output samples or sample-backed regression. | High: module caching, context policy and first render timing differ from posted-event timing. Require loopback or listening before claiming audible onset improvement. |
| 2 | Visualizer callback attribution and one narrow draw reduction if a real target device repeats the cost. Own `src/viz/renderer.ts`, the visualizer frame producer under `src/viz/`, and focused visualizer tests. | Baseline eight-track visualizer callback p95 5.6 ms, max 13.8 ms in 34 frame timestamps; grid p95 0.4 ms in the same browser run. Attribute callbacks with a browser trace and repeat on a target device. Target at least 25% lower visualizer callback p95 without changing rendered frames, dropped-frame ratio, or audio-event delivery. | Medium: headless callback cost may not predict GPU paint, and reduced draw detail could alter visuals. |
| 3 | Offline render throughput attribution and one bounded render-phase reduction. Own `src/audio/render.ts` and its export tests; leave P-01's Elementary benchmark files alone. | Baseline native median 1008.3 ms for Welcome and 2954.1 ms for Glass Arcade, three passes each. Confirm a dominant graph component with isolated configurations. Target at least 15% lower median `startRendering` time on both projects with byte-identical WAV and unchanged stereo/tail/determinism checks. | High: an offline win does not show lower live latency; graph changes can alter audio. |

P-03 already owns spectrum scratch storage, so the mixer poll is not duplicated here. Edit commit and autosave have too few samples for an optimization PR; their next step is a longer representative edit series. The horizon remains 120 ms until a follow-up measures missed events and timing jitter under main-thread load and background transitions.
