/**
 * Lookahead scheduler.
 *
 * The ONLY scheduling authority is a compiled, sorted list of absolute
 * audio-clock events. This class never creates events; it asks the injected
 * `provideEvents(afterTime, untilTime)` "compiler" for events inside the
 * horizon and forwards each one, at its exact absolute time, to
 * `scheduleEvent(event, when)`.
 *
 * All timing decisions derive from ctx.currentTime exclusively, so a
 * background-throttled setInterval (>= 1 Hz) is covered by the 1-2 s horizon.
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
  /** Refill interval; 100-250 ms. */
  readonly intervalMs?: number;
  /** Event horizon in seconds; 1-2 s covers 1 Hz timer throttling. */
  readonly horizonSeconds?: number;
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
    this.intervalMs = opts.intervalMs ?? 200;
    this.horizonSeconds = opts.horizonSeconds ?? 1.5;
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
  }

  stop(): void {
    if (this.timer === null) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
    this.queue = [];
    this.generatedUntil = 0;
  }

  private refill(): void {
    const now = this.getContext().currentTime;
    const horizon = now + this.horizonSeconds;

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
