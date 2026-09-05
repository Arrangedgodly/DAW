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

## 6. Mobile slice DoD (iteration-2 town-hall addendum ACs m1–m5; MB-6's
consolidated matrix, 2026-09-04 — the M17 record)

Every mobile acceptance clause has a standing gate in the blocking browser
job. A mobile-affecting change is done when this matrix is green, desktop
(m4) included:

- **m1 layout + viewport** — `tests/browser/mobile-viewport.test.ts` (the
  consolidated VIEWPORT gate on the built app): phone 390×844 + 360×800
  (lane switcher IS selection, sticky chrome pinned mid-scroll, scrolling-
  grid law, one-floor law, first-run chrome <50% at 360) · tablet 768×1024
  (2×2 one page, narrow geometry) · desktop boundary 1024/1023 · live
  rotation chain (phone → rotated phone → tablet → desktop) · boot-wipe
  integrity tooth.
- **m1 editing by touch** — `tests/browser/mobile-touch-trusted.test.tsx`
  (the consolidated ACCEPTANCE gate: trusted CDP touch on the BUILT app at
  BOTH phone viewports — the full committed editing model: transport,
  switcher, tap place/remove, drag-create, edge-resize, drums paint, euclid
  arm→SET, rail sweep (stopped + queued), preset, mix, FX, busy-guarded
  exports, projects switch; core classes re-proven at 360) ·
  `tests/browser/touch-gestures.test.tsx` (source-mounted per-gesture gate
  with store assertions + the gesture-vs-scroll discrimination both
  directions) — teeth: cells' `touch-action` reservation, the FILL reveal
  rule, and the export busy-guard each proven red by scratch revert.
- **m2 targets + m3 hoverless/help** — `tests/browser/target-size.test.tsx`
  (≥44×44 hit-box audit at both phone widths, focus order, rotation
  coherence, chrome-budget re-pin) · `tests/browser/help-touch.test.tsx`
  (tap-to-inspect) · `tests/browser/axe-a11y.test.tsx` phone states ·
  `tests/browser/help-coverage.test.tsx` phone pass; the law matrix + the
  recorded exemptions live in `docs/dev/accessibility.md` §8.
- **m4 desktop unchanged** — quadrant-layout 1440×900 + the entry-4
  1280×800 one-page laws in the same browser battery; MB-3's byte-identity
  proofs (PNG + computed geometry) are the deep record.
- **m5 resilience + perf** — `tests/browser/mobile-resilience.test.tsx` +
  the pointer-edge-states touch rows (rotation/visibility/unlock/
  touch-cancel edges) · `tests/browser/frame-budget.test.ts` §9 gates
  (phone frame budget, gesture storms at phone width, lazy decode
  mid-playback, voice caps) with the documented CI-hardware honesty
  caveat (`docs/dev/perf-budget.md` §9).
- **Mobile-harness law (MB-6, measured):** phone-stage gates pin
  `scrollbar-width: none` in their boot documents (the committed target is
  Android Chrome, whose overlay scrollbars take NO layout width — a classic
  desktop scrollbar steals 15 px and lays the phone out narrower than the
  committed width, past the euclid 355 px container-query boundary and into
  the booth's extra-wrap regime: the measured root cause of the MB-1 360
  chrome-budget and MB-3 euclid-clip load flakes). Geometry assertions
  wait for font-settled, dimension-stable layout; clip-vs-box comparisons
  are captured in the same layout instant (no stale rects across scrolls).

## 7. Iteration-3 slice DoD — the i3-1..i3-6 AC matrix (HW-6, 2026-09-04 —
the M22 record, the §6/M17 pattern applied to the v0.2 slice)

Every iteration-3 acceptance clause (town-hall.md §Iteration 3) has a
standing gate in the blocking battery. An iteration-3-affecting change is
done when this matrix is green — and **the ONE ordered journey**
`tests/browser/e2e-iteration3.test.ts` (the HW-6 DoD e2e, built app,
wiped IDB — boot → PLAY → `+` twins → edit → LENGTH ladder + refusal →
OCT → window scroll → exports at the journey's own 24-bar LCM → reload →
1920 probe) runs the whole editing model end to end on top of the
per-clause gates.

- **i3-1 Equal sections** — `tests/browser/register-controls.test.tsx`
  (equal one-octave windows on demo + fresh; full manifests stay in the
  DOM 6/7/7/15; visible rows 7/7/7/6 — no lane dominates; fitting
  manifests keep byte-identical names; arrows walk the manifest + the
  window follows) · `tests/octave-register.test.ts` (unit: default-window
  chooser + document-replacement re-default; ZERO document churn — the
  window is view state) · migration lossless (the SC-1 law):
  `tests/document-migrate.test.ts` + the migrate goldens
  (v1/v2-demo→v3, byte-equal the shipped demo) +
  `tests/browser/migration-fallback-v3.test.ts` (the real OPEN FILE path)
  · journey stage 1 (the boot law on the built app) + stage 7 (the
  reachability walk).
- **i3-2 Register controls** — `tests/browser/register-controls.test.tsx`
  (keyboard `o`/Shift+`o` + pointer twin + Tab-reachable strips, E8
  announcements, ±3 clamp no-ops that announce, one-gesture undo, drums
  refusal, E9 VIEW/OCTAVE fence) · `tests/octave-register.test.ts` (the
  law stack: keynav clamp/anchor, store action canonical-empty at 0,
  funnel texts, compile 2^offset = the audible-live clause, MIDI ±12 +
  zero drift) · **hole closed by HW-6:** the "reflected in WAV exports"
  clause had unit-consumption gates only — the journey's stage 6 proves
  it on the real app (+1 changes the export bytes at equal frame count,
  the diff is audible by metric — diff-RMS + high-band energy tilt — and
  undo restores a byte-identical export, the canonical-empty law).
- **i3-3 Blank clip** — `tests/browser/pattern-rail.test.ts` (both `+`
  twins — button + rail-local `+` key — E11 creation announcement,
  next-letter label, appended + selected + editable, one-Ctrl+Z
  create+append revert, DUP the only duplicator, focus-on-new-tile law)
  + `tests/pattern-rail.test.ts` (unit store: `appendBlankPattern` one
  commit) · journeys updated + journaled (ledger #1): keyboard-journey
  -full DA-3 step 12, e2e-happy-path, the frame-budget construction path
  · journey stage 3 (button twin + `=` key twin + RM + the lane-cycle
  badge following the chain).
- **i3-4 Long loops** — `tests/browser/pattern-resize.test.ts` (the
  1..128 ladder via `b`/Shift+`b` AND the PAT stepper, refuse-by-default
  with the exact blocking-note text, AT-LIMIT no-ops, the resize undo
  family, focus carry + no-yank, virtualized extent) ·
  `tests/pattern-resize-edges.test.ts` + browser twin (the 22-row
  boundary table) · `tests/browser/per-lane-sweep.test.ts` (each
  quadrant sweeps at its OWN chain cycle — exact modulo vs the transport
  clock, short lanes wrapping, one LCM one-shot, `p` E12, zero-drift at
  equal lengths) · poly-loop audible-by-metric:
  `tests/browser/demoSong.test.ts` (the 8-bar LCM render: per-bar
  energy, downbeat transients) + the XP-1 LCM-fill probes (the cycle
  fill audible first-vs-last window) · dense 128-bar frame budget:
  `tests/browser/frame-budget.test.ts` (the TH-5 family — long-lane
  playback ≥95% frames, register fling, per-edit <50 ms HARD, census
  virtualization laws, phone twin) on LP-1's recorded green verdict ·
  journey stages 1-2 + 5 (unequal rail cycles, unsynced sweeps + the BAR
  5 LCM basis, the ladder + refusal + burst-undo on the built app).
- **i3-5 Export law preserved** — `tests/browser/exportWav.test.ts` +
  `exportMidi.test.ts` (exactly one full LCM cycle, parse-back at the
  cycle length, byte-equality with the offline pipeline) ·
  `tests/browser/export-busy-guard.test.ts` (sticky RENDERING toast,
  one-shot async actions, swallowed mid-render taps, cycle-bar toasts) ·
  `tests/browser/audio-determinism.test.ts` (loop-perfect seam + the
  128-bar bit-identical double render) ·
  `tests/browser/long-render-failure.test.ts` (every long-render failure
  mode typed + recoverable) · deterministic goldens:
  `tests/browser/render-fingerprint.test.ts` + the `tests/golden/`
  manifest (render/wav/mix/wav-lcm fingerprints + the midi LCM golden) ·
  journey stage 8 (the editing above moves the cycle to 24 bars —
  toasts, one-blob swallow, WAV frames exact, the MIDI chain-repeat at
  ticks 7,680/30,720) + stage 9 (byte-identity through save/reload).
- **i3-6 Full viewport** — `tests/browser/viewport-utilization.test.ts`
  (THE consolidated i3-6 gate, re-indexed by this record: ≥95% width
  utilization of floors + rail at 1280/1440/1920, no centered vacancy,
  one-page at both law viewports, the 1920 densification proof) ·
  `tests/browser/quadrant-layout.test.ts` (the 60 fps + layout laws) ·
  `tests/browser/frame-budget.test.ts` TH-5 (d) (the densified 1920
  stage holds ≥95% frames, lead quadrant >900 px) · mobile re-green =
  the whole §6 matrix re-running in the same battery · journey stage 10
  (the wide probe on the journey's own edited document).

**Audit verdict (the matrix's own teeth):** no i3 clause was left without
a gate. Three clause-level holes were found and CLOSED in-task by HW-6's
journey: (1) i3-2's WAV-export-reflection on the real app (above); (2)
the ledger's help-mode KEY pass-through for `o`/`b`/`p`; (3) the stepper
popover's Escape focus-return. The full v3 keyboard ledger audit lives in
`docs/dev/keyboard.md` §"v3 ledger audit".

**Iteration-3 DoD — what a future regression must not break (v0.2):**

1. The v0.1 suite stays law (the regression rule): any journey/golden
   change is deliberate + journaled per task, never silent.
2. The editing model end to end: rail `+` = NEW blank next-letter clip
   (never a re-append), DUP the only duplicator, LENGTH is the only
   length control (powers-of-two 1..128, refuse-by-default on note loss
   with the blocking note named), lane cycle = chain total (the rail's
   cycle badge + the LCM booth/one-shot/export basis).
3. The register model: equal one-octave default windows (view state,
   zero document churn), OCT transposes sound + exports + undo (never
   the window), window scroll is VIEW-only + focus-anchored, and the E9
   fence (OCTAVE vs VIEW wording) holds verbatim.
4. Export law: exactly ONE full LCM cycle — WAV frames exact, MIDI chain
   repeats inside the cycle, cycle-bar toasts, busy-guard one-shot,
   byte-identical restores after undo and after save/reload.
5. Full viewport: ≥95% utilization at all three viewports, one-page at
   both law viewports, dense-128 frame budget, the mobile family
   regression-green.
6. The four export/render fingerprints stay byte-stable unless a task
   deliberately touches the audio path (goldens.md records every regen).
