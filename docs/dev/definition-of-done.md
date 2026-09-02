# Definition of Done — Bitbounce

Applies to every task in `docs/ultron/plan.md` (enforced task HW-1). A task is
**not done** until all of the following hold.

## 1. Tests at the boundary

Every task ships tests at its externally observable boundary (pure functions,
public module APIs, or UI journeys where that is the boundary). Specifically:

- Pure logic (time math, codecs, schema, scale math): table-driven + property
  style tests in the `unit` vitest project (`tests/`).
- Deterministic byte output (WAV, MIDI, canonical codec): golden SHA-256
  manifest entries under `tests/golden/` — regenerated only via
  `npm run goldens:update` (gated on `UPDATE_GOLDENS=1`); CI never regenerates.
- Audio behavior (from IM-5/HW-2): browser-mode determinism suite
  (OfflineAudioContext renders; exact scheduled times in unit tests,
  onset within one render quantum offline, ±10 ms e2e smoke — D8).
- A bug fix ships with the regression test that would have caught it.

## 2. All gates green

Locally and in CI, in this order (matches `.github/workflows/ci.yml`):

```
npm run lint && npm run typecheck && npm test && npm run build
```

CI job order is lint → typecheck → test → build; a failure at any gate fails
the task.

## 3. Evidence in the production log

`docs/ultron/production-log.md` gets an entry recording: what shipped, test
counts (e.g. "142/142 green"), deviations or trade-offs, and any manual
verification steps. Task status moves in `docs/ultron/plan.md`.

## 4. No scope creep

Non-goal list and fixed-scope items in `plan.md` (4 lanes, synth-only, the four
FX devices, export formats) are untouched; deviations are recorded in the
production log and returned to the owner if they alter scope.
