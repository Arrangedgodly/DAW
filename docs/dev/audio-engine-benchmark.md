# Audio engine benchmark

Open `/audio-engine-benchmark.html` from the Vite development server and click **Run 5-pass comparison**. This development-only page does not play or change project audio. It runs deterministic parity probes first, then five sequential timed passes per renderer with one warm-up per renderer. The page displays the complete report and fails on non-finite output, invalid lengths, non-silent priming, changed input, or dry impulse parity/index errors.

## What it measures

- **Dry wire parity:** native direct wire vs primed Elementary `el.in`, including the first sample and full output window.
- **Fixed wet parity:** native `ConvolverNode` (`normalize = false`) vs Elementary `el.convolve`, with the same seeded stereo IR and fixed 0.5 gain.
- **Fixed full-chain parity:** explicit native dry 0.75 + wet 0.5 graph vs the matching Elementary graph. Both include all channels and padded output through the complete IR tail. The report gives whole-signal relative RMS, absolute peak and its index/channel, first nonzero output indices, and startup/settled/tail windows.
- **Discriminating probes:** dry impulses at 0, 512, and 1024 verify exact index and amplitude. Left-only and right-only impulses pass through the stereo IR to expose channel mixing or swaps.
- **Production cold startup:** the actual `createReverbDevice` graph starts at time zero, and the report describes its first 100 ms. Its 10 ms target automation is intentionally kept separate from fixed-gain convolution parity.
- **Settled throughput:** both engines render the same 4096-frame silent pre-roll plus the program and complete tail. Native uses `createReverbDevice`; Elementary uses a fixed-gain graph after the same silent pre-roll. The pre-roll is included in both processing timers. Timed renderers run sequentially in alternating order, and raw pass times are shown beside medians.

The Elementary public API has a version-specific 20 ms root fade. After `render()`, the benchmark advances it using 1024 silent samples (two 512-frame blocks), asserts that output is silent, then passes the full real input from sample zero. This margin exceeds the observed 882-sample fade at 44.1 kHz. The silent prime is discarded; no real input transient or tail samples are cropped.

## Reproducibility and limits

The report includes the full browser user agent, platform, foreground/background visibility, device-context sample rate and browser-reported latency metadata, sample rate, block size, IR seed and length, program length, frame counts, warm-up rule, pass count, raw timings, and timing inclusions/exclusions. `baseLatency` and `outputLatency` describe browser-reported context metadata only. The timing is offline throughput, not DSP CPU load, render-quantum deadline success, physical latency, or evidence for an engine recommendation. The native timer surrounds asynchronous `startRendering`; the Elementary timer surrounds synchronous `process`, including JS/WASM block copies. Both exclude graph setup, IR generation, buffer allocation, and native channel extraction.

Wet differences are reported across the complete output and explicit windows without time shifting, gain fitting, or widened pass tolerances. Interpret any remaining material difference from those measurements and the channel probes before describing the renderers as parity-qualified. This offline benchmark does not validate the live AudioWorklet, project routing, parameter updates, bypass, disposal, glitches, or listening quality; repeat on target browsers/devices and audition before making an engine decision.

Research findings and the implementation acceptance contract are preserved in [`fx-benchmark-research.md`](fx-benchmark-research.md), with the R-02 handoff in [`../tasks/fx-handoffs/R-02.md`](../tasks/fx-handoffs/R-02.md).
