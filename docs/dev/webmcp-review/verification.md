# WebMCP verification, 2026-09-12

Implemented 13 browser tools for musical project editing, transport/view control,
history and exports, plus the destination-choice request. Access starts off;
mutations additionally require a human choice of current project or saved-current
plus new empty project. Ambiguous follow-up requests can revoke that permission
and cancel pending work. An in-memory checkpoint supports whole-session recovery.

## Passing checks

- ESLint over the checkout.
- TypeScript with no emit.
- Full unit suite: 93 files, 1,794 tests, including 10 musical WebMCP tests.
- Targeted browser suite: 3 files, 13 tests. Eleven WebMCP tests cover destination
  gating, reopening the choice, save-before-new behavior, save failure, cancellation
  before download, checkpoint recovery, project-switch revocation, session recovery,
  partial registration failure, late registration and UI. The existing keyboard
  and zero-network journeys also pass.
- Production build.
- Bundle gate on the completed build: 97.36 KB initial JavaScript gzip against
  the 300 KB limit. Provider modules load on opt-in. The gate's existing SKIP_BUILD
  option was used because its npm subprocess launcher is not Windows-compatible.
- Native Chromium 151.0.7922.34 with experimental WebMCP enabled: all 13 tools
  registered and were discovered through the browser API; project read and tempo
  edit executed natively. The UI restoration action was exercised afterward.
- Production preview at 1440x900 and 390x844: no page errors or horizontal
  overflow. Screenshots show the destination choice and recovery controls.
- Impeccable's mechanical detector reported no findings for the added control and
  its containing component/styles at the initial scan.

Native evidence is in `results.json` and the adjacent PNG files. Browser tests use
a controlled ModelContext double; the separate native smoke uses Chromium's real
implementation. The smoke accommodates Chromium 151's JSON-string executeTool
arguments as well as the newer object form.

## Supporting corrections and limits

The existing lint command scanned nested `.claude` worktrees, making TypeScript
root discovery ambiguous. ESLint now ignores those copies and pins this config's
root. Existing browser globals in verify-song-layout.mjs are declared for lint.

The older keyboard journey assumed a saved pattern row list determined the visible
pitch row. Its assertion now uses the full pitch domain, matching the current
grid. The keyboard sequence and behavior are unchanged; the regression passes.

One intermediate browser run overlapped a rebuild and requested a stale hashed
asset. It was stopped and rerun against the finished build; all 13 checks passed.
The production builder notes that boot/newProject dynamic imports also occur
statically elsewhere. These imports defer module access, not separate those two
modules into additional chunks.

No hosted deployment or origin-trial enrollment was performed. Native tests do not
prove integration with a specific commercial assistant. Destination ambiguity is
recognized by the agent using tool guidance; the app enforces the initial choice
and any subsequent requested choice. Checkpoints last only for the current page
and project, restore intervening human edits too, and cannot undo file downloads.
