# Mobile i5 audit — H-1 (iteration 5): phone horizontal grid fill + bottom ownership

Produced 2026-09-10 at HEAD 64f4a7f (fresh `npm run build`: tsc + vite green).
Docs-only task — no production code changed. Every anchor below was
RE-MEASURED against HEAD by this audit (a prior iteration's audit failed
verification on fabricated anchors; nothing here is inherited unverified).
Live numbers come from a Playwright probe over the fresh build (served via
`vite preview`), fresh browser context per case = genuine first-run demo
boot, `deviceScaleFactor 1`, `isMobile + hasTouch`, zero console/page
errors in every probed state (headless Chromium lays out without classic
scrollbars, matching the committed Android-Chrome overlay-scrollbar target
of the MB-6 convention; the arithmetic also closes exactly — see §1).

Scope fence (the brief): PHONE stage only (`.app[data-stage="phone"]`);
desktop AND tablet byte-identical; the iteration-4 battery is the fence.

## 0. The demo state being measured

Default demo (`src/document/demoSong.ts:331-409`), first pattern per lane,
after a first-run boot: drums `drums-1` **1 bar** (16 steps, 6 rows);
bass `bass-1` **1 bar** (16 steps); chords `chords-1` **2 bars** (32
steps — the demo's one scroller); lead `lead-1` **1 bar** (16 steps, 15-row
manifest shown through the 7-row register window). All four are EAGER
grids (virtualization starts above `GRID_VIRTUALIZE_MIN_STEPS = 64`,
src/grid/renderer.ts:135) — the phone width seam's first consumers are the
eager template + runs + hit math, not the virtual pool (still mapped in §4
for completeness).

## 1. LIVE measurements at HEAD (the dead-space inventory)

Well = `.lane-grid-scroll` clientWidth (no own padding; it fills the
`.lane-floor` content box). Content width closes exactly:
`W − 2×4 (.stage-floors phone L/R, app.css:553-557, --space-2) − 2×8
(.lane-floor L/R, grid.css:23-33, --space-3) − 2×1 (rim, chassis.css:126-134,
--rim-width)` = **W − 26** → 364 @390, 334 @360, 404 @430. Measured
identically at all three viewports (floor x=4, w=W−8; scroll clientWidth
364/334/404). Page never h-scrolls anywhere (`scrollWidth == W` in all 12
probed states).

### 390×844 (well 364, chrome 202 px = 23.9% of viewport)

| lane | tracks | cell | grid outer | fill | **dead right** | rows | pane h (share) | **dead below** |
|---|---|---|---|---|---|---|---|---|
| drums (1-bar) | 16 | 15 | 323 | 88.7% | **41 px** | 6×44 | 292 (34.6%) | **148 px** |
| bass (1-bar) | 16 | 15 | 311 | 85.4% | **53 px** | 7×44 | 340 (40.3%) | **4 px** |
| chords (2-bar) | 32 | 15 | 567 | h-scrolls 203 px inside well | 7×44 | 340 (40.3%) | **52 px** |
| lead (1-bar, windowed) | 16 | 15 | 311 | 85.4% | **53 px** | 15×44 (window 7) | 336 (39.8%) | **8 px** |

### 360×800 (well 334, chrome 202 px = 25.3%)

| lane | fill | dead right | dead below (at scroll end) | page scrolls |
|---|---|---|---|---|
| drums | 323/334 = 96.6% | **11 px** | **104 px** | no (doc = 800) |
| bass | 311/334 = 93.1% | **23 px** | **2 px** | yes, 42 px |
| chords | 567 > 334 (internal) | — | **8 px** | no |
| lead | 311/334 = 93.1% | **23 px** | **2 px** | yes, 38 px |

### 430×932 (well 404, chrome 202 px = 21.7%)

| lane | fill | dead right | dead below | page scrolls |
|---|---|---|---|---|
| drums | 323/404 = 79.9% | **81 px** | **236 px** | no |
| bass | 311/404 = 76.9% | **93 px** | **140 px** | no |
| chords | 567 > 404 (internal) | — | **188 px** | no |
| lead | 311/404 = 76.9% | **93 px** | **144 px** | no |

Row heights: exactly 44 px everywhere (`PHONE_ROW_PX`, LaneGrid.tsx:215,
applied at renderer construction LaneGrid.tsx:769). "Dead below" = viewport
bottom − `.lane-floor` bottom after scrolling the page to its end — the
document ends mid-screen because the phone shell flows (`.app` phone
`height:auto; min-height:100dvh` app.css:355-358; `.stage` `flex:none`
app.css:360-362; `.stage-floors`/`.lane-floor` content-sized).

Label boxes (measured): drums 68 px (60 pin + 8 `padding-right`,
grid.css:211-233), pitched 56 px (48 + 8). Gap 1 px. The committed MB-1
arithmetic holds byte-exact: drums row = 68 + 16×15 + 15×1 = 323.

## 2. THE WIDTH-FILL LAW (phone-scoped; H-2 implements, H-4 gates)

**Statement.** On the phone stage only, the step-cell width is not a
constant but a function of the measured well:

```
labelBox  = first `.row-cells` left − `.lane-grid-scroll` left   (measured, DOM)
n         = pattern step count (bars × 16)
cellPx    = (well − labelBox − (n−1)·gapPx) / n      // exact fraction, unrounded
cellPx    = clamp(cellPx, 15, 24)                    // the committed clamp
stepWidth = cellPx + gapPx                            // float; gap stays pinned 1
```

**Pitch/gap handling.** The gap stays `NARROW_GEOMETRY.gapPx = 1`
(LaneGrid.tsx:200-214) — the fit adjusts ONLY `cellPx`, so `stepWidthPx`
stays a single float derived at one place (renderer.ts:521) and every
consumer in §4 keeps its exact shape.

**Fractional-px law (subpixel accumulation).** Write the exact fraction
into `gridTemplateColumns: repeat(n, <cellPx>px)` (both the eager template
renderer.ts:619 and the virtual pool :1280). CSS LayoutUnit quantizes each
track to 1/64 px, so the row-sum error is bounded by n/128 px ≤ 0.25 px at
n = 32 — inside every committed ±1 px gate (m1's
`scrollWidth ≤ clientWidth + 1`). The hit/run/playhead math is already
float (`pointerStepFloat` divides, renderer.ts:1820; runs multiply,
:1511/:1535; playhead transforms, :879/:2136), so no consumer needs
re-derivation. GATE NOTE for H-4: `getComputedStyle` may serialize used
track sizes rounded — assert on the inline style string or on measured
bounding boxes, never on computed track lists.

**The clamp.** FLOOR 15 = the committed readability floor
(`NARROW_GEOMETRY.cellPx`): if the raw value falls below 15 the pattern
genuinely cannot fit and the grid honestly h-scrolls inside the well —
**exactly today's law** (the demo's 2-bar chords: raw 8.66/7.72/9.91 < 15
→ stays 15, scrolls 203/233/163 px). CAP 24 = `FILL_MAX_ROW_PX`'s own
number (LaneGrid.tsx:285, the i3-1 committed growth ceiling): at the three
shipped viewports the cap never bites (max raw 20.81); it bounds cells on
500-767 px phones (still `stageMode()==="phone"`, selection.ts width law)
where uncapped cells would read 25-41 px wide against 44-64 px rows.

**Exact targets (the numbers H-2/H-4 gate against):**

| viewport | drums cell (68 label) | pitched cell (56 label) | row width after fill |
|---|---|---|---|
| 390×844 | **17.5625** | **18.3125** | 364 = well (100.0%) |
| 360×800 | **15.6875** | **16.4375** | 334 = well (100.0%) |
| 430×932 | **20.0625** | **20.8125** | 404 = well (100.0%) |
| 2-bar (n=32) | — | 8.66/7.72/9.91 < 15 → **15**, scrolls | 567 (unchanged) |

Growth vs today: +17% cells at 390 drums (15→17.56), +37% at 430
(15→20.06), +22% at 360 (15→16.44 on the tightest phone — the m1 1-bar
no-scroll property is preserved BY CONSTRUCTION because the fill is exact,
not ≤).

**Label-gutter decision (measured, decisive): NO condensation this
iteration.** True text floors measured by DOM Range: drums widest
"OPENHAT" = 47.61 px vs the 60 pin (12.4 slack); pitched widest "D#′" =
20.41 px vs the 48 pin (27.6 slack). Condensing pitched 48 → 32 would buy
16 px < 1 cell (+0.94 at 390: 18.31 → 19.31) at the cost of a new clipping
gate and a cross-lane visual law; drums 60 stays (the OPENHAT floor).
Because the law reads `labelBox` from the DOM, a future condensation
composes without touching this law — the option is recorded, not spent.

**2-bar/scrolling-pattern treatment (defined):** one law, no special case.
Patterns whose raw fit falls below the 15 floor keep the floor pitch and
scroll horizontally inside `.lane-grid-scroll` (today's committed
behavior, byte-identical); patterns at or above the floor fill exactly.
There is no "fill visible columns at a different pitch" mode — the window
and the pattern share one pitch.

## 3. THE BOTTOM-OWNERSHIP LAW + ROW-GROWTH CLAMP (H-3 implements)

**Statement.** The phone shell keeps flowing (`height:auto;
min-height:100dvh`, app.css:355-358 — the scrolling law is untouched), but
the stage chain grows into the shell remainder when the document is
SHORTER than the viewport: `.app[data-stage="phone"] .stage` flips
`flex:none` → grow (app.css:360-362 is the one flip site), and the chain
`.stage` → `.stage-floors-phone` (app.css:553-557) → `.lane-floor`
(LaneGrid.tsx:1275-1282) → `.lane-grid-scroll` (:1074-1082) carries the
height so the CARD bottom + recessed well land exactly at the viewport
bottom. When chrome + content EXCEED the viewport, `min-height` is inert,
the page scrolls exactly as today (m1's scrolling-stage law), and at
scroll-end the document bottom IS the viewport bottom — the grid still
ends at the screen bottom. The sticky chrome keeps its own law (<50%:
measured 23.9%/25.3%/21.7% at the three viewports; the M-5 one-viewport
windowed-page law and the M-3 centered transport are untouched — nothing
in the chrome changes).

**Row-growth clamp (the i3-1 phone twin).** Rows grow only into MEASURED
leftover, never shrink below 44 (`PHONE_ROW_PX`, the M-7 law), capped:

```
rowTrack = clamp(44, 44 + floor(leftover / visibleRows), 64)
leftover = stretched pane budget − pane content height (measured, write-free)
```

CAP = **64** (top of the plan's 56-64 band). Measured basis: uncapped
growth reads 61.3 (360 drums), 68.7 (390 drums), 83.3 (430 drums) — 83 px
rows against 20 px cells is beyond finger-comfort proportionality; 64
keeps a 6-row drums pane ≤ 384 px. What the clamp consumes, per leftover:
390 drums 120 of 148 (28 px residual recess inside the stretched card),
430 drums 120 of 236 (116 residual), 430 bass 140 of 140 (exact), 430
chords 140 of 188 (48 residual), 430 lead 144/15 = +9 → 53 px (cap inert),
360 bass/lead ~0 (already end within 2 px at scroll end). With cap 64 no
probed case newly scrolls (growth ≤ leftover in all 12 states). The M-7
share floors (≥30%/32%) are grow-only safe: drums pane share at 390 rises
34.6% → ~48.8%; H-4 re-derives the floors after H-3 lands. Alternative
56 recorded and rejected (390 drums residual 76 px vs 28 — the user's
complaint is dead space).

**Grid pane vs bottom, current state (the numbers H-3 kills):** dead
below at scroll end — drums 148/104/236, bass 4/2/140, chords 52/8/188,
lead 8/2/144 px (390/360/430).

## 4. Consumer map — the `stepWidthPx` seam, every anchor re-verified at HEAD

The width law needs ONE new seam (`setCellWidth(px)`, modeled on
`setRowHeight`, renderer.ts:883-902: idempotent, rewrites tracks live,
re-anchors the window). Everything it must touch:

**src/grid/renderer.ts**
- :447 — `private readonly stepWidthPx: number` — the field (loses
  `readonly`; the row twin `rowHeightPx` at :450 is the precedent).
- :517-523 — constructor derivation; :521 `stepWidthPx = cellPx + gapPx`;
  `cellPx` itself is `readonly` (:440) — the seam re-pins BOTH.
- :619 — eager `cellsEl.style.gridTemplateColumns = repeat(steps, cellPx)`
  (+ :623 `style.gap = gapPx`; :622 `gridAutoRows` is the vertical twin).
- :580 — virtual sizer width `playheadLeftPx + steps × stepWidthPx`.
- :690-691 — drums overlay fill anchor `left`/`--fill-left` = `labelPx`
  (label law, not step width — re-verify visually at the new pitch).
- :709 — playhead `left` = `playheadLeftPx` (label-anchored; its transform
  below is step-width math).
- :879-880 — `setPlayhead` transform `x − winStart × stepWidthPx`.
- :883-902 — `setRowHeight` — THE seam precedent.
- :1221-1236 — `visibleRange()` (`:1225` scrollLeft/stepWidth, `:1230`
  clientWidth derivation).
- :1244-1247 — `rewindowIfNeeded` (consumes visibleRange).
- :1280 — virtual pool `repeat(winCols, cellPx)` (≥4-bar patterns only).
- :1296 — virtual `data-beat` re-tag (eager twin :638) — beat paint is
  per-cell, width-agnostic.
- :1330-1335 — `ensureColVisible` scroll math (`:1332-1333`).
- :1351-1359 — `layout()` — the EXISTING resize hook a width fit calls.
- :1500-1523 — `renderRuns` reuse path (`:1511-1512` left/width,
  `:1523` layer transform `−winStart × stepWidthPx`).
- :1526-1536 — `buildRun` (`:1535-1536`).
- :1820 — `pointerStepFloat` (hit math, float division).
- :1974 — `cellAtPoint` (hit math).
- :2023 — `previewResize` live width write.
- :2136 — `playheadX` sweep basis.

**src/components/LaneGrid.tsx**
- :168-199 — the MB-1 comment (the 15px-law text H-4 rewrites).
- :200-214 — `NARROW_GEOMETRY` — SHARED by phone AND tablet (m5);
  H-2 forks by stage mode at the mount, NEVER retunes the preset.
- :215 — `PHONE_ROW_PX = 44`.
- :351-356 — `fitQuadrantRows` phone early-return (the width fit's
  phone twin lives beside this guard).
- :505-530 — `ensureFitObservers` (the ResizeObserver precedent H-2's
  phone-scoped width observer copies).
- :638-653 — `GridSurface.onMount` geometry pick (:651-653 mode → preset).
- :750-769 — renderer construction (:757-760 cellPx/gapPx/labelPx/
  fillRailPx; :769 phone `rowHeightPx`).
- :983-986 — phone surfaces never register (no budget fit today).
- :1074-1082 — the `.lane-grid-scroll` container element.
- :1254-1266 — remount key: stageMode + pattern shape, NOT container
  width — a within-phone width change (fold, devtools resize) does NOT
  remount → the width law needs the live re-fit seam.

**CSS**
- grid.css:23-33 — `.lane-floor` L/R padding 8 (content-width term).
- grid.css:101-123 — `.lane-grid-scroll` (the well; no own padding).
- grid.css:191-194 — `.lane-grid { width: max-content }` (the fill
  target's counterpart — exact-fill makes it == well).
- grid.css:211-233 — `.row-label` (padding-right 8 → labelBox = pin + 8).
- grid.css:336-339 — `data-beat` paint (per-cell, width-agnostic).
- grid.css:461-463 — phone `container-type: inline-size` (fill-rail cq).
- grid.css:471 — fill overlay clamp `calc(100cqw − --fill-left − …)`
  (re-verify at the new pitch: H-3).
- grid.css:507-521 — `fill-rails-open` reveal margins (re-check vs wider
  cells: H-3).
- app.css:11-14 — `.app` base flex column 100dvh.
- app.css:355-362 — phone shell flow + `.stage` `flex:none` — THE
  bottom-ownership flip site.
- app.css:553-557 — `.stage-floors` phone padding (the 2×4 term).
- chassis.css:126-134 — `.lane-floor` 1 px rim (the 2×1 term).

**App shell chain (for H-3's stretch):** App.tsx:96-133 `.phone-chrome`
(sticky group) / App.tsx:134-140 `main.stage` → StageFloor.tsx:205-222
`.stage-floors.stage-floors-phone` → LaneGrid.tsx:1275-1282 `.lane-floor`
→ LaneGrid.tsx:1074-1082 `.lane-grid-scroll`.

**Negative probes (no second baked width):** `render-fingerprint.test.ts`
has no phone viewport; `tests/golden/` pins documents/MIDI/WAV bytes, not
layout; `zz-shots.test.tsx:63-81` is the manual screenshot harness (writes
PNGs to `.impeccable/review/`, asserts no px); no help-registry entry
mentions cell px (entries are gesture/action text). The single
`stepWidthPx` derivation covers every width consumer — the plan's
reopen-assumption (1) holds.

## 5. Gate reconciliation list (H-4 executes; every pin re-verified)

| Pin (verified anchor) | Asserts today | Honest new law |
|---|---|---|
| mobile-viewport.test.ts:429-432 (m1) | 1-bar `scrollWidth ≤ clientWidth+1` | PRESERVED and strengthened — the fill is exact (row width == well), still no scroll. Wording may cite the fill law. |
| mobile-viewport.test.ts:434-446 (m1) | 2-bar scrolls inside grid; page never h-scrolls | UNCHANGED — floor-15 + internal scroll is the defined 2-bar treatment (§2). |
| mobile-viewport.test.ts:460-461 (m1) | `gridAutoRows === "44px"` exact | RETIRES as an exact pin → `≥44 && ≤64` (the §3 row-growth clamp; this test's state may read 44-64). |
| mobile-viewport.test.ts:463-466 (m1) | template splits to length 32 (count, not px) | UNAFFECTED — count assertion is width-agnostic. |
| mobile-viewport.test.ts:467-471 (m1) | labels never clip their gutter | UNCHANGED — labels stay 60/48 (§2 decision). |
| mobile-viewport.test.ts:569-578 (m1, 360 tight case) | 1-bar fits at 360; page ≤ W | PRESERVED — fill reads 15.69 at 360 drums, exact-fit still no scroll; the "label 60 + 16×17" comment updates to the law's number. |
| mobile-viewport.test.ts:617-647 (m5 tablet) | tablet 1-bar no internal scroll; tracks within [11,24] via the SHARED NARROW preset | BYTE-IDENTICAL REQUIRED — the fill must scope by `stageMode()==="phone"` (the fork point is LaneGrid.tsx:651-653 + the observer, not the preset). Track clamp [11,24] at tablet untouched. |
| viewport-utilization.test.ts:328-438 (M-7 describe) | grid share ≥30%/32% (390/360); every row ≥44; chrome <50% | Rows ≥44 stays (grow-only). Share floors RE-DERIVED upward after H-3 (drums 390: 34.6% → ~48%+); H-4 adds the width-fill + bottom-ownership asserts here with teeth. |
| target-size.test.tsx:21-25 (rationale) | "grid cells are data targets not buttons… measured and logged, never asserted ≥44" | EXEMPTION STAYS — it is about the gesture surface, not size; re-word: cells now ≥17.56 px wide at 390 (18.31 pitched). Journal, no law change. |
| target-size.test.tsx:602-648 (exempt audits) | cell + note-edge + tempo input recorded exempt | UNCHANGED mechanism; the logged geometry numbers grow with the fill (logged, not asserted). |
| LaneGrid.tsx:168-199 (comment) | the 15px 1-bar-fit law text | REWRITE to the §2 fill law (H-4). |
| grid.css:479 (comment) | "~15 px of slack" MB-1 overlay note | REWORD to the fill law's slack (0 by construction). |
| docs/dev/mobile-i4-audit.md | MB-1/MB-3 audit text pins 15px cells | Add an i5 delta note pointing here (H-4). |
| app.css:445-465 etc. (44px chrome text) | chrome target law | UNTOUCHED — chrome targets, not grid rows. |
| docs/dev/definition-of-done.md:116 | MB-6 scrollbar-steal note | UNTOUCHED (scrollbar convention, not geometry). |

## 6. Battery green at HEAD (statement for this docs-only change)

At HEAD 64f4a7f, fresh from scratch (this audit's own runs, journaled in
docs/ultron/production-log.md): `npm run build` (tsc --noEmit + vite)
green; `npm run lint` 0 problems; `npm run check:bundle` PASS at the
committed baseline; `npm test` (unit) 1726/1726 green. No source file was
modified by H-1 — `git diff` shows docs + journals only. (Full browser
battery + fuzz re-run belongs to H-5, per the plan.)

## 7. Hand-off contract to H-2/H-3 (summary)

1. `setCellWidth(px)` seam at renderer.ts (the :883-902 precedent):
   re-pin `cellPx`+`stepWidthPx`, rewrite eager :619 (and pool :1280)
   templates + sizer :580, re-render runs :1500-1536, re-derive window
   :1221-1247 — idempotent, rAF-coalesced.
2. GridSurface computes §2's formula at mount + on a phone-scoped
   ResizeObserver (`ensureFitObservers` precedent, :505-530); remount key
   does NOT cover width (:1254-1266).
3. Tablet/desktop byte-identical: fork by stage mode, never retune
   `NARROW_GEOMETRY` (m5 pins :617-647).
4. H-3: bottom ownership per §3 (the app.css:360-362 flip + the height
   chain), row clamp 44→64 grow-only, re-verify the fill overlay clamp
   (grid.css:471) and reveal margins (:507-521) at the new pitch.
5. H-4 gates: fill ≥95% (exact 100% expected), cell ≥17.56/18.31 at 390,
   1-bar no-scroll, 2-bar scrolls, lane-floor bottom == viewport bottom at
   scroll end; parse inline styles or measure boxes, not computed tracks
   (§2 fractional note); teeth = revert-to-15 → RED.
