/**
 * HU-1 — browser capability detection.
 *
 * Pure probe: given a window-like object, report which features Bitbounce
 * needs and derive a support tier. No globals touched here — the caller
 * passes `window` (tests pass fakes). Tier semantics (committed stance,
 * docs/dev/browser-support.md):
 *
 * - 'full'             — everything present; the whole engine runs.
 * - 'degraded-worklet' — Web Audio exists but AudioWorklet does not. HONEST
 *   BREAKAGE: the only non-worklet voice path is the `NativePeriodicVoice`
 *   interface stub (src/audio/voiceEngine.ts) — it is NOT implemented. So in
 *   this tier there is NO voice engine yet: the app loads, edits persist,
 *   but nothing sounds until v1 ships the native fallback. We say so on a
 *   banner instead of failing silently.
 * - 'unsupported'       — a required feature is missing; the app cannot run.
 *
 * Safari is detected by UA ONLY for a cosmetic warn-and-attempt message
 * (see `isSafariUA`); it never gates functionality.
 */

export interface SupportReport {
  /** Bitbounce's required feature set, individually. */
  readonly features: {
    readonly audioContext: boolean;
    readonly offlineAudioContext: boolean;
    readonly audioWorklet: boolean;
    readonly indexedDB: boolean;
    readonly secureContext: boolean;
  };
  /** Human-readable names of missing required features (empty when full). */
  readonly missing: readonly string[];
  readonly tier: SupportTier;
}

export type SupportTier = "full" | "degraded-worklet" | "unsupported";

/** Features whose absence makes the app unsupported (not merely degraded). */
const REQUIRED_FEATURES = [
  "audioContext",
  "offlineAudioContext",
  "indexedDB",
  "secureContext",
] as const;

const FEATURE_LABELS: Record<keyof SupportReport["features"], string> = {
  audioContext: "Web Audio (AudioContext)",
  offlineAudioContext: "Offline Audio (OfflineAudioContext)",
  audioWorklet: "AudioWorklet",
  indexedDB: "IndexedDB storage",
  secureContext: "Secure context (HTTPS or localhost)",
};

/**
 * Minimal window surface we probe. `AudioContext`/`OfflineAudioContext` are
 * constructor properties (we check existence, never instantiate — the probe
 * must stay side-effect free); `audioWorklet` is read off the constructor's
 * prototype because instances expose it there.
 */
export interface WindowLike {
  readonly AudioContext?: unknown;
  readonly OfflineAudioContext?: unknown;
  readonly indexedDB?: unknown;
  readonly isSecureContext?: unknown;
}

type AnyRecord = Record<string, unknown>;

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

/**
 * Detect `audioWorklet` on a constructor WITHOUT invoking native getters.
 * Real browsers expose it as a prototype accessor; reading it off anything
 * but a live instance throws "Illegal invocation" (e.g. from a subclassed
 * AudioContext), so we walk the prototype chain and inspect property
 * descriptors: an accessor means the native worklet surface exists; a data
 * value (test doubles) must carry a callable `addModule`.
 */
function hasAudioWorklet(ctor: unknown): boolean {
  if (typeof ctor !== "function") return false;
  let proto: AnyRecord | null | undefined = (ctor as unknown as AnyRecord)
    .prototype as AnyRecord | null | undefined;
  while (proto) {
    // Own descriptors only — `in` would match inherited accessors at the
    // first level where no descriptor exists, defeating the walk.
    const descriptor = Object.getOwnPropertyDescriptor(proto, "audioWorklet");
    if (descriptor) {
      if (typeof descriptor.get === "function") return true;
      const worklet = descriptor.value as AnyRecord | undefined;
      return !!worklet && isFunction(worklet.addModule);
    }
    proto = Object.getPrototypeOf(proto) as AnyRecord | null | undefined;
  }
  return false;
}

export function detectSupport(win: WindowLike): SupportReport {
  const features = {
    audioContext: isFunction(win.AudioContext),
    offlineAudioContext: isFunction(win.OfflineAudioContext),
    audioWorklet:
      hasAudioWorklet(win.AudioContext) ||
      hasAudioWorklet(win.OfflineAudioContext),
    indexedDB: !!win.indexedDB,
    secureContext: win.isSecureContext === true,
  };
  const missing = REQUIRED_FEATURES.filter((key) => !features[key]).map(
    (key) => FEATURE_LABELS[key],
  );
  const tier: SupportTier =
    missing.length > 0
      ? "unsupported"
      : features.audioWorklet
        ? "full"
        : "degraded-worklet";
  return { features, missing, tier };
}

/**
 * COSMETIC UA SNIFF — the only user-agent check in the codebase.
 * Used solely to show the "Safari support is experimental" warn-and-attempt
 * banner; the app still attempts everything regardless of the result.
 * Never used to gate features (town-hall stance: Safari v1 = warn-and-attempt).
 */
export function isSafariUA(userAgent: string): boolean {
  return (
    /\bSafari\b/.test(userAgent) &&
    !/Chrom(e|ium)|OPR|Edg|FxiOS|CriOS|SamsungBrowser/.test(userAgent)
  );
}
