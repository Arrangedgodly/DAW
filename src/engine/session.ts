/**
 * Framework-neutral engine session: one AudioEngineContext + one Transport,
 * plus the booth's master gain and metronome click path. The UI (Booth.tsx)
 * talks ONLY to a Session — never to raw nodes — and the singleton below is
 * the app's single engine instance.
 *
 * src/audio stays DOM-free; this module is the deliberate browser-side seam
 * and keeps its audio-node surface behind injectable hooks so the session is
 * fully testable without a browser.
 */

import { AudioEngineContext, type AudioContextLike } from "../audio/context";
import { Transport } from "../audio/transport";
import { STEPS_PER_BEAT, STEPS_PER_BAR, clampSwing } from "../audio/time";
import { clamp } from "../lib/clamp";

/** Audio-node surface the default metronome/master wiring needs. */
interface AudioNodeContext extends AudioContextLike {
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

function hasAudioNodes(ctx: AudioContextLike): ctx is AudioNodeContext {
  return (
    "destination" in ctx &&
    typeof (ctx as AudioNodeContext).createOscillator === "function" &&
    typeof (ctx as AudioNodeContext).createGain === "function"
  );
}

export type TickSoundPlayer = (when: number, downbeat: boolean) => void;

export interface SessionOptions {
  /** Injected for tests; defaults to the one legal real-AudioContext factory. */
  readonly engine?: AudioEngineContext;
  readonly intervalMs?: number;
  readonly horizonSeconds?: number;
  readonly startDelaySeconds?: number;
  readonly setIntervalFn?: NonNullable<
    import("../audio/scheduler").SchedulerOptions["setIntervalFn"]
  >;
  readonly clearIntervalFn?: NonNullable<
    import("../audio/scheduler").SchedulerOptions["clearIntervalFn"]
  >;
  /** Override the metronome click synthesis (tests). */
  readonly playTickSound?: TickSoundPlayer;
  /** Override click cancellation on transport stop (tests). */
  readonly cancelTickSounds?: () => void;
}

export class Session {
  readonly engine: AudioEngineContext;
  readonly transport: Transport;

  private _metronome = false;
  private _volume = 0.9;
  private master: GainNode | null = null;
  private readonly playTickSound: TickSoundPlayer;
  private readonly cancelTickSounds: () => void;

  constructor(opts: SessionOptions = {}) {
    this.engine = opts.engine ?? new AudioEngineContext();
    this.playTickSound = opts.playTickSound ?? this.defaultPlayTick.bind(this);
    this.cancelTickSounds =
      opts.cancelTickSounds ?? this.defaultCancelTicks.bind(this);
    this.transport = new Transport({
      getContext: () => this.engine.getContext(),
      scheduleEvent: (event, when) => this.onScheduledTick(event.step, when),
      cancelScheduledEvents: () => this.cancelTickSounds(),
      intervalMs: opts.intervalMs,
      horizonSeconds: opts.horizonSeconds,
      startDelaySeconds: opts.startDelaySeconds,
      setIntervalFn: opts.setIntervalFn,
      clearIntervalFn: opts.clearIntervalFn,
    });
  }

  /**
   * PLAY/STOP. The first press runs the gesture unlock (ctx.resume) and then
   * starts the transport; every press stays inside the user gesture chain.
   */
  async togglePlay(): Promise<void> {
    await this.engine.unlock();
    if (this.transport.snapshot.playing) {
      this.transport.stop();
    } else {
      this.transport.play();
    }
  }

  setLoop(on: boolean): void {
    this.transport.setLoop(on);
  }

  /** Clamps and forwards to the transport (single clamping authority). */
  setBpm(bpm: number): void {
    this.transport.setBpm(bpm);
  }

  setSwingAmount(amount: number): void {
    this.transport.setSwing(clampSwing(amount));
  }

  get metronomeOn(): boolean {
    return this._metronome;
  }

  setMetronome(on: boolean): void {
    this._metronome = on;
  }

  get masterVolume(): number {
    return this._volume;
  }

  /** Linear 0..1 master volume; applied to the gain node if it exists yet. */
  setMasterVolume(volume: number): void {
    this._volume = clamp(volume, 0, 1);
    if (this.master) {
      this.master.gain.setValueAtTime(
        this._volume,
        this.engine.getContext().currentTime,
      );
    }
  }

  /** Transport observer passthrough (coarse state only, never 60 Hz data). */
  subscribe(
    listener: import("../audio/transport").TransportListener,
  ): () => void {
    return this.transport.subscribe(listener);
  }

  /** Only quarter-note steps click; bar starts get the downbeat pitch. */
  private onScheduledTick(step: number, when: number): void {
    if (!this._metronome) return;
    if (step % STEPS_PER_BEAT !== 0) return;
    this.playTickSound(when, step % STEPS_PER_BAR === 0);
  }

  /** Lazily builds the master gain wired to the destination. */
  private ensureMaster(): GainNode | null {
    if (this.master) return this.master;
    const ctx = this.engine.getContext();
    if (!hasAudioNodes(ctx)) return null;
    const gain = ctx.createGain();
    gain.gain.value = this._volume;
    gain.connect(ctx.destination);
    this.master = gain;
    return gain;
  }

  private activeOscillators = new Set<OscillatorNode>();

  private defaultPlayTick(when: number, downbeat: boolean): void {
    const ctx = this.engine.getContext();
    if (!hasAudioNodes(ctx)) return;
    const master = this.ensureMaster();
    if (!master) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = downbeat ? 1760 : 1175;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(downbeat ? 0.5 : 0.3, when + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(env);
    env.connect(master);
    osc.start(when);
    osc.stop(when + 0.06);
    this.activeOscillators.add(osc);
    osc.onended = () => this.activeOscillators.delete(osc);
  }

  private defaultCancelTicks(): void {
    for (const osc of this.activeOscillators) {
      try {
        osc.stop(0);
      } catch {
        // Already stopped — nothing to cancel.
      }
    }
    this.activeOscillators.clear();
  }
}

let shared: Session | null = null;

/** The app's single engine session (lazy; safe to import anywhere). */
export function getSession(): Session {
  shared ??= new Session();
  return shared;
}

/** Test-only: drop the shared singleton. */
export function resetSharedSession(): void {
  shared = null;
}
