# Projects surface — iteration-6 audit + law (S-1)

HEAD when audited: `7fe2a4c0e5859914f50a195cebb154647e91a8f6` (docs-only on top
of the i5 close-out battery commit `42e9524`). Every file:line below was
RE-MEASURED at this HEAD by the S-1 worker — the plan's recorded anchors were
checked one by one, not copied. Two plan PATH errors and four off-by-a-few
ranges were found and corrected (§6); all other anchors verify exactly.

The doc is THE LAW for S-2 (model/persistence), S-3 (desktop UI), S-4 (phone
fit) and S-5 (gates). Where a law names a line, that line is verified above.

---

## 1. Verified anchor map (all measured at 7fe2a4c)

### 1.1 Schema — the name field already exists end-to-end

| Anchor | Fact |
|---|---|
| `src/document/schema.ts:865-866` | `interface ProjectDocument` with `readonly name: string` |
| `src/document/schema.ts:887-889` | `ProjectDocumentSchema = v.pipe(...)` with `name: v.string()` — a PLAIN string: NO trim, NO maxLength, NO uniqueness. Any string (emoji, whitespace, 10k chars) is schema-valid |
| `src/document/schema.ts:939-941` | `createDefaultProject()` → `name: "Untitled"` |
| `src/document/schema.ts:727,732` | the clamp precedent: `CUE_MAX_CHARS = 12` + `CueLabel = v.pipe(v.string(), v.trim(), v.maxLength(CUE_MAX_CHARS))` |
| `src/state/patternRail.ts:252-255` | `clampCue(text, maxChars)` = `text.replace(/\s+/g, " ").trim().slice(0, maxChars)` — trim + whitespace-collapse + UTF-16 slice |
| `src/state/store.ts:115-117` | `createFreshProjectDocument()` → `initialDoc()` (the NEW flow's "Untitled") |
| `src/document/demoSong.ts:333` | demo doc `name: "WELCOME SONG"` (`createDemoProject` at :331) |

**Consequence:** NO schema change, NO codec change, NO migration. Every saved
"Untitled" row is already renamable; the gap is purely two actions + UI.

### 1.2 Persist — envelope, projectStore, autosave (the race machinery)

| Anchor | Fact |
|---|---|
| `src/persist/db.ts:24-32` | `ProjectRecord` envelope: `{id, name, schemaVersion, updatedAt, dirty, json}` — `name` is BOTH an envelope field and embedded in the canonical `json` |
| `src/persist/db.ts:35-40` | `ProjectMeta {id, name, updatedAt, dirty}` — feeds the PROJECTS list |
| `src/persist/db.ts:54-60` | `ProjectDb` surface: `getRecord / putRecord / allRecords / deleteRecord` |
| `src/persist/db.ts:159-174` | `makeRecord(id, doc, json, updatedAt, dirty)` — envelope `name: doc.name` (:163): ONE put lands the name in the envelope AND the bytes |
| `src/persist/projectStore.ts:25-28` | `listProjects` — most-recent-first by `updatedAt` (the list order + the successor order) |
| `src/persist/projectStore.ts:31-47` | `saveProject(db, id, doc, opts)` — encode → makeRecord → putRecord; returns the record |
| `src/persist/projectStore.ts:50-57` | `loadProject` — getRecord → decode; THROWS `DecodeError`/`Error` on bad/missing rows |
| `src/persist/projectStore.ts:60-65` | `getProjectRecord` — raw row access (the UNDO hold) |
| `src/persist/projectStore.ts:67-78` | `deleteProject(db, id)` — comment :67-70 "NOT wired to any UI… destructive"; resolves `true` iff a row existed |
| `src/persist/projectStore.ts:81-87` | `mostRecentProject(db)` — max `updatedAt` row (successor pick; takes NO exclusion today — S-2 adds one or filters) |
| `src/persist/newProject.ts:20-33` | `createNewProject(db)` — fresh `createFreshProjectDocument()` under a NEW `crypto.randomUUID()` id, `saveProject` clean, returns `{record, doc}`; never clobbers |
| `src/persist/autosave.ts:7-9` | cadence header: ~800 ms trailing debounce, 30 s interval flush, SYNCHRONOUS best-effort flush on `visibilitychange→hidden` / `pagehide` |
| `src/persist/autosave.ts:74` | `DEFAULT_DEBOUNCE_MS = 800` (NOT "≈1 s" — measured) |
| `src/persist/autosave.ts:144-174` | `flush()` — re-reads the LIVE `store.getState().doc` AT FLUSH TIME, hash-skips unchanged docs, else `enqueue(putRecord(makeRecord(projectId, doc, encode(doc), now(), false)))`. **This is the resurrection upsert**: any live controller timer can re-put its `projectId` row with the current doc |
| `src/persist/autosave.ts:196-199` | the debounce timer that fires `flush()` |
| `src/persist/autosave.ts:241-256` | `stop()` — clears the debounce timer AND the 30 s interval, unsubscribes the store, REMOVES the `pagehide`/`visibilitychange` listeners, then `if (pending) await flush()`. After `await stop()` the stopped controller can NEVER write again — no timer, no listener, no subscription |
| `src/persist/fileIO.ts:33,272` | `IMPORTED_SUFFIX = " (imported)"`; import already renames on the way in (`name: \`${doc.name}${IMPORTED_SUFFIX}\``) — import needs NO change |
| `src/persist/fileIO.ts:85-93` | `safeFileStem` — strips path separators/control chars for FILENAMES only (not list names) |

### 1.3 Boot controller — the ONE ordering law

> Plan PATH CORRECTION: the file is `src/persist/boot.ts`, not `src/document/boot.ts`. All line numbers verify as recorded.

| Anchor | Fact |
|---|---|
| `src/persist/boot.ts:75-101` | `startController(projectId)` — sets `activeProjectId`, starts autosave against the live store, seeds the saved-indicator from the target row |
| `src/persist/boot.ts:103-113` | **THE ORDERING LAW** — `switchToProject(id)`: `await controller?.stop()` (flush + disarm every writer) THEN `startController(id)`; "the document itself is loaded by the caller — AFTER this call, so the old row can never receive the new bytes" |
| `src/persist/boot.ts:179-185` | sticky-error + one-shot `RECOVER` action precedent (quarantine flow) |
| `src/persist/boot.ts:189-198` | first boot: demo doc (:193-194), `saveProject` (:196), `armFirstRunNudge()` (:198 — the ONLY nudge armer; rename/delete never fire it) |
| `src/persist/boot.ts:45-72` | accessors the UI uses: `autosaveStatus`, `getLastSavedAt`, `getActiveProjectId`, `savedProjects`, `getAutosaveController`, `getBootDb` |

### 1.4 Store — the single write path

| Anchor | Fact |
|---|---|
| `src/state/store.ts:156-175` | `commit(next, coalesceKey?)` — validate (throw = store unchanged) → optional coalescing → `docStore.setState({doc: next})`. EVERY document mutation goes through this one function |
| `src/state/store.ts:853-862` | `renamePattern(lane, patternId, name)` — the rename precedent: read doc → immutable spread → `commit({...doc, patterns})`, NO coalesceKey (one history entry per rename) |
| `src/state/store.ts` (whole file) | there is NO `setProjectName` today — S-2 creates it |

### 1.5 Projects UI — panel, list, actions, keyboard contract

| Anchor | Fact |
|---|---|
| `src/components/Projects.tsx:13-16` | **the recorded deletion law, verbatim**: "Deliberately NO delete UI (Hulk): deletion is destructive and unrecoverable in a local-first app with no backend — a slip cannot cost work. … removal UX, if ever wanted, belongs behind an undoable, deliberately slow confirmation of its own." |
| `src/components/Projects.tsx:47-83` | `registerHelp` — 7 entries: `projects.open / projects.item / projects.new / projects.wav / projects.midi / projects.save / projects.openfile` |
| `src/components/Projects.tsx:101-148` | popover keyboard contract: doc-level Esc closes (:102-107, CAPTURE-phase listener on `document`), `focusables()` (:114-119 — enumerates `button:not([disabled])` ONLY), Tab trap (:121-131), `close()` returns focus to the anchor button (:133-136), open focuses the first item (:138-148) |
| `src/components/Projects.tsx:150-172` | `handleOpenProject` — decode → `switchToProject` → `loadDocument` (the ordering law applied; already-active row is a no-op close) |
| `src/components/Projects.tsx:174-195` | `handleNew` — `createNewProject` → `switchToProject(record.id)` → `loadDocument(doc)` |
| `src/components/Projects.tsx:278-301` | `handleFile` (import) — `importProjectFile` → `switchToProject(result.record.id)` → `loadDocument` |
| `src/components/Projects.tsx:329-356` | the saved list: `ul.projects-list` (:329), one `button.projects-item` per row (:333-352) with `data-help="projects.item"`, `is-current` + `aria-current` (:337-342), `disabled={busy()}` (:343), name span (:346) + relative-time/"unsaved" span (:347-351) |
| `src/components/Projects.tsx:357-402` | actions row: NEW (:358-366) / EXPORT WAV (:367-375) / EXPORT MIDI (:376-384) / SAVE FILE (:385-392) / OPEN FILE (:393-401) — all `booth-btn projects-action`, all `data-help`-registered, all but SAVE `disabled={busy()}` |

> Plan PATH CORRECTION 2: the plan's "open (:150-172), NEW (:174-195), import (:278-301)" anchors were listed under boot.ts; those ranges are **Projects.tsx** handler bodies (verified above). The lines verify exactly in Projects.tsx.

### 1.6 Inline-edit + toast precedents

| Anchor | Fact |
|---|---|
| `src/components/PatternRail.tsx:513-560` | `InlineEdit` — props `{initial, maxChars, label, help?, onCommit, onCancel}`; Enter commits / Esc cancels (:554-558, both `stopPropagation()`) / blur COMMITS (:548); `maxLength` attr; focus+select on mount + a 0 ms re-assert (IN-4 dblclick focus race); commits run through `clampCue(value, maxChars)` |
| `src/state/toasts.ts:20-23` | `ToastAction {label, run}` — the one-shot action vehicle |
| `src/state/toasts.ts:33-41` | `Toast.action` ("runs then dismisses", :33) + `Toast.sticky` (:41, XP-1: no auto-dismiss timer, owner dismisses) |
| `src/state/toasts.ts:54-55` | `MAX_TOASTS = 3` (oldest dropped), `AUTO_DISMISS_MS = 5000` — the 5 s precedent for the confirm auto-revert |
| sticky-toast in-panel precedent | `Projects.tsx:217` RENDERING WAV… `{sticky: true}` + owner `dismissToast` (:241) |
| `src/persist/boot.ts:179-185` | RECOVER — sticky error + one-shot action usage |

### 1.7 Help registry + gates with existing teeth

| Anchor | Fact |
|---|---|
| `src/help/registry.ts` | `registerHelp` (colocated law, I2-6) |
| `tests/browser/help-coverage.test.tsx:1-25` | the coverage gate: walks every surface state (incl. "projects popover"), enumerates every connected interactive element (button/input/select/textarea/positive-tabindex, not aria-hidden) — each must resolve via `closest("[data-help]")` to a substantive registry entry. **Adding an unregistered control FAILS the suite** — S-3's rename/delete/confirm/editor controls MUST register |
| `tests/browser/target-size.test.tsx:256-258` | `optional` rationale: transient rows (saved-projects list, empty on a wiped origin) audit when present instead of failing on absence |
| `tests/browser/target-size.test.tsx:799-818` | the projects-popover audit: opens the popover, audits `.projects-item` (limit 2, `optional: true`) and `.projects-action` (always), closes with Escape |
| `tests/browser/mobile-viewport.test.ts:547-578` | m1 first-run pins (nudge armed poll, no-hscroll at tightest width) — untouched by rename/delete (only boot's first `saveProject` arms the nudge) |
| `tests/browser/hu3.test.ts:137-186` | "Projects popover switches projects without clobbering the old row" — real IndexedDB, 1100 ms flush window (800 ms debounce + IDB) — **the template for the delete-resurrection gate** |
| `tests/browser/persistence.test.ts:54-100` | real-IndexedDB envelope tests (round-trip, boot-restore) |
| `tests/browser/e2e-happy-path.test.ts:527-544` | `.projects-btn` click + `actionByLabel` helper over `.projects-action` (label-matched, waits for enabled) |
| `tests/persistence.test.ts:48-127` | unit envelope describe; `deleteProject` API test at :100-107 (true/false on repeat, load throws after) |
| `tests/hu3.test.ts:115-129` | unit "project switching ordering (no-clobber)" — fake timers; the S-2 resurrection twin extends here |
| `tests/demoSong.test.ts:276-283` | first-run nudge arm/dismiss unit pins (arm assert at :280) |

### 1.8 Phone rendering of the Projects button + phone CSS

| Anchor | Fact |
|---|---|
| `src/components/Booth.tsx:539-541` | `<Show when={!props.compact}><BoothOptions /></Show>` — `compact` (phone) removes ONLY BoothOptions (to the drawer) |
| `src/components/Booth.tsx:543-587` | the `booth-group-position` group (BAR.BEAT.STEP readout + beats + SR announcer + `SaveIndicator` :585 + `Projects` :586) renders in BOTH stages — the button already lives in the sticky phone chrome; NO drawer move |
| `src/styles/projects.css:27` | popover `min-width: 232px` (fits 360 with margin) |
| `src/styles/projects.css:131-137` | MB-3/m2 phone ≥44px law: `[data-stage="phone"] .projects-item, .projects-action { min-height: 44px }` — new per-row controls MUST join this selector set (or share the classes) |

---

## 2. THE LAW — rename (S-2 + S-3)

### 2.1 The shared pure normalizer (S-2, new)

One exported pure function, the `clampCue`/`CUE_MAX_CHARS` precedent scaled to
titles (`src/state/patternRail.ts:252-255` is the shape):

- **`PROJECT_NAME_MAX_CHARS = 48`** (a new exported constant, schema-adjacent or
  in the same module as the normalizer — NOT in `ProjectDocumentSchema`, which
  stays `v.string()` untouched; the bound is UI/normalizer law, not schema law).
- normalize(name): **collapse internal whitespace runs to one space, trim ends,
  clamp to 48 characters BY CODE POINTS** (`[...s].slice(0, 48).join("")`).
  Diverges deliberately from `clampCue`'s UTF-16 `.slice`: a project name may
  carry emoji (surrogate pairs); a mid-pair cut yields a lone surrogate that
  `encode` (JSON.stringify, `src/document/codec.ts:21`) would serialize but
  UTF-8 consumers choke on. Code-point clamp = emoji-safe.
- returns **`undefined` when empty after trim** — the no-op signal.

### 2.2 Name constraints (final wording)

1. **Trim on commit** (plus whitespace-collapse, §2.1).
2. **Empty-after-trim commit is a NO-OP**: the rename refuses, the old name
   stays, the editor exits WITHOUT any write (store or db).
3. **Max 48 chars**: `maxLength={48}` on the editor input is UX; the
   normalizer is the authority (it also covers programmatic callers).
4. **Duplicates ALLOWED**: ids are the key (`ProjectRecord.id`); NO uniqueness
   check, NO silent suffixing — the list already disambiguates with relative
   time (`Projects.tsx:347-351`) and `is-current` (:337-342).
5. **Unchanged name = no-op** (normalized equals current) — no write, no
   history entry, no `updatedAt` bump.

### 2.3 Active-row rename — `setProjectName` (S-2 store action)

`setProjectName(name: string): void` in `src/state/store.ts`, the
`renamePattern` precedent (:853-862) exactly:

- `const normalized = normalizeProjectName(name); if (normalized === undefined) return;`
- `const doc = docStore.getState().doc; if (normalized === doc.name) return;`
- `commit({ ...doc, name: normalized });` — **NO coalesceKey**: one rename =
  one history entry, one pending autosave mark (a single blur/Enter commit;
  typing coalescing does not apply to a committed field write).

**How the name lands BOTH the live doc AND the record envelope:** `commit`
(:156-175) swaps the live doc; the autosave subscription marks pending; the
800 ms debounce fires `flush()` (:144-174) which re-reads the LIVE doc and
does ONE `putRecord(makeRecord(projectId, doc, encode(doc), now(), false))` —
`makeRecord` copies `name: doc.name` into the envelope (:163) and `encode`
embeds it in the json. One put, both surfaces.

**Does a pending debounced flush overwrite the name? NO — there is no stale
snapshot anywhere.** `flush()` reads `store.getState().doc` at flush time, so
a rename committed while a flush is pending produces a flush that WRITES the
new name; a rename committed while a flush is mid-`await` lands one debounce
later (the flush wrote the old name, the rename re-marked pending, the next
800 ms debounce rewrites with the new name). Convergence is monotonic; no
lost update is possible on the active row. The ONLY way to lose an active-row
rename is `stop()` failing its final flush (storage error — §4.6).

### 2.4 Inactive-row rename — `renameProjectRecord` (S-2, projectStore)

`renameProjectRecord(db, id, name)` in `src/persist/projectStore.ts` (the
`saveProject` shape, :31-47):

1. `const record = await db.getRecord(id);` — missing row → no-op return.
2. `const doc = decode(record.json);` — a damaged row THROWS; the caller
   (S-3) catches and shows the existing damaged-row error toast shape; the
   row is left untouched.
3. normalize → `undefined` or `=== doc.name` → no-op.
4. `await saveProject(db, id, { ...doc, name: normalized })` — full record
   rewrite: envelope name + re-encoded json land together, `updatedAt`
   refreshed (row moves to top of the most-recent-first list — correct: a
   rename IS a change the user just made).
5. **NEVER touches `docStore` or the autosave controller.** If applied to the
   ACTIVE row anyway, the next autosave flush would overwrite the record with
   the live doc's OLD name (flush re-reads the live doc). Therefore the S-3
   dispatch rule is LAW, not preference: **current row → `setProjectName`;
   every other row → `renameProjectRecord`.**

### 2.5 InlineEdit reuse contract (S-3)

Reuse the `PatternRail.tsx:513-560` contract verbatim (extract to a shared
component or fork the same shape — either satisfies the law): `{initial:
currentName, maxChars: 48, label: "Rename project", help: "projects.rename"}`;
Enter commits, Esc cancels, **blur commits**, focus+select on mount (+ the
IN-4 0 ms re-assert), `maxLength` attr. The commit path runs the normalizer
first; empty-after-trim exits silently (no-op). After commit: refresh the
list (`savedProjects()`), toast optional (the list itself is the feedback —
a toast is NOT required by law; if added it must be `showInfo`, auto-dismiss).

**Two keyboard-law traps S-3 must handle explicitly:**

- **Esc layering.** The popover's Esc close is a CAPTURE-phase listener on
  `document` (`Projects.tsx:102-107`) — it runs BEFORE any target-phase
  handler, so `InlineEdit`'s own `Escape` `stopPropagation()` (:554-556,
  target phase) CANNOT stop the popover from closing. LAW: while a rename
  editor (or a confirm state, §3.1) is open, the doc-level Esc handler must
  NOT close the popover — gate `onDocKeydown` on "an editor/confirm is open"
  (Esc then cancels the edit/reverts the confirm ONLY, popover stays). The
  gate may be a signal check or an `e.target`-inside-panel test, but it MUST
  exist or Esc-to-cancel closes the whole popover and loses the edit focus
  context.
- **Tab-trap enumeration.** `focusables()` (:114-119) selects
  `button:not([disabled])` ONLY — an `<input>` editor is INVISIBLE to the
  Tab trap, so Tab would skip it / escape the panel. LAW: while the editor is
  mounted, the trap's selector must include it (e.g. add
  `input:not([tabindex="-1"])` to the query, or push the editor element
  explicitly). The help-coverage walk (§1.7) will also demand the input carry
  `data-help` resolving to a registered entry.

---

## 3. THE LAW — delete (S-2 + S-3)

### 3.1 Two-step inline confirm (the recorded contract, made exact)

Honors `Projects.tsx:13-16` verbatim ("undoable, deliberately slow
confirmation"). Per-row state machine, owned by Projects.tsx:

```
idle --press DELETE--> confirming --press CONFIRM DELETE--> deleted
confirming --Esc | click-away | 5 s timer--> idle (revert)
```

- **One row in `confirming` at a time**; entering confirm on another row
  reverts the previous one (and restarts its own timer).
- `confirming` REPLACES the row's content with a danger-styled CONFIRM DELETE
  control (+ the 5 s countdown is implicit — no visible timer required): the
  row never grows horizontally (phone-fit law, §5).
- **Cancels**: Esc (via the §2.5 layering gate — revert, popover stays),
  click-away = any pointerdown outside the confirming row (inside the
  popover counts: clicking another row reverts), and a **5 000 ms auto-revert
  timer** (`AUTO_DISMISS_MS` precedent, `toasts.ts:55`). Timer cleared on
  either exit; cleared on popover close (no orphan timers).
- The second press runs §3.2 (or §3.3), then the §3.4 toast.

### 3.2 Delete-ACTIVE-song — the succession sequence (THE ordering law)

Deleting the row you are working in. The exact testable sequence, in order:

1. **HOLD**: `const held = await db.getRecord(doomedId)` — the exact
   `ProjectRecord` (envelope + canonical json) kept in memory for UNDO. No
   row → no-op.
2. **PICK SUCCESSOR**: the most-recent REMAINING row by `updatedAt`
   (`listProjects` order minus the doomed id; an excluding variant of
   `mostRecentProject`, `projectStore.ts:81-87`); if none remain,
   `createNewProject(db)` (`newProject.ts:20-33` — fresh "Untitled" under a
   new uuid; the app NEVER boots into zero rows).
3. **RETARGET FIRST**: follow `handleOpenProject`'s verified order
   (`Projects.tsx:159-161`): decode the successor doc if it is an existing
   row (`loadProject`) → `await switchToProject(successorId)`
   (`boot.ts:109-113` → `await controller?.stop()`) → `loadDocument(doc)`.
   `stop()` (`autosave.ts:241-256`) flushes the doomed row one last time
   with the CURRENT doc (any just-committed rename included — flush re-reads
   the live doc before `loadDocument` swaps it), then clears the debounce
   timer + 30 s interval, unsubscribes the store, and REMOVES the
   pagehide/visibilitychange listeners. After `await switchToProject`
   returns, NO writer exists for `doomedId`.
4. **THEN DELETE**: `await deleteProject(db, doomedId)` (:71-78).
5. Refresh the list; show the §3.4 toast.

**Why this order (the resurrection race, spelled out):** the autosave
controller UPSERTS its row on every flush — debounce (:196-199), 30 s
interval, and pagehide/visibilitychange (:7-9) all call `flush()` →
`putRecord(makeRecord(projectId, doc, encode(doc), ...))` with the LIVE doc.
Delete the active row without stopping its controller first and the next
pending flush re-creates the row ("resurrection") carrying the live doc's
bytes — the delete silently fails. Step 3 before step 4 is the ONLY ordering
that is safe, and it is exactly the existing open/NEW/import law
(`Projects.tsx:7-9`, `boot.ts:103-113`) extended with a `deleteRecord`
tail. Note the plan's assumption (4) "≈1 s debounce window" measures
**800 ms** (`autosave.ts:74`) with a 30 s interval and a pagehide flush as
the additional writers — all three are disarmed by `stop()`, so the
succession law as stated covers every writer; no extension needed.

### 3.3 Delete-INACTIVE-song — the simple path

No retarget, no controller involvement (the active controller only ever
writes `activeProjectId`): HOLD → `await deleteProject(db, id)` → refresh →
toast. The working song is untouched.

### 3.4 The sticky DELETED toast + one-shot UNDO

`showError`-shaped STICKY toast (`toasts.ts:41` — XP-1; owner never
auto-dismisses; the ✕ and MAX_TOASTS=3 eviction still apply) with a one-shot
`action: { label: "UNDO", run }` (`ToastAction` :20-23 — runs then the toast
dismisses):

- **run()**: `await db.putRecord(held)` — re-puts the EXACT held record:
  byte-identical `json`, original `name`, original `updatedAt` (the row
  returns to its exact list position and dirty state) — then refresh the
  list. No decode/re-encode: the held bytes ARE the song.
- **UNDO never auto-switches**: the restored row comes back INACTIVE (the
  user is in the successor); clicking it in the list opens it through the
  normal ordering law. Restoring ≠ reopening.
- **UNDO is one-shot by vehicle** (the action dismisses after run);
  re-deleting starts §3.1 fresh.
- **id collision at UNDO time**: successor creation uses `crypto.randomUUID`
  (`newProject.ts:29`) — collision with the held id is cryptographically
  negligible; `putRecord` upserts, and if the impossible happens the held
  record is the authoritative restore. No guard required (documented edge,
  §4.4).

Suggested copy (S-3 wording task, Professor X voice):
message `DELETED "${held.name}"`, suggestion "The song is gone. UNDO puts it
back exactly as it was.", action `UNDO`.

---

## 4. Edge cases (decided here; S-2/S-3 tests must cover them)

1. **Rename during playback.** A name write touches only `doc.name` — the
   audio session's pattern/transport bytes are untouched; playback is
   unaffected by either rename path (the inactive path never even notifies
   the store). No law beyond §2.
2. **Rename during a project switch.** All row controls live inside the
   popover and join the `busy()` disable set (`Projects.tsx:343` precedent);
   a switch closes the popover. If a rename committed in the same tick as a
   switch, the ordering law already saves it: `stop()`'s final flush re-reads
   the live doc BEFORE `loadDocument` swaps it, so the renamed name lands in
   the OLD row (§3.2 step 3). No extra law.
3. **Delete the last remaining song.** §3.2 step 2 → fresh NEW ("Untitled",
   new uuid) — never zero rows; the DELETED toast's UNDO then yields two
   rows (successor + restored), both valid.
4. **UNDO after switching away.** The hold is in-memory (closure over the
   toast's `run`); switching songs does not dismiss a sticky toast, so UNDO
   still re-puts the row — it returns INACTIVE wherever the user now is.
   UNDO after the toast is evicted (MAX_TOASTS=3) or the tab closes is GONE
   — local-first, no backend, no trash store (plan assumption (2): if
   cross-session undo is wanted later, that is a brief delta).
5. **Name with emoji / whitespace.** Emoji allowed (schema is plain
   `v.string()`); the normalizer's CODE-POINT clamp (§2.1) can never split a
   surrogate pair; whitespace runs collapse, ends trim; display truncation is
   CSS's job (`.projects-name` nowrap). Import suffixing (`fileIO.ts:272`)
   composes normally.
6. **Storage-full behavior.** Active-row rename: the flush throws
   QuotaExceeded → autosave's catch (`autosave.ts:166-172`) keeps
   `pending=true`, sets status `"error"` → SaveIndicator shows the error
   label (`src/lib/saveIndicator.ts:20`), the 30 s interval retries — the
   rename is never silently lost while the tab lives. Inactive-row rename /
   UNDO re-put: `putRecord` throws through `saveProject`/`run()` → S-3
   catches and shows the standard error toast shape ("Could not rename…" /
   "Could not restore…"); for UNDO failure the held record stays in memory
   and the toast stays up (do NOT dismiss on a failed run) — the user can
   retry UNDO after freeing space. Delete: `deleteRecord` only frees space.

---

## 5. THE LAW — phone fit (S-4)

1. **ONE shared popover, no drawer move**: the Projects button already lives
   in the sticky phone chrome (`Booth.tsx:543-587`, rendered in both stages —
   `compact` removes only BoothOptions, :539-541). All new controls are born
   in the shared popover.
2. **≥44 px targets at 360×800, 390×844, 430×932**: the per-row RENAME and
   DELETE controls, the CONFIRM DELETE state, and the rename editor input
   all join the `[data-stage="phone"]` 44 px selector set
   (`projects.css:131-137`) or carry equivalent painted/hit boxes, measured
   by the target-size audit's elementFromPoint law.
3. **No horizontal growth in confirm/editor states**: `confirming` REPLACES
   row content (§3.1); the editor REPLACES the name display — the 232 px
   min-width popover (`projects.css:27`) must not widen; m1's no-hscroll pin
   (`mobile-viewport.test.tsx`) stays byte-green.
4. **Gates that walk it**: `target-size.test.tsx:799-818` (popover audit —
   new selectors join with the :256-258 `optional` rationale since rows
   exist only when the origin has saves; the confirm state needs the gate to
   click DELETE once before auditing), `mobile-viewport.test.ts` (m1 pins),
   the phone keyboard must open over the rename input without the sticky
   chrome eating it (the drawer precedent — verify in S-4).
5. **i4/i5 fences untouched**: no grid CSS, no chrome changes; grid share
   52.1/49.5/56.7 % and chrome <50 % fences must stay byte-identical.

---

## 6. Plan-anchor verification record (S-1 diligence)

All plan anchors re-measured at `7fe2a4c`. Verdicts:

- **EXACT (verified to the line)**: schema.ts:866/:889/:941 · store.ts:115-117
  (function at :115) · db.ts:35-40/:159-174 · projectStore.ts:71-78 ·
  Projects.tsx:13-16/:47-83/:101-148/:150-172/:174-195/:278-301/:329-356/:357-402
  · boot.ts(:75-101/:103-113/:179-185/:196/:198) · PatternRail.tsx:513-560 ·
  toasts.ts:20-23/:34-41 · Booth.tsx:539-587 · projects.css:27/:131-137 ·
  fileIO.ts:272 · tests/persistence.test.ts:48-127 + :100-107 ·
  tests/hu3.test.ts:115-129 · tests/browser/hu3.test.ts:137-186 ·
  tests/browser/persistence.test.ts:54-100 ·
  tests/browser/help-coverage.test.tsx:1-25 · target-size.test.tsx:800-816
  (measured 799-818, same block) · demoSong.test.ts:280 (arm assert; it-block
  276-283) · mobile-viewport.test.ts:550-578 (measured 547-578, same block).
- **CORRECTED — path**: "src/document/boot.ts" → **`src/persist/boot.ts`**
  (all its line anchors verify there); the plan's open/NEW/import anchors
  :150-172/:174-195/:278-301 are **`src/components/Projects.tsx`** handler
  bodies, not boot.ts. "toasts.ts" → **`src/state/toasts.ts`**.
- **CORRECTED — range**: store.ts:853-862 renamePattern (comment :853,
  function :854-862 — covered) · fileIO.ts:85-98 safeFileStem (measured
  :85-93) · e2e-happy-path.test.ts:531-543 helpers (measured :527-544) ·
  target-size optional rationale :257 (comment block :256-258).
- **CORRECTED — fact**: the autosave debounce is **800 ms**
  (`autosave.ts:74`), not "≈1 s"; the additional writers are the 30 s
  interval and the pagehide/visibilitychange flush (:7-9) — all disarmed by
  `stop()` (:241-256), so the §3.2 succession law covers every writer.

Confidence: every anchor published above was opened and read at HEAD by this
worker; none are copied from the plan unverified.

---

## 7. Gate reconciliation — existing teeth + what S-5 must add

### Existing assertions touching the projects surface (do not break)

1. `tests/browser/help-coverage.test.tsx` — projects-popover walk; FAILS on
   any unregistered interactive control (buttons AND inputs).
2. `tests/browser/target-size.test.tsx:799-818` — `.projects-item`
   (optional/limit 2) + `.projects-action` audits; Escape close.
3. `tests/browser/mobile-viewport.test.ts` — m1 no-hscroll + first-run nudge
   pins (:547-578); nudge arms ONLY at first-boot saveProject (boot.ts:198).
4. `tests/browser/hu3.test.ts:137-186` — popover switch no-clobber (1100 ms
   real flush window).
5. `tests/browser/persistence.test.ts:54-100` — real IndexedDB envelope.
6. `tests/browser/e2e-happy-path.test.ts:527-544` — `.projects-btn` +
   label-matched `.projects-action` helpers (new buttons should keep the
   `projects-action` class contract or extend the helper).
7. `tests/persistence.test.ts:48-127` — unit envelope + deleteProject API
   (:100-107).
8. `tests/hu3.test.ts:115-129` — unit switch-ordering no-clobber.
9. `tests/store.test.ts` — commit/action laws (setProjectName lands here).
10. `tests/demoSong.test.ts:276-283` — nudge pins (untouched by i6).

### New gates S-5 must land (with their fences)

**Unit (extend tests/persistence.test.ts + tests/store.test.ts + tests/hu3.test.ts):**
- normalizer: trim/collapse, 48 code-point clamp, emoji-surrogate-safe,
  empty→undefined, unchanged→no-op.
- `renameProjectRecord`: name lands envelope AND json (decode-and-compare);
  no-op on missing row and unchanged name; store doc provably untouched.
- `setProjectName`: single commit, NO coalescing (two renames = two history
  entries), empty no-op, doc.name updated.
- delete-active succession: fake-timer twin of hu3.test.ts:115-129 — a
  PENDING flush cannot resurrect the doomed row (arm a debounce, run the
  succession, advance timers, assert the row is gone and the successor row
  holds the bytes); delete-inactive plain true/false.

**Browser (extend tests/browser/hu3.test.ts + help-coverage + target-size):**
- rename CURRENT row persists through a real 1100 ms flush window (envelope
  + decoded json both carry the new name).
- rename OTHER row lands the record and never touches the working doc.
- delete inactive: row gone, working row untouched.
- delete ACTIVE: successor is the most-recent remaining (or fresh NEW), AND
  the doomed row stays gone after a full flush window — the resurrection
  race gate (hu3.test.ts:137-186 is the template).
- UNDO restores the exact row (json byte-compare, updatedAt preserved).
- two-step confirm: DELETE → CONFIRM swap, Esc/click-away/5 s revert.
- Esc-during-edit cancels the edit and keeps the popover open (§2.5 trap).
- Tab-trap includes the rename editor input (§2.5 trap).
- help-coverage extended over the confirm + rename-editor states (new
  `projects.rename` / `projects.delete` registrations).
- target-size: new per-row selectors + confirm-state audit at
  360/390(+430) ≥44 px; m1/i4/i5 fences byte-identical.

**Close-out battery (S-5, from scratch):** lint 0 · typecheck · unit
(86 files / 1726 + new, 0 fail) · browser (79 files / 215 + new, exit 0) ·
fuzz 21/21 · mobile slice · `check:bundle` PASS vs the 92.11 KB gz baseline
with attributed delta (expect ≤ +0.4 KB gz; record in
docs/dev/perf-budget.md §3 i6 row) · scratch-break teeth demonstrated on at
least one new gate.

---

## 8. Battery statement at HEAD (S-1 fence, docs-only change)

At `7fe2a4c` (before this doc landed — HEAD was docs-only over the i5
close-out), the S-1 worker ran: `npm run lint` (0 problems) →
`npm run typecheck` (clean) → `npm test` — **86 files passed, 1726/1726
tests, exit 0** (evidence: S-1 production-log entry,
docs/ultron/production-log.md). The full browser/fuzz/mobile/bundle battery
was closed at `42e9524` (H-5, iteration 5) and `7fe2a4c` changed only
`DESIGN.md` + `.impeccable/design.json` — no code, so the i5 battery record
carries to HEAD; S-5 re-runs the whole battery from scratch with the new
gates.
