# Browser support matrix (HU-1)

Committed stance (town-hall hero claim #9): **Chromium desktop-first; Firefox
best-effort; Safari v1 warn-and-attempt.** Full cross-browser support is
explicitly out of scope for v0.

## Tiers

Detection is a pure probe — `detectSupport(windowLike)` in
`src/support/detect.ts`. It never instantiates an AudioContext; it checks
constructor existence and reads `audioWorklet` off the constructor prototype.
Feature set: `audioContext`, `offlineAudioContext`, `audioWorklet`,
`indexedDB`, `secureContext` (`window.isSecureContext === true`).

| Tier               | Condition                                                                      | What works                                                  | What breaks                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`             | all five features present                                                      | everything (engine, FX, offline render/export, persistence) | —                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `degraded-worklet` | Web Audio + IndexedDB + secure context present, `audioWorklet` missing         | UI, editing, project persistence, file import/export UI     | **No sound.** The voice engine is AudioWorklet-only; `NativePeriodicVoice` (src/audio/voiceEngine.ts) is an unimplemented interface stub — there is **no native-fallback voice engine yet**. Silent operation is impossible by design: the session refuses to build a voice engine host when the context isn't worklet-capable, and a banner says so. Sound in this tier arrives only if/when v1 ships the native fallback. |
| `unsupported`      | any of AudioContext / OfflineAudioContext / IndexedDB / secure context missing | page loads, banner                                          | the app cannot run (no audio graph, no storage, or insecure origin blocks worklet module loading)                                                                                                                                                                                                                                                                                                                           |

### Why IndexedDB and secure context are hard requirements

- IndexedDB is the only persistence layer (MF-1/MF-2); without it every edit
  is lost on reload — dishonest to pretend to work.
- AudioWorklet modules require a secure context in Chromium; non-secure
  origins would silently degrade to the no-worklet path.

## Banners (src/components/Banner.tsx + src/support/banners.ts)

Boot-time, at most one banner, selected by the pure `bannerFor(report, ua)`:

| Condition          | Banner                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported`      | **THIS BROWSER CAN'T RUN BITBOUNCE** — lists the missing features                                                                           |
| `degraded-worklet` | **NO SOUND IN THIS BROWSER** — states plainly that the voice engine needs AudioWorklet, there is no fallback yet, editing/saving still work |
| `full` + Safari UA | **SAFARI SUPPORT IS EXPERIMENTAL — CHROME RECOMMENDED** — app still attempts everything                                                     |

- `role=alert`, keyboard-dismissible (dismiss button + Escape), in-world
  styling (near-black ground, warm-white ink, Silkscreen label face).
- Rendered as a `position: fixed` top overlay → **no layout shift** on
  appear/disappear by construction.
- **Safari is detected by user-agent sniff ONLY for the warning copy** (marked
  cosmetic in code). UA sniffing never gates functionality.
- Dismissal persists **for the session, in memory only** (module-level Set in
  `src/support/banners.ts`; resets on reload). Why: v0 has no settings
  storage — the document store is the only persisted state and project files
  must not carry UI prefs.

## How to test locally (devtools overrides)

1. **Missing worklet (degraded-worklet):** devtools console →
   `Object.defineProperty(AudioContext.prototype, 'audioWorklet', {get(){ return undefined }})`
   then reload. Expect the NO SOUND banner.
2. **Unsupported:** delete any required global, e.g.
   `delete (window as any).indexedDB` before app boot (or use an incognito
   window with site data blocked), or serve over plain HTTP on a non-localhost
   host to lose the secure context. Expect the CAN'T RUN banner with the
   missing feature listed.
3. **Safari warning:** devtools → device toolbar / override user agent to
   Safari, reload. Expect the experimental banner on an otherwise full tier.
4. Unit tests (`tests/support-banners.test.ts`) cover the same matrix against
   fake windows and pure banner selection, so no real browser mutation is
   needed in CI.

## Engine relationship

`isWorkletCapable(ctx)` (src/audio/voiceEngine.ts) remains the runtime guard
inside the session; `detectSupport` is the boot-time UI probe. They agree by
construction (both check `audioWorklet.addModule` presence).
