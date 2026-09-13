# R3 optional phone Help

Status: implemented; finish reviewer disposition `ship`; independent verifier `PASS`. R1/R2 remain approved; R4 is outside this change.

## Decision record

Simulated (auto mode), derived from the approved scope and PRODUCT.md: help is optional, stays in Options, and offers a small topic picker for a novice making a loop. Reuse registered explanations. No forced tutorial, modal onboarding, new undo controls, or requirement to change music to inspect a control.

Options contains a44px Help button. Opening Help replaces the drawer's options content with a native44px topic picker and readable14px text. Close help returns to Options. Escape first closes Help and focuses its trigger; the next Escape closes Options and returns focus to OPTIONS. An outside tap uses the existing Options backdrop. Play and navigation remain in the sticky header. Longer explanations have a bounded keyboard/touch-scrollable text region.

Topics: Draw notes, Scroll the grid, Back/Forward, active pitched instrument View Oct/View Semi and Transpose (Oct), Filter LP/HP/BP/Q, BYP, and effect parameters. Drums omit pitched topics. Topic text is resolved with getHelp rather than copied into the panel. Filter and bypass explanations were clarified in their existing registry owner; extra instrument register-view entries were added at their existing control owner.

## Files

- `src/components/PhoneOptions.tsx`: optional help UI, local state, topic selection, registry lookup, close/focus behavior.
- `src/components/LaneGrid.tsx`: existing register-view help now registers for extra1–4 as well as original pitched lanes.
- `src/components/FxStrip.tsx`: clearer existing filter and bypass definitions.
- `src/styles/membrane.css`: phone-only help layout,44px targets and bounded prose scrolling.
- `scripts/verify-r3-help.mjs`: focused browser acceptance probe.

No desktop layout, audio, music handlers, note gestures or document-state logic changed. The proposed intermediate fxHelp.ts extraction was removed after diagnosis; it is not part of the final change.

## Proof

`evidence.json` records passing fresh-browser checks:

| State | Verified |
| --- | --- |
|390x844 dark,lead|All8topics match registered text; Help and topic selector>=44px; close,Escape,outside dismissal and focus; document unchanged; no horizontal overflow|
|390x667 light,extra4|Same checks, including the previously missing extra-lane View entry|
|1280x800 desktop|No phone Help UI; document height remains800px|

Both phone Draw explanations end at y401, inside the available viewport. Required screenshots: `draw-390x844-dark.png`, `help-390x667-light.png`, `desktop.png`. Additional same-state topic captures: `help-390x844-dark.png`, `draw-390x667-light.png`. Full-page phone images intentionally include scrolling content and the existing fixed status strip.

Fresh probe exits0. TypeScript no-emit, full ESLint,14 existing help-language tests pass. Layout detector returns `[]`. Existing unrelated phone no-scroll legacy failure from R1 was not rerun. No real-user comprehension study, audio performance suite or broad regression audit is claimed.

The interrupted run stopped at an outside-click test coordinate covered by the fixed save strip. The resumed probe taps the exposed backdrop70px above the bottom instead; it does not force-click through the strip. The extra-lane run then identified missing `lane.extra4.regshift` registration and was repaired at the existing registry source. R1/R2 verification was preserved.

No commit, push or deployment. Task-owned dev server4193 is stopped after verification; the independent verifier used saved evidence/source and reran the14test help-language suite without a new browser.
