# Performance budgets — Bitbounce

Committed budgets and how each is enforced (owner task TH-1; sources: plan
D8/RES-7 user-approved acceptance formalization, town-hall hero claims).
Latency and frame budgets are the product's feel — these are contracts, not
aspirations.

## 1. Audio timing — "notes audible within ±2 ms of musical time"

The user-facing guarantee is formalized (user-approved 2026-09-02) as three
enforcement layers, because real-time audio can never be asserted against a
wall clock:

| Layer | Budget | Where enforced |
|---|---|---|
| 1. Unit (exact) | scheduled `when` equals `timeAtStep(step)` exactly | node Vitest (`tests/*.test.ts`): time math, scheduler with fake clock, per-step delivery |
| 2. Offline render | onset sample within ONE render quantum (128 samples ≈ 2.9 ms @ 44.1 kHz) of `timeAtStep(step) × 44100` | browser Vitest (`tests/browser/scheduler-budget.test.ts`): real worklet via `addModule` on OfflineAudioContext, onsets found by sample-energy detection |
| 3. E2E smoke | ≥90% of onsets within ±10 ms of the audio-clock prediction | Playwright e2e (lands with HW-4) |

Layer 2 also discharges the IM-3 caveat: it verifies the REAL
`AudioWorkletProcessor.process()` loop, not the node-side DSP twin.

## 2. Frame rate

- **Target: 60 fps** with all four lanes playing + editing (design D9/playhead
  is rAF + transform, never framework state).
- **CI floor (committed TH-1): ≥95% of frame intervals < 33.4 ms (~30 fps)**
  while the built app plays and a scripted burst of 200 cell toggles runs.
  Rationale (recorded choice): CI shared runners make a hard 60 fps gate
  flaky; the 30 fps floor catches regressions (layout thrash, reactive
  playhead, sync recompiles) deterministically. A true 60 fps gate moves to
  e2e on controlled hardware later if needed.
- **Long-task guard: every toggle batch blocks the event loop < 50 ms.**
- Enforced in `tests/browser/frame-budget.test.ts` against the REAL built
  bundle (globalSetup runs `vite build`; the test imports the built module
  and measures the mounted stage).
- Local measured baseline (M1 MacBook, headless Chromium 151): 181 frames /
  3 s, median 16.6 ms, max ≈ 21.9 ms, 0 frames ≥ 33.4 ms, worst toggle
  block ≤ 4.0 ms.

## 3. Bundle size — ≤ 300 KB gz initial

- Enforced from TH-2 onward as a CI gate on the build artifact.
- Current: 18.79 KB JS + 9.25 KB CSS gz (TH-1 build evidence).

## 4. Fonts — ≤ 50 KB total

- Pixel faces (D9: Silkscreen / Departure Mono / VT323 / Press Start 2P /
  IBM Plex Mono fallback) must stay under 50 KB total; checked at DES
  milestones and folded into the TH-2 size gate.

## 5. Voice load

- Worst case committed: 16 simultaneous voices (4 lanes × stacked chords +
  full drum kit) + metronome through the real graph, offline.
- Must render without error, with zero NaN/Infinity samples and a sane
  peak (no runaway). Enforced in `tests/browser/voice-load.test.ts`.

## Harness notes (D8/RES-7)

- Browser project: Vitest browser mode, playwright provider, Chromium pinned
  by the `playwright` version in `package.json`/lockfile; headless when CI;
  `workers: 1`; Chromium launched with
  `--autoplay-policy=no-user-gesture-required`.
- Offline renders preload the full event list before `startRendering()`
  (day-one contract) plus a settle delay for worklet message delivery.
- Node/jsdom can never assert audio (jsdom Web Audio open since 2020, #2900).
