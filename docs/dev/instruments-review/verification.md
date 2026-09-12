# Instrument expansion verification

Implemented on 2026-09-12. Local changes only.

- 58 shared pitched presets, including 16 new synthesized sounds; 14 existing drum kits.
- Native grouped preset dropdowns and minus/plus stepping use the same preview and store action.
- Four optional pitched tracks, independently editable from Instruments; eight active rows in Song arrangement.
- Save/load round trip, four-track compatibility, orphan-data rejection, removal, undo and slot reuse covered in tests/extra-instruments.test.ts.
- Full unit suite: 91 files, 1,780 tests passed. After the playback-history fix, 28 focused session, engine bridge and extra-track tests passed again.
- Real Chromium preset suite: all 3 tests passed, rendering every pitched preset and drum voice through the audio engine.
- scripts/verify-instruments.mjs passed: named selection, adjacent stepping, four additions, note-grid writes, eight song rows, live notes from each extra lane, offline audio export, middle-track removal and playback restart, undo restoring scheduling, removing every extra track through the phone UI, and adding again. No page errors. Eight-track export had finite audio, peak 0.843759 and 756,000 samples for the demo's cycle.
- Desktop 1440x900 and phone 390x844 screenshots inspected. Phone has no horizontal page overflow. Native controls retain keyboard interaction. Final header rule allows controls to wrap rather than overlap long track names.
- TypeScript, ESLint and production build passed. The design detector reported only three advisory colors in existing lane-header rules.

Limits: the visualizer continues to display the original four tracks. Extra tracks are pitched instruments, not additional drum kits. New bell and horn sounds are synthesized; no new recorded sample assets were downloaded.

Run the UI regression against a fresh Vite server on port 5199 to avoid HMR creating duplicate module instances for the test's explicit imports. The script uses an isolated browser context and saves screenshots in this folder.

## Quadrant editor update

The Instruments workspace now reuses the first editor's 2x2 stage and MIDI-grid sizing. Four empty quadrant buttons create the exact clicked track slot; out-of-order additions remain in slot order. Populated quadrants select on click and have the shared LaneGrid and LaneHeader controls. The old page title, top-level add button, instrument cards and full-width single editor are removed. Phone uses a single grid with four track buttons. Removal sits in the selected header and remains undoable.

Verification: the real-browser instrument script passed against the revised UI, including out-of-order quadrant additions, painted notes, eight arrangement rows, live audio/export, middle-track removal/restart/undo and removing/re-adding all tracks. Desktop and phone screenshots were reviewed. The new exact-slot store regression passed. TypeScript, lint and production build passed.

## Navigation and layout follow-up — 2026-09-12

- Desktop order: Instruments 1–4, Instruments 5–8, Song arrangement.
- Mobile header supports all eight track tabs, adds up to four optional tracks, and uses one SONG/NOTES button. Browser checks cover removal/re-addition, keyboard Home/End, viewport transitions and retaining the active track through Song.
- Removed View/Edit title labels. Selected titles use their lane color. Desktop compact headers have two explicit rows and each measures 68px at 1293×1272.
- Mobile Song titles are centered above wrapping tiles. At 506×1272 the four sections measure about 140px each with 12px gaps; titles are exactly centered. Checked horizontal overflow at 360, 390 and 506px with reduced motion.
- Fixed selected mobile track removal by switching selection before deferring deletion until the editor unmounts; missing-lane store notifications are ignored by the outgoing header.
- Final browser instrument regression: no page errors; all four extra lanes deliver live note events; eight-lane export contains finite, nonzero audio.
- TypeScript, scoped ESLint and production build pass. Unit suite: 91 files / 1781 tests pass.
- Impeccable scan flagged four existing literal-color advisories in membrane.css; these layout changes use existing theme tokens.

## Playback follow, all-track meters and color repair — 2026-09-12

- Reproduced the two-bar playback bug: scrollLeft stayed 0 throughout playback. The renderer now advances its horizontal viewport before the sounding column leaves view and returns to the start on wrap. It handles eager and virtualized scroll owners, pauses for active note/pinch gestures, and does not set vertical scroll or keyboard focus.
- Browser regression passed for desktop drums, desktop extra1 and reduced-motion phone extra1: nonzero horizontal movement, return to zero on loop, manual scrolling retained when stopped. The long-pattern test confirmed four eight-bar drum slots, scrollLeft 768, clientWidth 600, scrollWidth 4168 and 210 pooled grid cells. Restart Vite before scripts that dynamically import the store to avoid duplicate HMR module instances.
- Booth meters derive their lane list from the document. Each dynamically mounted bar registers/unregisters independently with the existing audible-note bus. Eight-track display uses two columns/four rows within a 50px status display. Browser checks verified fit, add/remove and actual extra-track animation.
- Reproduced color bug: selected #ffb3b3 was saved, but lane hue computed #e8eff2. Extra-lane selectors now outrank the generic floor fallback. The picker, computed hue and reload persistence match. Shared selectors cover titles, grids, tabs and arrangement rows.
- TypeScript, scoped ESLint and production build pass. Latest unit suite during concurrent persistence work: 1789 passed, 5 failures in demoSong boot and hu3 deletion tests. An attempted handoff to the separate release task was rejected by automatic approval review; no message was sent. Earlier codec fuzz timeout passed in isolation. Do not claim an all-green full suite for this snapshot.
