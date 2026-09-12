# Privacy — the zero-network guarantee

**Town-hall acceptance criterion 9:** "Zero network calls at runtime; no data
leaves the device except explicit file exports."
**Captain America's stance:** local-first forever; privacy is a first
principle, not a feature. No telemetry — not "off by default", _absent_.

This document is the CA-1 record of how the guarantee is enforced, how it is
tested, and what the app deliberately cannot do.

## Optional WebMCP access

WebMCP is off until the user enables it in Projects. It lets a connected agent read
and edit the open project and request local exports. Bitbounce adds no remote
request and keeps its CSP, but tool results cross into the agent's context. Its
provider may process those results remotely. The site's CSP does not govern the
agent's network use. The app-origin guarantees below do not promise that an
enabled external agent keeps data on-device. See [WebMCP recovery and limits](webmcp.md).

## The guarantee

After the page's own module/asset loads, Bitbounce makes **zero** network
requests of any kind:

- No `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `navigator.sendBeacon` calls — to any origin, _including same-origin_.
- No CDN assets, no remote fonts, no analytics, no error reporting, no
  update pings, no "phone home on boot".
- The only sanctioned data egress is the user's **explicit file exports**
  (EXPORT WAV, EXPORT MIDI, SAVE FILE, and the HU-2 quarantine RECOVER
  download) — each is a `URL.createObjectURL` blob fed to a programmatic
  `<a download>` click. A blob download is a local write to the user's disk,
  never a network operation.

All persistence lives in IndexedDB (`src/persist/`); all audio synthesis
lives in the same-origin AudioWorklet module. There is no backend and there
will never be one in v0/v1.

## How the CSP enforces it

`index.html` ships a strict Content-Security-Policy meta — the strongest
privacy statement a page can make:

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data:; font-src 'self' data:; connect-src 'self';
worker-src 'self'; media-src 'self'; object-src 'none'; frame-src 'none';
base-uri 'none'; form-action 'none'
```

- **`connect-src 'self'`** is the core (refined from v0's `'none'` by PS-2,
  2026-09-03, for the RES-10 sample content): it makes _any_
  fetch/XHR/WebSocket/EventSource/beacon to any origin OTHER THAN THIS ONE
  unloadable. The single sanctioned same-origin use is lazily fetching the
  build-bundled CC0 sample one-shots (`/assets/*.ogg` emitted by our own
  Vite build — see docs/dev/content.md and PROVENANCE.md); the loader
  (`src/assets/content/loader.ts`) refuses off-origin URLs in code as well,
  because CSP cannot path-scope `'self'`. Third-party remains impossible —
  no host, scheme, or wildcard is granted, and the unit guard
  (tests/csp.test.ts) fails if one ever appears. Even a future bug or a
  compromised dependency could not open an external channel; the browser
  itself refuses.
- Every other directive is pinned to `'self'` (+ `data:` for Vite-inlined
  images/fonts, which are embedded bytes and fetch nothing).
- **`worker-src 'self'` is deliberately minimal.** The audio worklet module
  resolves to a plain same-origin asset URL in the built app
  (`src/audio/voiceEngine.ts`: `new URL("./worklets/voiceEngine.js",
import.meta.url)` → `/assets/voiceEngine-*.js`), so no `blob:` grant is
  needed. Do not add `blob:` here without re-justifying it.
- `base-uri`/`form-action` `none` close the classic injection escape hatches
  (a smuggled `<base>` or form submit cannot exfiltrate anything).

**Dev-mode exception (recorded choice):** `vite dev` cannot live under this
policy — HMR injects inline `<style>` tags and opens a `ws://` connection.
The `cspDevStrip` plugin in `vite.config.ts` removes the meta **only when
serving** (`apply: "serve"`). `vite build` output always carries the full
policy; the served artifact users receive is never relaxed.

## How the tests guard it

| Guard                | File                                           | What it proves                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy guard         | `tests/csp.test.ts` (unit)                     | `index.html` carries the exact canonical policy from `tests/csp-policy.ts` (single source of truth, no drift, no duplicate softer meta); also checks `dist/index.html` when present.                                                                                                                                             |
| Zero-network journey | `tests/browser/zero-network.test.ts` (browser) | Runs the **real built bundle** (served same-origin via the browser project's `publicDir: "dist"`) in an iframe written with the exact CSP meta. Before any app code runs it installs recording shims for fetch/XHR/WebSocket/EventSource/sendBeacon, a `securitypolicyviolation` listener, and a `URL.createObjectURL` recorder. |

The journey drives a full user session — boot → play 2 bars (playhead
movement asserted) → edit 24 cells → open FX strip, add a device, bypass it →
EXPORT WAV (real offline render) → EXPORT MIDI → SAVE FILE → wait for the
IndexedDB autosave flush — and then asserts:

1. **Zero** fetch/XHR/WebSocket/EventSource/beacon calls, period.
2. **Zero** CSP violations (an _attempted_ forbidden load is as damning as a
   completed one — the violation event fires either way).
3. Every `performance.getEntriesByType("resource")` entry is same-origin
   (module, CSS, self-hosted fonts, worklet, on-demand export chunks).
4. Exactly the expected blob downloads happened (the explicit exports) —
   evidence the app still _works_ under the policy rather than silently
   failing.

The iframe approach exists because the dev pipeline strips the CSP meta (see
above), and because the shims must be installed before the app module
executes — only possible on a window the test creates itself.

## Dependency audit (CA-1 evidence, 2026-09-02)

- `npm audit`: **0 vulnerabilities** (production + dev, npm 10 lockfile v3).
  Nothing to fix, so no semver-major behavior changes were risked.
- Telemetry scan of the full dependency tree (206 installed packages):
  no `telemetry`/`analytics`/`sentry`/`segment`/`posthog`/`amplitude`/
  `mixpanel`/`datadog`/… packages. The only hit is `@opentelemetry/api`
  listed as an **unmet optional** peer of vitest — it is _not installed_
  (`node_modules/@opentelemetry` does not exist) and vitest's tracing hooks
  never activate without it.
- Source scan: no hardcoded `http(s)://` URLs and no network API usage
  anywhere in `src/` (the only `fetch`/XHR/WS in the repo are the test
  shims' own definitions).

## What Bitbounce cannot do — by design

- It cannot send your project, audio, or editing behavior anywhere. There is
  no endpoint, and the CSP forbids creating one.
- It cannot load remote code, fonts, or images — a compromised CDN has
  nothing to poison because nothing is fetched from one.
- It cannot auto-update or "check for news" — no update pings exist.
- It cannot collect crash reports or usage analytics — none are wired, and
  `connect-src 'self'` would block any that appeared (same-origin-only
  fetches are exclusively the bundled sample assets, loader-enforced).
- It has no accounts, no cloud sync, and no server-side anything. Your data
  is IndexedDB in your browser profile plus the files you export yourself.

If a future feature needs network (e.g. remote sample packs in v1+), that
feature must return to the town hall first: the CSP changes only with an
explicit, recorded privacy decision — never silently. The PS-2 refinement
('none' → 'self', same-origin bundled content only) is that recorded
decision; see PROVENANCE.md for every byte it permits.
