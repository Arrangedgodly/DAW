# Living instrument studies

Disposable, development-only visual options for Bitbounce. Start with `npm run dev:prototype`, then open `http://127.0.0.1:5193/?variant=A`.

The existing `/` route hosts an isolated frame when Vite is in development and `variant` is present. Production always renders the DAW. No project data is read or changed. The study uses an independent synthesized demo, editable notes, tone filters, tempo, mute/solo, and temporary pattern variations. It is not wired to the production audio engine or the user's song.

- A, Membrane, selected base: original A layout with Undertow's luminous note buttons. Active notes have a soft colored halo and brighten at the playhead. Moving background sheen and reflective ribbons were removed after the user clarified that the desired glow belongs to the grid buttons.
- B, Precision: silver planar chassis, side-mounted rotary controls and a narrow real audio waveform at each lane's seam.
- C, Undertow: open note marks, more negative space, and shared flowing ribbons beneath fixed controls.

All retain four instruments in a desktop quadrant and one selected instrument on phones. The bottom switcher and left/right keys change `variant` without resetting playback or edits. Grid arrow keys navigate notes. Space/Enter toggles focused note buttons. The Motion control scales the canvas reaction. System reduced motion suppresses the animated artwork while step position remains visible.

Audio synthesis and visual envelopes share the AudioContext clock; analysers supply waveform and amplitude. Muted/solo-excluded parts contribute neither audio nor reactive artwork. Stop clears voices and reactive light. Musical edits remain memory-only.

Track colors are the exception: the prototype, DAW and VIZ share `bitbounce.track-colors.v1`. Each uses the same swatch component, with Light, Middle and Dark options for 10 color families. There is no free-form picker. Swatch selection persists locally and carries into the actual visualizer. Use theme default removes the override. This changes appearance preferences only, never saved songs or undo.

User direction, 2026-09-12: A is the preferred foundation with C's button glow, not background sheen. The approved Membrane layout and button treatment are now implemented in the real DAW, using its existing playback observer. Track-color customization is shared by the DAW and VIZ. These development-only studies remain available for comparison; production renders the full DAW.

Direction exploration considered optical black glass, precision audio instruments, music notation, elastic acoustic membranes, automotive touch surfaces, light sculpture and modular signal diagrams. The direction seed assigned candidate 4, elastic membrane, carried by A. Precision and Undertow provide code-rendered alternatives for the user's requested comparison. The oscilloscope challenger contributes waveform fidelity to B; no CRT or retro visual treatment is adopted because the user requested a futuristic minimal instrument.
