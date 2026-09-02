# Keyboard Interaction Spec (DA-1)

The complete keyboard map for Bitbounce. Contract sources: ARIA APG grid
pattern (res-1 — roving tabindex, arrow navigation, grid roles) and the
a11y rules of res-9/D9 (focus-visible styles, never color/glow alone).
Law: **every edit action is reachable from the keyboard alone** (Daredevil).

## Focus model — regions and tab stops

The screen is a stack of composite regions. Each composite region exposes
**exactly one Tab stop** (roving tabindex, APG); Tab walks region to region,
arrows walk *inside* a region:

| Region | Tab stops | Arrows inside |
|---|---|---|
| Booth (transport) | native controls (few; documented linear strip) | native (ranges, steppers are buttons) |
| Pattern rail — tiles, per lane | 1 (focused tile) | ←/→ along the chain, Enter triggers |
| Pattern rail — tools, per lane | native buttons | native |
| Lane header, per lane | 1 (roving group, see below) | ←/→ across the header controls |
| Lane grid, per lane | 1 (focused cell) | the grid map below |
| Help overlay | 1 (dialog, focus-trapped) | native inside |

- **Roving seed**: first item of each region is the Tab stop until the user
  moves; moving roving updates `tabIndex` only (never reorders DOM).
- **Escape pops to the region head**: in a lane grid, Escape moves focus to
  the lane header's first control (the header is the grid region's head);
  in the rail, Escape focuses the rail head (view toggle). Inside popovers
  and inline edits, Escape cancels first (existing DES-3/DES-6 behavior).
- Focus rings follow D9: `:focus-visible` outlines in the lane hue over the
  ground, never glow-only.

## Grid map (inside one lane's grid, on a focused cell)

Pure math lives in `src/grid/keynav.ts`; bounds clamp (no wrap — see
"Wrap rules").

| Key | Action |
|---|---|
| ← / → | move one step (clamp at row ends) |
| ↑ / ↓ | move one row (clamp at top/bottom row) |
| Home / End | first / last step of the current row |
| PageDown / PageUp | jump to the same cell position in the next / previous lane |
| Ctrl+↓ / Ctrl+↑ (or `]` / `[`) | move to next / previous lane (same position, clamped to its rows) |
| Ctrl+→ / Ctrl+← (or `.` / `,`) | beat jump: ±4 steps (one 4/4 beat), clamped |
| Enter / Space | toggle the cell (audition fires on placement, DES-4) |
| Shift+Enter | audition the focused cell WITHOUT toggling |

Lane moves keep the row *index* (clamped to the target grid's row count)
and the step (clamped to its pattern length); drums rows map by position,
pitched rows by position into that lane's own degree rows.

## Pattern ops (global, when not typing in a text field)

| Key | Action |
|---|---|
| `n` | new 1-bar pattern in the active lane (selects it for editing) |
| `d` | duplicate the active lane's selected pattern (selects it) |
| `r` | rename — moves focus to the active lane's rail REN control (the inline field takes over from there; Enter commits, Esc cancels per DES-6) |

Rail-local keys (DES-6, unchanged): ←/→ rove tiles, Enter/Space trigger a
quantized switch, Delete/Backspace removes the chain slot, F2 renames, `l`
edits the cue, `+` appends a slot.

## Transport

| Key | Action |
|---|---|
| Space | play/stop — **only when focus is not on an interactive element** (body/document level). Inside a grid, Space toggles the cell instead (APG grid law); on a focused button it activates the button natively. |
| Enter on PLAY | play/stop (native button activation in the booth) |

Rationale: a global Space would hijack buttons and the grid; the booth PLAY
button plus body-level Space cover both "just started" and "deep in the
grid" contexts without conflict.

## Undo

| Key | Action |
|---|---|
| Ctrl+Z (⌘Z) | undo (zundo, limit 50, coalesced gestures — IM-6) |
| Ctrl+Shift+Z (⌘⇧Z) / Ctrl+Y | redo |

Skipped while typing in a text entry (inline rename/cue fields, the tempo
input) so native text undo is preserved.

## Euclid fill (PX-3, when a fill control is focused)

Arrows on the steppers adjust pulses/rotation natively (real buttons);
Enter on SET commits the painted row; Escape cancels the preview. No
additional bindings — the fill controls are plain focusable buttons.

## Help overlay

| Key | Action |
|---|---|
| `?` (Shift+/) | open the in-world help overlay listing every binding above |
| Escape or CLOSE | dismiss; focus returns to the opener |

The overlay is a `role="dialog"` `aria-modal`, focus-trapped (Tab cycles
inside), dismissible. Also opened by the booth **KEYS** button (mouse parity).

## Deliberate exclusions (never hijacked)

These browser / screen-reader keys are NEVER intercepted anywhere:
- Tab / Shift+Tab — region traversal (only tabindex roving, never swallowed)
- the screen-reader virtual-cursor pass-through keys (quick-nav keys,
  browse-mode letter navigation) — letter shortcuts (`n`, `d`, `r`, `?`, `l`)
  only fire on real keydown targets that are NOT text-entry elements, and are
  skipped whenever an assistive-tech modifier is held; ARIA grid roles keep
  the SR cursor in application mode inside grids
- Ctrl/Cmd+C, V, X, A, F, L, T, W, R — clipboard/browser shortcuts untouched
- F1–F12 except F2 (rename, DES-6 — standard grid rename key per APG)
- browser zoom (Ctrl+/-/0), devtools (F12, Ctrl+Shift+I/J/C)
- Insert, PrintScreen, CapsLock state, IME composition events

## Wrap rules

No wrapping anywhere: arrows, Home/End, beat jumps and lane moves all clamp
at their bounds. The playhead wraps (the loop), but focus never does — a
wrapped cursor a screen-reader user cannot predict is worse than a hard
edge. PageUp at the first lane stays there; Ctrl+→ at the last beat stays.

## Where things live

- Pure next-cell math: `src/grid/keynav.ts` (unit-tested incl. lane bounds)
- Grid keydown handling: `src/grid/renderer.ts` (`DomGridRenderer`)
- Cross-lane focus coordination: `src/state/gridFocus.ts`
- Global shortcuts + help overlay: `src/components/KeyboardShortcuts.tsx`,
  `src/components/HelpOverlay.tsx`, `src/state/helpOverlay.ts`
- Lane-header roving group helper: `src/lib/rovingGroup.ts`
