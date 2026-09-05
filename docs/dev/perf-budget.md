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
