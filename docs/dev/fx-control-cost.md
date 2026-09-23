# FX control update cost

Reverb size changes now generate and assign a new impulse response only when
the requested size differs from the last size successfully assigned. Mix-only
updates keep using the current convolver buffer. Delay tempo sync uses the
latest accepted delay parameters, including a user-edited `timeSteps` value.

## Deterministic reverb workload

The before/after comparison ran the same seeded `renderImpulseResponse` path
at 44.1 kHz with 24 repeated size cycles. Each cycle changed size from 0.2 to
0.8, made three mix-only updates at 0.8, and restored size 0.2. This is 120
`setParams` calls per pass. The baseline reproduces the former comparison
against constructor size; the fixed side calls `createReverbDevice` and uses
its production setter. The fake Web Audio context counts `AudioBuffer`
allocations and convolver buffer assignments. Both versions ran three warmup
passes followed by nine timed passes; times below are median synchronous
control-update times, not render or sound output latency.

| Version  | Buffer allocations per pass | Buffer assignments per pass | Median control-update time |
| -------- | --------------------------: | --------------------------: | -------------------------: |
| Baseline |                          97 |                          97 | 229.66 ms (227.73–233.90 ms) |
| Fixed    |                          49 |                          49 |  95.72 ms (94.81–98.52 ms) |

The A-B-A edit sequence requires the initial buffer plus one buffer for each
actual size transition, so mix changes add no buffers and restoring A creates
the needed replacement buffer. These synthetic timings cover seeded IR
generation and fake buffer copies on the measured runtime. They do not predict
render-thread scheduling, device output latency, or an end-to-end user-perceived
latency improvement.

## Regression coverage

- `tests/fx.test.ts` counts allocations and buffer assignments across repeated
  size/mix edits and a return to the original size, and checks that unrelated
  device types are ignored.
- `tests/fx.test.ts` edits delay `timeSteps`, changes tempo, then checks the
  synchronized interval still uses the edited value.
- `tests/browser/fx-graph.test.ts` verifies the final reverb A-B-A render
  matches a fresh render at the restored settings, and renders the edited
  delay interval through Chromium's `OfflineAudioContext` graph.
