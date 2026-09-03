# Accessibility audit (DA-2 — law of record)

Daredevil lens over every interactive surface. Sources of law: res-9 contrast
table (`docs/ultron/research/res-9-typography-a11y.md`), D9 glow/motion rules.
Ground = `#0d0b10`, ink = `#f5f2e9`. AA = 4.5:1 text, 3:1 UI/large.
Automated gate: `tests/browser/axe-a11y.test.tsx` (axe-core, devDependency —
never in the shipped bundle).

## 1. ARIA audit — role / name / state per surface

| Surface | Role | Name | States | Verdict / DA-2 action |
|---|---|---|---|---|
| Booth PLAY / LOOP / METRONOME | native `button` + `aria-pressed` | visible text | `aria-pressed` | PASS |
| Booth KEYS ? | `button` + `aria-haspopup="dialog"` | visible text | `aria-expanded` via help state | PASS (dialog is aria-modal) |
| Booth TEMPO stepper | `group`; input `type=number` | per-button + input `aria-label` | value | PASS |
| Booth SWING / MASTER sliders | `input type=range` | `aria-label` | `aria-valuetext` ("42 percent") | PASS |
| Position LED + beat LEDs | `aria-hidden` (visual only) | — | sr live region announces "BAR n · BEAT n" | PASS (by design) |
| Scale chips (booth + 4 lanes) | `button` + `aria-haspopup="dialog"` | `aria-label` carries effective scale | `aria-expanded` | PASS |
| Scale popover | `role="dialog"` `aria-modal="false"` + labeled groups | "Scale selector" | roots/modes `aria-pressed`; detach `aria-disabled` | FIXED: mode list was `role=listbox`/`option` on `<button>`s (contradictory semantics) → plain toggle buttons |
| Lane header steppers (preset/kit, gate) | `group` + labeled buttons; value `aria-live=polite` | per-control | value text live | PASS |
| Lane header roving strip | one tab stop (rovingGroup), arrows inside | — | — | PASS (DA-1) |
| FX entry | `button` + `aria-controls` | `aria-label` includes device count | `aria-expanded` | PASS |
| FX strip | `list`/`listitem` labeled modules | module label + position + bypass in name | bypass `aria-pressed`; move buttons `disabled` | PASS |
| FX sliders / selects | native range/select | `aria-label` ("Cutoff of FILTER on BASS") | `aria-valuetext` unit-formatted | PASS |
| FX add menu | `menu`/`menuitem` + `aria-expanded` | item labels | — | PASS |
| Grids (all lanes) | `grid`/`row`/`rowheader`/`gridcell` | grid: "BASS grid"; cell: "C3 step 12" | `aria-selected` = on-state; sustain `data-sustain` visual only | FIXED: euclid fill rail lived bare inside `role=row` (aria-required-children) → slot is now `role=gridcell` |
| Euclid fill control | `group` per row + labeled steppers; readouts `aria-live` | "Euclidean fill for KICK" | SET `disabled` when unarmed | PASS (focus-reachable despite opacity gate, below) |
| Pattern rail tiles | `button` roving tabindex per row | full `aria-label` (slot, pattern, bars, cue, pending/playing) | `data-state` visual; text in name | PASS |
| Rail tools / cue edit | buttons + `InlineEdit` text input | per-control labels | RM `disabled` at min pool | PASS |
| Rail view toggle | `button` + `aria-pressed` | visible text | — | PASS |
| Projects popover | `role="dialog"` + labeled list/actions | "Projects" | current row `aria-current` | PASS (focus trap + restore) |
| Toasts | errors `role=alert` (assertive), info/success `role=status` | message text | dismiss/action real buttons | FIXED: container `div` had a prohibited `aria-label` → removed |
| Support banners | `role=alert` | title/body; dismiss labeled | Escape + button | PASS |
| Help overlay | `role="dialog"` `aria-modal="true"` | "Keyboard shortcuts" | focus-trapped, Esc + CLOSE + restore | PASS |
| Save indicator | `role="status"` `tabindex=0` (DA-2: was a bare div) | `aria-label` = state + ABSOLUTE timestamp | fill/shape visual | PASS — see announcements |
| Audio resume | `button` | visible text | — | PASS |
| Empty-project hint | `role="note"` | aria-label | — | PASS |

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

| Event | Mechanism | Status |
|---|---|---|
| Beat position while playing | booth sr live region, "BAR n · BEAT n", on beat change only | EXISTS; grid keyboard nav does NOT announce position (documented decision: grid cells announce their own row/step names instead — per-cell labels carry position; adding a live echo would double-speak under roving focus) |
| Pending pattern switch | per-lane rail `role=status` (`pendingAnnouncement` / `structurePendingAnnouncement`) | VERIFIED (switch events via `subscribeSwitches`) |
| Active pattern change | same lane status region ("now A") | VERIFIED |
| Scale changes | booth + per-lane `role=status` announce (`announceScale`) | VERIFIED |
| Autosave state | SaveIndicator `role="status"`, focusable, label carries state + absolute timestamp; live text ticks deliberately aria-hidden so the 5 s relative-time refresh never spams SRs | VERIFIED (inspectable on focus, not auto-spoken — documented) |
| Errors / info / success | toasts `role=alert` / `role=status` | VERIFIED |
| Preset/gate/fill value changes | local `aria-live=polite` value spans | VERIFIED |

## 4. Motion audit (prefers-reduced-motion)

| Motion | CSS gate | matchMedia / render-loop gate | Status |
|---|---|---|---|
| Playhead sweep | `.grid-playhead { display:none }` under reduce | renderer `loop()` calls `setPlayhead(null)` when reduced — the rAF transform path is never written | VERIFIED (CSS + matchMedia) |
| Trigger glow (one-shot 180 ms) | `animation:none` under reduce | renderer swaps `triggerGlow` → static `is-col-active` column highlight when reduced | VERIFIED |
| PLAY first-run nudge pulse | `animation:none` + static lit border under reduce | CSS-only (no rAF) | VERIFIED |
| FX add flash (one-shot 180 ms) | `animation:none` under reduce | `handleAdd` checks `matchMedia` before arming the flash signal | VERIFIED |
| Euclid fill hover reveal (opacity 120 ms) | FIXED (DA-2): `transition:none` under reduce | n/a (state change, not continuous) | FIXED |
| Booth transitions | blanket `transition:none` under reduce | n/a | VERIFIED |
| Beat LEDs, save dot, pending tile hatch | static by construction (no animation declared) | n/a | VERIFIED |
| Infinite pulses | none exist anywhere (token law 4) | — | VERIFIED |

## 5. Contrast — measured effective pairs (computed from the CSS actually applied; ground #0d0b10)

Ink-mix notation: `ink@X%` = `color-mix(ink X%, ground)`.

| Pair (selector → effective colors) | Ratio | AA | Action |
|---|---|---|---|
| ink on ground (all primary text: buttons, values, labels, readouts) | 17.49:1 | PASS | — |
| ink@78% row labels | 10.69:1 | PASS | — |
| ink@62% head-ctl-labels, projects-when, stage-hint (FIXED from 45%) | 7.00:1 | PASS | FIXED (hint was 4.15:1). DA-3 note: the DA-2 axe gate's page never loaded the token sheet, so it measured this pair against a white page (1.07:1 false negative elsewhere). The gate now imports `base.css`, so contrast pairs are computed from the real rendered palette; measured 6.98:1 |
| ink@60% booth labels, lane count | 6.61:1 | PASS | — |
| ink@55% dim-legends: fx-empty/cap, rail tile bars/cue-dash (FIXED from 30%), fill tag | 5.70:1 | PASS | FIXED (cue dash was 2.46:1) |
| rail tile bars on STATE tiles (selected/active/pending lane-hue fills) — full ink (FIXED in DA-3 from ink@55%) | 8.5–12.7:1 | PASS | FIXED (ink@55% over the 18–28% lane-hue fills measured 3.12–4.14:1) |
| ink@55% bypassed fx module name (FIXED from 45%) + param labels (FIXED from 40%) | 5.70:1 | PASS | FIXED (were 4.15 / 3.51) |
| Disabled buttons: fx-mod-btn (0.35→0.55), rail-tool / fill-apply SET (0.4→0.55) | 5.70:1 | PASS | FIXED (were 2.94–3.51; WCAG exempts disabled, we pass anyway) |
| ink-on-fill on full lane fills (on-cells, rail/booth active states) | 5.17–10.91:1 | PASS | — |
| FX bypass-lit button: near-black on lane fill (FIXED from 70% tint: drums was 3.02:1) | 5.17–10.91:1 | PASS | FIXED (full `var(--lane-hue)` fill) |
| Toast sub-copy (ink@85%) / banner body (@90%) | 12.63 / 14.14:1 | PASS | — |
| Save indicator error state (@55% opacity) | 5.70:1 | PASS | — |
| Scale popover detach dimmed (@55%) | 5.70:1 | PASS | — |
| Focus indicator: 2px warm-white outline on every interactive (3:1 UI floor) | 17.49:1 | PASS | — |
| Lane-hue borders/fills vs ground (SC 1.4.11) | 5.17–10.91:1 | PASS | — |
| Help overlay fallback ink #e8e2d4 on ground | 15.16:1 | PASS | — |
| Removed: dead `.head-fx` placeholder in lane-header.css (45% ink, 4.15:1, fully overridden by fx-strip.css but a trap) | — | — | REMOVED |

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

| axe rule | Why accepted |
|---|---|
| `page-has-heading-one` | Single-screen instrument panel; a visible `<h1>` has no designed place on the stage floor. Headings exist inside the help overlay (`h2`/`h3`). |
| `banner-top-level` | `<header>` (booth) sits inside `.app`, so it is not exposed as a landmark banner — with one screen and `main` present, that is the intended structure. |
| `region` | Labeled sections/grids are deliberate content regions; wrapping each in a landmark would add navigation noise, not value. |

Findings the gate caught and that were fixed (kept here for the record):
`aria-required-children` on grid rows (fill rail → now a gridcell),
`aria-prohibited-attr` on the toasts container (aria-label removed).
