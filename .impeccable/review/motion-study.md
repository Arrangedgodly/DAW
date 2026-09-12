# Motion direction study — awaiting user choice

The user rejected literal orbital placement as the final motion direction and requested something psychedelic that feels alive with MIDI. They asked to compare blended and distinct instruments before choosing. The orbit implementation remains a reference, not an approved final direction.

Open /?motion-study=1 and enter VIZ. Temporary header controls compare Fluid folds, Flowing trails and Orbit reference. Fluid uses nonlinear spatial warping through the note phrase. Trails uses lagged line deformation and elongation; it does not retain a framebuffer or add historical audio events. Blended moves the four forms through a smaller shared region; Distinct separates their moving centers. Controls are intentionally session-only, with no new saved motion preference. Both modes use real scheduled MIDI and preserve the silence cutoff. No final direction has been selected. Existing performance caveat remains; these are motion prototypes, not performance-approved replacements.

Validation: TypeScript, ESLint and production build passed. The browser phrasing/composition/fingerprint batch passed all 12 tests. Fingerprints distinguish both modes and both overlap choices; silence produces zero artwork in every study mode. The production playback journey also passed after sampling a full bar rather than an arbitrary 1.1-second window, necessary now that rests intentionally have no animation. Orbit math and persistence unit checks passed (9 tests).

## Disposition

User approved Blended and requested all comparison controls be permanent. Integrated into the normal visualizer: Fluid folds + Blended defaults, all three motion modes retained, saved motion/blending settings and reroll preservation. Prototype status above is historical.
