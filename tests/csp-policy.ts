/**
 * CA-1 canonical Content-Security-Policy string.
 *
 * Single source of truth shared by the unit guard (tests/csp.test.ts, which
 * asserts index.html carries this exact policy verbatim) and the browser
 * zero-network journey (tests/browser/zero-network.test.ts, which runs the
 * built app under this exact policy). If you edit the meta in index.html,
 * edit this string to match — the unit test fails loudly on drift.
 *
 * Why each directive:
 * - default-src 'self'      — anything unlisted falls back to same-origin only
 * - script-src 'self'       — no inline, no eval, no CDN scripts; the app is a
 *                             plain same-origin ES module
 * - style-src 'self'        — no inline styles; one built stylesheet
 * - img-src 'self' data:    — raster assets ship in the bundle; small SVGs are
 *                             data-URL inlined by Vite
 * - font-src 'self' data:   — all faces are self-hosted woff2 files; the two
 *                             smallest are data-URL-inlined by Vite (data:
 *                             embeds fetch nothing — no network surface)
 * - connect-src 'none'      — THE privacy statement: no fetch, XHR, WebSocket,
 *                             EventSource, or sendBeacon may reach ANY origin,
 *                             same-origin included. Nothing can phone home.
 * - worker-src 'self'       — the audio worklet module is a plain same-origin
 *                             /assets/voiceEngine-*.js URL in the built app
 *                             (src/audio/voiceEngine.ts: new URL("./worklets/
 *                             voiceEngine.js", import.meta.url)); no blob: is
 *                             needed or granted
 * - media-src 'self'        — defensive; the app uses no <audio>/<video>
 * - object-src 'none'       — no plugins ever
 * - frame-src 'none'        — the app frames nothing and is not framed here
 * - base-uri 'none'         — <base> injection cannot rewrite asset URLs
 * - form-action 'none'      — no form submission can exfiltrate anything
 */
export const CSP_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'none'; " +
  "worker-src 'self'; media-src 'self'; object-src 'none'; " +
  "frame-src 'none'; base-uri 'none'; form-action 'none'";
