# WebMCP in Bitbounce

Bitbounce exposes tools for a connected browser agent to control the open musical
project. The browser or an extension supplies the agent. Bitbounce includes no
language model, API key, remote MCP server or chat service.

## Enable access and recover

Open **Projects → Allow agent access**. Access starts off. Reloading or switching
projects turns it off. Projects still autosave normally.

Before the first edit, the user must choose **Edit this project** or **Save and
start a new project** in Projects. Inspection works while the choice is pending;
mutations, playback changes and exports are blocked. The agent cannot set its own
destination through a tool argument.

Every tool's guidance tells the agent to verify the destination when a new request
is ambiguous. `bitbounce_request_edit_target` presents that request to the user and
revokes edit permission until a human chooses again. Pending asynchronous edits or
downloads receive cancellation. Read `editTarget` from get_project to check status.
Recognizing ambiguity is the agent's responsibility; the app enforces the choice
once requested and always requires the initial choice.

The new-project action flushes current work, creates a separate empty project, and
requires the final autosave flush to succeed before switching. A storage failure
keeps the original project open and agent edits paused. The new project receives
its own checkpoint on the agent's first change. This path explicitly re-enables
agent tools in the selected new project; ordinary project switches revoke access.

Each musical edit tool call creates one validated undo step, including a full
arrangement rewrite. Use normal Undo for individual edits. Before the first agent
change, Bitbounce keeps an in-memory project checkpoint. **Restore before agent**
appears in Projects and on musical-edit notifications. It turns access off, stops
playback, restores that checkpoint and restores the captured master volume, loop
mode and selected view. It also removes manual edits made after that checkpoint.
The project restore itself is undoable.

The checkpoint survives turning access off and on in this page. It does not
survive reload or switching projects. Downloads cannot be undone by project Undo.

## Tools

| Tool                            | Capability                                                               |
| ------------------------------- | ------------------------------------------------------------------------ |
| `bitbounce_get_project`         | Summary, revision, active lanes, pattern IDs and arrangement             |
| `bitbounce_list_sounds`         | Built-in drum kits and pitched preset IDs and names                      |
| `bitbounce_get_pattern`         | Notes or drum rows and valid pitch degrees                               |
| `bitbounce_set_tempo`           | Set BPM without moving notes                                             |
| `bitbounce_set_lane`            | Sound, volume, mute and solo in one edit                                 |
| `bitbounce_set_pattern`         | Replace pitched notes or selected drum rows                              |
| `bitbounce_get_document`        | Complete project, scale modes, effect defaults and controls              |
| `bitbounce_apply_document`      | Complete musical project update in one undo step                         |
| `bitbounce_get_session`         | Playback, loop, master gain and selected view                            |
| `bitbounce_control_session`     | Play/stop, loop, master gain, lane/page and visualizer visibility        |
| `bitbounce_history`             | Undo or redo the most recent project edit                                |
| `bitbounce_export`              | Dispatch a local WAV, MIDI or project-file download                      |
| `bitbounce_request_edit_target` | Pause edits and ask the human to choose the current project or a new one |

`apply_document` covers adding/removing optional instruments, creating/duplicating/
deleting/resizing patterns, chain ordering, repetitions, slot follow modes and cue
labels, all effect types and their order/parameters/bypass, scales and overrides,
octave, gate length, swing, metronome, mix and project naming. Read `get_document`,
edit its `doc`, then send the edited value as `document` with its `revision`.
Preserve unrelated fields. The smaller tools are more economical for small edits.

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

## Support and privacy

The adapter uses `document.modelContext`, with a legacy `navigator.modelContext`
fallback. Registration uses an AbortSignal; legacy implementations can also
unregister by name. Already-discovered callbacks reject after access is revoked.
Partial registration failure removes only tools registered by this attempt.
Unsupported browsers retain the normal DAW and show an unavailable explanation.

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

The provider loads on opt-in. `src/webmcp/tools.ts` defines musical tools,
`sessionTools.ts` connects transport/view/exports, and `access.ts` owns registration,
revocation and recovery. Musical edits use the store's `commitDocumentEdit`, with
validation, an expected-document identity guard and no drag coalescing. Registration
lives for the page session, independent of the Projects popover lifetime.

`tests/webmcp.test.ts` tests musical editing. `tests/browser/webmcp.test.tsx` uses a
controlled API double in real Chromium to test recovery, revocation, project
switches, registration failures/races, and supported/unsupported UI. Those tests
alone do not prove native browser-agent integration.

`docs/dev/webmcp-smoke.mjs` runs against a production preview on port 4175. It probes
native API support, exercises registration/discovery/execution when available and
saves desktop/phone screenshots and results under `webmcp-review`.
