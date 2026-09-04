# Schema v3 seam inventory — every bars / loopBars / note-bounds / chain-length consumer

Task **SE-1** (Iron Man, iteration 3; docs/dev deliverable named in
docs/ultron/plan.md). This file is the **contract SV-1 implements against**:
every consumer of (a) `PatternBars`/`bars` fields, (b) `TransportSchema.loopBars`
+ the `LoopBars` type, (c) `Note.start ≤ 63` + `MAX_NOTE_LENGTH` bounds,
(d) steps-per-bar × bars math (incl. `session.ts:747`'s `bars: 4` hard-code),
(e) `chainSteps`/chain-length computations, and (f) the IM-6 loopBars↔grid-extent
invariant — each with file:line, what it assumes today, and a v3 disposition.

Method (recorded for the verifier): full-file reads of every seam module plus
repo-wide greps over `src/` + `tests/` for `bars`, `loopBars`, `LoopBars`,
`PatternBars`, `chainSteps`, `steps`, `MAX_NOTE`, `63`, `64`, `128`, `2047`,
`2048`, `* 16`, `16 *`, `STEPS_PER_BAR`, `totalSteps`, `setLaneEvents`,
`pitchedPatternView`, `IM-6`. Marginal hits are included with a one-line
judgment (the task law: a missed seam is a production bug later).

## The v3 change set (from the approved plan)

1. `PatternBars` picklist `[1,2,4]` → `[1,2,4,8,16,32,64,128]` (I3-d, additive).
2. Note bounds lift to the 128-bar step space: `start ≤ 2047`,
   `length ≤ 2048` (the bound law recorded in the schema header).
3. NEW optional per-lane `octave` transpose field (canonical-empty at 0) —
   NOT bars/loopBars-coupled; listed only where it touches the same files.
4. Persisted `transport.loopBars` RETIRES (no UI writer exists today);
   consumers re-base per the dispositions below. A **compat derivation**
   keeps v0.1 behavior byte-identical until LL-2 owns the deliberate basis
   swap (the zero-drift law ends at LL-2's boundary).
5. Lane cycle = chain total (I3-e); playhead/position/one-shot re-base to
   chain/LCM bases (LL-2); export already renders the LCM (i3-5, unchanged
   law).

**Disposition vocabulary** (plan SE-1): `widen` (vocabulary grows through this
seam), `re-basis` (the value it consumes changes source), `retire` (the seam
disappears), `leave` (vocabulary-agnostic by construction — verify, do not
touch). **Compat staging**: the SC-1 precedent — each consumer keeps v0.1
behavior byte-identical until its owning task lands; the task column says who.

---

## A. Time-math foundation (`src/audio/time.ts`)

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| A1 | `src/audio/time.ts:17` | `type LoopBars = 1 \| 2 \| 4` | loop basis only ever 1/2/4 bars | leave through the compat window (derived values stay ≤ 4); LL-2 re-bases the basis to per-lane chain totals / LCM steps (up to 2048 steps per 128-bar cycle, chains may stack higher) — the bars-typed helpers need a steps-typed sibling then. LL-2 records the shape. | SV-1 leave → LL-2 retype |
| A2 | `src/audio/time.ts:37-40` | `totalSteps(bars)` = bars × 16 | multiple-of-16 step counts | leave (pure ×16; widens by construction). | — |
| A3 | `src/audio/time.ts:42-45` | `loopLengthSeconds(bars, bpm)` | bars ∈ LoopBars | leave until LL-2 (same retype as A1). | LL-2 |
| A4 | `src/audio/time.ts:90-92` | `StepAtTimeOptions.bars: LoopBars` | inverse lookup bounded by picklist | leave through compat; LL-2 steps-typed variant (see A1). | LL-2 |
| A5 | `src/audio/time.ts:99-112` | `stepIndexAtTime` — O(steps) linear scan per call | steps ≤ 64 so the scan is trivial | leave semantically; LP-1 owns the bounded time-math (per-lane cursor/indexed lookup — the plan's named perf risk; at 2048 steps × per-frame callers this is the hot seam). | LP-1 |
| A6 | `src/audio/time.ts:59-66,75-88` | `timeAtStep`, `barBeatStep`, `stepIndex` | step index unbounded ints, STEPS_PER_BAR=16 | leave (already unbounded; `barBeatStep` renders bar numbers ≥ 4 fine). | — |

## B. Transport basis (`src/audio/transport.ts`) — the loopBars engine half

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| B1 | `src/audio/transport.ts:33,43,67,91,109` | `TransportSnapshot.loopBars`, ctor `opts.loopBars ?? 1`, `_loopBars` | a single GLOBAL loop basis 1/2/4 | leave through compat (fed by the derived value, still 1/2/4); LL-2 re-bases: position/one-shot semantics move to per-lane chain totals + LCM cycle — Transport's loop-length parameter becomes steps-typed (or the session feeds derived seconds). | SV-1 leave → LL-2 |
| B2 | `src/audio/transport.ts:124-141` | `play()` — startStep clamp `min(nextStepAtOrAfter(offset), totalSteps(loopBars)-1)` | clamp fits inside a ≤64-step loop | re-basis at LL-2 (offset inside a per-lane cycle; the swung-last-step clamp law preserved). | LL-2 |
| B3 | `src/audio/transport.ts:165-207` | `setLoop` + `rearmAfterExhaustion` (R-3) — pass-skip while loop is off uses `loopLen(loopBars)` | one-shot length = loopBars × bar | re-basis at LL-2 (one-shot = exactly ONE full LCM cycle — the refinement-3 law re-based, i3-d). | LL-2 |
| B4 | `src/audio/transport.ts:209-213` | `setLoopBars(bars: LoopBars)` | picklist input | leave through compat (engineBridge still calls it with derived 1/2/4); LL-2 retires or re-signatures. | LL-2 |
| B5 | `src/audio/transport.ts:226-257` | `getLoopTime()` / `getPosition()` — playhead + BAR.BEAT.STEP basis | loop-relative mod at loopBars length | re-basis at LL-2: per-lane playhead comes from the lane's chain total (computed grid-side; Transport stays global); the booth readout semantics follow the KL-1 spec decision (plan LL-2 risk row). | LL-2 + KL-1 |
| B6 | `src/audio/transport.ts:259-299` | `compileTicks` — global monotonic step stream (`passIndex * steps + stepInPass`), one-shot exhaustion at `steps` | steps = totalSteps(loopBars) | tick stream itself is basis-independent (global step numbers — session.ts consumes them mod chainSteps); only the `!loop` exhaustion boundary is loopBars-based → re-basis at LL-2 (LCM steps). | LL-2 |
| B7 | `src/audio/transport.ts:312-318` | `finishOneShot` parks `startStep = totalSteps(loopBars)-1` | final step ≤ 63 | re-basis with B6. | LL-2 |

## C. Schema layer (`src/document/schema.ts`) — SV-1's core

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| C1 | `src/document/schema.ts:419-420` | `type PatternBars = 1 \| 2 \| 4` + `PatternBarsSchema = picklist([1,2,4])` | vocabulary cap 4 | widen to `[1,2,4,8,16,32,64,128]` (purely additive — every v2 doc validates). | SV-1 |
| C2 | `src/document/schema.ts:123-134` (esp. 126,132) | `Transport.loopBars: LoopBars` + `TransportSchema.loopBars: picklist([1,2,4])` | persisted transport field exists | retire the field (strict object: v3 docs must NOT carry it). Migration v2→v3 drops it with a defined re-derive rule (E5 below). | SV-1 |
| C3 | `src/document/schema.ts:381-387` | `MIN_NOTE_LENGTH 0.25`, `MAX_NOTE_LENGTH 128` (comment: v1 worst case 64-gate + 63 sustains on 4 bars) | 4-bar worst case | widen MAX_NOTE_LENGTH to 2048; rewrite the bound-law comment (v3 worst case = full 128-bar span; start bound law recorded in the schema header per the plan's "exact bound law" requirement). | SV-1 |
| C4 | `src/document/schema.ts:409-417` (411 start ≤ 63) | `NoteSchema.start = pipe(..., maxValue(63))` | pattern step space ≤ 64 | widen to `maxValue(2047)` (2048-step space; per-pattern width stays a SEMANTIC check, see D3). | SV-1 |
| C5 | `src/document/schema.ts:412-416` | `NoteSchema.length` clamp `[MIN, MAX]` | ≤ 128 | widen via C3's constant (same expression). | SV-1 |
| C6 | `src/document/schema.ts:422-429,439-446,450-466` | `DrumPattern.bars` / `PitchedPattern.bars` / `PatternSchema` variants | picklist type | widen via C1 (field shape unchanged). | SV-1 |
| C7 | `src/document/schema.ts:496-525` | `notesFromRowCells(rows, gateSteps, maxSteps)` — v1→v2 migration core; also the demo authoring path | maxSteps = bars × 16 passed in | leave (parametric; migrate.ts:99 computes it — see D2). | — |
| C8 | `src/document/schema.ts:534-572` | `pitchedPatternView` (SC-1 compat view; `width = pattern.bars * 16` at :546; sustain run clamped `< width`) | v1-shaped width | leave — production consumers were retired at SC-2 (compile/exportMidi/renderer/store consume notes natively); today only `tests/v1Project.ts:23,53` builds v1 bytes from it. Widens by construction. | — |
| C9 | `src/document/schema.ts:578-632` | `pitchedCellAt` / `togglePitchedNote` (store toggle bridge) | cell math over unbounded steps | leave (parametric; no width assumption beyond caller's grid). | — |
| C10 | `src/document/schema.ts:857-915` | `createDefaultProject` — 862-865 comment "loopBars 1 … IM-6: must agree with the shipped grid extent"; :865 transport `{…, loopBars: 1, …}`; :894-913 (incl. :900) every default lane = one 1-bar pattern | default doc carries loopBars; bars equal across lanes | retire the loopBars key + rewrite the IM-6 comment (the invariant is replaced: grid extent follows pattern bars [LL-1], playhead follows chain totals [LL-2]); 1-bar default patterns stay (the town-hall ground truth: bars are already equal — the inequality was rows). | SV-1 |
| C11 | `src/document/schema.ts:834-838` | `emptyDrumSteps(bars)` — `new Array(16 * bars)` | ≤ 64 entries | leave (parametric ×16). | — |

## D. Document layer: demo, migration, validation, codec

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| D1 | `src/document/demoSong.ts:90,107,275-276` | demo song: every pattern 1-bar (bars:1); chains 4×1-bar per lane; :275-276 transport loopBars 1 + IM-6 comment | same IM-6 agreement | retire the loopBars key + comment at SV-1 (C10 twin); 1-bar demo patterns leave (XP-1's poly-loop demo content is a separate demo-content decision — engine-legal today, no seam). | SV-1 (XP-1 adjacent) |
| D2 | `src/document/migrate.ts:46-118,120-123` | v1→v2 migration reads `pattern.bars × 16` as the truncation bound (97-99); registry walks to LATEST (:120-123) | v1 bars ∈ {1,2,4} | leave the v1→v2 step itself (unchanged law); NEW v2→v3 migration = additive pattern-bars widening (no-op) + `loopBars` field DROP with the defined re-derive rule + `octave` canonical-absence. Lossless by construction (the plan's SV-1 law; goldens before UI — J-section). | SV-1 |
| D3 | `src/document/validate.ts:184-201` | semantic note-in-pattern check — 189 `width = p.bars * STEPS_PER_BAR`; 191 start ≥ width reject; 195-198 0.25-grid length check | width ≤ 64 | leave (bars-driven; start cap moves to 2047 at C4, per-pattern width stays the real binder — the two-layer law is unchanged, numbers grow). | SV-1 verify |
| D4 | `src/document/validate.ts:219-241` | drums normalize — `fitSteps` :220 bars × STEPS_PER_BAR; :231 step-array length check; :239 identity-preserving normalize (the IM-6 identity law) | ≤ 64 | leave (parametric; identity law untouched — valid v3 docs must not churn). | SV-1 verify |
| D5 | `src/document/codec.ts:92-99` | `DECODE_MAX_CHARS` 1 MB — comment sizes the worst real doc at "4 lanes × 3 max-FX × 4-bar patterns ≈ a few hundred KB" | 4-bar density bound | measure (SV-1's codec-cap measurement: dense 128-bar 4-lane canonical docs vs the cap); raise only if exceeded, with SV-2's guard stack scaling. Comment updated with measured numbers. | SV-1 + SV-2 |
| D6 | `src/state/store.ts:699-710` | `setTransport` — Pick includes `"loopBars"` | persisted field writable through the store | retire from the Pick at SV-1 (the no-writer observation becomes structural); remaining callers are bpm/swing/metronome only (Booth.tsx:194-205 confirmed — no loopBars writer anywhere in src/). | SV-1 |

## E. Store + state layer

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| E1 | `src/state/store.ts:300-305` | `snapNoteLength` clamps `[MIN_NOTE_LENGTH, MAX_NOTE_LENGTH]` | 128 ceiling | leave (widens via C3's constant; note-edit UI can then produce ≥129-step notes on big patterns — correct). | SV-1 verify |
| E2 | `src/state/store.ts:315-334` | `addNote` — snaps + clamps length; `start` passes through to validation | start ≤ 63 enforced by schema | widen via C4; per-pattern width rejection (D3) still guards placement. | SV-1 |
| E3 | `src/state/store.ts:736-773` | `addPattern(lane, bars: PatternBars = 1, …)`; :753 `new Array(16 * bars)` | picklist vocabulary | widen the TYPE via C1 (UI vocabulary lands with LL-1's PAT menu; BC-1's rail `+` creates via this action with the default — production decision recorded in BC-1). | SV-1 type / BC-1 / LL-1 UI |
| E4 | `src/state/store.ts:401-414` | `applyEuclidFill` paints at `p.steps[piece].length` (the pattern's own 16 × bars) | array length = pattern length | leave (length-parametric; a 128-bar drum row fills 2048 cells — LP-1 perf only). | — |
| E5 | `src/state/engineBridge.ts:136-142` | `syncTransport` — :141 `session.transport.setLoopBars(doc.transport.loopBars)`, the ONE push of the persisted field into the engine; test-pinned "authoritative" (`tests/engine-bridge.test.ts:111`) | doc field exists | re-basis to the compat derivation at SV-1: `setLoopBars(deriveLoopBarsCompat(doc))`. Recommended shape (decision SV-1 owns, constraint = zero v0.1 drift): derive `min(4, max pattern bars in the doc)` — reproduces every known value: default/demo 1; every UI-reachable project 1 (no writer ever existed); the loopBars=2/4 cases exist only in hand-built test/import docs where they pair with equal-or-smaller max pattern bars (exportWav/render-parity/pointer-edge-states tests, J-section). Divergence class (named for the log): a hand-authored v2 doc with `loopBars < max pattern bars` sweeps a wider basis under the derivation — exports unaffected (LCM path, F6), playhead/one-shot sweep only, no golden/fingerprint pins it. LL-2 deletes the derivation entirely. | SV-1 → LL-2 |
| E6 | `src/state/patternRail.ts:22-36,38-58` | `RailTile.bars` / `PoolEntry.bars` display projections (`pattern?.bars ?? 1` fallback for unresolvable ids, :46) | any number | leave (display-only; "128B" tile label + aria read fine). | — |
| E7 | `src/state/selection.ts:153-163` | `currentPatternFor` — which pattern the grid edits (grid-extent selector) | selection → pattern → bars → grid | leave (the LL-1 grid-extent law consumes this unchanged: extent follows the selected pattern's real bars through LP-1's windowing seam). | LL-1 |

## F. Engine: compile, song/chain, session playback

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| F1 | `src/audio/compile.ts:58-81` | drums compile — walks `pattern.steps[piece]` (:69-72) | steps array length = 16 × bars | leave (array-driven). | — |
| F2 | `src/audio/compile.ts:91-115` | pitched compile — :101 `hold = note.length × stepSec`; :106 `timeAtStep(note.start)`; :111 `seedSalt = note.start * 16 + note.degree` | start ≤ 63, length ≤ 128 | widen-verify: all three expressions are unbounded-safe at start ≤ 2047 / length ≤ 2048 (timeAtStep O(1); salt is a deterministic int — the (degree,start) anchor is unique per pattern so the noise-identity law holds). Overhang past pattern end stays legal (SC-2 law). | SV-1 verify |
| F3 | `src/audio/song.ts:7-22` | module law — chain length = Σ bars × 16; :8-12 EVEN-offset swing-parity law (segment offsets are multiples of 16 so swung odd steps keep pattern-local parity); :16-19 poly-loop + "Loop toggle/loopBars remain transport semantics" | bars ∈ {1,2,4} | leave with proof: any whole-bar segment start (8/16/32/64/128-bar patterns) is still a multiple of 16 → the swing-parity law holds by construction at every vocabulary size. The :18 comment's loopBars clause updates at LL-2. | SV-1 verify / LL-2 comment |
| F4 | `src/audio/song.ts:40-59,88-115` | `LaneSegment`/`LaneSchedule` — :93 `steps = pattern.bars * 16`; :114 `chainSteps: cursor` | segment/chain math | leave (parametric ×16 sums; chainSteps up to Σ 128-bar slots — thousands of steps — fine as ints). | — |
| F5 | `src/audio/song.ts:106,117-123` | `stepOfTime(t, groove, steps)` — O(steps) inverse per event | steps ≤ 64 | leave semantically; LP-1's bounded time-math replaces the per-event scan (the plan's named `song.ts:118-123` hot spot). | LP-1 |
| F6 | `src/audio/render.ts:128-146,257-260` | `computeLoopSteps(laneChainSteps, fallbackBars)` — :135 comment "Empty list → transport loopBars × 16"; :145 `fallbackBars * 16`; :259 feeds `doc.transport.loopBars` | export loop = LCM of chain lengths; fallback = loopBars | leave the LCM law (powers-of-two ⇒ LCM = longest lane — i3-5 by construction); fallback input re-basis at SV-1: the :259 argument disappears with the field — feed the compat derivation (or constant 16). Reachability (named): the fallback fires only when EVERY lane has zero resolvable patterns (resolveChainPatterns falls back to first-pattern otherwise) — degenerate docs only; pin with a test either way. | SV-1 |
| F7 | `src/audio/render.ts:148-175,245-263` | `expandLaneEventsForLoop` (mod chainSteps over loopSteps) + render orchestration | chain multiples of 16 | leave (vocabulary-agnostic; render length = loopSteps × secondsPerStep regardless of swing — the F3 law's export half). Export COST at 128 bars (~4.3 min @120 BPM) is XP-1/TH-5's measured ceiling, not a seam change. | XP-1 / TH-5 |
| F8 | `src/engine/session.ts:402-407` | metronome downbeat — :407 `step % STEPS_PER_BAR === 0` | bar-relative click | leave (16-mod, any length). | — |
| F9 | `src/engine/session.ts:520-557,560-607,609-651,653-730` | quantized-switch surgery — `seg.steps === candidateSteps` :634/:648; chainSteps mod math :621-650/:672-720 | segment steps are multiples of 16 | leave (vocabulary-agnostic; the boundary-vs-iteration bar-count-match law works at any size — a switch to an equal-step slot lands mid-chain, else defers to iteration wrap). | — |
| F10 | `src/engine/session.ts:732-766` | LEGACY `setLaneEvents` — :746-750 `stepIndexAtTime(event.time, { bars: 4, … })` HARD-CODE; :755-765 one-segment schedule from `patternSteps` | event→step bucketing assumes a 4-bar/64-step window — events past step 63 all bucket to 63 | retire (plan LL-1: "session.ts:747's bars:4 hard-code retires — compile consumes real bars at any vocabulary size"). Production path is `setLaneSchedule` (F9); only `tests/session-lane-events.test.ts:70,119` (+ mock stubs) use this seam. Replace with a real-bars/steps-based bucketing or delete the seam with its tests. | LL-1 |
| F11 | `src/engine/session.ts:768-828` | `deliverLaneEvents` — the poly-loop engine: :782-803 mod/wrap at `pb.schedule.chainSteps`; :807-819 sounding-slot ledger | each lane wraps independently at ITS chain length | leave — this IS the shipped poly-loop the whole iteration builds on (the town-hall ground truth; drums 64B vs bass 4B works today). | — |

## G. Grid math, renderer, LaneGrid — the playhead/extent basis (IM-6 invariant)

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| G1 | `src/grid/math.ts:22-24,32-57,121-124` | `PlayheadOptions.bars: LoopBars`; `playheadX`; `quantizedStep`; `gridStepCount` | playhead math keyed on bars ∈ {1,2,4} | leave through compat; LL-2 re-bases per-lane: options carry the LANE's chain-total basis — the bars-typed option becomes steps-typed (A1's retype lands here). Sweep exactness at any size is LL-2's first-landing gate (Doctor Strange's mitigation). | LL-2 |
| G2 | `src/grid/math.ts:66-83` | `stepsCrossed(prev, next, totalStepCount)` — glow/wrap dedupe | caller passes the wrap modulus | leave (parametric; the CALLER's modulus is the seam — see G5). | — |
| G3 | `src/components/LaneGrid.tsx:508` | `steps = pattern.bars * 16` → renderer column count (the grid extent) | picklist bars | leave the expression; the EXTENT LAW changes at LL-1: extent follows the selected pattern's real bars through LP-1's windowing seam (IM-6 invariant consumer — the plan names it). | LL-1 + LP-1 |
| G4 | `src/components/LaneGrid.tsx:511-519` | `readFrame` → `options: { bars: snap.loopBars, bpm, swing }` — the playhead basis = persisted loopBars | transport loopBars agrees with grid extent (IM-6) | re-basis: SV-1 derives engine-side (E5 feeds Transport, so this line stays byte-identical — RECOMMENDED: derive in engineBridge, zero renderer change at SV-1); LL-2 swaps to the lane's chain total (per-lane readFrame). | SV-1 → LL-2 |
| G5 | `src/grid/renderer.ts:1223-1256` | rAF loop — :1236-1238 `playheadX(frame.loopTime, frame.options)`; :1240 `quantizedStep`; :1241-1245 `stepsCrossed(…, frame.options.bars * 16)` — the glow wrap modulus is the TRANSPORT bars while the cell grid is pattern-width | IM-6 keeps the two equal (both 1/2/4 and agreeing) | the modulus becomes the renderer's own `opts.steps` (pattern width) at LL-1 (self-consistent glow at any extent even before LL-2's playhead re-basis); playhead basis follows G4/LL-2. Today's equality is exactly the invariant v3 replaces. | LL-1 modulus / LL-2 playhead |
| G6 | `src/grid/renderer.ts:122-128,672-710` | column build from `opts.steps`; `buildRun` :699-700 — note-run bar at `start × stepWidthPx`, width `length × stepWidthPx`, unclamped past the grid width | steps ≤ 64; overhang runs overflow the row box (clipped by CSS containment) | leave the law (start+length may overhang — schema law, loops wrap); LP-1's windowing must clip runs to the visible column window (a 2048-step eager row build is the 100k-cell problem — windowed rendering owns it). | LP-1 + LL-1 |
| G7 | `src/grid/renderer.ts:828-843` | `keyResize` — :840 comment "clamped no-op at 0.25 / 128" | keyboard resize ceiling 128 | leave code (widens via drag.ts constant); comment refresh rides LL-1's renderer pass. | LL-1 comment |
| G8 | `src/grid/keynav.ts:20,75-95,119-124` | roving-grid dims `{rows, steps}` carry-clamp | steps ≤ 64 | leave (parametric; Home/End/beat-jump over 2048 columns is O(1) focus math). LP-1's windowing makes off-window cells non-DOM — window-aware nav is LL-1's wiring through this seam. | LP-1 + LL-1 |
| G9 | `src/components/LaneGrid.tsx:788` | grid remount key `` `${p.id}:${p.kind}:${p.bars}:${stageMode()}` `` — bars in the key | shape change remounts the grid | leave — this is the existing resize remount law LL-1 relies on (extent change ⇒ clean rebuild). | LL-1 (uses it) |
| G10 | `src/interaction/drag.ts:45-50,107-112,128-151,163-180,192-216` | gesture math — `snapSpanLength` clamp; `resizeBy` (:108 comment "128 ceiling"); create-drag/resize-drag/paint-drag (steps params) | clamps to pattern `steps` + length ceiling 128 | leave code (length widens via C3; step clamps take the renderer's steps — parametric). Comment refresh rides LL-1. | SV-1 verify / LL-1 comment |

## H. UI surfaces: rail, booth, exports

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| H1 | `src/components/PatternRail.tsx:588-592,982-997` | ADD surface — `handleAdd(bars: PatternBars)`; `<For each={[1, 2, 4]}>` `+{bars}B` buttons | create-time vocabulary UI = [1,2,4] | widen to the powers-of-two vocabulary + becomes the resize surface (resize-after-create is NEW — menu entry + keyboard per KL-1; refuse-by-default truncation policy per HL-1). | LL-1 |
| H2 | `src/components/PatternRail.tsx:896-904` | rail `+` = `appendChainSlot(selectedId)` (re-appends the SELECTED pattern); aria-label "Append … selected pattern" | `+` duplicates | retire the semantics (BC-1: `+` = new blank next-letter pattern via addPattern, appended + selected + editable; DUP stays the only duplicator). The new pattern's default bars = addPattern's existing default (production decision recorded in BC-1). | BC-1 |
| H3 | `src/components/PatternRail.tsx:887,849-851` | `{tile.bars}B` tile badge; tile aria-label reads bars | display | leave (any number reads correctly). | — |
| H4 | `src/components/PatternRail.tsx:5,141-143,168` | header + help-registry texts — "ADD 1/2/4 bars", "new pattern of this length (1, 2 or 4 bars)" | vocabulary in user-facing help | widen the text with LL-1's UI (HP-2 coverage gate fails on stale text — the registry law). | LL-1 |
| H5 | `src/components/Booth.tsx:145-183` | rAF position loop over `transport.getPosition()` (formatPosition import :17) | BAR.BEAT.STEP global readout wraps at loopBars | re-basis at LL-2; global-position SEMANTICS at unequal cycle lengths follow the KL-1 spec (per-lane announcements law). | LL-2 + KL-1 |
| H6 | `src/audio/exportWav.ts:41-49,137` | `ExportWavSuccess.bars` (:44-45 display-only); :137 `bars: rendered.loopSteps / 16` | loopSteps multiple of 16 | leave (LCM of ×16 chains stays ×16; toast "128 BARS" correct). | — |
| H7 | `src/components/Projects.tsx:207-224` | :216 `WAV EXPORTED · ${result.bars} BAR(S)` toast | display | leave. | — |
| H8 | `src/audio/exportMidi.ts:233-266,275-314,320-348` | MIDI chain walk — :244/:263/:295/:311 `cursor += pattern.bars * 16 * TICKS_PER_STEP`; :336 cue-marker slot starts Σ bars×16 | chain-walk tick math | leave (parametric; PPQ math at 2048 steps/segment exact). Export length law = the WAV/one-shot LCM cycle (i3-5) — already the compiled-chain walk. | — |

## I. Geometry/budget seams sized at the 4-bar worst case (marginal — judgment: real, owned by the layout/windowing tasks)

| # | file:line | consumer | assumes today | v3 disposition | task |
|---|---|---|---|---|---|
| I1 | `src/components/LaneGrid.tsx:129-139`; `src/grid/renderer.ts:81-88` (:84) | fill-rail 220 px sized to the 4-bar "64/64" readout worst case (207.3 px) | fill-rail width budgeted for a 2-digit step count | at 128 bars the euclid readout reads "2048/2048" — wider than the budgeted worst case. Re-fit or window with LL-1 (recorded in-task; the px slot is production-tunable per the RC-1/FV-1 precedent, not a scope change). | LL-1 |
| I2 | `src/components/LaneGrid.tsx:100-105` | "long patterns scroll horizontally inside the quadrant … 4-bar scrolls, exactly as before" | in-quadrant horizontal scroll handles 4-bar overflow | the existing scroll mechanism is LP-1's windowing precedent — LP-1 commits the column-window approach; LL-1 wires editing. | LP-1 + LL-1 |
| I3 | `src/styles/app.css:31-42` | `.stage-floors` max-width 1400px | viewport cap | retire (FV-1 — listed for completeness; not a bars consumer, but the town-hall item-4 anchor). | FV-1 |

## J. Test-side seams (SV-1/LL-1/LL-2 keep these green or deliberately extend)

| # | file:line | seam | v3 disposition | task |
|---|---|---|---|---|
| J1 | `tests/golden/manifest.json` + `tests/golden/codec-default-project.golden.test.ts` | canonical bytes of the default doc (carries `loopBars:1`, `bars:1`) | regenerate via `npm run goldens:update` BEFORE any UI depends on v3 (the SC-1 law); new v3 entries; loopBars key absent. | SV-1 |
| J2 | `tests/golden/migrate-v1-to-v2.golden.test.ts` (manifest: `migrate/v1-{default,demo,sustain-heavy}-to-v2`) | migrate() walks to LATEST — after SV-1 the walk continues v2→v3, so final bytes change | rename/extend to v3 expectations + ADD v2→v3 goldens (v2 default + demo + boundary-note neighbors → v3 bytes) per the plan's golden list. | SV-1 |
| J3 | `tests/golden/midi-export.golden.test.ts` + render/wav fingerprint entries (`wav/reference-export-fp-v1`, render fp) | export bytes on current-shape docs | zero-drift law: compat derivation must keep every fingerprint byte-identical until LL-2 (E5's divergence class is export-invisible — LCM path). | SV-1 verify / LL-2 deliberate |
| J4 | `tests/document-schema.test.ts:46-47` | "invalid loopBars 3" pins the transport picklist | retires with the field; REPLACE with pattern-bars assertions (bars:3 pattern invalid; bars:8/128 valid; note start 2047/2048 boundary neighbors). | SV-1 |
| J5 | `tests/store-im6.test.ts:119-120,331,349` | `setTransport({ loopBars: … })` — persisted field writable | retire the loopBars cases (field gone from the Pick, D6). | SV-1 |
| J6 | `tests/engine-bridge.test.ts:111,170-172` | "persisted loopBars is authoritative" — the E5 push | re-base the law to the compat derivation (derived value authoritative through the window). | SV-1 |
| J7 | `tests/document-codec-property.test.ts:110,135,271` | property generators — `pick(rng, [1, 2, 4])`; bars×16 shapes | widen the generators + boundary literals (2047/2048, 128-bar shapes); SV-2 mirrors in the fuzz corpus (v3-shaped mutations + dense 128-bar seeds + octave literals). | SV-1 + SV-2 |
| J8 | `tests/note-interaction.test.ts:42,134-135,164` | MAX_NOTE_LENGTH ceiling no-ops | auto-widen via the constant; ADD ceiling assertions at 2048. | SV-1 verify |
| J9 | `tests/time.test.ts:29-31,139`; `tests/time-edge-sweep.test.ts:23-45`; `tests/grid-math.test.ts:16,34,48`; `tests/transport.test.ts:26,54,95,344-345` | LoopBars-typed sweeps + setLoopBars API | leave through compat (values still legal); LL-2 extends the sweeps to chain-total bases and re-signatures where the type retypes. | LL-2 |
| J10 | `tests/browser/exportWav.test.ts:62-71`; `tests/browser/render-parity.test.ts:80-90`; `tests/browser/pointer-edge-states.test.tsx:218-236` | hand-set `doc.transport.loopBars = 2/4` (+ paired pattern bars) — v2-shaped doc literals | SV-1: construct via pre-migration v2 docs through the parse path, or set the derived inputs — the exact choice rides the E5 derivation shape (kept export-invisible either way). | SV-1 |
| J11 | `tests/browser/e2e-happy-path.test.ts:47-48` | `DEMO_LOOP_BARS = 1` → `EXPECTED_FRAMES` | verify at SV-1 (export length is LCM-driven — 4×1-bar demo chains ⇒ 4-bar export regardless of the dropped field); rename the constant for honesty if touched. | SV-1 verify |
| J12 | `tests/browser/rail-active-follow.test.ts:112-131`; `tests/browser/mobile-resilience.test.tsx:495-502`; `tests/browser/frame-budget.test.ts:715-721` | playhead/position basis assumptions in browser laws (readout wraps at the TRANSPORT's 1-bar loop grid; `loopLen = 2 // loopBars 1`; "loopBars stays transport semantics" comment) | LL-2's per-lane sweep gates land FIRST within the task; these tests update at the basis swap (journaled law changes). | LL-2 |
| J13 | `tests/session-lane-events.test.ts:70,119` | `setLaneEvents` consumers — the F10 hard-code seam | retire/rewrite with LL-1 (real-bars bucketing). | LL-1 |
| J14 | `tests/song-compiler.test.ts:114,161,185-186`; `tests/render.test.ts:48,73-121`; `tests/quantized-switch.test.ts:29-35,208,356`; `tests/rail-follow.test.ts:55-58`; `tests/compile-lane.test.ts:33,47`; `tests/pattern-rail.test.ts:109-133,274`; `tests/euclid-fill.test.ts:61-62` | chainSteps/segment/fill laws (16+32+64=112 etc.) | leave (engine laws hold at any size); LL-1/LL-2 ADD mixed-length + 128-bar cases (drums 64B vs bass 4B audible poly-loop is LL-2's browser gate). | LL-1/LL-2 extend |
| J15 | `tests/browser/transport-loop-reenable.test.ts:58-66` | Transport-level loopBars:1 harness (one-shot length) | leave until LL-2 re-bases B3/B6 (then the LCM-cycle law replaces it). | LL-2 |
| J16 | `tests/fuzz-codec.test.ts` + `tests/fuzz-harness.ts:109-165` | v1/v2-shaped corpus mutations — lacks v3 literals | SV-2's parity task (named in plan); listed because the corpus seeds ARE a bars/bounds consumer. | SV-2 |

## K. Explicit non-seams (checked and cleared — the negative results)

- `src/state/fxStrip.ts`, `src/audio/fx.ts`, `src/audio/dsp.ts`, presets, voice
  engine, persist layer (boot/db/autosave/fileIO/quarantine), InfoView,
  HelpOverlay, KeyboardShortcuts, FxConsole, toasts, banners: zero bars/
  loopBars/step-bound consumers (grep-verified; FX `timeSteps ≤ 64` is a
  device param, unrelated to pattern length — deliberately NOT widened).
- `src/audio/scheduler.ts`: horizon/interval math is time-based, step-agnostic.
- `STEPS_PER_BEAT/BEATS_PER_BAR` (time.ts:8-10): constant by design (4/4
  sixteenths) — the whole v3 space derives from bars × 16; no consumer assumes
  otherwise.
- `barBeatStep(63)` at `tests/time.test.ts:139`: a pure decomposition check,
  not a bound pin — leave.
- `RailTile.bars ?? 1` fallback (E6) and `pitchedPatternView` width clamp
  (C8): defensive/display paths — no v3 coupling.

---

## Compat staging summary (which task consumes which seam)

| Task | Seams consumed |
|---|---|
| SV-1 (schema v3 + migration) | C1-C6, C10, D1-D6, E1-E3, E5, F2, F6 (fallback re-basis), G4 (zero-diff if derived engine-side), J1, J2, J3 (zero-drift proof), J4-J8, J10, J11 |
| SV-2 (codec-cap guards + fuzz parity) | D5 (guards scale with the measured margin), J7, J16 |
| BC-1 (rail `+` blank clip) | H2 (+ E3's addPattern default) |
| RC-1 (register windows + OCT) | octave field rides SV-1's schema/migrate/validate; no bars seam beyond file co-location |
| FV-1 (full viewport) | I3 |
| LP-1 (perf spike + windowing seam) | A5, F5, G6, G8, I2 (window approach committed; minimal seam landed) |
| LL-1 (vocabulary + resize + extent) | E3 (UI), F10 (hard-code retire), G3 (extent law), G5 (glow modulus), G7/G10 (comments), H1, H4, I1, J13, J14 (extends) |
| LL-2 (per-lane transport/render basis) | A1/A3/A4 (retype), B1-B7, E5 derivation RETIRES, F3 comment, G1, G4 (per-lane readFrame), H5, J3 (deliberate drift boundary), J9, J12, J15 |
| XP-1 / TH-5 (export cost + gates) | F7 (measurements/ceilings) |

**The one invariant being replaced** (f-category closure): IM-6's "persisted
loopBars agrees with the shipped grid extent" (schema.ts:862-865,
demoSong.ts:275-276) becomes two independent laws — grid extent = the edited
pattern's real bars (LL-1, through LP-1's window), playhead/one-shot basis =
per-lane chain totals / one LCM cycle (LL-2) — with SV-1's compat derivation
bridging the gap byte-identically.
