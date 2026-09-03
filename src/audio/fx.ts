/**
 * FX device graph (IM-4, RES-4 / D2–D4).
 *
 * Layer 1 (pure, node-testable): seeded procedural IR rendering, musical
 * delay-time math, drive-curve shaping, tail-budget computation, bitcrusher
 * quantization. No DOM, no Web Audio, no Math.random — deterministic by
 * contract, so online (real AudioContext) and offline (OfflineAudioContext)
 * renders fed the same seed and document produce identical graphs (IM-5
 * depends on this).
 *
 * Layer 2 (node builders): one `create*Device(ctx, params)` per device type
 * following the shared contract
 *   `create(ctx, params) → { input, output, setParams, dispose }`
 * Each device is a self-contained two-terminal subgraph; `bypass` is NEVER a
 * dead node in the path — the chain host (FxChainHost) reconnects around
 * bypassed devices.
 *
 * Layer 3 (FxChainHost): ordered per-lane chain source → ramp-gain →
 * [devices…] → sink with glitch-free edits:
 *   - Param-only edits ride AudioParam ramps (no topology change).
 *   - Bypass toggles are reconnect-around (device instances stay alive).
 *   - Any structural change (add/remove/reorder = different type sequence)
 *     REBUILDS the chain in the new order — chosen over relinking because
 *     devices are cheap native subgraphs (≤3 per lane) and a fresh build
 *     cannot half-apply; the rebuild is wrapped in a 3 ms fade-out /
 *     8 ms fade-in on the chain-head ramp gain to avoid clicks.
 */

import type { FxDevice } from "../document/schema";
import { secondsPerStep } from "./time";

export type { FxDevice } from "../document/schema";

// ---------------------------------------------------------------------------
// Pure: seeded PRNG + procedural impulse response
// ---------------------------------------------------------------------------

/** xorshift32 — tiny, deterministic, seed-derivable PRNG (day-one contract). */
export function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

/** [0,1) noise sample from a xorshift32 stream. */
export function noise01(rand: () => number): number {
  return rand() / 4294967296;
}

export const REVERB_MIN_SECONDS = 0.7;
export const REVERB_MAX_SECONDS = 1.5;

/** Reverb decay length for a 0..1 size knob: 0.7 s … 1.5 s (RES-4 cap). */
export function reverbSeconds(size: number): number {
  const s = Math.min(1, Math.max(0, size));
  return REVERB_MIN_SECONDS + (REVERB_MAX_SECONDS - REVERB_MIN_SECONDS) * s;
}

export interface ImpulseResponse {
  /** Two decorrelated channels (L/R) of the same decay envelope. */
  readonly channels: readonly [
    Float32Array<ArrayBuffer>,
    Float32Array<ArrayBuffer>,
  ];
  readonly lengthSeconds: number;
}

/**
 * Seeded procedural stereo IR (pure): white noise (seeded) × exponential
 * decay, two decorrelated channels derived from the base seed. Each channel
 * is scaled to a fixed L2 norm so ConvolverNode `normalize=false` yields a
 * predictable level and the wet gain stays a pure mix control. Deterministic
 * given (seed, size, sampleRate) — identical online and offline.
 */
export function renderImpulseResponse(opts: {
  readonly seed: number;
  readonly size: number;
  readonly sampleRate: number;
}): ImpulseResponse {
  const length = Math.max(
    1,
    Math.round(reverbSeconds(opts.size) * opts.sampleRate),
  );
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  // Decorrelate L/R with derived seeds (seed xor channel tag).
  const left = xorshift32(opts.seed ^ 0x2545f491);
  const right = xorshift32(opts.seed ^ 0x9e3779b9);
  const decay = 3 / length; // −26 dB at IR end
  for (let c = 0; c < 2; c++) {
    const rand = c === 0 ? left : right;
    const ch = channels[c];
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const v = (noise01(rand) * 2 - 1) * Math.exp(-decay * i);
      ch[i] = v;
      energy += v * v;
    }
    // Unit L2 norm × head gain: fixed energy regardless of length.
    const norm = 0.5 / Math.sqrt(energy);
    for (let i = 0; i < length; i++) ch[i] *= norm;
  }
  return { channels, lengthSeconds: length / opts.sampleRate };
}

// ---------------------------------------------------------------------------
// Pure: musical delay-time math (units ↔ steps ↔ seconds via time.ts)
// ---------------------------------------------------------------------------

export type MusicalDelayUnitId = "1/8" | "1/8." | "1/4" | "1/2";

/** Named musical delay units in 16th-step counts (time.ts grid). */
export const MUSICAL_DELAY_UNITS: readonly {
  readonly id: MusicalDelayUnitId;
  readonly steps: number;
}[] = [
  { id: "1/8", steps: 2 },
  { id: "1/8.", steps: 3 }, // dotted eighth
  { id: "1/4", steps: 4 },
  { id: "1/2", steps: 8 },
];

export function musicalDelaySteps(unit: MusicalDelayUnitId): number {
  const entry = MUSICAL_DELAY_UNITS.find((u) => u.id === unit);
  if (!entry) throw new Error(`musicalDelaySteps: unknown unit ${unit}`);
  return entry.steps;
}

/** Nearest musical unit for a step count (UI helper; exact when in table). */
export function nearestMusicalDelayUnit(steps: number): MusicalDelayUnitId {
  let best = MUSICAL_DELAY_UNITS[0];
  for (const u of MUSICAL_DELAY_UNITS) {
    if (Math.abs(u.steps - steps) < Math.abs(best.steps - steps)) best = u;
  }
  return best.id;
}

/** DelayNode hard cap (RES-4): the sync delay is built with maxDelay 2 s. */
export const DELAY_MAX_SECONDS = 2;

/** Document `timeSteps` (16ths) → seconds at `bpm`, clamped to the 2 s cap. */
export function delaySeconds(timeSteps: number, bpm: number): number {
  return Math.min(DELAY_MAX_SECONDS, timeSteps * secondsPerStep(bpm));
}

// ---------------------------------------------------------------------------
// Pure: drive curve + bitcrusher quantization (worklet twin in voiceEngine.js)
// ---------------------------------------------------------------------------

/**
 * tanh saturation, transparent at amount 0 and unity-gained at |x|=1 for
 * every amount: y = x + a·(tanh(k·x)/tanh(k) − x), k = 1 + 15a.
 */
export function driveShaper(x: number, amount: number): number {
  const a = Math.min(1, Math.max(0, amount));
  const k = 1 + 15 * a;
  const shaped = Math.tanh(k * x) / Math.tanh(k);
  return x + a * (shaped - x);
}

/** Curve cache key granularity (64 buckets is inaudible vs continuous). */
const DRIVE_CURVE_BUCKETS = 64;
const DRIVE_CURVE_LENGTH = 1024;
const driveCurveCache = new Map<number, Float32Array<ArrayBuffer>>();

/** Cached WaveShaper curve for a drive amount 0..1 (bucketed key). */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(
    Math.min(1, Math.max(0, amount)) * DRIVE_CURVE_BUCKETS,
  );
  let curve = driveCurveCache.get(key);
  if (!curve) {
    curve = new Float32Array(DRIVE_CURVE_LENGTH);
    const a = key / DRIVE_CURVE_BUCKETS;
    for (let i = 0; i < DRIVE_CURVE_LENGTH; i++) {
      curve[i] = driveShaper((i / (DRIVE_CURVE_LENGTH - 1)) * 2 - 1, a);
    }
    driveCurveCache.set(key, curve);
  }
  return curve;
}

/** Bitcrusher quantization (canonical; twin lives in the worklet). */
export function quantizeBits(x: number, bits: number): number {
  const levels = Math.pow(2, Math.min(16, Math.max(1, bits))) - 1;
  return (Math.round(((x + 1) / 2) * levels) / levels) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Master soft-clip (D2–D4 committed design; landed with PX-1 because the
// demo is the first genuinely dense 4-lane mix — per-lane voices sum well
// past ±1 with no cross-lane headroom management, so the master needs the
// limiter the plan always promised). Shared by the live session master and
// the offline render master — IDENTICAL node + curve in both (parity law).
// ---------------------------------------------------------------------------

/** Output ceiling: the curve's asymptote (|y| ≤ CEILING for every x). */
export const SOFT_CLIP_CEILING = 0.9;
/** Below this level the curve is EXACTLY the identity (transparent knee). */
export const SOFT_CLIP_THRESHOLD = 0.7;

/**
 * Threshold soft-knee limiter: identity below THRESHOLD, then a tanh shoulder
 * that asymptotes at CEILING.
 * - Bit-transparent for conversational levels (everything ≤ 0.7 untouched);
 * - odd/monotonic (no flat zones, transients keep their order);
 * - |y| ≤ 0.9 for EVERY input, so a hot mix can never hard-clip the export.
 */
export function softClip(x: number): number {
  const t = SOFT_CLIP_THRESHOLD;
  const c = SOFT_CLIP_CEILING;
  const ax = Math.abs(x);
  if (ax <= t) return x;
  return Math.sign(x) * (t + (c - t) * Math.tanh((ax - t) / (c - t)));
}

const SOFT_CLIP_CURVE_LENGTH = 1024;
let softClipCurveCache: Float32Array<ArrayBuffer> | null = null;

/** Cached WaveShaper curve for the master soft-clip (deterministic). */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  if (!softClipCurveCache) {
    softClipCurveCache = new Float32Array(SOFT_CLIP_CURVE_LENGTH);
    for (let i = 0; i < SOFT_CLIP_CURVE_LENGTH; i++) {
      softClipCurveCache[i] = softClip(
        (i / (SOFT_CLIP_CURVE_LENGTH - 1)) * 2 - 1,
      );
    }
  }
  return softClipCurveCache;
}

/**
 * The master soft-clip node: master gain → THIS → destination, on both the
 * live session path (engine/session.ts ensureMaster) and the offline render
 * path (audio/render.ts). oversample "none" DELIBERATELY: with 2x the
 * output downsampling filter rings above the curve's endpoints (measured
 * ~18% overshoot), which would defeat the ceiling; the 1024-point curve is
 * linearly interpolated by the platform, so "none" stays exactly bounded.
 */
export function createSoftClipNode(ctx: {
  createWaveShaper(): WaveShaperNode;
}): WaveShaperNode {
  const node = ctx.createWaveShaper();
  node.oversample = "none";
  node.curve = softClipCurve();
  return node;
}

// ---------------------------------------------------------------------------
// Pure: export tail budget (consumed by IM-5)
// ---------------------------------------------------------------------------

/**
 * Samples of tail the FX graph rings after the last note: per lane the max
 * over devices of (reverb IR length + 50 ms guard | delay time × 6 decays).
 * Pure; IM-5 adds this to the render length and folds the tail into the loop.
 */
export function computeTailSamples(
  fxChains: readonly (readonly FxDevice[])[],
  bpm: number,
  sampleRate: number,
): number {
  let maxSeconds = 0;
  for (const chain of fxChains) {
    for (const device of chain) {
      if (device.bypassed) continue;
      if (device.type === "reverb") {
        maxSeconds = Math.max(
          maxSeconds,
          reverbSeconds(device.params.size) + 0.05,
        );
      } else if (device.type === "delay") {
        maxSeconds = Math.max(
          maxSeconds,
          delaySeconds(device.params.timeSteps, bpm) * 6,
        );
      }
    }
  }
  return Math.ceil(maxSeconds * sampleRate);
}

// ---------------------------------------------------------------------------
// Device contract + node surface
// ---------------------------------------------------------------------------

/** Minimal connectable node surface (typed seam; fakes in unit tests). */
export interface FxConn {
  connect(destination: FxConn): unknown;
  disconnect(...args: unknown[]): unknown;
}

export interface FxParam {
  readonly value: number;
  setValueAtTime(value: number, startTime: number): void;
  setTargetAtTime(
    target: number,
    startTime: number,
    timeConstant: number,
  ): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(cancelTime: number): void;
}

/** Sync info handed to setParams for tempo-synced devices (delay). */
export interface FxTiming {
  readonly bpm: number;
  readonly when: number;
  /** Hard-quantize on bar lines instead of the τ=15 ms glide. */
  readonly hard?: boolean;
}

export interface FxDeviceInstance {
  readonly kind: FxDevice["type"];
  readonly input: FxConn;
  readonly output: FxConn;
  setParams(device: FxDevice, timing?: FxTiming): void;
  /** Tempo sync outside a param edit (bpm change while playing). */
  syncBpm?(timing: FxTiming): void;
  dispose(): void;
}

/** τ for tempo-synced delayTime glides (RES-4: 0.01–0.02 s). */
export const DELAY_SYNC_TAU = 0.015;

// --- filter -----------------------------------------------------------------

export function createFilterDevice(
  ctx: BaseAudioContext,
  device: Extract<FxDevice, { type: "filter" }>,
): FxDeviceInstance {
  const node = ctx.createBiquadFilter();
  node.type = (device.params.kind ?? "lowpass") as BiquadFilterType;
  const apply = (d: typeof device, when: number) => {
    // a-rate params: automated ramps, never instant jumps (sample-accurate
    // sweeps are free on BiquadFilterNode — RES-4).
    node.frequency.setTargetAtTime(d.params.cutoffHz, when, 0.01);
    node.Q.setTargetAtTime(d.params.q, when, 0.01);
  };
  apply(device, ctx.currentTime);
  return {
    kind: "filter",
    input: node,
    output: node,
    setParams(d) {
      if (d.type !== "filter") return;
      if (d.params.kind) node.type = d.params.kind as BiquadFilterType;
      apply(d, ctx.currentTime);
    },
    dispose() {
      node.disconnect();
    },
  };
}

// --- drive ------------------------------------------------------------------

export function createDriveDevice(
  ctx: BaseAudioContext,
  device: Extract<FxDevice, { type: "drive" }>,
): FxDeviceInstance {
  const node = ctx.createWaveShaper();
  node.oversample = "2x";
  node.curve = driveCurve(device.params.amount);
  return {
    kind: "drive",
    input: node,
    output: node,
    setParams(d) {
      if (d.type !== "drive") return;
      // Cached curve per bucketed amount — no per-sample cost on tweaks.
      node.curve = driveCurve(d.params.amount);
    },
    dispose() {
      node.disconnect();
      node.curve = null;
    },
  };
}

// --- bitcrusher (worklet; processor lives in the voice-engine module) --------

export const BITCRUSHER_PROCESSOR_NAME = "bitcrusher";

export interface BitcrusherNodeLike extends FxConn {
  readonly port: { postMessage(message: unknown): void };
}

export function createBitcrusherDevice(
  node: BitcrusherNodeLike,
  device: Extract<FxDevice, { type: "bitcrusher" }>,
): FxDeviceInstance {
  node.port.postMessage({
    type: "params",
    bits: device.params.bits,
    downsample: device.params.downsample,
  });
  return {
    kind: "bitcrusher",
    input: node,
    output: node,
    setParams(d) {
      if (d.type !== "bitcrusher") return;
      node.port.postMessage({
        type: "params",
        bits: d.params.bits,
        downsample: d.params.downsample,
      });
    },
    dispose() {
      node.disconnect();
    },
  };
}

// --- synced delay ------------------------------------------------------------

export function createDelayDevice(
  ctx: BaseAudioContext,
  device: Extract<FxDevice, { type: "delay" }>,
  timing: FxTiming,
): FxDeviceInstance {
  const input = ctx.createGain(); // split point (dry + wet)
  const dry = ctx.createGain();
  const delay = ctx.createDelay(DELAY_MAX_SECONDS);
  const feedback = ctx.createGain();
  const damping = ctx.createBiquadFilter(); // in-loop lowpass
  const wet = ctx.createGain();

  damping.type = "lowpass";
  damping.frequency.value = 4500;

  input.connect(dry);
  input.connect(delay);
  delay.connect(damping);
  damping.connect(feedback);
  feedback.connect(delay); // feedback loop
  delay.connect(wet);

  const output = ctx.createGain();
  dry.connect(output);
  wet.connect(output);

  const applyTime = (d: typeof device, t: FxTiming) => {
    const seconds = delaySeconds(d.params.timeSteps, t.bpm);
    if (t.hard) {
      delay.delayTime.setValueAtTime(seconds, t.when);
    } else {
      // Glide (τ=15 ms): audibly instant, avoids the zipper/pitch-click of a
      // hard jump; `hard` is used on bar lines / offline preload.
      delay.delayTime.setTargetAtTime(seconds, t.when, DELAY_SYNC_TAU);
    }
  };
  const apply = (d: typeof device, t: FxTiming) => {
    applyTime(d, t);
    feedback.gain.setTargetAtTime(d.params.feedback, t.when, 0.01);
    wet.gain.setTargetAtTime(d.params.mix, t.when, 0.01);
    dry.gain.setTargetAtTime(1, t.when, 0.01);
  };
  apply(device, timing);

  return {
    kind: "delay",
    input,
    output,
    setParams(d, t = timing) {
      if (d.type !== "delay") return;
      apply(d, { ...t, when: ctx.currentTime });
    },
    syncBpm(t) {
      applyTime(device, { ...t, when: ctx.currentTime });
    },
    dispose() {
      for (const n of [input, dry, delay, feedback, damping, wet, output]) {
        n.disconnect();
      }
    },
  };
}

// --- reverb ------------------------------------------------------------------

export function createReverbDevice(
  ctx: BaseAudioContext,
  device: Extract<FxDevice, { type: "reverb" }>,
  opts: { readonly seed: number },
): FxDeviceInstance {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const convolver = ctx.createConvolver();
  const wet = ctx.createGain();
  const output = ctx.createGain();

  convolver.normalize = false;
  const ir = renderImpulseResponse({
    seed: opts.seed,
    size: device.params.size,
    sampleRate: ctx.sampleRate,
  });
  const buffer = ctx.createBuffer(2, ir.channels[0].length, ctx.sampleRate);
  buffer.copyToChannel(ir.channels[0], 0);
  buffer.copyToChannel(ir.channels[1], 1);
  convolver.buffer = buffer;

  input.connect(dry);
  input.connect(convolver);
  dry.connect(output);
  convolver.connect(wet);
  wet.connect(output);

  const apply = (d: typeof device, when: number) => {
    wet.gain.setTargetAtTime(d.params.mix, when, 0.01);
    dry.gain.setTargetAtTime(1 - 0.5 * d.params.mix, when, 0.01);
  };
  apply(device, ctx.currentTime);

  return {
    kind: "reverb",
    input,
    output,
    setParams(d) {
      if (d.type !== "reverb") return;
      // Size changes regenerate the (seeded, deterministic) IR.
      if (d.params.size !== device.params.size) {
        const next = renderImpulseResponse({
          seed: opts.seed,
          size: d.params.size,
          sampleRate: ctx.sampleRate,
        });
        const buf = ctx.createBuffer(
          2,
          next.channels[0].length,
          ctx.sampleRate,
        );
        buf.copyToChannel(next.channels[0], 0);
        buf.copyToChannel(next.channels[1], 1);
        convolver.buffer = buf;
      }
      apply(d, ctx.currentTime);
    },
    dispose() {
      for (const n of [input, dry, convolver, wet, output]) n.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// FxChainHost — ordered per-lane chain with glitch-free edits
// ---------------------------------------------------------------------------

/** Ramp gain at the chain head: the de-click envelope for topology edits. */
export interface RampGainLike {
  readonly input: FxConn;
  readonly output: FxConn;
  /**
   * Fade to `value` over `seconds` starting at `when` (linear). Only ever
   * used as 1 → 0 (pre-edit) and 0 → 1 (post-edit) around rebuilds.
   */
  rampTo(value: 0 | 1, when: number, seconds: number): void;
}

export const CHAIN_FADE_OUT_SECONDS = 0.003;
export const CHAIN_FADE_IN_SECONDS = 0.008;

export type CreateFxDevice = (
  device: FxDevice,
  index: number,
  timing: FxTiming,
) => FxDeviceInstance;

/** Deterministic device seed: stable per (lane seed, chain position). */
export function deviceSeed(laneSeed: number, index: number): number {
  return (laneSeed ^ ((index + 1) * 0x9e3779b9)) >>> 0;
}

export interface FxChainHostOptions {
  /** Chain head (e.g. the lane's voice-engine worklet node). */
  readonly source: FxConn;
  /** Chain tail (e.g. the lane gain → master). */
  readonly sink: FxConn;
  readonly ramp: RampGainLike;
  readonly createDevice: CreateFxDevice;
  readonly timing: () => FxTiming;
}

interface WiredDevice {
  device: FxDevice;
  readonly instance: FxDeviceInstance;
}

/**
 * Per-lane ordered chain: source → ramp → [active devices] → sink.
 *
 * Edit semantics (documented, IM-4):
 * - Same type sequence (incl. bypass toggles): relink only. Bypassed devices
 *   stay alive but are reconnected around (never a dead node in the path).
 * - Different type sequence (add/remove/reorder): full rebuild in the new
 *   order, wrapped in the head ramp 3 ms down / 8 ms up. Rebuild — not
 *   relink — because device subgraphs are order-dependent (e.g. reverb before
 *   drive vs after) and a fresh build cannot half-apply.
 * - Param edits: forwarded to setParams (AudioParam ramps, no topology
 *   change, no fade).
 */
export class FxChainHost {
  private readonly opts: FxChainHostOptions;
  private wired: WiredDevice[] = [];
  /** Active device-path edges (ramp.output → … → sink), host-owned only. */
  private edges: [FxConn, FxConn][] = [];

  constructor(opts: FxChainHostOptions) {
    this.opts = opts;
    opts.source.connect(opts.ramp.input);
    // Tracked as an edge: an empty/all-bypassed chain IS this direct wire,
    // and any device chain must replace it (never run parallel to it).
    this.link(opts.ramp.output, opts.sink);
  }

  setChain(devices: readonly FxDevice[]): void {
    const sameSequence =
      devices.length === this.wired.length &&
      devices.every((d, i) => d.type === this.wired[i].device.type);
    if (sameSequence) {
      // Reconnect-around: tear down active edges edge-wise (internal device
      // subgraphs are untouched — only host-owned connections drop), push
      // param edits, then relink skipping bypassed devices.
      this.tearDownActiveEdges();
      let cursor: FxConn = this.opts.ramp.output;
      for (let i = 0; i < devices.length; i++) {
        const w = this.wired[i];
        const next = devices[i];
        if (w.device !== next) w.instance.setParams(next, this.opts.timing());
        if (!next.bypassed) {
          this.link(cursor, w.instance.input);
          cursor = w.instance.output;
        }
        w.device = next;
      }
      this.link(cursor, this.opts.sink);
      return;
    }
    this.rebuild(devices);
  }

  /** Tempo change: forward to synced devices (delay glide). */
  syncBpm(hard = false): void {
    const timing = { ...this.opts.timing(), hard };
    for (const w of this.wired) w.instance.syncBpm?.(timing);
  }

  dispose(): void {
    this.tearDownActiveEdges();
    for (const w of this.wired) w.instance.dispose();
    this.wired = [];
  }

  private link(from: FxConn, to: FxConn): void {
    from.connect(to);
    this.edges.push([from, to]);
  }

  /** Disconnect host-owned edges between ramp output and sink. */
  private tearDownActiveEdges(): void {
    for (const [from, to] of this.edges) {
      try {
        from.disconnect(to);
      } catch {
        // Node already fully disconnected — nothing to drop.
      }
    }
    this.edges = [];
  }

  private rebuild(devices: readonly FxDevice[]): void {
    const { ramp, sink, createDevice, timing } = this.opts;
    const when = timing().when;
    ramp.rampTo(0, when, CHAIN_FADE_OUT_SECONDS);
    const settle = when + CHAIN_FADE_OUT_SECONDS;
    this.tearDownActiveEdges();
    // Disposing disconnects each device's internal subgraph from the chain.
    for (const w of this.wired) w.instance.dispose();
    this.wired = [];
    // Build fresh instances in document order; bypassed devices are created
    // (alive, warm) but connected around — never a dead node in the path.
    const created: WiredDevice[] = [];
    let cursor: FxConn = ramp.output;
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i]!;
      const instance = createDevice(device, i, { ...timing(), when: settle });
      created.push({ device, instance });
      if (!device.bypassed) {
        this.link(cursor, instance.input);
        cursor = instance.output;
      }
    }
    this.link(cursor, sink);
    this.wired = created;
    ramp.rampTo(1, settle, CHAIN_FADE_IN_SECONDS);
  }
}

// ---------------------------------------------------------------------------
// Real-context device factory (dispatcher)
// ---------------------------------------------------------------------------

export interface RealFxFactoryOptions {
  /** Stable per-lane seed → deterministic reverb IRs (online == offline). */
  readonly laneSeed: number;
  /** Create a 'bitcrusher' worklet node (module must be loaded). */
  readonly createBitcrusher: (ctx: BaseAudioContext) => BitcrusherNodeLike;
}

/**
 * Build the device factory for one lane on a real BaseAudioContext. The
 * bitcrusher node creation is injected so this module stays free of
 * AudioWorkletNode specifics (and node-testable).
 */
export function createRealFxDeviceFactory(
  ctx: BaseAudioContext,
  opts: RealFxFactoryOptions,
): CreateFxDevice {
  return (device, index, timing) => {
    switch (device.type) {
      case "filter":
        return createFilterDevice(ctx, device);
      case "drive":
        return createDriveDevice(ctx, device);
      case "bitcrusher":
        return createBitcrusherDevice(opts.createBitcrusher(ctx), device);
      case "delay":
        return createDelayDevice(ctx, device, timing);
      case "reverb":
        return createReverbDevice(ctx, device, {
          seed: deviceSeed(opts.laneSeed, index),
        });
    }
  };
}
