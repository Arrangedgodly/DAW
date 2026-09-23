# P-02 Chromium timing complete

Written immediately after the single real Chromium timing run. The benchmark
completed all warmup and measured passes and emitted the raw record, but Vitest
reported a test timeout at its default 15 second test limit after the report
was printed. Treat measurements as collected, with this harness timeout as a
verification limitation. The benchmark test timeout will be raised for future
reproducible runs; do not rerun this timed workload for this task.

## Runtime and protocol

- Browser: `HeadlessChrome/151.0.7922.34` (Chromium), Windows 10 x64 UA,
  `navigator.platform=Win32`, `hardwareConcurrency=16`.
- Native `OfflineAudioContext`, native `AudioBuffer`, `ConvolverNode`, and
  `AudioParam` objects; 44,100 Hz sample rate. Benchmark measures synchronous
  setter workload with `performance.now()`. It does not call `startRendering`
  and does not measure audio output latency.
- Baseline factory source was extracted from commit `27acaec` by
  `scripts/prepare-fx-control-cost-baseline.mjs`. Fixed factory is imported
  from `src/audio/fx.ts`.
- Workload: seed 1977; 24 repeated cycles; size A 0.2, size B 0.8, three
  mix-only edits at B (0.2, 0.6, 0.9), then restore A; 120 setter calls per
  pass. Three warmup passes per version and nine measured passes per version,
  alternating execution order.
- Per-edit native buffer allocation/assignment counts were recorded in the
  console output. Both counts rise equally because each generated IR is copied
  into one native buffer and assigned once.

## Results

| Version  | Buffer allocations and assignments per pass | Median setter time |          Raw range |
| -------- | ------------------------------------------: | -----------------: | -----------------: |
| Baseline |                                          97 |        1,048.00 ms | 987.10–1,157.70 ms |
| Fixed    |                                          49 |          465.00 ms |   420.50–485.50 ms |

Raw milliseconds, in measured order by version:

- Baseline: 1155.8, 987.3, 988.0, 1157.7, 1099.6, 1067.8, 987.1, 1048.0,
  1021.6 ms.
- Fixed: 469.5, 437.2, 438.7, 447.6, 465.0, 469.2, 480.4, 420.5, 485.5
  ms.

The complete output included per-step cumulative allocation and assignment
counts for all 120 updates per version. Starting with one initial allocation,
the baseline increment sequence repeats `[+1, +1, +1, +1, 0]` 24 times; the
fixed sequence repeats `[+1, 0, 0, 0, +1]` 24 times. Thus the baseline adds
three buffers at the mix-only B edits, while the fixed version leaves counts
unchanged there and adds one on each A-to-B and B-to-A transition.

## Reproduction

```powershell
node scripts/prepare-fx-control-cost-baseline.mjs
$env:VITE_FX_CONTROL_COST_BENCH = '1'
node node_modules/vitest/vitest.mjs run --project browser tests/browser/fx-control-cost.bench.test.ts --reporter=verbose
Remove-Item Env:VITE_FX_CONTROL_COST_BENCH
```

The command above needs a Vitest test timeout above 15 seconds. The default
timeout was the reason the completed report was followed by a failing test
status. No audio output latency result is claimed.
