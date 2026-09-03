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

## 5. Iteration-2 keyboard/a11y contract (from IN-1)

Iteration-2 interaction tasks additionally inherit, as DoD:

- **Keyboard spec v2 is law.** `docs/dev/keyboard.md` (v2) is the contract:
  every new gesture the task ships implements its row in §"Coverage review"
  and exercises that keyboard path in a test. Pointer drags NEVER replace
  keyboard paths — both are required (iteration-2 assumption). New gestures
  not in the table must add a row (or a binding) before shipping.
- **A11y gate extensions E1–E7.** `docs/dev/accessibility.md` §7 maps each
  extension to its owning task with the exact gate assertion to land:
  LY-1 → E1/E2/E3 (selector announcements, no focus traps, name-carried
  edit state), IN-2 → E4 (+E5 with IN-3, drag-equivalent announcements),
  IN-3 → E5 (multi-clip cue keyboard path + identical announcements),
  HP-1 → E6 (info-view aria-live, fourth axe state). The v0 gate (§6) stays
  law until the owning task lands; the accepted-moderates triage rule applies
  to every new mounted state unchanged.
- **Journey ledger.** Deliberate v0-journey changes are recorded in
  `docs/dev/keyboard.md` §"v0 → v2 journey-change ledger" BEFORE the journey
  tests change (the iteration-2 regression rule's paper trail).

**Final state (HW-5 sweep, 2026-09-02):** all of the above LANDED and
audited — E1–E6 landed by their owning tasks (accessibility.md §7 records
each landing + its gate), E7's review obligation discharged by the HW-5
ledger audit (keyboard.md §ledger: every entry re-verified against the
shipping tests; no unrecorded v0-journey change exists; the iteration-2 e2e
`tests/browser/e2e-iteration2.test.ts` is additive). The DoD for any
POST-iteration-2 interaction work remains: new gestures add a coverage row
+ keyboard path + ledger entry before the journey tests change.
