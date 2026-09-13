# Assessment A — independent design review

Design specificity verdict: strongly authored for Bitbounce. Connected instrument quadrants, luminous note lengths, the compact transport, scale-constrained pitched rows and the in-place device chain belong to a music instrument. This is not an interchangeable dashboard. Membrane's quieter surface is coherent, but the control stack currently takes more room than the notes at the compact desktop target. The largest opportunity is to give the music more space and make the distinction between sound edits and view navigation unmistakable.

Evidence: fresh independent Codex in-app tab at http://127.0.0.1:5199/, current source App.tsx, PRODUCT.md, DESIGN.md, membrane.css and focused components. Initial browser restored an existing eight-track saved project, 88 BPM, D minor; this was not a clean first-run demo. Dark desktop inspected at default size and 1280×800; phone at 390×844. Opened empty Drums FX, its five-device chooser, populated Bass Filter, Projects and WAV export; switched Bass phone lane and Song arrangement. No musical edits or settings changes. WAV UI progressed from RENDERING WAV… to WAV EXPORTED · 8-BAR CYCLE. This verifies visible feedback only, not file/audio correctness. Screenshot observations exist in tool outputs; no local screenshot files were written. No detector or historical critique input was consulted. No AGENTS.md exists at repository root. Browser viewport reset at end. Light theme and physical touch/audio not assessed.

## Nielsen scores

| Heuristic | Score | Evidence or limitation |
|---|---:|---|
| Visibility of system status | 3 | Saved timestamp, selected lane announcement, FX count and export progress/completion are explicit; musical identity differs between visible titles and accessible names. |
| Match with real world | 3 | Piano-style pitch ordering and visible duration are familiar; two different OCT meanings and LP/Q shorthand demand interpretation. |
| User control and freedom | 3 | FX close and chooser Escape work; source supports undo/redo and project recovery. Phone offers no visible undo path in observed UI. |
| Consistency and standards | 3 | Repeated sound/mix strips and native grouped selects are coherent; renamed instrument titles retain old accessible lane names. |
| Error prevention | 3 | Disabled boundary controls, scale constraints, and source-documented clip-shortening refusal; no destructive-flow testing. |
| Recognition rather than recall | 2 | Controls visible, but OCT/view distinction, phone gesture rules and restore/undo knowledge rely on recall. |
| Flexibility and efficiency | 3 | Source has extensive keyboard accelerators; grouped presets and two editor pages support power users. |
| Aesthetic and minimalist design | 2 | Strong material and note emphasis, but large transport/control regions force compact desktop page scrolling. |
| Error recovery | 3 | Source has persistence recovery, actionable export failure handling and undo; failure states not induced. |
| Help and documentation | 2 | Desktop INFO and KEYS are contextual; phone explicitly omits both. |
| Total | **27/40** | **Acceptable — significant targeted improvements remain.** |

## Cognitive load

The control surfaces are grouped, but desktop hierarchy overweights setup relative to composing: transport, status band, workspace tabs, sound rows, selected edit tools, and register controls precede tiny note rows. The selection context is also hidden in color and availability of extra tools. More than four options occur at the five-item FX chooser, the 58-preset grouped sound selector, the eight phone instrument tabs, and the five main Projects actions plus agent access and demos. The preset grouping is useful chunking; the FX chooser is small enough for experts, yet plain effect descriptions would help new users. Phone editing introduces Draw/Scroll, horizontal paging, vertical pitch navigation and long-hold panning together. Source and visible controls show no adjacent phone help entry.

Checklist concerns: jargon barrier (OCT, SEMI, ST, LP, Q); recall burden (view vs transpose, gesture behavior); context switching (editing and arrangement); visual noise floor (quiet controls do not establish enough difference between essential and occasional controls). No loading or decision-paralysis failure was observed.

## Emotional journey

The opening surface promises a personal instrument: restrained glows make existing notes inviting. Selecting a phone lane feels direct, and opening FX retains instrument context. The valley is learning what changes sound versus what only moves the view, especially with mobile help absent. Finishing is reassuring: rendering remains visibly in progress and ends with an eight-bar export confirmation. The review did not listen to output or verify loop seams.

## Strengths

1. The connected quadrants and lane-colored duration shapes make musical structure the identity. Membrane avoids irrelevant decoration and retains a clear instrument character.
2. FX disclosure is well placed. The empty state names the next action, the chooser contains five recognizable effects, and the populated Filter exposes bypass, ordering, removal and controls within its lane.
3. Status feedback earns trust: saved age includes an accessible timestamp; phone has one bottom status strip; WAV rendering ends with an explicit cycle length. Native grouped sound selectors and disabled navigation boundaries are practical choices.

## Priority issues

### P1 — Compact desktop clips the lower instruments behind page scrolling

Observed DOM measurement at 1280×800: document scrollHeight 873; upper panels top 216/bottom 560; Chords and Lead bottom 873. Screenshot confirms the lower pitch rows and footers sit below the viewport. DESIGN.md explicitly targets no page scrolling at 1280×800. Long stretches of vertical space separate sound strips and register rows while the musical grids are cramped. This undermines the four-instrument overview on the primary desktop flow.

Fix: budget transport and panel control height before allocating grid height; condense the status and transport stack and remove redundant reserved control space in unselected panels. Keep complete grid rows and footer inside the viewport, scrolling within the grid when required. Verify selected pitched lane as well as Drums, with a two-bar project and scrollbars present. Source: membrane.css 88, 122, 173, 284, 879–884, plus inherited stage layout; exact contributing rules require implementation diagnosis. Suggested command: $impeccable layout.

### P2 — Two OCT controls look equivalent but change different things

Observed desktop Bass has an OCT −/0/+ next to its preset and a second OCT −/+ above its grid. The first transposes audible notes, while the second changes the visible register. LaneHeader.tsx 119–120 explicitly explains the distinction in help; rendered text at 562–579 only says OCT. LaneGrid.tsx 2009–2037 labels the second control as octave view for accessibility, but its visual caption is OCT. A novice can change the exported music while trying to find notes.

Fix: label the preset-side control Transpose and its unit octaves; label grid navigation View with Oct/Semi steps, or make the range readout the heading. Preserve compactness through grouping, not identical labels for different consequences. Suggested command: $impeccable clarify.

### P2 — Phone hides the help and recovery affordances needed for exploratory editing

At 390×844, there is no INFO/KEYS entry and no visible undo action in the closed Options state; App.tsx 147–149 and Booth.tsx 239 onward explicitly omit INFO/KEYS for compact layout. The observed Filter presents LP, CUTOFF, Q and BYP without contextual explanation. LaneGrid exposes the touch instruction paragraph to the DOM, but it was not visible in the phone screenshot; novices encounter Draw/Scroll, step paging and pitch navigation at once. KeyboardShortcuts.tsx 138–151 supplies desktop undo, which is not a discoverable touch recovery path.

Fix: add Help and Undo/Redo within phone Options, with concise contextual help beside the active editing tool and device parameters. Keep inactive undo visibly disabled and provide a short next-action hint when the current lane is empty. Confirm Options has no existing recovery route before implementing; its open contents were not browser-inspected in this bounded pass. Suggested command: $impeccable onboard, then $impeccable harden.

## Persona flags

- Alex, power user: compact desktop hides lower-grid controls below the fold; the repeated OCT labels increase risk when rapidly adjusting registers. Keyboard shortcuts are a strength, not missing functionality.
- Jordan, first-timer: sees eight instrument tabs, sound names and FX abbreviations with little explanation on phone. The interface communicates control availability better than control consequences.
- Sam, accessibility-dependent user: visible Keys retains region LEAD, preset LEAD instrument preset, and Mute LEAD names in the fresh accessibility tree. This can cause confusion when following instructions or collaborating with a sighted person; titles should preserve stable lane identity while accessible labels include the same visible category. No screen-reader usability or contrast conformance claim is made.

## Minor observations

- Projects gives agent access explanatory copy significant space before familiar file actions. For the non-agent game developer this is a secondary concern; place it in a clearly optional disclosure while retaining its honest data-processing explanation.
- Many musical labels and meter names are small. Membrane includes 9px/10px/11px roles (329, 401, 208–212). Inspect low-vision zoom behavior before lowering any text further to solve fit.
- Phone fixed save status is readable, but lower note rows and the NEXT footer require vertical scrolling with eight tracks present. This is allowed by the short-screen product requirement; do not compress targets to force a fit.
- Native preset grouping and five-effect options are appropriate density for an instrument; reducing the actual sound library would solve the wrong problem.

## Targeted questions

1. Should 1280×800 preserve all four complete note windows, or may the unselected lanes become compact summaries so the selected instrument receives more editing space?
2. When someone tries this on a phone, which mistake should be easiest to recover from: placing a note, changing a sound, or changing a pattern chain?
3. Could the two OCT groups explicitly say Transpose and View without sacrificing the compact instrument character?
