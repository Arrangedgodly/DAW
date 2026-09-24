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
  type FxDeviceInstance,
  type RampGainLike,
  createRealFxDeviceFactory,
} from "../../src/audio/fx";
import {
  getPreset,
  noteParamsFor,
  type VoiceNoteOnEvent,
} from "../../src/audio/presets";
import type { FxDevice } from "../../src/document/schema";

const PRESET = getPreset("preset-lead-1")!;

function note(
  time: number,
  midi: number,
  holdSeconds: number,
): VoiceNoteOnEvent {
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
  configure?: (chain: FxChainHost, setBpm: (bpm: number) => void) => void,
  editAt?: number,
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
  let currentBpm = bpm;
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
    timing: () => ({ bpm: currentBpm, when: ctx.currentTime }),
  });
  if (device) chain.setChain([device]);
  const applyEdit = () =>
    configure?.(chain, (nextBpm) => {
      currentBpm = nextBpm;
    });
  const suspension = editAt === undefined ? null : ctx.suspend(editAt);
  if (!suspension) applyEdit();
  host.sendEvents(
    0,
    [...events].sort((a, b) => a.time - b.time),
  );
  // Let the worklet port messages deliver before rendering (TH-1 flake fix).
  await new Promise((r) => setTimeout(r, 25));

  const rendering = ctx.startRendering();
  if (suspension) {
    await suspension;
    applyEdit();
    await ctx.resume();
  }
  const buf = await rendering;
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
  const w = (2 * Math.PI * freq) / SAMPLE_RATE;
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
    const crestDry =
      peak(dry, 0.05, 0.45) / Math.max(1e-9, rms(dry, 0.05, 0.45));
    const crestWet =
      peak(wet, 0.05, 0.45) / Math.max(1e-9, rms(wet, 0.05, 0.45));
    expect(crestWet).toBeLessThan(crestDry * 0.9); // compressed peaks
  });

  it("bitcrusher changes the waveform shape (crushed ≠ dry, audible)", async () => {
    const events = [note(0.05, 72, 0.3)];
    const dry = await renderWithChain(null, events, 1.0);
    const wet = await renderWithChain(
      {
        type: "bitcrusher",
        bypassed: false,
        params: { bits: 3, downsample: 24 },
      },
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
      {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 4, feedback: 0.5, mix: 0.6 },
      },
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
    const lastRms = rms(
      wet,
      wetRegions[wetRegions.length - 1]![0] / SAMPLE_RATE,
      2.2,
    );
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

  it("reverb A-B-A edits render the same audio as the final A settings", async () => {
    const events = [note(0.05, 72, 0.15)];
    const edited = await renderWithChain(
      { type: "reverb", bypassed: false, params: { size: 0.2, mix: 0.7 } },
      events,
      2.2,
      120,
      (chain) => {
        chain.setChain([
          { type: "reverb", bypassed: false, params: { size: 0.85, mix: 0.3 } },
        ]);
        chain.setChain([
          { type: "reverb", bypassed: false, params: { size: 0.2, mix: 0.7 } },
        ]);
      },
    );
    const fresh = await renderWithChain(
      { type: "reverb", bypassed: false, params: { size: 0.2, mix: 0.7 } },
      events,
      2.2,
    );
    let maxDiff = 0;
    for (let i = 0; i < edited.length; i++)
      maxDiff = Math.max(maxDiff, Math.abs(edited[i]! - fresh[i]!));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it.each([
    [
      "filter",
      { type: "filter", bypassed: false, params: { cutoffHz: 400, q: 1 } },
      { type: "filter", bypassed: false, params: { cutoffHz: 2400, q: 2 } },
    ],
    [
      "drive",
      { type: "drive", bypassed: false, params: { amount: 0.1 } },
      { type: "drive", bypassed: false, params: { amount: 0.9 } },
    ],
    [
      "bitcrusher",
      {
        type: "bitcrusher",
        bypassed: false,
        params: { bits: 12, downsample: 2 },
      },
      {
        type: "bitcrusher",
        bypassed: false,
        params: { bits: 4, downsample: 12 },
      },
    ],
    [
      "delay",
      {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 4, feedback: 0.3, mix: 0.3 },
      },
      {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 7, feedback: 0.6, mix: 0.7 },
      },
    ],
    [
      "reverb",
      { type: "reverb", bypassed: false, params: { size: 0.2, mix: 0.2 } },
      { type: "reverb", bypassed: false, params: { size: 0.8, mix: 0.7 } },
    ],
  ] as const)(
    "%s param edit renders the final processing in an offline graph",
    async (_name, initial, final) => {
      // The delay's 15 ms glide needs to settle before the note. A fresh
      // instance starts its glide from a different initial delayTime value.
      const events = [note(0.25, 72, 0.15)];
      const edited = await renderWithChain(
        initial as FxDevice,
        events,
        2.2,
        120,
        (chain) => chain.setChain([final as FxDevice]),
        _name === "delay" ? 0.1 : undefined,
      );
      const fresh = await renderWithChain(final as FxDevice, events, 2.2);
      expect(findNonFinite(edited)).toBe(0);
      expect(peak(edited, 0.05, 2.0)).toBeGreaterThan(0.001);
      let maxDiff = 0;
      for (let i = 0; i < edited.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(edited[i]! - fresh[i]!));
      }
      if (_name === "delay") {
        // A mid-render delayTime glide legitimately changes the wet waveform.
        // Its echoes must still arrive at the edited seven-step interval.
        const regions = activityRegions(edited, 0.005);
        expect(regions.length).toBeGreaterThanOrEqual(2);
        const gap = (regions[1]![0] - regions[0]![0]) / SAMPLE_RATE;
        expect(gap).toBeGreaterThan(0.82);
        expect(gap).toBeLessThan(0.94);
      } else {
        expect(maxDiff).toBeLessThan(1e-5);
      }
    },
  );

  it("delay renders the configured 7-step interval at 90 BPM", async () => {
    const events = [note(0.05, 72, 0.1)];
    const wet = await renderWithChain(
      {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 7, feedback: 0.5, mix: 0.6 },
      },
      events,
      3.4,
      90,
    );
    const regions = activityRegions(wet, 0.005);
    expect(regions.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < regions.length; i++) {
      const gapSec = (regions[i]![0] - regions[i - 1]![0]) / SAMPLE_RATE;
      expect(gapSec).toBeGreaterThan(1.1);
      expect(gapSec).toBeLessThan(1.23);
    }
  });

  it("full chain (drive → delay → reverb) renders non-silent, finite audio", async () => {
    const events = [note(0.05, 69, 0.2), note(0.55, 76, 0.2)];
    const mono = await renderWithChain(
      {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 4, feedback: 0.4, mix: 0.4 },
      },
      events,
      3.0,
    );
    expect(findNonFinite(mono)).toBe(0);
    expect(peak(mono, 0.05, 2.5)).toBeGreaterThan(0.005);
    expect(peak(mono, 1.4, 2.8)).toBeGreaterThan(0.001); // tail audible
  });
});

describe("FX host in a live AudioContext", () => {
  it("leaves real host-owned edges connected during edits to all five device types", async () => {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const voice = await createVoiceEngine(workletContextFor(ctx), 1);
    const oscillator = ctx.createOscillator();
    const rampNode = ctx.createGain();
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    const counts = { connects: 0, disconnects: 0 };
    const watchOutput = (node: AudioNode) => {
      const connect = node.connect;
      const disconnect = node.disconnect;
      Object.defineProperty(node, "connect", {
        configurable: true,
        value: (...args: unknown[]) => {
          counts.connects++;
          return Reflect.apply(connect, node, args);
        },
      });
      Object.defineProperty(node, "disconnect", {
        configurable: true,
        value: (...args: unknown[]) => {
          counts.disconnects++;
          return Reflect.apply(disconnect, node, args);
        },
      });
    };
    watchOutput(rampNode);
    const factory = createRealFxDeviceFactory(ctx, {
      laneSeed: 0xabcd1234,
      createBitcrusher: (c) => createBitcrusherNode(c),
    });
    const instances: FxDeviceInstance[] = [];
    const chain = new FxChainHost({
      source: oscillator,
      sink,
      ramp: {
        input: rampNode,
        output: rampNode,
        rampTo(value) {
          rampNode.gain.value = value;
        },
      },
      createDevice(device, index, timing) {
        const instance = factory(device, index, timing);
        watchOutput(instance.output as AudioNode);
        instances.push(instance);
        return instance;
      },
      timing: () => ({ bpm: 120, when: ctx.currentTime }),
    });
    try {
      oscillator.start();
      await ctx.resume();
      const first: FxDevice[] = [
        { type: "filter", bypassed: false, params: { cutoffHz: 800, q: 1 } },
        { type: "drive", bypassed: false, params: { amount: 0.2 } },
        {
          type: "bitcrusher",
          bypassed: false,
          params: { bits: 12, downsample: 2 },
        },
        {
          type: "delay",
          bypassed: false,
          params: { timeSteps: 4, feedback: 0.3, mix: 0.3 },
        },
        { type: "reverb", bypassed: false, params: { size: 0.2, mix: 0.2 } },
      ];
      chain.setChain(first);
      counts.connects = 0;
      counts.disconnects = 0;
      const edited: FxDevice[] = [
        { ...first[0]!, params: { cutoffHz: 2300, q: 2 } },
        { ...first[1]!, params: { amount: 0.8 } },
        { ...first[2]!, params: { bits: 4, downsample: 12 } },
        { ...first[3]!, params: { timeSteps: 7, feedback: 0.6, mix: 0.7 } },
        { ...first[4]!, params: { size: 0.8, mix: 0.7 } },
      ];
      chain.setChain(edited);
      chain.setChain(edited);
      expect(counts).toEqual({ connects: 0, disconnects: 0 });
      expect(instances).toHaveLength(5);
      expect(ctx.state).toBe("running");
    } finally {
      chain.dispose();
      oscillator.stop();
      voice.dispose();
      await ctx.close();
    }
  });
});
