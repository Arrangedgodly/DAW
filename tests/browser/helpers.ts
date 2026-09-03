/**
 * Shared helpers for the browser-mode audio suite (TH-1, D8/RES-7).
 *
 * Everything here runs in a real Chromium page served by the vite pipeline:
 * OfflineAudioContext + the real AudioWorklet module (addModule works
 * offline), so onset assertions run against the true rendering path.
 */

import { type VoiceNoteOnEvent } from "../../src/audio/presets";
import {
  createVoiceEngine,
  workletContextFor,
  type VoiceEngineHost,
} from "../../src/audio/voiceEngine";

export const SAMPLE_RATE = 44100;

export interface OfflineRenderOptions {
  /** Seconds of silence before the first event (avoids block-boundary 0). */
  readonly startTime: number;
  /** Total render length in seconds. */
  readonly duration: number;
  /** Lane event lists (absolute-time, sorted). */
  readonly lanes: readonly (readonly VoiceNoteOnEvent[])[];
  /** Optional per-beat metronome click synthesis (real oscillator path). */
  readonly metronome?: {
    readonly beats: readonly number[];
    readonly downbeats: ReadonlySet<number>;
  };
}

export interface OfflineRenderResult {
  /** Mono mixdown of both channels. */
  readonly mono: Float32Array;
  readonly sampleRate: number;
}

/** Render lane events through the REAL worklet graph via OfflineAudioContext. */
export async function renderOffline(
  opts: OfflineRenderOptions,
): Promise<OfflineRenderResult> {
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(opts.duration * SAMPLE_RATE),
    SAMPLE_RATE,
  );

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  let host: VoiceEngineHost | null = null;
  if (opts.lanes.some((lane) => lane.length > 0)) {
    host = await createVoiceEngine(workletContextFor(ctx), opts.lanes.length);
    for (let i = 0; i < opts.lanes.length; i++) {
      host.connect(i, master);
      // Loop-relative times in → absolute times out (day-one contract:
      // the full event list is preloaded before startRendering()).
      host.sendEvents(
        i,
        opts.lanes[i].map((e) => ({ ...e, time: e.time + opts.startTime })),
      );
    }
  }

  if (host) {
    // Let the postMessage to each worklet's port actually deliver before
    // rendering starts — startRendering() immediately after sendEvents()
    // races message delivery in Chromium and yields a silent render
    // (observed flake; the settle makes it deterministic).
    await new Promise((r) => setTimeout(r, 25));
  }

  if (opts.metronome) {
    for (const beatTime of opts.metronome.beats) {
      const when = opts.startTime + beatTime;
      const down = opts.metronome.downbeats.has(beatTime);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = down ? 1760 : 1175;
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(down ? 0.5 : 0.3, when + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(env);
      env.connect(master);
      osc.start(when);
      osc.stop(when + 0.06);
    }
  }

  const buffer = await ctx.startRendering();
  host?.dispose();

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
  return { mono, sampleRate: buffer.sampleRate };
}

/**
 * Onset detection by amplitude regions: a contiguous "active" region (|x| >
 * threshold) with gaps shorter than `mergeGapSamples` merged together. The
 * onset of a region is its first sample index — i.e. the first sample where
 * the note is audible, which is exactly what the ±one-render-quantum budget
 * (D8 layer 2) constrains.
 */
export function detectOnsets(
  mono: Float32Array,
  opts: { threshold?: number; mergeGapSamples?: number } = {},
): number[] {
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  const threshold = opts.threshold ?? Math.max(peak * 0.05, 1e-5);
  const mergeGap = opts.mergeGapSamples ?? Math.floor(0.002 * SAMPLE_RATE);

  const onsets: number[] = [];
  let inRegion = false;
  let silence = 0;
  for (let i = 0; i < mono.length; i++) {
    const active = Math.abs(mono[i]) > threshold;
    if (active) {
      if (!inRegion) {
        onsets.push(i);
        inRegion = true;
      }
      silence = 0;
    } else if (inRegion) {
      silence++;
      if (silence >= mergeGap) {
        inRegion = false;
        silence = 0;
      }
    }
  }
  return onsets;
}

/** Scan both a buffer for NaN / Infinity contamination (denormal guard). */
export function findNonFinite(mono: Float32Array): number {
  let count = 0;
  for (let i = 0; i < mono.length; i++) {
    if (!Number.isFinite(mono[i])) count++;
  }
  return count;
}

/**
 * Shared NaN/Inf + peak sanity check (HW-2): every channel of a render (or a
 * single mono buffer) must be entirely finite and have a non-silent, non-
 * runaway peak. Returns the peak amplitude. Reused across render suites.
 */
export function assertCleanAudio(
  channels: readonly Float32Array[] | Float32Array,
  label = "audio",
  opts: { minPeak?: number; maxPeak?: number } = {},
): number {
  const chans = channels instanceof Float32Array ? [channels] : channels;
  let peak = 0;
  for (let c = 0; c < chans.length; c++) {
    for (let i = 0; i < chans[c].length; i++) {
      const v = chans[c][i];
      if (!Number.isFinite(v)) {
        throw new Error(`${label}: channel ${c} sample ${i} is ${v}`);
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  if (peak < (opts.minPeak ?? 1e-4)) {
    throw new Error(`${label}: silent render (peak ${peak})`);
  }
  if (peak > (opts.maxPeak ?? 16)) {
    throw new Error(`${label}: runaway peak ${peak}`);
  }
  return peak;
}

/**
 * SHA-256 over the raw Float32 bytes of all channels, concatenated (HW-2
 * render fingerprint). ENV-PINNED by construction (RES-7: cross-platform
 * render hashes are not stable — SIMD/libm differ); only meaningful as a
 * canary against unintended drift under the same pinned Chromium, never as a
 * cross-engine golden.
 */
export async function hashChannelsHex(
  channels: readonly Float32Array[],
): Promise<string> {
  const total = channels.reduce((n, ch) => n + ch.length, 0);
  const merged = new Float32Array(total);
  let at = 0;
  for (const ch of channels) {
    merged.set(ch, at);
    at += ch.length;
  }
  const bytes = new Uint8Array(
    merged.buffer,
    merged.byteOffset,
    merged.byteLength,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 over arbitrary bytes (HW-3 exported-file fingerprints). */
export async function hashBytesHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
