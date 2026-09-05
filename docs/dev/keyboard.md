# Keyboard Interaction Spec (v3 — KL-1)

The complete keyboard map for Bitbounce. Contract sources: ARIA APG grid
pattern (res-1 — roving tabindex, arrow navigation, grid roles) and the
a11y rules of res-9/D9 (focus-visible styles, never color/glow alone).
Law: **every edit action is reachable from the keyboard alone** (Daredevil).
Iteration-2 law (town-hall assumption, I2-*): **pointer drags NEVER replace
keyboard paths — both are required.** Every gesture IN-2/IN-3 build for the
pointer has a key-for-key equivalent in this spec, and every state change a
drag can produce is announced identically when driven by keyboard
(drag-equivalent announcements, docs/dev/accessibility.md §7). The
iteration-3 carry (town-hall I3-*): every NEW surface — OCT transpose,
register window scroll, pattern resize, the changed rail `+` — has the same
key-for-key law (§ v3 delta at the bottom).

**Version status.** v2 extends the shipped v0 map (DA-1/DA-3) for the
iteration-2 quadrant layout and note model. Sections marked
**[v2 · live since LY-1]** are IMPLEMENTED and gated (LY-1 landed the
quadrant selector, strips, announcements, and focus-carry law — asserted in
tests/browser/quadrant-layout.test.ts + the updated DA-1/DA-3 journeys).
Sections marked **[v2 · live since IN-2]** are IMPLEMENTED and gated (IN-2
landed drag-create/edge-drag/drums-paint + the keyboard note law — asserted
in tests/browser/drag-notes.test.tsx + the unit gate
tests/note-interaction.test.ts). Sections marked **[v2 · live since IN-3]**
are IMPLEMENTED and gated (IN-3 landed the rail multi-clip range + CUE ALL
and the pointer cue sweep through the same funnel — asserted in
tests/browser/drag-cue.test.tsx + the unit gates tests/pattern-rail.test.ts
and tests/quantized-switch.test.ts). Sections marked **[v2 · live since
HP-1]** are IMPLEMENTED and gated (HP-1 landed the info view: the booth
INFO ? toggle, the global `i` key, focus-driven info updates, and
Escape-exits-first — asserted in tests/browser/help-mode.test.tsx + the axe
gate's fourth mounted state). Everything else is live law today. v0 sections
that v2 supersedes say so
inline and the deliberate v0-journey changes are recorded in the ledger at
the bottom (regression rule: journey updates only
alongside deliberate UX changes).

**v3 (KL-1, iteration 3 — SPEC; BC-1's slice is LIVE).** The §"v3 delta"
at the bottom of this file extends the v2 map for the iteration-3 surfaces
(town-hall §Iteration 3, decisions I3-a..f; schema v3 landed by SV-1:
powers-of-two pattern vocabulary 1..128, per-pitched-lane `octave` −3..+3,
`loopBars` retired behind the engine-side compat derivation). Sections
marked **[v3 · spec — lands with BC-1/RC-1/LL-1/LL-2]** are the CONTRACT
those tasks implement and gate; until a task lands, the v2 law above stays
the shipping behavior — EXCEPT the rail `+` change (I3-a), which is
**[v3 · live since BC-1]** (§"Rail `+` = new blank clip" below). The v3
supersessions of v2/v0 text are marked inline
(the v2 precedent), and the deliberate v2-journey changes are recorded in
the v2 → v3 ledger inside the delta — the rail-`+` semantics change (I3-a)
is THE one deliberate journey change iteration 3 plans (the plan's
regression rule names it).

## Focus model — regions and tab stops

The screen is a stack of composite regions. Each composite region exposes
**exactly one Tab stop** (roving tabindex, APG); Tab walks region to region,
arrows walk _inside_ a region:

| Region                            | Tab stops                                                                                                                                                                   | Arrows inside                                                                                      | Since                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Booth (transport)                 | native controls (documented linear strip)                                                                                                                                   | native (ranges, steppers are buttons)                                                              | v0                                      |
| Booth INFO "?" toggle (help mode) | native button                                                                                                                                                               | native                                                                                             | v2 · live since HP-1                    |
| Pattern rail — tiles, per lane    | 1 (focused tile)                                                                                                                                                            | ←/→ along the chain, Enter triggers; Shift+arrows extend a multi-clip range [v2 · live since IN-3] | v0 + v2                                 |
| Pattern rail — tools, per lane    | 1 (the row's PAT trigger) + the tools inside its popover while open (native buttons) [v2 · live since refinement-6]                                                         | native                                                                                             | v0 → refinement-6                       |
| Quadrant control strip, per lane  | native controls (preset/kit stepper, VOLUME range, MUTE, SOLO) — **all four quadrants' strips stay tab-reachable even when their grid is view-only** [v2 · live since LY-1] | native                                                                                             | v2 → LY-1                               |
| Lane grid, **selected quadrant**  | 1 (focused cell)                                                                                                                                                            | the grid map below                                                                                 | v0                                      |
| Lane grid, **view-only quadrant** | **none** — no tab stop, no focusable descendant (not a focus trap) [v2 · live since LY-1]                                                                                   | n/a (view only)                                                                                    | v2 → LY-1                               |
| Info region (help mode on)        | **none** — role=status, never focusable, never in the tab order [v2 · live since HP-1]                                                                                      | n/a                                                                                                | v2 · live since HP-1                    |
| Help overlay (keyboard shortcuts) | 1 (dialog, focus-trapped)                                                                                                                                                   | native inside                                                                                      | v0 — unchanged, SEPARATE from info mode |

- **Roving seed**: first item of each region is the Tab stop until the user
  moves; moving roving updates `tabIndex` only (never reorders DOM).
- **Escape pops to the region head**: in a lane grid, Escape moves focus to
  the quadrant strip's first control (the strip is the grid region's head);
  in the rail, Escape focuses the rail head (view toggle). Inside popovers
  and inline edits, Escape cancels first (existing DES-3/DES-6 behavior).
  **While help mode is ON, Escape first exits help mode** (cancel-first,
  like popovers); the region-head pop applies only when it is already off
  [v2 · live since HP-1]. **While an FX console is open, page-level Escape
  closes it** — after the KEYS modal, help mode, and any open inline edit /
  popover / menu (each of those consumes its own keystroke first), and
  before the region-head pops [v2 · live since refinement-1].
- Focus rings follow D9: `:focus-visible` outlines in the lane hue over the
  ground, never glow-only.

## Quadrant selection [v2 · live since LY-1] — selection IS the lane selector

The 2×2 quadrant layout (I2-1): one quadrant per lane, quadrant selection =
`selection.activeLane` (ephemeral signal, never document). The selected
quadrant's grid is editable; the other three render view-only with live
notes + playhead.

| Key                                       | Action                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PageDown / PageUp                         | select next / previous quadrant (order drums → bass → chords → lead = visual reading order; clamped, never wraps) |
| Ctrl+↓ / Ctrl+↑                           | same as PageDown / PageUp (v0 alternates, kept)                                                                   |
| `]` / `[`                                 | same, and ALSO inside quadrant control strips (see scope rule below)                                              |
| Click on any part of a view-only quadrant | pointer path: selects that quadrant (mouse parity; grid or strip)                                                 |

- **Key scope rule.** PageUp/PageDown and Ctrl+↑/↓ fire only from a focused
  grid cell (the v0 lane-move scope — they are grid keys). On quadrant
  control strips they are NOT intercepted (native range paging stays native;
  we never hijack native control keys). `[` / `]` have no native meaning on
  any control, so they select quadrants from BOTH the grid and the strips —
  this is the keyboard escape hatch from "focus is on a view-only lane's
  VOLUME, now I want to edit its grid": press `]`/`[` until that quadrant is
  selected, focus lands in its grid.
- **Announcement law (a11y gate E1).** Every actual quadrant-selection
  change — by keys, by click, by grid focus landing in another quadrant —
  announces through ONE stage-level `role="status"` `aria-live="polite"`
  region: `NOW EDITING <LANE>` (e.g. "NOW EDITING BASS"). Selection changes
  must be announced; view-only states never speak on their own.
- **Focus movement law.** Selecting a quadrant never moves focus by itself
  EXCEPT when focus currently rests inside a grid that is becoming view-only
  — then focus is CARRIED into the newly selected quadrant's grid at the
  same row index + step, clamped to the target grid's rows/pattern length
  (the v0 `carryCellTo` law, verbatim). When focus is on a control strip,
  the booth, the rail, or an overlay, selection changes leave focus exactly
  where it is (a mid-tweak is never yanked) — the announcement carries the
  change instead. Focus must never rest inside a view-only grid at any
  instant.
- **Tab model.** View-only quadrant grids expose no tab stops and no
  focusable descendants — a view-only quadrant is never a focus trap (a11y
  gate E2). Their control strips remain fully tab-reachable and operable
  ("always operable" — tweak any lane without switching). Grid accessible
  names carry the state in text: `<LANE> grid · EDITING` / `<LANE> grid ·
VIEW ONLY` (never color alone — D9).
- **Quadrant mix controls** (new, LY-1): VOLUME = native `input
type=range` with `aria-valuetext` (free arrow-key a11y, DES-5 precedent);
  MUTE / SOLO = real buttons with `aria-pressed`. Solo changes also announce
  through the stage status region (solo changes OTHER lanes' audibility —
  the muted-by-solo state must be speakable: `SOLO <LANE>` / `SOLO OFF`).

## Phone lane switcher [v2 · live since MB-1] — the quadrant selector at phone width

At phone stage width (MB-1, town-hall mobile addendum) the 2×2 quadrants do
not render — the stage shows ONE lane, and the LANE SWITCHER (a `tablist`
in the sticky chrome: booth + switcher + condensed rail pinned) IS the
quadrant selection. It drives the SAME `selection.activeLane` signal with
the SAME laws — announcement (`NOW EDITING <LANE>` through the stage status
region), and the grid quadrant-selection keys keep working unchanged from
the grid (there is exactly one grid, always the EDITING one).

| Key                        | Action                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| Tab (into the switcher)    | one stop — the ACTIVE lane's tab (roving tabindex)                        |
| ArrowRight / ArrowLeft     | select next/previous lane (drums → bass → chords → lead; clamped, no wrap) + focus follows |
| Home / End                 | select the first / last lane                                              |
| Enter / Space / click      | select the focused tab                                                    |

- **Focus movement law on the switcher.** Arrow selection moves focus to
  the newly selected TAB (the tabs convention — automatic activation). This
  is the one surface where selection moves focus alongside the
  announcement: the switcher is itself the selector, so the focused tab and
  the selected lane can never disagree. Selecting by click leaves focus on
  the clicked tab (native), and selection changes from ANY other path
  (grid keys, rail) leave switcher focus exactly where it is — the active
  tab (re-styled, still focused) carries the change.
- **Grid keys unchanged.** PageUp/PageDown, Ctrl+↑/↓ from the grid, and
  `]`/`[` from the strips select lanes exactly as on the quadrant stage;
  the grid remounts as the newly selected lane (phone stages render one
  lane at a time — the focus-carry law's remount twin).

## Grid map (inside the selected quadrant's grid, on a focused cell)

Pure math lives in `src/grid/keynav.ts`; bounds clamp (no wrap — see
"Wrap rules"). Rows = drum pieces (drums) or scale degrees (pitched).

| Key                            | Action                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ← / →                          | move one step (clamp at row ends)                                                                                                                                                         |
| ↑ / ↓                          | move one row (clamp at top/bottom row)                                                                                                                                                    |
| Home / End                     | first / last step of the current row                                                                                                                                                      |
| PageDown / PageUp              | **v2: select next / previous quadrant** (v0: lane move — superseded; see ledger)                                                                                                          |
| Ctrl+↓ / Ctrl+↑ (or `]` / `[`) | **v2: select next / previous quadrant** (v0: lane move — superseded; see ledger)                                                                                                          |
| Ctrl+→ / Ctrl+← (or `.` / `,`) | beat jump: ±4 steps (one 4/4 beat), clamped                                                                                                                                               |
| Enter / Space                  | toggle — drums: hit on/off; pitched: the note law below                                                                                                                                   |
| Shift+Enter                    | audition the focused cell WITHOUT toggling (v0 law, kept)                                                                                                                                 |
| `+` / `=` and `-` / `_`        | **[v2 · live since IN-2]** pitched only: resize the focused note ±1 step                                                                                                                  |
| Shift+`+` / Shift+`-`          | **[v2 · live since IN-2]** pitched only: resize the focused note ±0.25 step (the snap-law floor)                                                                                          |
| Delete / Backspace             | **[v2 · live since IN-2]** pitched only: remove the focused note (grid-region-local; the rail's Delete removes a chain slot in its own region — same key, different region, v0 precedent) |

Quadrant selection keeps the carried row _index_ and step (clamped to the
target grid's row count and pattern length); drums rows map by position,
pitched rows by position into that lane's own degree rows (v0 carry law).

## Note editing on the v2 note model [v2 · live since IN-2]

Schema v2 (SC-1/SC-2): pitched notes are `{degree, start, length}`; length
lives on the 0.25-step grid, clamped [0.25, 128] (`MIN/MAX_NOTE_LENGTH`);
single click = the lane's effective gate default (I2-3, backward compatible);
drums stay one-shot row-steps (I2-4 — no length keys on drums; `+`/`-`/
Delete there do nothing).

- **Focused note.** On the focused row: the note whose span covers the
  focused step (`start ≤ step < start + length`). Anchor wins first (a note
  starting exactly where you stand beats one merely spanning it); otherwise
  the latest-starting note still sounding (deterministic; overlaps are legal
  per schema).
- **Enter / Space (toggle law, v0-compatible):**
  - empty cell (no covering note) → **place** a note at (row, step) with the
    lane's gate-default length; audition fires on placement (v0 law);
  - at a note's anchor → **remove** that note (toggle-off, v0 law);
  - mid-span (covered, not the anchor) → **trim** the focused note to end at
    the focused step (`length = step − start + 1`; the keyboard equivalent
    of dragging the note's right edge to the focused column). No-op when the
    note already ends here; always undoable.
- **Resize.** `+`/`-` = ±1 step; Shift = ±0.25. Each press calls the store's
  `resizeNote` (snap 0.25, clamp to bounds — at 0.25 a `-` does nothing; at
  128 a `+` does nothing; lengths never wrap). Held-key repeats are ONE undo
  gesture (`note:<lane>:<pattern>` coalescing family, SC-2). **Keyboard
  resize is discrete commits, not a held preview** — unlike the pointer's
  zero-store-write preview + commit-on-release (landed), each keypress is its
  own (coalesced) commit; recording this asymmetry as deliberate: keys are
  discrete, drags are continuous.
- **No re-audition on resize** (pitch unchanged; re-triggering per step
  would machine-gun). Audition law stays: placement auditions, Shift+Enter
  auditions anything.
- **Announcements (a11y gate E4).** The focused cell's accessible name
  carries note state in text — anchor: `<row> step <n>, note starts, <len>
steps`; spanned: `note continues`; empty: v0 name. Resize steps announce
  through a local `aria-live=polite` value span: `LENGTH <len> ST` (the
  gate-stepper value-announce pattern). Placement/removal are carried by the
  focused cell's own name change + audition.

## Rail multi-clip cue selection [v2 · live since IN-3]

v0 rail law unchanged: ←/→ rove tiles, Enter/Space trigger a quantized
switch on the focused tile, Delete/Backspace removes the slot, F2 renames,
`l` edits the cue, `+` appends. **[v3 · live since BC-1: the ACTION behind
rail `+` changes — it creates a NEW blank next-letter pattern instead of
re-appending the selected one (I3-a); see §v3 delta "Rail `+` = new blank
clip".]** The multi-clip drag (one gesture across N
clips queues exactly those N, identical pending/quantized semantics as
clicking individually — one queued switch per touched lane) gets this
keyboard path (LIVE: the pointer sweep and this range commit share one
funnel; plain ↑/↓ rove between lane rows at the carried slot; an unmoved
pointer press keeps the native click law — the rail captures only once a
sweep extends):

| Key                 | Action                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shift+← / Shift+→   | extend a selection RANGE along the focused lane row (anchor = where the shift began)                                                                                                            |
| Shift+↑ / Shift+↓   | extend the range to the same slot position (carried, clamped to each row's length) in the adjacent lane row(s)                                                                                  |
| plain ← / → / ↑ / ↓ | still rove focus and COLLAPSE the range to the focused tile (cancel-extend)                                                                                                                     |
| Escape              | collapse the range to the focused tile (no chain edit happened)                                                                                                                                 |
| Enter / Space       | **CUE ALL**: commit the range — for every lane row the range touches (top→bottom), fire `requestPatternSwitch` on that row's tile at the range's focus-edge column, clamped to the row's length |

- The commit path IS the individual-click path (`requestPatternSwitch` per
  lane; IM-7's same-lane supersede law makes one-switch-per-lane exact);
  pending indicators appear per lane exactly as for clicks and land
  quantized on boundaries.
- **Announcements (a11y gate E5).** The existing per-lane rail
  `role=status` pending announcements fire per touched lane, plus one
  summary line in the rail status region: `QUEUED <n> LANES`. The pointer
  drag announces the SAME text — no announcement may depend on pointer-only
  events.
- No wrap: the range clamps at the first/last lane row and at each row's
  first/last slot (carry-clamp law).

## Pattern ops (global, when not typing in a text field) — unchanged v0

| Key | Action                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `n` | new 1-bar pattern in the active lane (selects it for editing)                                                                                                                                                                        |
| `d` | duplicate the active lane's selected pattern (selects it)                                                                                                                                                                            |
| `r` | rename — moves focus to the active lane's rail REN control (opening the row's PAT menu when it is closed; the inline field takes over from there; Enter commits, Esc cancels per DES-6) [refinement-6: REN lives in the PAT popover] |
| `i` | **[v2 · live since HP-1]** toggle help mode (info view) — same guards as `n`/`d`/`r` (never in text entries, never with an assistive-tech modifier)                                                                                  |

Rail-local keys (DES-6, unchanged): ←/→ rove tiles, Enter/Space trigger a
quantized switch, Delete/Backspace removes the chain slot, F2 renames, `l`
edits the cue, `+` appends a slot. **[v3 · live since BC-1: `+` now appends
a slot holding a NEW blank next-letter pattern — the key, the button, and
the announcement all change meaning together (I3-a); DUP (`d` + the PAT
menu) becomes the ONLY duplication path. See §v3 delta.]**

## Transport — unchanged v0

| Key           | Action                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space         | play/stop — **only when focus is not on an interactive element** (body/document level). Inside a grid, Space toggles the cell instead (APG grid law); on a focused button it activates the button natively. |
| Enter on PLAY | play/stop (native button activation in the booth)                                                                                                                                                           |

Rationale: a global Space would hijack buttons and the grid; the booth PLAY
button plus body-level Space cover both "just started" and "deep in the
grid" contexts without conflict.

## Undo — unchanged v0

| Key                         | Action                                            |
| --------------------------- | ------------------------------------------------- |
| Ctrl+Z (⌘Z)                 | undo (zundo, limit 50, coalesced gestures — IM-6) |
| Ctrl+Shift+Z (⌘⇧Z) / Ctrl+Y | redo                                              |

Skipped while typing in a text entry (inline rename/cue fields, the tempo
input) so native text undo is preserved. Note-edit gestures coalesce per
`note:<lane>:<pattern>` (SC-2) — a held resize or one drag = one undo step.

## Euclid fill (PX-3, when a fill control is focused) — unchanged v0

Arrows on the steppers adjust pulses/rotation natively (real buttons);
Enter on SET commits the painted row; Escape cancels the preview. No
additional bindings — the fill controls are plain focusable buttons.

**MB-2 (mobile slice) — the narrow-stage reveal.** On phone + tablet the
fill rails are the MB-1 OVERLAY (hover reveals nothing on touch), so the
drums strip carries a `FILL` toggle (edit row, next to FX — drums lane,
narrow stages ONLY; desktop keeps the inline hover/focus rail byte-identical,
m4): Tab + Enter shows every row's rail over its pads; the same toggle or a
grid Escape hides them. The steppers were ALWAYS tab stops — focusing one
still reveals its row (`:focus-within`), so keyboard reachability is
unchanged by construction. Escape order gain (one consumer per keystroke):
with the rails shown, a grid Escape closes them BEFORE the FX console
cover and the region-head pop (the rails are the innermost row-local
surface).

## Help mode (info view) [v2 · live since HP-1; MB-3 adds the touch tap model]

Ableton-style info view (I2-6), SEPARATE from the keyboard-shortcut overlay
above, which stays unchanged. Architecture: the help REGISTRY is colocated
with the components (src/help/registry.ts + registrations in each component
— no central help file); the info region is src/components/InfoView.tsx,
mounted only while the mode is on (zero cost when off — perf-budget.md §8).

| Key / control                | Action                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| booth "?" INFO button        | toggle help mode (real button, Tab + Enter — the mouse-parity path; on touch, the TAP path — see the tap model below)                                            |
| `i`                          | toggle help mode from anywhere (guards: not in text entries, no AT modifiers held)                                                                               |
| Tab / arrows (while ON)      | normal navigation — focus any registered control; the info region updates on FOCUS, not just hover (the Daredevil law: help mode must respond to keyboard focus) |
| TAP (while ON) [MB-3, m3]    | touch twin of hover: tapping a registered control shows its entry AND activates the control (pass-through — the recorded tap model); entry persists until the next registered focus/hover/tap |
| Escape (while ON)            | exit help mode (cancel-first; focus stays where it was — nothing was trapped)                                                                                    |
| `i` or the button (while ON) | exit help mode; announcement `INFO MODE OFF` (on touch the tappable INFO ? button is the exit — the phone hint reads "TAP INFO ? TO EXIT")                       |

- **The MB-3 tap model (mobile addendum m3, recorded):** a tap BOTH inspects
  and activates. "Inspect without activating" was rejected — it would
  contradict HP-1's recorded pass-through decision (every control stays
  operable while the mode is on) and put the mode in the way of editing;
  the Ableton-on-touch precedent is read-tap-and-still-play. The observer is
  an observe-only `click` listener mounted only while the mode is on
  (desktop hover behavior unchanged; identical re-sets are no-ops so a
  mouse click after its own hover never re-announces).
- **No trap, no modal:** help mode is a mode, not an overlay — every control
  stays reachable and operable; the info region itself is `role="status"`
  `aria-live="polite"`, NOT focusable, NOT in the tab order (a non-interactive
  status region cannot trap anything; pointer pass-through onto the stage is
  HP-1's recorded production decision).
- **Announcements (a11y gate E6):** toggling announces `INFO MODE ON —
  FOCUS OR TAP A CONTROL TO HEAR WHAT IT DOES` / `INFO MODE OFF`; each focused
  registered control's help text is spoken (and shown) once per focus move —
  no repetition while focus rests.
- Toggling help mode mid-gesture must not corrupt an active drag (gesture
  completes or cancels cleanly — verified by IN-4).
- Zero per-frame cost while OFF (Thor, TH-4 c): listeners attach only while
  the mode is on.

## FX console (open overlay) [v2 · live since refinement-1]

The per-lane FX console overlay (DES-5/LY-1) is a NON-MODAL surface: every
other region stays reachable while it is open. Refinement-1 (critique P1-1,
the pointer-trap fix) added the exits it lacked — the console used to be
closable only by clicking another quadrant:

| Key / control                | Action                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Escape (anywhere)            | closes the console (see the Escape order below) — focus stays where it was                                                 |
| Escape (on a covered grid)   | closes the console INSTEAD of popping to the region head — focus stays on the cell; the pop applies on the NEXT Escape     |
| console CLOSE button         | pointer twin (title strip, on the chassis — never under it); focus lands on the strip's FX entry, the control that owns it |
| strip FX entry (Tab + Enter) | toggle (unchanged v0 path; un-occluded again — the chassis starts below the whole control strip)                           |

- **Escape order on this surface** (one consumer per keystroke): KEYS modal
  → help mode (cancel-first, HP-1) → inline edits / popovers / menus (the
  add menu's own Escape, the scale popover, the projects panel — each
  consumes via stopPropagation) → **the narrow-stage fill-rails reveal
  closes (MB-2, drums, only while shown)** → **the FX console closes** →
  region-head pops. Pinned end-to-end by help-mode.test.tsx §6 (mode →
  menu → console on one surface) and fx-console-trusted.test.tsx.
- **Focus law on close.** Focus never moves unless closing would strand it:
  it stays put when Escape fires from outside the console; it lands on the
  strip's FX entry when focus rested INSIDE the console (CLOSE button or
  Escape from a console control); it stays on the grid cell when the
  covered-grid Escape closes the console (the grid is revealed, not left).
- The LY-1 quadrant law is unchanged: the console closes automatically the
  instant its quadrant goes view-only (LaneHeader's focus law), and only
  the selected quadrant can open it.
- State is page-level (`src/state/fxConsole.ts`) — an ephemeral signal,
  never document, never undo history.

## Deliberate exclusions (never hijacked) — unchanged v0

These browser / screen-reader keys are NEVER intercepted anywhere:

- Tab / Shift+Tab — region traversal (only tabindex roving, never swallowed)
- the screen-reader virtual-cursor pass-through keys (quick-nav keys,
  browse-mode letter navigation) — letter shortcuts (`n`, `d`, `r`, `i`, `?`,
  `l`; v3 adds `o`, `b`, `p`) only fire on real keydown targets that are NOT
  text-entry elements, and are skipped whenever an assistive-tech modifier
  is held; ARIA grid roles keep the SR cursor in application mode inside
  grids
- Ctrl/Cmd+C, V, X, A, F, L, T, W, R — clipboard/browser shortcuts untouched
- F1–F12 except F2 (rename, DES-6 — standard grid rename key per APG)
- browser zoom (Ctrl+/-/0), devtools (F12, Ctrl+Shift+I/J/C)
- Insert, PrintScreen, CapsLock state, IME composition events

## Wrap rules

No wrapping anywhere: arrows, Home/End, beat jumps, quadrant selection,
range extension, and note-length edits all clamp at their bounds. The
playhead wraps (the loop), but focus never does — a wrapped cursor a
screen-reader user cannot predict is worse than a hard edge. PageUp at the
first quadrant stays there; Ctrl+→ at the last beat stays; `-` at length
0.25 stays; Shift+↑ at the top lane row stays. **[v3 amendment, recorded:
the row-arrows' clamp domain grows from the VISIBLE rows to the full row
MANIFEST (the register window follows focus — §v3 delta "Register window
scroll"); the no-wrap law itself is unchanged — clamp-at-hard-edge still
governs every axis, and the window-scroll keys add two more clamped axes
(manifest bounds + the focus-anchor law).]**

## Coverage review (AC: no keyboard path missing for any new gesture)

Every gesture iteration 2 introduces, reviewed against this spec — the table
IN-1 ships as the no-missing-path proof; owning tasks implement + test the
path as DoD:

| New gesture (pointer/world)                                | Keyboard path (this spec)                                                                                          | Owning task |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| Select a quadrant by clicking it                           | PageUp/PageDown, Ctrl+↑/↓ (grids), `]`/`[` (grids + strips)                                                        | LY-1        |
| Tweak any lane's preset/VOLUME/MUTE/SOLO without selecting | all four strips stay tab-reachable; native range/button keys                                                       | LY-1        |
| View-only quadrants show live notes/playhead               | no keys needed — no tab stop, no trap; names carry VIEW ONLY                                                       | LY-1        |
| Place a note with gate-default length (single click)       | Enter/Space on an empty cell                                                                                       | IN-2        |
| Drag-create a sustained note across segments               | place (Enter), then `+`/`=` to lengthen (or Enter mid-span to trim)                                                | IN-2        |
| Edge-drag resize a note                                    | `+`/`-` (±1 step), Shift+`+`/`-` (±0.25) on the focused note; Enter mid-span = trim to here                        | IN-2        |
| Remove a dragged note                                      | Enter at its anchor, or Delete/Backspace on the focused note                                                       | IN-2        |
| Drums drag-paint hits across steps                         | per-cell Enter toggles (v0) + euclid fill rows (PX-3) — reviewed, deliberately NO new binding (one-shot law, I2-4) | IN-2        |
| Multi-clip drag cueing across lanes                        | Shift+arrows range-select on the rail, Enter = CUE ALL                                                             | IN-3        |
| "?" corner toggle for info mode                            | booth INFO button (Tab+Enter) + global `i`                                                                         | HP-1        |
| Hover a control to read its help text                      | focus it — info region updates on focus, aria-live speaks it                                                       | HP-1        |
| Select a lane from the phone switcher                      | the switcher IS a keyboard surface: ArrowLeft/Right, Home/End, Tab roving (§Phone lane switcher)                   | MB-1        |
| Tap a control to read its help text (help mode on, touch) | focus already drives the same region (E6) — the tap is the hover twin, not a new path; Tab/arrow focus speaks it  | MB-3        |

No gesture in the iteration-2 brief lacks a keyboard row. New gesture
proposals during production must add a row here (or land a binding) before
they ship — this table is the gate LY-1/IN-2/IN-3/HP-1 are reviewed against.

## Where things live

- Pure next-cell math: `src/grid/keynav.ts` (unit-tested incl. lane bounds;
  v2: quadrant-move law rides the same clamp/carry functions)
- Grid keydown handling: `src/grid/renderer.ts` (`DomGridRenderer`)
- Cross-quadrant focus coordination: `src/state/gridFocus.ts` (request +
  carry; focus never rests in a view-only grid)
- Quadrant selection state: `src/state/selection.ts` (`activeLane` IS the
  quadrant selection; ephemeral, never document)
- Note-edit store actions: `src/state/store.ts` (`addNote`/`removeNote`/
  `resizeNote`, snap 0.25, coalescing `note:<lane>:<pattern>` — SC-2)
- Pointer gesture framework: `src/interaction/drag.ts` (IN-2/IN-3; commit-on-
  release law, preview = zero store writes)
- FX console open-state (page-level, refinement-1): `src/state/fxConsole.ts`
  (Escape/Close/toggle funnel; LaneHeader owns the handlers, LaneGrid wires
  the covered-grid Escape consult on the renderer)
- Help mode: `src/state/helpMode.ts` + `src/help/registry.ts` +
  `src/components/InfoView.tsx` (HP-1)
- Global shortcuts + help overlay: `src/components/KeyboardShortcuts.tsx`,
  `src/components/HelpOverlay.tsx`, `src/state/helpOverlay.ts`
- Lane-strip roving group helper: `src/lib/rovingGroup.ts`

## v0 → v2 journey-change ledger (the regression-rule record)

Deliberate v0-keyboard-journey changes made by v2, recorded per the
iteration-2 regression rule (journey tests updated only alongside these,
by the owning task):

1. **Lane-move keys became quadrant selection** (LY-1 — THE one deliberate
   journey change announced in the plan): PageDown/PageUp, Ctrl+↑/↓, `]`/`[`
   previously moved grid focus to the next/prev lane's grid while all lanes
   stayed editable; under the quadrant layout they SELECT the next/prev
   quadrant (which moves grid focus by the focus-movement law above and
   announces `NOW EDITING <LANE>`). **LANDED by LY-1** (journey deltas, per
   the rule): DA-1 journey (tests/browser/keyboard-journey.test.tsx) — boot
   now asserts ONE editable grid (the selected quadrant) + VIEW ONLY names,
   the PageDown walk asserts the carried focus + `NOW EDITING LEAD`
   announcement; DA-3 journey (tests/browser/keyboard-journey-full.test.ts)
   — step 7 asserts the BASS announcement alongside the carried focus.
   Pointer parity landed with it: a click on any part of a view-only
   quadrant selects it (control clicks keep their action; a mid-tweak is
   never yanked).
2. **Pitched-grid Enter/Space gains note-model semantics** (IN-2): toggle-on
   = gate-default note, toggle-off = remove, mid-span = trim; cell names
   carry note start/length. No key changes on drums. **LANDED by IN-2**
   (journey deltas, per the rule): the pitched toggle now writes the
   DISPLAYED pattern only (pattern-scoped SC-2 note actions — v0 wrote the
   same cell into every pattern of the lane) and coalesces per
   `note:<lane>:<pattern>` instead of the drums "toggle" family — so a drums
   toggle + a pitched note edit are TWO undo gestures. DA-1 journey
   (tests/browser/keyboard-journey.test.tsx) — the undo stage now presses
   Ctrl+Z twice (the lead note reverts, then the snare toggle), stage by
   stage.
3. **New bindings** (additive, none replaces a v0 binding): grid `+`/`-`/
   Shift+`+`/`-`/Delete-removes-note (**landed by IN-2**); rail Shift+arrows
   range-select + Enter/Space CUE ALL + plain ↑/↓ row roving
   (**landed by IN-3**); global `i` help-mode toggle +
   Escape-exits-help-first (**landed by HP-1**).
4. **Page-level Escape closes the FX console** (refinement-1 — critique
   P1-1, the pointer-trap fix; additive, no binding replaced): while a
   lane's FX console overlay is open, Escape closes it from anywhere,
   slotted after the KEYS modal / help mode / inner popovers+menus and
   before the region-head pops; on a covered grid the console close
   REPLACES the pop for that keystroke (one consumer per Escape). The
   pointer twins landed with it: the console's CLOSE button (title strip,
   outside the occluded zone) and the strip's FX toggle — both reachable
   now that the chassis starts below the whole control strip. **LANDED by
   refinement-1** (gates: tests/browser/fx-console-trusted.test.tsx — real
   clicks on the five formerly-occluded controls; quadrant-layout.test.ts
   §9b — built-app geometry/one-page/elementFromPoint; help-mode.test.tsx
   §6 extended — the mode → menu → console order). No journey STEP changed
   (DA-1/DA-3/e2e leave the console open across their FX stages exactly as
   before); the new assertions are additive. Two NON-journey gates were
   deliberately updated with it (they had been exploiting a latent bug:
   a synthetic click on a view-only quadrant's display:none FX entry used
   to open a console over that floor — now guarded by the "only the
   selected quadrant's entry is live" law): zero-network.test.ts clicks
   `[data-editing="true"] .head-fx`, and e2e-happy-path.test.ts selects
   bass (side-effect-free lane-label click) before its post-reload FX
   reopen.
5. **Rail pattern tools moved behind the per-lane PAT menu**
   (refinement-6 — critique P3, the tools-row density distill; NO binding
   replaced, one pointer/journey step added): the six management controls
   (REN, +1B, +2B, +4B, DUP, RM) live in the row's PAT popover (the
   committed popover vocabulary — focus lands on the first control on
   open, actions commit and close, Escape closes with focus returned to
   the trigger, the inline rename field consumes its own Escape first).
   Keyboard paths are UNCHANGED in substance: `n`/`d` never routed through
   the buttons; `r` now OPENS the active lane's menu when closed and still
   lands focus on REN; tile keys (F2, `l`, `+`, Delete) are untouched.
   Deliberate journey deltas (the regression rule): DA-3 step 12 gains one
   `Enter` (PAT before DUP); e2e-happy-path, frame-budget, quadrant-layout
   and help-coverage open the menu before acting — all updated with this
   entry. New gate: tests/browser/rail-density.test.ts (one trigger per
   lane ≤88px, 15-tile single-line rows at 1280×800 + 1440×900, menu laws,
   the `r` twin, tile-cue pending through the distill).
6. Everything else in the v0 map — one-Tab-stop regions, no-wrap, text-entry
   guards, body-level Space transport, Shift+Enter audition, Home/End, beat
   jump, `n`/`d`/`r`, rail-local keys, undo guards, the exclusion list —
   carries into v2 unchanged.
7. **The phone lane switcher** (MB-1 — mobile slice, town-hall addendum;
   additive, no binding replaced, no desktop journey step touched): at phone
   stage width a `role=tablist` joins the sticky chrome and IS the quadrant
   selection — ArrowLeft/ArrowRight/Home/End select + focus (automatic
   activation, roving tabindex; see §Phone lane switcher). The v0/v2
   quadrant keys keep their exact meaning from the grid and strips; the
   announcement law is the same region, the same text. Desktop (≥1024) and
   tablet quadrant stages never mount the switcher — the desktop journeys
   are untouched by construction (m4). Gate:
   tests/browser/mobile-viewport.test.ts §1.

**HW-5 audit (2026-09-02, the M16 ledger-completeness sweep):** every entry
above re-verified against the shipping tests — #1's journey deltas are live
in keyboard-journey.test.tsx (VIEW ONLY names, PageDown walk + `NOW EDITING
LEAD`) and keyboard-journey-full.test.ts (step 7 `NOW EDITING BASS`), #2's
two-Ctrl+Z undo stage is in keyboard-journey.test.tsx, #3's additive
bindings are pinned by the IN-2/IN-3/HP-1 gates (drag-notes, drag-cue,
help-mode). NO further deliberate v0-journey changes exist: IN-4/TH-4/HP-2/
PS-1..4/SC-1..2 all recorded "no journey steps changed" and the audit found
none unrecorded. HW-5's own iteration-2 e2e
(tests/browser/e2e-iteration2.test.ts) is a NEW journey, additive — it
changes no v0 journey step.

## DA-3 scripted journey (the v0 make-a-loop + arrange + export walkthrough — historical record)

This is the complete keyboard-only product walkthrough for town-hall AC #8
("grid editing fully keyboard-operable") and the make-a-loop + arrange +
export journey. The browser test `tests/browser/keyboard-journey-full.test.ts`
IS this script — it drives the REAL BUILT app (dist/ bundle, fresh IndexedDB
→ first-run demo) step by step and asserts an observable outcome per step.
Recorded as shipped in v0 (DA-3); the ledger above governs its deliberate
updates under the v2 layout.

Testing note: synthetic KeyboardEvents run every keydown handler the app
installs but carry no browser default actions; native-button Enter/Space
activation and native range-arrow stepping are platform guarantees, so the
test replicates exactly those defaults (focus + Enter keydown + click;
focus + Arrow keydown + stepUp + input event). Nothing is driven by mouse
coordinates; every action begins from a focused element.

| #   | Step (keys)                                                                          | Observable outcome asserted                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Boot (no keys — first run)                                                           | booth mounts, 4 grids, demo cue labels (VERSE) in the rail                                                                                                                                                                                                      |
| 2   | `Space` at body level                                                                | PLAY aria-pressed → true (transport runs)                                                                                                                                                                                                                       |
| 3   | `?` … inspect … `Escape`                                                             | role=dialog help overlay, focus trapped inside, dismissed                                                                                                                                                                                                       |
| 4   | Focus drums roving seed → `↓` `End` `Home` `.`                                       | SNARE row, step 15 → 0 → beat-jump to 4                                                                                                                                                                                                                         |
| 5   | Tab to SNARE fill rail → `Enter` on `+` pulses ×2 → `Enter` on SET                   | readout counts p/16, dashed data-preview overlay, then the row paints exactly p on-cells and preview clears                                                                                                                                                     |
| 6   | `Enter` on a focused cell                                                            | data-on / aria-selected flips                                                                                                                                                                                                                                   |
| 7   | `PageDown`                                                                           | focus lands in the BASS grid (position carried, clamped) — **v2: becomes "selects the BASS quadrant + announces"; LY-1 updates this step (ledger #1)**                                                                                                          |
| 8   | Header strip: `Enter` on preset `+`, gate `+`                                        | preset name changes; gate value steps 1 → 2 ST                                                                                                                                                                                                                  |
| 9   | `Enter` on the scale chip → pick root D + mode DORIAN → OVERRIDE LANE                | popover opens focused, closes on commit; chip becomes LANE · D DOR (is-lane). Cancel path: reopen + `Escape` → closed, focus back on the chip                                                                                                                   |
| 10  | `Enter` on FX → `Enter` + ADD FX → `Enter` first device → arrows on the CUTOFF range | strip opens; menu opens WITH focus inside (fixed in DA-3); 3rd module appears; readout + aria-valuetext track the stepped value                                                                                                                                 |
| 11  | Rail: focus tile 1 → `→`×3 → `Enter`                                                 | tile shows PENDING (◆ / aria "switch pending"), then lands ACTIVE/selected on the chain boundary while still playing                                                                                                                                            |
| 12  | `Space` (stop) → `Enter` on PAT → `Enter` on DUP → focus last tile → `+` → `Escape`  | play stops; pattern pool grows; chain gains a tile with focus moved onto it (fixed in DA-3); Escape pops to the rail head (view toggle). [refinement-6 ledger #5: DUP lives in the row's PAT menu — one extra `Enter` opens it; `d` remains the menu-free twin] [v3 · LANDED by BC-1 (I3-a): the final `+` creates a NEW blank next-letter pattern — appended + selected + announced `PATTERN <L> CREATED · 1 BAR · APPENDED` through the lane's rail status region, focus on the new tile — NOT a re-append of the selected pattern; the journey now asserts the F label, the announcement, the selection flip, and the focus law] |
| 13  | `Enter` PROJECTS → `Enter` EXPORT WAV → EXPORT MIDI                                  | RENDERING… → "WAV EXPORTED" toast + audio/wav blob download; "MIDI EXPORTED · 5 TRACKS" + audio/midi blob (recorded via the URL.createObjectURL seam)                                                                                                           |
| 14  | `Enter` NEW … then reopen popover → `Escape`                                         | "NEW PROJECT READY" toast, empty-stage hint "PICK A PRESET · PAINT THE GRID"; Escape exits the focus trap with focus returned to the PROJECTS button                                                                                                            |

Gaps the walk found (fixed in DA-3, all in this repo):

- **FX add menu ignored the keyboard menu conventions** — opening it left
  focus on the + button and nothing closed it on Escape. Now: focus lands on
  the first menu item on open (also reachable via ArrowDown on the entry),
  Escape closes and refocuses + ADD FX (src/components/FxStrip.tsx).
- **`+` append existed only as a mouse button** — the spec's rail-local `+`
  key was never implemented. Now `+`/`=` on a focused tile appends the
  selected pattern (src/components/PatternRail.tsx). [Historical v0 record;
  superseded by v3/BC-1 (I3-a): the same key now creates a NEW blank
  next-letter pattern — §v3 delta "Rail `+` = new blank clip". Cosmetic
  journal note (BC-1): this sentence is the one residual v0-era
  "+ appends the selected pattern" prose the KL-1 verification flagged as
  non-normative historical narrative; left as history, not law.]
- **Chain edits stranded focus** — the tile row rebuilds on any chain edit
  (For reference diff), so `+` and `Delete` dropped focus to `<body>`.
  Focus now lands on the tile occupying the edited slot (the appended tile
  for `+`) (src/components/PatternRail.tsx).
- **Escape in the rail ignored the region-head law** — now Escape on a tile
  focuses the rail head (the COLLAPSE/EXPAND view toggle), matching the
  Escape-pop law everywhere else.

Observation recorded, deliberately NOT changed here (perf, not keyboard):
each FX param commit rebuilds the module DOM (Solid For reference diff), so a
60 Hz slider drag recreates the module nodes every tick. Values stay correct
and engine ramps are unaffected (AudioParam path), but DES-7 should consider
keying modules by identity to avoid per-tick DOM churn.

---

# v3 delta (KL-1 — iteration 3: OCT, window scroll, resize, blank `+`, position law)

Spec for the iteration-3 interaction surfaces, per town-hall §Iteration 3
(I3-a..f) and the schema-v3 ground SV-1 landed (powers-of-two pattern
vocabulary 1·2·4·8·16·32·64·128; per-pitched-lane `octave` field −3..+3,
canonical-empty at 0 — schema.ts:296-303, 406-415; `loopBars` retired behind
the engine-side compat derivation until LL-2's deliberate basis swap).
**Everything in this delta is SPEC until its owning task lands** — the
implementing tasks are BC-1 (rail `+` — **LANDED**, §"Rail `+` = new blank
clip" is live law), RC-1 (OCT + register windows + manifest scroll —
**LANDED**, §"Register controls" and §"Register window scroll" are live
law), LL-1 (vocabulary + resize + extent), LL-2 (per-lane
playhead/position basis); their browser gates assert these laws verbatim.
The v2 laws above (one-Tab-stop regions, roving groups, no-wrap,
text-entry guards, the exclusion list, drag-equivalent announcements)
govern every new surface unchanged unless a supersession is recorded here.

## v3 focus model — the new controls join the ESTABLISHED regions

No new regions, no new Tab-stop shapes — every v3 control is a native
control inside an existing one-Tab-stop/roving region:

| New control                                            | Region it joins                                                                                                                     | Tab/arrows                                                                                             | Owning task |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- |
| OCT − / OCT + + register readout (pitched lanes)        | Quadrant control strip (LaneHeader) — the always-operable COMPACT row, ALL FOUR quadrants ("tweak any lane without switching"; LaneHeader.tsx:1-27) | native buttons + value span (the preset/kit + gate stepper pattern); `]`/`[` quadrant keys keep working from among them | RC-1        |
| LENGTH stepper (resize) in the PAT popover              | Pattern rail — tools popover while open (the REN/LENGTH−/LENGTH+/DUP/RM vocabulary since LL-1 retired the v2 +NB create buttons — creation is `+`/`n` at 1 bar; PatternRail.tsx) | native buttons; popover laws unchanged (focus first control on open, Escape closes + refocuses trigger; the stepper itself STAYS OPEN across presses — the rename-field precedent) | LL-1        |
| Register window scroll                                 | Lane grid (selected quadrant) — NOT a control: two grid keys on the focused cell (§ below)                                          | grid-map keys, grid scope only                                                                        | RC-1        |
| Per-lane playhead position query (`p`)                  | none — an on-demand announcement through the stage status region (selection.ts:120-137), never a focusable thing                    | n/a                                                                                                    | LL-2        |

- The strip placement decision (COMPACT row, all four quadrants) follows the
  always-operable law: dropping the BASS an octave while editing LEAD must
  not require a quadrant switch — same reason VOLUME/MUTE/SOLO live there.
  Drums carries NO OCT control (the drum voice model has no pitch
  resolution — schema.ts:40-46); its strip stays exactly as today.
- Every new control registers help text (the HP-2 coverage law — the gate
  FAILS on unregistered or stale controls) and updates on focus while help
  mode is ON (the HP-1 focus-driven law). Help-mode pass-through applies:
  `o`/`b`/`p` fire normally while the mode is on; nothing traps.
- Escape order: NO new consumers. The LENGTH stepper lives inside the PAT
  popover and consumes Escape through the existing popover law; window
  scroll and `p` consume nothing (view-state reads/writes only).

## Register controls — per-lane OCT −/+ [v3 · LANDED by RC-1]

Per-lane octave transpose writes the v3 `octave` field (one octave per
press, clamped −3..+3): the session recompiles the lane live (audible),
the ONE compiler carries it into WAV/MIDI, undo family `octave:<lane>`.
Pitched lanes only.

| Path                                    | Action                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `o` (global, pattern-ops family)        | active lane OCTAVE **+1** (pitched; guards below)                                                         |
| Shift+`o` (global)                      | active lane OCTAVE **−1**                                                                                 |
| Tab → OCT − / OCT + button → Enter      | same actions on THAT lane's strip (any quadrant, no switch needed — the always-operable law)               |
| pointer click on OCT − / OCT +          | the pointer twin — same funnel, same announcements (E5 law: no announcement may depend on pointer events) |

- **Key-scope/guard law (identical to `n`/`d`/`r`/`i`):** fires only on real
  keydown targets that are NOT text-entry elements
  (KeyboardShortcuts.tsx:28-43 `isTextEntry`), skipped whenever an
  assistive-tech modifier is held (the exclusion list — `o` joined it above).
  The global keys act on the ACTIVE (selected) lane; the strip buttons act
  on THEIR lane. The announcement names the lane either way — never "octave
  changed" unqualified.
- **Announcements (a11y gate E8).** One funnel announces value + clamp
  through the strip's local `aria-live=polite` value span (the gate-stepper
  pattern), and the register readout keeps the value as text at all times:
  `LEAD OCTAVE +1` · `BASS OCTAVE −2` · `CHORDS OCTAVE 0`. At the domain
  clamp the press is a NO-OP that still announces the limit:
  `LEAD OCTAVE +3 · AT LIMIT` / `BASS OCTAVE −3 · AT LIMIT` (never a silent
  no-op — a screen-reader user must hear why nothing changed). On drums
  (global key only): `DRUMS HAS NO OCTAVE`.
- **The register readout law.** The readout beside the buttons exposes the
  current octave as TEXT in the accessible tree at all times (never
  color/position alone — D9). If RC-1 models the readout as a slider-style
  widget it MUST carry `aria-valuetext` with the same signed text
  (`OCTAVE +1`); the announcement texts above are identical either way
  (the load-bearing law; the widget role is RC-1's production choice).
- **Undo.** Held-key repeats are ONE undo gesture (`octave:<lane>`
  coalescing — the note-resize discrete-commit precedent: keys are discrete
  commits, coalesced like a drag).
- **Transpose ≠ audition.** An OCT press does NOT re-audition the focused
  note (no machine-gun law, same reasoning as note resize); the live
  recompile IS the audible confirmation while playing, and the announcement
  carries it when stopped.
- **Help/info interaction.** Focusing OCT −/+ in help mode shows its entry;
  the entry MUST say the control changes SOUND (transposes the lane's
  register) — wording is PX-4's, the requirement that the entry distinguish
  SOUND-changing transpose from VIEW-only window scroll (below) is KL-1's
  (the Professor X conflation fence, keyboard side — a11y gate E9).

**RC-1 implementation record (production decisions, per the handoff):**
- **Widget role:** the readout is a native-buttons stepper with a plain
  value span (`OCT − [ +1 ] OCT +` — the preset/kit + gate stepper
  pattern), NOT a slider — so no `aria-valuetext` is owed; the
  announcement texts are identical either way (the load-bearing law).
- **One funnel:** `selection.stepLaneOctave` (strip buttons, pointer, and
  the global `o`/Shift+`o` all land there); it announces through a
  strip-local `aria-live=polite` span rendered in EVERY lane's strip
  (drums' only text is the refusal). The E5 parity law holds by
  construction.
- **Compile/export consumption:** the lane octave is an OFFSET on the
  preset's `pitchRange.octaveBase` in `compileLaneEvents`,
  `compileLaneSchedule` (live + offline render) and `buildPitchedNotes`
  (MIDI) — exported pitch = heard pitch, final MIDI numbers clamped 0..127
  (the schema's consumer-side pitch law). Auditions carry the same offset
  (Session.setLaneOctave via the engineBridge's lane-config push), while
  an OCT press itself never auditions. Canonical-empty at 0 keeps every
  pre-RC-1 document byte-identical — zero render/export fingerprint drift.
- **Undo:** the store action `setLaneOctave` coalesces per
  `octave:<lane>`; a settled burst (+1→+3 within the 350 ms window) is ONE
  gesture reverting to the burst's baseline.

## Register window scroll — the visible row window [v3 · LANDED by RC-1]

Every pitched lane's grid shows the SAME one-octave window by default
(I3-c; equal-by-default across fresh + demo + migrated projects, ZERO
document churn — the window is VIEW state on the selection.ts two-tier law,
never a document field, never undo history). The full row manifest stays
reachable: bass/lead carry ~2 octaves of rows (store.ts:81-104
`expandDefaultGrids`), chords one, drums six pieces.

- **Construction law (for RC-1):** the full row manifest stays in the DOM
  (rows are bounded by the manifest — tens, not thousands); the window is a
  SCROLL POSITION of the quadrant's grid body (internal scroll — the
  one-page law is a page law, not a pane law; the phone scrolling-grid
  precedent). LP-1's windowing owns the COLUMN axis only — vertical
  windowing would violate the reachability law below (focus must be able to
  rest on any manifest row).
- **Arrow rows walk the FULL manifest (no-wrap amendment, recorded above):
  ↑/↓ clamp at the manifest's first/last row — the manifest is the hard
  edge now, not the window.** When focus would cross the window edge, the
  window scrolls the MINIMAL amount that keeps the focused row visible
  (scroll-into-view, `block:"nearest"` semantics) — the v0 carry-clamp
  instinct applied to the view, not the cursor. Drums grids (manifest ≤
  window) never scroll; their arrows behave exactly as today.
- **Grid names carry the window (E3 precedent — state in text):** pitched
  grid accessible names append the visible range while the manifest exceeds
  the window: `<LANE> grid · EDITING · ROWS 8–14 OF 14` (VIEW ONLY twin
  unchanged); when the whole manifest is visible the range is omitted
  (today's name, byte-identical — the fresh/demo default for chords/drums).

| Key (on a focused cell, selected quadrant's grid) | Action                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shift+`↑` / Shift+`↓`                             | scroll the visible window ONE OCTAVE up/down — VIEW ONLY: no document write, no undo, no audition, focus does not move |

- **The focus-anchor law.** The window may never scroll the focused row out
  of view: Shift+↑/↓ clamp BOTH at the manifest bounds AND at the last
  position that keeps the focused row visible. To see further, move focus
  first (↑/↓) — the anchor is teachable and predictable ("the cursor holds
  the window"), and it makes "focus is always visible" true by construction
  (E2's law, extended to the windowed grid). At either clamp the press is a
  no-op that announces the edge.
- **Announcements (E9 — the conflation fence).** Window scrolls announce
  through the grid-local `aria-live=polite` span with VIEW wording that
  names the newly visible rows: `VIEW DOWN ONE OCTAVE · ROWS <labelFirst>–<labelLast>`
  (row labels are the grid's own — pitch names for pitched lanes); at a
  clamp: `VIEW AT TOP · ROWS <a>–<b>` / `VIEW AT BOTTOM · ROWS <a>–<b>`.
  THE LAW: window-scroll announcements must say VIEW and the OCT
  announcements must say OCTAVE — a screen-reader user must be able to tell
  "the lane transposed" from "the window moved" with eyes closed. Window
  scroll never auditions, never writes the store, never announces as
  transpose; OCT never scrolls the window (it changes which ROWS SOUND,
  not which rows are shown).
- **Pointer twin.** Wheel/drag scrolling of the grid body scrolls the same
  window (same clamps; the focus-anchor law bounds only the KEYS — a
  pointer scroll may move the view off the focused row, sighted users track
  it visually; the next focus move snaps the window back per the
  scroll-into-view law). No announcement fires for passive pointer scroll
  (nothing changed in the document or the focus — announcing every wheel
  tick would be spam); the window is always readable from the grid's name.
- **Phone/tablet:** the phone stage already renders one lane with an
  internally scrolling grid (the MB-1 precedent) — the window laws there
  are RC-1's mobile-half concern, riding m1–m5 regression; no new phone
  keys are spec'd (Shift+arrows are grid keys and work wherever a grid is
  focused).

**RC-1 implementation record (production decisions, per the handoff):**
- **Default window position (the spec pins the window's SIZE equality, not
  its position):** the default is the one-octave window showing the MOST
  noted rows of the lane's patterns, ties broken toward the LOWEST window;
  an empty lane starts at 0. Demo: bass roots visible at 0–6, lead melody
  at 6–12 (15-row manifest; windows 6/7/8 tie at six melody rows). The
  docs' `ROWS 8–14 OF 14` example remains reachable (one Shift+↓ from 6–12
  under the anchor law).
- **Scope:** the window rides the QUADRANT stages (tablet + desktop). The
  phone stage KEEPS its committed full-manifest page-scroll law (m1 pins
  the tall-lane document exceeding the viewport; I3-f forbids the phone
  redesign) — there the whole manifest is the window, the scroll keys
  lawfully clamp without announcing (the chords/drums precedent), and the
  OCT strip control is reachable at phone width under the 44 px target
  law.
- **Anchor-blocked presses:** a Shift+↑/↓ stopped by the focus-anchor
  announces the same VIEW AT TOP / VIEW AT BOTTOM wording as a
  manifest-bound press (the named rows are the CURRENT window) — never a
  silent no-op, one wording for both clamp kinds.
- **View-only windows are static mirrors:** the window is per-LANE view
  state, so the selected grid owns every scroll (keys, wheel,
  focus-follow) and a view-only quadrant's pane carries NO overflow (the
  pointer-twin clause governs the interactive grid). This keeps E2
  absolute — no focusable content in a view-only grid, satisfying the axe
  scrollable-region rule through the editing pane's roving cell — and the
  one-click/key quadrant selection is already the reading path.
- **Mechanism:** the renderer owns an AUTHORITATIVE semantic start
  (`seatedStart` — updated only by intentional seats: keys, lane view
  state, focus-follow, wheel) and re-anchors the scroll position on it
  across layout-affecting flips (the editing/view-only row-margin rhythm,
  budget-fit re-pins); `overflow-anchor: none` keeps Chromium's scroll
  anchoring out of the seat. Focus calls use `preventScroll` so the
  window-follows-focus law is the single scroller.
- **LaneGrid remount key** now includes the pattern's row-manifest size —
  a loaded document may put a different-height manifest under the same
  id:kind:bars key, and the grid's row count is fixed at build.

## Pattern resize — LENGTH in bars [v3 · spec — lands with LL-1]

Pattern LENGTH is the only length control (I3-e — no decoupled loop knob,
ever). The vocabulary is the schema picklist 1·2·4·8·16·32·64·128; resize
exists after create through BOTH the PAT menu and the keys below. Policy
(the Hulk resolution, fixed): grow ALWAYS proceeds; shrink proceeds only
when NO note would be lost past the new end; otherwise REFUSE — typed
refusal + announcement naming the blocking note. There is no override
gesture in v3 (silent truncation is the rejected alternative; an
"override and delete" path would be a new journey change and must return
to the ledger first).

| Path                                        | Action                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `b` (global, pattern-ops family)            | resize the active lane's SELECTED pattern ONE VOCABULARY STEP BIGGER (1→2→…→128; at 128: limit no-op announcing `PATTERN B · 128 BARS · AT LIMIT`) |
| Shift+`b` (global)                          | one vocabulary step SMALLER (128→…→1; refuse-on-loss law applies; at 1: limit no-op announcing `PATTERN B · 1 BAR · AT LIMIT`) |
| PAT menu LENGTH − / LENGTH + → per press    | same ladder on the menu's pattern (the selected one); the stepper OWNS ITS LIFECYCLE inside the popover (stays open across presses — the rename-field precedent; Escape/close still exits with focus returned to the trigger) |
| pointer on the same buttons                 | the pointer twin — one commit funnel, identical announcements (E5)                                                 |

- **Guards:** identical to `o` (text-entry guard, AT-modifier skip; `b`/`p`
  joined the exclusion list above). Works on drums patterns too (drum rows
  resize with the pattern — `applyEuclidFill`'s array law is
  length-parametric).
- **Success announcements (E10):** through the lane's rail status region:
  `PATTERN B · 8 BARS` (grow or clean shrink), with the value span in the
  menu reading `LENGTH <n> BARS` per press. Undo: ONE undoable edit per
  resize (family `resize:<lane>:<pattern>` per LL-1); the global keys are
  discrete commits (the note-resize precedent).
- **The refusal announcement (E10 — never silent, never truncating):**
  `CANNOT SHRINK PATTERN B TO 4 BARS · <ROW LABEL> NOTE AT BAR 5 WOULD BE LOST · MOVE OR SHORTEN IT FIRST`.
  The blocking note is named DETERMINISTICALLY: the note with the greatest
  end (`start + length`); ties broken by latest start (the focused-note
  determinism law, IN-2). Both paths (menu button, `b` key, pointer)
  produce this SAME text through the same funnel.
- **Focus law after a successful resize:** the grid remounts (the
  `${p.id}:${p.kind}:${p.bars}` key — LaneGrid.tsx:788, the G9 seam). If
  focus was IN that grid, it lands on the CARRIED cell — same row, step
  clamped to the new extent's last step (the v0 carry-clamp law); if focus
  was anywhere else (e.g. `b` pressed from the rail), focus never moves —
  the announcement carries the change (the no-yank law).
- **Extent law:** the grid extent follows the selected pattern's real bars
  (E7 `currentPatternFor` → bars → columns) through LP-1's windowing seam;
  keyboard nav over 2048 columns is O(1) focus math (G8) — Home/End/beat
  jump keep their exact meanings at any length.

## Rail `+` = new blank clip [v3 · live since BC-1]

I3-a, THE deliberate journey change of iteration 3 (the plan's regression
rule names this ledger entry):

1. **Rail `+` creates a NEW blank pattern** — next-letter label via the
   addPattern naming (A,B,C…Z,P27+ — one shared authority now,
   `nextPatternLabel` in src/state/patternRail.ts), appended to the lane's
   chain, selected, immediately editable. Default bars =
   addPattern's existing default (**1 — the BC-1 production decision,
   recorded**: the blank rides addPattern's default; LL-1's LENGTH ladder
   grows it afterwards). This applies to BOTH trigger shapes together: the
   row's `+` button (src/components/PatternRail.tsx — accessible name
   `Append new blank pattern to <LANE> chain`) and the rail-local `+`/`=`
   key on a focused tile.
2. **DUP is the ONLY duplicator** — unchanged in behavior: the PAT menu's
   DUP button and the global `d` key duplicate the selected pattern and
   select the copy (v0 law). Its ledger line is updated to SAY so (this
   entry); no new key, no new announcement, no journey step beyond what
   BC-1 journals for `+`.
3. **Announcement (E11):** creation announces through the lane's rail
   status region: `PATTERN B CREATED · 1 BAR · APPENDED` (letter =
   the actual label; bars pluralized; the appended+selected state rides the
   same line — one announcement, not three).
4. **Focus law:** the rail-local `+` key lands focus on the new tile (the
   DA-3 focus-after-edit law — the appended slot); the `+` button keeps
   focus on itself (native click; a mid-tweak is never yanked). The
   selected-quadrant grid remounts to the new blank pattern (extent = its
   bars); if focus was in that grid… it cannot be (both `+` paths are
   rail-scoped), so no carry is spec'd — the grid remount leaves focus in
   the rail by construction.
5. **Help text:** the rail-append registry entry (`data-help="rail.append"`)
   and the button's accessible name must say NEW BLANK CLIP — the HP-2
   coverage gate fails on stale text (BC-1's plan line).

**BC-1 implementation record (production decisions):** one `+` press is
ONE store commit (`appendBlankPattern`, src/state/store.ts) — so one
Ctrl+Z reverts the create AND its append together (the removePattern
single-commit precedent for a patterns+chain structural rewrite); it is
deliberately NOT a coalescing-family edit (those exist for rapid repeat
edits within the 350 ms window — a family here would wrongly glue two
deliberate `+` presses into one undo step; structural actions never
coalesce). Gated by tests/browser/pattern-rail.test.ts (both trigger
shapes, announcement, extent remount, one-step undo, DUP-only duplicator,
E11 wording) + the unit store tests in tests/pattern-rail.test.ts + the
DA-3 step 12 journey delta.

## Position & playhead at unequal cycle lengths [v3 · spec — lands with LL-2]

The engine poly-loops (each lane wraps independently at its chain total —
schema-v3-seams.md F11); LL-2 re-bases playhead/position/one-shot from the retired `loopBars`
field to per-lane chain totals / one LCM cycle. What the SR user hears:

- **The booth readout is the GLOBAL clock: BAR.BEAT.STEP within the FULL
  LCM CYCLE (= the longest lane under powers-of-two — I3-d).** The readout
  (Booth.tsx:137-183) and the beat announcement (`BAR n · BEAT n`, on beat
  change only) keep their exact mechanism and format; only the wrap modulus
  grows to the LCM cycle. At equal cycle lengths this is byte-identical to
  today (the compat law — zero drift until LL-2's deliberate swap). Rationale
  (the recorded KL-1 decision, plan LL-2 risk row): ONE stable global
  reference; "BAR 3" must mean the same thing everywhere; the longest lane's
  wraps align with it by construction.
- **Lane wraps are NOT announced globally — they ride the EXISTING per-lane
  rail status regions.** A shorter lane switching patterns mid-cycle is the
  poly-loop signal, and the mechanism already exists (active-pattern
  announcements per lane). No new live region, no per-wrap stage
  announcement (a four-lane poly-loop would spam the stage region — the
  spam fence). Announcement RATE therefore differs per lane by design; that
  asymmetry is information, not noise.
- **`p` (global, NEW — the SR playhead twin):** sighted users see four
  playheads sweeping at different cycle lengths (the playhead itself is
  aria-hidden visual decoration — docs/dev/accessibility.md §1/§4); `p` is
  the on-demand readout.
  Announces through the stage status region (selection.ts:120-137):
  `POSITION BAR 12 OF 64 · BASS BAR 4 OF 4` — global cycle position, then
  the ACTIVE lane's position within ITS cycle; when every lane shares one
  cycle length the lane half is omitted (`POSITION BAR 3 OF 4`). While
  stopped: the parked positions, same format. Guards: identical to `o`/`b`.
  `p` reads state only — no document write, no focus move, nothing
  consumed (it can never interfere with an Escape order or a drag).
- **One-shot (LOOP off):** plays exactly ONE full LCM cycle then parks
  (I3-d) — the booth readout freezes at the park position; no new
  announcement is spec'd (the transport state is already carried by PLAY's
  aria-pressed and the readout text).

## v3 coverage review (AC: no keyboard path missing for any new gesture)

| New gesture (pointer/world)                                    | Keyboard path (this spec)                                                                     | Owning task |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| Rail `+` button creates a blank next-letter clip                | rail-local `+`/`=` key — same action, same announcement                                       | BC-1 (live) |
| DUP a pattern (now the only duplication path)                   | global `d` (unchanged) + PAT menu DUP (unchanged)                                             | BC-1 (live, ledger only) |
| Click OCT − / OCT + to transpose a lane                        | global `o` / Shift+`o` (active lane) + Tab→button→Enter on any lane's strip                   | RC-1 (live) |
| Wheel/drag-scroll the register window                          | Shift+`↑` / Shift+`↓` on a focused cell (view-only, clamped, announced)                       | RC-1 (live) |
| Reach rows outside the default window                          | ↑/↓ walk the full manifest; the window follows focus (scroll-into-view law)                   | RC-1 (live) |
| PAT menu LENGTH stepper resize                                 | global `b` / Shift+`b` (ladder steps) + the stepper buttons themselves                        | LL-1        |
| Refuse a lossy shrink (refuse-by-default)                      | same refusal + announcement from every path (menu, keys, pointer — one funnel)                | LL-1 / HL-1 |
| Watch per-lane playheads sweep at unequal cycles               | `p` on-demand position announcement + existing per-lane rail status (wrap) announcements      | LL-2        |
| Read the global position during a long cycle                   | booth readout (unchanged mechanism, LCM basis) + `p`                                          | LL-2        |

No gesture in the iteration-3 brief lacks a keyboard row. The E7 contract
law carries: new gesture proposals during production must add a row here
(or land a binding) before they ship — this table is the gate BC-1/RC-1/
LL-1/LL-2 are reviewed against.

## v2 → v3 journey-change ledger (the regression-rule record)

1. **Rail `+` semantics change (I3-a — THE one deliberate journey change
   this iteration, named in the plan).** v0/v2 `+` (button + rail-local
   key) re-appended the SELECTED pattern (`appendChainSlot`,
   PatternRail.tsx:896-904, 786-791); v3 creates a NEW blank next-letter
   pattern (appended + selected + editable, announced
   `PATTERN <L> CREATED · <n> BAR · APPENDED`). DUP (`d` + PAT menu)
   unchanged — now the ONLY duplicator, its ledger line updated to say so
   (§ above). **LANDED by BC-1** (journey deltas journaled, per the rule):
   DA-3 step 12 (keyboard-journey-full) — the post-DUP `+` asserts the new
   tile's next-letter label (F), the creation announcement, the selection
   flip, and the focus-on-new-tile law; NEW gate
   tests/browser/pattern-rail.test.ts (both trigger shapes, one-step undo,
   extent remount, DUP-only duplicator, E11 wording); unit store tests in
   tests/pattern-rail.test.ts; e2e-happy-path's DUP-then-`+` stage now
   expects the blank next-letter tile (not the duplicated copy); the
   frame-budget dense-lane construction re-based from `+`-append to the
   drums-precedent pool-removal path (RM the demo patterns; the chain
   follows). The rail-append aria-label/help-text updates ride the HP-2
   coverage gate (accessible name now `Append new blank pattern to <LANE>
   chain`; registry entry `rail.append` says NEW BLANK CLIP).
2. **Row-clamp domain grows to the manifest + window follows focus**
   (RC-1): an AMENDMENT, not a binding change — ↑/↓ still clamp at a hard
   edge (the manifest bound replaces the visible-rows bound, identical in
   every project whose manifest fits the window, incl. all fresh/demo
   chords/drums grids). **LANDED by RC-1** (journey deltas journaled, per
   the rule): grid accessible names on windowed lanes (bass/lead with
   manifests beyond one octave) append `· ROWS a–b OF n` — the ten
   exact-name gates across drag-notes/-trusted, pointer-edge-states/
   -trusted, e2e-iteration2, keyboard-journey, help-mode, help-coverage,
   pattern-rail, target-size now prefix-match the edit state (drums and
   one-octave lanes keep byte-exact names); quadrant-layout 1b pins
   re-based to the windowed budget (bass tracks hold the committed 16 px
   at 1280×800 — the window, not the 14-row manifest, is the quadrant's
   vertical budget; the manifest stays in the DOM and the visible-window
   rows are the inside-viewport law).
3. **New bindings (additive, none replaces a v0/v2 binding):** global
   `o`/Shift+`o` (OCT transpose), global `b`/Shift+`b` (pattern resize
   ladder), global `p` (position query), grid Shift+`↑`/Shift+`↓`
   (register window scroll). All letter keys join the text-entry/AT-modifier
   guard family (exclusion list updated above).
4. **Position readout re-bases to the LCM cycle (LL-2, deliberate):** the
   booth BAR.BEAT.STEP wrap modulus moves from the retired `loopBars` to
   the full LCM cycle — byte-identical while all lanes share one cycle
   length (the compat law); unequal cycles are NEW behavior (longer readout
   span + the `p` lane detail). LL-2 journals the basis swap with its
   per-lane sweep gates (J12's browser laws update there); no journey step
   changes until PX-4's poly-loop demo content (journaled in PX-4 if a
   journey adopts it).
5. Everything else in the v2 map — one-Tab-stop regions, view-only
   quadrant laws, the note model keys, rail multi-clip cueing, transport,
   undo guards, help mode, FX console, the phone switcher, the exclusion
   list, no-wrap — carries into v3 unchanged except as recorded above.

## Where things live (v3 additions — for the implementing tasks)

- Register window state (per-lane window offset): `src/state/selection.ts`
  (the two-tier law — ephemeral signal, never document, never undo);
  RC-1 landed the default-position chooser + the document-replacement
  re-default there, and the OCT funnel + strip-local announcement signal
  (`stepLaneOctave` / `octaveStatus`) live beside it
- OCT store action (`setLaneOctave`, clamp + undo family `octave:<lane>`)
  and resize action (`resizePattern`, refusal path + family
  `resize:<lane>:<pattern>`): `src/state/store.ts` (RC-1 landed / LL-1)
- Global keys `o`/`b`/`p`: `src/components/KeyboardShortcuts.tsx` (the
  `isTextEntry` + AT-modifier guard family, :28-43)
- Grid window-scroll keys + scroll-into-view: `src/grid/renderer.ts`
  keydown (the grid-key scope) + `src/grid/keynav.ts` (window math is pure
  and unit-testable — clamp + focus-anchor live here)
- Announcements: strip value span + rail per-lane status + stage status
  region (selection.ts:120-137) — the E8–E12 gate list in
  docs/dev/accessibility.md §9 names each assertion when it lands
