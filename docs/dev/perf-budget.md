# Performance budgets — Bitbounce

Committed budgets and how each is enforced (owner tasks TH-1 v0 + TH-4
iteration 2; sources: plan D8/RES-7 user-approved acceptance formalization,
town-hall hero claims, v0 acceptance criterion 7, plan TH-4). Latency and
frame budgets are the product's feel — these are contracts, not aspirations.
Every measured value below was re-derived from a fresh build + gate run on
2026-09-03 (refinement-5 audit), and each number states its method. No
measured value exceeds its budget as of that run. The §9 mobile numbers are
from the 2026-09-04 MB-5 gate run (their own method + date stated
in-section).

## 1. Audio timing — "notes audible within ±2 ms of musical time"

The user-facing guarantee is formalized (user-approved 2026-09-02) as three
enforcement layers, because real-time audio can never be asserted against a
wall clock:

| Layer             | Budget                                                                                                 | Where enforced                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Unit (exact)   | scheduled `when` equals `timeAtStep(step)` exactly                                                     | node Vitest (`tests/*.test.ts`): time math, scheduler with fake clock, per-step delivery                                                                                                                                                                                                                                             |
| 2. Offline render | onset sample within ONE render quantum (128 samples ≈ 2.9 ms @ 44.1 kHz) of `timeAtStep(step) × 44100` | browser Vitest (`tests/browser/scheduler-budget.test.ts`): real worklet via `addModule` on OfflineAudioContext, onsets found by sample-energy detection                                                                                                                                                                              |
| 3. E2E smoke      | bar-grid onsets present at the sounding demo's bar starts (40 ms RMS windows)                          | `tests/browser/e2e-happy-path.test.ts` stage 2 (landed HW-4): renders the sounding demo offline through the real worklet and checks onsets. Honest note (acceptance.md AC #3): the ≥90%-within-±10 ms live-capture formulation is documented not CI-provable (RES-2) — layers 1–2 are the rigorous evidence; the human ear rides R12 |

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
- Local measured (re-measured 2026-09-03, refinement-5; M1-class macOS
  arm64, headless Chromium 151.0.7922.34 via the playwright 1.62.1 pin;
  method: the `[TH-1 frame budget]` console line of the gate itself, rAF
  deltas over the gate's 4 s window while playing + 200 toggles): 242
  frames / 4 s, median 16.6 ms, max 31.9 ms (one frame; 0 frames
  ≥ 33.4 ms), worst toggle block 3.30 ms, playhead moved on 235/242 frames.
  History: the TH-1-era baseline was 181 frames / 3 s, median 16.6 ms, max
  ≈ 21.9 ms, worst toggle ≤ 4.0 ms — the window became 4 s at TH-4.

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
- Local measured (re-measured 2026-09-03, refinement-5; same environment and
  method family as §2 — the `[TH-4 quadrant budget]` console line, 4 s pure
  rendering window): **241 frames / 4 s (≈60 fps), 0 frames ≥ 33.4 ms, max
  20.1 ms, p95 18.7 ms, median 16.6 ms**; playhead moved on 241/241 frames
  in ALL FOUR quadrants; 17 sustained voices at the sampled step.
  Re-measured 2026-09-04 (MB-6 — the setup-integrity fix below landed):
  **241 frames / 4 s, 0 ≥ 33.4 ms, max 19.6 ms, p95 18.7 ms, median
  16.6 ms**, playheads 241/241 ×4, 17 sustained voices — statistically
  unchanged: the dense drums' painted hits are composited cells, not
  layout.
- **MB-6 setup-integrity correction (this §2a's own gate, closed
  2026-09-04):** the original setup's drums `clickCells` at steps ≥ 16
  silently failed (see §9's gate-integrity note) — the measured runs above
  were made on a drums quadrant ~4× sparser than intended (steps 0/8 only).
  The fix (pool-strip before the clicks, MB-5's PAT-menu approach) makes
  every one of the 48 intended hits land and the gate now ASSERTS the
  density self-checkingly (`48/48 painted hits`); the frame-law numbers
  were re-measured after the fix and stand as documented — the law and its
  threshold are unchanged, and the gate is now measuring what it always
  claimed.
- **M1 checkpoint (measured 2026-09-04, hardware-console M1 — the fully
  skinned state: Machined Console tokens v2, chassis bezel/deck, brushed
  booth faceplate + breathing + beat-LED pop + nudge, anodized quadrant
  panels + scan-light playhead + cell-bloom layer + press travel, PLUS the
  checkpoint's own AC-9 material-amplitude pass: deeper `--elev-2/3`
  casts, the new `--elev-key` cast under every painted key, brush grain
  0.02→0.045, edge-hi 0.08→0.16, deeper `--led-window` recess, stronger
  bezel vignette/walls; same environment + method — the gate's own console
  line, 4 s pure-render window)**: `[TH-4 quadrant budget] frames=241
  over33.4ms=0 max=21.0ms p95=18.6ms median=16.6ms` — **median
  byte-identical to the preserved standard, 0/241 frames over, max/p95
  within run-to-run noise of the 19.6/18.7 pre-run baseline**. The static
  paint amplitude cost nothing measurable: the deeper casts and key
  shadows are paint-once layers on panel-sized surfaces, and the per-cell
  law (never per-cell) held through the pass. `[TH-1] frames=241, 0 over,
  max 21.3, median 16.6, worst toggle 3.50ms; [TH-4 storm totals] 364
  frames, 0 over, worstMove 1.60ms, median 0.20ms, zero non-preview
  mutations; [TH-4 lazy] paint 55ms, PLAY 51ms`.
- Teeth (red/green, TH-4 evidence): a literal layout-thrash loop injected
  into the renderer's rAF (write+read per cell per frame) collapses to
  18 frames / 4 s with median 251 ms and FAILS the ratio; swapping the
  playhead's compositor transform for a layout-inducing write fails the
  per-quadrant playhead-liveness assertion (the D9 transform law is pinned
  by measurement, not just review).
- **T5 (measured 2026-09-04, v2 lane-rim pulses ACTIVE — the R1 hot spot
  the M2 gate measures; one `.is-sounding` class toggle per beat per lane
  on each `.lane-floor`, ~15 writes/s total at the demo's 112 bpm, from
  the renderer's EXISTING crossed-steps loop via the new optional
  `onStepPulse` host callback — zero new rAF loops; same environment +
  method)**: `[TH-4 quadrant budget] frames=238 over33.4ms=3 max=48.5ms
  p95=24.9ms median=16.6ms` (full-suite battery run — 235/238 = 98.7%
  ≥ the 95% floor; a first full-suite run the same hour measured 240
  frames / 1 over / max 34.8 / p95 23.0 / median 16.6). **Median
  byte-identical to the M1 preserved standard (16.6)**; the over-count
  moved with runner load, not the pulse (concurrent sessions on the box;
  an isolated TH-1 re-run in the same state: 239 frames, 1 over, max
  33.6, median 16.6, worst toggle 7.50 ms). `[TH-4 storm totals] 319
  frames, 3 over (runner load; 0 over in the first run), worstMove
  3.40ms, median 0.30ms, zero non-preview mutations` — the beat toggle
  rides TH-4(b)'s named legal set (§2b) and adds no gesture-path cost.
  `[MB-5 phone budget] 233 frames, 1 over, max 27.9, p95 20.2, median
  16.5; [MB-5 storm totals @390] 339 frames, 1 over, worstMove 8.60ms`
  (0-over in the first run). `[TH-4 lazy] paint 58ms, PLAY 71ms`.
- **T6 (measured 2026-09-04, v2 rail sounding tiles + lane-header LED
  accents live — CSS-dominant; the rail follow's `data-state`/
  `data-sounding` attribute writes stay change-driven (pattern boundaries
  only) and gesture-frozen (the follow's TH-4(b) heldPointers guard covers
  both attributes); same environment + method)**: `[TH-4 quadrant budget]
  frames=233 over33.4ms=7 max=53.5ms p95=24.9ms median=16.6ms` — 226/233 =
  96.99% ≥ the 95% floor, **median byte-identical to the preserved
  standard (16.6)**; over-counts tracked concurrent runner load (three
  green full-suite runs same hour). `[TH-4 storm totals] 364 frames,
  0 over, worstMove 3.00ms, medianMove 0.30ms, zero non-preview
  mutations` — the LED accent rides the SAME `.is-sounding` class (CSS
  descendant opacity transition, zero new JS writes). `[MB-5 phone
  budget] 243 frames, 0 over, max 32.8, p95 20.1, median 16.6`. Rail
  density pins re-measured green: PAT cluster 38px/lane (≤88), 15-tile
  chains single-line at BOTH viewports, one-page exact 1440×900 +
  1280×800 (paint-only reskin).
- **T7 (measured 2026-09-04, v2 FX console module bank live — CSS-dominant
  + ONE additive inline custom property per module; the `--fx-meter` style
  write fires only on FX param commits with the console OPEN (storms run
  closed), so the TH-4(b) named legal set needed NO addition; same
  environment + method)**: `[TH-4 quadrant budget] frames=241 over33.4ms=0
  max=30.7ms p95=22.1ms median=16.7ms` — 0/241 over, median within the
  16.6–16.8 run-to-run band of the preserved standard. `[TH-1] 241
  frames, 1 over, max 34.5, median 16.6, worst toggle 5.60ms`. `[TH-4
  storm totals] 364 frames, 0 over, worstMove 3.70ms, medianMove 0.30ms,
  zero non-preview mutations`. `[MB-5 phone budget] 243 frames, 0 over,
  max 19.9, p95 19.2, median 16.6; MB-5 storms @390: 364 frames, 0 over,
  worstMove 2.40ms`. The legacy animated-box-shadow `fx-mod-flash`
  keyframe is migrated to law v2 — the built CSS now carries
  `@keyframes fx-mod-flash{0%{opacity:1}to{opacity:0}}` over a pre-painted
  `::before` (no animated box-shadow/filter anywhere in the sheet).
- **T7 backdrop-filter gate (route.md's one sanctioned candidate, measured
  with the console OPEN over live playback — the in-repo TH-4(a)/MB-5
  states run with the console closed and could never see the property;
  Playwright rAF-interval protocol, 4 s windows, fresh context per run,
  back-to-back OFF/ON pairs, both viewports)**: OFF `1440×900` 241
  frames / 0 over / max 19.0–21.3 / median 16.6–16.7; ON (blur 6px +
  78% panel) 241 / 0 over / max 19.3–22.0 / median 16.6–16.7; phone
  390×844 OFF 241 / 0 / 16.7 vs ON 240–241 / 0 over / 16.6–16.7. **Gates
  green, zero regression — adoption DECLINED anyway on the world register**
  (probe vision verdict: the frosted glass reads glassmorphism/software,
  not machined chassis; the committed material language is opaque panels).
  The property is ABSENT from the codebase; the decision + numbers live in
  production-log T7 and the fx-strip.css chassis comment.
- **M2 checkpoint — the MERGED v2 hot spot (measured 2026-09-04, T8/M2;
  all three v2 reactivity layers LIVE simultaneously for the first time in
  one gate run: lane-rim `.is-sounding` beat pulses on every `.lane-floor`,
  rail sounding tiles with the doubled lane-hue hairline + underglow, and
  the lane-name LED accent riding the same class — plus the FX module bank
  paint; same environment + method — the gate's own console lines, solo
  re-run of `tests/browser/frame-budget.test.ts` on the fresh build after
  a first-run-green full battery)**: `[TH-4 quadrant budget] frames=240
  over33.4ms=0 max=31.9ms p95=25.2ms median=16.6ms
  playheadMoves={"drums":240,"bass":240,"chords":240,"lead":240}
  sustainedVoices=17` — **0/240 frames over (100% ≥ the 95% floor),
  median byte-identical to the preserved 16.6 ms standard**; max/p95 sit
  within the run-to-run band the T5–T7 entries recorded (the box ran the
  full 48-file battery minutes earlier). `[TH-1] frames=241 over=1
  max=38.1ms median=16.6ms worstToggleBlock=4.80ms` (one frame, ≤95%-law
  green). `[TH-4 storm totals] frames=364 over33.4ms=0 moves=1456
  worstMove=3.00ms medianMove=0.30ms` — zero illegal mutations with the
  beat toggle in the named legal set. `[MB-5 phone budget] frames=243
  over=0 max=21.3ms p95=19.2ms median=16.6ms worstEditBlock=11.50ms`;
  `[MB-5 storm totals @390] 364 frames, 0 over, worstMove=2.60ms,
  median 0.20ms`; `[MB-5 lazy decode @390] 181 frames, 0 over, max 20.9,
  median 16.6, worstClickBlock=1.30ms`; `[TH-4 lazy] paintMs=71 playMs=305`
  (budgets 3000/3000 ms). **R1 verdict: the merged reactive state costs
  nothing measurable — the pulse is one compositor class toggle per beat,
  the tiles are change-driven attribute writes, the LED accent is pure
  CSS.**

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
- **T5 named-legal-set addition (2026-09-04, sanctioned by plan T5 — the
  one sanctioned edit to this gate's filter)**: the lane-rim sounding
  pulse joins the always-running legal set — class mutations on
  `.lane-floor` (`.is-sounding`, one add per beat per lane + its ~120 ms
  decay removal, fired from the renderer's existing crossed-steps loop
  through the `onStepPulse` host callback; route.md playback-reactivity
  #5). It is the ONLY class write on `.lane-floor` anywhere in src (grep
  -verified), so naming the element in `allowedMutation` admits exactly
  that toggle and nothing broader; no selector renames, no other filter
  change.
- Commits still land on release (the same gate asserts the post-release
  effects: the note exists, `LENGTH n ST` announced, painted hits on,
  pending switch visible) — zero-writes mid-gesture, one write on release.
- Enforced in `tests/browser/frame-budget.test.ts` ("TH-4 (b) drag
  pointermove budgets").
- Local measured (re-measured 2026-09-03, refinement-5; method: the
  `[TH-4 storm totals]` console line — four 1.5 s gesture windows, 4
  un-coalesced moves per frame): 364 storm frames, **0 over 33.4 ms**,
  1456 moves, worst dispatch 1.60 ms (per-gesture worsts 0.80–1.60 ms),
  median 0.20 ms, zero non-preview mutations.
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
- Current (re-measured 2026-09-03, refinement-5, on the refinement-4 build;
  method: `npm run build` then `npm run check:bundle`, which gzips the dist
  artifact at level 9 via node zlib — these are the CI-contract numbers):
  initial JS **64.31 KB gz** (still a single eager entry chunk), lazy:
  content 2.67 KB (PS-2's separate `content` build entry, loads on preset
  selection), exportMidi 4.65 KB, exportWav 2.45 KB, worklet 5.59 KB
  (fetched at first play); CSS 13.09 KB gz; fonts 37.02 KB raw woff2 on
  disk in 5 files (Silkscreen 400/700 are inlined into the CSS as data
  URLs under Vite's 4 KB limit). History: 41.90 KB at TH-2 (was 48.91 KB
  vite-gzip pre-split; lazy then exportMidi 4.56 / exportWav 2.23 / worklet
  4.63; CSS 11.91 KB gz); growth since = iteration-2 eager-path features
  (quadrant layout, help registry, preset/sample code) + refinement fixes,
  tracked at every task in production-log.md. 64.31 ≤ 300 KB — 21% of
  budget. Later same-day drift (measured 2026-09-03, refinement-6 — the
  rail pattern-tools popover, same method): initial JS 64.65 KB gz, CSS
  13.13 KB gz (+0.34 / +0.04; 22% of budget). Later still (measured
  2026-09-03, refinement-7 — the rail sounding-follow ledger + read seam
  and the flag/booth polish, same method): initial JS 65.01 KB gz, CSS
  13.16 KB gz (+0.36 / +0.03; 22% of budget). Vite's own build report
  prints slightly different gzip figures
  (e.g. 66.41 KB initial) because it uses its default gzip settings, not
  -9; the gate's numbers above are the contract.
- **M1 checkpoint record (measured 2026-09-04, hardware-console M1 —
  tokens v2 + chassis + booth + grid surface + the checkpoint's AC-9
  material-amplitude pass; same method: `npm run build` +
  `npm run check:bundle`)**: initial JS **66.75 KB gz** (the +1.74 over
  the 65.01 refinement-7 baseline is T1's single App.tsx chassis-import +
  hash churn — byte-identical through T2/T3/T4: no JS was touched after
  T1); CSS **15.51 KB gz** (+2.35 over the 13.16 baseline: tokens.css v2
  law text + the new chassis.css sheet + the booth/grid/lane-header
  restyles — 22% of the 300 KB JS budget, CSS is info-only, ungated);
  fonts **37.02 / 50 KB unchanged** (zero new font bytes through M1, the
  restyle-first typography law held). The M1 CSS delta per task:
  T1 +1.49 → 14.65, T2 +0.46 → 15.11, T3 +0.37 → 15.48, T4 amplitude
  pass +0.03 → 15.51 (script numbers).
- **T5 (measured 2026-09-04, v2 lane-rim pulses — the first JS movement
  off the 66.75 M1 pin; same method)**: initial JS **66.88 KB gz (+0.13)**
  — the optional `onStepPulse` host callback in the grid renderer + the
  LaneGrid consumer wiring (beat gate, reduced-motion hold, timer);
  22% of the 300 KB budget. CSS **15.57 KB gz (+0.06)**: the
  `.lane-floor::after` pre-painted rim layer + `lane-rim-pulse` keyframes
  + reduced-motion twin (chassis.css) and the `--rim-pulse-decay` token.
  Fonts **37.02 / 50 KB unchanged**.
- **T6 (measured 2026-09-04, v2 rail emission grammar)**: initial JS
  **66.91 KB gz (+0.03)** — the additive `data-sounding` attribute + the
  `isSounding` helper in PatternRail (the tileState sounding+selected
  collapse fix; rides the EXISTING follow signal, no new subscription).
  CSS **15.74 KB gz (+0.17)**: the pattern-rail metal-chassis reskin +
  the EMISSION-RAIL tile state grammar (pattern-rail.css), the
  lane-header LED accent + twin (lane-header.css), and the rail-tool
  press-travel selector appends (app.css, the sheet's own REUSE law).
  Fonts **37.02 / 50 KB unchanged**.
- **T7 (measured 2026-09-04, v2 FX console module bank)**: initial JS
  **67.03 KB gz (+0.12)** — the `moduleMeter` document-state helper + the
  `--fx-meter` inline custom property in FxStrip (one cutoffToSlider
  import added; no store/engine/document code touched). CSS **16.13 KB
  gz (+0.39)**: the fx-strip.css module-chassis reskin (overlay chassis,
  raised modules + screws, segmented rest-state meters, recessed readout
  windows, the machined-key select/steppers, the law-v2 flash migration)
  + the press-travel selector appends (app.css REUSE law). Fonts
  **37.02 / 50 KB unchanged** (the select caret is an inline-SVG
  data-URI, ~130 raw bytes inside the CSS — zero asset files).
- **M2 checkpoint record (measured 2026-09-04, T8/M2 — the committed M2
  state = T5+T6+T7 merged; same method: `npm run build` +
  `npm run check:bundle` on the fresh build)**: initial JS **67.03 KB gz**
  (byte-identical to the T7 measurement — no JS touched after T7; 22% of
  the 300 KB budget), CSS **16.14 KB gz** (T7's sheet, the 0.01 KB drift
  vs the worker's 16.13 claim is gz rounding, ungated — total v2 CSS
  growth over M1's 15.51: +0.63 KB), fonts **37.02 / 50 KB unchanged**
  (zero new font or asset files through all of v2 — the restyle-first
  typography law held through M2). M2 cumulative JS delta over M1:
  +0.28 KB (66.75 → 67.03) for the renderer callback + three consumers.
- res-9 preload discipline: index.html preloads ONLY the critical
  font-display:swap faces that ship as separate files (Departure Mono,
  IBM Plex Mono 400). The font-display:optional faces (VT323, Press Start
  2P) and Plex 500 are never preloaded; the stage does not depend on them.

## 4. Fonts — ≤ 50 KB total

- Pixel faces (D9: Silkscreen / Departure Mono / VT323 / Press Start 2P /
  IBM Plex Mono fallback) must stay under 50 KB total; checked at DES
  milestones and folded into the TH-2 size gate.
- Measured (2026-09-03, refinement-5; method: check:bundle's woff2
  accounting over dist/): **37.02 KB in 5 files** (Departure Mono 400,
  IBM Plex Mono 400/500, Press Start 2P 400, VT323 400 on disk; Silkscreen
  400/700 ride inlined in the CSS) — 74% of the 50 KB budget.

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

Sample content LANDED with PS-2 (2026-09-03: 33 CC0 OGG one-shots,
**353,290 bytes = 345.0 KiB (353.3 KB decimal)** — re-measured 2026-09-03,
refinement-5; method: byte-sum over `dist/assets/*.ogg` after `npm run
build`; the shipped set outgrew the ~285 KB planning estimate but sits at
35% of the RES-10 ≤ 1 MB working envelope, pinned by `npm run
check:content` (1 MB working / 2 MB hard). Emitted as hashed
`dist/assets/*.ogg` via the separate `content` build entry — the loader
itself is its own LAZY chunk, **2.67 KB gz** (check:bundle gz -9;
Vite's build report prints 2.73 KB with its default gzip), re-measured
2026-09-03. PS-4's SampleVoiceHost is the consumer. The gate keeps
SIMULATING stalls so the law cannot regress as usage grows:

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
- Local measured (TH-4, no content wired): first paint 51 ms, PLAY 53 ms.
  Re-measured at PS-2 WITH the 33 OGGs physically present in dist/assets:
  first paint 57 ms, PLAY 55 ms (gate run 2026-09-03). Re-measured again
  2026-09-03 (refinement-5, refinement-4 build; method: the `[TH-4 lazy
budget]` console line): first paint **56 ms**, PLAY **54 ms**, 0
  audio-asset fetches, 0 decodes — the loader is not on the boot path.
- Teeth (red/green): an `await fetch("/assets/content/red-proof.ogg")`
  injected before the app's first render pushes first paint to 4218 ms and
  FAILS the paint budget (and the eager-fetch assertion).

## 8. Help mode OFF = baseline (TH-4 pin for HP-1's zero-cost clause)

HP-1's help mode — **landed 2026-09-02, compliant**: the InfoView component
is mounted by App only while the mode is on (a `<Show>`), so mode-off means
zero help DOM, zero listeners, zero rAF loops, zero reactive help
subscriptions:

- Every TH-4 frame-budget measurement (§2a, §2b) runs with help mode OFF —
  the default state, asserted in-test (no help surface mounted: neither the
  KEYS overlay `.help-backdrop` nor the info region `.info-view`) — and the
  committed numbers above ARE the mode-off baseline.
- **With HP-1 landed, these same gates stay green with the mode off** —
  verified on every run since (this is HP-1's DoD: zero listeners, zero
  rAF loops, zero reactive subscriptions while off — a help mode that pays
  rent at rest fails CI, not review).
- The v0 keyboard-shortcuts overlay (KEYS ?) is a SEPARATE surface: closed
  by default, mounts only on demand — already compliant.

## 9. Mobile scale (MB-5, iteration-2 mobile slice — m5 "performance at
mobile scale documented and gated")

The committed phone target is Android Chrome at 390×844 (town-hall mobile
addendum; MB-1's single-lane stage: one lane floor renders, the lane
switcher + condensed rail + booth stay sticky, the page scrolls). The
desktop budgets above are unchanged; this section extends the same laws to
the phone stage in `tests/browser/frame-budget.test.ts` ("MB-5 mobile
frame budget", built app in a 390×844 iframe).

- **(m-a) Phone frame budget**: ≥95% of frame intervals < 33.4 ms while all
  four lanes play dense 4-BAR chains (the audio state is
  viewport-independent) and the phone stage edits + scrolls — two 2 s
  windows: LEAD displayed (the densest phone grid: 14 rows × 64 steps with
  sustained note-runs rendering, cell-toggle edits, VERTICAL page scroll
  under the sticky chrome) and DRUMS displayed with the euclid FILL overlay
  REVEALED (the phone/tablet-only reveal) + HORIZONTAL grid scroll (the
  4-bar law). The densest phone-realistic state: sample-backed sounds on
  (SUB DROP / PURE TONE / PHASER UP / 808 CLASSIC — the PS-4 sample voices
  through the native host), an FX device on every lane, help mode off, and
  ≥16 sustained voices sounding (m5 "voices as budgeted": 7 bass + 2×3
  chords + 4 lead = 17, asserted from the note bars at a sampled step).
  Playhead liveness ≥2 distinct transforms/s per window (the load-robust
  HW-4 count); every edit batch blocks < 50 ms; sticky chrome pinned
  (|top| ≤ 1.5 px) through every scroll, both axes really scrolled
  (asserted).
- **(m-b) Drag storms at phone width**: the four TH-4 (b) gestures —
  drag-create preview, edge resize, drums paint, rail cue sweep — during
  playback at 390×844 keep the TH-4 (b) laws unchanged: ≥95% frames
  < 33.4 ms, every dispatched pointermove < 50 ms, median < 8 ms, and ZERO
  non-preview DOM mutations mid-gesture (the shared mutation filter; the
  storm machinery is the same module-scope code, one law at two viewports).
  The rail sweep aims at tiles visible in the condensed rail's strip.
- **(m-c) Voice/lazy-content at mobile**: selecting a sample-backed sound
  MID-PLAYBACK (the real stepper, one click per frame until the sample
  preset lands) fires the lazy content chunk + same-origin fetch + decode
  OFF the critical path: the frame budget holds through the decode window,
  playback never stops, the worst stepper-click block stays < 50 ms, and
  the decode genuinely fired (counted through a delegating
  `decodeAudioData` prototype patch). Zero audio-asset fetches on the
  boot→play path before the selection (no eager fetch on the mobile path —
  TH-4 (d)'s law re-pinned at phone width). **Voice budget UNCHANGED by
  mobile**: `VOICES_PER_LANE = 8` and `SAMPLE_VOICES_PER_LANE = 8` (32
  total across four lanes) asserted in-gate against the engine constants;
  the audio graph has no viewport branch (src/audio + engineBridge never
  read the stage mode — the phone renders FEWER grids, the voice engine is
  identical).
- Local measured (2026-09-04, MB-5; M1-class macOS arm64, headless Chromium
  151 via the playwright 1.62.1 pin, same method family as §2 — the
  `[MB-5 …]` console lines of the gate itself):
  **(m-a)** 243 frames / 4 s (≈60 fps), **0 frames ≥ 33.4 ms**, max
  21.3 ms, p95 19.1 ms, median 16.6 ms; 243 edits, worst edit block
  11.9 ms; playhead 122/122 and 121/121 per window; 17 sustained voices;
  chrome-top deviation 0.00 px mid-scroll. **(m-b)** 364 storm frames,
  0 over 33.4 ms, 1456 moves, worst dispatch 1.50 ms (per-gesture worsts
  0.6–1.5 ms), median 0.20 ms, zero non-preview mutations.
  **(m-c)** 181 frames / 3 s decode window, 0 over 33.4 ms, max 20.6 ms,
  median 16.6 ms, worst stepper-click block 1.30 ms, 1 fetch + 1 decode
  observed mid-playback, transport never stopped.
- Teeth (red/green, scratch-reverted, each restored green): a layout-thrash
  loop in the renderer's rAF (alternating min-height write + offsetHeight
  read per cell per frame) collapses (m-a) to 75/86 frames ≥ 33.4 ms
  (ratio 0.87 — RED, the exact budget assertion); a non-preview DOM write
  per pointermove redds (m-b) as `attributes@data-thrash on
  div.lane-grid-scroll` (the mutation filter); an eager audio-asset fetch
  at boot redds (m-c) as `audio-asset fetches on the phone boot/play
  path` (the lazy law).
- **M1 checkpoint (measured 2026-09-04, hardware-console M1, same
  environment/method — the gate's own console lines, on the fully skinned
  phone stage incl. the checkpoint's AC-9 material-amplitude pass)**:
  **(m-a)** 243 frames / 4 s, **0 frames ≥ 33.4 ms**, max 20.3 ms,
  p95 18.6 ms, median 16.7 ms; 243 edits, worst edit block 7.10 ms;
  playheads 122/122 and 121/121 per window; 17 sustained voices;
  chrome-top deviation 0.00 px mid-scroll. **(m-b)** 364 storm frames,
  0 over 33.4 ms, 1456 moves, worst dispatch 1.60 ms, median 0.20 ms,
  zero non-preview mutations. **(m-c)** 181 frames / 3 s decode window,
  0 over, max 20.5 ms, median 16.6 ms, worst stepper-click block 2.10 ms,
  1 fetch + 1 decode mid-playback, transport never stopped. MB-3 chrome
  budget byte-identical to the pre-skin record: 390×844 chrome 308.5 px
  (**36.6%**), 360×800 367.5 px (**45.9%**) — the skin consumed zero
  layout px on the phone stage.
- **Honesty caveat (the reduced-expectations stance, by design)**: CI
  Chromium runs on desktop-class hardware EMULATING the 390×844 viewport.
  These gates catch REGRESSIONS at the phone paint/edit load — layout
  thrash, reactive playheads, blocking decodes, mid-gesture store writes —
  they are NOT a device-class verdict for mid-tier Android Chrome (mobile
  SoC big.LITTLE scheduling, thermal throttling, mobile GPU compositing,
  and real touch-event delivery are not simulated). Real-device
  verification stays with the user's R12-style human session, and low-end
  Android perf remains the Strange-register risk item. Thresholds follow
  the TH-4 tolerance approach precisely because of this: the 33.4 ms ratio
  is HARD and CI-stable; liveness counts are load-robust (≥2/s).
- Gate-integrity note found live while building (m-a), recorded for
  follow-up — **RESOLVED in MB-6 (2026-09-04)**: the v0 drums cell toggle
  is POOL-WIDE (read = any pattern of the lane, write = every pattern),
  and a step write past a pattern's own length fails `validateProject`
  (sparse-array holes). With the demo's 1-bar patterns in the pool,
  TH-4 (a)'s `clickCells` at steps ≥ 24 threw validation errors that its
  (data-on-unasserted) setup silently absorbed — its dense drums quadrant
  was sparser than intended (its own assertions still held; the frame
  numbers stood as measured, and were re-measured after the fix — §2a).
  The MB-5 gate stripped the demo patterns from the drums POOL first (the
  PAT menu's pool-remove); MB-6 ported the same setup to TH-4 (a) AND made
  it self-checking (the gate now asserts 48/48 intended painted hits, so
  the setup can never silently degrade again).

## Harness notes (D8/RES-7)

- Browser project: Vitest browser mode, playwright provider, Chromium pinned
  by the `playwright` version in package.json/lockfile (playwright 1.62.1 →
  Chromium 151.0.7922.34 at the 2026-09-03 measurement); headless when CI;
  `workers: 1`; Chromium launched with
  `--autoplay-policy=no-user-gesture-required`; page viewport pinned to the
  1280×800 tested minimum (refinement-4), the frame-budget (a) quadrant gate
  mounts its own 1440×900 iframe, and the MB-5 mobile gate mounts its own
  390×844 iframe (the phone stage keys off the iframe's own viewport).
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
