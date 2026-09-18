/**
 * Lookahead scheduler.
 *
 * The ONLY scheduling authority is a compiled, sorted list of absolute
 * audio-clock events. This class never creates events; it asks the injected
 * `provideEvents(afterTime, untilTime)` "compiler" for events inside the
 * horizon and forwards each one, at its exact absolute time, to
 * `scheduleEvent(event, when)`.
 *
 * All timing decisions derive from ctx.currentTime exclusively.
 *
 * LIVE EDITS (2026-09-18): events handed to the voice engine are committed —
 * an edit can only change steps that have NOT been delivered yet. A fixed
 * 1.5 s horizon therefore meant a note placed ahead of the playhead stayed
 * silent until the next loop. The horizon is now ADAPTIVE: while the page is
 * visible it is short (`liveHorizonSeconds`, ~120 ms, refilled every 25 ms —
 * edits land within about one beat-sixteenth), and when the page is hidden
 * it widens to `horizonSeconds` (1.5 s) so a background-throttled
 * setInterval (>= 1 Hz) still never starves the audio. The switch to the
 * long horizon runs synchronously on `visibilitychange`, before the browser
 * starts throttling timers.
 */

export interface EngineEvent {
  readonly type: "tick";
  /** Absolute audio-clock time in seconds. */
  readonly time: number;
  /** Global (monotonic across loops) step index. */
  readonly step: number;
}

export type ScheduleEventFn = (event: EngineEvent, when: number) => void;
export type ProvideEventsFn = (
  afterTime: number,
  untilTime: number,
) => readonly EngineEvent[];

export interface SchedulerOptions {
  /** Injected clock source (real, offline, or fake context). */
  getContext(): { readonly currentTime: number };
  scheduleEvent: ScheduleEventFn;
  provideEvents: ProvideEventsFn;
  /** Refill interval (default 25 ms — must sit well inside the live horizon). */
  readonly intervalMs?: number;
  /**
   * Background event horizon in seconds; 1-2 s covers 1 Hz timer throttling.
   * Passing it WITHOUT `liveHorizonSeconds` pins a fixed horizon (tests).
   */
  readonly horizonSeconds?: number;
  /** Foreground horizon in seconds (default 0.12): how late an edit can land. */
  readonly liveHorizonSeconds?: number;
  /** True while the page is hidden (default: document.visibilityState). */
  readonly isHidden?: () => boolean;
  /**
   * Subscribe to visibility changes; returns an unsubscribe. Default: the
   * document's `visibilitychange` event (no-op outside a browser).
   */
  readonly onVisibilityChange?: (fn: () => void) => () => void;
  /** Injectable timers for tests. */
  readonly setIntervalFn?: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
}

export class LookaheadScheduler {
  private readonly getContext: SchedulerOptions["getContext"];
  private readonly scheduleEvent: ScheduleEventFn;
  private readonly provideEvents: ProvideEventsFn;
  private readonly intervalMs: number;
  private readonly horizonSeconds: number;
  private readonly liveHorizonSeconds: number;
  private readonly isHidden: () => boolean;
  private readonly onVisibilityChange: NonNullable<
    SchedulerOptions["onVisibilityChange"]
  >;
  private unsubscribeVisibility: (() => void) | null = null;
  private readonly setIntervalFn: NonNullable<
    SchedulerOptions["setIntervalFn"]
  >;
  private readonly clearIntervalFn: NonNullable<
    SchedulerOptions["clearIntervalFn"]
  >;

  private queue: EngineEvent[] = [];
  private generatedUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SchedulerOptions) {
    this.getContext = opts.getContext;
    this.scheduleEvent = opts.scheduleEvent;
    this.provideEvents = opts.provideEvents;
    this.intervalMs = opts.intervalMs ?? 25;
    this.horizonSeconds = opts.horizonSeconds ?? 1.5;
    this.liveHorizonSeconds =
      opts.liveHorizonSeconds ??
      (opts.horizonSeconds !== undefined ? opts.horizonSeconds : 0.12);
    this.isHidden = opts.isHidden ?? defaultIsHidden;
    this.onVisibilityChange =
      opts.onVisibilityChange ?? defaultOnVisibilityChange;
    this.setIntervalFn =
      opts.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = opts.clearIntervalFn ?? ((id) => clearInterval(id));
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.queue = [];
    this.generatedUntil = this.getContext().currentTime;
    this.refill();
    this.timer = this.setIntervalFn(() => this.refill(), this.intervalMs);
    // Going hidden: widen to the background horizon NOW, while timers still
    // run at full rate. Coming back: nothing to do — the short horizon simply
    // stops delivering until playback catches up with what is committed.
    this.unsubscribeVisibility = this.onVisibilityChange(() => {
      if (this.timer !== null) this.refill();
    });
  }

  stop(): void {
    if (this.timer === null) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.queue = [];
    this.generatedUntil = 0;
  }

  private refill(): void {
    const now = this.getContext().currentTime;
    const horizon =
      now + (this.isHidden() ? this.horizonSeconds : this.liveHorizonSeconds);

    // Ask the compiler for events until the horizon is fully covered.
    // An empty response means "nothing more to generate" (end of song).
    while (this.generatedUntil < horizon) {
      const events = this.provideEvents(this.generatedUntil, horizon);
      for (const e of events) this.queue.push(e);
      this.generatedUntil = horizon;
      if (events.length === 0) break;
    }

    // Events must arrive sorted; only hand out what is inside the horizon.
    while (this.queue.length > 0 && this.queue[0].time <= horizon) {
      const event = this.queue.shift()!;
      this.scheduleEvent(event, event.time);
    }
  }
}

function defaultIsHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function defaultOnVisibilityChange(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}
