# Performance budgets — Bitbounce

Committed budgets and how each is enforced (owner tasks TH-1 v0 + TH-4
iteration 2; sources: plan D8/RES-7 user-approved acceptance formalization,
town-hall hero claims, v0 acceptance criterion 7, plan TH-4). Latency and
frame budgets are the product's feel — these are contracts, not aspirations.

## 1. Audio timing — "notes audible within ±2 ms of musical time"

The user-facing guarantee is formalized (user-approved 2026-09-02) as three
enforcement layers, because real-time audio can never be asserted against a
wall clock:

| Layer             | Budget                                                                                                 | Where enforced                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Unit (exact)   | scheduled `when` equals `timeAtStep(step)` exactly                                                     | node Vitest (`tests/*.test.ts`): time math, scheduler with fake clock, per-step delivery                                                                |
| 2. Offline render | onset sample within ONE render quantum (128 samples ≈ 2.9 ms @ 44.1 kHz) of `timeAtStep(step) × 44100` | browser Vitest (`tests/browser/scheduler-budget.test.ts`): real worklet via `addModule` on OfflineAudioContext, onsets found by sample-energy detection |
| 3. E2E smoke      | ≥90% of onsets within ±10 ms of the audio-clock prediction                                             | Playwright e2e (lands with HW-4)                                                                                                                        |

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

### 2a. Quadrant layout 60 fps law (TH-4, iteration 2 — LY-1's stage)

The v0 law extended to the 2×2 quadrant stage at the committed 1440×900
viewport:

- **CI floor: ≥95% of frame intervals < 33.4 ms** with ALL FOUR lanes
  playing in quadrant mode, the three VIEW-ONLY quadrants rendering dense
  4-BAR patterns (Hulk's mini-lane extreme — long patterns scroll inside
  quadrants, never the page), live playheads in all four quadrants (each
  quadrant's playhead must keep moving — the view-only grids render, not
  rot), ≥16 SUSTAINED voices sounding (chord triads stack 3 voices per
  note — `compileLaneEvents`), and an FX device on every lane (drums gets
  one through the real FX console in the test; the demo ships the other
  three).
- **Playhead liveness per quadrant: ≥2 distinct transforms/second each**
  (the HW-4 load-robust count, applied per quadrant — 60 fps hardware gives
  ~60/s).
- Enforced in `tests/browser/frame-budget.test.ts` ("TH-4 (a) quadrant
  frame budget") against the REAL built bundle in a 1440×900 iframe: the
  test builds the dense state through the real UI (rail `+4B` + append,
  drag-created long notes, drum hits, FX add, demo chain slots stripped so
  the dense pattern is the whole arrangement), plays, and measures 4 s of
  pure rendering (no editing during the window).
- Local measured (M1 MacBook, headless Chromium 151): **242 frames / 4 s
  (≈60 fps), 0 frames ≥ 33.4 ms, max 20.6 ms, p95 18.7 ms, median
  16.6 ms**; playhead moved on 242/242 frames in ALL FOUR quadrants; 17
  sustained voices at the sampled step.
- Teeth (red/green, TH-4 evidence): a literal layout-thrash loop injected
  into the renderer's rAF (write+read per cell per frame) collapses to
  18 frames / 4 s with median 251 ms and FAILS the ratio; swapping the
  playhead's compositor transform for a layout-inducing write fails the
  per-quadrant playhead-liveness assertion (the D9 transform law is pinned
  by measurement, not just review).

### 2b. Drag pointermove budgets (TH-4, iteration 2 — IN-2/IN-3 paths)

- **A pointermove storm during playback keeps the frame budget**: ≥95% of
  frames < 33.4 ms across drag-create-preview, edge-resize, drums-paint,
  and rail cue-sweep gestures (~240 synthetic moves/s — 4 per frame, the
  conservative UN-coalesced worst case; real browsers coalesce pointermove
  to rAF, which the app must not need).
- **Every dispatched pointermove blocks the event loop < 50 ms** (long-task
  guard, v0 toggle parity) and the **median dispatch < 8 ms** (measured
  ≈0.2 ms — the median keeps per-move work honest, not just the worst).
- **No layout thrash = commit-on-release law**: while the pointer moves,
  the ONLY legal DOM mutations are renderer-local previews
  (`data-preview`/`data-cue-preview` attrs, the dashed preview bar, the
  resize width) plus the always-running non-gesture loops (playhead
  transform, trigger-glow classes, the booth's direct-DOM readout, the
  debounced save indicator firing from earlier legitimate release
  commits). A store write mid-gesture (aria-selected/`data-on` cell flips,
  a rail rebuild, a reactive re-render) FAILS the gate — asserted with a
  MutationObserver over the whole app document during every move window.
- Commits still land on release (the same gate asserts the post-release
  effects: the note exists, `LENGTH n ST` announced, painted hits on,
  pending switch visible) — zero-writes mid-gesture, one write on release.
- Enforced in `tests/browser/frame-budget.test.ts` ("TH-4 (b) drag
  pointermove budgets").
- Local measured (M1): 364 storm frames, **0 over 33.4 ms**, 1456 moves,
  worst dispatch 1.70 ms, median 0.20 ms, zero non-preview mutations.
- Teeth (red/green): a store write injected per pointermove fails the gate
  (the gesture law itself plus the mutation filter).

## 3. Bundle size — ≤ 300 KB gz initial

- Enforced from TH-2 onward as a CI gate on the build artifact:
  `npm run check:bundle` (scripts/check-bundle.mjs) runs after `npm run
build` in CI, measures initial-load JS (entry chunk + every chunk it
  EAGERLY statically imports, gz -9) plus all woff2 bytes, prints a
  per-category breakdown (js / fonts / worklet), and exits non-zero over
  either budget (JS ≤ 300 KB gz, fonts ≤ 50 KB).
- TH-2 code-splitting: the export pipelines load ON DEMAND via dynamic
  import from the Projects popover — the initial bundle never pays for the
  MIDI encoder (midi-file) or the offline render/WAV encoder. The worklet
  asset stays eagerly referenced by URL in the main chunk (audio needs it
  at first play, not lazily); it is fetched on play, never module-imported.
- Current (TH-2 build evidence, gz -9): initial JS **41.90 KB** (single
  entry chunk, was 48.91 KB vite-gzip pre-split); lazy: exportMidi 4.56 KB,
  exportWav 2.23 KB, worklet 4.63 KB (fetched at first play); CSS 11.91 KB
  gz; fonts 37.02 KB raw woff2 on disk (Silkscreen 400/700 are inlined into
  the CSS as data URLs under Vite's 4 KB limit).
- res-9 preload discipline: index.html preloads ONLY the critical
  font-display:swap faces that ship as separate files (Departure Mono,
  IBM Plex Mono 400). The font-display:optional faces (VT323, Press Start
  2P) and Plex 500 are never preloaded; the stage does not depend on them.

## 4. Fonts — ≤ 50 KB total

- Pixel faces (D9: Silkscreen / Departure Mono / VT323 / Press Start 2P /
  IBM Plex Mono fallback) must stay under 50 KB total; checked at DES
  milestones and folded into the TH-2 size gate.

## 5. Voice load

- Worst case committed: 16 simultaneous voices (4 lanes × stacked chords +
  full drum kit) + metronome through the real graph, offline.
- Must render without error, with zero NaN/Infinity samples and a sane
  peak (no runaway). Enforced in `tests/browser/voice-load.test.ts`.

## 6. Background tab (TH-3 behavior contract)

What **continues** when the tab is hidden:

- Audio playback, in full. The scheduler's refill timer is throttled by the
  browser to ≥ 1 Hz in hidden tabs, but all timing derives from
  `ctx.currentTime` (the hardware sample clock, unaffected by throttling),
  and the **1.5 s event horizon** keeps the worklet queue fed at even a
  1 Hz refill cadence. Proven in `tests/background-tab.test.ts`: a full
  virtual minute at a simulated 1 Hz clamp schedules every 16th-note tick
  exactly once, zero misses.
- The event queue refill itself, idempotently. Waking from throttle can
  coalesce/delay timer callbacks; the scheduler's `generatedUntil` cursor
  makes refill a pure forward latch — a burst of refills at an unchanged
  audio clock never double-schedules events already in the worklet queue.

What **pauses**: every `requestAnimationFrame` loop (the browser suspends
rAF in hidden tabs). That is the Booth playhead readout and the grid
renderer's sweep/glow loop — presentation only, never scheduling.

What the **user sees on refocus**: the playhead unparks and resyncs in one
frame. Position reads (`Transport.getLoopTime` / `getPosition`) are pure
functions of `ctx.currentTime` — no rAF timestamp is ever accumulated — so
the first visible frame recomputes from the live audio clock: no time jump,
no drift, no replayed animation. Unit-proven in `tests/background-tab.test.ts`
(resync-from-clock); the real-context contract (audio clock continuity
across a synthetic `visibilitychange` window, exact tick times, refocus
resync) is asserted in `tests/browser/background-tab.test.ts`.

Honest CI limitation: headless Chromium does not actually clamp timers or
suspend rAF on a synthetic visibility change, so real park/throttle behavior
is verified by the human session protocol (R12), not in CI.

## 7. Lazy-content budget (TH-4, iteration 2 — the RES-10 pin for PS-2/PS-4)

Same-origin sample content does not exist yet (PS-2 assets / PS-4 sample
voices land later); the GATE is committed NOW so the lazy-load law cannot
regress when content lands:

- **First paint must complete < 3 s under a simulated 4 s asset stall.**
- **PLAY → transport running < 3 s under the same stall.**
- **Zero audio-asset fetches on the boot→play path.** Content may only load
  on explicit preset selection (RES-10: lazy same-origin decode on preset
  selection with neighbor prefetch) — never eagerly, and never blocking
  paint or PLAY.
- Simulation: the gate patches the app iframe's `fetch` (every
  `/assets/content*` / `.ogg`/`.oga`/`.mp3`/`.wav`/`.flac` request stalls
  4 s, all URLs recorded) and `AudioContext.decodeAudioData` (every decode
  stalls 4 s) BEFORE the app module loads. A boot or play path that awaits
  either stalls past the budget and FAILS; an eager content fetch FAILS the
  zero-fetch assertion.
- Enforced in `tests/browser/frame-budget.test.ts` ("TH-4 (d) lazy-content
  budget"). Offline renders are NOT in scope here — they preload/decode
  everything before `startRendering()` by the day-one parity law.
- Local measured (M1, no content exists yet): first paint 51 ms, PLAY
  53 ms, 0 audio-asset fetches, 0 decodes.
- Teeth (red/green): an `await fetch("/assets/content/red-proof.ogg")`
  injected before the app's first render pushes first paint to 4218 ms and
  FAILS the paint budget (and the eager-fetch assertion).

## 8. Help mode OFF = baseline (TH-4 pin for HP-1's zero-cost clause)

HP-1's help mode (pending as of TH-4) must cost NOTHING while off:

- Every TH-4 frame-budget measurement (§2a, §2b) runs with help mode OFF —
  the default state, asserted in-test (no help surface mounted) — and the
  committed numbers above ARE the mode-off baseline.
- **When HP-1 lands, these same gates must stay green with the mode off**
  (this is HP-1's DoD: zero listeners, zero rAF loops, zero reactive
  subscriptions while off — a help mode that pays rent at rest fails CI,
  not review).
- The v0 keyboard-shortcuts overlay (KEYS ?) is a SEPARATE surface: closed
  by default, mounts only on demand — already compliant.

## Harness notes (D8/RES-7)

- Browser project: Vitest browser mode, playwright provider, Chromium pinned
  by the `playwright` version in `package.json`/lockfile; headless when CI;
  `workers: 1`; Chromium launched with
  `--autoplay-policy=no-user-gesture-required`.
- Offline renders preload the full event list before `startRendering()`
  (day-one contract) plus a settle delay for worklet message delivery.
- Node/jsdom can never assert audio (jsdom Web Audio open since 2020, #2900).
- TH-4: every frame-budget test boots the REAL built bundle in a fresh
  same-origin iframe (IDB wiped per boot — deterministic first-run demo;
  teardown closes the iframe's DB connections and wipes again). Frame
  intervals are rAF deltas measured inside the page; gesture storms
  dispatch 4 synthetic PointerEvents per rAF frame and time each dispatch
  synchronously (handler + any forced layout). Tolerances follow the v0
  formalization: the 33.4 ms ratio bound is HARD; liveness counts are
  load-robust (≥2/s per quadrant).
