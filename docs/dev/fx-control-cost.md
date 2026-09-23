# FX control update cost

Reverb size changes now generate and assign a new impulse response only when
the requested size differs from the last size successfully assigned. Mix-only
updates keep using the current convolver buffer. Delay tempo sync uses the
latest accepted delay parameters, including a user-edited `timeSteps` value.

## Deterministic reverb workload

The earlier fake-context comparison ran the same seeded `renderImpulseResponse` path
at 44.1 kHz with 24 repeated size cycles. Each cycle changed size from 0.2 to
0.8, made three mix-only updates at 0.8, and restored size 0.2. This is 120
`setParams` calls per pass. The baseline reproduces the former comparison
against constructor size; the fixed side calls `createReverbDevice` and uses
its production setter. The fake Web Audio context counts `AudioBuffer`
allocations and convolver buffer assignments. Both versions ran three warmup
passes followed by nine timed passes; times below are median synchronous
control-update times, not render or sound output latency.

| Version  | Buffer allocations per pass | Buffer assignments per pass |   Median control-update time |
| -------- | --------------------------: | --------------------------: | ---------------------------: |
| Baseline |                          97 |                          97 | 229.66 ms (227.73–233.90 ms) |
| Fixed    |                          49 |                          49 |    95.72 ms (94.81–98.52 ms) |

## Native Chromium timing

A second benchmark uses native Chromium `OfflineAudioContext`, `AudioBuffer`,
`ConvolverNode`, and `AudioParam` instances. Its baseline factory is generated
from the actual `src/audio/fx.ts` at commit `27acaec`; its fixed factory is
imported from the current `src/audio/fx.ts`. Both run the same 24-cycle seeded
workload described above. Three warmup passes and nine measured passes per
version alternate order. The harness records raw pass times, runtime
environment, and cumulative buffer allocation/assignment counts after every
setter call. It measures synchronous control updates only and does not render
or measure audio output latency.

Run from PowerShell:

```powershell
node scripts/prepare-fx-control-cost-baseline.mjs
$env:VITE_FX_CONTROL_COST_BENCH = '1'
node node_modules/vitest/vitest.mjs run --project browser tests/browser/fx-control-cost.bench.test.ts --reporter=verbose
Remove-Item Env:VITE_FX_CONTROL_COST_BENCH
```

The initial Windows 10 x64 run on `HeadlessChrome/151.0.7922.34` with 16
reported logical processors emitted baseline/fixed medians of 1048.00 ms and
465.00 ms, then hit Vitest's default 15-second timeout. After P-01 released the
timing slot, the identical run passed under the retained 60-second timeout:
97 versus 49 allocations and assignments per pass, medians of 1254.30 ms
(1001.80–1574.80 ms) baseline and 619.00 ms (441.90–703.80 ms) fixed. The
original raw report and timeout record remain in
`docs/tasks/fx-handoffs/P-02-timing-complete.md`; the successful rerun's raw
samples, environment, order, and per-step counts are in
`docs/tasks/fx-handoffs/P-02-timing-rerun.md` and its JSON sidecar.

The A-B-A edit sequence requires the initial buffer plus one buffer for each
actual size transition, so mix changes add no buffers and restoring A creates
the needed replacement buffer. These synthetic timings cover seeded IR
generation and fake buffer copies on the measured runtime. They do not predict
render-thread scheduling, device output latency, or an end-to-end user-perceived
latency improvement. Chromium timings likewise measure control updates only;
they do not measure rendered audio or output latency.

## Regression coverage

- `tests/fx.test.ts` counts allocations and buffer assignments across repeated
  size/mix edits and a return to the original size, and checks that unrelated
  device types are ignored.
- `tests/fx.test.ts` edits delay `timeSteps`, changes tempo, then checks the
  synchronized interval still uses the edited value.
- `tests/browser/fx-graph.test.ts` verifies the final reverb A-B-A render
  matches a fresh render at the restored settings, and renders the configured
  7-step delay interval at 90 BPM through Chromium's `OfflineAudioContext`
  graph. The edit-then-tempo-sync behavior is specifically covered by the
  `tests/fx.test.ts` unit test.
