# Current test contracts

Updated 2026-09-20 for the separate Mixer workspace, retained clip overflow,
expanded drums, and direct instrument controls.

## Run the release checks

Use the repository scripts: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:browser`, `npm run build`, then `npm run check:bundle`.
On hosts where the npm wrapper cannot spawn, invoke the local tools through
Node; for bundle measurement after a successful build set `SKIP_BUILD=1`.

The unit project limits parallel workers to four so dense-document fuzz work
does not compete across every CPU core. Browser files run serially, headless
by default. Set `HEADED=1` for interactive diagnosis. Avoid concurrent browser
benchmarks, builds, or source edits during a release run.

Browser global setup builds the production app. Built-app journeys load that
bundle; source-mounted tests inspect store and engine behavior directly.
These are complementary checks, not interchangeable proof.

## Behavior the fixtures must preserve

- **Workspaces:** Instruments holds sound selection and note editing; Song
  holds arrangement and pattern tools; Mixer owns creative FX, EQ, compression,
  pan, levels, and master processing. Explicitly navigate before querying a
  workspace's controls. Playback continues across navigation.
- **Names:** Accessible instrument names include the sound family and track
  number. Windowed grid labels also describe the current rows. A sound change
  can change its family; use a lane-scoped query when that change is incidental
  to the behavior under test.
- **Clip lengths:** Shrinking hides later notes or hits, retaining their original
  positions and durations in serialized state. Manual growth restores them.
  Double has separate overwrite semantics. Exercise save/load and undo/redo,
  including notes that cross a boundary.
- **Drums:** All sixteen pieces are part of current documents; legacy documents
  may omit extension rows. A drag creates one hit with a duration. Assert both
  its anchor and its stored length instead of expecting several painted hits.
  GATE/ONE-SHOT is independent of hit length.
- **Layout:** Every instrument exposes its direct controls. The drum window uses seven rows
  on short desktop viewports and eight on taller viewports. Phone pages may scroll vertically;
  controls and the final grid row must remain reachable, and the page must not
  overflow horizontally. Keyboard order treats the windowed grid as a composite
  control and the fixed save status as a footer.
- **Export:** WAV includes the deliberate effects tail. MIDI export belongs to
  an individual pattern in Song. Check file content and length, not the removed
  project-wide MIDI button.
- **Help:** New interactive surfaces need registered help and runtime bindings.
  Include their raw component sources in the registry audit as well as walking
  mounted desktop and phone controls.
- **Touch:** Trusted CDP input must map through both test iframe transforms.
  Restore touch emulation after every test, including failures.

## Performance and audio evidence

The frame target remains at least 95% within the 33.4 ms budget. Pointer dispatch
and callback-gap limits remain unchanged. The visualizer measures cadence with
`requestAnimationFrame` timestamps, rounded to Chromium's 0.1 ms precision:
a normal two-refresh interval can be reported as exactly 33.4 ms. It separately
keeps the unrounded `performance.now()` callback-gap guard below 50 ms.
Canvas activity is checked outside the timed window because pixel readback
(`drawImage` / `getImageData`) synchronizes drawing. Deliberately injected 70 ms
work must still fail the same cadence gate. The visualizer fixture pins the
shipped default composition and restores saved preferences afterwards, while
manual scroll benchmarks explicitly hold an interaction so playback follow
does not fight their scroll positions.

The release repair also addresses actual work on the hot paths:

- Each note grid composites independently during smooth playback scrolling.
- Horizontal scroll-end does not rebuild an already seated vertical register.
- Covered instrument grids stop painting while audio continues.
- FFT stages reuse double-precision coefficients; a direct complex-transform
  comparison checks correctness across repeated and mixed sizes.
- Particle tails and equal-opacity particles share drawing operations.
- Geometry reuses coordinate scratch and constant trigonometry instead of
  allocating a new tuple for each plotted point.
- Note edits preserve the manually selected register during playback.

Mixer unit tests cover normalization, persistence, bounded automatic gain/EQ
changes, locks, silent inputs, and preview/apply state. Browser audio tests
exercise the shared processing graph. `node docs/dev/mixer-smoke.mjs <url>`
checks the real UI, audio meters, page switching, automatic analysis,
before/after preview, apply/restore, and desktop/phone/tablet geometry.

Passing automated audio checks proves measured behavior. It does not replace
a listening review or physical-device testing.

The historical column-window prototype benchmark is retired from the release
suite. Its test-only renderer still exists in `tests/lp1-spike-harness.ts` for
reference. The production dense-128 benchmark retains the frame ratio, DOM
size, native scroll extent, playhead liveness, and edit-block limits against
`src/grid/renderer.ts`. The existing Linux CI exception for the production
scroll-sweep ratio is unchanged; all other production frame gates remain active.

Quiet-frame calibration now drops exactly one warm-up tick and records subsequent
samples. Previously it never recorded any samples and always waited its entire
20-second timeout. Editing during playback also has an explicit regression for
preserving the user's pitch register, and accessibility audits cover both themes.

The desktop 200-edit cadence check uses rounded browser rAF timestamps with the same 33.4ms budget as VIZ, while measuring every edit callback separately against the 50ms blocking guard. Mixer coverage includes horizontal card geometry, master effects save/reorder/bypass/remove/undo, output filtering and preserving later FX edits when restoring Auto Mix.

Hosted CI runs general browser checks on Ubuntu and the MP4 export plus three
trusted-touch files on macOS 15. The Linux browser rejected native MP4 encoding
on the actual release run; those five success-path tests must run where the
required codecs exist. The macOS job also covers the four touch journeys that
previously skipped Linux. Together the jobs execute all 263 browser tests;
no encoding assertion is mocked or removed.
