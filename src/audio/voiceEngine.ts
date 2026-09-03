/**
 * Main-thread voice-engine host (IM-3, RES-2/3).
 *
 * createVoiceEngine() loads the worklet module (works identically for real
 * AudioContext and OfflineAudioContext — addModule is per-context), creates
 * one 'voice-engine' node per lane, and exposes sendEvents/connect. This
 * module owns no timing decisions: events are already absolute-time compiled
 * (compile.ts) and the worklet pulls them at the exact sample boundary.
 */

import type { VoiceNoteOnEvent } from "./presets";

export const VOICE_ENGINE_PROCESSOR_NAME = "voice-engine";
export const VOICES_PER_LANE = 8;

/** Default module URL: Vite serves this in dev and emits it verbatim in build. */
export function defaultVoiceEngineModuleUrl(): string {
  return new URL("./worklets/voiceEngine.js", import.meta.url).href;
}

// ---------------------------------------------------------------------------
// Injectable context surface (tests pass fakes)
// ---------------------------------------------------------------------------

export interface MessagePortLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

export interface WorkletNodeLike {
  readonly port: MessagePortLike;
  connect(destination: AudioNode): unknown;
  disconnect(): void;
}

export interface AudioWorkletContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createVoiceEngineNode(): WorkletNodeLike;
}

/** Adapter over a real BaseAudioContext (the only DOM-touching line). */
class RealWorkletContext implements AudioWorkletContextLike {
  constructor(private readonly ctx: BaseAudioContext) {}
  get currentTime(): number {
    return this.ctx.currentTime;
  }
  get sampleRate(): number {
    return this.ctx.sampleRate;
  }
  get audioWorklet(): { addModule(url: string): Promise<void> } {
    return this.ctx.audioWorklet;
  }
  createVoiceEngineNode(): WorkletNodeLike {
    // AudioWorkletNode is a constructor taking any BaseAudioContext (real or
    // offline). (A phantom ctx.createAudioWorkletNode call lived here until
    // the TH-1 browser suite first exercised the real path — the node tests
    // only ever passed fakes.)
    const node = new AudioWorkletNode(this.ctx, VOICE_ENGINE_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return {
      port: {
        postMessage: (message) => node.port.postMessage(message),
        get onmessage() {
          return node.port.onmessage as unknown as MessagePortLike["onmessage"];
        },
        set onmessage(handler: MessagePortLike["onmessage"]) {
          node.port.onmessage =
            handler as unknown as typeof node.port.onmessage;
        },
      },
      connect: (destination) => node.connect(destination),
      disconnect: () => node.disconnect(),
    };
  }
}

export function isWorkletCapable(ctx: unknown): ctx is BaseAudioContext & {
  audioWorklet: { addModule(url: string): Promise<void> };
} {
  return (
    typeof ctx === "object" &&
    ctx !== null &&
    "audioWorklet" in ctx &&
    typeof (ctx as BaseAudioContext).audioWorklet.addModule === "function"
  );
}

// ---------------------------------------------------------------------------
// EventOutbox — pure queue/watermark bookkeeping (unit-tested in node)
// ---------------------------------------------------------------------------

/**
 * Tracks sent events per lane against the worklet's consumed-watermark
 * messages. The worklet posts {type:'consumed', untilTime} once it has played
 * through a queue position; the outbox turns that into backlog diagnostics
 * (pending count, age of the oldest un-consumed event) the scheduler can use
 * to detect starvation/underrun without any audio-thread coupling.
 */
export class EventOutbox {
  private readonly sent: number[][] = [];
  private readonly watermarks: number[];

  constructor(laneCount: number) {
    for (let i = 0; i < laneCount; i++) this.sent.push([]);
    this.watermarks = new Array<number>(laneCount).fill(-1);
  }

  /** Enqueue one batch of already-sorted event times for a lane. */
  enqueue(laneIndex: number, events: readonly VoiceNoteOnEvent[]): void {
    this.lane(laneIndex).push(...events.map((e) => e.time));
  }

  /** Apply a {type:'consumed', untilTime} watermark from a lane's worklet. */
  handleWatermark(laneIndex: number, untilTime: number): void {
    const lane = this.lane(laneIndex);
    if (untilTime > this.watermarks[laneIndex]) {
      this.watermarks[laneIndex] = untilTime;
    }
    // Drop every event at or before the watermark (consumed by the worklet).
    let drop = 0;
    while (drop < lane.length && lane[drop] <= untilTime) drop++;
    if (drop > 0) lane.splice(0, drop);
  }

  pendingCount(laneIndex: number): number {
    return this.lane(laneIndex).length;
  }

  totalPending(): number {
    let n = 0;
    for (const lane of this.sent) n += lane.length;
    return n;
  }

  /** Time of the oldest not-yet-consumed event on a lane, or null if empty. */
  oldestPendingTime(laneIndex: number): number | null {
    const lane = this.lane(laneIndex);
    return lane.length > 0 ? lane[0] : null;
  }

  private lane(laneIndex: number): number[] {
    if (laneIndex < 0 || laneIndex >= this.sent.length) {
      throw new Error(`EventOutbox: lane ${laneIndex} out of range`);
    }
    return this.sent[laneIndex];
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface VoiceEngineHost {
  /** Send a sorted batch of absolute-time events to one lane's worklet. */
  sendEvents(laneIndex: number, events: readonly VoiceNoteOnEvent[]): void;
  /** Connect one lane's worklet output to a destination (e.g. lane gain). */
  connect(laneIndex: number, destination: AudioNode): void;
  /** Fast-release every voice on every lane (transport stop). */
  allOff(): void;
  /**
   * Resolve when every sendEvents batch since the last wait has been
   * ACKED by its worklet (message-thread receipt confirmed). The offline
   * render uses this instead of a fixed sleep so no event can race the
   * start of rendering (HW-4 finding — see worklets/voiceEngine.js).
   */
  waitUntilLoaded(timeoutMs?: number): Promise<void>;
  /** HU-2 dev stat: steals this lane's worklet has performed (optional). */
  stolenCount?(laneIndex: number): number;
  readonly outbox: EventOutbox;
  dispose(): void;
}

export interface CreateVoiceEngineOptions {
  /** Override the worklet module URL (tests). */
  readonly moduleUrl?: string;
  /** HU-2 dev stat: fired each time a lane's worklet steals a voice. */
  readonly onStolen?: (laneIndex: number) => void;
}

export async function createVoiceEngine(
  ctx: AudioWorkletContextLike,
  laneCount: number,
  opts: CreateVoiceEngineOptions = {},
): Promise<VoiceEngineHost> {
  const moduleUrl = opts.moduleUrl ?? defaultVoiceEngineModuleUrl();
  await ctx.audioWorklet.addModule(moduleUrl);
  markWorkletModuleLoaded(ctx.audioWorklet);

  const nodes: WorkletNodeLike[] = [];
  const outbox = new EventOutbox(laneCount);
  const stolen = new Array<number>(laneCount).fill(0);
  // Event-receipt acks (see waitUntilLoaded): one expected per sendEvents
  // call with a non-empty batch, one counted per {type:'loaded'} reply.
  let acksExpected = 0;
  let acksReceived = 0;
  for (let i = 0; i < laneCount; i++) {
    const node = ctx.createVoiceEngineNode();
    const laneIndex = i;
    node.port.onmessage = (event) => {
      const data = event.data as { type?: string; untilTime?: number };
      if (!data || typeof data.type !== "string") return;
      if (data.type === "consumed" && typeof data.untilTime === "number") {
        outbox.handleWatermark(laneIndex, data.untilTime);
      } else if (data.type === "loaded") {
        acksReceived++;
      } else if (data.type === "stolen") {
        stolen[laneIndex] += 1;
        opts.onStolen?.(laneIndex);
      }
    };
    nodes.push(node);
  }

  return {
    outbox,
    sendEvents(laneIndex, events) {
      if (laneIndex < 0 || laneIndex >= nodes.length) {
        throw new Error(`sendEvents: lane ${laneIndex} out of range`);
      }
      if (events.length === 0) return;
      for (let i = 1; i < events.length; i++) {
        if (events[i].time < events[i - 1].time) {
          throw new Error("sendEvents: batch must be sorted by time");
        }
      }
      outbox.enqueue(laneIndex, events);
      acksExpected++;
      nodes[laneIndex].port.postMessage({ type: "events", events });
    },
    waitUntilLoaded(timeoutMs = 2000) {
      const target = acksExpected;
      return new Promise<void>((resolve) => {
        const check = () => {
          if (acksReceived >= target) return resolve();
          if (timeoutMs <= 0) return resolve(); // bounded fallback, never hangs
          setTimeout(() => {
            timeoutMs -= 50;
            check();
          }, 50);
        };
        check();
      });
    },
    connect(laneIndex, destination) {
      nodes[laneIndex].connect(destination);
    },
    allOff() {
      for (const node of nodes) node.port.postMessage({ type: "all-off" });
    },
    stolenCount(laneIndex) {
      return stolen[laneIndex] ?? 0;
    },
    dispose() {
      for (const node of nodes) {
        node.port.onmessage = null;
        node.disconnect();
      }
    },
  };
}

/** Wrap a real BaseAudioContext for createVoiceEngine. */
export function workletContextFor(
  ctx: BaseAudioContext,
): AudioWorkletContextLike {
  return new RealWorkletContext(ctx);
}

// ---------------------------------------------------------------------------
// Worklet-module loading seam (IM-4): one addModule per context, shared by
// the voice engine AND the bitcrusher processor (same module, D2–D4).
// ---------------------------------------------------------------------------

const modulesLoaded = new WeakSet<object>();

/** Record an already-loaded module (called by createVoiceEngine). */
export function markWorkletModuleLoaded(audioWorklet: object): void {
  modulesLoaded.add(audioWorklet);
}

/**
 * Ensure the worklet module is loaded on this context exactly once
 * (re-registering a processor name throws). Works identically for real and
 * offline contexts — addModule is per-context.
 */
export async function ensureWorkletModule(
  ctx: BaseAudioContext,
  moduleUrl: string = defaultVoiceEngineModuleUrl(),
): Promise<void> {
  if (modulesLoaded.has(ctx.audioWorklet)) return;
  await ctx.audioWorklet.addModule(moduleUrl);
  modulesLoaded.add(ctx.audioWorklet);
}

/**
 * Create a 'bitcrusher' worklet node (processor registered in the
 * voice-engine module). Caller must ensureWorkletModule(ctx) first.
 */
export function createBitcrusherNode(
  ctx: BaseAudioContext,
): import("./fx").BitcrusherNodeLike {
  const node = new AudioWorkletNode(ctx, "bitcrusher", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  return node as unknown as import("./fx").BitcrusherNodeLike;
}

// ---------------------------------------------------------------------------
// Voice interface + native fallback (documented stub, D2–D4)
// ----------------------------------------------------------------------------

/**
 * Voice interface (D2–D4). The worklet engine is the production
 * implementation (implicitly — one worklet node hosts 8 voices per lane).
 *
 * `NativePeriodicVoice` is the reserved Safari/prototype contingency: a
 * node-graph voice built from OscillatorNode + a per-duty PeriodicWave cache
 * (Web Audio has no native pulse/duty oscillator, WG issue #783). It is NOT
 * built yet — IM-5/PX phases revisit it if the worklet path fails on a
 * target browser. Interface only, per plan.
 */
export interface Voice {
  trigger(event: VoiceNoteOnEvent): void;
  release(time: number): void;
}

// ---------------------------------------------------------------------------
// PS-4 — SampleVoiceHost: native AudioBufferSourceNode voices for sample-
// backed lanes (RES-10 committed route). Mirrors VoiceEngineHost's per-lane
// shape (sendEvents/connect/allOff) so the session routes through ONE seam.
//
// Laws (plan.md PS-4):
// - WORKLET UNTOUCHED: sample events never reach the worklet; the lane
//   router partitions on VoiceNoteOnEvent.sample (presets.ts).
// - NEVER BLOCKING: sendEvents is synchronous. A sample whose buffer is not
//   yet decoded on THIS context is DROPPED (counted, never awaited — the
//   audio path must not race a fetch). The selection-time prefetch makes the
//   drop a cold-start corner; the offline render PRELOADS everything before
//   startRendering() instead (parity law below).
// - OFFLINE PARITY: AudioBufferSourceNode scheduling is deterministic when
//   every buffer is decoded before the sources are scheduled — the offline
//   render awaits preload() first, and sample events carry no seeds.
// - VOICE-STEALING LAW mirrors the worklet (RES-3): 8 voices per lane,
//   free slot → oldest in release → oldest overall, with the same 4 ms
//   de-click fade (STEAL_FADE_SECONDS).
// - NO AUDIO-THREAD CODE: everything here runs on the main thread; native
//   nodes render. Per-note allocation is two nodes (source + gain) — the
//   platform's designed API for sampled one-shots; nothing allocates inside
//   any render quantum.
// ---------------------------------------------------------------------------

import type { SampleNoteData } from "./presets";
import { STEAL_FADE_SECONDS } from "./dsp";

/** The context surface the host needs (real BaseAudioContext satisfies it). */
export interface SampleVoiceContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  createBufferSource(): SampleBufferSourceLike;
  createGain(): SampleGainLike;
}

export interface SampleParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(cancelTime: number): void;
}

export interface SampleBufferSourceLike {
  buffer: AudioBuffer | null;
  readonly playbackRate: SampleParamLike;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
  onended: ((event: Event) => void) | null;
}

export interface SampleGainLike {
  readonly gain: SampleParamLike;
  connect(destination: unknown): unknown;
  disconnect(): void;
}

/** The loader surface the host needs (SampleLoader satisfies it). */
export interface SampleBufferSource {
  load(ctx: unknown, id: string): Promise<AudioBuffer>;
  peek(ctx: unknown, id: string): AudioBuffer | undefined;
}

export interface SampleVoiceHostOptions {
  /** HU-2 dev stat parity with the worklet host. */
  readonly onStolen?: (laneIndex: number) => void;
  /** Fired when a live event is dropped because its buffer was not decoded. */
  readonly onDrop?: (ref: string) => void;
}

export interface SampleVoiceHost {
  /** Schedule sample events (already absolute-time, sorted by caller). */
  sendEvents(laneIndex: number, events: readonly VoiceNoteOnEvent[]): void;
  /** Connect one lane's voice output to a destination (idempotent per lane). */
  connect(laneIndex: number, destination: AudioNode): void;
  /** De-click stop every sounding voice (transport stop). */
  allOff(): void;
  /**
   * Decode refs on THIS host's context (offline parity: await before
   * scheduling/startRendering). Rejects with the loader's typed error.
   */
  preload(refs: readonly string[]): Promise<void>;
  /** Resolve when every load kicked off so far has settled (never rejects). */
  settled(): Promise<void>;
  /** Dev diagnostics: live events dropped for want of a decoded buffer. */
  droppedCount(ref?: string): number;
  /** HU-2 dev stat parity with the worklet host. */
  stolenCount(laneIndex: number): number;
  dispose(): void;
}

/** Voices per lane — mirrors the worklet's VOICES_PER_LANE pool. */
export const SAMPLE_VOICES_PER_LANE = VOICES_PER_LANE;

/**
 * Per-recording peak normalization: committed CC0 one-shots arrive anywhere
 * between −22 dB and 0 dBFS (PROVENANCE bytes are pinned — no re-transcode),
 * so the host normalizes each decoded buffer to TARGET_PEAK with a bounded
 * makeup before the preset's musical level trim. Deterministic per context
 * (same decode → same scan); identical on live and offline paths.
 */
export const SAMPLE_TARGET_PEAK = 0.5;
export const SAMPLE_MAX_MAKEUP = 4;

function bufferPeak(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

export function createSampleVoiceHost(
  ctx: SampleVoiceContextLike,
  laneCount: number,
  loader: SampleBufferSource,
  opts: SampleVoiceHostOptions = {},
): SampleVoiceHost {
  const laneOut: (SampleGainLike | null)[] = new Array(laneCount).fill(null);
  const destinations: (AudioNode | null)[] = new Array(laneCount).fill(null);
  interface LiveSampleVoice {
    readonly source: SampleBufferSourceLike;
    readonly gain: SampleGainLike;
    readonly startedAt: number;
    /** ctx time after which the voice counts as "in release" (steal policy). */
    readonly releaseFrom: number;
  }
  const live: LiveSampleVoice[][] = Array.from({ length: laneCount }, () => []);
  const stolen = new Array<number>(laneCount).fill(0);
  const droppedByRef = new Map<string, number>();
  const makeupByRef = new Map<string, number>();
  const pending: Set<Promise<void>> = new Set();
  let disposed = false;

  const laneOutput = (laneIndex: number): SampleGainLike | null => {
    if (laneIndex < 0 || laneIndex >= laneCount) {
      throw new Error(`SampleVoiceHost: lane ${laneIndex} out of range`);
    }
    let out = laneOut[laneIndex];
    if (!out) {
      // Unity bus (a fresh GainNode's param is already 1) — per-voice gains
      // carry envelope + level + makeup.
      out = ctx.createGain();
      const dest = destinations[laneIndex];
      if (dest) out.connect(dest);
      laneOut[laneIndex] = out;
    }
    return out;
  };

  const makeupFor = (data: SampleNoteData, buffer: AudioBuffer): number => {
    let makeup = makeupByRef.get(data.ref);
    if (makeup === undefined) {
      makeup = Math.min(
        SAMPLE_MAX_MAKEUP,
        SAMPLE_TARGET_PEAK / Math.max(bufferPeak(buffer), 1e-4),
      );
      makeupByRef.set(data.ref, makeup);
    }
    return makeup;
  };

  const forget = (
    laneIndex: number,
    voice: { source: SampleBufferSourceLike },
  ) => {
    const voices = live[laneIndex];
    const at = voices.findIndex((v) => v.source === voice.source);
    if (at >= 0) voices.splice(at, 1);
  };

  /** De-click a voice that is about to be retired (steal / allOff). */
  const retire = (laneIndex: number, voice: LiveSampleVoice): void => {
    const t = ctx.currentTime;
    const g = voice.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + STEAL_FADE_SECONDS);
    voice.source.stop(t + STEAL_FADE_SECONDS + 0.002);
    forget(laneIndex, voice);
  };

  const trigger = (laneIndex: number, event: VoiceNoteOnEvent): void => {
    const data = event.sample;
    if (!data) return;
    const buffer = loader.peek(ctx, data.ref);
    if (!buffer) {
      droppedByRef.set(data.ref, (droppedByRef.get(data.ref) ?? 0) + 1);
      opts.onDrop?.(data.ref);
      return;
    }
    const out = laneOutput(laneIndex);
    if (!out) return;

    // Voice stealing (worklet law): free slot → oldest in release → oldest.
    const voices = live[laneIndex];
    if (voices.length >= SAMPLE_VOICES_PER_LANE) {
      const now = ctx.currentTime;
      let victim = voices.findIndex((v) => v.releaseFrom <= now);
      if (victim < 0) {
        victim = 0;
        for (let i = 1; i < voices.length; i++) {
          if (voices[i]!.startedAt < voices[victim]!.startedAt) victim = i;
        }
      }
      retire(laneIndex, voices[victim]!);
      stolen[laneIndex] += 1;
      opts.onStolen?.(laneIndex);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = data.playbackRate;
    const gain = ctx.createGain();
    const g = gain.gain;
    const t = event.time;
    const level = event.level * makeupFor(data, buffer);
    // De-click window: the carrier attack, bounded so a padded synth-style
    // attack cannot swallow a one-shot's own transient.
    const attack = Math.max(0.0005, Math.min(event.attack, 0.05));
    const naturalSeconds = buffer.duration / data.playbackRate;
    let stopAt: number;
    let releaseFrom: number;
    // De-click attack for BOTH variants (a one-shot still needs its level —
    // makeup × preset trim — applied and a click-free onset).
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(level, t + attack);
    if (data.oneShot) {
      // Drums law: the recording IS the envelope — natural length, no gate.
      stopAt = t + naturalSeconds + 0.005;
      releaseFrom = t + naturalSeconds * 0.75;
    } else {
      // Pitched law (SC-2): release lands at the note-length boundary.
      const hold = Math.max(event.holdSeconds, attack + 0.01);
      const release = Math.max(0.01, event.release);
      g.setValueAtTime(level, t + hold);
      g.linearRampToValueAtTime(0, t + hold + release);
      stopAt = Math.min(t + naturalSeconds, t + hold + release) + 0.005;
      releaseFrom = t + hold;
    }
    source.connect(gain);
    gain.connect(out);
    source.start(t);
    source.stop(stopAt);
    const voice = { source, gain, startedAt: t, releaseFrom };
    voices.push(voice);
    source.onended = () => {
      forget(laneIndex, voice);
      source.disconnect();
      gain.disconnect();
    };
  };

  return {
    sendEvents(laneIndex, events) {
      if (laneIndex < 0 || laneIndex >= laneCount) {
        throw new Error(`sendEvents: lane ${laneIndex} out of range`);
      }
      if (disposed) return;
      for (const event of events) {
        if (!event.sample) continue;
        trigger(laneIndex, event);
      }
    },
    connect(laneIndex, destination) {
      if (laneIndex < 0 || laneIndex >= laneCount) {
        throw new Error(`connect: lane ${laneIndex} out of range`);
      }
      destinations[laneIndex] = destination;
      laneOut[laneIndex]?.connect(destination);
    },
    allOff() {
      for (let i = 0; i < laneCount; i++) {
        const voices = live[i];
        while (voices.length > 0) retire(i, voices[0]!);
      }
    },
    preload(refs) {
      const uniq = [...new Set(refs)];
      const loads = uniq.map((id) => loader.load(ctx, id));
      const all = Promise.all(loads).then(
        () => undefined,
        (err: unknown) => {
          throw err;
        },
      );
      const tracked = all.then(
        () => undefined,
        () => undefined,
      );
      pending.add(tracked);
      void tracked.finally(() => pending.delete(tracked));
      return all;
    },
    settled() {
      return Promise.all([...pending]).then(() => undefined);
    },
    droppedCount(ref) {
      if (ref !== undefined) return droppedByRef.get(ref) ?? 0;
      let n = 0;
      for (const v of droppedByRef.values()) n += v;
      return n;
    },
    stolenCount(laneIndex) {
      return stolen[laneIndex] ?? 0;
    },
    dispose() {
      disposed = true;
      for (let i = 0; i < laneCount; i++) {
        const voices = live[i];
        while (voices.length > 0) retire(i, voices[0]!);
        laneOut[i]?.disconnect();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// PS-4 — lazy content-module seam. The loader (and its hashed OGG glob) is a
// SEPARATE build entry (PS-2); importing it dynamically keeps those bytes out
// of the initial JS graph, and nothing below it fetches until a sample sound
// is selected (TH-4(d): zero audio-asset fetches on boot→play).
// ---------------------------------------------------------------------------

let contentLoaderPromise: Promise<import("../assets/content/loader").SampleLoader> | null =
  null;

/**
 * The process-wide sample loader (memoized). Rejects transitively if the
 * content module cannot load; callers surface per the Hulk conventions.
 */
export function ensureContentLoader(): Promise<import("../assets/content/loader").SampleLoader> {
  contentLoaderPromise ??= import("../assets/content/loader").then((mod) =>
    mod.createSampleLoader(),
  );
  return contentLoaderPromise;
}

/** Test-only: drop the memoized loader (module isolation). */
export function resetContentLoaderCache(): void {
  contentLoaderPromise = null;
}

/**
 * Build a SampleVoiceHost on a real BaseAudioContext (live session or
 * OfflineAudioContext), loading the content loader lazily.
 */
export async function createSampleVoiceHostFor(
  ctx: SampleVoiceContextLike,
  laneCount: number,
  opts: SampleVoiceHostOptions = {},
): Promise<SampleVoiceHost> {
  const loader = await ensureContentLoader();
  return createSampleVoiceHost(ctx, laneCount, loader, opts);
}

// ---------------------------------------------------------------------------
// PS-4 — lane voice router: ONE seam that owns the worklet host and the
// (lazily created) sample host. sendEvents partitions on event.sample, so a
// lane's sound can move between synth and sample freely, mid-phrase even.
// ---------------------------------------------------------------------------

export interface LaneVoiceRouter extends VoiceEngineHost {
  /** Create + attach the sample host (idempotent; memoized). */
  ensureSampleVoice(): Promise<SampleVoiceHost | null>;
  /** Sync probe (diagnostics/tests): has the sample host been created? */
  hasSampleVoice(): boolean;
}

export function createLaneVoiceRouter(
  worklet: VoiceEngineHost,
  createSampleHost: () => Promise<SampleVoiceHost | null>,
): LaneVoiceRouter {
  let sample: SampleVoiceHost | null = null;
  let samplePromise: Promise<SampleVoiceHost | null> | null = null;
  const laneDestinations: (AudioNode | null)[] = [];

  return {
    outbox: worklet.outbox,
    ensureSampleVoice() {
      samplePromise ??= Promise.resolve()
        .then(createSampleHost)
        .then((host) => {
          if (!host) return null;
          sample = host;
          laneDestinations.forEach((dest, i) => {
            if (dest) host.connect(i, dest);
          });
          return host;
        })
        .catch((err: unknown) => {
          samplePromise = null; // a failed creation must not poison the seam
          throw err;
        });
      return samplePromise;
    },
    hasSampleVoice() {
      return sample !== null;
    },
    sendEvents(laneIndex, events) {
      let anySample = false;
      for (let i = 0; i < events.length; i++) {
        if (events[i].sample !== undefined) {
          anySample = true;
          break;
        }
      }
      if (!anySample) {
        worklet.sendEvents(laneIndex, events);
        return;
      }
      const synth: VoiceNoteOnEvent[] = [];
      const sampleEvents: VoiceNoteOnEvent[] = [];
      for (const e of events) (e.sample ? sampleEvents : synth).push(e);
      if (synth.length > 0) worklet.sendEvents(laneIndex, synth);
      if (sampleEvents.length > 0) {
        void this.ensureSampleVoice().then((host) => {
          host?.sendEvents(laneIndex, sampleEvents);
        });
      }
    },
    waitUntilLoaded(timeoutMs) {
      const workletDone = worklet.waitUntilLoaded(timeoutMs);
      const sampleDone = sample ? sample.settled() : Promise.resolve();
      return Promise.all([workletDone, sampleDone]).then(() => undefined);
    },
    connect(laneIndex, destination) {
      if (laneDestinations[laneIndex] !== destination) {
        laneDestinations[laneIndex] = destination;
      }
      worklet.connect(laneIndex, destination);
      sample?.connect(laneIndex, destination);
    },
    allOff() {
      worklet.allOff();
      sample?.allOff();
    },
    stolenCount(laneIndex) {
      return (
        (worklet.stolenCount?.(laneIndex) ?? 0) +
        (sample?.stolenCount(laneIndex) ?? 0)
      );
    },
    dispose() {
      worklet.dispose();
      sample?.dispose();
    },
  };
}
