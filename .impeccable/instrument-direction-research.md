# Instrument redesign direction research

User confirmed scale-only notes and permission for a complete visual replacement.
Mode: Operate. Existing MIDI content, audio, project storage, SONG and VIZ must survive.

Mechanism: Bitbounce lets a user compose in-scale music across four instrument grids and shape each instrument's sound locally.
Scene: solo music creation at desktop, with touch editing on a phone.
Avoid: a generic neon dashboard or another miniature retro drum machine.

Grounded candidates, ordered by resonance:
1. Vector studio: contemporary digital instrument plugins; four consistent grid-led panels.
2. Spectral laboratory: audio analyzer typography and precise pitch axes; editor with adjacent measurements.
3. Digital mixing desk: channel strips and explicit control groups; four aligned instrument columns.
4. Performance light console: cue-driven state and a focused editor with instrument previews.
5. Modern tracker: dense typed musical rows with an active editing cursor; strong keyboard character.
6. Light score: contemporary musical scores and luminous performance notation; four horizontal bands share time.
7. Game-engine timeline: track hierarchy and one shared time ruler with contextual inspector.

Seed 468b71e9 assigned candidate 6. Acknowledged before authoring direction artifacts.
Light score is presented as the assigned direction, Vector studio as the pick.
The theater-lighting and iridescent-cloud challengers are competitive and appear as full alternatives.
Character goods, four-shade handheld, one-bit desktop and physical rhythm machine lose on identity and product clarity for this brief.
Their retained disciplines are explicit on the assigned card.

All directions keep the scale filter and separate viewport movement from sound transposition.
The stored degree limit 0..23 and manifest-only rendering are functional defects to replace.
One semitone step means a chromatic viewport origin delta of 1, not one scale-degree delta.
At some scale gaps a semitone step may keep the same note rows; the pitch-range readout must still advance honestly.
Octave view steps move the origin by 12, keeping note identity fixed.
The editing domain must permit negative scale degrees relative to preset roots and all valid MIDI registers.
Existing pattern notes and manifest membership must retain their playback/export meaning during migration.

No production UI changes have been made in this direction round.
