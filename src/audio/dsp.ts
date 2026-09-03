/**
 * Pure chiptune DSP primitives (IM-3, RES-3).
 *
 * These functions are the CANONICAL specification of the voice-engine DSP.
 * src/audio/worklets/voiceEngine.js carries a hand-inlined copy (a worklet
 * loaded via `new URL(..., import.meta.url)` is served/emitted as a raw asset
 * and cannot import this module); tests/worklet-parity.test.ts imports the
 * worklet through its test seam and asserts both copies produce identical
 * values, so divergence fails CI. If you change anything here, change the
 * worklet twin (and vice versa).
 *
 * No DOM, no Web Audio, no Math.random — deterministic by contract (D2–D4).
 */

/** Absolute cap on oscillator frequency (NES-ish top note, ~B9 minus a hair). */
export const MAX_VOICE_FREQ = 12400;

/** De-click fade used when stealing a busy voice (2–8 ms window per RES-3). */
export const STEAL_FADE_SECONDS = 0.004;

/** MIDI note number → frequency in Hz (A4 = 440). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * PolyBLEP correction (one edge), for a naive rectangular pulse.
 * `t` is the phase in [0,1) measured just past an edge; `dt` is the period of
 * the edge in phase units (frequency / sampleRate). Returns a value in [-1,0]
 * or [0,1] that, added to the naive ±1 step, cancels the sinc ripple.
 */
export function polyblep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return 2 * x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + 2 * x + 1;
  }
  return 0;
}

/** Naive pulse wave sample in {-1, +1} for phase [0,1) and duty (0,1). */
export function pulseValue(phase: number, duty: number): number {
  return phase < duty ? 1 : -1;
}

/**
 * Band-limited pulse sample: naive threshold plus PolyBLEP corrections at the
 * rising edge (phase 0) and the falling edge (phase = duty).
 * `dt` = freq / sampleRate.
 */
export function pulseSample(phase: number, duty: number, dt: number): number {
  let v = pulseValue(phase, duty);
  v += polyblep(phase, dt);
  const tFall = phase - duty + 1; // phase past the falling edge, [1-duty, 1+... )
  v -= tFall < 1 ? polyblep(tFall, dt) : polyblep(tFall - 1, dt);
  return v;
}

/**
 * NES-style 32-step quantized triangle. Phase [0,1) → 32 discrete levels
 * spanning [-1, +1]: descends over steps 0..15, holds the minimum across the
 * 15/16 boundary, ascends back to +1 at step 31 (which wraps to step 0's +1).
 */
export function triangleValue(phase: number): number {
  let phase01 = phase % 1;
  if (phase01 < 0) phase01 += 1;
  const idx = Math.min(31, (phase01 * 32) | 0);
  const t = idx < 16 ? 15 - idx : idx - 16;
  return (2 * t) / 15 - 1;
}

/**
 * One clock of the NES APU noise channel's 15-bit LFSR (nesdev APU_Noise).
 * Long mode taps bit 1, short mode taps bit 6. State is never 0
 * (seeds 1..32767); long mode is maximal-length (period 32767).
 * Returns the NEXT state; the audible output bit is bit 0.
 */
export function lfsrNext(reg: number, shortMode: boolean): number {
  const feedback = (reg & 1) ^ ((reg >> (shortMode ? 6 : 1)) & 1);
  return ((feedback << 14) | (reg >>> 1)) & 0x7fff;
}

/** LFSR output level for a register state: bit 0 → ±1. */
export function lfsrOutput(reg: number): number {
  return reg & 1 ? -1 : 1;
}

/**
 * Ideal ADSR envelope level at `t` seconds after note-on.
 * Linear attack to 1, linear decay to `sustain` (0..1), hold, linear release
 * to 0 starting at `hold` seconds. Zero-length segments are legal (the level
 * jumps at that boundary). Returns exactly 0 once release completes.
 */
export function adsrLevel(
  t: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  hold: number,
): number {
  if (t < 0) return 0;
  if (t < attack) return attack > 0 ? t / attack : 1;
  if (t < attack + decay) {
    return decay > 0 ? 1 - ((1 - sustain) * (t - attack)) / decay : sustain;
  }
  if (t < hold) return sustain;
  const rt = t - hold;
  if (rt < release) {
    return release > 0 ? sustain * (1 - rt / release) : 0;
  }
  return 0;
}

// --- Karplus–Strong plucked string (PS-1, RES-10 synthesis half) ------------
//
// Public-domain algorithm (Karplus & Strong, 1983): a delay line seeded with
// a noise burst, refilled each pass with a damped two-point average of
// itself — the loop rings at sampleRate/len Hz and darkens as it decays,
// which is the plucked-string sound. State lives in the CALLER (the worklet
// voice owns a preallocated Float32Array; allocation happens at init, never
// in process() — the PS-1 plan law).

/**
 * Damping factor for a target decay time. With this damp, the loop's
 * amplitude decays ≈ exp(-t / decaySeconds), independent of loop length
 * (each slot is rewritten once per period, so per-period gain ≈ damp).
 */
export function karplusDamp(
  loopLen: number,
  sampleRate: number,
  decaySeconds: number,
): number {
  if (decaySeconds <= 0) return 0;
  return Math.exp(-loopLen / (sampleRate * decaySeconds));
}

/**
 * Seed-fill `line[0..len)` with a deterministic LFSR noise burst (the pluck
 * excitation). `seed` is the note's LFSR seed (1..32767); the voice's own
 * LFSR register is untouched (local copy).
 */
export function karplusFill(
  line: Float32Array,
  len: number,
  seed: number,
): void {
  let reg = seed >= 1 && seed <= 32767 ? seed : 1;
  for (let i = 0; i < len; i++) {
    line[i] = lfsrOutput(reg);
    reg = lfsrNext(reg, false);
  }
}

/**
 * One Karplus–Strong sample: output the slot at `pos`, refill it with the
 * damped average of it and its neighbor. The caller advances `pos` by one
 * (wrapping at `len`) per sample. Mutates `line` in place (the delay line
 * IS the state).
 */
export function karplusStep(
  line: Float32Array,
  pos: number,
  len: number,
  damp: number,
): number {
  const next = pos + 1 === len ? 0 : pos + 1;
  const out = line[pos];
  line[pos] = damp * 0.5 * (out + line[next]);
  return out;
}

/**
 * Deterministic per-note LFSR seed (1..32767) derived from the preset's base
 * seed plus note coordinates. Same note in same pass → same noise, always.
 */
export function noteSeed(baseSeed: number, a: number, b: number): number {
  let h = (baseSeed | 0) >>> 0;
  h = (Math.imul(h ^ (a | 0), 0x9e3779b1) + 0x6d2b79f5) >>> 0;
  h = (Math.imul(h ^ (b | 0), 0x85ebca6b) ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h, 0xc2b2ae35) ^ (h >>> 16)) >>> 0;
  return (h % 32767) + 1;
}
