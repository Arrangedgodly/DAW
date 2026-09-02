/**
 * AudioContext bootstrap. The ONLY place allowed to construct an AudioContext
 * is the default factory below; everything else receives an injected factory.
 */

export const DEFAULT_SAMPLE_RATE = 44100;

/** Minimal AudioContext surface the engine depends on. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  resume(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

/** Default factory: real AudioContext at a fixed 44100 Hz. */
export const defaultAudioContextFactory: AudioContextFactory = () =>
  new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });

export class AudioEngineContext {
  private ctx: AudioContextLike | null = null;

  constructor(
    private readonly factory: AudioContextFactory = defaultAudioContextFactory,
  ) {}

  /** Lazily creates the AudioContext on first use. */
  getContext(): AudioContextLike {
    this.ctx ??= this.factory();
    return this.ctx;
  }

  /** True once the underlying AudioContext has been created. */
  get created(): boolean {
    return this.ctx !== null;
  }

  get sampleRate(): number {
    return this.getContext().sampleRate;
  }

  get state(): AudioContextState {
    return this.ctx?.state ?? "suspended";
  }

  /**
   * Gesture unlock: call from a user-gesture handler (UI wiring comes later;
   * src/audio/ itself must stay DOM-free). Resumes a suspended context.
   */
  async unlock(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state !== "running") {
      await ctx.resume();
    }
  }
}
