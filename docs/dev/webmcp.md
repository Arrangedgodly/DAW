# WebMCP in Bitbounce

Bitbounce exposes tools for a connected browser agent to control the open musical
project. The browser or an extension supplies the agent. Bitbounce includes no
language model, API key, remote MCP server or chat service.

## Automatic access and recovery

Tools register automatically when the browser exposes `document.modelContext` or
legacy `navigator.modelContext`. Detection starts after project loading and checks
once a second for late extension injection. API availability is the connection
signal; it does not prove an agent is actively using the page. No Projects toggle
or destination buttons are needed. Projects still autosave normally.

Before editing, the agent asks in conversation whether the user wants to edit the
current project or start a new one. It then calls `bitbounce_confirm_edit_target`
with `destination: "current"` or `"new"`, `userConfirmed: true`, and the latest
project revision. The agent is responsible for truthfully recording the user's
answer. The app validates the arguments and blocks mutations, playback changes,
and exports until confirmation, but cannot verify the conversation itself.

For an ambiguous later request, `bitbounce_request_edit_target` pauses editing and
cancels pending edits/downloads while the agent asks again. Inspection remains
available. Read `editTarget` from `get_project` to check status.

The new-project action saves current work before switching to a separate empty
project. Storage failure leaves the original project open and edits paused.
Project switches and recovery invalidate confirmation and old callbacks. Tools
reconnect automatically, requiring a fresh destination confirmation. Always read
`get_project` again after confirmation to obtain the selected project's revision.

Each musical edit tool call creates one validated undo step, including a full
arrangement rewrite. Use normal Undo for individual edits. Before the first agent
change, Bitbounce keeps an in-memory project checkpoint. **Restore before agent**
appears in Projects and on musical-edit notifications. It pauses agent edits, stops
playback, restores that checkpoint and restores the captured master volume, loop
mode and selected view. It also removes manual edits made after that checkpoint.
The project restore itself is undoable.

The checkpoint lasts for this page session. It does not
survive reload or switching projects. Downloads cannot be undone by project Undo.

## Tools

| Tool                            | Capability                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `bitbounce_get_project`         | Summary, revision, active lanes, pattern IDs and arrangement                     |
| `bitbounce_list_sounds`         | Built-in drum kits and pitched preset IDs and names                              |
| `bitbounce_edit_project`        | Up to 64 focused musical operations committed as one validated Undo step         |
| `bitbounce_preview_project`     | Read-only, revision-bound comparison of an edited document or operation batch    |
| `bitbounce_apply_preview`       | Apply the exact checked draft identified by a preview ID                         |
| `bitbounce_analyze_audio`       | Local sample-peak, active RMS, crest, low-mid energy and arrangement overlap     |
| `bitbounce_propose_mix`         | Read-only measured mix proposal with reasons and a separately applicable preview |
| `bitbounce_get_pattern`         | Notes or drum rows and valid pitch degrees                                       |
| `bitbounce_set_tempo`           | Set BPM without moving notes                                                     |
| `bitbounce_set_lane`            | Sound, volume, mute and solo in one edit                                         |
| `bitbounce_set_pattern`         | Replace pitched notes or selected drum rows                                      |
| `bitbounce_get_document`        | Complete project, scale modes, effect defaults and controls                      |
| `bitbounce_validate_document`   | Read-only preflight with field paths, repair hints and current revision          |
| `bitbounce_apply_document`      | Complete musical project update in one undo step                                 |
| `bitbounce_get_session`         | Playback, loop, master gain and selected view                                    |
| `bitbounce_control_session`     | Play/stop, loop, master gain, lane/page and visualizer visibility                |
| `bitbounce_history`             | Undo or redo the most recent project edit                                        |
| `bitbounce_export`              | Dispatch a local WAV, MIDI or project-file download                              |
| `bitbounce_request_edit_target` | Pause edits while the agent asks for a destination in conversation               |
| `bitbounce_confirm_edit_target` | Record the confirmed choice and prepare the current or a new project             |

`apply_document` covers adding/removing optional instruments, creating/duplicating/
deleting/resizing patterns, chain ordering, repetitions, slot follow modes and cue
labels, all effect types and their order/parameters/bypass, scales and overrides,
octave, gate length, swing, metronome, mix and project naming. Read `get_document`,
edit its `doc`, then send the edited value as `document` with its `revision`.
Preserve unrelated fields. The smaller tools are more economical for small edits.

Before applying a complete composition, call `validate_document` with
`{ document: editedDoc }`. It returns `{ valid, revision, issueCount, issues,
truncated }` without modifying the project, undo history, checkpoint or edit
permission. It uses the same schema, musical, sound-ID, pitch and drum-length
checks as `apply_document`. Fix the reported paths and validate again. Validation
does not reserve a revision or approve the destination; reread and reconcile
concurrent edits before applying with the latest revision.

Two document-format details differ from the project summary:

- `chainCues` labels are at most 12 characters after trimming, or `null`.
  Use short labels such as `VERSE 1` and keep longer titles in `pattern.name`.
- Document lanes store `volume`, `mute` and `solo` directly on the lane. The
  nested `mix` object belongs to `get_project` summaries and `set_lane` arguments.
  Always begin a bulk edit from `get_document.doc`, not a project summary.

`get_document` includes these constraints in `documentRules` and its editing
instructions. Preflight reports up to 50 issues with the full issue count and an
explicit truncation flag. Rejected apply calls include up to 12 field-specific
issues in the error message itself, since browser bridges can discard custom
Error properties. Invalid drafts remain invalid; labels and mix fields are not
silently truncated, relocated or ignored.

The tools operate on the open project. They do not manage other saved projects,
change visualizer effect compositions or appearance preferences, or expose arbitrary
code, filesystem, browser storage or network access.

Inputs use zero-based sixteenth-note steps, 16 steps per bar, scale-relative degrees
and quarter-step note lengths. Runtime validation is independent of browser JSON
Schema checks. Invalid writes leave the document and history unchanged. Drum rows
must have the exact pattern length; import-time length repair is refused.

All document edits require the current revision. Human/agent edits, undo/redo and
derived document writes invalidate older revisions. Read again after a rejection.
History refers to the most recent project edit, which may have been made by a human.

Playback uses the existing session. If browser audio is locked, the tool asks the
user to press Play once. Exports use existing rendering and download functions.
Access and document identity are rechecked before dispatch. Revocation during WAV
rendering prevents download, though rendering may still finish. A download result
does not prove the browser saved the file.

## Sound discovery, focused edits and previews

There are 20 registered tools. `list_sounds` accepts optional `query`, `type`
(`drums` or `pitched`), `category`, `characters`, `offset` and `limit`. Character
tags match the human sound browser: Bright/Dark, Soft/Punchy, Clean/Gritty,
Short/Sustained. Results include descriptions, recording source and pitched ranges.
`kits` and `presets` retain their existing keys. Pagination applies independently
to both lists, defaults to 50 items per list, and allows at most 100 per list.
Repeat the same filters with `nextOffset` until it is `null`. Read `total` for each
list's full match count. Categories and characters are also listed in the result.

`edit_project` requires `revision` and 1–64 `operations`, executed in order against
an isolated draft. The entire draft validates before the single commit. A rejected
batch changes no document, revision or history. Supported actions:

- `create_pattern`: lane, patternId, name, bars. Creates an empty pattern.
- `duplicate_pattern`: lane, patternId, newPatternId, name. Copies the source.
- `rename_pattern`: lane, patternId, name.
- `resize_pattern`: lane, patternId, bars. Stashes events past the new end in
  overflow, then restores them when the pattern grows. Straddling notes remain.
- `delete_pattern`: lane, patternId. Refuses the last pattern or a chained pattern.
- `set_notes`: lane, patternId, notes. Replaces all active notes; overflow remains.
- `set_drum_rows`: lane, patternId, drumRows. Replaces supplied exact-length rows.
- `set_chain`: lane, slots. Each slot has patternId and optional cue/mode, defaulting
  to null/next. This explicitly replaces all slots and their cue/mode metadata.
  Chains with active playback rules require `apply_document` to reconcile rules.
- `set_fx_chain`: lane, devices. Replaces the lane's full validated chain, up to
  three devices. Device types, defaults and controls come from `get_document`.

Example of one atomic composition edit:

```json
{
  "revision": 4,
  "operations": [
    {
      "action": "duplicate_pattern",
      "lane": "bass",
      "patternId": "bass-1",
      "newPatternId": "bass-outro",
      "name": "Outro"
    },
    {
      "action": "set_notes",
      "lane": "bass",
      "patternId": "bass-outro",
      "notes": [{ "degree": 0, "start": 0, "length": 4 }]
    },
    {
      "action": "set_chain",
      "lane": "bass",
      "slots": [
        { "patternId": "bass-1" },
        { "patternId": "bass-outro", "cue": "OUTRO" }
      ]
    }
  ]
}
```

For a reviewable draft, send the same `revision` and `operations` to
`preview_project`. Alternatively provide `document` instead of `operations`.
Exactly one is required. It returns up to 100 changed paths with bounded before/after
data, affected lanes, removed patterns, truncation flags, `previewId`, and
`expiresAt`. No edit destination or revision is reserved. Inspect full content with
`get_pattern`/`get_document` if a summary is truncated.

`apply_preview` takes `revision` and `previewId` and applies that exact validated
draft as one Undo step. It requires normal destination confirmation. Previews are
single-use, expire after five minutes, and are invalid after any document edit,
Undo/Redo, project switch or access revocation. At most eight are held in memory;
older previews are evicted. They do not survive reload.

## Audio analysis and mix proposals

`analyze_audio` and `propose_mix` require the latest `revision`. Both render the
finite linear arrangement locally with stereo lane stems, leaving playback and the
project untouched. `maxDurationSeconds` defaults to 60 and is bounded to 1–180.
Musical duration and total output including release/FX tails are checked before
allocating the offline context. Overlong arrangements are rejected, never silently
truncated. Turn off Solo before full-mix analysis. Muted lanes retain normal render
semantics.

Results identify the revision, sample rate and measured duration. They expose
linear sample peak, active RMS in dBFS, crest, approximate low-mid energy ratio,
and arrangement overlap. These are **not LUFS or true-peak measurements**.
They contain summaries, not audio buffers or remote audio requests.

`propose_mix` accepts optional `options` with `amount` in 0–1 (default 0.5),
`balance`, `eq`, and `dynamics` (default true). It uses the existing Auto Mix logic,
returns proposed changes and reasons, and provides a `proposal.previewId` for
separate `apply_preview`. Measurement alone does not prove musical improvement;
the result marks `listeningRequired: true`.

One audio analysis may run at a time. Cancellation, revocation or concurrent edits
discard its result and prevent a proposal. An already-started native offline render
may still finish internally. Session inspection and playback stop remain available
during rendering/export. A newer stop also cancels a pending playback start.

## Recoverable failures

Registered browser tools return failures as ordinary JSON values:

```json
{
  "isError": true,
  "error": {
    "code": "STALE_REVISION",
    "message": "[STALE_REVISION] Project changed. Read the project again.\nRecovery: Read get_project and reconcile current work.",
    "recovery": "Read get_project and reconcile current work.",
    "retryable": true
  }
}
```

Always check `isError` before interpreting a result as success. Successful result
shapes stay unchanged. Codes include INVALID_INPUT, INVALID_DOCUMENT,
STALE_REVISION, ACCESS_REVOKED, DESTINATION_REQUIRED, AUDIO_LOCKED, BUSY,
PREVIEW_EXPIRED, ANALYSIS_LIMIT, SOLO_ACTIVE, STORAGE_UNAVAILABLE, CANCELLED,
EXPORT_FAILED and TOOL_FAILED. Recovery instructions are also in the message.
`retryable` means retry after following those instructions, not an automatic retry
of a mutating operation.

This value-based failure contract is necessary because the tested native Chromium
151 consumer replaces thrown errors with a generic invocation error and reports
them as unhandled page errors. Internal tools still reject with typed errors; the
registered browser boundary serializes them. Browser input-schema failures that
occur before the callback may still reject through the native API itself.

## Support and privacy

The adapter uses `document.modelContext`, with a legacy `navigator.modelContext`
fallback. Registration uses an AbortSignal; legacy implementations can also
unregister by name. Already-discovered callbacks reject after access is revoked.
Partial registration failure removes only tools registered by this attempt.
Unsupported browsers retain the normal DAW without agent controls.

WebMCP is experimental. Chrome documents the local testing flag
`chrome://flags/#enable-webmcp-testing` and public origin trial support.
This change does not enroll or deploy an origin trial token. Sources checked on
2026-09-12: [Chrome setup](https://developer.chrome.com/docs/ai/webmcp),
[imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api),
[community draft](https://webmachinelearning.github.io/webmcp/).

Bitbounce adds no external request and retains its CSP. Enabling access exposes
project content to the connected agent. Its provider may process that data remotely;
the site's CSP does not constrain the browser agent's network use. Local app
processing is not a guarantee that an external agent keeps its inputs local.

## Implementation and verification

The provider loads when WebMCP is detected. `src/webmcp/tools.ts` defines musical tools,
`sessionTools.ts` connects transport/view/exports, and `access.ts` owns registration,
revocation and recovery. Musical edits use the store's `commitDocumentEdit`, with
validation, an expected-document identity guard and no drag coalescing. Registration
lives for the page session, independent of the Projects popover lifetime.

`tests/webmcp.test.ts` tests musical editing. `tests/browser/webmcp.test.tsx` uses a
controlled API double in real Chromium to test recovery, revocation, project
switches, registration failures/races, and supported/unsupported UI. Those tests
alone do not prove native browser-agent integration.

Run `npm run test:webmcp-native` for strict native browser acceptance. Its separate
configuration enables experimental WebMCP only for that run; unavailable native
support is a failure, not a skip. A dedicated CI job runs the same gate and uploads
its results. Native tests cover discovery, filtered sounds, real audio analysis and
mix proposals, destination guards, validation, batch previews, stale revisions,
cancellation, revocation, project switching and restoration.

`docs/dev/webmcp-smoke.mjs` runs against a production preview on port 4175, or
`BITBOUNCE_URL`. It checks the built app's native registration/discovery/execution,
filters, guards, validation, previews, apply and UI restoration at desktop and phone
sizes. It saves screenshots and `results.json` under `webmcp-review` and exits
nonzero on failures or unavailable support. Both native runners accept optional
`BITBOUNCE_BROWSER_CHANNEL=chrome` or `chrome-beta` for installed-channel checks.
Object inputs are attempted first; only older native pre-execution argument parse
rejections trigger the legacy JSON-string input fallback.

Local acceptance on 2026-10-03 used Chromium 151.0.7922.34 with WebMCP testing flags.
That build requires the legacy JSON-string consumer input. This establishes one
native version, not an installed-browser matrix, live-origin acceptance or physical
phone testing. The phone smoke uses a 390?844 viewport. See
[the improvement checklist](webmcp-improvements.md) for current evidence.
