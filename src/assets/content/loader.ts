/**
 * PS-2 — lazy same-origin sample-content loader (RES-10 committed route,
 * Option A). Files under src/assets/content/ are CC0 one-shot OGGs whose
 * provenance is pinned per-asset in PROVENANCE.md (repo root) and mirrored
 * into the manifest below (a unit test enforces manifest ↔ PROVENANCE ↔
 * bytes-on-disk equality — tests/content-provenance.test.ts).
 *
 * Laws (plan.md PS-2 + TH-4(d)):
 * - SAME-ORIGIN ONLY: URLs come exclusively from this module's Vite glob —
 *   build-bundled hashed `/assets/<name>-<hash>.ogg` served from our own
 *   origin. No third-party URL can enter this table by construction, and
 *   `load()` refuses any URL that resolves off-origin (defense in depth on
 *   top of CSP `connect-src 'self'`; CSP cannot path-scope 'self', so the
 *   loader + gates enforce the /assets discipline).
 * - LAZY: nothing here fetches at import time. `load()` is the only fetch
 *   path and it is invoked by PS-4's SampleVoiceHost on explicit preset
 *   selection — never on boot, never before first paint/PLAY (TH-4(d)
 *   frame-budget gate proves it with a 4 s simulated asset stall).
 * - NEVER BLOCKING: `load()` returns a promise; callers must not await it
 *   inside a render/pointer/audio-callback path. Decodes go through the
 *   injected context's decodeAudioData off the critical path.
 * - PER-CONTEXT CACHE: decodeAudioData resamples to the context rate, so
 *   buffers are cached per BaseAudioContext (WeakMap) with in-flight
 *   deduplication — the offline render path (PS-4 parity law) gets its own
 *   decodes.
 *
 * License rule (Captain America): every asset is CC0/MIT-class ONLY; rows
 * in PROVENANCE.md record source URL, license, author, fetch date, size,
 * sha256, and transformations. FreeSound rows are public -lq.ogg preview
 * transcodes (originals are login-gated — swapping to originals is a
 * wizard-lane follow-up, see docs/dev/content.md).
 */

import type { DrumPiece } from "../../document/schema";

export type ContentVoiceRole = "bass" | "chords" | "lead";

export interface DrumContentAsset {
  readonly kind: "drums";
  /** Asset id — the `sampleRef` PS-3 presets record (e.g. "drums.808.kick"). */
  readonly id: string;
  /** File basename under src/assets/content/. */
  readonly file: string;
  readonly kit: string;
  readonly piece: DrumPiece;
  /** Variant number for flagship-kit extras (2 = kick2/snare2/hat2 rows). */
  readonly variant?: number;
  readonly license: string;
  readonly sourceUrl: string;
  readonly author: string;
}

export interface VoiceContentAsset {
  readonly kind: "voice";
  readonly id: string;
  readonly file: string;
  readonly role: ContentVoiceRole;
  readonly license: string;
  readonly sourceUrl: string;
  readonly author: string;
  /**
   * Pitch-mapping root for playbackRate (RES-10/PS-3), MEASURED by PS-4:
   * the onset-frame fundamental of each committed one-shot (see the
   * rootMidi block comment below the manifest). midiToFreq(rootMidi) is
   * the pitch the recording attacks at; presets derive
   * playbackRate = 2^((noteMidi − rootMidi)/12).
   */
  readonly rootMidi?: number;
}

export type ContentAsset = DrumContentAsset | VoiceContentAsset;

/** The committed content list (RES-10): 4 sample drum kits + 6 pitched voices. */
export const CONTENT_ASSETS: readonly ContentAsset[] = [
  // --- kit: 808 (flagship — kick/snare/hat extras included) ---------------
  // NOTE (PS-2 recorded adjustment): the two 808 kick slots + acoustic/punch
  // claps + punch kick were re-sourced from VCSL (CC0, verified at the repo
  // LICENSE, pinned commit) after cdn.freesound.org rate-limited this
  // machine's IP mid-curation — see docs/dev/content.md.
  { kind: "drums", id: "drums.808.kick", file: "drums-808-kick.ogg", kit: "808", piece: "kick", license: "CC0", sourceUrl: "https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Bass%20Drum%201/BDrumNew_hit_v5_rr1_Sum.wav", author: "Sam Gossner (VCSL)" },
  { kind: "drums", id: "drums.808.snare", file: "drums-808-snare.ogg", kit: "808", piece: "snare", license: "CC0", sourceUrl: "https://freesound.org/people/Uberproduktion/sounds/455642/", author: "Uberproduktion" },
  { kind: "drums", id: "drums.808.hat", file: "drums-808-hat.ogg", kit: "808", piece: "hat", license: "CC0", sourceUrl: "https://freesound.org/people/M0nsterHD/sounds/811628/", author: "M0nsterHD" },
  { kind: "drums", id: "drums.808.openhat", file: "drums-808-openhat.ogg", kit: "808", piece: "openhat", license: "CC0", sourceUrl: "https://freesound.org/people/Mo-reno-lopez/sounds/668896/", author: "Mo-reno-lopez" },
  { kind: "drums", id: "drums.808.clap", file: "drums-808-clap.ogg", kit: "808", piece: "clap", license: "CC0", sourceUrl: "https://freesound.org/people/Karman_Lyne/sounds/519305/", author: "Karman_Lyne" },
  { kind: "drums", id: "drums.808.tom", file: "drums-808-tom.ogg", kit: "808", piece: "tom", license: "CC0", sourceUrl: "https://freesound.org/people/stomachache/sounds/158658/", author: "stomachache" },
  { kind: "drums", id: "drums.808.kick2", file: "drums-808-kick2.ogg", kit: "808", piece: "kick", variant: 2, license: "CC0", sourceUrl: "https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Bass%20Drum%201/BDrumNew_hit_v7_rr1_Sum.wav", author: "Sam Gossner (VCSL)" },
  { kind: "drums", id: "drums.808.snare2", file: "drums-808-snare2.ogg", kit: "808", piece: "snare", variant: 2, license: "CC0", sourceUrl: "https://freesound.org/people/choomaque-crispydinner/sounds/252743/", author: "choomaque-crispydinner" },
  { kind: "drums", id: "drums.808.hat2", file: "drums-808-hat2.ogg", kit: "808", piece: "hat", variant: 2, license: "CC0", sourceUrl: "https://freesound.org/people/Rodrigo%20The%20Mad/sounds/165028/", author: "Rodrigo The Mad" },
  // --- kit: acoustic --------------------------------------------------------
  { kind: "drums", id: "drums.acoustic.kick", file: "drums-acoustic-kick.ogg", kit: "acoustic", piece: "kick", license: "CC0", sourceUrl: "https://freesound.org/people/bdu/sounds/808/", author: "bdu" },
  { kind: "drums", id: "drums.acoustic.snare", file: "drums-acoustic-snare.ogg", kit: "acoustic", piece: "snare", license: "CC0", sourceUrl: "https://freesound.org/people/johnnydekk/sounds/581469/", author: "johnnydekk" },
  { kind: "drums", id: "drums.acoustic.hat", file: "drums-acoustic-hat.ogg", kit: "acoustic", piece: "hat", license: "CC0", sourceUrl: "https://freesound.org/people/johnnydekk/sounds/581471/", author: "johnnydekk" },
  { kind: "drums", id: "drums.acoustic.openhat", file: "drums-acoustic-openhat.ogg", kit: "acoustic", piece: "openhat", license: "CC0", sourceUrl: "https://freesound.org/people/johnnydekk/sounds/581476/", author: "johnnydekk" },
  { kind: "drums", id: "drums.acoustic.clap", file: "drums-acoustic-clap.ogg", kit: "acoustic", piece: "clap", license: "CC0", sourceUrl: "https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/SoloClap_vl2.wav", author: "Sam Gossner (VCSL)" },
  { kind: "drums", id: "drums.acoustic.tom", file: "drums-acoustic-tom.ogg", kit: "acoustic", piece: "tom", license: "CC0", sourceUrl: "https://freesound.org/people/bdu/sounds/810/", author: "bdu" },
  // --- kit: dusty ------------------------------------------------------------
  { kind: "drums", id: "drums.dusty.kick", file: "drums-dusty-kick.ogg", kit: "dusty", piece: "kick", license: "CC0", sourceUrl: "https://freesound.org/people/Dolfeus/sounds/55231/", author: "Dolfeus" },
  { kind: "drums", id: "drums.dusty.snare", file: "drums-dusty-snare.ogg", kit: "dusty", piece: "snare", license: "CC0", sourceUrl: "https://freesound.org/people/alexthegr81/sounds/212240/", author: "alexthegr81" },
  { kind: "drums", id: "drums.dusty.hat", file: "drums-dusty-hat.ogg", kit: "dusty", piece: "hat", license: "CC0", sourceUrl: "https://freesound.org/people/blakengouda/sounds/509972/", author: "blakengouda" },
  { kind: "drums", id: "drums.dusty.openhat", file: "drums-dusty-openhat.ogg", kit: "dusty", piece: "openhat", license: "CC0", sourceUrl: "https://freesound.org/people/blakengouda/sounds/509985/", author: "blakengouda" },
  { kind: "drums", id: "drums.dusty.clap", file: "drums-dusty-clap.ogg", kit: "dusty", piece: "clap", license: "CC0", sourceUrl: "https://freesound.org/people/Stumber/sounds/199266/", author: "Stumber" },
  { kind: "drums", id: "drums.dusty.tom", file: "drums-dusty-tom.ogg", kit: "dusty", piece: "tom", license: "CC0", sourceUrl: "https://freesound.org/people/oceansonmars/sounds/708817/", author: "oceansonmars" },
  // --- kit: punch ------------------------------------------------------------
  { kind: "drums", id: "drums.punch.kick", file: "drums-punch-kick.ogg", kit: "punch", piece: "kick", license: "CC0", sourceUrl: "https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Bass%20Drum%201/BDrumNew_hit_v2_rr1_Sum.wav", author: "Sam Gossner (VCSL)" },
  { kind: "drums", id: "drums.punch.snare", file: "drums-punch-snare.ogg", kit: "punch", piece: "snare", license: "CC0", sourceUrl: "https://freesound.org/people/BennyRock/sounds/152421/", author: "BennyRock" },
  { kind: "drums", id: "drums.punch.hat", file: "drums-punch-hat.ogg", kit: "punch", piece: "hat", license: "CC0", sourceUrl: "https://freesound.org/people/TheEndOfACycle/sounds/674296/", author: "TheEndOfACycle" },
  { kind: "drums", id: "drums.punch.openhat", file: "drums-punch-openhat.ogg", kit: "punch", piece: "openhat", license: "CC0", sourceUrl: "https://freesound.org/people/bdu/sounds/813/", author: "bdu" },
  { kind: "drums", id: "drums.punch.clap", file: "drums-punch-clap.ogg", kit: "punch", piece: "clap", license: "CC0", sourceUrl: "https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr1.wav", author: "Sam Gossner (VCSL)" },
  { kind: "drums", id: "drums.punch.tom", file: "drums-punch-tom.ogg", kit: "punch", piece: "tom", license: "CC0", sourceUrl: "https://freesound.org/people/bdu/sounds/805/", author: "bdu" },
  // --- pitched one-shot voices (Kenney Digital Audio, pack-level CC0) -------
  // rootMidi values MEASURED by PS-4 (method recorded below the manifest):
  // onset-frame fundamental frequency of each recording, rounded to the
  // nearest semitone. Four of the six sweep after the attack (lowtone falls
  // ~an octave, phaserup/highup rise, twotone/threetone step between tones)
  // — the ONSET pitch is the playbackRate root because that is the pitch a
  // note's attack carries; the sweep rides on top exactly as recorded.
  { kind: "voice", id: "voice.bass.lowtone", file: "voice-bass-lowtone.ogg", role: "bass", rootMidi: 42, license: "CC0", sourceUrl: "https://kenney.nl/assets/digital-audio", author: "Kenney Vleugels (Kenney.nl)" },
  { kind: "voice", id: "voice.chords.tone", file: "voice-chords-tone.ogg", role: "chords", rootMidi: 60, license: "CC0", sourceUrl: "https://kenney.nl/assets/digital-audio", author: "Kenney Vleugels (Kenney.nl)" },
  { kind: "voice", id: "voice.chords.twotone", file: "voice-chords-twotone.ogg", role: "chords", rootMidi: 62, license: "CC0", sourceUrl: "https://kenney.nl/assets/digital-audio", author: "Kenney Vleugels (Kenney.nl)" },
  { kind: "voice", id: "voice.chords.threetone", file: "voice-chords-threetone.ogg", role: "chords", rootMidi: 60, license: "CC0", sourceUrl: "https://kenney.nl/assets/digital-audio", author: "Kenney Vleugels (Kenney.nl)" },
  { kind: "voice", id: "voice.lead.phaserup", file: "voice-lead-phaserup.ogg", role: "lead", rootMidi: 60, license: "CC0", sourceUrl: "https://kenney.nl/assets/digital-audio", author: "Kenney Vleugels (Kenney.nl)" },
  { kind: "voice", id: "voice.lead.highup", file: "voice-lead-highup.ogg", role: "lead", rootMidi: 75, license: "CC0", sourceUrl: "https://kenney.nl/assets/digital-audio", author: "Kenney Vleugels (Kenney.nl)" },
];

/**
 * PS-4 rootMidi measurement method (recorded per the plan's "measure
 * fundamentals — record method" law; script parameters kept so the numbers
 * are reproducible): each OGG decoded with ffmpeg to 44.1 kHz mono f32 PCM;
 * STFT with 4096-sample Hann frames, 1024-sample hop, 16384-point FFT,
 * quadratic peak interpolation; the ONSET frame = first frame whose dominant
 * peak magnitude exceeds 10% of the file's strongest frame; rootMidi =
 * round(69 + 12·log2(onsetFrameHz / 440)). Measured onset fundamentals:
 * lowtone 94.1 Hz (midi 42.3), tone 260.7 Hz (59.9), twotone 293.9 Hz (62.0),
 * threetone 264.8 Hz (60.2), phaserup 262.1 Hz (60.0), highup 626.9 Hz
 * (75.1). The committed integers are the rounded values.
 */

/** The four committed sample kit ids (RES-10 shape). */
export const CONTENT_KIT_IDS = ["808", "acoustic", "dusty", "punch"] as const;
export type ContentKitId = (typeof CONTENT_KIT_IDS)[number];

/**
 * Vite-hashed, same-origin URLs for the committed OGGs. EAGER string map
 * (URLs only — never audio bytes), so the asset files are emitted into
 * dist/assets/ at build time while every actual fetch stays behind load().
 */
const ASSET_URLS = import.meta.glob("./*.ogg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const urlByFile: ReadonlyMap<string, string> = new Map(
  Object.entries(ASSET_URLS).map(([path, url]) => [
    path.replace(/^.*\//, ""),
    url,
  ]),
);

const assetById = new Map(CONTENT_ASSETS.map((a) => [a.id, a]));

export function getAsset(id: string): ContentAsset | undefined {
  return assetById.get(id);
}

/** Kit → asset ids, base pieces first, flagship extras after. */
export function kitAssetIds(kit: ContentKitId): string[] {
  return CONTENT_ASSETS.filter(
    (a): a is DrumContentAsset => a.kind === "drums" && a.kit === kit,
  ).map((a) => a.id);
}

/** Voice asset ids for a lane role. */
export function voiceAssetIds(role: ContentVoiceRole): string[] {
  return CONTENT_ASSETS.filter(
    (a): a is VoiceContentAsset => a.kind === "voice" && a.role === role,
  ).map((a) => a.id);
}

/**
 * Same-origin URL for an asset id (no fetch). Throws SampleAssetError for an
 * unknown id or a manifest row with no matching file on disk.
 */
export function assetUrl(id: string): string {
  const asset = assetById.get(id);
  if (!asset) throw new SampleAssetError("unknown-id", id);
  const url = urlByFile.get(asset.file);
  if (!url) throw new SampleAssetError("missing-file", id);
  return url;
}

export type SampleAssetErrorKind =
  | "unknown-id"
  | "missing-file"
  | "cross-origin"
  | "fetch"
  | "decode";

export class SampleAssetError extends Error {
  constructor(
    readonly kind: SampleAssetErrorKind,
    readonly id: string,
    readonly cause?: unknown,
  ) {
    super(`sample asset ${id}: ${kind}` + (cause ? ` (${String(cause)})` : ""));
    this.name = "SampleAssetError";
  }
}

/** Injectables so unit tests can drive the loader without a browser. */
export interface SampleLoaderDeps {
  fetchImpl?: typeof fetch;
  /** Decode seam; default is the context's own decodeAudioData. */
  decode?: (ctx: BaseAudioContext, data: ArrayBuffer) => Promise<AudioBuffer>;
}

export interface SampleLoader {
  /** Fetch + decode an asset on a context. Cached per context; deduped. */
  load(ctx: BaseAudioContext, id: string): Promise<AudioBuffer>;
  /** True when a successful load is cached for this context. */
  isLoaded(ctx: BaseAudioContext, id: string): boolean;
  /**
   * The decoded buffer when cached, else undefined — PS-4's sync seam for the
   * SampleVoiceHost (scheduling an AudioBufferSourceNode needs the buffer
   * NOW; a miss is a dropped live note, never an await on the audio path).
   */
  peek(ctx: BaseAudioContext, id: string): AudioBuffer | undefined;
  /** Drop cached buffers (keeps in-flight promises; tests + hot-swap). */
  evict(ctx?: BaseAudioContext): void;
}

/**
 * Pure same-origin guard (exported for tests): resolves `url` against
 * `base` and throws `cross-origin` when the origins differ. CSP
 * `connect-src 'self'` cannot path-scope origins, so the loader refuses
 * off-origin URLs in code as defense in depth.
 */
export function assertSameOrigin(id: string, url: string, base: string): void {
  const resolved = new URL(url, base);
  if (resolved.origin !== new URL(base).origin)
    throw new SampleAssetError("cross-origin", id, resolved.href);
}

/**
 * Create a loader. The ONLY fetch path in the content system; refuses
 * off-origin URLs even if a manifest row were tampered with.
 */
export function createSampleLoader(deps: SampleLoaderDeps = {}): SampleLoader {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const decode = deps.decode ?? ((ctx, data) => ctx.decodeAudioData(data));
  let cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
  const inFlight = new WeakMap<
    BaseAudioContext,
    Map<string, Promise<AudioBuffer>>
  >();

  const guardSameOrigin = (id: string, url: string): void => {
    const loc = (globalThis as { location?: Location | undefined }).location;
    if (!loc) return; // non-browser (node tests) — no origin to compare
    assertSameOrigin(id, url, loc.href);
  };

  const loadOne = async (
    ctx: BaseAudioContext,
    id: string,
  ): Promise<AudioBuffer> => {
    const url = assetUrl(id); // unknown-id / missing-file throw here
    guardSameOrigin(id, url);
    let bytes: ArrayBuffer;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
    } catch (err) {
      throw err instanceof SampleAssetError
        ? err
        : new SampleAssetError("fetch", id, err);
    }
    try {
      return await decode(ctx, bytes);
    } catch (err) {
      throw new SampleAssetError("decode", id, err);
    }
  };

  return {
    load(ctx, id) {
      const cached = cache.get(ctx);
      if (cached?.has(id)) return Promise.resolve(cached.get(id)!);
      let pending = inFlight.get(ctx);
      const existing = pending?.get(id);
      if (existing) return existing;
      const p = loadOne(ctx, id)
        .then((buffer) => {
          const store = cache.get(ctx) ?? new Map<string, AudioBuffer>();
          store.set(id, buffer);
          cache.set(ctx, store);
          inFlight.get(ctx)?.delete(id);
          return buffer;
        })
        .catch((err: unknown) => {
          inFlight.get(ctx)?.delete(id);
          throw err;
        });
      pending ??= new Map();
      pending.set(id, p);
      inFlight.set(ctx, pending);
      return p;
    },
    isLoaded(ctx, id) {
      return cache.get(ctx)?.has(id) ?? false;
    },
    peek(ctx, id) {
      return cache.get(ctx)?.get(id);
    },
    evict(ctx) {
      if (ctx) cache.delete(ctx);
      else cache = new WeakMap();
    },
  };
}
