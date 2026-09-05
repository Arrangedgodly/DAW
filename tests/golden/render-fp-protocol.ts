/**
 * HW-2 render-fingerprint wire protocol (importable from BOTH node and
 * browser tests — no node builtins here).
 */
export const RENDER_FP_PREFIX = "RENDER_FINGERPRINT_RECORD ";
export const RENDER_FP_GOLDEN_NAME = "render/reference-loop-fp-v1";
/** HW-3: byte fingerprint of the exported .wav FILE (header + samples). */
export const WAV_EXPORT_FP_GOLDEN_NAME = "wav/reference-export-fp-v1";
/**
 * HW-5: byte fingerprint of the exported .wav FILE for the reference project
 * WITH a non-default lane mix (drums muted, lead volume 0.75) — pins the
 * export-mix law (WAV applies volume/mute/solo) the same environment-pinned
 * way. The unmixed entry above stays the zero-drift canary for pre-mix
 * documents; this one guards the mix path against silent regressions.
 */
export const WAV_EXPORT_MIX_FP_GOLDEN_NAME = "wav/reference-export-mix-fp-v1";
/**
 * XP-1 (i3-5): byte fingerprint of the exported .wav FILE for the
 * UNEQUAL-CHAIN LCM reference (drums [2B,2B] + bass 2B + chords/lead 1B →
 * a 4-bar export cycle, the longest lane). Pins the LCM cycle law on the
 * render path (loop length = the LCM, shorter lanes wrapping within it);
 * environment-pinned like every render-derived fingerprint.
 */
export const WAV_EXPORT_LCM_FP_GOLDEN_NAME = "wav/lcm-export-fp-v1";
