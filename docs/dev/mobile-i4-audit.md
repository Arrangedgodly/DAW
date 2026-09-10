# Mobile i4 audit — M-1 (iteration 4)

Produced 2026-09-10 at HEAD (unit battery 1726/1726 green, no source change).
Map of every phone-stage surface and gate iteration 4 touches. Each row:
current behavior → i4 disposition (restage / remove / restyle / untouched) →
consuming task. Contract items (C1..C5) reference the brief as recorded in
`docs/ultron/state.md` §"NEW CYCLE — mobile UI rework (iteration 4)".

## 1. Phone chrome / stage split

| Anchor | Current behavior | Disposition | Task |
|---|---|---|---|
| `src/App.tsx:92-129` | `stageMode() === "phone"` split: `<div class="phone-chrome">` groups `<Booth/>` + `<LaneSwitcher/>` + `<PatternRail/>` as ONE sticky group; `.stage` (StageFloor) scrolls under it in the flowing document. `fallback` branch = desktop/tablet shell, byte-identical law (m4). `data-stage` attr on `.app` (App.tsx:58-63) drives all phone CSS. | Keep the split; chrome CONTENTS change (thinned Booth, pinned transport, OPTIONS affordance). Fallback branch untouched. | M-2..M-4, M-7 |
| `src/state/selection.ts:77-113` | `stageMode()` — ONE signal; `phone` = width < 768 OR (width < 1024 AND height < 600, rotated phones); reactive on matchMedia, drives `data-stage`. | Untouched. | — |
| `src/styles/app.css:347-353` | Phone law: `.app[data-stage="phone"] { height:auto; min-height:100dvh }` — page scrolls; one-page law is desktop-only. | Untouched (the scrolling law stays; transport pins instead). | M-3 |
| `src/styles/app.css:368-384` | `.phone-chrome` sticky group: `position:sticky; top:0; z-index:10`, opaque ground, one shadow; booth demoted to `position:static`. | The sticky primitive M-3's transport rides. | M-3, M-4 |
| `src/styles/app.css:386-465` | Booth condensation: 16px strap rows, 8px padding, hit-strap `::before inset:-8px 0` (app.css:427-441), `booth-step-btn` min-width 46 (447-450), `booth-led-input` width 44 (452-465). | Restyle per M-7 budget after M-2 thins and M-4 drawer-izes most groups. | M-7 |
| `src/styles/app.css:466-480` | `booth-range` sliders: 64px wide, 44px hit via own height, `margin-block:-6px`. | Move with swing/master into the M-4 drawer (same CSS applies if drawer keeps `.phone-chrome` ancestor; re-scope if not). | M-4 |
| `src/styles/app.css:483-494` | Position readout condensation: LED readout + beat LEDs `display:none` at phone; group reduces to SaveIndicator + PROJECTS. | Likely moves to drawer (readout) — M-4 decides; currently an existing precedent for phone-only CSS hiding. | M-4 |
| `src/styles/app.css:496-500` | `.stage-floors` single-lane stage at phone (`display:block`, full width). | Untouched except M-7 height budget. | M-7 |
| `src/styles/app.css:509-592` | `.lane-switcher` + `.lane-switch-tab`: phone-only primary lane control, 44px painted tabs, lane-hue active law. | Untouched (stays in chrome). | — |
| `src/styles/app.css:594-597` | `.audio-resume` 44px at phone. | Untouched. | — |
| `src/styles/app.css:605-624` | Touch law globals: `touch-action:manipulation` on buttons/selects, `none` on ranges. | Untouched; new drawer/shift buttons inherit automatically. | — |
| `src/components/StageFloor.tsx:75` | `LaneSwitcher` export — phone-only tab strip rendered inside the chrome. | Untouched. | — |
| `src/components/PatternRail.tsx:1268-1278` | Condensed phone rail: only the ACTIVE lane's row renders (`stageMode() === "phone" ? [activeLane()] : RAIL_ROWS`). | Untouched. | — |

## 2. KEYS / INFO buttons (contract C1)

| Anchor | Current behavior | Disposition | Task |
|---|---|---|---|
| `src/components/Booth.tsx:267-277` | `booth-btn-help` "KEYS ?" — `data-help="booth.keys"`, `aria-haspopup="dialog"`, `openHelp(currentTarget)` (helpOverlay seam; KEYS modal z-90 stays live per VZ-DD-1). | REMOVE from phone stage via RENDER GUARD (prop from `stageMode()`, e.g. `compact` — same pattern as `covered`), so it leaves the a11y tree per the VZ-DD-1 inert law. Desktop/tablet byte-identical. | M-2 |
| `src/components/Booth.tsx:278-289` | `booth-btn-info` "INFO ?" — `data-help="booth.info"`, `toggleHelp` (helpMode signal). | Same render guard. | M-2 |
| `src/components/Booth.tsx:64-72` | Help-registry entries `booth.keys` / `booth.info`. | STAY (desktop keeps the buttons). | M-2 |
| `src/components/KeyboardShortcuts.tsx` (`?` line ~131, `I`, `v` ~178) | Keyboard twins remain functional with an attached keyboard. | Untouched (removal is of BUTTONS, not shortcuts). | — |
| `src/components/Booth.tsx:290-306` | `booth-btn-viz` "VIZ" — third corner button, `data-help="booth.viz"`, `openViz`. | Not named by C1 but is the third chrome button the audit surfaces — candidate for the drawer (displaced tool) or removal per M-4's "similar tools" clause. Decision recorded in M-4. | M-4 |

Negative probes: no other element carries `data-help="booth.keys"`/`"booth.info"`; no other `booth-btn-help/info` consumers; `grep 'phone-chrome'` shows no other component reads the class; the only `data-stage="phone"` CSS blocks are app.css:347-620 and grid.css/lane-header phone presets below.

## 3. Transport (play/stop) placement today (contract C2)

- `src/components/Booth.tsx:233-249` — `booth-btn booth-btn-play` renders as the FIRST control of the Playback group inside the Booth header; on phone the whole Booth sits inside the sticky `.phone-chrome`, so PLAY is visible but (a) NOT horizontally centered (left-aligned first flex child of a wrapped group), and (b) its visibility depends on the chrome's height budget, not a pinned invariant.
- Gesture unlock rides `handleTogglePlay` (Booth.tsx:196-198, firstRun nudge consume) and the session's trusted-touch unlock (m1 gate). Aria/pressed/state machine all local to this button — reuse, do not duplicate.

## 4. Candidate drawer tools (contract C3)

All currently render in the Booth header on every stage:

| Tool | Anchor | Store/engine seam |
|---|---|---|
| LOOP | Booth.tsx:250-260 | `session.setLoop(!loopOn())` |
| METRONOME | Booth.tsx:261-266 | local signal + `setTransport({metronome})` |
| TEMPO stepper + input | Booth.tsx:311-349 | `setTransport({bpm})`, `clampBpmUi` |
| SCALE chip + ScalePopover | Booth.tsx:352-395 | `setProjectScale`/`setLaneScaleOverride` via popover |
| SWING slider | Booth.tsx:398-422 | `setTransport({swing})` via `swingPercentToAmount` |
| MASTER slider | Booth.tsx:424-445 | `session.setMasterVolume(volumePercentToGain(v))` |
| VIZ toggle | Booth.tsx:290-306 | `openViz` (vizMode) — audit-surfaced "similar tool" |
| Position readout + SaveIndicator + Projects | Booth.tsx:447-508 | rAF DOM mutation; readouts already hidden at phone (app.css:483-494) |

All are self-contained handlers on local signals — the drawer can mount the SAME JSX groups unchanged (M-4's "reuse components + store actions" law). Collapsed = zero DOM: the `Show` law precedent is helpOverlay/vizMode (App.tsx:107-117).

## 5. Register-window machinery (contracts C4/C5)

- `src/state/selection.ts:193-271` — the RC-1 seam: `registerWindowStarts` signal map (`PitchedLaneId → start`), `registerWindowStart()`, `setRegisterWindowStart()` (dedupes equal writes), `defaultRegisterWindowStart()` (most-noted-rows heuristic), `getOrCreateRegisterWindow()`, reset on `onDocumentReplaced` (selection.ts:265-267). View-only, never undo, never a document field.
- `src/components/LaneGrid.tsx:643-672` — **the key seam for M-5**: `const windowed = pitched && mode !== "phone"` (line 654). On phone, pitched grids currently render the FULL manifest (`rendererRef.setWindow(null)`, line 661) — the committed m1 page-scroll law. M-5 flips this: at phone, `windowed = true` with `windowHeight = modeSize(scale mode)` (the one-octave default), NO desktop surplus growth (app css `applyRegisterWindow` + the fill at LaneGrid.tsx:333 already early-returns `if (stageMode() === "phone") return;` — the phone fill never grows windows, exactly the pinned-default M-5 wants).
- `src/components/LaneGrid.tsx:993-1013` — the reactive consumer: `createEffect` reads `registerWindowStarts()[lane]` and calls `rendererRef.scrollWindowTo(start)`; undefined start re-derives via `getOrCreateRegisterWindow`. **A phone shift button only needs `setRegisterWindowStart(lane, clamp(start ± 12 / ± 1))`** — the effect pushes it to the renderer; same seam as desktop Shift+arrow (LaneGrid.tsx:920 writes from the renderer's wheel/scroll echo; KeyboardShortcuts' Shift+↑/↓ path drives focus-move which windows-follow).
- Clamping: the renderer clamps against the grid's own manifest rows (`scrollWindowTo` snap guard, LaneGrid.tsx:995-997 comment); M-5's buttons must also clamp eagerly for the disabled-at-bounds AC — read `rowLabels.length` reach via `renderer` or recompute from the pattern's `rowDegrees` like `defaultRegisterWindowStart` does (max rows across the lane's patterns).
- Geometry: `NARROW_GEOMETRY[lane]` preset chosen at mount keyed on stage mode (LaneGrid.tsx:628-633); mode transitions remount — M-5's change rides the existing remount law.
- Row labels: `pitchedLabels()` (LaneGrid.tsx:641-645) already render per-window visible rows — M-6's re-anchor feedback reads these; add a window-position chip/cue in the same effect that consumes `registerWindowStarts`.

## 6. Mobile gate battery today

| Gate file | Asserts today | i4 impact |
|---|---|---|
| `tests/browser/mobile-viewport.test.ts` | m1–m4 laws: 390×844 + 360×800 lane-switcher-is-selection, sticky chrome, scrolling grid, usable-grid budget; tablet/desktop boundaries; rotation re-budget. | M-3 (transport pin changes chrome), M-7 (utilization expectations). |
| `tests/browser/mobile-resilience.test.tsx` (m1–m5) | first-touch unlock (PLAY is a probe target — Booth.tsx:237 selector must stay valid), rotation, visibility, LOOP law, touch-cancel edges. | M-3/M-4 selectors; PLAY probe retargets to the pinned transport. |
| `tests/browser/mobile-touch-trusted.test.tsx` | trusted CDP touch on cells/rail/fx at phone. | Mostly untouched; drawer controls need trusted-touch coverage if added. |
| `tests/browser/target-size.test.tsx` (MB-3, :414+) | walks EVERY phone chrome control for ≥44×44 hit boxes (strap probe), focus order, rotation. | M-2 (fewer buttons), M-4 (drawer controls must pass while open), M-7 (zero sub-44). |
| `tests/browser/viewport-utilization.test.ts` | desktop 1280/1440/1920 fill law. | M-7 must add/extend a phone-stage share assertion; audit records baseline: current phone chrome ≈ booth condensation comment (app.css:386-411) pins booth+chrome under 50% of 800px at 360 (7 strap rows ≈ 291px booth ≈ 405px chrome measured in MB-3) — M-7 records the live number and asserts grid-share ≥ baseline. |
| `tests/browser/help-touch.test.tsx` | tap-to-inspect at phone (data-help walk). | M-2: must not require phone KEYS/INFO buttons; inspect targets move to drawer controls. |
| `tests/browser/help-coverage.test.tsx` (:452-585) | phone-width coverage walk incl. fx strip, projects popover, tools menu. | M-8 reconciles: coverage must not demand removed phone KEYS/INFO. |
| `tests/browser/pointer-edge-states*.test.tsx` | desktop edge states + MB-4 touch edge states at phone. | M-5 shift buttons need edge-state parity if interactive cells law applies (they're plain buttons — likely exempt). |

New gates needed (M-8 formalizes; verified ad hoc in-task): `mobile-transport` (M-3: visible at scroll-top AND scroll-bottom at 390×844 + 360×800, center-x ±8px, ≥44px), `mobile-register-window` (M-5: exact one-octave row count, ±12/±1 deltas, clamp/disabled at bounds, no out-of-window rows), M-6 feedback gate (label text changes within one frame + cue; absent under reduced motion), M-7 utilization/target assertion folded into `viewport-utilization`/`target-size`.

## 7. Centered transport — recommended mechanism

**Extend the phone chrome, not a second sticky bar.** Evidence:

1. The sticky primitive already exists and is gated (`.phone-chrome` app.css:368-384; m1/m4 assert the sticky chrome). A second `position:sticky` bar would stack a second shadow/z-index layer and re-open the chrome-height budget the MB-3 gate watches.
2. VZ-DD-1 inert law rides the chrome wrapper (`App.tsx:101-105` `inert={vizMode()}`) — a transport inside `.phone-chrome` inherits VIZ coverage for free; a sibling bar would need its own inert wiring.
3. The transport button itself is already stage-agnostic (Booth.tsx:233-249); M-3 can render a phone-only pinned row (Booth restructure or a small `<PhoneTransport/>` inside the chrome) that reuses `handleTogglePlay` + the `booth-btn-play` class and its registry entry — one source of truth, desktop branch untouched.
4. Centering: the pinned row is a single flex row (`justify-content:center`) — trivially satisfies the ±8px center-x AC at both 390 and 360 widths.

Mechanics for M-3: add the pinned transport row as the LAST child of `.phone-chrome` (below rail, always within the sticky group), render-guarded by `stageMode() === "phone"`; the Booth keeps its play button in the `fallback` branch only at phone via the same `compact` prop family M-2 introduces (or the Booth's play button IS the pinned one, lifted out of the flow — M-3's owner picks; either way one handler, one help entry).

## 8. Baselines recorded for M-7

- Phone chrome budget law (from MB-3 measurements, app.css:386-411): booth ≤ ~291px, total chrome < 50% of 800px at 360 width. M-7 records the live measured grid-area share at 390×844 and 360×800 at its own HEAD-parent and asserts ≥ baseline post-rework.
- Bundle baseline: 90.20 KB gz (state.md); ≤ +1 KB gz expected for drawer + shift controls (plan M-8).

## 9. Validation

`npm test` at audit HEAD: **1726/1726 green (86 files)**. No source files changed.
