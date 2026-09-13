# R2 Transpose and View labels

Status: implemented; finish reviewer disposition `ship`, awaiting independent auto verifier. R1 remains approved; R3/R4 remain queued.

## Change

Desktop sound controls and phone Options now say **Transpose (Oct)**. Their group and button accessible names explicitly say transpose octave. The two grid controls say **View Oct** and **View Semi**; their existing accessible names already identify octave/semitone view and remain intact. Fixed instrument identity names remain unchanged for R4.

Related contextual help points to these exact control labels. The phone helper explains that Transpose affects playback/exports and View moves visible rows. Existing help IDs, handlers, bounds, keyboard paths, layout CSS, control sizes and musical state logic are unchanged.

Files: `src/components/LaneHeader.tsx`, `src/components/LaneGrid.tsx`, `src/components/PhoneOptions.tsx`. Existing copy expectations in `tests/helpLanguage.test.ts` and transpose accessible-name selectors in `tests/browser/register-controls.test.tsx` were updated; behavioral assertions were not weakened. `scripts/verify-r2-labels.mjs` is the focused browser probe.

## Verification

`evidence.json` records eight states: lead and extra4 at1280x800,390x844,390x667, and640x400 CSS pixels at DPR2. Glass Arcade supplies all eight instruments. Desktop is dark,844px phone dark,short phone and constrained viewport light.

- View Oct up changes the register start by seven scale rows while preserving the exact document object; View down restores the window.
- Transpose up changes octave0 to1 while leaving the restored register start unchanged. Transpose down returns octave to0.
- Both desktop pages remain800px high with no horizontal document overflow and footers inside the viewport.
- Normal phones retain existing887px/937px document heights, visible labels,44px control targets and native scrolling. Short phones scroll rather than shrinking targets.
- All eight states have no horizontal document overflow.
-640x400 at DPR2 checks constrained CSS viewport geometry corresponding to half the desktop dimensions. It is not proof of actual200% browser zoom or text-only zoom. That remains untested.

Representative immutable final captures: `final-1280x800-1x-lead.png`, `final-1280x800-1x-extra4.png`, `final-390x844-1x-extra4.png`, `final-390x667-1x-extra4.png`, `options-390x844-1x-lead.png`, `final-640x400-2x-extra4.png`. Phone captures are full-page images and intentionally exceed viewport height. The initial test locator used extra4 rather than the current INSTRUMENT8 accessible name; correcting that test setup preserved R4 scope and the rerun passed.

Checks: focused browser probe exit0; help-language14tests pass; TypeScript no-emit pass; full ESLint pass. Existing pitch-direction phone no-scroll failure, proven pre-existing under R1, was not rerun. The old register-controls whole browser suite was not rerun; only its stale name selectors were updated. No new broad regression/visual audit was run. No production build was needed for the live Vite source preview.

Finish reviewer requested recapture of the constrained viewport after focus scrolling displaced its sticky header. The same final640x400 files were recaptured from scroll position0; recapture-evidence.json records that correction. No UI changes were made for the capture correction. Reviewer qualifies the fixed save-strip overlap in the400CSSpx stress view as an existing scrolling limitation; this is not actual200% zoom proof.

Task-owned local server4192 is stopped after verification. No commit, push or deployment.
