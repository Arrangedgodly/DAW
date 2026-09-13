# R1 compact desktop fit

Status: implemented and verified; finish reviewer disposition `ship`, awaiting user approval. R2–R4 remain queued.

## Cause and change

The Membrane control stack inherited an aligned, reserved tools tier, 8px header gaps, 10px separation, and 15px of register padding. At short desktop heights those intervals spent the note budget. Selection also changed row margins without changing the reserved header height, so the ResizeObserver did not reliably request a new fit. The existing fit omitted the instrument frame borders from its budget.

- `src/styles/membrane.css`: at heights <=850px, desktop transport uses 7px/4px block padding, floor padding8px, header gap4px/margin4px, compact row gap4px, register block padding0. Phone rules and control sizes remain unchanged; coarse input's existing navigation/target rules still apply.
- `src/components/LaneGrid.tsx`: account for frame borders in the existing height budget and schedule the existing coalesced fit after selection changes. No new animation loop, audio work or musical document writes.
- `scripts/verify-r1-fit.mjs`: focused reproducible Playwright acceptance probe, including document identity checks. Uses local dev server4191; launch it explicitly before rerunning.

The layout assessment was independently supplied by assessment_a, reused after the harness denied an additional agent slot. The mechanical scan was performed separately: no layout findings before or after. Spatial thesis: compact shared transport above four stable, aligned musical windows; retain grouped sound/mix and tools controls, give recovered space to complete notes. Membrane typography, palettes, four-quadrant topology and aligned hidden tools tier remain.

## Evidence

`before-matrix.json` and `before-*.png` are the controlled Glass Arcade eight-track baseline. Filenames encode the original viewport; baseline JSON's `height` stores document height. The earlier native critique reported873px on its restored project; this controlled fixture instead reproduced809–823px at1280x800 and1017px at1440x1000 after theme/page/selection transitions. Do not present these as the same fixture.

`final-matrix.json` and `final-*.png` contain20 final states: both editor pages, both themes,1280x800 mouse/touch,1440x1000 mouse,390x844 and390x667 touch. Each selected lane is pitched (lead or extra4). Demo notices are dismissed through the UI before final captures.

| Final viewport/input | Document height | Lowest footer | Visible rows |
| --- | ---: | ---: | --- |
|1280x800 mouse, both themes/pages|800|786|7 complete per grid|
|1280x800 touch, both themes/pages|800|796|7 complete per grid|
|1440x1000 mouse, both themes/pages|1000|974|7 complete pitched rows; drum window follows existing rule|
|390x844 and390x667 touch, first cohort|887|832 in document|7 complete,44px tracks|
|390x844 and390x667 touch, second cohort|937|882 in document|7 complete,44px tracks|

No horizontal document overflow or partially exposed note row appears in the final matrix. Phone content heights and row sizes match the before matrix; short phones retain native scrolling and reserved bottom space. Navigation, theme changes, and viewport layout leave the same document object intact. Full-page phone captures intentionally exceed viewport height.

Representative final captures: `final-1280x800-mouse-dark-1.png`, `final-1280x800-mouse-light-2.png`, `final-1440x1000-mouse-dark-1.png`, `final-1280x800-touch-dark-1.png`, `final-390x844-touch-dark-2.png`, `final-390x667-touch-light-1.png`.

## Checks and limits

- Final focused matrix: exit0. Desktop exact page height, four panels, complete rows and visible footers; phone44px row floor; unchanged document identity. All 12 desktop states, including touch, also pass static assertions against the saved matrix; same desktop assertions are enabled for future probe runs.
- TypeScript no-emit: pass.
- Full ESLint: pass.
- Vite production build: pass. Existing ineffective dynamic import warnings for persist/newProject.ts and persist/boot.ts remain.
- Impeccable layout detector: `[]`.
- Existing `tests/browser/pitch-direction.test.tsx`: fails its phone no-scroll assertion at line148,893 <=844. An isolated baseline run with only R1 removed reproduces the exact same failure; source restored byte-for-byte in finally. See `baseline-pitch-test.log`. No existing tests were rewritten. This suite is not reported as passing.
- Native visible IAB could not open from a subagent; captures use local Playwright Chromium after sandbox process launch approval. Initial sandbox launch failed EPERM, then approved local launch succeeded.
- No new broad audit, localization/zoom matrix, FX/fill-overlay interaction suite, or exhaustive long-preset stress run. Existing musical behavior is preserved by the narrow change and document-identity probe; the failing legacy suite limits broader regression claims.

Task-owned dev server4191 is stopped after evidence capture. No commit, push or deployment.
