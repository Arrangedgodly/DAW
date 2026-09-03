# Sample content — licensing, provenance, budget (PS-2, iteration 2)

Status: **landed 2026-09-03 (PS-2)**. Owner of the rules: Captain America
lane. This doc is the operating manual for bundled audio content; the
per-asset record of truth is [`PROVENANCE.md`](../../PROVENANCE.md) at the
repo root, and the machine-readable mirror is the manifest in
`src/assets/content/loader.ts` (`CONTENT_ASSETS`). A unit gate
(`tests/content-provenance.test.ts`, `npm run check:content`) pins all three
together: manifest ↔ PROVENANCE rows ↔ bytes on disk (size + sha256).

## Sources (RES-10 committed route, decision block in docs/ultron/plan.md)

- **Tonal one-shot voices** — Kenney "Digital Audio" pack
  (https://kenney.nl/assets/digital-audio), pack-level **CC0** (in-pack
  License.txt: "License (Creative Commons Zero, CC0) … Credit would be nice
  but is not mandatory."). Direct zip download, no account.
- **Drum one-shots** — freesound.org files licensed **Creative Commons 0**,
  verified per file on each sound page (the page shows the license name and
  links to https://creativecommons.org/publicdomain/zero/1.0/).
- **VCSL — Versilian Community Sample Library** (Sam Gossner,
  https://github.com/sgossner/VCSL), repo-level **CC0 1.0** (LICENSE file
  verified; PROVENANCE.md rows pin the exact commit) — used for five drum
  slots (see the second adjustment below).
- Recorded fallback (RES-10): percussion one-shots extracted from
  FluidR3 (MIT) via Polyphone — content-only swap under the same rules.

### PS-2 recorded adjustment 1 — freesound previews instead of originals

The committed route says "freesound CC0 drum one-shots … ORIGINAL downloads
need a free account". This run is full autopilot and must not halt for human
credentials, so the committed bytes are freesound's **public `-lq.ogg`
preview transcodes** (served from cdn.freesound.org without any login —
the same CC0 audio, transcoded by freesound, typically 64 kbps mono/stereo
Vorbis). This stays inside the RES-10 envelope (CC0 one-shots, OGG, size
pin, per-asset provenance — the transformation is recorded per row).
Swapping previews for the higher-fidelity originals (and/or `-hq.ogg`
previews where present) is a **wizard-lane follow-up for the human** — a
free freesound account or API key is required; until then the provenance
rows carry the preview URLs.

### PS-2 recorded adjustment 2 — five slots re-sourced to VCSL (CC0)

Mid-curation, cdn.freesound.org rate-limited this machine's IP (HTTP 403 on
every preview for 100+ minutes — confirmed IP-level: full browser
fingerprints, cookies, and a silent 10-minute window all still blocked).
Five slots the curation had selected (808 kick + kick2, acoustic clap,
punch kick + punch clap) could not be fetched, and no other
verified-CC0-at-the-source clap exists on any automatable direct-download
host (OpenGameArt: no CC0 clap one-shots; Wikimedia Commons claps are
CC-BY/CC-BY-SA — rejected; GitHub "public domain" mirrors without license
files — rejected as unverifiable). The slots were re-sourced from **VCSL**
(repo LICENSE = CC0 1.0 legal text, verified at the source; rows pinned to
commit `c1ea7bc`): Claps/SoloClap_vl2 + Claps/Clap_rr1 (claps),
Bass Drum 1 v5/v7/v2 hits (kicks), transcoded OGG mono with recorded
trims/fades. The envelope holds: 33 CC0 files, 345 KB, per-asset
provenance. The original freesound picks (OllieOllie 240893 "trappy kick",
soneproject 259516 "kick1", Frederik_Sunne 438968 "handclap",
LudwigMueller 548507 "Perc_Clap_lo", Blackie666 84729 "909Kickdist" — all
verified CC0 on their pages during curation) remain recorded here for the
wizard lane: re-fetching them when the CDN window clears (or via an
account) is a content-only swap under checklist §"Adding or swapping
content" below. Professor X may also re-curate the 808 kit's acoustic-bass-
drum kicks at PS-4 (the 808 family snare/hats/clap/tom are freesound).

## Licensing rules (hard)

1. **CC0/MIT-class ONLY** for bundled content. CC-BY (even attribution-only
   in a NOTICE file), CC-BY-SA, GPL, "royalty-free", "free for use", and
   custom licenses are ALL rejected — no exceptions, no "just this once".
   If the license cannot be verified at the source (pack page, in-pack
   license file, or per-file page), the asset is unusable regardless of
   what a third-party mirror claims.
2. **Verification is per-asset and at the source.** For freesound: the
   sound's own page must show "Creative Commons 0". For pack-distributed
   assets (Kenney): the pack page AND the in-pack License.txt. The URL, the
   license reference, the author, and the fetch date go into PROVENANCE.md.
3. **PROVENANCE.md is append-only per release and gate-enforced.** Every
   committed byte under `src/assets/content/` must have a row: file, size,
   sha256, source URL, license, author, fetch date, transformations. The
   unit gate recomputes size + sha256 from disk and fails on any missing,
   mismatched, or unlisted file. Manifest rows (`CONTENT_ASSETS` in
   loader.ts) must carry the same license/source/author.
4. **Transformations are recorded, never silent.** Transcode (freesound
   preview OGG), trim/normalize (if ever applied) — the exact operation
   goes in the row. Today the only transformation is freesound's own
   preview transcode; committed bytes are otherwise unmodified.
5. **No third-party network, ever.** Content is build-bundled and hashed by
   Vite (`/assets/<name>-<hash>.ogg`), fetched same-origin only. CSP
   `connect-src 'self'` (PS-2 refinement of v0's `'none'`) allows exactly
   this; the loader refuses off-origin URLs in code (CSP cannot path-scope
   `'self'`), and the zero-network journey pins both edges (same-origin
   content fetch succeeds; a cross-origin probe is blocked with a CSP
   violation).

## Budget envelope (RES-10 content pin)

- **Working budget ≤ 1 MB, hard ceiling 2 MB** for everything under
  `src/assets/content/`. Committed at PS-2: **33 files, 353,290 B
  (345.0 KB)** (4 sample drum kits × 6 pieces + 3 flagship-kit extras + 6
  pitched one-shot voices).
- Working set guidance: a 6-piece OGG kit ≈ 40–90 KB; keep single files
  ≤ ~50 KB and one-shots ≤ ~2.5 s (808-style tails excepted, ≤ ~4 s max).
- The ~10 MB town-hall ceiling (I2-2) reserves headroom for v1: Safari
  m4a/mp3 transcodes per asset id and more kits.
- Enforced by `npm run check:content` (unit gate; runs in `npm test` and
  the full suite) — budget, file-count sanity, and the full provenance
  equality check above.
- Initial JS stays untouched by content: assets are emitted via the
  separate `content` build entry (vite.config.ts) and fetched only through
  `createSampleLoader().load()` — `npm run check:bundle` counts zero
  content bytes as initial JS.

## Loader contract (PS-2; consumed by PS-4 SampleVoiceHost)

- `createSampleLoader(deps?)` → `{ load(ctx, id), isLoaded, evict }`:
  same-origin `fetch` of the Vite-hashed URL → `decodeAudioData` on the
  target context; per-context cache (WeakMap) + in-flight dedupe; typed
  `SampleAssetError` (`unknown-id | missing-file | cross-origin | fetch |
  decode`) — never a bare throw mid-UI.
- **Lazy law (TH-4(d)):** zero audio-asset fetches on the boot→play path;
  content loads only on explicit preset selection. First paint and PLAY
  must never await a fetch or decode (frame-budget gate with a 4 s
  simulated stall proves it against the built app).
- Offline renders (PS-4 parity law): decode everything the project needs
  BEFORE `startRendering()` — the per-context cache means the offline
  context gets its own decodes.

## Adding or swapping content (checklist)

1. Verify the license at the source per rule 1–2; save the URL + fetch date.
2. Drop the OGG into `src/assets/content/` (`drums-<kit>-<piece>[N].ogg` or
   `voice-<role>-<name>.ogg`); keep the budget envelope.
3. Add the row to PROVENANCE.md (size + sha256 computed from the file) and
   the entry to `CONTENT_ASSETS` in loader.ts.
4. `npm run check:content` — it must pass with the new counts/budget.
5. If a preset references the asset: PS-3's in-project provenance metadata
   picks up `{assetId, license, source}` from the manifest automatically.

## Naming

- Asset ids: `drums.<kit>.<piece>` (+ `2` for flagship variants) and
  `voice.<role>.<name>` — these are the `sampleRef` values PS-3 records.
- Kit/preset NAMES shown in the UI are Professor X's sound-design call
  (RES-10); the manifest keeps neutral slugs (`808`, `acoustic`, `dusty`,
  `punch`).
