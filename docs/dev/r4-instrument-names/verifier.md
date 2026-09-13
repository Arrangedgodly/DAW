# R4 independent verifier

Disposition: PASS — R4 may be approved in auto mode.

Criterion: current visible instrument category agrees with spoken names while stable track identity distinguishes duplicate categories. Scope is instrument editor and connected runtime control/arrangement names; no redesign or musical-model change.

## Independent source review

createLaneAccessibleNames in src/state/laneDisplayNames.ts reuses the reactive display-name accessor and adds the index in ALL_LANE_IDS as a stable track number. It follows document lane/preset changes and releases its subscription with the Solid owner. Category-first examples are Keys, track4 and Keys, track8.

LaneHeader, LaneGrid, PhoneOptions, StageFloor, TrackColorControl, FxStrip and PatternRail use the shared accessor for their relevant regions, controls, selectors, phone tabs, status/chain labels and grid names. This resolves the prior visible Keys versus spoken LEAD mismatch and distinguishes duplicate phone tab names. PatternRail was checked again after its update; it now uses the shared names for song chain, slots and tools rather than fixed LANE_NAMES.

The imperative grid renderer's setLaneLabel is idempotent and updates its existing aria-label using gridAriaLabel. It does not recreate cells, alter note data or restart the renderer. The existing editable/range semantics remain in the name. LaneGrid's reactive effect forwards the current accessible name. Stable data-lane IDs remain lead/extra4 rather than following changing categories.

## Behavior and visual evidence

Independently reviewed final scripts/verify-r4-names.mjs and completed evidence.json, plus editor AX extracts and song-ax.txt. Four cases cover original lead and extra4 at1280x800 desktop and390x844 phone. Each uses Keys/Reed Organ and Bells/Vibes within the same existing pitch domain, then returns to Keys. Assertions establish:

- Visible category, region, grid, preset selector and mute/solo accessible names update on all three transitions.
- Exactly three document writes correspond to the three user preset changes; pattern object identity stays unchanged.
- The same grid DOM node persists and exactly one roving gridcell tab stop remains.
- Stable lane IDs and track4/track8 suffixes remain intact.
- Phone duplicate Keys tabs are distinguishable as track2/4 and track5/8; phone Transpose names include the selected category and track.
- Song arrangement exposes the matching Keys, track4 chain name.

All four JSON cases report writes3,patternsSame true,tabStops1 and correct category/track grid names. AX evidence for extra4 begins region Keys, track8, matching visible Keys, Mute/Solo, sound and preset labels. Independently viewed final-1280x800-extra4.png: duplicate Keys headings retain existing Membrane appearance and four complete grids/footers fit the viewport. Runtime naming changes do not introduce visible layout growth into the normal control rows.

## Checks

Independent narrow check: .\\node_modules\\.bin\\vitest.cmd run --project unit tests/instrument-feedback.test.ts tests/extra-instruments.test.ts. Exit0,8/8tests in2files passed at23:32:57 local on2026-09-12. This verifies existing category mapping and extra-instrument model behavior; it is not a substitute for the browser rename assertions above.

Worker and root final readiness report focused browser probe,typecheck,full lint and production build pass. Reused those completed checks; no unrelated legacy exact-label test failures were rerun and no tests were weakened by verifier. R1/R2/R3 were not re-executed.

## Limits

Browser evidence is reused worker proof independently reviewed against the probe/source, not a second concurrent browser run. Grid-node stability is proven for category changes within the same pitch domain. Existing changes to a preset with a different pitch-domain key may legitimately remount the grid; this behavior was not altered and universal preset-node preservation is not claimed. Screen-reader speech,physical audio and all legacy static help/status wording are outside this bounded runtime naming verification. R1-R3 preservation is supported by current source and final captures, not complete repeated historical matrices.

No remaining R4 blocker. No UI edits,server changes,commit or deployment by verifier.
