# Sound browser

The lane sound name opens a browser instead of a native dropdown. Pitched
instruments share 836 presets across 18 categories. Drums have 80 kits grouped
into eight authored families. Category counts, favorites, recent selections and
search all use the same catalog.

Choose a category, narrow by sound character, tap a result to preview, then use
the explicit **Use sound** action. A preview never assigns the lane's sound or
writes the project. Closing cancels the candidate. Applying is one ordinary
sound-selection undo entry. The lane's previous/next buttons subsequently step
through the result set that contained the applied candidate.

The browser fills the phone viewport, with a category page and results page.
Desktop keeps categories beside the results. The footer stays visible while
results scroll. Native dialog focus containment, Escape dismissal and return to
the sound button protect the editor underneath. Opening focuses Close rather
than the search field, so the phone keyboard does not open unexpectedly.

Favorites, the last 20 applied sounds, and the last Browse category, character
filters and scroll position persist under `bitbounce.sound-browser.v1`. These
preferences do not enter project files or musical undo. Search crosses categories;
category and character terms match their metadata, with exact preset names taking
precedence. Recent order follows usage; Browse uses alphabetical names.

`src/audio/soundCatalog.ts` derives character metadata from synthesis controls:
waveform spectrum, envelope attack/sustain/release and noise mixture. Kit family
assignments are explicit. These are broad browsing descriptors, not measured
acoustic similarity or genre suitability. No sound recipe or saved ID is changed.

`Session.previewSound` uses a separate voice router connected to the production
master, bypassing track mute and effects. It initializes the master through the
normal mixer setup. A constant short phrase compares pitched voices; a constant
two-second rhythm compares kicks, snares, hats, shaker and cowbell. Required
recordings finish loading before scheduling. A generation guard discards stale
loads; stopping preview clears only the preview host. Failed auditions offer retry
and keep Use sound disabled.

Validation includes catalog coverage/filtering, candidate cancellation/loading,
real sample-backed preview without a project edit, explicit application, favorites,
error/retry and phone header geometry. Desktop and mobile visual review is recorded
with the release; physical phone audio and virtual-keyboard behavior still need
device acceptance.

Sound swaps keep the existing effects graph connected. The document bridge
resynchronizes lane configuration on selection, but `Session.setLaneChain`
skips an unchanged immutable effects array. Actual effects edits still update
the graph. The playback browser test checks that Use sound does not disconnect
unchanged track edges, that bypass still changes connections, and that each
track produces audio after synth/sample swaps and a stopped swap followed by
Play. Its built-app path uses trusted touch and measures output after preview
retirement. These Chromium checks do not reproduce the reported Android-only
silence; the graph change still needs verification on the affected phone.
