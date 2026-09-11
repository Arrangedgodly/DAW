# MIDI register — iteration-7 audit + law doc (N-1)

Audit of the phone MIDI grid surfaces at **HEAD 658005f** (docs-only task;
no source changed). Every file:line anchor below was re-read against HEAD
by the audit worker — two plan-phase anchor claims were WRONG and are
corrected in §1.6 before they could mislead N-2..N-5. Live-probe numbers
(332/344 px etc.) are the plan worker's preserved evidence; every MECHANISM
behind them is re-verified in code here.

Surfaces: (1) the register window + note stagnation, (2) the pane box /
partial 8th row, (3) the duplicate octave selectors, (4) pinch-zoom seams,
(5) the phone card header. Laws in §2 bind N-2..N-5. §3 reconciles the
i4/i5/i6 gates the laws supersede. §4 records the battery at HEAD.

---

## 1. Verified anchor map

### 1.1 The seat: who writes `scrollTop`, who adopts, who re-anchors

| Anchor (verified at HEAD) | What it is | Role in the desync family |
| --- | --- | --- |
| `src/grid/renderer.ts:966-995` | `setWindow(heightRows, start, stepRows)` — pins `is-windowed` + `applyWindowHeight()`, seats `scrollWindowTo(start, **true**)`, then a **mount rAF re-anchor** at `:991-994` (`scrollWindowTo(this.seatedStart, true)`) | forced re-anchor #1 (mount) |
| `src/grid/renderer.ts:997-1011` | `scrollWindowTo(start, force=false)` — the seat writer; `target = rowTopInScroll(clampedStart)` at `:1000` | the ONE seat path |
| `src/grid/renderer.ts:1005-1007` | **the unforced guard**: `if (!force && Math.abs(container.scrollTop - target) < this.rowPitch()) return;` | **the swallow** (see §1.6 correction 2 for the writer census) |
| `src/grid/renderer.ts:1008-1009` | `container.scrollTop = target; this.seatedStart = s;` | the seat write itself |
| `src/grid/renderer.ts:868-874` | `setEditable` rAF re-anchor (`scrollWindowTo(this.seatedStart, true)`) | forced re-anchor #2 |
| `src/grid/renderer.ts:899-909` | `setRowHeight` re-anchor (same forced call, + `ensureRowVisible` when roving focus is live) | forced re-anchor #3 |
| `src/grid/renderer.ts:1014-1023` | `currentStart()` — the FIRST row whose box crosses the pane top (`top + offsetHeight > boxTop + 1`) | adopts PARTIAL rows as the semantic start |
| `src/grid/renderer.ts:1173-1186` | `onScroll` — free-adopt path: `seatedStart = currentStart()` (`:1183`), `updateGridName()` (`:1184`), `onWindowScroll?.(seatedStart)` (`:1185`) | the free-form scroll becomes view state, UNSNAPPED |
| `src/components/LaneGrid.tsx:1191-1193` | `onWindowScroll: (start) => setRegisterWindowStart(lane, start)` | writes the UNSNAPPED start into the store |
| `src/components/LaneGrid.tsx:1291-1300` | the store→renderer echo effect: `rendererRef?.scrollWindowTo(start)` — **UNFORCED** (`:1298`) | the path the guard swallows |
| `src/grid/renderer.ts:2135-2139` | arrow-walk focus-follow: `ensureRowVisible(rowIndex)` + `onWindowScroll` write-back | the fourth semantic-shift writer |
| `src/grid/renderer.ts:1071-1103` | `applyWindowHeight()` — border-box pin = `windowRows` row pitches (the i3-2 law, measured incl. padding/border/hsb) | the pin the flex chain overrides (§1.2) |

The swallowed-SEMI+ chain, code-complete: swipe → `onScroll` adopts a
PARTIAL row (`:1183`), store holds it (`LaneGrid.tsx:1192`), pane rests
mid-row → SEMI+ → `RegisterShiftControls.shift(1)` → store `start+1` →
echo effect (`:1298`) calls `scrollWindowTo` UNFORCED → guard `:1005-1007`
sees `|scrollTop − target| < rowPitch()` (true whenever the rest is within
one pitch — the NORMAL post-swipe state) → **returns without seating**;
the chip re-renders from the store while the pixels stay. Stagnation,
reproduced in code, matching plan probe 4.

Forced re-anchors #1–#3 all seat on `this.seatedStart` — the STALE
semantic start whenever a later free scroll moved the pane without a
matching adopt — which is the reverting-write class probe 4 caught
(`scrollWindowTo ← setWindow`'s mount rAF).

### 1.2 The pane box: the 332-vs-344 stretch

| Anchor (verified at HEAD) | What it is |
| --- | --- |
| `src/styles/app.css:582-589` | `.app[data-stage="phone"] .lane-grid-scroll { flex: 1 1 auto; min-height: 0 }` — **flex-GROW on the main axis stretches the pane's USED height past the renderer's inline pin** whenever the card has leftover |
| `src/styles/app.css:578-580` | `.app[data-stage="phone"] .lane-floor { flex: 1 }` — the card owns the floors' stretched remainder (i5 H-3 chain) |
| `src/components/LaneGrid.tsx:474-520` | `fitPhoneRows` — measures the stretch leftover and grows tracks via `setRowHeight`, but `:516` divides by `geo.manifestRows` (the FULL manifest, 15 on demo lead) and clamps `[rowFloorPx=44, PHONE_ROW_MAX_PX=64]` (`:232`, `:512-518`) — so a windowed pane absorbs only `7/15` of the leftover it is showndivisor mismatch, box stays taller than `7×track+chrome` |
| `src/grid/renderer.ts:1071-1103` | the inline pin (border-box `windowRows` pitches) — correct, but flex grows the box past it |

Plan probe 1 (390×844, lead): renderer inline pin 332 px, measured box
344 px → the 8th row ("A#′") intersects as a sliver. The i3-2/i3-3
boundary gate never covered this: `tests/browser/register-window-quantize.test.ts`
walks desktop/tablet panes only (no phone/390 scope in the file). The m5
gate `tests/browser/mobile-register-window.test.tsx:177-198` counts only
FULLY-contained labels (`r.top >= box.top − 1 && r.bottom <= box.bottom + 1`,
`:185`) — a partial 8th row is filtered OUT of the count, so "7 labels"
passes while an 8th row intersects the box. **Gate blindness, verified.**

### 1.3 The duplicate octave selectors

| Anchor (verified at HEAD) | What it is |
| --- | --- |
| `src/components/LaneHeader.tsx:431-467` | strip compact-row **OCT −/+ stepper** (`stepOctave(±1)` at `:450`/`:460`) — the RC-1 SOUND transpose; renders in EVERY stage (no phone guard) — selector (a) |
| `src/components/LaneGrid.tsx:1461-1496` | `RegisterShiftControls` **OCT −/SEMI −/SEMI +/OCT +** VIEW buttons (`shift(-12)`/`shift(-1)`/`shift(1)`/`shift(12)` at `:1466/:1475/:1484/:1493`) — phone register row — selector (b) |
| `src/state/selection.ts:307-322` | `stepLaneOctave` — the document write behind selector (a) (clamp −3..+3, `setLaneOctave`) |
| `src/components/LaneHeader.tsx:104-117` | E9 fence, sound side: help `lane.<lane>.oct` — "OCT changes the octave you HEAR… Shift+arrows … the octave you SEE" |
| `src/components/LaneGrid.tsx:110-122` | E9 fence, view side: help `lane.<lane>.regshift` — "…to change the octave <LANE> SOUNDS, use OCT in the strip" |
| `src/components/LaneHeader.tsx:390-397` | compact row comment: "always operable in all four quadrants (LY-1)" — the carve-out the drawer move amends |

### 1.4 Pinch-zoom seams

| Anchor (verified at HEAD) | What it is |
| --- | --- |
| `src/grid/renderer.ts:1755` | `onPointerDown`: `if (!this.editable \|\| this.gesture \|\| !e.isPrimary) return;` — the second pointer is DROPPED today (no pinch) |
| `src/grid/renderer.ts:925-945` | `setCellWidth(px)` — the H-2 width seam: re-pins track templates, the virtual sizer, note runs (`renderRuns` per row), and the column window atomically — a zoom factor re-fits through it with zero new hit-math (IN-4 forbids CSS-transform zoom: every hit test reads `stepWidthPx`) |
| `src/grid/renderer.ts:891-910` | `setRowHeight(px)` — the height twin (idempotent, re-pins + re-seats) |
| `src/components/LaneGrid.tsx:412-430` | `phoneHeldPointers` — document-level held-pointer counting; the width fit defers while ANY pointer is held (trailing rAF on release) — the deferral a live pinch rides |
| `src/styles/grid.css:267` / `:636` | `touch-action: pan-y` on cells and note-edges — the browser's own pinch is already disallowed from those origins, so an app-level pinch receives both pointer streams cleanly |

### 1.5 The phone card header

| Anchor (verified at HEAD) | What it is |
| --- | --- |
| `src/components/LaneHeader.tsx:392-397` | `.lane-state` renders "· EDIT"/"· VIEW" beside the lane name (aria-hidden, purely visual) |
| `src/styles/lane-header.css:63-77` | `.lane-name::before` — the 3px lane-hue anodized LED (idle 0.35, full on `.is-sounding` at `:79-80`) |
| `src/components/LaneHeader.tsx:391` + `src/styles/lane-header.css:32-42` | compact row: `flex-wrap: wrap`, `lane-name { margin-right: auto }` — left-heavy scatter source |
| `src/components/LaneHeader.tsx:392-514` | measured compact-row ORDER at HEAD: name `:392` → PRESET/KIT `:399-429` → OCT `:431-467` → VOL `:470` → MUTE `:496` → SOLO `:507` (wraps unaligned at 390) |
| `src/components/LaneHeader.tsx:518-641` | edit tier below: SCALE chip → GATE stepper `:563` → FX `:612` (+ FILL rails on drums) |
| `src/styles/lane-header.css:505-560` | phone 44px strip rules (MB-3/T9): `.head-step-btn` 44×44 `:513-516`, mix keys ≥44 `:521-542`, scale-chip/head-fx ≥44 `:545-549`, `head-range` 44 `:554`, widened scale-pop `:558-560` |
| `src/components/StageFloor.tsx:201-214` | phone mounts exactly ONE keyed `LaneGrid` (the selection) — the "· EDIT" marker is constant noise there |

### 1.6 Anchor corrections (re-verification findings)

1. **`currentStart()` is NOT at renderer.ts:1173-1186** (the plan's label).
   `currentStart()` lives at `renderer.ts:1014-1023`; `1173-1186` is
   `onScroll`, the path that CALLS it (`:1183`). Both are real anchors;
   the plan's function attribution was wrong.
2. **"The ONLY two scrollTop writers in src are renderer.ts:976 and
   :1008" is FALSE at HEAD.** There are THREE, all inside renderer.ts:
   `:976` (`setWindow(null)` reset), `:1008` (`scrollWindowTo`'s seat
   write), and **`:1154`** — `ensureRowVisible`'s quantized focus-follow
   write (on-grid by the i3-3 law, not a rogue). N-3's "no non-quantized
   scrollTop writes" grep must count three sites; "the renderer owns the
   seat" survives, "two writers" does not.

Everything else the plan recorded verified exactly: grid.css:123-133
(seat scroll, `overflow-y:auto` `:124`, stale wheel-only comment
`:129-131`), grid.css:235-241 (`.row-cells{position:relative}`), :267,
:591-605 (`.note-runs`/`.note-run` absolute), :636; renderer.ts:773-778
(grid aria `ROWS x–y OF z`), :842-854-style anchor math at
`LaneGrid.tsx:842-854` (`syncPatternFor` — degree → row via
`pattern.rowDegrees`); selection.ts:307-322; LaneGrid.tsx:412-430,
:474-520, :1191-1193, :1291-1300; test anchors
`touch-gestures.test.tsx` (vertical-swipe-from-cell case ~:724-742),
`octave-register.test.ts:70-108`, `mobile-register-window.test.tsx`
(count/aria/44px at `:156-215`), `register-window-quantize.test.ts`
(header: desktop/tablet scope), `mobile-register-feedback.test.tsx`,
`register-controls.test.tsx`, `mobile-touch-trusted.test.tsx` — all
present at HEAD.

---

## 2. THE LAWS (binding N-2..N-5)

### 2.1 THE SEMITONE-SNAP LAW (the window seat)

A windowed grid's visible window is ALWAYS exactly `modeSize` COMPLETE
rows — 7 heptatonic, 5 pentatonic — of the scale's rows. The register may
sit at ANY semitone offset (any start 0..`rows−modeSize`; octave
multiples are NOT required). The law has three clauses:

- **SEAT QUANTIZATION.** Every seat lands on a semitone boundary: the one
  seat writer is `rowTopInScroll(clampWindowStart(start))`. Sub-row
  drift is legal ONLY mid-gesture (the finger is never fought). The seat
  SNAPS on scroll end (`scrollend`, with a rAF/settle fallback — Android
  Chrome is the committed target; keep the fallback small) and on EVERY
  intentional move: SEMI±, OCT±, Shift+↑/↓ arrow walks, focus-follow,
  view-state echoes, remounts, and re-fits (`setWindow`, `setRowHeight`,
  `setEditable`, `applyFit`) must all write SEATED, on-grid values.
- **GUARD RETIREMENT.** The unforced distance guard
  (renderer.ts:1005-1007) is RETIRED — an intentional start change ALWAYS
  seats. The echo's no-op must come from the seat ALREADY being there
  (target === current scrollTop), never from a distance threshold. If the
  guard is kept at all, it is scoped to raw echo identity, so it can never
  swallow a semantic shift. View state (the store, `seatedStart`) holds
  ONLY seated starts — `onScroll` may no longer adopt a partial row into
  state.
- **FORCED RE-ANCHORS RE-SEAT ON THE CURRENT SEMANTIC START.** The mount
  rAF (`:991-994`), `setEditable` (`:868-874`), `setRowHeight`
  (`:899-909`) re-seat on the live semantic start and never yank the pane
  back to a stale one; after any user scroll settles, their seat target is
  the SNAPPED current start (the probe-4 revert class eliminated).

**The box law (pin-vs-flex, decided).** The windowed pane's box is PINNED
to the renderer's inline height — exactly `windowRows × track` (+ its
chrome per `applyWindowHeight`) — and the phone flex chain STOPS growing
it: the `flex: 1 1 auto` growth at app.css:582-589 is retired for
windowed panes (grow → 0; `min-height: 0` and the content-basis comment
survive for the full-manifest panes that still stretch). No 8th row may
EVER intersect the box, at any viewport, factor, or seat. Leftover is
absorbed IN ORDER: (1) row-track growth through the `fitPhoneRows` /
`setRowHeight` seam, with the windowed divisor corrected to the PAINTED
rows (the window, not the manifest) so growth actually re-pins the box,
clamped [44,64] px (the M-7 floor and i5 cap stand); (2) whatever
survives the cap is the STAGE's honest page scroll — dead-below the card
stays ~0 by leaving it to the stage stretch (the page may scroll more),
NOT by stretching the pane. This is the i5 bottom-ownership law's new
division: the pane owns its exact 7-row box; the stage owns the
remainder. (The 332-vs-344 px probe is this law's RED.)

### 2.2 THE UNIFIED CONTROLS LAW (one OCT + one SEMI per card)

On phone, ONE octave control next to ONE semitone control. The
`RegisterShiftControls` row survives as THE register-window control,
regrouped as two labeled steppers — **OCT −/+** (±`modeSize` rows) and
**SEMI −/+** (±1 row) — plus the readout chip; the four-flat-button row
and its duplicate labels end. The strip compact row's OCT group
(LaneHeader.tsx:431-467, the SOUND transpose) HIDES at phone scope and
moves into the phone options drawer (PhoneOptions already mounts shared
panels — the `BoothOptions` precedent, `Booth.tsx` `<Show
when={!props.compact}>` law; prefer the strip's existing stepper
pattern). The drawer entry carries the E9-fenced "changes what you HEAR,
not what you SEE" wording, clamps −3..+3 named. Bounds + readout derive
from the MOUNTED pattern's manifest (§2.3). Every control keeps a ≥44 px
hit and its help entry; desktop and tablet strips are byte-identical (m4)
— the strip change is phone-scoped CSS/markup, never a shared-path edit.

### 2.3 THE PITCH-ANCHORED NOTES LAW (stagnation fix)

A note's identity is its DEGREE (`pattern.rowDegrees` — the
`syncPatternFor` manifest, LaneGrid.tsx:842-854); its pixels ride its row
(`.note-run` is absolute INSIDE its row's `.row-cells`,
grid.css:591-605 + :235 — runs ride rows by construction). Every window,
scroll, or zoom change re-maps painted cells and runs through the
renderer seam (`sync`/`renderRuns`/`setCellWidth`) so notes move WITH
their rows — out of and into view — and always sit on their original
note; a note's apparent pitch NEVER changes with scrolling. The readout
desync is fixed by ONE source of truth: the seated start and the MOUNTED
pattern's manifest feed the shift row's bounds/readout, the grid aria
label, and the pixels — all three agree at every rest. (Today
`RegisterShiftControls` bounds take the LANE'S TALLEST pattern
(LaneGrid.tsx:1389-1398) while the grid clamps to the mounted manifest
(renderer.ts:773-778) — "OF 15" vs "OF 14" in one card — and the two
texts number in different bases, 1-based count vs 0-based last index;
the law collapses both divergences.)

### 2.4 THE PINCH-ZOOM LAW

Pinch re-FITS the cell geometry through the renderer seams —
`setCellWidth` + `setRowHeight` (renderer.ts:925-945 / :891-910) — NEVER
a CSS transform (IN-4: every hit test reads `stepWidthPx`/track px). The
zoom factor clamps [1, 2] × the fill-law geometry: ×1 is the exact fill
(m1 holds at rest); ×2 the ceiling. The window stays EXACTLY `modeSize`
complete rows at every factor (the box re-pins per §2.1; the page may
scroll more). Two-pointer pinch arms in the renderer — the second
pointer (`!e.isPrimary`, today dropped at :1755) becomes the pinch twin;
distance-ratio drives the factor; live re-fit defers per the
held-pointer law (LaneGrid.tsx:412-430); commit on release;
pointercancel keeps the current factor; the factor persists until
reset. **Double-tap** on the grid (two taps ≤350 ms, ≤32 px apart)
resets to ×1, consumed by the zoom layer BEFORE cell activation (a fast
place+remove on one cell nets nothing today, so no editing capability is
lost). A zoom chip beside the register row shows the factor and is a
≥44 px reset target, help-registered. Coexistence: MB-2 single-pointer
laws are byte-identical (pan-y from cells, tap-vs-pan, drag-create,
resize); the trusted-touch gates re-run.

### 2.5 THE HEADER LAW

At phone scope, hide the `* EDIT`/`· VIEW` text (`.lane-state`,
LaneHeader.tsx:392-397 — the LED + name carry the card; exactly one card
is mounted, so the marker is constant noise). Rebalance the compact row
from the measured HEAD order (name → PRESET → OCT → VOL → MUTE → SOLO,
wrapping at 390) to: **title + LED left; MUTE + SOLO right (trailing
edge); PRESET stepper on its own aligned row; edit tier
(SCALE/GATE/FX/FILL) below with consistent alignment.** Every control
keeps its ≥44 px phone hit (lane-header.css:505-560) and its help entry;
desktop/tablet strips byte-identical. Phone gate: alignment + no-wrap
overflow + 44px audit at 360/390/430; desktop render-fingerprint
unchanged.

---

## 3. Gate reconciliation (the honest law-flip ledger)

| Gate (iteration, anchor) | What it pinned | The flip i7 makes |
| --- | --- | --- |
| **M-5 free-adopt scroll** (i4; onScroll adopts `currentStart()`, renderer.ts:1173-1186; write-back LaneGrid.tsx:1191-1193) | the user's free scroll IS the intent; any rest is legal view state | SUPERSEDED by the snap law: view state holds only SEATED starts; scroll-end snaps; `currentStart()` demoted to gesture-time telemetry, not a state writer |
| **H-3 pane-in-the-stretched-well** (i5 §3; app.css:582-589 flex growth + `fitPhoneRows` [44,64]) | the phone pane grows into the card's leftover (recess inside the stretched well) | RETIRED FOR WINDOWED PANES: the pane box = the renderer pin; leftover → track growth (windowed divisor) then stage page scroll; dead-below ~0 moves to the stage stretch. Full-manifest panes (drums) keep the stretch |
| **i3-2/i3-3 boundary quantization** (`register-window-quantize.test.ts`, desktop/tablet-scoped) | border-box = `windowRows` pitches at every seat | EXTENDED, not flipped: same law asserted at phone 390/360/430, plus box-height === pin and no partial row at either edge (the m5 containment-predicate blind spot closed) |
| **m1 exact-44 fill** (i5 already retired the exact pin; `mobile-viewport.test.ts:478-491` asserts [44,64]) | rows are the 44px floor, grown into leftover, capped 64 | UNTOUCHED at ×1; the zoom law rides the same clamp — rows may read up to 2× the fill under pinch, floor 44 stands. If N-4 touches the assertion, the floor stays exact-at-×1 |
| **LY-1 compact-row always-operable** (LaneHeader.tsx:390 comment; i4 KL-1 placement) | every register control operable from the compact row in all quadrants | PHONE CARVE-OUT: strip OCT (sound transpose) operates from the options drawer on phone; desktop/tablet compact-row placement unchanged |
| **E9 fence wording** (LaneHeader.tsx:104-117 sound side; LaneGrid.tsx:110-122 view side — "use OCT in the strip") | two help entries fence SEE vs HEAR | AMENDED where the strip reference goes stale on phone: "use OCT in the options drawer" (phone help scope); sound-side entry unchanged; the fence itself SURVIVES — it is the reason the two controls must not share a label |
| **m4 desktop byte-identical** (i4; render-fingerprint gates) | desktop/tablet unaffected by phone laws | PRESERVED — every i7 law is phone-scoped; N-2/N-5 assert the desktop fingerprint unchanged |
| **MB-2 gesture-vs-scroll** (i4; touch-gestures vertical-swipe-from-cell ~:724-742) | pan-y from cells; vertical pans scroll the seat | PRESERVED — single-pointer laws byte-identical under the zoom law; re-run as the coexistence proof |
| **i6 drawer precedents** (projects-i6-audit: BoothOptions compact-removal, shared-popover laws) | compact chrome removal → drawer is an established pattern | REUSED as the vehicle for the phone OCT drawer move; no i6 gate flips |

---

## 4. Battery at HEAD 658005f (docs-only — no source changed)

Recorded by the audit worker at commit 658005f, 2026-09-10:

- lint: 0 problems (`npm run lint`)
- typecheck: clean (`tsc --noEmit`)
- unit: 86 files / 1749 tests passed
- build + bundle: PASS — initial JS 93.67 KB gz (≤ 300 KB gate)
- fuzz: 21/21 passed
- browser (CI=1 headless): see production-log entry for this task —
  green at HEAD (80 files / 224 tests)

## 5. New-gate list for N-2..N-6 (the fence numbers)

> LANDED + crossed off at N-6 (2026-09-10, HEAD 1c88681) — the §5
> reconciliation, per item: (1) → `tests/browser/register-window-snap
> .test.tsx` (N-2; the i3-2/i3-3 phone extension carried by its
> intersecting+contained+box===pin assertions at 390/360/430; the wheel
> leg ADDED at N-6 per this list; desktop fingerprint = the standing m4
> render-fingerprint battery gate + phone-header's 1280 desktop probe);
> (2) → `tests/browser/register-pitch-anchor.test.tsx` (N-3 + the N-6
> wheel legs; the 3-writers grep AC recorded in the N-3 journal); (3) →
> `register-pinch-zoom.test.tsx` + `register-pinch-zoom-trusted.test.tsx`
> (N-4; the bundle escalation closed at N-6 in perf-budget.md §3); (4) →
> `phone-header.test.tsx` (N-5; help entries kept via the battery's
> coverage walk). E9 wording checks: the amended phone-scope pointer
> ("the strip on desktop, the OPTIONS drawer on phone") pinned in
> `tests/helpLanguage.test.ts` at N-6. The only §5 items not in the
> original N-2..N-5 landings were the two wheel legs + the E9 wording
> pins — all three added at N-6, toothed, green.

1. **N-2 snap/window gate** (extends m5 + i3-2/i3-3 to phone): at
   390/360/430 — visible rows === `modeSize` at boot, after button
   shifts, after wheel, and after a SETTLED native scroll; no partial row
   at either edge; box height === renderer pin; SEMI+ from ANY rest moves
   the pane exactly one row (the probe-4 scenario RED→GREEN); readout ===
   grid aria range at all times; desktop fingerprint unchanged.
2. **N-3 pitch-anchor gate**: place a note, drive every shift path
   (buttons ±1/±12, wheel, touch scroll to arbitrary rests then settle,
   focus-follow, lane switch away/back, pattern switch, scale-mode
   change), assert after each: run's row-label identity unchanged, pixels
   track its row (in-view iff its row is), readout/aria/pixels agree; grep
   audit — the three scrollTop writers all quantized.
3. **N-4 pinch gate** (trusted harness): pinch in/out/clamp [1,2],
   double-tap ≤350 ms/≤32 px reset, zoom chip ≥44 px, window count stays
   `modeSize` at ×1.5, tap-vs-pan + drag-create unchanged, bundle cost
   attributed (escalate per S-5 if >~0.6 KB gz).
4. **N-5 header gate**: no "· EDIT" text at phone, layout spec asserted
   (title+LED left, MUTE+SOLO right, PRESET own row, edit-tier aligned),
   no-wrap overflow + 44px audit at 360/390/430, every help entry kept,
   desktop fingerprint unchanged.
