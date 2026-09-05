# Fuzz corpus + codec guard parity (CA-2, SV-2)

The codec parse surface's fuzzing record: what the deterministic mutational
harness throws at `decode()` (the ONE parse path: guards → JSON.parse →
migrate → validate), and every size/depth guard around it with its deliberate
value and recorded reason. Companion gates: `tests/fuzz-codec.test.ts` +
`tests/fuzz-harness.ts` (the harness), `scripts/fuzz.mjs` (the standalone
soak). First delivered CA-2 (v2 era, 1 MB cap); refreshed SV-2 on
**2026-09-04** for schema v3 + SV-1's measured cap raise 1 MB → 4 MB.

Method (recorded for the verifier): deterministic mutational fuzzing — seeded
mulberry32, no external deps; every run with the same seed replays the exact
same cases (CI's 2,000-case slice is a strict prefix-compatible sample of the
50k soak). Mutations apply exactly ONE rewrite over a corpus seed; every case
must validate or typed-reject (DecodeError / ProjectValidationError /
MigrationError), round-trip canonically when valid
(`encode(decode(encode(x))) === encode(x)`), never pollute `Object.prototype`,
never carry a dangerous own key into a validated doc, and return a typed
result through `importProjectFile`'s text path. Hang-freedom is proven by
OPERATION COUNTING, not wall time: the depth pre-scan's counting twin asserts
iterations === input length per case, the corpus bound asserts every mutated
text stays under `DECODE_MAX_CHARS`, and both guards are linear so the 4 MB
raise scales them by construction.

## A. Seed corpus (v3 — the rotation)

14 seeds, 282,237 canonical chars total, largest 111 KB (≈ 36.9x mutation
headroom to the 4 MB cap). Every seed is real canonical bytes of a validating
document (or a real legacy save that migrates inside the parse path), so
mutations start from realistic neighbors, not synthetic shells.

| # | Seed | Shape | Size | Why |
|---|------|-------|------|-----|
| S1 | default project | canonical v3 bytes (golden `codec/default-project-canonical-v3`) | 1.6 KB | the golden baseline; `loopBars`-free v3 shape |
| S2 | default project | pretty-printed (2-space) | ~4 KB | whitespace/format tolerance |
| S3 | MIDI reference | golden `midi/reference-project-v1` lineage | ~2 KB | golden-input neighbor |
| S4 | WAV lineage | four-on-the-floor + lead deg 3 | ~2 KB | golden-input neighbor |
| S5 | MIDI reference | key-shuffled (insertion-reversed) | ~2 KB | key-order independence |
| S6 | v1 default | real pre-v2 save | ~1 KB | v1→v2→v3 full migration ladder |
| S7 | v1 sustain-heavy | seconds-unit gate neighbor | ~1 KB | the ladder's conversion edge |
| S8 | sample provenance | PS-3 manifest-echo map | ~1 KB | provenance keys/values/nesting |
| S9 | **v3 boundary (SV-2)** | bars 1/2/4/8/16/64/128 across lanes; `octave` −3/+1/+3 on pitched lanes (non-zero: 0 is canonical-empty); UNEQUAL chains with repeats (drums 3 slots, bass 1, chords 2, lead 4); positional `chainCues`; notes at start 2047 / length 2048 / length 0.25 / degree 23 | 75,386 ch | every widened v3 edge as canonical bytes mutations can walk off |
| S10 | **dense 128-bar drums (SV-2)** | 128-bar drums, every piece every step (16,384 on-cells) | 62,492 ch | maximum boolean-step density; measured ~1 ms/decode — the widest per-step shape rides the rotation for free |
| S11 | **dense 128-bar pitched (SV-2)** | 128-bar bass, one note per step of a row (2,048 notes) + half-dense lead row | 113,609 ch | note-object density (the expensive payload); capped at single-row so the 50k soak stays bounded |
| S12 | **v2 default (SV-2)** | real pre-v3 save (`tests/v2Project.ts`) | 1.6 KB | v2-in-the-wild: migration v2→v3 in the loop |
| S13 | **v2 demo (SV-2)** | the demo's v2 view | ~7 KB | the widest real-world v2 doc |
| S14 | **v2 boundary (SV-2)** | v2 ceilings (bars 4, start 63, length 128, loopBars 4) | ~3 KB | every v2-legal value must survive the widen |

Deliberate exclusion: the 2.63 MB maximally-dense worst case (below) is NOT
in the rotation — measured ~90 ms/decode (~19 min amortized across a 50k
soak); the boundary class exercises it a bounded number of times instead.

## B. Mutation classes (11)

Round-robin `i % 11`, one seeded rewrite each, all O(n). 2,000-case CI slice
histogram (valid/rejected): byte-flip 7/175 · truncate 0/182 · key-rename
15/167 · type-swap 0/182 · deep-nest 0/182 · huge-number 0/182 ·
unicode-edge 0/182 · proto-keys 0/182 · dup-key 182/0 · nan-literal 0/181 ·
**v3-literal 80/101** (new, SV-2 — real traffic on both sides of the v3
laws).

| Class | Rewrite | v3 relevance |
|-------|---------|--------------|
| byte-flip | flip one bit of one char | generic corruption at any byte of the bigger docs |
| truncate | cut at a random offset | truncation anywhere in 111 KB texts |
| key-rename | first key ← KEY_POOL entry | pool now includes `octave`, `bars`, `songChain`, `chainCues` (v3 keys) |
| type-swap | first number → `"1"`/`true`/`[]`/`null`/`{}`/`-0` | type confusion on v3 numeric fields |
| deep-nest | inject a 60–500-deep tower under `__proto__` | depth pre-scan re-proven at v3 shapes |
| huge-number | first number → 100–900 nines | numeric overflow at the wider bounds |
| unicode-edge | NUL / lone surrogates / U+2028 / BOM / quote-escape mangling | string-literal scan correctness on bigger docs |
| proto-keys | inject `__proto__`/`constructor.prototype` carriers at the root | pollution guard re-proven at v3 shapes |
| dup-key | first key → duplicate `name` override | last-wins duplicate keys in v3 bytes |
| nan-literal | first number → `NaN`/`Infinity`/`1e999`/`0x10` | non-JSON literals in v3 fields |
| **v3-literal (SV-2)** | first number ← one of 18 v3 boundary literals: octave −4/−3/3/4/1.5 · length 0.25 · bars 8/16/32/64/127/128/129 · start/length 2047/2048/2049 · degree 23/24 | drives every widened edge through the real decode path from every seed |

## C. 4 MB cap boundary class (deterministic, SV-2)

Not in the rotation (cost); a bounded set of exact cases in
`tests/fuzz-codec.test.ts` §"SV-2 4 MB cap boundary". The max-dense worst
case is the SV-1 measurement's doc rebuilt by the shared
`maximallyDenseV3Doc()` (2,693,154 canonical chars ≈ 2.63 MB — matches SV-1's
2,693,153 and the verifier's independent 2,693,135 within fx-param
serialization nuance).

| # | Case | Law | Gate |
|---|------|-----|------|
| B1 | max-dense doc padded with trailing spaces to EXACTLY 4,194,304 chars | decodes (guard is `>`, not `>=`); canonical round-trip holds AT the cap | near-cap |
| B2 | same + 1 char (trailing and leading) | `TextTooLargeError` | just-over |
| B3 | 500-deep tower padded over cap | `TextTooLargeError`, NOT `DepthLimitError` — the size check runs BEFORE the scan (guard order pinned) | guard order |
| B4 | over-cap + unterminated JSON string | `TextTooLargeError` — the parser is never reached | hostile combo |
| B5 | over-cap + `__proto__`/`constructor` payload | `TextTooLargeError`; `Object.prototype` stays clean | hostile combo |
| B6 | deep tower injected into the dense v3 seed (rotation shape) | `DepthLimitError` before parse; prototype clean | depth re-proof |
| B7 | tower of exactly 63 under a v3 root (total depth 64) | passes the scan, typed validation reject (cap is a cap, not a ban) | depth re-proof |
| B8 | proto-keys on the v3 boundary seed | typed validation reject; prototype clean | pollution re-proof |

## D. Guard parity (every size/depth guard scaled or pinned deliberately)

The audit the cap raise demanded: no guard may drift silently. Executable pin
= `tests/fuzz-codec.test.ts` §"SV-2 guard parity".

| Guard | Value | Where | Decision + reason | Pin |
|-------|-------|-------|-------------------|-----|
| `DECODE_MAX_CHARS` | 4,194,304 (4 MB) | `src/document/codec.ts` | **SCALED by SV-1** (was 1 MB): the measured max-dense legal v3 doc is 2.69 M chars ≈ 2.63 MB — the old cap rejected legal documents. 4 MB = 1.56x headroom over the worst case, 2.5x under the file guard. Policy line: patterns-per-lane are unbounded, so no finite cap covers every legal doc — several dense 128-bar patterns chained can still exceed 4 MB and reject (degenerate authoring) | parity test pins `4_194_304` exactly + margin test in `document-codec-property.test.ts` (max-dense stays under) |
| `IMPORT_MAX_BYTES` | 10,485,760 (10 MB) | `src/persist/fileIO.ts` | **PINNED** (unchanged): the outer layer; its relationship to the raised inner cap is the load-bearing fact — a file between 4 and 10 MB passes the file guard and lands on the codec layer with HL-1's honest too-large message | parity test pins the value + `DECODE_MAX_CHARS < IMPORT_MAX_BYTES` + ratio ≥ 2.5 |
| `DECODE_MAX_DEPTH` | 64 | `src/document/codec.ts` | **PINNED** (unchanged): real documents nest ≤ 7 (max-dense + boundary seeds measured ≤ 10 by test); 64 stays generous. The pre-scan is O(n)/O(1)-memory and content-blind, so the 4 MB raise needed no depth change | parity test pins `64` + `scanJsonDepth(max-dense) ≤ 10`; deep/at-cap rows B6/B7 |
| Corpus bound (harness) | `DECODE_MAX_CHARS` | `tests/fuzz-harness.ts` | **SCALED with the cap** (was hardcoded `1_048_576`): every mutated text must stay inside the guarded parse surface; the 111 KB max seed leaves ~36.9x headroom, so no mutation can cross the cap today — if one ever does, the harness records it as a crash (the guard's own tripwire) | harness crash check per case |
| Soak timeout | `max(5s, CASES x 3)` | `tests/fuzz-codec.test.ts` | **SCALED** (was `x 0.5`): dense v3 seeds cost ~1.7 s / 2k cases measured (50k ≈ 44 s wall) | the soak run itself |
| Per-field v3 caps | bars ∈ {1,2,4,8,16,32,64,128} · note start ≤ 2047 · length ∈ [0.25, 2048] on the 0.25 grid · degree ≤ 23 · lane octave ∈ [−3, 3] integer (pitched only, canonical-empty at 0) | `src/document/schema.ts` (vocabulary, `NoteSchema`, `LaneOctaveSchema`) | **ADDED by SV-1, pinned here through the decode path**: every out-of-band neighbor (bars 3/127/129, start 2048, length 2049/2048.1, octave ±4/1.5, degree 24) typed-rejects; accepted edges ride seed S9's own bytes | per-field row + S9 in rotation + v3-literal mutation class |
| Older per-field caps (unchanged, re-verified green) | `MAX_FX_PER_LANE` 3 · `CUE_MAX_CHARS` 12 · provenance license/source/author 32/256/64, ≤ 64 entries · sampleRef pattern | `src/document/schema.ts` | **PINNED**: sized in PS-3/DES-6 eras; all still hold at v3 shapes (suites green, no drift) | their original suites |

## Teeth (re-proven 2026-09-04, scratch-revert then restore)

1. Depth pre-scan disabled in `decode()` → the SV-2 deep-tower row (B6) goes
   RED ("expected error to be instance of DepthLimitError"); the pre-scan is
   load-bearing for the v3 shapes, not just the CA-2 shells.
2. Size cap disabled in `decode()` → FOUR boundary rows go RED (just-over,
   guard-order, over-cap+invalid-JSON, over-cap+proto) — the guard-order row
   fails by flipping to `DepthLimitError`, proving the order pin has teeth.
Both probes reverted byte-exact (git diff shows only the deliberate comment
fix in `codec.ts`).

## How to re-run

```sh
npm test                                   # includes the 2,000-case CI slice
npm run fuzz                               # 50k soak through scripts/fuzz.mjs
npm run fuzz -- --cases=200000             # deeper soak (timeout scales: CASES x 3 ms)
FUZZ_VERBOSE=1 npm run fuzz                # valid/rejected/byMutation histogram
```

Exit code 0 = every case validated or typed-rejected, crashes = 0.
