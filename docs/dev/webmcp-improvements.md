# WebMCP improvement checklist

Work is performed in the existing checkout, preserving unrelated sound-library,
audio-engine, UI and deployment changes. Completion refers to local implementation
and verified behavior; deployment and musical listening acceptance are separate.

- [x] Filtered, paginated sound discovery and metadata. Unit tests and typecheck pass.
- [x] Atomic focused musical edit batches.
- [x] Revision-bound previews of document and batch changes.
- [x] Bounded audio analysis and read-only mix proposals with separate apply.
- [x] Consistent recoverable errors and responsive session commands during rendering.
- [x] Native WebMCP compatibility checks, browser acceptance, and documentation.

Verification targets are the agent tool interface, document/history atomicity,
registered access/revocation behavior, actual offline audio rendering, and native
browser discovery/execution. API-double results are reported separately from native
results. Unsupported native environments are reported explicitly, never as passes.

## Completed local verification, 2026-10-03

- Full unit suite: 108 files, 1,929 tests passed. The WebMCP unit file contains 29
  tests, including atomic batches, sound search, preview expiry/eviction and errors.
- Focused Chromium browser suite: seven files, 43 tests passed. This includes 18
  WebMCP API-double tests plus real audio rendering, mixer/export failure and
  production CSP checks.
- Native WebMCP acceptance: four tests passed through Chromium 151.0.7922.34,
  including real audio analysis and separately applicable mix proposals.
- Production native smoke: 1440?900 and 390?844 passed, 20 tools each, no page
  errors or horizontal overflow. Before/after restoration document SHA-256 hashes
  match. Both native runners used Chromium's older JSON-string input contract.
- Repository ESLint, TypeScript, production build and git diff whitespace checks
  passed. Bundle gate: 128.25 KB initial JavaScript gzip against 300 KB;
  WOFF2 fonts 37.02 KB against 50 KB.
- A dedicated native WebMCP CI job and npm script are added. Remote CI has not run
  for these uncommitted changes.

Evidence: [production smoke](webmcp-review/results.json),
[native acceptance](webmcp-review/native-acceptance.json),
[desktop screenshot](webmcp-review/edited-1440.png),
[phone screenshot](webmcp-review/edited-390.png), and
[the current tool contract](webmcp.md).

The existing sound-library/UI/audio/deployment edits remain in the checkout. The
WebMCP sound search reuses that local sound catalog. This work is not committed,
pushed or deployed. Native acceptance covers one experimental Chromium version;
it does not establish a browser-version matrix, external assistant integration,
live-origin acceptance, physical-phone acceptance or musical listening approval.
Cancellation discards analysis results; an already-started native offline render
may finish internally. The temporary fixture preview is closed after verification.

## Release preparation

The production release is prepared from an isolated checkout with a clean install.
It includes the WebMCP work and the already-live sound-library, sound-browser and
playback-fix changes so production behavior is retained. Benchmark dependencies,
performance research and task notes remain outside this release. The production
Worker is `daw`; the separate Pages site is not the production custom domain.
