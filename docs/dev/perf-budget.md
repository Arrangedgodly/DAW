# Performance budgets — Bitbounce

Committed budgets and how each is enforced (owner tasks TH-1 v0 + TH-4
iteration 2; sources: plan D8/RES-7 user-approved acceptance formalization,
town-hall hero claims, v0 acceptance criterion 7, plan TH-4). Latency and
frame budgets are the product's feel — these are contracts, not aspirations.
Every measured value below was re-derived from a fresh build + gate run on
2026-09-03 (refinement-5 audit), and each number states its method. No
measured value exceeds its budget as of that run. The §9 mobile numbers are
from the 2026-09-04 MB-5 gate run (their own method + date stated
in-section). The §10 long-loop numbers are from the 2026-09-04 LP-1 spike
(its own harnesses + method stated in-section), consolidated into the
committed gate family and re-measured by TH-5 on 2026-09-04 (§10d — the
final gate family, its own method + date in-section).

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
- **T9 (measured 2026-09-04, v3 micro-interactions LIVE for the first
  time in one full-suite run: switch throws on MUTE/SOLO toggles,
  detent tick + value settle on every stepper tap, BYP throws — all
  CSS-only one-shots ≤140ms on pseudo-element transform/opacity inside
  unchanged hit boxes; the gate's own console lines from the green full
  battery)**: `[TH-4 quadrant budget] frames=241 over33.4ms=0 max=28.7ms
  p95=23.1ms median=16.8ms sustainedVoices=17` — 0/241 over, median
  inside the 16.6–16.8 band, max/p95 better than the M2 record
  (28.7/23.1 vs 31.9/25.2). `[TH-1] frames=241 over=0 max=22.6ms
  median=16.7ms toggles=100 worstToggleBlock=3.50ms` — the TH-1
  toggle storm exercises MUTE/SOLO WITH the throw animation on every
  toggle: worst block 3.50ms vs M2's 4.80ms and T8's 5.60ms record;
  **the throw adds no measurable toggle cost**. `[TH-4 storm totals]
  frames=364 over=0 moves=1456 worstMove=3.10ms medianMove=0.30ms`;
  `[MB-5 phone budget] frames=239 over=0 max=29.6ms p95=20.7ms
  median=16.7ms edits=239 worstEditBlock=18.30ms`; `[MB-5 storm totals
  @390] 365 frames, 0 over, worstMove=2.90ms`; `[MB-5 lazy decode @390]
  stepperClicks=9 worstClickBlock=1.30ms` — nine stepper taps WITH the
  detent tick+settle firing: worst click block 1.30ms, byte-identical
  to the M2 no-detent record. **Verdict: the v3 micro-interactions are
  free — compositor one-shots off the interaction critical path (zero
  JS-path latency by construction: no timers, no rAF, no observers).**
- **T10 (measured 2026-09-04, v3 chassis furniture + DEPTH-BAND wash LIVE
  for the first time: static screw/vent/plate/legend paint on booth, rail,
  floors and FX modules, the stage wash layer crossfading on density-band
  changes; the gate's own console lines from the second of two green
  full-suite runs)**: `[TH-4 quadrant budget] frames=241 over33.4ms=0
  max=23.1ms p95=20.5ms median=16.7ms sustainedVoices=17` — 0/241 over,
  median 16.7 inside the preserved 16.6–16.8 band, max/p95 BETTER than
  the T9 record (23.1/20.5 vs 28.7/23.1) — the wash layer + furniture
  paint cost nothing on the 128-bar grid path (static backgrounds +
  one composited-opacity pseudo; no will-change added — the cap stays
  playhead + 1 booth ambient layer). `[TH-1] frames=241 over=0
  max=21.6ms median=16.7ms toggles=100 worstToggleBlock=2.70ms`;
  `[TH-4 storm totals] frames=364 over=0 moves=1456 worstMove=2.10ms
  medianMove=0.20ms` — the data-density attribute write only ever fires
  at document-commit time (post-release), never mid-gesture: zero
  mutation-law violations. `[MB-5 phone windows A/B] frames=122+121,
  0 over, chromeTopDev=0.00px both windows` — the phone wash layer is
  content:none (never painted); phone furniture = rail screws + floor
  legend + save-window restyle only. **Wash amplitude record: painted
  peak = 5% ink (the ambient clause ceiling); band steps 0 / 0.40 /
  0.72 / 1.0 of that field; measured gutter pixels empty RGB(21,20,24) →
  dense RGB(24,23,27) (+3/channel at band 3) — inside the ≤5% cap; real
  text worst case ink-on-panel 15.62:1 → 13.81:1 under the full field,
  every pair ≥4.5:1 (a11y numbers in production-log T10).**
- **M3 checkpoint — the FINAL record (measured 2026-09-04, T11/M3; the merged
  v3 state = T9 micro-interactions + T10 furniture/wash over M2; same
  environment + method — solo re-run of `tests/browser/frame-budget.test.ts`
  on the fresh build after a first-run-green full battery, the T8
  protocol)**: `[TH-4 quadrant budget] frames=241 over33.4ms=0 max=22.7ms
  p95=20.5ms median=16.7ms playheadMoves={"drums":241,"bass":241,
  "chords":241,"lead":241} sustainedVoices=17` — **0/241 frames over (100%
  ≥ the 95% floor), median 16.7 inside the preserved 16.6–16.8 band**; the
  run-to-run max/p95 (22.7/20.5) sit between the T9 and T10 records.
  `[TH-1] frames=242 over=0 max=20.0ms median=16.6ms
  worstToggleBlock=2.50ms` — 100 MUTE/SOLO toggles WITH switch throws:
  best toggle-block of the whole run (2.50 vs M2's 4.80). `[TH-4 storm
  totals] frames=364 over=0 moves=1456 worstMove=2.60ms medianMove=0.30ms`
  — zero illegal mid-gesture mutations. `[MB-5 phone budget] frames=242
  over=0 max=21.3ms p95=18.6ms median=16.7ms worstEditBlock=9.30ms`;
  `[MB-5 storm totals @390] 364 frames, 0 over, worstMove=1.70ms,
  medianMove=0.20ms`; `[MB-5 lazy decode @390] 181 frames, 0 over,
  worstClickBlock=2.20ms` (nine detent-firing stepper taps);
  `[TH-4 lazy] paintMs=60 playMs=52`. **Composited-layer count at M3:
  unchanged by law-audit — `will-change` appears exactly where M1 left it
  (playhead + the one booth breathing layer); T9/T10 added none (grep over
  the M3 diff: zero new `will-change` declarations).** R1/R7 verdict: the
  complete v1+v2+v3 surface costs nothing measurable at the hot spot.

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
  13.16 KB gz (+0.36 / +0.03; 22% of budget). Later still (measured
  2026-09-04, VZ-TH-4 — the M4 bundle-delta record for the viz feature,
  same method): initial JS **81.73 KB gz** (27% of budget), CSS 14.39 KB
  gz. The VIZ capability shipped EAGER (VZ-IM-2's recorded decision,
  re-measured and KEPT by VZ-TH-4, §10): the delta since VZ-IM-2's
  67.18 KB record is +14.55 KB gz — the full viz engine (renderer,
  presets/vocabulary, clamps, phases, pipeline) on the eager entry chunk.
  No flip to a lazy chunk: 3.7× headroom against the 300 KB law, VIZ is
  the one-click headline surface (a lazy chunk would put a fetch+parse on
  J1's first open), and the decision's tripwire was budget pressure,
  which is absent. Vite's own build report
  prints slightly different gzip figures
  (e.g. 84.41 KB initial) because it uses its default gzip settings, not
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
- **T9 (measured 2026-09-04, v3 micro-interactions — CSS-driven, exactly
  as the plan predicted "JS should barely move"; same method)**: initial
  JS **67.03 KB gz BYTE-IDENTICAL to M2** (zero JS/component edits in
  T9 — the entire task is CSS on existing state hooks), CSS
  **16.63 KB gz (+0.49 over M2's 16.14)** for the switch anatomy +
  shared detent utility + tokens + twins across four sheets
  (+323 lines), fonts **37.02 / 50 KB unchanged** (no new assets; the
  tick/slot/thumb are all gradient/pseudo paint).
- **T10 (measured 2026-09-04, v3 chassis furniture + density wash; same
  method)**: initial JS **67.14 KB gz (+0.11 over T9's 67.03)** — the
  entire delta is the pure density module (`src/state/ambientDensity.ts`)
  + the StageFloor subscription wiring (one attribute write per band
  change); 22% of the 300 KB budget. CSS **17.44 KB gz (+0.81 over
  T9's 16.63)**: the furniture vocabulary (one shared inline-SVG screw
  data-URI ~450 raw bytes, vent gradient, serial plate, four legends),
  the wash layer + band steps + twin, the status-cluster retirement
  (inlay plate + save readout window) and the projects-popover machined
  reskin. Fonts **37.02 / 50 KB unchanged** — the optional VT323 swap
  was evaluated and **DECLINED** (zero-new-bytes law; no candidate
  beats the current readout read; the phone wrap pin re-opens the
  documented font-race risk — decision of record in production-log
  T10). Total v3 CSS growth over M2: +1.30 KB for T9+T10 together.
- **M3 checkpoint record (measured 2026-09-04, T11/M3 — the final
  acceptance over the merged v3 tree; same method: `npm run build` +
  `npm run check:bundle`)**: initial JS **67.14 KB gz** (claim-exact =
  the T10 measurement, byte-stable; 22% of the 300 KB budget), CSS
  **17.44 KB gz** (claim-exact; total run growth over the pre-run 13.16
  baseline: +4.28 KB for the entire hardware-console reskin), fonts
  **37.02 / 50 KB unchanged through the whole run** (zero new font or
  asset files M1→M3; the VT323 swap stayed declined; LICENSES.md never
  needed an update — correct).
- Iteration-3 note (2026-09-05): the shipped iteration-3 state (RC-1
  register windows, LL-1 virtualization, FV-1 full viewport) measured
  **74.25 KB gz** at the closing critique — the interim growth is
  tracked in production-log.md's iteration-3 tasks. Refinement i3-1
  (the vertical fill law — the fit's grow twin + the renderer geometry
  read seam + the window-step fence, measured same method): initial JS
  **74.53 KB gz** (+0.28; 25% of budget), PASS. Refinement i3-2 (the
  window-edge row quantization — the pane-height law rewrite + the
  edit-flip re-pin, measured same method): initial JS **74.61 KB gz**
  (+0.08), PASS. Refinement i3-3 (2026-09-09, the focus-follow scroll
  quantization — one renderer function's scroll-write law, measured same
  method against the post-VIZ-merge HEAD 2e11389's **90.14 KB gz** by a
  stash round-trip): initial JS **90.20 KB gz** (+0.06), PASS. (The
  74.61 → 90.14 step is the VIZ House Lights merge, not a refinement.)
- **Iteration-4 record (measured 2026-09-10, M-8 close-out — the mobile UI
  rework, M-2 through M-7; same method: `npm run build` +
  `npm run check:bundle` at each task boundary, per-task numbers from
  production-log.md's iteration-4 entries)**: final initial JS
  **91.47 KB gz** (30% of the 300 KB budget), PASS — full iteration-4
  delta **+1.27 KB gz** over the 90.20 pre-iteration baseline (i3-3),
  attributed per task: M-2 (phone KEYS/INFO removal — Booth `compact`
  render guard) **+0.04 → 90.24**; M-3 (shared `PlayStopButton` +
  `.phone-transport` row) **+0.00 → 90.24**; M-4 (collapsible options
  drawer + its seven tool controls) **+0.33 → 90.57**; M-5 (one-octave
  register window + OCT/SEM shift row machinery) **+0.52 → 91.09**;
  M-6 (register-change feedback — aria-live readout chip + transient
  cue) **+0.37 → 91.46**; M-7 (44px row law — PHONE_ROW_PX 24→44 +
  gutter condensation) **+0.01 → 91.47**; M-8 (gate battery + close-out,
  tests/docs only) **+0.00 → 91.47**. The plan's "≤ +1 KB gz expected
  for drawer + shift controls" estimate was exceeded by +0.27 KB
  (drawer+shift = M-4+M-5 = +0.85; the overshoot is M-6's feedback
  chip + M-2/M-3 chrome wiring) — flagged here rather than silently
  absorbed; 3.3× headroom remains against the 300 KB law. CSS at the
  M-8 close-out measures **18.52 KB gz** (info-only, ungated; the
  iteration-4 per-task entries recorded JS only, so no per-task CSS
  trail exists to attribute — the whole-iteration CSS growth rides the
  same phone-scoped surfaces); fonts 37.02 / 50 KB unchanged (zero new
  font/asset files through iteration 4).
- **Iteration-5 record (measured 2026-09-10, H-5 close-out — the phone
  grid width-fill + bottom-ownership law, H-2 through H-4; same method:
  `npm run build` + `npm run check:bundle` at HEAD eeca25f, plus a
  per-commit attribution rebuild — one detached worktree per task
  boundary with the repo's node_modules, each measured by its own
  `npm run check:bundle`; the dirty-tree-safe equivalent of the i3-3
  stash round-trip, the main tree carrying untracked review artifacts)**:
  final initial JS **92.11 KB gz** (31% of the 300 KB budget), PASS —
  full iteration-5 delta **+0.64 KB gz** over the 91.47 iteration-start
  baseline, attributed per task: H-1 (audit, docs-only — src
  byte-identical to the i4 close-out) **+0.00 → 91.47** (worktree
  rebuild at bced52d reproduces the i4 record exactly); H-2 (renderer
  `setCellWidth` width-fit seam + pitched phone fill) **+0.32 → 91.79**;
  H-3 (drums fill + stage bottom-ownership + `fitPhoneRows` row growth)
  **+0.32 → 92.11**; H-4 (gates with teeth + pinned-law reconciliation —
  tests and comments only) **+0.00 → 92.11**. Every worker-claimed
  boundary number reproduced exactly on the close-out rebuild. CSS
  **18.52 → 18.54 KB gz** (+0.02, all at H-3's stage-stretch/floors
  sheet edits; H-2's law is JS-side geometry, +0.00 CSS; info-only,
  ungated); fonts 37.02 / 50 KB unchanged (zero new font/asset files
  through iteration 5). The plan's "≤ +0.3 KB gz expected for the seam +
  CSS" estimate covered the seam alone — H-2 landed +0.32, on target;
  H-3's row-growth twin (its own fit machinery, clamp + manifest-divisor
  + held-pointer gate) doubled the iteration to +0.64 — flagged here
  rather than silently absorbed (the assumption ledger's "a material
  jump reopens the budget conversation": 0.32 KB against 207.89 KB of
  headroom is not material; 3.3× headroom remains).
- **Iteration-6 record (measured 2026-09-10, S-5 close-out — saved-song
  management: rename/delete/undo, S-2 through S-5; same method as i5: one
  detached worktree per task boundary with the repo's node_modules, each
  measured by its own `npm run build` + `npm run check:bundle`)**: final
  initial JS **93.65 KB gz** (31% of the 300 KB budget), PASS — full
  iteration-6 delta **+1.54 KB gz** over the 92.11 iteration-start baseline
  (the i5 close at eeca25f; S-1 at 7fe2a4c was docs-only, src
  byte-identical), attributed per task: S-2 (model/persistence actions,
  zero UI files) **+0.00 → 92.11** (the worktree rebuild reproduces the
  baseline EXACTLY at the gate's display resolution — the normalizer +
  three actions are pure TS, almost fully tree-shaken from the entry; the
  raw entry-chunk twin measures +9 B gz / +35 B raw by platform gzip,
  encoder-dependent but the same sub-display order as S-2's own +6 B
  node-zlib claim); S-3 (desktop UI rename + delete + undo) **+1.54 →
  93.65** (the Projects.tsx surface — row/confirm/editor controls, the
  InlineEdit twin, help-registry text, toast strings — plus its
  projects.css styles); S-4 (phone fit + gates, test-only) **+0.00 →
  93.65** (entry chunk hash `index-CV-HG4xw.js` IDENTICAL to S-3's — src
  byte-identical, reproduced on the worktree rebuild); S-5 (gates with
  teeth + close-out, tests/docs only) **+0.00 → 93.65**. CSS **18.54 →
  18.70 KB gz** (+0.16, all at S-3's row/confirm/edit styles in
  projects.css; info-only, ungated); fonts 37.02 / 50 KB unchanged (zero
  new font/asset files through iteration 6). **The plan's "expected
  ≤ +0.4 KB gz" estimate was exceeded by +1.14 KB — flagged here rather
  than silently absorbed (already escalated by S-3's verifier when the
  +1.54 first appeared; S-5 closes the ledger per its AC).** The overshoot
  is S-3's UI/help/toast copy riding the eager entry chunk (the audit's
  own UI-surface estimate, not the model seam): 3.3× headroom remains
  against the 300 KB law, and no lazy-split is warranted for a surface
  that must open on first paint of the booth.
- **Iteration-7 record (measured 2026-09-10, N-6 close-out — phone MIDI
  section rework: snap window, unified controls, pitch anchoring,
  pinch-zoom, card headers, N-1 through N-5; same method as i5/i6: one
  detached worktree per task boundary with the repo's node_modules, each
  measured by its own `npm run build` + `npm run check:bundle`; every
  worker-claimed boundary reproduced EXACTLY on the close-out rebuild)**:
  final initial JS **95.57 KB gz** (32% of the 300 KB budget), PASS —
  full iteration-7 delta **+1.90 KB gz** over the 93.67 iteration-start
  baseline (the i6 close at 658005f incl. i6-crit1), attributed per task:
  N-1 (audit, docs-only — src byte-identical) **+0.00 → 93.67** (worktree
  rebuild at a24d2b7 reproduces the baseline exactly); N-2 (semitone-snap
  law in the renderer + box clause + unified register controls + the
  phone OCT drawer move) **+0.70 → 94.37**; N-3 (pitch-anchored notes +
  live label re-derivation through the renderer seam) **+0.17 → 94.54**;
  N-4 (pinch-to-zoom: renderer state machine + zoom-aware trailing fit +
  chip + help ×3 lanes) **+1.17 → 95.71** (attributed at landing ≈0.4
  renderer + ≈0.3 LaneGrid fit/chip plumbing + ≈0.4 help entries); N-5
  (phone card header tiers) **−0.14 → 95.57** — the fragment extraction
  dedupes the previously duplicated header buttons, the first negative
  task delta of the project. CSS **18.72 → 19.04 KB gz** (+0.32: N-2
  +0.09 box/stepper/drawer, N-3 +0.00, N-4 +0.07 chip + landscape law,
  N-5 **+0.16 tier rows + shrink chain — corrected at this close-out**:
  the N-5 journal's "+0.03 info" read the vite-report gzip line, not the
  gate's node-zlib contract number; the close-out fence measures HEAD at
  19.04; info-only, ungated); fonts **37.02 / 50 KB
  unchanged** (zero new font/asset files through iteration 7).
  **ESCALATION (the S-5 precedent, reviewed and closed at N-6): the plan's
  fence said "≤ 93.67 KB gz + escalate if >~+0.6" — the +1.90 total is
  3.2× over that line and is flagged here rather than silently absorbed
  (already flagged per-task at N-2 +0.70 and N-4 +1.17, both explicitly
  deferred to this close-out).** The verdict: ACCEPTED — 95.57 is 32% of
  the 300 KB law (3.1× headroom remains), and the cost is the iteration's
  actual product: three new interaction state machines on the eager entry
  (snap/seat, label re-derivation, pinch) plus five phone surfaces'
  UI/help copy, all of which must be present at first paint of the lane
  (a lazy split would put a fetch+parse on the phone's first lane open —
  the same one-click-surface reasoning as VZ-TH-4). Cheap trim: none
  found — N-5's dedupe already banked −0.14, the N-4 help entries
  (≈0.4) are HP-2-coverage law (every interactive control explains
  itself), and the state machines are the user-facing laws themselves,
  not speculation.
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

## 10. Long-loop scale (LP-1, iteration 3 — the 128-bar spike: measured BEFORE the long-loop UI lands)

The LP-1 production spike (2026-09-04) measured the iteration-3 target
state — "a 128-bar pattern visible on one lane while all four lanes play
dense long chains" (drums 64B + bass 4B + chords 8B + a dense 128-bar
lead, LCM = one 128-bar cycle, 120 BPM) — plus the worst case (every lane
one 128-bar pattern). The EAGER baseline is the finding: today's renderer
CANNOT hold §2a's law at 128 bars, and the per-edit recompile path cannot
hold §2's long-task guard. The spike's VERDICT gates LL-1/LL-2 (Ant-Man's
fence): every criterion is within budget WITH the two committed
mitigations below — they are LL-1 build REQUIREMENTS, not options.

- **(a) Frame budget — EAGER: RED.** 38,208 cells + 7,393 note-runs
  (53,459 elements) across the quadrants; 4 s pure rendering while playing:
  57-76 frames (14-19 fps), median 48-64 ms, p95 106-142 ms, max up to
  147 ms, **3.4-42.1% of frames < 33.4 ms** (law: ≥95%) across four runs
  (load-sensitive, never close). Phone window (390×844, single-lane stage
  with the 30,720-cell lead grid): median 50-69 ms, 2.6-3.6% < 33.4 ms
  (desktop-class CI hardware emulating the viewport — the MB-5 caveat).
  **WINDOWED prototype: GREEN** — see the committed approach; the same
  dense state renders **241-242 frames / 4 s (≈60 fps), median
  16.6-16.7 ms, p95 19.0-19.4 ms, max 21.2-27.3 ms, 100.0% < 33.4 ms**,
  playheads live in all four grids (60-61 distinct transforms/s each), on
  **2,151 DOM cells** (5.6% of eager; per-grid windows 324/441/441/945).
- **(b) Horizontal scroll on the 2048-column grid — EAGER: RED** (16
  frames / 2 s sweep, median 133-152 ms, 0-6.3% < 33.4 ms). **WINDOWED:
  GREEN** — a full-width programmatic fling sweep during playback (2.5 s
  across ~34.8k px ≈ 13.6k px/s — the aggressive worst case, not a
  realistic wheel cadence): 115-147 frames, median 17-21 ms, p95 26-28 ms,
  **98.3-100% < 33.4 ms**, 56-65 rewindows at 2.1-2.6 ms each.
- **(c) O(steps) scans vs the bounded replacement.** Node-measured
  (node harness, M1-class arm64): the production-shaped scan at 2048 steps
  costs 16-27 µs avg / 36-66 µs worst per call vs the O(1) bounded lookup
  at 84-136 ns (~200-460× cheaper). Per rAF frame (9 lookups: 4 grids ×
  playheadX+quantizedStep + the booth's getPosition) the scan projects to
  145-248 µs avg (worst 322-557 µs) vs 0.8-1.2 µs bounded — both inside
  the 33.4 ms budget, so the rAF path alone never demanded the fix. The
  binding constraint is the **per-EDIT recompile** (compileLaneSchedule
  runs synchronously in the engineBridge store subscriber on every
  pitched content edit): at 128 bars the stepOfTime scan costs
  **276-438 ms per edit at musical density** (7,680 notes; measured live
  in-page: 232-295 ms per lead toggle incl. validate+sync) and 582-1809 ms
  at max density (30,720 notes) — multiples of the 50 ms long-task guard.
  With the bounded lookup: **2.5-4.3 ms musical** (GREEN), 22-73 ms at the
  degenerate max-dense extreme (the §10c TH-5 re-pin below: the 50 ms
  guard HOLDS as-is, pinned at the production numbers — the max-dense band
  is a recorded content-volume asymptote outside the guard's scoped claim).
- **(d) Export cost (REAL render pipeline).** Offline render is NOT
  real-time-bound: the user's 64-bar LCM cycle (drums 64B + bass 4B +
  chords 8B; 128 s of audio @120 BPM) renders in **7.3-8.5 s wall
  (15-17× real-time)**, loop buffer 43 MB; the worst-case 128-bar cycle
  (every lane 128B, musical density; 256 s ≈ the planned "4.3 min")
  renders in **12.2-14.8 s wall (17-21× real-time)**, loop buffer 86 MB,
  heap delta 243-460 MB (Chromium `performance.memory` around the whole
  render; includes the raw + folded buffers and context internals).
  GREEN — the busy-guard UX spans seconds, not minutes.
- **(e) Codec round-trip at the dense-128 scale (SV-1 re-confirmation).**
  The max-dense 128-bar document (this harness's shape: one 128-bar
  pattern per lane, a note on every step of every row, 3 max-FX per lane)
  canonicalizes to **2,238,947 chars ≈ 2.14 MB** (SV-1 measured
  2,693,153 ≈ 2.63 MB with a slightly denser FX/rows shape) — 53-64% of
  the 4 MB cap. Round-trip (encode + decode): **103-230 ms** — a one-time
  save/load/import cost. GREEN.

### 10a. The committed windowing approach (what LL-1 builds)

The spike prototyped and chose the **sticky-layer column window**
(`WindowedGridRenderer` in tests/lp1-spike-harness.ts — prototype only;
LL-1 lands the seam in src/):

- The scroll container keeps a native, pattern-wide scroll extent via an
  invisible absolute **sizer** (width = label + steps × stepWidth), and a
  `position: sticky; left: 0` **layer** holds the grid — the compositor
  pins it to the visible edge while the sizer scrolls under it. No JS on
  the per-scroll path.
- Each row's `.row-cells` grid template carries ONLY the window's tracks
  (`repeat(winCols, cellPx)`); rewindow rebuilds are **O(winCols × rows)
  at any pattern size**. (The first prototype variant — spacer grid items
  spanning the off-window tracks of a `repeat(2048)` template — was
  measured and REJECTED: re-laying-out spacer spans in the full-width
  template cost ~25 ms per rewindow and collapsed the fling sweep to
  15-83% < 33.4 ms.)
- Rewindow is hysteresis-gated (fires only when the visible range exhausts
  the ±24-column overscan; the recentered window then buys a full
  overscan+visible of travel) and **recycles the cell pool** — a rewindow
  re-tags existing cells (`dataset.step/beat/on`, auto-placement keeps DOM
  order == column order), so it does zero element churn and no layout-tree
  rebuild: measured 2.1-2.6 ms per rewindow, invisible in the frame
  distribution.
- On-state reads are O(1) per cell: sync flattens each row's content
  (drums hits / pitched spans) into a full-pattern `Uint8Array` once
  (O(rows × steps) per sync), and applyOnState/cell re-tagging read it
  directly. (The naive `spans.some` per cell was O(cells × spans) — 512
  spans/row at 128 bars — and was itself a measurable sweep cost.)
- Note-runs are clipped to the window (the G6 seam law): only spans
  intersecting the window exist, with window-relative geometry.
- The playhead/glow rAF loop is unchanged law (transform playhead,
  quantized glow) with x window-relative
  (patternX − winStart × stepWidth).

### 10b. The committed time-math (what LL-1/LL-2 build)

An **O(1) guess-and-verify step lookup** replaces both linear scans
(`stepIndexAtTime` at time.ts:99-112, seam A5; `stepOfTime` at
song.ts:118-123, seam F5): one division-floor guess
(`floor(t / secondsPerStep)`) plus at most three EXACT timeAtStep boundary
predicate checks over candidates guess−1..guess+1. Because the predicates
are timeAtStep verbatim, boundary decisions are bit-identical to the scan
by construction — proven by the node harness's exhaustive equivalence
sweep (every step boundary + midpoint + ulp neighbors of the 2048-step
loop at swing 0/0.5/1; a bpm × swing × step-count spot grid across 8 × 9 ×
5 combinations; wrapped/negative times; production LoopBars parity at
1/2/4 bars). The sweep lives in tests/lp1-perf-spike.test.ts (hard
assert); the timing lines above are its recorded `[LP-1 …]` console
output. LL-2's steps-typed playhead basis (grid/math.ts G1) uses the same
lookup (`playheadXSteps` in the harness is the shape).

### 10c. Verdict (the LL-1 gate input)

| Criterion | Verdict | The LL-1 requirement it becomes |
|---|---|---|
| (a) frame budget @ dense 128 | **AMBER** | column-window virtualization (§10a) is REQUIRED — eager is 3-42% vs the 95% law; windowed is 100% |
| (b) 2048-col scroll | **AMBER** | §10a incl. pool recycling + sticky layer — eager is 0-6%; windowed 98-100% (fling worst case) |
| (c) O(steps) scans | **AMBER** | the O(1) lookup (§10b) is REQUIRED for the per-edit compile path (276-438 ms → 2.5-4.3 ms at musical density); rAF path green either way |
| (d) export wall/memory | **GREEN** | 14-15 s wall / 86 MB buffer / ≤460 MB heap at the 128-bar worst case |
| (e) codec round-trip | **GREEN** | 2.14-2.63 MB canonical (≤ 64% of the 4 MB cap), 103-230 ms round-trip |

No criterion is RED: the windowed-editing fallback (the Strange
contingency) does NOT fire. LL-1/LL-2 proceed behind the two committed
mitigations above. Harnesses: tests/lp1-perf-spike.test.ts (node) +
tests/browser/lp1-perf-spike.test.tsx (browser) + shared
tests/lp1-spike-harness.ts; method + honesty caveats in their headers
(source-mount browser harness — the pattern-rail precedent; the eager
baseline numbers are RECORDED lines, the windowed laws are HARD asserts;
the windowed prototype's time basis is a wall-clock loop-time at the
lane's own cycle length until LL-2's per-lane basis lands — cost-
equivalent, journaled).

**TH-5 long-task re-pin (2026-09-04) — the 50 ms per-edit guard HOLDS
AS-IS.** No widening, no named 128-bar-density exception. The level the
production numbers support: at the dense-128 musical state (7,680 notes)
LL-1's browser gate measured **10-21 ms per toggle**, and TH-5's
consolidated gate re-measured **0/14/12/13/10 and 0/14/12/12/11 ms**
across standalone runs (the 0 ms first toggle is the note-removal path's
near-free case) — 2.4-5× headroom under the guard, asserted HARD in
`tests/browser/frame-budget.test.ts` ("TH-5 (a)(b)"). The LP-1 22-73 ms
band was measured at the degenerate every-step-every-row extreme (30,720
hand-authored notes): a bounded CONTENT-VOLUME asymptote (~2.4 µs/note —
linear in note count, never in pattern steps), reachable only by
deliberately maxing fills/drags on every row, and not a regression of
any kind (the retired O(steps) scan it replaced measured 276-438 ms at
the musical state ALONE — the guard's actual prey). Decision recorded:
the guard stays 50 ms, and its scoped claim is the production-
representative authoring states — exactly the states its asserting gates
measure (TH-1's 1-bar demo, TH-4's dense 4-bar, TH-5's dense-128
musical). The max-dense extreme stays a recorded honesty note here, not
a gated budget; nothing was widened anywhere in this decision (the
contract's discipline: never widen without measured justification, and
the production measurements never asked for it).

### 10d. The committed iteration-3 gate family (TH-5, 2026-09-04)

The iteration-3 perf laws live as ONE consolidated family in the canonical
perf gate file — `tests/browser/frame-budget.test.ts` — alongside the v0/iteration-2
gates (the LP-1 spike harness stays as the recorded evidence + prototype
laws; its two fling asserts gained the same de-flake below):

- **(a) LONG-LANE PLAYBACK, desktop (1440×900)** — LP-1's denseLead128Doc
  state (drums 64B + bass 4B + chords 8B + a dense 128-bar lead; LCM = one
  128-bar cycle, per-lane cycles all different — the LL-2 poly-loop visual
  under load), imported through the REAL OPEN FILE path (canonical codec
  bytes on the always-mounted `.projects-input` → the real import handler →
  loadDocument): **≥95% of frames < 33.4 ms over a 4 s pure-render window**
  with all four per-lane sweeps live (≥2 distinct transforms/s each), the
  **2048-column register fling sweep ≥95%**, and **every per-edit toggle
  block < 50 ms** (the §10c re-pin law — this assert IS the
  no-per-frame-linear-scans gate: the retired scan measured 276-438 ms at
  this state).
- **(a′) LONG-LANE PLAYBACK, phone (390×844)** — the same imported state on
  the single-lane stage: census + a pure-render window + the register
  sweep, same HARD laws (the §9 MB-5 emulation caveat carries — a
  regression catch, not a device-class verdict).
- **(b) VIRTUALIZATION LAWS** — the DOM census **< 10,000 cells** at the
  dense-128 state (eager 38,208) while every long-pattern scroller keeps
  its pattern-wide native extent (lead > 30,000 px — the sizer) and ≤4-bar
  grids stay eager; **census vs pattern size** (a bass 4→16-bar grow — step
  count ×4 — moves its census 448→322: the window, never the pattern); and
  during the sweep **the window re-seats** (first rendered cell's step
  reaches ~1990 of 2048) **with the census constant** (pool recycling,
  variance ≤ 200 cells). Teeth re-proven in-family: GRID_VIRTUALIZE_MIN_STEPS
  scratch-forced to 99999 → the census law RED exactly on
  `expected 38208 to be less than 10000` → restored byte-exact (SHA-verified)
  → green.
- **(c) EXPORT-COST CEILING** — the 64-bar gate render (musical density,
  the user's poly-loop shape, the REAL offline pipeline) **wall-time ≤ 25 s**
  (a regression ceiling ≈ 3× the 4.0-8.5 s measured band across LP-1/TH-5 —
  NOT a UX promise; an algorithmic regression of the retired-scan class is
  10-100×); loop buffer 43 MB + heap delta recorded (Chromium
  `performance.memory`, recorded not gated — its precision is
  Chromium-only). The 128-bar worst case stays XP-1's RECORDED determinism
  probe (tests/browser/audio-determinism.test.ts — 7.2-7.5 s concurrent
  double render; LP-1 (d) 7.4-14.8 s single under load) per the CI-cost
  discipline: one worst-case render per battery, not per gate.
- **(d) WIDTH-UTILIZATION PERF (FV-1's perf half)** — the densified
  1920×1080 stage (demo + 4-bar lead; the lead quadrant measures 944 px —
  the retired 1400 px cap would leave ~660, asserted in-gate so the
  measurement can never silently run on a capped stage) holds **≥95% of
  frames < 33.4 ms** with all four playheads live. The utilization +
  densification LAWS stay in tests/browser/viewport-utilization.test.ts
  (assertions-only, FV-1).

Measured (2026-09-04, TH-5; M1-class macOS arm64, headless Chromium 151
via the playwright 1.62.1 pin; method: the `[TH-5 …]` console lines of the
gates themselves — rAF deltas measured in-page, the REAL built bundle
booted in a fresh same-origin iframe with the dense doc imported through
OPEN FILE; standalone runs ×4, statistically identical):

| Gate | Law | Measured |
|---|---|---|
| (a) desktop long-lane, 4 s | ≥95% < 33.4 ms | 241 frames, **0 over**, max 19.8-20.8 ms, p95 18.1-19.0, median 16.6; playheads 241/241 ×4 lanes |
| (a) 2048-col fling sweep | ≥95% < 33.4 ms | 119-120 frames, **0 over**, max 23.8-27.3 ms, median 16.6-16.8; window re-seat 1990-1993; census 690-810 (constant) |
| (a) per-edit guard | each block < 50 ms | 0/14/12/13/10 and 0/14/12/12/11 ms |
| (a) census | < 10,000 cells | **1,616 = 4.2%** of 38,208 eager; bass 4→16 bars: 448→322 |
| (a′) phone | ≥95% both windows | pure 121 frames 0 over (max 19.9); sweep 120 frames 0 over (max 23.7-26.1); census **435** vs 30,720 eager |
| (c) export 64-bar render | ≤ 25 s wall | **3.97-4.03 s** (×32 real-time), 43 MB loop buffer, 260-286 MB heap delta |
| (d) 1920×1080 stage, 4 s | ≥95% < 33.4 ms | 241 frames, **0 over**, max 19.8-20.0, median 16.6; lead quadrant 944 px |

**Fling de-flake (the LP-1 verifier's flag, closed).** The fling-sweep
ratio was the one load-sensitive committed assert (88.9% < 95% ONLY under
a foreign battery's full-parallel load; 99.2-100% in every quieter run —
bare vitest runs unit+browser projects concurrently, i.e. self-load).
Fixed by settle/poll, NEVER threshold loosening: the consolidated gates
and both LP-1 spike sweeps now wait for a quiet machine before the
measured window (`waitForQuietRaf` — an idle 500 ms calibration window
with the warm-up sample dropped must itself hold the frame law at ≥40 fps
cadence, else settle 400 ms and re-poll up to 20 s; the HARD ratio then
runs unchanged; a machine that never quiets fails LOUD — the MB-6
stance). On the quiet fence the calibration passes on its first window.

### 10e. Linux-CI device-class disposition for the two 2048-column sweep ratios (2026-09-06; round 2 same day)

The v0.2-merge CI run 34040604423 (GitHub Actions ubuntu-latest, 2-core
shared runner, headless Chromium 151) put the FIRST Linux-CI numbers on
the two committed 2048-column scroll-sweep ratios. Both missed the 0.95
law as NEAR-MISSES under runner CPU jitter — while every OTHER frame law
in the same run held with headroom, including the two gates' own 4 s
pure-render windows:

| Gate (file) | Law | Linux-CI measured (run 34040604423) |
|---|---|---|
| TH-5 (a) fling sweep — `tests/browser/frame-budget.test.ts` | ≥95% frames < 33.4 ms | 73 frames, **9 over** → **87.7%**, max 43.1 ms, p95 35.3 ms, median 27.8 ms (the same test's 4 s pure-render window: 241 frames, **0 over**, max 18.5 ms, median 16.7 ms) |
| LP-1 (b) PRODUCTION sweep — `tests/browser/lp1-perf-spike.test.tsx` | ≥95% frames < 33.4 ms | 71 frames, median 27.5 ms, p95 36.8 ms, max 44.3 ms → **85.9%** (the same file: 4 s pure render **100.0%** — 237 frames, p95 18.6 ms, max 33.0 ms; the (a″) prototype sweep **97.8%**) |

**Round 1 — disposition (a) CI-scoped floor (commit c4ec521), chosen over
skip-if precisely because the runner HELD the law everywhere except the
sweep's rewindow-under-load phases**: exactly these two asserts read
`onLinuxCI ? 0.85 : FRAME_PASS_RATIO` (`TH5_FLING_PASS_RATIO` /
`LP1_SWEEP_PASS_RATIO` in the two files), with 0.85 sitting just under
the measured runner band (85.9%/87.7%). Every other ratio in both files
kept the 0.95 law byte-identical EVERYWHERE (the (a″) prototype sweep
included); the local law stayed byte-identical on every non-Linux-CI
host. Method note (recorded honestly): browser-mode test code executes
inside Chromium where Node's `process` is undefined (probed 2026-09-06 in
the tester: `typeof process === "undefined"`, `import.meta.env.CI`
undefined), so the sanctioned `process.env.CI && process.platform ===
"linux"` condition is read as its browser-side equivalent — the UA
platform. This repo's only Linux host is the ubuntu-latest runner; the
local dev platform is macOS, so a "Linux" UA in this project's world IS
Linux CI.

**Round 2 — the floor DIED on run-over-run variance; disposition (b)
skip-on-Linux-CI of exactly the two ratio asserts (2026-09-06, CI run
34045838282).** The very next runner firing of the same two sweeps came
in UNDER the 0.85 floor round 1 had pinned from the first firing:

| Gate | Round 1 (run 34040604423) | Round 2 (run 34045838282) |
|---|---|---|
| TH-5 (a) fling sweep | **87.7%** (73 frames, 9 over, max 43.1 ms) | **77.9%** (68 frames, 15 over, max 40.6 ms, p95 37.1, median 29.7) |
| LP-1 (b) PRODUCTION sweep | **85.9%** (71 frames, max 44.3 ms) | **74.2%** (66 frames, median 30.2 ms, p95 40.6 ms, max 46.7 ms) |

A threshold approach needs a floor under the runner's WORST honest run
and above the regression class (~0.30-0.50); with the observed band at
74.2-87.7% across two consecutive runs of identical code, no such number
exists — the 2-core shared runner's CPU jitter moves this sweep's ratio
by more than the entire honest margin. CONCLUSION (decisive, per the §9
MB-5 stance that gates catch REGRESSIONS, not device class): the two
fling/sweep RATIO asserts are now SKIPPED on Linux CI with a loud
in-log line ("fling sweep law skipped on Linux CI — device class, §10e"
/ "sweep ratio law skipped on Linux CI — device class, §10e"). The
measurement itself STILL RUNS on the runner and still logs its numbers
(ungated) so future evidence keeps accumulating. EVERYTHING ELSE in the
two tests stays LIVE on CI, and held 100% there in BOTH flaky runs: the
pure-render 0.95 windows, the sweep DOM laws (TH-5 window re-seating
(first-step 1980) + census recycling (690-810, delta ≤ 200), LP-1 (a″)
prototype sweep at its 0.95 law), the census laws, per-toggle < 50 ms,
the phone and 1920 gates. The local law is byte-identical on every
non-Linux-CI host: both sweeps enforce the 0.95 law. Teeth (probed
2026-09-06, method as round 1): `onLinuxCI` forced true locally → the
skip engages observably (the skip log prints and the ratio assert is
bypassed while the sweep's DOM laws and the rest of the test stay live
and green); restored → the 0.95 law enforces again (floor forced to 1.01
locally → RED exactly on the fling/sweep ratio asserts, the round-1
probe). The same round-2 run's third
failure (MB-1 mobile-viewport 360×800 "PX-1 nudge armed") was the
documented test-side boot race — nudge-armed check now polls (the MB-6
settle/poll precedent), recorded in that gate's header, not here. The
class-1 touch disposition (runs 33919576870/33922353594/34040604423)
remains recorded in the two touch gate headers, not here.

## 11. Degradation matrix (Hulk lane — M3 final, 2026-09-04)

*(Renumbered §10 → §11 by the 2026-09-05 merge of main into hardware-ui:
both sides appended a "## 10." at the fork point — main's LP-1 long-loop
scale family keeps §10 because §10a-§10e are cross-referenced from
src/grid/renderer.ts, src/audio/song.ts, src/audio/time.ts,
src/state/engineBridge.ts and the TH-5/LL-1/LP-1 gate files; this
hardware-ui M3 measurement record follows it unchanged.)*

The four degradation rows town-hall §6 assigned the Hulk, measured at the
M3 final tree by the T11 checkpoint (own Playwright probes over the served
fresh build, script `.impeccable/review/t11-capture.mjs`; the in-CI gates
named per row all ran green inside the same checkpoint's 129/129 browser
battery):

| Row | Method (own probe) | Result |
| --- | --- | --- |
| **Reduced motion** | `reducedMotion: "reduce"` context, playing, computed-style sweep + capture | `matchMedia` honored; wash `transition-duration 0s` (band steps instant, field still painted at 0.72 — state info static); booth sheen `animation: none`; lane rim `animation: none` + `transition 0s`; beat-LED container `transition 0s`; cell `animation: none`; sounding rims still present statically (4/4). Vision read of `t11-1440x900-reduced-playing.png`: still reads hardware (7/10) — materials carry the metaphor with motion off. (CI twins: axe + the suite's dual-gate law; per-task twins live-verified T1–T10.) |
| **Fallback fonts** | context route aborting every `.woff2` request (4 file-backed faces blocked: Departure Mono, Plex 400/500, PS2P, VT323; Silkscreen rides inlined data-URIs and cannot be network-blocked — 2 faces still resolve), `document.fonts.ready`, then pins | one-page EXACT at 1440×900 (900/900) AND 1280×800 (800/800) under fallback rendering; zero horizontal overflow (rail right edge 4px inside the viewport); the tempo 44px input pin is a fixed CSS width (probe's ad-hoc selector missed the node — recorded honestly; the res-9 worst-case-digits law is what guards the digits, and the one-page law held). Capture `t11-1440x900-fallback-fonts.png`. |
| **Background tab** | the repo's documented synthetic `visibilitychange` override (headless Chromium does not natively clamp — perf-budget §6's honest caveat); play → on-beat → hidden 1.5s → refocus | on-beat 4/4 `.lane-floor.is-sounding`; while hidden the ~120ms decay removal PARKS the rims (count 0 — no stuck glow); on refocus the next beat fires (4/4) and the playhead recomputes from the live audio clock (93.2px → 2.1px across the loop wrap — resync-in-one-frame, no replay). Matches TH-3 (§6) and T5's park design. |
| **Low-end / CPU throttle** | CDP `Emulation.setCPUThrottlingRate {rate: 4}` + own TH-4-style probe (rAF deltas, 4s window, demo playing at 1440×900; run twice) | **241 frames / 4s, 0 over 33.4ms (ratio 1.0), max 18.7ms, p95 18.3–18.5, median 16.6–16.7 — vsync cadence holds at quarter-speed CPU** (per-frame work is far under the 16.6ms budget; the compositor layers do the moving). The vitest browser harness does not expose CDP throttling, so the dense-state TH-4(a) CI floor ran unthrottled (green, §2a M3); this probe is the honest 4x statement on the standard demo state, and the §9 device-class honesty caveat stands (real mid-tier Android stays an R7 user-session item). |

## 12. VIZ frame budget (VZ-TH-4 — the densest standard pattern, with teeth)

The viz gate in `tests/browser/frame-budget.test.ts` ("VZ-TH-4 viz frame
budget"): the densest standard pattern playing with VIZ OPEN holds the
committed budget, on the REAL built bundle. **The gate metric is frame
INTERVALS ONLY, never draw-call timings** — R1's committed lesson
(`docs/ultron/research/r1r2-canvas-perf-dpr.md`): the naive shadowBlur
model showed 0.2 ms main-thread draws while collapsing to 2 fps; the cost
lives in rasterization off the main thread, which only frame intervals
see.

- **State**: 200 BPM 16ths (the tempo input's max — R1's worst-case
  tempo), one row painted across a fresh 4-bar pattern per lane (demo
  patterns stripped from the POOL first, the MB-6 self-checking setup
  law), all four lanes on the SAME 16th tick — the true worst frame
  carries 4 ignite bursts, 13.33×/s. Offered sustained rate ≈ 50
  events/s: bass/drums/lead 13.33 each; **chords painted every 4th 16th**
  (shaping decision, recorded): a chords note stacks a 3-voice diatonic
  triad at compile (`compileLaneEvents` stack law) = 3 note-on events per
  hit, so 3.33 hits/s × 3 voices = 10 events/s — painting every 16th
  would offer 80/s, past the 64/s accept cap, and would measure the
  clamp's DENIAL path rather than the committed honest worst case
  (~53 events/s, R1 §3). VIZ open over the still-playing stage (the
  full-bleed canvas + the four stage playhead loops — maximal concurrent
  load), help mode off. **DPR forced to 2** (defineProperty on the iframe
  window pre-boot): the committed `min(devicePixelRatio, 2)` cap and R1's
  cliff regime (~440 live objects at DPR 2; the clamp law holds the
  engine ≥2× under it). The DPR-2 backing store is asserted in-gate
  (2880×1800 at the 1440×900 viewport).
- **Laws (all asserted, not logged)**: (1) ≥95% of frame intervals
  < 33.4 ms — HARD, the §2 tolerance law; (2) worst single frame (one
  full ignite batch = the hit-batch long-task guard) < 50 ms; (3) canvas
  activity ≥2 change-frames/s (load-robust law; a coarse whole-canvas
  48×30 downscale hash — probe regions can go blind to a calm spot);
  (4) the VZ-HU-3 clamp constants pinned at source against the real
  module (`VIZ_ACCEPT_CAP_GLOBAL_PER_SECOND` 64,
  `VIZ_ACCEPT_CAP_PER_LANE_PER_SECOND` 20, `VIZ_MAX_LIVE_OBJECTS` 192,
  `VIZ_RETRIGGER_REFRESH_SECONDS` 0.12 — the VOICES_PER_LANE pin
  precedent; a retune without R1-grade evidence redds before any timing
  runs); (5) the RED/GREEN TOOTH — a deliberate 70 ms/frame main-thread
  thrash injection on the SAME live app must FAIL the identical ratio
  (proof the gate is not a tautology).
- Local measured (2026-09-04, VZ-TH-4; M1-class macOS arm64, headless
  Chromium 151 via the playwright 1.62.1 pin; method: the
  `[VZ-TH-4 viz budget]` console line of the gate itself, outer-page rAF
  deltas over the 4 s window — three consecutive runs):
  242/241/241 frames, **0 frames ≥ 33.4 ms** every run, max 20.3–22.6 ms,
  p95 18.7–18.9 ms, median 16.6–16.7 ms; canvas changed on 194/194/193
  frames (~48/s — reactions firing on nearly every frame at ~50
  events/s offered); tooth 20/21 frames ≥ 33.4 ms (ratio 0.95 — RED as
  designed). vs R1's expected envelope (ratio ~100%, 2× headroom): held.
- **P2 probe-precision note disposition (VZ-HU-3 verifier, ACCEPTED —
  no fix)**: `peakLive` updates only on ignite's accepted tail, so
  companions spawned during a pure-denied stretch can momentarily exceed
  the recorded high-water mark. The 192 LAW is enforced at every push
  site (`while (live.length >= maxLiveObjects) evictOldest(t)`, spawn +
  companion paths), honest play never denies (verified walk: a closed 1 s
  window holds at most ~54 entries vs the 64 cap), and this gate's
  regime never denies — the probe's precision is evidence-quality only,
  not a law gap. Recorded here so the next ledger reader knows the
  high-water number is a lower bound of the true instantaneous peak, by
  at most the companion count (≤1 per node).
- **Eager-vs-lazy chunk decision (VZ-IM-2's open decision, re-measured
  and CLOSED by this task)**: initial JS 81.73 KB gz (§3) vs 67.18 KB at
  VZ-IM-2 — the viz engine ships eager. KEPT EAGER: 27% of the 300 KB
  budget (3.7× headroom), VIZ is the one-click headline surface (lazy
  would put a fetch+parse on J1's first open), and the flip's trigger
  was budget pressure, which is absent.

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
- TH-5: the long-lane gates load their dense state through the REAL OPEN
  FILE import path (canonical `encode(doc)` bytes set on the always-mounted
  hidden `.projects-input` via DataTransfer) — the built app itself owns
  the measured document, no test-side store access; the fling sweeps are
  quiet-poll-gated (see §10d); the export block is source-mount (the LP-1
  (d) precedent — globalSetup builds the same source).
