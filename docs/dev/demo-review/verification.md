# Built-in demo verification

2026-09-12

Welcome Song remains the first-run default. Its source factory and boot path were not changed. A new test checks that the library copy encodes to identical bytes.

Glass Arcade: C major, 122 BPM, eight bars. Crystal bells carry the hook; zither answers it; brass arrives in LIFT and part of TURN; a riser marks the later transitions.

After Hours: D minor, 88 BPM, 22% swing, eight bars. Horns enter after ROOM; vibes leave space during HORNS; dulcimer and wind frame the opening and ending.

Both use eight independent lanes, four two-bar section slots, named cues, per-lane volume, reverb and selected delay/filter effects. Pitched data is editable note content, not rendered backing audio. Each library selection saves a fresh project id before retargeting autosave and loading.

Validation:
- 92 unit test files, 1784 tests passed, including original demo tests and new codec/arrangement/preset/independent-copy checks.
- TypeScript and production build passed.
- Browser opened each demo from Projects, confirmed all eight lanes, distinct saved ids, and retained Welcome Song and Glass Arcade after opening After Hours. No page errors.
- Desktop and 390px phone picker screenshots inspected. No horizontal overflow. Keyboard focus includes the summary and excludes demo buttons while collapsed.
- Actual offline engine renders: Glass Arcade peak 0.8625, RMS 0.2873; After Hours peak 0.8845, RMS 0.2707. All samples finite. These are technical audio checks, not a listening review.
- WAV previews: glass-arcade.wav and after-hours.wav in this directory. Preview exports are review artifacts; the app ships the editable composition data.
- Impeccable detector returned no findings for the picker component and styles.
