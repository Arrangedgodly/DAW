# WebMCP document validation investigation

Investigated on 2026-09-22 using the two referenced composition tasks and their
recorded WebMCP calls. The failing operation in both was
`bitbounce_apply_document`.

## What failed

| Task                         | Original error                        | Invalid fields                                                                      |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| Build an epic cinematic beat | Invalid project document (48 issues)  | Six cue labels longer than 12 characters, repeated across eight lanes               |
| Build a complex trap beat    | Invalid project document (104 issues) | Twelve overlong cue labels across eight lanes, plus eight nested lane `mix` objects |

The compositions used descriptive section names such as `Distant thunder` and
`01 INTRO · ice` as arrangement cues. The document schema limits cue labels to
12 characters after trimming. The tool's original instructions said only that
`chainCues` contained per-slot labels.

The trap composition also copied the nested mix shape used by `get_project` and
`set_lane`. Full documents require `volume`, `mute` and `solo` directly on each
lane. The strict validator correctly rejected the nested `mix` fields.

The initial bulk-edit choice is understandable: the small pattern tool replaces
notes in existing patterns but cannot create the entire multi-pattern arrangement.
`apply_document` is the existing structural-edit operation. Its validation failure
was caused by the submitted shape, not an unavailable tool or a failed file import.

## Why recovery was difficult

There were two separate losses of diagnostic information:

1. `validateProject` passed the array from Valibot's `safeParse` result into a
   formatter that expected a thrown Valibot error. It fell back to stringifying
   the array, producing `[object Object]` instead of individual paths and reasons.
2. The browser-agent bridge exposed the thrown error's message, which contained
   only the issue count. The cinematic task's attempt to inspect all properties
   on the caught error still received no field diagnostics.

Both agents consequently read local repository code to discover the rules. A
remote user should be able to recover using the registered tools alone.

## Changes

- Correct the shared schema issue formatter to retain every path and message.
- Include bounded field diagnostics and repair guidance in WebMCP error messages.
- Add read-only `bitbounce_validate_document`, returning `valid`, `revision`,
  `issueCount`, `issues` and `truncated`.
- Share full-document validation between preflight and apply, including the
  existing size, sound, pitch and exact drum-row requirements.
- Publish cue limits, canonical lane mix examples and the preflight workflow in
  tool descriptions and `get_document.documentRules`.

Preflight does not reserve a revision, confirm an edit destination, create an undo
entry or capture a recovery checkpoint. Invalid input remains rejected; the tools
do not silently shorten labels or move unknown fields.

## Verification

- First reproduced the missing diagnostic messages in three failing unit cases.
- Replayed both complete composition generators from the recorded calls against
  a fresh project. They produced exactly 48 and 104 issues. Correcting the labels
  and flattening the trap lane mixes made both compositions validate and apply
  in one undo step. Undo restored the original document. The temporary replay
  harness was removed; focused regression tests remain.
- `node node_modules/vitest/vitest.mjs run --project unit tests/webmcp.test.ts tests/document-schema.test.ts --reporter=default`
  passed 93 tests.
- `node node_modules/vitest/vitest.mjs run --project browser tests/browser/webmcp.test.tsx --reporter=default`
  passed 14 tests in Chromium. The initial sandboxed attempt could not launch
  Chromium; the permitted run outside the sandbox passed. Browser global setup
  built the production bundle.
- TypeScript no-emit checking and ESLint for changed TypeScript files passed.
- The built bundle passed the size gate: 124.24 KB gzip initial JavaScript,
  below the 300 KB budget.
- Through Codex's actual in-app browser WebMCP connection to the local production
  preview, a draft with both original mistake types returned two actionable
  diagnostic strings. A corrected draft returned `valid: true`. A subsequent
  document read confirmed identical content and revision, with edit permission
  still awaiting user choice.

The real browser-agent check exercised discovery, document reading and preflight.
Apply error messages, apply/undo, permission guards and recovery were exercised by
the unit and Chromium suites. This work has not been deployed to bitbounce.app.
