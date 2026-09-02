/**
 * HW-2 render-fingerprint wire protocol (importable from BOTH node and
 * browser tests — no node builtins here).
 */
export const RENDER_FP_PREFIX = "RENDER_FINGERPRINT_RECORD ";
export const RENDER_FP_GOLDEN_NAME = "render/reference-loop-fp-v1";
/** HW-3: byte fingerprint of the exported .wav FILE (header + samples). */
export const WAV_EXPORT_FP_GOLDEN_NAME = "wav/reference-export-fp-v1";
