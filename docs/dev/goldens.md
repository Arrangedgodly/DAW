# Golden files runbook (HW-3)

`tests/golden/manifest.json` is the SHA-256 manifest for every golden the
export/render contract pins. Golden tests never embed expected bytes inline
(except the hand-computed spec-bytes self-check); they compare against this
manifest.

## What each entry pins

| Entry                                | Kind                                                                                                                      | Test                                                | On mismatch                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| `codec/default-project-canonical-v1` | bytes (pure TS, stable everywhere)                                                                                        | `tests/golden/codec-default-project.golden.test.ts` | **hard fail**                                    |
| `wav/encoder-stereo-2frame-v1`       | bytes (pure TS; hand-computed spec bytes double-checked in-test)                                                          | `tests/golden/wav-encoder.golden.test.ts`           | **hard fail**                                    |
| `midi/reference-project-v1`          | bytes (pure TS; structure check in-test, third-party parse-back in `tests/browser/exportMidi.test.ts` via `@tonejs/midi`) | `tests/golden/midi-export.golden.test.ts`           | **hard fail**                                    |
| `render/reference-loop-fp-v1`        | render fingerprint (**environment-pinned**)                                                                               | `tests/browser/render-fingerprint.test.ts`          | soft: console `RENDER FINGERPRINT DRIFT` warning |
| `wav/reference-export-fp-v1`         | render fingerprint of the exported .wav file bytes (**environment-pinned**)                                               | `tests/browser/render-fingerprint.test.ts`          | soft: console `EXPORT FINGERPRINT DRIFT` warning |
| `wav/reference-export-mix-fp-v1`     | render fingerprint of the exported .wav file bytes WITH a non-default lane mix, drums muted + lead volume 0.75 (**environment-pinned**) | `tests/browser/render-fingerprint.test.ts`          | soft: console `EXPORT FINGERPRINT DRIFT` warning |

Decode-and-assert coverage (structure, not just hashes): the reference-project
exported WAV's headers/sample-count/seam-continuity live in
`tests/browser/exportWav.test.ts` (MF-4); MIDI structure + third-party parse
evidence in `tests/golden/midi-export.golden.test.ts` +
`tests/browser/exportMidi.test.ts` (MF-5). Tripwires + manifest hygiene:
`tests/golden/golden-manifest.golden.test.ts` (flipping any hard entry's hash
is proven there to fail its check; render entries are proven warn-only).

## When to regenerate — LEGITIMATELY

Only for **deliberate** changes to pinned output:

- a DSP change that intentionally alters rendered audio (new oscillator law,
  revised FX math, tail-fold change);
- a format change (WAV header fields, MIDI layout, codec canonicalization,
  new default-project content);
- a dependency bump that legitimately changes serialization (e.g.
  `midi-file`);
- rebaselining render fingerprints after a deliberate Chromium/playwright
  pin change.

NOT legitimate: making a red test green after an accidental change. A
surprising diff is the system working — investigate first.

## How

```bash
npm run goldens:update
```

which runs, with `UPDATE_GOLDENS=1`:

1. `vitest run tests/golden` — node-side byte goldens re-record hashes;
2. `vitest run --project browser tests/browser/render-fingerprint.test.ts` —
   the browser test emits machine-readable `RENDER_FINGERPRINT_RECORD` console
   lines; the node-side hook in `tests/golden/render-fp-recorder.ts` (wired in
   `vite.config.ts`) writes them into the manifest, including `renderEnv`
   (playwright version + Chromium build).

CI never regenerates (the env var is never set there). Human `note` fields
and `kind` survive regeneration — only `sha256`/`byteLength`/`renderEnv`
refresh. If you add a NEW golden, add its note in the same commit.

## Regeneration history

- **2026-09-02 — SC-1 (schema v2 note model).** Deliberate format change:
  pitched patterns moved from v1 cell rows to v2 `{rowDegrees, notes}` with
  `SCHEMA_VERSION` 2, so `codec/default-project-canonical-v2` (renamed from
  `-v1`) and `codec/demo-project-canonical-v2` were regenerated via
  `npm run goldens:update`. Three NEW hard goldens pin the v1→v2 migration
  itself: `migrate/v1-default-to-v2`, `migrate/v1-demo-to-v2`,
  `migrate/v1-sustain-heavy-to-v2` (the migration fixtures must exist before
  any UI depends on v2). NOT regenerated, deliberately: `midi/reference-
  project-v1` and the render/export fingerprints — the v2 compat view
  reproduces v0 cell semantics exactly, so export/render bytes are unchanged
  (verified: zero DRIFT warnings, MIDI golden hash untouched).
- **2026-09-02 — SC-2 (note-length engine; NOTHING regenerated).** The
  compiler/MIDI exporter switched from the SC-1 compat view to NATIVE v2 note
  consumption (hold = length × secondsPerStep; the plan explicitly sanctioned
  render/export fingerprint drift for this task). Drift did NOT materialize:
  every golden project carries gate-length notes (no gate-vs-length
  divergence, no seconds-gate lanes), where the native law computes
  byte-identical events. Verified ×2 full browser runs: render fp
  `e87ae0ab…`, wav fp `3eff5771…` both match manifest, and the hard MIDI
  golden `midi/reference-project-v1` passes untouched. manifest.json
  unchanged in SC-2. (Audible divergence exists only for documents whose
  lane gate was edited after their notes were authored — non-golden
  territory, pinned instead by the SC-2 compile/store/browser tests.)
- **2026-09-02 — HW-5 (export-mix law; ONE NEW entry, nothing regenerated).**
  WAV export now applies the lane mix (volume/mute/solo through the render
  pipeline — the coordinator resolution recorded at LY-1 verification; render
  fp `e87ae0ab…` + wav fp `3eff5771…` both still match: canonical-empty mixes
  are all-unity gains, exact in FP, so pre-mix bytes are untouched — zero
  drift, verified). NEW entry `wav/reference-export-mix-fp-v1`
  (`403361ca…`, 352844 B): the same full-FX reference project exported with
  drums MUTED + lead volume 0.75 — the mix path's environment-pinned canary.
  Seeded via the sanctioned `npm run goldens:update` browser stage (the
  node-stage exit-red is the recorded pre-existing tripwire quirk under
  UPDATE_GOLDENS=1 — those 7 tripwire failures are the tamper tests meeting
  the recording mode, not a manifest problem; the browser stage was run
  directly as stage 2 of the documented command). Hard mix-law proofs
  (exact-silence windows, solo ≡ complementary mute, volume linearity +
  determinism) live in `tests/browser/render-mix.test.ts`; the MIDI half
  (notes complete regardless of mix) is pinned in
  `tests/exportMidi.test.ts` §"HW-5".
- **2026-09-04 — SV-1 (schema v3 long-loop widening).** Deliberate format
  change: `SCHEMA_VERSION` 2→3, pattern-bars vocabulary widened to the
  powers-of-two picklist [1,2,4,8,16,32,64,128], note bounds lifted to
  start ≤ 2047 / length ≤ 2048, optional per-lane `octave` field, and the
  persisted `transport.loopBars` RETIRED. Renamed + regenerated:
  `codec/default-project-canonical-v3` (`a57b1e94…`, 1619 B — was 1632:
  exactly the 13-byte `"loopBars":1,` key dropped) and
  `codec/demo-project-canonical-v3` (`76475955…`, 6874 B — was 6887, same
  −13 law). The v1 migration fixtures re-pinned as `migrate/v1-{default,
  demo,sustain-heavy}-to-v3` (the walk now continues v2→v3; final bytes
  changed by the same loopBars drop — `v1-default-to-v3` still byte-equals
  the shipped v3 default golden, the SC-1 identity law preserved). THREE
  NEW hard goldens pin v2→v3 itself: `migrate/v2-default-to-v3`
  (`a57b1e94…` — equals the shipped v3 default exactly), `migrate/v2-demo-
  to-v3` (`76475955…` — equals the demo), and `migrate/v2-boundary-to-v3`
  (`96ffdcf3…`, 3455 B — 4-bar patterns + start-63/length-128 notes +
  loopBars 4: every v2-boundary value survives, only loopBars drops). NOT
  regenerated, deliberately (zero-drift law, J3): `midi/reference-project-
  v1`, `wav/encoder-stereo-2frame-v1`, and the render/export fingerprints —
  the export path never consumed loopBars (LCM law) and the engine basis is
  reproduced by the compat derivation; verified zero DRIFT warnings in the
  browser runs. v2 source texts live in `tests/v2Project.ts` (re-stamp
  version + loopBars over the live docs = exactly the pre-SV-1 bytes).

## Review discipline

A PR that changes `tests/golden/manifest.json` MUST explain every changed
`sha256` in the commit message/PR description: which entry, why the pinned
bytes legitimately changed (link the DSP/format commit), and why the change
is not a regression (e.g. "render fp rebaselined after commit X changed the
PolyBLEP law; decode-and-assert suite still green"). Reviewers treat an
unexplained hash diff as a block.

## CI behavior (verified)

- Unit job (`npm test`) runs `tests/golden/**` — hard byte goldens FAIL the
  job on mismatch, including the tripwire/hygiene tests.
- Browser job (`npm run test:browser`) runs the fingerprint canaries. The
  render/export hashes are **environment-pinned** (RES-7: Chromium SIMD/libm
  differ cross-platform), so a mismatch on a different browser build or OS is
  a console DRIFT **warning, never a failure** — verified by tampering both
  render entries and observing green tests + warnings (see production-log.md
  "HW-3 verification").
