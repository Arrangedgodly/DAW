# Keyboard Interaction Spec (v2 — IN-1)

The complete keyboard map for Bitbounce. Contract sources: ARIA APG grid
pattern (res-1 — roving tabindex, arrow navigation, grid roles) and the
a11y rules of res-9/D9 (focus-visible styles, never color/glow alone).
Law: **every edit action is reachable from the keyboard alone** (Daredevil).
Iteration-2 law (town-hall assumption, I2-*): **pointer drags NEVER replace
keyboard paths — both are required.** Every gesture IN-2/IN-3 build for the
pointer has a key-for-key equivalent in this spec, and every state change a
drag can produce is announced identically when driven by keyboard
(drag-equivalent announcements, docs/dev/accessibility.md §7).

**Version status.** v2 extends the shipped v0 map (DA-1/DA-3) for the
iteration-2 quadrant layout and note model. Sections marked
**[v2 · live since LY-1]** are IMPLEMENTED and gated (LY-1 landed the
quadrant selector, strips, announcements, and focus-carry law — asserted in
tests/browser/quadrant-layout.test.ts + the updated DA-1/DA-3 journeys).
Sections marked **[v2 → IN-2]**, **[v2 → IN-3]**, **[v2 → HP-1]** remain the
forward contract the named task must implement and test (its DoD); everything
else is live law today. v0 sections that v2 supersedes say so inline and the one
deliberate v0-journey change is recorded in the ledger at the bottom
(regression rule: journey updates only alongside deliberate UX changes).

## Focus model — regions and tab stops

The screen is a stack of composite regions. Each composite region exposes
**exactly one Tab stop** (roving tabindex, APG); Tab walks region to region,
arrows walk _inside_ a region:

| Region                             | Tab stops                                       | Arrows inside                                            | Since |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------- | ----- |
| Booth (transport)                  | native controls (documented linear strip)       | native (ranges, steppers are buttons)                    | v0    |
| Booth INFO "?" toggle (help mode)  | native button                                   | native                                                   | v2 → HP-1 |
| Pattern rail — tiles, per lane     | 1 (focused tile)                                | ←/→ along the chain, Enter triggers; Shift+arrows extend a multi-clip range [v2 → IN-3] | v0 + v2 |
| Pattern rail — tools, per lane     | native buttons                                  | native                                                   | v0    |
| Quadrant control strip, per lane   | native controls (preset/kit stepper, VOLUME range, MUTE, SOLO) — **all four quadrants' strips stay tab-reachable even when their grid is view-only** [v2 · live since LY-1] | native                                                   | v2 → LY-1 |
| Lane grid, **selected quadrant**   | 1 (focused cell)                                | the grid map below                                       | v0    |
| Lane grid, **view-only quadrant**  | **none** — no tab stop, no focusable descendant (not a focus trap) [v2 · live since LY-1] | n/a (view only)                                          | v2 → LY-1 |
| Info region (help mode on)         | **none** — role=status, never focusable, never in the tab order [v2 → HP-1] | n/a                                                      | v2 → HP-1 |
| Help overlay (keyboard shortcuts)  | 1 (dialog, focus-trapped)                       | native inside                                            | v0 — unchanged, SEPARATE from info mode |

- **Roving seed**: first item of each region is the Tab stop until the user
  moves; moving roving updates `tabIndex` only (never reorders DOM).
- **Escape pops to the region head**: in a lane grid, Escape moves focus to
  the quadrant strip's first control (the strip is the grid region's head);
  in the rail, Escape focuses the rail head (view toggle). Inside popovers
  and inline edits, Escape cancels first (existing DES-3/DES-6 behavior).
  **While help mode is ON, Escape first exits help mode** (cancel-first,
  like popovers); the region-head pop applies only when it is already off
  [v2 → HP-1].
- Focus rings follow D9: `:focus-visible` outlines in the lane hue over the
  ground, never glow-only.

## Quadrant selection [v2 · live since LY-1] — selection IS the lane selector

The 2×2 quadrant layout (I2-1): one quadrant per lane, quadrant selection =
`selection.activeLane` (ephemeral signal, never document). The selected
quadrant's grid is editable; the other three render view-only with live
notes + playhead.

| Key                                | Action                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| PageDown / PageUp                  | select next / previous quadrant (order drums → bass → chords → lead = visual reading order; clamped, never wraps) |
| Ctrl+↓ / Ctrl+↑                    | same as PageDown / PageUp (v0 alternates, kept)                                                    |
| `]` / `[`                          | same, and ALSO inside quadrant control strips (see scope rule below)                               |
| Click on any part of a view-only quadrant | pointer path: selects that quadrant (mouse parity; grid or strip)                            |

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

## Grid map (inside the selected quadrant's grid, on a focused cell)

Pure math lives in `src/grid/keynav.ts`; bounds clamp (no wrap — see
"Wrap rules"). Rows = drum pieces (drums) or scale degrees (pitched).

| Key                            | Action                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| ← / →                          | move one step (clamp at row ends)                                     |
| ↑ / ↓                          | move one row (clamp at top/bottom row)                                |
| Home / End                     | first / last step of the current row                                  |
| PageDown / PageUp              | **v2: select next / previous quadrant** (v0: lane move — superseded; see ledger) |
| Ctrl+↓ / Ctrl+↑ (or `]` / `[`) | **v2: select next / previous quadrant** (v0: lane move — superseded; see ledger) |
| Ctrl+→ / Ctrl+← (or `.` / `,`) | beat jump: ±4 steps (one 4/4 beat), clamped                           |
| Enter / Space                  | toggle — drums: hit on/off; pitched: the note law below               |
| Shift+Enter                    | audition the focused cell WITHOUT toggling (v0 law, kept)             |
| `+` / `=` and `-` / `_`        | **[v2 → IN-2]** pitched only: resize the focused note ±1 step         |
| Shift+`+` / Shift+`-`          | **[v2 → IN-2]** pitched only: resize the focused note ±0.25 step (the snap-law floor) |
| Delete / Backspace             | **[v2 → IN-2]** pitched only: remove the focused note (grid-region-local; the rail's Delete removes a chain slot in its own region — same key, different region, v0 precedent) |

Quadrant selection keeps the carried row _index_ and step (clamped to the
target grid's row count and pattern length); drums rows map by position,
pitched rows by position into that lane's own degree rows (v0 carry law).

## Note editing on the v2 note model [v2 → IN-2]

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
  zero-store-write preview + commit-on-release (IN-2), each keypress is its
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

## Rail multi-clip cue selection [v2 → IN-3]

v0 rail law unchanged: ←/→ rove tiles, Enter/Space trigger a quantized
switch on the focused tile, Delete/Backspace removes the slot, F2 renames,
`l` edits the cue, `+` appends. The multi-clip drag (one gesture across N
clips queues exactly those N, identical pending/quantized semantics as
clicking individually — one queued switch per touched lane) gets this
keyboard path:

| Key                    | Action                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Shift+← / Shift+→      | extend a selection RANGE along the focused lane row (anchor = where the shift began)          |
| Shift+↑ / Shift+↓      | extend the range to the same slot position (carried, clamped to each row's length) in the adjacent lane row(s) |
| plain ← / → / ↑ / ↓    | still rove focus and COLLAPSE the range to the focused tile (cancel-extend)                   |
| Escape                 | collapse the range to the focused tile (no chain edit happened)                               |
| Enter / Space          | **CUE ALL**: commit the range — for every lane row the range touches (top→bottom), fire `requestPatternSwitch` on that row's tile at the range's focus-edge column, clamped to the row's length |

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

| Key | Action                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `n` | new 1-bar pattern in the active lane (selects it for editing)                                                                             |
| `d` | duplicate the active lane's selected pattern (selects it)                                                                                 |
| `r` | rename — moves focus to the active lane's rail REN control (the inline field takes over from there; Enter commits, Esc cancels per DES-6) |
| `i` | **[v2 → HP-1]** toggle help mode (info view) — same guards as `n`/`d`/`r` (never in text entries, never with an assistive-tech modifier)   |

Rail-local keys (DES-6, unchanged): ←/→ rove tiles, Enter/Space trigger a
quantized switch, Delete/Backspace removes the chain slot, F2 renames, `l`
edits the cue, `+` appends a slot.

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

## Help mode (info view) [v2 → HP-1]

Ableton-style info view (I2-6), SEPARATE from the keyboard-shortcut overlay
above, which stays unchanged.

| Key                          | Action                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| booth "?" INFO button        | toggle help mode (real button, Tab + Enter — the mouse-parity path)                            |
| `i`                          | toggle help mode from anywhere (guards: not in text entries, no AT modifiers held)              |
| Tab / arrows (while ON)      | normal navigation — focus any registered control; the info region updates on FOCUS, not just hover (the Daredevil law: help mode must respond to keyboard focus) |
| Escape (while ON)            | exit help mode (cancel-first; focus stays where it was — nothing was trapped)                   |
| `i` or the button (while ON) | exit help mode; announcement `INFO MODE OFF`                                                    |

- **No trap, no modal:** help mode is a mode, not an overlay — every control
  stays reachable and operable; the info region itself is `role="status"`
  `aria-live="polite"`, NOT focusable, NOT in the tab order (a non-interactive
  status region cannot trap anything; pointer pass-through onto the stage is
  HP-1's recorded production decision).
- **Announcements (a11y gate E6):** toggling announces `INFO MODE ON —
  FOCUS A CONTROL TO HEAR WHAT IT DOES` / `INFO MODE OFF`; each focused
  registered control's help text is spoken (and shown) once per focus move —
  no repetition while focus rests.
- Toggling help mode mid-gesture must not corrupt an active drag (gesture
  completes or cancels cleanly — verified by IN-4).
- Zero per-frame cost while OFF (Thor, TH-4 c): listeners attach only while
  the mode is on.

## Deliberate exclusions (never hijacked) — unchanged v0

These browser / screen-reader keys are NEVER intercepted anywhere:

- Tab / Shift+Tab — region traversal (only tabindex roving, never swallowed)
- the screen-reader virtual-cursor pass-through keys (quick-nav keys,
  browse-mode letter navigation) — letter shortcuts (`n`, `d`, `r`, `i`, `?`,
  `l`) only fire on real keydown targets that are NOT text-entry elements,
  and are skipped whenever an assistive-tech modifier is held; ARIA grid
  roles keep the SR cursor in application mode inside grids
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
0.25 stays; Shift+↑ at the top lane row stays.

## Coverage review (AC: no keyboard path missing for any new gesture)

Every gesture iteration 2 introduces, reviewed against this spec — the table
IN-1 ships as the no-missing-path proof; owning tasks implement + test the
path as DoD:

| New gesture (pointer/world)                                | Keyboard path (this spec)                                                                 | Owning task |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| Select a quadrant by clicking it                           | PageUp/PageDown, Ctrl+↑/↓ (grids), `]`/`[` (grids + strips)                               | LY-1        |
| Tweak any lane's preset/VOLUME/MUTE/SOLO without selecting | all four strips stay tab-reachable; native range/button keys                               | LY-1        |
| View-only quadrants show live notes/playhead               | no keys needed — no tab stop, no trap; names carry VIEW ONLY                               | LY-1        |
| Place a note with gate-default length (single click)        | Enter/Space on an empty cell                                                               | IN-2        |
| Drag-create a sustained note across segments               | place (Enter), then `+`/`=` to lengthen (or Enter mid-span to trim)                        | IN-2        |
| Edge-drag resize a note                                    | `+`/`-` (±1 step), Shift+`+`/`-` (±0.25) on the focused note; Enter mid-span = trim to here | IN-2        |
| Remove a dragged note                                      | Enter at its anchor, or Delete/Backspace on the focused note                               | IN-2        |
| Drums drag-paint hits across steps                         | per-cell Enter toggles (v0) + euclid fill rows (PX-3) — reviewed, deliberately NO new binding (one-shot law, I2-4) | IN-2 |
| Multi-clip drag cueing across lanes                        | Shift+arrows range-select on the rail, Enter = CUE ALL                                     | IN-3        |
| "?" corner toggle for info mode                            | booth INFO button (Tab+Enter) + global `i`                                                 | HP-1        |
| Hover a control to read its help text                      | focus it — info region updates on focus, aria-live speaks it                               | HP-1        |

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
   carry note start/length. No key changes on drums.
3. **New bindings** (additive, none replaces a v0 binding): grid `+`/`-`/
   Shift+`+`/`-`/Delete-removes-note (IN-2); rail Shift+arrows range-select
   (IN-3); global `i` help-mode toggle + Escape-exits-help-first (HP-1).
4. Everything else in the v0 map — one-Tab-stop regions, no-wrap, text-entry
   guards, body-level Space transport, Shift+Enter audition, Home/End, beat
   jump, `n`/`d`/`r`, rail-local keys, undo guards, the exclusion list —
   carries into v2 unchanged.

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

| #   | Step (keys)                                                                          | Observable outcome asserted                                                                                                                           |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Boot (no keys — first run)                                                           | booth mounts, 4 grids, demo cue labels (VERSE) in the rail                                                                                            |
| 2   | `Space` at body level                                                                | PLAY aria-pressed → true (transport runs)                                                                                                             |
| 3   | `?` … inspect … `Escape`                                                             | role=dialog help overlay, focus trapped inside, dismissed                                                                                             |
| 4   | Focus drums roving seed → `↓` `End` `Home` `.`                                       | SNARE row, step 15 → 0 → beat-jump to 4                                                                                                               |
| 5   | Tab to SNARE fill rail → `Enter` on `+` pulses ×2 → `Enter` on SET                   | readout counts p/16, dashed data-preview overlay, then the row paints exactly p on-cells and preview clears                                           |
| 6   | `Enter` on a focused cell                                                            | data-on / aria-selected flips                                                                                                                         |
| 7   | `PageDown`                                                                           | focus lands in the BASS grid (position carried, clamped) — **v2: becomes "selects the BASS quadrant + announces"; LY-1 updates this step (ledger #1)** |
| 8   | Header strip: `Enter` on preset `+`, gate `+`                                        | preset name changes; gate value steps 1 → 2 ST                                                                                                        |
| 9   | `Enter` on the scale chip → pick root D + mode DORIAN → OVERRIDE LANE                | popover opens focused, closes on commit; chip becomes LANE · D DOR (is-lane). Cancel path: reopen + `Escape` → closed, focus back on the chip         |
| 10  | `Enter` on FX → `Enter` + ADD FX → `Enter` first device → arrows on the CUTOFF range | strip opens; menu opens WITH focus inside (fixed in DA-3); 3rd module appears; readout + aria-valuetext track the stepped value                       |
| 11  | Rail: focus tile 1 → `→`×3 → `Enter`                                                 | tile shows PENDING (◆ / aria "switch pending"), then lands ACTIVE/selected on the chain boundary while still playing                                  |
| 12  | `Space` (stop) → `Enter` on DUP → focus last tile → `+` → `Escape`                   | play stops; pattern pool grows; chain gains a tile with focus moved onto it (fixed in DA-3); Escape pops to the rail head (view toggle)               |
| 13  | `Enter` PROJECTS → `Enter` EXPORT WAV → EXPORT MIDI                                  | RENDERING… → "WAV EXPORTED" toast + audio/wav blob download; "MIDI EXPORTED · 5 TRACKS" + audio/midi blob (recorded via the URL.createObjectURL seam) |
| 14  | `Enter` NEW … then reopen popover → `Escape`                                         | "NEW PROJECT READY" toast, empty-stage hint "PICK A PRESET · PAINT THE GRID"; Escape exits the focus trap with focus returned to the PROJECTS button  |

Gaps the walk found (fixed in DA-3, all in this repo):

- **FX add menu ignored the keyboard menu conventions** — opening it left
  focus on the + button and nothing closed it on Escape. Now: focus lands on
  the first menu item on open (also reachable via ArrowDown on the entry),
  Escape closes and refocuses + ADD FX (src/components/FxStrip.tsx).
- **`+` append existed only as a mouse button** — the spec's rail-local `+`
  key was never implemented. Now `+`/`=` on a focused tile appends the
  selected pattern (src/components/PatternRail.tsx).
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
