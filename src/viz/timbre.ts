/**
 * Lane timbre — what each instrument actually SOUNDS like, frame by frame.
 *
 * MIDI tells the visualizer that a lane played a note; it cannot tell a soft
 * pad from a plucked saw from a crushed hat. This module reads a short window
 * of one lane's post-FX, post-mix audio and reduces it to a handful of bounded
 * 0..1 descriptors the composition engine turns into gesture:
 *
 *   level       loudness envelope (dB-scaled RMS) — slow swells, fast plucks,
 *               reverb and delay tails all follow the real sound
 *   transient   positive spectral flux — sharp attacks jolt, soft attacks glide
 *   brightness  log-scaled spectral centroid — bright sounds draw finer, busier
 *   noisiness   spectral flatness — noisy/distorted sounds break into grain
 *   low/mid/high  energy balance across three bands
 *
 * ONE pure analysis path serves both sources: the live session's AnalyserNode
 * taps (time-domain reads) and the offline per-lane stems the video export
 * renders. Same window, same FFT, same smoothing, so an exported video moves
 * the way the live stage does.
 */
import type { LaneId } from "../document/schema";

export const TIMBRE_WINDOW = 1024;

export interface LaneTimbre {
  readonly level: number;
  readonly transient: number;
  readonly brightness: number;
  readonly noisiness: number;
  readonly low: number;
  readonly mid: number;
  readonly high: number;
}

export const SILENT_TIMBRE: LaneTimbre = Object.freeze({
  level: 0,
  transient: 0,
  brightness: 0.5,
  noisiness: 0,
  low: 0.34,
  mid: 0.33,
  high: 0.33,
});

/** Raw, unsmoothed descriptors of one window. */
export interface TimbreFrame {
  level: number;
  flux: number;
  brightness: number;
  noisiness: number;
  low: number;
  mid: number;
  high: number;
}

const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;

// Stage coefficients depend only on FFT size, not the lane or audio frame.
// Keep doubles so cached coefficients preserve the original calculation.
const fftStages = new Map<number, { real: Float64Array; imag: Float64Array }>();
function fftStage(size: number) {
  let stage = fftStages.get(size);
  if (!stage) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    stage = {
      real: Float64Array.from({ length: half }, (_, k) => Math.cos(step * k)),
      imag: Float64Array.from({ length: half }, (_, k) => Math.sin(step * k)),
    };
    fftStages.set(size, stage);
  }
  return stage;
}

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const real = re[i]!,
        imaginary = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = real;
      im[j] = imaginary;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stage = fftStage(size);
    for (let start = 0; start < n; start += size)
      for (let k = 0; k < half; k++) {
        const wr = stage.real[k]!,
          wi = stage.imag[k]!;
        const a = start + k,
          b = a + half;
        const tr = re[b]! * wr - im[b]! * wi,
          ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
  }
}

/**
 * Flux is measured over log-spaced bands, not raw bins: a single bin of
 * stationary noise fluctuates wildly window to window, a band of them does
 * not, so hiss reads as texture while real onsets still spike.
 */
const FLUX_BANDS = 24;

/** -54 dBFS reads as silence, -6 dBFS as full. */
const LEVEL_FLOOR_DB = -54;
const LEVEL_SPAN_DB = 48;
const BRIGHT_LOW_HZ = 150;
const BRIGHT_HIGH_HZ = 8000;

/**
 * Stateful per-window analyser: owns its FFT scratch and the previous
 * magnitude spectrum (flux is a difference between consecutive windows).
 */
export function createTimbreAnalyser(size = TIMBRE_WINDOW) {
  const re = new Float32Array(size),
    im = new Float32Array(size),
    previous = new Float32Array(FLUX_BANDS),
    bandNow = new Float32Array(FLUX_BANDS),
    bandOf = Uint8Array.from({ length: size / 2 }, (_, k) =>
      k === 0
        ? 0
        : Math.min(
            FLUX_BANDS - 1,
            Math.floor((Math.log2(k) / Math.log2(size / 2)) * FLUX_BANDS),
          ),
    ),
    hann = Float32Array.from(
      { length: size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
    );
  return {
    analyse(samples: ArrayLike<number>, sampleRate: number): TimbreFrame {
      const n = Math.min(size, samples.length),
        offset = samples.length - n;
      let power = 0;
      for (let i = 0; i < size; i++) {
        const x = i < n ? (samples[offset + i] ?? 0) : 0;
        const v = Number.isFinite(x) ? x : 0;
        power += v * v;
        re[i] = v * hann[i]!;
        im[i] = 0;
      }
      const rms = Math.sqrt(power / Math.max(1, n));
      const level = clamp01(
        (20 * Math.log10(rms + 1e-9) - LEVEL_FLOOR_DB) / LEVEL_SPAN_DB,
      );
      fft(re, im);
      const binHz = sampleRate / size;
      bandNow.fill(0);
      let total = 0,
        weighted = 0,
        flux = 0,
        low = 0,
        mid = 0,
        high = 0,
        logSum = 0,
        linSum = 0,
        flatBins = 0;
      for (let k = 1; k < size / 2; k++) {
        const mag = Math.hypot(re[k]!, im[k]!);
        const hz = k * binHz,
          p = mag * mag;
        total += mag;
        weighted += mag * hz;
        bandNow[bandOf[k]!] += mag;
        if (hz < 250) low += p;
        else if (hz < 2000) mid += p;
        else high += p;
        if (hz >= 100 && hz <= 10000) {
          logSum += Math.log(p + 1e-12);
          linSum += p;
          flatBins++;
        }
      }
      for (let b = 0; b < FLUX_BANDS; b++) {
        flux += Math.max(0, bandNow[b]! - previous[b]!);
        previous[b] = bandNow[b]!;
      }
      const bands = low + mid + high;
      const centroid = total > 0 ? weighted / total : 0;
      const flatness =
        flatBins > 0 && linSum > 0
          ? Math.exp(logSum / flatBins) / (linSum / flatBins)
          : 0;
      return {
        level,
        // Flux relative to the window's own magnitude: loud sustained notes
        // score low, onsets of any loudness score high.
        flux: clamp01(total > 1e-6 ? flux / total : 0),
        brightness:
          centroid > 0
            ? clamp01(
                Math.log2(centroid / BRIGHT_LOW_HZ) /
                  Math.log2(BRIGHT_HIGH_HZ / BRIGHT_LOW_HZ),
              )
            : 0.5,
        // Flatness is tiny for anything tonal; the root spreads it visibly.
        noisiness: clamp01(Math.sqrt(flatness) * 1.4),
        low: bands > 0 ? low / bands : 1 / 3,
        mid: bands > 0 ? mid / bands : 1 / 3,
        high: bands > 0 ? high / bands : 1 / 3,
      };
    },
  };
}

const follow = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Smooths raw frames into steady visual descriptors. Loudness uses a fast
 * attack and a slower release so the eye reads the envelope, not the ripple;
 * transients snap up and decay on their own clock; colour-like descriptors
 * (brightness, noise, bands) only update while the lane is actually sounding,
 * so a fading tail keeps the character of the note that made it.
 */
export function createLaneTimbreFollower() {
  const state = { ...SILENT_TIMBRE };
  return {
    update(frame: TimbreFrame, dt: number): LaneTimbre {
      const step = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
      state.level = follow(
        state.level,
        frame.level,
        frame.level > state.level ? 60 : 9,
        step,
      );
      // Detuned voices and chorus beat a little every window; only flux past
      // that shimmer floor counts as an attack.
      const onset = frame.level > 0.08 ? clamp01((frame.flux - 0.12) * 3.2) : 0;
      state.transient = Math.max(onset, state.transient * Math.exp(-step * 12));
      if (frame.level > 0.12) {
        const w = 14;
        state.brightness = follow(state.brightness, frame.brightness, w, step);
        state.noisiness = follow(state.noisiness, frame.noisiness, w, step);
        state.low = follow(state.low, frame.low, w, step);
        state.mid = follow(state.mid, frame.mid, w, step);
        state.high = follow(state.high, frame.high, w, step);
      }
      return { ...state };
    },
    reset(): void {
      Object.assign(state, SILENT_TIMBRE);
    },
  };
}

/** One analyser + follower per lane; lanes are created on first use. */
export function createTimbreTracker(size = TIMBRE_WINDOW) {
  const lanes = new Map<
    LaneId,
    {
      analyser: ReturnType<typeof createTimbreAnalyser>;
      follower: ReturnType<typeof createLaneTimbreFollower>;
    }
  >();
  const get = (lane: LaneId) => {
    let entry = lanes.get(lane);
    if (!entry) {
      entry = {
        analyser: createTimbreAnalyser(size),
        follower: createLaneTimbreFollower(),
      };
      lanes.set(lane, entry);
    }
    return entry;
  };
  return {
    size,
    update(
      lane: LaneId,
      samples: ArrayLike<number>,
      sampleRate: number,
      dt: number,
    ): LaneTimbre {
      const entry = get(lane);
      return entry.follower.update(
        entry.analyser.analyse(samples, sampleRate),
        dt,
      );
    },
    reset(): void {
      for (const entry of lanes.values()) entry.follower.reset();
    },
  };
}
