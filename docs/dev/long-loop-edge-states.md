# Long-loop edge states (HL-1)

The resilience audit for iteration 3's long-loop vocabulary (i3-4/i3-5
edges): everything that eventually FAILS at the edges of pattern RESIZE, the
LONG RENDER, and LEGACY-DOC MIGRATION. Companion gates:
`tests/pattern-resize-edges.test.ts` (store/pure half) +
`tests/browser/pattern-resize-edges.test.ts` (app half),
`tests/browser/long-render-failure.test.ts`,
`tests/import-edge-corpus.test.ts` (typed results) +
`tests/browser/migration-fallback-v3.test.ts` (real OPEN FILE path).

Method (recorded for the verifier): every row is setup → perturbation → law
under the REAL seams — the mounted App for browser rows (real buttons, real
OfflineAudioContext, real IndexedDB, the hidden `.projects-input` via
DataTransfer), the store/codec directly for unit rows. Failure injection
never mocks what it can really break: `OfflineAudioContext.prototype.
startRendering` (one rejecting call), `URL.createObjectURL` (one throwing
call), a one-shot `vi.mock` toggle for the module-call failure class (the
vitest/browser page wrapper exposes no request interception to abort the
chunk request itself; a rejected `import()` and a throwing first call land
in the same handler `catch`).

## Two real defects found + fixed (root cause, never a test-only accommodation)

1. **fileIO.ts — dishonest too-large/depth messages.** A file between the
   4 MB decode cap (`DECODE_MAX_CHARS`, codec layer) and the 10 MB File-size
   guard fell through to the generic `DecodeError` branch and read
   "Project file is not valid JSON." — for a file that IS valid JSON, just
   oversized (or hostilely deep: `DepthLimitError`). Fixed: `TextTooLargeError`
   → `too-large` with the true cause + the 4 MB limit named;
   `DepthLimitError` → `corrupt` with the nesting message. Pinned by
   `tests/import-edge-corpus.test.ts` rows 2-3 (the message may never say
   "not valid JSON" for these classes) and the browser twin.
2. **Projects.tsx — the export chunk-load failure was silent.** TH-2's
   comment claimed "a load failure surfaces as the same error toast shape
   as any export failure", but neither export handler had a `catch`: a
   rejected dynamic `import()` (the stale-deploy class: cached index.html
   outliving its chunk) dismissed the sticky RENDERING toast with NO
   explanation and left an unhandled promise rejection. Fixed: both
   handlers catch → honest toast ("WAV export could not start." /
   "MIDI export could not start." + reload suggestion); `finally` already
   cleared busy. Pinned by `long-render-failure.test.ts` row 1 (toast +
   zero unhandled rejections + retry).

## A. Resize-truncation edge table

The fixed policy (LL-1): grow ALWAYS proceeds; shrink refuses by default
when any note would be lost past the new end — typed refusal, deterministic
blocking note, never a silent truncation.

| # | Edge | Law | Gate |
|---|------|-----|------|
| A1 | Pitched note END exactly at the new end | clean shrink; note untouched | unit r1 |
| A2 | One grid-step (0.25) of overhang | refuses; blocking = that note | unit r2 |
| A3 | Note ANCHORED exactly at the new end | refuses at any length | unit r3 |
| A4 | Note fully past the new end | refuses | unit r4 |
| A5 | Note SPANNING the shrink edge | refuses; the wording names the note's ANCHOR bar, not the bar the tail crosses into | unit r5 + browser 1 |
| A6 | Sustained tail (length > gate) crossing | refuses — the EXTENT law, not the gate | unit r6 |
| A7 | Drums hit at newSteps−1 / at newSteps | clean / refuses | unit r7 |
| A8 | Two drum pieces at the same step | DRUM_PIECES scan order names the row (deterministic) | unit r8 |
| A9 | Many candidates past the end | greatest end blocks; equal ends → latest start (pitched + drums) | unit r9 |
| A10 | Wording at each row type | exact E10 strings; barOfStep at 0/15/16/2032/2047 | unit r10 |
| A11 | 128→1 with content in bar 1 | ONE clean call | unit r11 |
| A12 | Note anchored at 2047 (bar 128) | refuses; identity `AT BAR 128` | unit r12 |
| A13 | Grow at the 128 limit | typed no-op (never wraps, never throws) + `AT LIMIT` announcement on BOTH paths | unit r13 + browser 2 |
| A14 | Refused → moved → shrunk → undo | refusal writes NO history; undo lands on the post-move state | unit r14 + browser 4 |
| A15 | Empty pattern (no notes / all-false rows) | shrinks cleanly at EVERY vocabulary size | unit r15 + browser 3 |
| A16 | Grow with an overhanging note | note byte-identical; the same note then blocks the shrink back | unit r16 |
| A17 | Refusal under keyboard vs pointer | identical text through Shift+b and the PAT stepper (one funnel) | browser 1 |
| A18 | Grow while PLAYING | transport keeps playing; E10 lands | browser 5 |
| A19 | Refusal while PLAYING | transport keeps playing; store untouched | browser 6 |
| A20 | Resize while one-shot PARKED | commits + announces; stays parked (no resurrection); restart still works | browser 7 |
| A21 | Grow changing the LCM mid-play (basis swap) | booth BAR readout never resets to BAR 1 — the LL-2 absolute-grid continuity | browser 8 |
| A22 | Grow of the LAST pattern in a chain mid-play | store commits NOW; the engine's IM-7 iteration rebuild lands at the boundary; lane cycle follows (16+64=80) | browser 9 |

Known non-law (recorded, not gated as one): the parked one-shot's readout is
DERIVED from the cycle tail (`getPosition()` at `oneShotEnded` =
`barBeatStep(cycleSteps − 1)`), so a basis grow moves the parked BAR with it.
The law is "no resurrection, no reset to the cycle start" (A20).

## B. Long-render failure modes

XP-1 proved the busy-guard spans a healthy 64/128-bar render; these rows
prove the FAILURE half: every mode typed + recoverable — nothing stuck,
nothing lost, no partial file.

| # | Failure mode | Law | Gate |
|---|--------------|-----|------|
| B1 | Export module call fails unexpectedly (stale-deploy chunk-load class) | honest error toast; sticky RENDERING dismissed; busy cleared; ZERO unhandled rejections; retry works | browser 1 |
| B2 | Offline render fails mid-render (startRendering rejects) | typed render toast + recovery suggestion; never stuck RENDERING; 0 blobs (no partial file); doc untouched; retry works on a FRESH context (the per-context WeakSet module discipline — each new OfflineAudioContext loads its own module; no stuck shared state) | browser 2 |
| B3 | Autosave after a failed export | edit → flush → the persisted row still decodes to the current doc (an export failure can never poison the row) | browser 2 |
| B4 | Download io fails (createObjectURL throws) | typed io toast; busy recovers; retry works | browser 3 |
| B5 | Tab hidden mid-render | render completes across a synthetic hidden window (TH-3 at render scale) | browser 4 |
| B6 | Double-export race | mid-render second taps (direct + synthetic bubbling) swallowed; exactly one blob | browser 4 |
| B7 | Popover Escape mid-busy | closes; the anchor stays DISABLED so the panel cannot reopen to fire another action; re-enables on completion | browser 4 |

Memory at the 128-bar render: measured + ceilinged by TH-5 §10c/10d
(docs/dev/perf-budget.md — 43 MB loop buffer at 64 bars, heap delta
260-269 MB recorded not gated, 25 s HARD ceiling on the 64-bar gate). The
HL-1 gates deliberately re-measure nothing; the 128-bar busy window they
ride is that recorded band.

## C. Migration-fallback corpus (the UX proof; SV-2 owns the fuzzer)

Every class through the REAL OPEN FILE path (DataTransfer on the hidden
`.projects-input` → the real import handler → decode → migrate → validate),
the IN-4 v1 precedent extended to the v3 era. The unit twin
(`tests/import-edge-corpus.test.ts`) pins the typed result for each class
on a fake idb.

| # | Corpus class | UX law | Gate |
|---|--------------|--------|------|
| C1 | v3 corrupted structurally | corrupt toast + bounded issues, dismissible, store + rows untouched | browser 1 / unit r5 |
| C2 | Truncated JSON | not-json toast | browser 2 / unit r4 |
| C3 | `__proto__`/`constructor` keys at v3 positions | corrupt toast; Object.prototype NEVER polluted | browser 3 / unit r6 |
| C4 | 4.1 MB VALID JSON (over the 4 MB decode cap, under the 10 MB file guard) | too-large toast with the HONEST message (never "not valid JSON") — the HL-1 fix | browser 4 / unit r2 |
| C5 | 3.9 MB valid project (under the cap) | imports (OPENED toast) | browser 5 / unit r1 |
| C6 | 65+-deep valid JSON | corrupt, "too deeply nested" (not not-json) — the HL-1 fix | unit r3 |
| C7 | v2 with loopBars ≠ chain basis | imports; loopBars DROPPED; the LCM basis is the chain truth (16, not the stale 4) | browser 6 / unit r7 |
| C8 | v2 with bars=8 (invalid in v2, v3-legal) | imports — the permissive widen has no rejection class | browser 7 / unit r8 |
| C9 | v1 sustain-heavy (the full 1→2→3 ladder) | imports at v3; duration law intact | browser 8 / unit r9 |
| C10 | Single-pattern chains at EVERY vocabulary size | imports; cycle = bars×16 | unit r10 |
| C11 | Notes at 2047/2048 in a 128-bar pattern | imports (the legal overhang) | unit r11 |
| C12 | Note start 2047 in a 1-bar pattern | semantic corrupt ("outside the pattern") | unit r12 |
| C13 | Future version stamp | future-version with both numbers | unit r13 |
| C14 | Recovery after every failure class | a valid import still works — the path never wedges | browser 9 |

## How to re-run

```sh
npx vitest run --project unit tests/pattern-resize-edges.test.ts tests/import-edge-corpus.test.ts
npm run test:browser -- tests/browser/long-render-failure.test.ts tests/browser/pattern-resize-edges.test.ts tests/browser/migration-fallback-v3.test.ts
```

Browser rows need the quiet-fence discipline (foreign sibling batteries
waited out) — the established MB-6 stance for anything timing-adjacent; the
resize/failure rows themselves are event-driven, not timing-budgeted.
