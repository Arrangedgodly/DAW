# Accessibility audit (DA-2 — law of record; iteration-2 extensions §7)

Daredevil lens over every interactive surface. Sources of law: res-9 contrast
table (`docs/ultron/research/res-9-typography-a11y.md`), D9 glow/motion rules.
Ground = `#0d0b10`, ink = `#f5f2e9`. AA = 4.5:1 text, 3:1 UI/large.
Automated gate: `tests/browser/axe-a11y.test.tsx` (axe-core, devDependency —
never in the shipped bundle).

## 1. ARIA audit — role / name / state per surface

| Surface                                 | Role                                                        | Name                                                          | States                                                         | Verdict / DA-2 action                                                                                        |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Booth PLAY / LOOP / METRONOME           | native `button` + `aria-pressed`                            | visible text                                                  | `aria-pressed`                                                 | PASS                                                                                                         |
| Booth KEYS ?                            | `button` + `aria-haspopup="dialog"`                         | visible text                                                  | `aria-expanded` via help state                                 | PASS (dialog is aria-modal)                                                                                  |
| Booth TEMPO stepper                     | `group`; input `type=number`                                | per-button + input `aria-label`                               | value                                                          | PASS                                                                                                         |
| Booth SWING / MASTER sliders            | `input type=range`                                          | `aria-label`                                                  | `aria-valuetext` ("42 percent")                                | PASS                                                                                                         |
| Position LED + beat LEDs                | `aria-hidden` (visual only)                                 | —                                                             | sr live region announces "BAR n · BEAT n"                      | PASS (by design)                                                                                             |
| Scale chips (booth + 4 lanes)           | `button` + `aria-haspopup="dialog"`                         | `aria-label` carries effective scale                          | `aria-expanded`                                                | PASS                                                                                                         |
| Scale popover                           | `role="dialog"` `aria-modal="false"` + labeled groups       | "Scale selector"                                              | roots/modes `aria-pressed`; detach `aria-disabled`             | FIXED: mode list was `role=listbox`/`option` on `<button>`s (contradictory semantics) → plain toggle buttons |
| Lane header steppers (preset/kit, gate) | `group` + labeled buttons; value `aria-live=polite`         | per-control                                                   | value text live                                                | PASS                                                                                                         |
| Lane header roving strip                | one tab stop (rovingGroup), arrows inside                   | —                                                             | —                                                              | PASS (DA-1)                                                                                                  |
| FX entry                                | `button` + `aria-controls`                                  | `aria-label` includes device count                            | `aria-expanded`                                                | PASS                                                                                                         |
| FX strip                                | `list`/`listitem` labeled modules                           | module label + position + bypass in name                      | bypass `aria-pressed`; move buttons `disabled`                 | PASS                                                                                                         |
| FX sliders / selects                    | native range/select                                         | `aria-label` ("Cutoff of FILTER on BASS")                     | `aria-valuetext` unit-formatted                                | PASS                                                                                                         |
| FX add menu                             | `menu`/`menuitem` + `aria-expanded`                         | item labels                                                   | —                                                              | PASS                                                                                                         |
| Grids (all lanes)                       | `grid`/`row`/`rowheader`/`gridcell`                         | grid: "BASS grid"; cell: "C3 step 12"                         | `aria-selected` = on-state; sustain `data-sustain` visual only | FIXED: euclid fill rail lived bare inside `role=row` (aria-required-children) → slot is now `role=gridcell`  |
| Euclid fill control                     | `group` per row + labeled steppers; readouts `aria-live`    | "Euclidean fill for KICK"                                     | SET `disabled` when unarmed                                    | PASS (focus-reachable despite opacity gate, below)                                                           |
| Pattern rail tiles                      | `button` roving tabindex per row                            | full `aria-label` (slot, pattern, bars, cue, pending/playing) | `data-state` visual; text in name                              | PASS                                                                                                         |
| Rail tools / cue edit                   | buttons + `InlineEdit` text input                           | per-control labels                                            | RM `disabled` at min pool                                      | PASS                                                                                                         |
| Rail view toggle                        | `button` + `aria-pressed`                                   | visible text                                                  | —                                                              | PASS                                                                                                         |
| Projects popover                        | `role="dialog"` + labeled list/actions                      | "Projects"                                                    | current row `aria-current`                                     | PASS (focus trap + restore)                                                                                  |
| Toasts                                  | errors `role=alert` (assertive), info/success `role=status` | message text                                                  | dismiss/action real buttons                                    | FIXED: container `div` had a prohibited `aria-label` → removed                                               |
| Support banners                         | `role=alert`                                                | title/body; dismiss labeled                                   | Escape + button                                                | PASS                                                                                                         |
| Help overlay                            | `role="dialog"` `aria-modal="true"`                         | "Keyboard shortcuts"                                          | focus-trapped, Esc + CLOSE + restore                           | PASS                                                                                                         |
| Save indicator                          | `role="status"` `tabindex=0` (DA-2: was a bare div)         | `aria-label` = state + ABSOLUTE timestamp                     | fill/shape visual                                              | PASS — see announcements                                                                                     |
| Audio resume                            | `button`                                                    | visible text                                                  | —                                                              | PASS                                                                                                         |
| Empty-project hint                      | `role="note"`                                               | aria-label                                                    | —                                                              | PASS                                                                                                         |

## 2. Focus management

- **Initial focus on load (decision, documented):** no autofocus. Natural DOM
  order puts the booth PLAY button first, so the first Tab from the address
  bar lands on transport. A skip link is unnecessary at one screen with no
  nav preamble; revisit if a landing/marketing shell is ever added.
- **Focus order:** booth groups → pattern rail → lane headers → grid cells →
  per-lane roving cells (DA-1 map) — matches visual order; nothing reorders
  via positive `tabindex`.
- **Traps + restore:** ScalePopover (lane + project), Projects popover and
  the help overlay all trap Tab, land focus on first control/panel, and
  restore to the anchor on close (help via `state/helpOverlay` opener).
- **Opacity-only reveals audited:** the euclid fill rail is opacity-gated
  (`opacity:0` → 1 on row hover / `:focus-within`) but the buttons stay in
  the tab order and focusing reveals the control — nothing focusable is
  hidden behind opacity without a reveal path. Grid `data-preview` overlays
  are non-interactive decoration. No other CSS-gated controls exist.

## 3. Screen-reader announcements (current behavior)

| Event                          | Mechanism                                                                                                                                                                                                            | Status                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beat position while playing    | booth sr live region, "BAR n · BEAT n", on beat change only                                                                                                                                                          | EXISTS; grid keyboard nav does NOT announce position (documented decision: grid cells announce their own row/step names instead — per-cell labels carry position; adding a live echo would double-speak under roving focus) |
| Pending pattern switch         | per-lane rail `role=status` (`pendingAnnouncement` / `structurePendingAnnouncement`)                                                                                                                                 | VERIFIED (switch events via `subscribeSwitches`)                                                                                                                                                                            |
| Active pattern change          | same lane status region ("now A")                                                                                                                                                                                    | VERIFIED                                                                                                                                                                                                                    |
| Scale changes                  | booth + per-lane `role=status` announce (`announceScale`)                                                                                                                                                            | VERIFIED                                                                                                                                                                                                                    |
| Autosave state                 | SaveIndicator `role="status"`, focusable, label carries state + absolute timestamp; live text ticks deliberately aria-hidden so the 5 s relative-time refresh never spams SRs                                        | VERIFIED (inspectable on focus, not auto-spoken — documented)                                                                                                                                                               |
| Errors / info / success        | toasts `role=alert` / `role=status`                                                                                                                                                                                  | VERIFIED                                                                                                                                                                                                                    |
| Preset/gate/fill value changes | local `aria-live=polite` value spans                                                                                                                                                                                 | VERIFIED                                                                                                                                                                                                                    |
| Note-length resize (IN-2)      | per-grid local `aria-live=polite` span (`LENGTH <len> ST`), fired from BOTH the keyboard `+`/`-` path and the pointer edge-drag commit (E4/E5 parity; no aria-label on the live span — the DA-2 prohibited-attr law) | VERIFIED (drag-notes journey)                                                                                                                                                                                               |
| Multi-clip cue commit (IN-3)  | rail-level `role=status` summary (`QUEUED <n> LANES`), fired from BOTH the pointer sweep and the Shift+arrows range + Enter path through one commit funnel (E5); the per-lane pending announcements above ride the same engine events for both paths | VERIFIED (drag-cue journey, texts asserted EQUAL between paths) |

## 4. Motion audit (prefers-reduced-motion)

| Motion                                    | CSS gate                                          | matchMedia / render-loop gate                                                                      | Status                      |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------- |
| Playhead sweep                            | `.grid-playhead { display:none }` under reduce    | renderer `loop()` calls `setPlayhead(null)` when reduced — the rAF transform path is never written | VERIFIED (CSS + matchMedia) |
| Trigger glow (one-shot 180 ms)            | `animation:none` under reduce                     | renderer swaps `triggerGlow` → static `is-col-active` column highlight when reduced                | VERIFIED                    |
| PLAY first-run nudge pulse                | `animation:none` + static lit border under reduce | CSS-only (no rAF)                                                                                  | VERIFIED                    |
| FX add flash (one-shot 180 ms)            | `animation:none` under reduce                     | `handleAdd` checks `matchMedia` before arming the flash signal                                     | VERIFIED                    |
| Euclid fill hover reveal (opacity 120 ms) | FIXED (DA-2): `transition:none` under reduce      | n/a (state change, not continuous)                                                                 | FIXED                       |
| Booth transitions                         | blanket `transition:none` under reduce            | n/a                                                                                                | VERIFIED                    |
| Beat LEDs, save dot, pending tile hatch   | static by construction (no animation declared)    | n/a                                                                                                | VERIFIED                    |
| Infinite pulses                           | none exist anywhere (token law 4)                 | —                                                                                                  | VERIFIED                    |

## 5. Contrast — measured effective pairs (computed from the CSS actually applied; ground #0d0b10)

Ink-mix notation: `ink@X%` = `color-mix(ink X%, ground)`.

| Pair (selector → effective colors)                                                                                     | Ratio           | AA   | Action                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ink on ground (all primary text: buttons, values, labels, readouts)                                                    | 17.49:1         | PASS | —                                                                                                                                                                                                                                                                                           |
| ink@78% row labels                                                                                                     | 10.69:1         | PASS | —                                                                                                                                                                                                                                                                                           |
| ink@62% head-ctl-labels, projects-when, stage-hint (FIXED from 45%)                                                    | 7.00:1          | PASS | FIXED (hint was 4.15:1). DA-3 note: the DA-2 axe gate's page never loaded the token sheet, so it measured this pair against a white page (1.07:1 false negative elsewhere). The gate now imports `base.css`, so contrast pairs are computed from the real rendered palette; measured 6.98:1 |
| ink@60% booth labels, lane count                                                                                       | 6.61:1          | PASS | —                                                                                                                                                                                                                                                                                           |
| ink@55% dim-legends: fx-empty/cap, rail tile bars/cue-dash (FIXED from 30%), fill tag                                  | 5.70:1          | PASS | FIXED (cue dash was 2.46:1)                                                                                                                                                                                                                                                                 |
| rail tile bars on STATE tiles (selected/active/pending lane-hue fills) — full ink (FIXED in DA-3 from ink@55%)         | 8.5–12.7:1      | PASS | FIXED (ink@55% over the 18–28% lane-hue fills measured 3.12–4.14:1)                                                                                                                                                                                                                         |
| ink@55% bypassed fx module name (FIXED from 45%) + param labels (FIXED from 40%)                                       | 5.70:1          | PASS | FIXED (were 4.15 / 3.51)                                                                                                                                                                                                                                                                    |
| Disabled buttons: fx-mod-btn (0.35→0.55), rail-tool / fill-apply SET (0.4→0.55)                                        | 5.70:1          | PASS | FIXED (were 2.94–3.51; WCAG exempts disabled, we pass anyway)                                                                                                                                                                                                                               |
| ink-on-fill on full lane fills (on-cells, rail/booth active states)                                                    | 5.17–10.91:1    | PASS | —                                                                                                                                                                                                                                                                                           |
| FX bypass-lit button: near-black on lane fill (FIXED from 70% tint: drums was 3.02:1)                                  | 5.17–10.91:1    | PASS | FIXED (full `var(--lane-hue)` fill)                                                                                                                                                                                                                                                         |
| Toast sub-copy (ink@85%) / banner body (@90%)                                                                          | 12.63 / 14.14:1 | PASS | —                                                                                                                                                                                                                                                                                           |
| Save indicator error state (@55% opacity)                                                                              | 5.70:1          | PASS | —                                                                                                                                                                                                                                                                                           |
| Scale popover detach dimmed (@55%)                                                                                     | 5.70:1          | PASS | —                                                                                                                                                                                                                                                                                           |
| Focus indicator: 2px warm-white outline on every interactive (3:1 UI floor)                                            | 17.49:1         | PASS | —                                                                                                                                                                                                                                                                                           |
| Lane-hue borders/fills vs ground (SC 1.4.11)                                                                           | 5.17–10.91:1    | PASS | —                                                                                                                                                                                                                                                                                           |
| Help overlay fallback ink #e8e2d4 on ground                                                                            | 15.16:1         | PASS | —                                                                                                                                                                                                                                                                                           |
| Removed: dead `.head-fx` placeholder in lane-header.css (45% ink, 4.15:1, fully overridden by fx-strip.css but a trap) | —               | —    | REMOVED                                                                                                                                                                                                                                                                                     |

Glow is decoration-only everywhere (never the sole state signal; never counts
toward contrast) — re-verified per surface during this audit.

## 6. Automated gate

`tests/browser/axe-a11y.test.tsx` — `npm run test:browser` includes it. Runs
axe-core on the real mounted app in three states: main screen, booth scale
popover open, help overlay open. Asserts:

- zero **critical/serious** violations (any → hard fail), and
- moderates must be members of the accepted set below (a new moderate fails
  the test until triaged here).

Accepted moderates (deliberate for this UI, not defects):

| axe rule               | Why accepted                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page-has-heading-one` | Single-screen instrument panel; a visible `<h1>` has no designed place on the stage floor. Headings exist inside the help overlay (`h2`/`h3`).         |
| `banner-top-level`     | `<header>` (booth) sits inside `.app`, so it is not exposed as a landmark banner — with one screen and `main` present, that is the intended structure. |
| `region`               | Labeled sections/grids are deliberate content regions; wrapping each in a landmark would add navigation noise, not value.                              |

Findings the gate caught and that were fixed (kept here for the record):
`aria-required-children` on grid rows (fill rail → now a gridcell),
`aria-prohibited-attr` on the toasts container (aria-label removed).

## 7. Iteration-2 a11y gate extensions (IN-1 — the AGREED list)

The iteration-2 brief (town-hall §Iteration 2, Daredevil's claims) adds four
semantic surfaces: the quadrant selector, view-only quadrants, drag-created
notes / multi-clip cueing, and the info view. This section is the AGREED
extension list for the automated gate (AC "axe gate extension list agreed"):
each extension is a DoD item for its owning task — the task implements the
semantics AND lands the assertion. Until the owning task lands, the extension
is pending and the v0 gate (§6) is unchanged law. The keyboard equivalents
for everything here live in `docs/dev/keyboard.md` (v2) — pointer paths and
keyboard paths are both required (iteration-2 assumption).

**Status: E1/E2/E3 LANDED by LY-1** (asserted in
`tests/browser/quadrant-layout.test.ts` against the real built app at
1440×900: announcement text by key AND click, status-region contract,
no-tab-stop/no-trap structure, view-only strip operability incl. undo,
carry + clamp, name flips). **E4 LANDED by IN-2, plus E5's IN-2 half**
(asserted in `tests/browser/drag-notes.test.tsx`: cell names carry
`note starts, <len> steps` / `note continues`; keyboard place → resize ±1
and ±0.25 with clamps at 0.25/128 → remove, per-step announced value/name
text; the pointer edge-drag commit announces the SAME `LENGTH <len> ST`
text as the keyboard path). **E5 LANDED IN FULL — the multi-clip half by
IN-3** (asserted in `tests/browser/drag-cue.test.tsx`: the pointer cue
sweep and the Shift+arrows range + Enter CUE ALL path each run the gesture
on the real app; the per-lane `role=status` pending texts + the
`QUEUED <n> LANES` rail summary are captured per path and asserted EQUAL;
trusted-pointer parity in `tests/browser/drag-cue-trusted.test.tsx`).
**E6 LANDED by HP-1** (asserted in `tests/browser/help-mode.test.tsx` + the
axe gate's FOURTH mounted state in `tests/browser/axe-a11y.test.tsx`: the
info region is role=status / aria-live=polite / not focusable / never in the
tab order; focus-driven updates with zero pointer events change the region
text; Tab never lands on it; Escape exits the mode first with focus
unchanged — and the region-head pop applies only once the mode is off;
hover (pointerover) updates it too; toggling announces `INFO MODE ON …` /
`INFO MODE OFF` through the stage status region, which survives the mode
turning off; pointer pass-through and the mid-gesture toggle are pinned in
the behavior gate).

**E7 + HW-5 audit (2026-09-02):** E7's per-task review obligation is
discharged — every gesture of the iteration-2 feature set has its no-mouse
path pinned by a shipping gate (E1–E6 above + the keyboard.md v2 coverage
table), and the HW-5 M16 sweep audited the keyboard.md journey ledger
complete: each recorded v0-journey change (#1 LY-1, #2 IN-2, #3 IN-3/HP-1
additive bindings) is verified live in its named journey test, and no
unrecorded deliberate v0-journey change exists (IN-4/TH-4/HP-2/PS-1..4/
SC-1..2 all recorded no-journey-change; see keyboard.md §ledger). The
iteration-2 e2e (tests/browser/e2e-iteration2.test.ts) additionally walks
the quadrant-selection keyboard twin, the keyboard resize parity
(`LENGTH <n> ST` identical text), and the help-mode focus path end to end
on the REAL BUILT app.

| #   | Extension (semantics required)                                                                                                                                                                                                                                                                                                                                                             | Owning task | Gate assertion when it lands                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Selector announces edit-target changes.** One stage-level `role="status"` `aria-live="polite"` region speaks `NOW EDITING <LANE>` on every actual quadrant-selection change, from ANY input path (quadrant keys, click on a view-only quadrant, grid focus landing in another quadrant). Selection changes must never be color/silent-only.                                              | LY-1        | Browser journey: change selection by key AND by click → the live region's text changes to the new lane each time; axe on the quadrant layout: the status region exists, is labeled, and is not `aria-hidden`.                                                                                                                                                                                                                                   |
| E2  | **View-only quadrants are not focus traps.** View-only grids expose no tab stops and no focusable descendants; their CONTROL STRIPS stay tab-reachable and operable in all four quadrants; focus never rests inside a view-only grid at any instant (selection change under focus carries focus into the newly selected grid — the v0 carry law).                                          | LY-1        | Browser journey: (a) Tab walks booth → rail → every strip → the selected grid's cell and NEVER lands inside a view-only grid; (b) all four strips' controls are operable by keyboard while their grids are view-only; (c) selecting another quadrant while a grid cell is focused moves focus into the newly selected grid (carried + clamped). axe on the quadrant layout: zero critical/serious, moderates restricted to the §6 accepted set. |
| E3  | **Quadrant/grid names carry edit state in text.** `<LANE> grid · EDITING` / `<LANE> grid · VIEW ONLY` — never color alone (D9); playing view-only notes + playhead remain perceivable (grid roles stay; playhead stays aria-hidden visual).                                                                                                                                                | LY-1        | Axe/journey: accessible names of all four grids carry the state word; flipping selection flips the names.                                                                                                                                                                                                                                                                                                                                       |
| E4  | **Note-edit announcements (v2 note model).** Focused cell names carry note state (`note starts, <len> steps` / `note continues`); keyboard resize announces `LENGTH <len> ST` through a local `aria-live=polite` value span (the gate-stepper pattern); placement/removal ride the focused cell's name change + audition law.                                                              | IN-2        | Browser journey: keyboard-place → resize by keys (±1 and ±0.25, clamps at 0.25/128) → remove; per step the announced value/name text is asserted; the same edits driven by pointer drag announce identically.                                                                                                                                                                                                                                   |
| E5  | **Drag-equivalent announcements.** Every state change a pointer drag can produce announces the SAME text when driven by keyboard — no announcement may depend on pointer-only events. Multi-clip cueing: per-lane rail `role=status` pending announcements fire per touched lane plus one `QUEUED <n> LANES` summary, identical for the drag sweep and the Shift+arrow range + Enter path. | IN-2 / IN-3 | Browser journeys: the drag path and the keyboard path each run the gesture; the announcement texts (live-region contents per step) are asserted EQUAL between paths; quantized landing semantics reuses the IM-7 observable pending state (existing rail assertions).                                                                                                                                                                           |
| E6  | **Info-view aria-live region semantics.** The info region is `role="status"` `aria-live="polite"`, NOT focusable, NOT in the tab order (cannot trap); updates on keyboard FOCUS of any registered control (not just hover); toggling announces `INFO MODE ON …` / `INFO MODE OFF`; while ON, Escape exits the mode first (cancel-first) without moving focus.                              | HP-1        | The axe gate gains a FOURTH mounted state — help mode ON — asserted clean (zero critical/serious; moderates still restricted to the §6 accepted set); browser journey: focus-driven updates (no pointer events) speak via the live region; Tab never lands on the info region; Escape exits with focus unchanged.                                                                                                                               |
| E7  | **Keyboard-coverage contract.** Every new gesture has a no-mouse path — reviewed against the spec table `docs/dev/keyboard.md` §"Coverage review" (shipped by IN-1 with the full table). New gestures during production must add a row (or a binding) before shipping.                                                                                                                     | IN-1 (this) | Per-task review: LY-1/IN-2/IN-3/HP-1 journeys exercise the keyboard paths named in the coverage table (E1–E6 above are those journeys' a11y assertions); HW-5 audits the ledger is complete.                                                                                                                                                                                                                                                    |

Contrast/motion carry-over for the new surfaces (law applies now, asserted
with each task): quadrant EDITING/VIEW ONLY state = fill + border + text,
glow decoration-only (D9); view-only quadrants dim toward the ground but
keep every text pair ≥ AA (5.70:1 dim-legend precedent); the info region and
its text obey the toast/banner contrast pairs; no new motion — quadrant
selection changes state discretely (no transition), and any indicator
animation would need the reduced-motion gate (§4 law).

The gate file itself (`tests/browser/axe-a11y.test.tsx`) is EXTENDED, not
forked: owning tasks add mounted states/journeys per the table above; the
§6 accepted-moderates law (a new moderate fails until triaged HERE) applies
to the new states unchanged.

## 8. Mobile extension (MB-3 — phone target law + tap laws; m2/m3)

The town-hall mobile addendum extends two WCAG lines to the phone stage
(<768, the sticky-chrome + scrolling-grid law): **m2** — primary controls'
targets ≥44×44 in BOTH dimensions (WCAG 2.5.5), measured as HIT boxes; and
**m3** — no hover-only functionality: help mode becomes tap-to-inspect.
Gates: `tests/browser/target-size.test.tsx` (the audit), `tests/browser/
help-touch.test.tsx` (trusted CDP touch), the axe gate's phone states, and
the help-coverage phone pass.

### 8.1 The two world-respecting sizing routes (DESIGN.md law: sizes may
grow via hit-area padding, never via visual restyle)

| Route | Where | Mechanism |
| ----- | ----- | -------- |
| **Painted ≥44** | Everything in the SCROLLING stage + overlays (strip steppers/mix chips/FX/FILL, euclid overlay, rail tiles/append/PAT, popovers, FX console, projects, toasts, banners, KEYS close, audio-resume, switcher tabs, rail inline edits) | The control's own box grows (`min-height`/`min-width` 44) — bigger chassis, same print; rows wrap, the stage scrolls (layout answers layout) |
| **Hit strap** | The PINNED chrome's booth (compact painted, `::before` strap `inset: -8px 0` over a ≥28px painted box; 16px row gaps = two straps meeting at the midpoint — adjacent hit boxes touch, never overlap) + sliders there (inputs carry no pseudo elements: `height: 44px` with `margin-block: -8px` reclaiming the row) | Painting the whole booth at 44 measurably busts MB-1's hard chrome budget (<50% of viewport at 360×800); the strap keeps the compact booth AND honest targets |

The audit measures HIT boxes behaviorally (`elementFromPoint`): the
contiguous hit region around each control's center must reach ≥44 on both
axes, and all four corners of the centered 44×44 rect must resolve to the
control — a neighbor's hit box encroaching fails the corner probes (the
"adjacent hit boxes must not overlap" law, enforced, not assumed).

### 8.2 Target matrix (the audit inventory; gate selectors in target-size.test.tsx)

| Surface (phone stage) | Controls | Route |
| -------------------- | -------- | ----- |
| Booth transport | PLAY / LOOP / METRONOME / KEYS ? / INFO ? / PROJECTS | strap (painted ≥44 wide) |
| Booth tempo | − / + steppers | painted 44 wide + strap |
| Booth scale chip | chip button | strap |
| Booth sliders | SWING / MASTER | input-height 44 (track/thumb painted unchanged) |
| Lane switcher | 4 tabs | painted 44 |
| Condensed rail | tiles / append + / PAT trigger / PAT menu items / inline edits | painted 44 |
| Lane strip | preset/kit ±, VOLUME, MUTE, SOLO, scale chip, GATE ±, FX, FILL | painted 44 |
| Euclid overlay | steppers ×4, SET | painted 44 (overlay sizes to content, floats over cells) |
| FX console | CLOSE, bypass/move/remove, + ADD FX, add items, param sliders/selects | painted 44 / input-height 44 |
| Popovers | projects rows + actions, scale roots/modes/commit/detach | painted 44 (scale popover widened so 6 roots ≥44) |
| Failure chrome | toast action/dismiss, banner dismiss, audio-resume, KEYS close | painted 44 |

### 8.3 Recorded exemptions (measured + logged by the audit, never asserted ≥44)

- **Grid cells + note-edge zones** — data targets / pointer gesture
  affordances, not buttons (the plan's own law; editing obeys the gesture
  laws with the keyboard twin on the focused cell).
- **Booth TEMPO number input** — WCAG 2.5.5 "equivalent" exception: the
  flanking − / + steppers (both ≥44 hit) are the equivalent adjustment
  controls; the input exists for direct entry.
- **Save indicator** — role=status, focusable for inspection, not operable
  (no action); target size applies to controls.
- **Position LED / beat LEDs** — non-interactive readouts (hidden at phone
  width by the MB-3 condensation; SR BAR/BEAT announcements continue).
- **Tablet (768–1024)** — the AC pins the 44 law to the two phone
  viewports; the tablet keeps the scaled quadrant stage (entry-4 one-page
  fit) with its compact controls. The M17 review owns that boundary.

### 8.4 Tap laws (m3 — no hover-only functionality)

- **Help mode tap-to-inspect (the recorded tap model):** a tap on a
  registered control BOTH activates it (pass-through, HP-1's law) AND shows
  its entry in the info region — observe-only `click` listener mounted only
  while the mode is on; "inspect without activating" was rejected (it would
  block editing and contradict the no-trap decision). Entry persists until
  the next focus/hover/tap on a registered control; identical re-sets are
  no-ops (no re-announcement). On touch the ENTRY and EXIT affordance is the
  tappable INFO ? button (no `i` key on glass); the hint reads
  "TAP INFO ? TO EXIT" on the phone stage.
- **Euclid reveal** — the FILL strip toggle (MB-2), not hover.
- **Tooltips/labels** — every hover-titled control has a visible-at-touch
  equivalent: the rail cue dash renders the label text itself (the inline
  editor is the touch path); state text lives in aria-labels + names.
- **Announcements at phone width** — NOW EDITING (mobile-viewport gate),
  pending/QUEUED cues (touch-gestures gate), info-region updates
  (help-touch gate) all verified at 390/360 widths.
- **Focus order at phone** — no positive tabindex anywhere; tab order is
  top-to-bottom visual order (booth → switcher → rail → strip → grid);
  rotation (portrait↔landscape, phone↔tablet) never strands focus
  (target-size gate).
