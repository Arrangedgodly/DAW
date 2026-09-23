# P-02 Chromium timing rerun

This is the separately authorized rerun after P-01 released the benchmark
slot. It preserves the earlier raw timing and 15-second timeout history in
`P-02-timing-complete.md`; it does not replace it.

## Command and status

```powershell
$env:VITE_FX_CONTROL_COST_BENCH = '1'
node node_modules/vitest/vitest.mjs run --project browser tests/browser/fx-control-cost.bench.test.ts --reporter=verbose
```

- Exit status: **0** (benchmark test passed under its corrected 60-second
  timeout).
- The complete console report is preserved in
  [`P-02-timing-rerun.json`](P-02-timing-rerun.json), including runtime data,
  warmup and measured order, nine samples per version, and allocation and
  assignment counts after each of the 120 updates per pass.

## Runtime and workload

- Chromium: `HeadlessChrome/151.0.7922.34`, Windows 10 x64 user agent;
  `navigator.platform=Win32`; `hardwareConcurrency=16`.
- Native `OfflineAudioContext`, `AudioBuffer`, `ConvolverNode`, and
  `AudioParam`; sample rate 44,100 Hz.
- Three warmup passes per version, then nine measured passes per version in
  alternating order. Baseline source was generated from `27acaec`; fixed
  source was imported from production `src/audio/fx.ts`.
- Each pass made 120 setter calls: 24 seeded cycles of size 0.2 to 0.8, three
  mix-only changes at size 0.8, and restoration to size 0.2.
- Timing covers synchronous setter work only. It does not render audio or
  measure output latency.

## Results

| Version  | Buffer allocations/pass | Buffer assignments/pass | Median setter time |            Raw range |
| -------- | ----------------------: | ----------------------: | -----------------: | -------------------: |
| Baseline |                      97 |                      97 |        1,254.30 ms | 1,001.80–1,574.80 ms |
| Fixed    |                      49 |                      49 |          619.00 ms |     441.90–703.80 ms |

Raw synchronous setter times in measurement order by version:

- Baseline: 1082.6, 1010.4, 1001.8, 1574.8, 1472.4, 1486.3, 1254.3, 1132.4,
  1406.2 ms.
- Fixed: 457.8, 441.9, 453.5, 638.5, 703.8, 644.1, 619.0, 560.9, 622.0 ms.

The rerun passed with exit status 0. The timing variation is retained in the
raw samples; allocation and assignment counts were stable at 97 baseline and
49 fixed. These are synchronous control-update timings, not audio output
latency measurements.
