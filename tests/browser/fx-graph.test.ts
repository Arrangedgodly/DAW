/**
 * IM-4 browser suite — prove each FX device does its audible job through the
 * REAL graph (worklet voice engine → FX chain → lane gain → master) rendered
 * offline (D8: OfflineAudioContext + the actual worklet module). Every test
 * renders a dry (bypassed/empty chain) reference and the processed variant
 * from identical events, then asserts an audible, device-specific difference.
 */

import { describe, expect, it } from "vitest";
import { SAMPLE_RATE, findNonFinite } from "./helpers";
import {
  createBitcrusherNode,
  createVoiceEngine,
  workletContextFor,
} from "../../src/audio/voiceEngine";
import {
  FxChainHost,
  type FxConn,
  type RampGainLike,
  createRealFxDeviceFactory,
} from "../../src/audio/fx";
import { getPreset, noteParamsFor, type VoiceNoteOnEvent } from "../../src/audio/presets";
import type { FxDevice } from "../../src/document/schema";

const PRESET = getPreset("preset-lead-1")!;

function note(time: number, midi: number, holdSeconds: number): VoiceNoteOnEvent {
  return noteParamsFor(PRESET, { time, midi, holdSeconds, seedSalt: 7 });
}

/**
 * Render one lane through the real graph: voice-engine worklet → FxChainHost
 * (real device factory; empty chain = transparent dry reference) → lane gain
 * → master → destination. Mirrors Session's per-lane wiring (IM-4).
 */
async function renderWithChain(
  device: FxDevice | null,
  events: readonly VoiceNoteOnEvent[],
  duration: number,
  bpm = 120,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(duration * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const host = await createVoiceEngine(workletContextFor(ctx), 1);
  const laneGain = ctx.createGain();
  laneGain.connect(master);
  const rampNode = ctx.createGain();
  const ramp: RampGainLike = {
    input: rampNode,
    output: rampNode,
    rampTo(value, when, seconds) {
      const g = rampNode.gain;
      g.cancelScheduledValues(when);
      g.setValueAtTime(1 - value, when);
      g.linearRampToValueAtTime(value, when + seconds);
    },
  };
  const chain = new FxChainHost({
    source: {
      connect: (d: FxConn) => host.connect(0, d as AudioNode),
      disconnect: () => undefined,
    },
    sink: laneGain,
    ramp,
    createDevice: createRealFxDeviceFactory(ctx, {
      laneSeed: 0xabcd1234,
      createBitcrusher: (c) => createBitcrusherNode(c),
    }),
    timing: () => ({ bpm, when: ctx.currentTime }),
  });
  if (device) chain.setChain([device]);
  host.sendEvents(0, [...events].sort((a, b) => a.time - b.time));
  // Let the worklet port messages deliver before rendering (TH-1 flake fix).
  await new Promise((r) => setTimeout(r, 25));

  const buf = await ctx.startRendering();
  host.dispose();
  chain.dispose();
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const mono = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) mono[i] = (l[i]! + r[i]!) / 2;
  return mono;
}

function rms(mono: Float32Array, fromSec: number, toSec: number): number {
  const a = Math.floor(fromSec * SAMPLE_RATE);
  const b = Math.min(mono.length, Math.ceil(toSec * SAMPLE_RATE));
  let s = 0;
  let n = 0;
  for (let i = a; i < b; i++) {
    s += mono[i]! * mono[i]!;
    n++;
  }
  return n > 0 ? Math.sqrt(s / n) : 0;
}

function peak(mono: Float32Array, fromSec: number, toSec: number): number {
  const a = Math.floor(fromSec * SAMPLE_RATE);
  const b = Math.min(mono.length, Math.ceil(toSec * SAMPLE_RATE));
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(mono[i]!));
  return p;
}

/** Goertzel magnitude at `freq` over the window (single-bin DFT probe). */
function toneEnergy(
  mono: Float32Array,
  freq: number,
  fromSec: number,
  toSec: number,
): number {
  const a = Math.floor(fromSec * SAMPLE_RATE);
  const b = Math.min(mono.length, Math.ceil(toSec * SAMPLE_RATE));
  const w = 2 * Math.PI * freq / SAMPLE_RATE;
  let real = 0;
  let imag = 0;
  for (let i = a; i < b; i++) {
    const t = (i - a) * w;
    real += mono[i]! * Math.cos(t);
    imag += mono[i]! * Math.sin(t);
  }
  return Math.sqrt(real * real + imag * imag) / Math.max(1, b - a);
}

/** Contiguous activity regions (amplitude > floor) — echo/onset detector. */
function activityRegions(
  mono: Float32Array,
  threshold: number,
  mergeGapSec = 0.01,
): [number, number][] {
  const regions: [number, number][] = [];
  const gap = Math.floor(mergeGapSec * SAMPLE_RATE);
  let start = -1;
  let silence = 0;
  for (let i = 0; i < mono.length; i++) {
    const active = Math.abs(mono[i]!) > threshold;
    if (active) {
      if (start < 0) start = i;
      silence = 0;
    } else if (start >= 0) {
      silence++;
      if (silence >= gap) {
        regions.push([start, i - silence]);
        start = -1;
        silence = 0;
      }
    }
  }
  if (start >= 0) regions.push([start, mono.length - 1]);
  return regions;
}

describe("FX device graph (real offline renders)", () => {
  it("filter (lowpass) audibly attenuates above cutoff", async () => {
    const events = [note(0.05, 96, 0.3)]; // ~2093 Hz pulse
    const dry = await renderWithChain(null, events, 1.0);
    const wet = await renderWithChain(
      { type: "filter", bypassed: false, params: { cutoffHz: 400, q: 1 } },
      events,
      1.0,
    );
    expect(findNonFinite(wet)).toBe(0);
    expect(peak(wet, 0.05, 0.5)).toBeGreaterThan(0.001); // audible
    // Fundamental at 2093 Hz is ~2.4 octaves above the 400 Hz corner.
    const dryF = toneEnergy(dry, 2093, 0.05, 0.45);
    const wetF = toneEnergy(wet, 2093, 0.05, 0.45);
    expect(wetF).toBeLessThan(dryF * 0.15); // ≥ ~16 dB down
    expect(rms(wet, 0.05, 0.45)).toBeLessThan(rms(dry, 0.05, 0.45) * 0.5);
  });

  it("drive reshapes the waveform (crest factor drops, stays audible)", async () => {
    const events = [note(0.05, 69, 0.3)];
    const dry = await renderWithChain(null, events, 1.0);
    const wet = await renderWithChain(
      { type: "drive", bypassed: false, params: { amount: 1 } },
      events,
      1.0,
    );
    expect(findNonFinite(wet)).toBe(0);
    expect(peak(wet, 0.05, 0.45)).toBeGreaterThan(0.01);
    const crestDry = peak(dry, 0.05, 0.45) / Math.max(1e-9, rms(dry, 0.05, 0.45));
    const crestWet = peak(wet, 0.05, 0.45) / Math.max(1e-9, rms(wet, 0.05, 0.45));
    expect(crestWet).toBeLessThan(crestDry * 0.9); // compressed peaks
  });

  it("bitcrusher changes the waveform shape (crushed ≠ dry, audible)", async () => {
    const events = [note(0.05, 72, 0.3)];
    const dry = await renderWithChain(null, events, 1.0);
    const wet = await renderWithChain(
      { type: "bitcrusher", bypassed: false, params: { bits: 3, downsample: 24 } },
      events,
      1.0,
    );
    expect(findNonFinite(wet)).toBe(0);
    expect(peak(wet, 0.05, 0.45)).toBeGreaterThan(0.01);
    // Sample-wise difference energy: quantization + decimation are audible.
    const a = Math.floor(0.05 * SAMPLE_RATE);
    const b = Math.ceil(0.45 * SAMPLE_RATE);
    let diff = 0;
    for (let i = a; i < b; i++) diff += (wet[i]! - dry[i]!) ** 2;
    diff = Math.sqrt(diff / (b - a));
    expect(diff).toBeGreaterThan(rms(dry, 0.05, 0.45) * 0.1);
  });

  it("synced delay produces echoes at the musical interval", async () => {
    // 1/4 note @ 120 BPM = 0.5 s; note at 0.05 s.
    const events = [note(0.05, 72, 0.1)];
    const dry = await renderWithChain(null, events, 2.2);
    const wet = await renderWithChain(
      { type: "delay", bypassed: false, params: { timeSteps: 4, feedback: 0.5, mix: 0.6 } },
      events,
      2.2,
    );
    expect(findNonFinite(wet)).toBe(0);
    const dryRegions = activityRegions(dry, 0.005);
    const wetRegions = activityRegions(wet, 0.005);
    expect(dryRegions.length).toBe(1); // dry = one note only
    expect(wetRegions.length).toBeGreaterThanOrEqual(3); // note + ≥2 echoes
    // Echo spacing ≈ 0.5 s (±40 ms).
    for (let i = 1; i < wetRegions.length; i++) {
      const gapSec = (wetRegions[i]![0] - wetRegions[i - 1]![0]) / SAMPLE_RATE;
      expect(gapSec).toBeGreaterThan(0.44);
      expect(gapSec).toBeLessThan(0.56);
    }
    // Echoes decay (feedback < 1).
    const lastRms = rms(wet, wetRegions[wetRegions.length - 1]![0] / SAMPLE_RATE, 2.2);
    const firstRms = rms(wet, 0.05, 0.3);
    expect(lastRms).toBeLessThan(firstRms);
  });

  it("reverb extends the tail after the note ends", async () => {
    const events = [note(0.05, 72, 0.15)];
    const dry = await renderWithChain(null, events, 2.4);
    const wet = await renderWithChain(
      { type: "reverb", bypassed: false, params: { size: 0.9, mix: 0.7 } },
      events,
      2.4,
    );
    expect(findNonFinite(wet)).toBe(0);
    expect(peak(wet, 0.05, 0.4)).toBeGreaterThan(0.005);
    // Window well past the dry note (dead silence in the dry render).
    const tailDry = rms(dry, 0.6, 2.2);
    const tailWet = rms(wet, 0.6, 2.2);
    expect(tailWet).toBeGreaterThan(Math.max(tailDry * 20, 1e-4));
    // And the tail eventually decays away (IR ≤ 1.5 s).
    expect(rms(wet, 2.0, 2.35)).toBeLessThan(rms(wet, 0.6, 0.9) * 0.2);
  });

  it("full chain (drive → delay → reverb) renders non-silent, finite audio", async () => {
    const events = [note(0.05, 69, 0.2), note(0.55, 76, 0.2)];
    const mono = await renderWithChain(
      { type: "delay", bypassed: false, params: { timeSteps: 4, feedback: 0.4, mix: 0.4 } },
      events,
      3.0,
    );
    expect(findNonFinite(mono)).toBe(0);
    expect(peak(mono, 0.05, 2.5)).toBeGreaterThan(0.005);
    expect(peak(mono, 1.4, 2.8)).toBeGreaterThan(0.001); // tail audible
  });
});
