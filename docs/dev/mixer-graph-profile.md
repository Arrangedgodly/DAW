# Mixer graph setup and live-load attribution (R-04)

Measured 2026-09-24 after the manager granted a clear-host slot following P-06 validation. No production audio or document code changed.

## Question and measurement boundary

R-01 found that `createChannelProcessing` constructs eight biquads and three gains per EQ slot even when EQ is disabled. P-05 measured about 26 ms median from the later worklet module completion to the first event post, a region that also includes graph construction and scheduling. Node count is a topology fact, not evidence of CPU use on the audio render thread.

`tests/perf/mixer-graph.mjs` runs in real Chromium through a local Vite server. It first clicks the app's Play button and captures the first nonempty voice `events` port post. That is control-side delivery, not audible onset. It then builds fresh, four- and eight-channel browser graphs with the production `prepareMixer`, `createChannelProcessing`, and `createMasterProcessing` functions. Each graph is constructed after the mixer worklet module is loaded. The setup stopwatch covers master/lane gain creation, the shared processing builders, and connections to the destination. The module interval is reported separately. Browser API wrappers count created node types and `connect` calls during that interval. A 220 Hz oscillator feeds channel 1; an analyser attached to the final graph output checks that samples arrive. Each context is resumed, sampled, stopped, and closed before the next case.

The default case uses disabled EQ, channel/master compressor and limiter. The enabled case activates eight explicit peaking EQ bands, channel/master compression, and limiting. This is a processing-heavy diagnostic case rather than a saved song. The stripped case connects only lane gains to a master gain in the probe; it is a construction floor with a different sound path and is never used by production. All cases use 44.1 kHz and run sequentially. Case order rotates between passes. `--runs 8` yields eight observations per lane count and mode, plus one real app Play observation. Raw data retains individual pass order, module/setup durations, node counts, connections, output peak, context states, browser and OS identifiers, and page errors.

The approved run used:

```powershell
$env:GIT_COMMIT = (git rev-parse HEAD)
node tests/perf/mixer-graph.mjs --out docs/dev/mixer-graph-samples.json --runs 8
```

The run completed in 9.84 seconds on Windows x64 and headless Chromium 151.0.7922.34, using a 1280 × 720 browser page. Vite reported dependency re-optimization during launch, before the graph cases. [Raw passes](mixer-graph-samples.json) preserve the user agent, all module/setup samples, graph counts and states. All 48 graph cases produced a nonzero output peak, resumed to `running`, closed to `closed`, and had no page error.

| Lanes / mode | Setup ms, pass order | Median | Nodes | Connections |
| --- | --- | ---: | ---: | ---: |
| 4 default | 2.6, 2.6, 2.5, 2.5, 3.3, 3.2, 3.8, 3.0 | 2.8 | 185 | 227 |
| 4 enabled | 3.6, 3.4, 2.2, 3.0, 3.8, 3.4, 2.7, 2.8 | 3.2 | 185 | 227 |
| 4 stripped | 0.1, 0.1, 0.1, 0.1, 0.1, 0.0, 0.0, 0.1 | 0.1 | 5 | 5 |
| 8 default | 5.5, 5.9, 4.8, 4.8, 6.1, 5.4, 4.7, 5.3 | 5.35 | 357 | 439 |
| 8 enabled | 5.0, 6.9, 4.7, 4.8, 6.6, 5.1, 5.3, 5.9 | 5.2 | 357 | 439 |
| 8 stripped | 0.1, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2 | 0.1 | 9 | 9 |

The eight-lane default graph created 274 gains, 64 biquads, 8 panners, 9 compressor worklets, one limiter worklet, and one waveshaper. The four-lane graph created 142 gains, 32 biquads, 4 panners, 5 compressor worklets, one limiter, and one waveshaper. Enabled processing changed parameter state but not topology. The stripped graph is a different audible path and provides only a construction floor. The single app Play captured a first nonempty two-event worklet post 152.8 ms after click; it is not a repeated first-Play comparison and included initial Vite re-optimization. P-05's repeated roughly 26 ms post-module interval includes scheduler and other setup work, so these independent runs cannot be subtracted from each other as phase attribution.

The standard browser page API exposed no trustworthy `AudioWorkletProcessor.process()` CPU duration or render deadline metric for this probe: ordinary page timing and node count cannot observe the audio render thread. No live-load percentage, glitch-rate improvement, or hardware output latency follows from these cases. If a browser/device trace with attributable render-thread deadlines becomes available, that can be a separate experiment. Offline `startRendering()` throughput is likewise a different quantity and was not measured here.

## Source and lifecycle constraints

- `Session.ensureVoiceEngine()` awaits the voice host, then `prepareMixer()`, then `ensureMaster()`, eight `ensureLaneGain()` calls, and eight `buildLaneChain()` calls. The runtime always uses eight lane IDs, even if fewer lanes contain musical events. Four-lane results in this probe represent a scaled diagnostic graph, not a four-lane `Session` Play.
- The channel's EQ dry route and eight wet/dry slots stay connected while `set()` changes band state with 8 ms gain ramps. A deferred graph must preserve that transition, the legacy four-control EQ mapping, pan, and offline render parity. `renderProjectToBuffer()` calls the same processing builders when mixer settings exist.
- Channel and master compressors each keep a connected wet worklet branch. Disabled compressor processing copies samples and resets its envelope and gain state. The master keeps both soft clip and limiter branches wired and chooses their audible level with gains. Muting a branch does not establish render-thread work avoidance.
- Processing builders return node closures but no explicit `dispose()`. The live `Session` retains them in `laneProcessing` and `masterProcessing`; graph lifetime is tied to the context. The probe closes every fresh context. Lazy creation in a later PR would need a bounded lifecycle and first-enable timing check, because creating nodes on an edit could cause a click, stale state, or a control-thread pause.

## Decision gate

**No production change is supported by this evidence.** The eight-lane mixer-builder median was 5.35 ms, while default and enabled topology counts were identical. Removing the entire production processing graph would give an unrealistic upper bound of about 5 ms in this harness and alter sound, so a narrower lazy-node change has an unknown, smaller setup win and lifecycle risk. The probe provides no evidence that muted branches save live rendering work. A future implementation would need an attributable deadline/glitch or render-thread trace, a measured setup target against repeated app Play, graph/sound compatibility on enable and bypass transitions, live/offline parity, and lifecycle memory evidence before choosing a topology. Neither result claims lower live render CPU or output latency.
