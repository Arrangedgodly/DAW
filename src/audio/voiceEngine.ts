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
          node.port.onmessage = handler as unknown as typeof node.port.onmessage;
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
  for (let i = 0; i < laneCount; i++) {
    const node = ctx.createVoiceEngineNode();
    const laneIndex = i;
    node.port.onmessage = (event) => {
      const data = event.data as { type?: string; untilTime?: number };
      if (!data || typeof data.type !== "string") return;
      if (data.type === "consumed" && typeof data.untilTime === "number") {
        outbox.handleWatermark(laneIndex, data.untilTime);
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
      nodes[laneIndex].port.postMessage({ type: "events", events });
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
export function workletContextFor(ctx: BaseAudioContext): AudioWorkletContextLike {
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
