/**
 * Transport state machine: stopped/playing, loop on/off, BPM, swing.
 * Owns a LookaheadScheduler; the "compiler" (provideEvents) emits
 * metronome-style tick events at every 16th-step time (swing applied),
 * derived purely from absolute audio-clock times via time.ts.
 */

import {
  type EngineEvent,
  type ScheduleEventFn,
  LookaheadScheduler,
} from "./scheduler";
import {
  type LoopBars,
  type Position,
  STEPS_PER_BAR,
  barBeatStep,
  clampBpm,
  clampSwing,
  loopLengthSeconds,
  nextStepAtOrAfter,
  secondsPerStep,
  stepIndexAtTime,
  timeAtStep,
  totalSteps,
} from "./time";

export interface TransportSnapshot {
  readonly playing: boolean;
  readonly bpm: number;
  readonly swing: number;
  readonly loop: boolean;
  readonly loopBars: LoopBars;
}

export type TransportListener = (state: TransportSnapshot) => void;

export interface TransportOptions {
  getContext(): { readonly currentTime: number };
  scheduleEvent: ScheduleEventFn;
  /** Injected cancel: must cancel every pending scheduled event. */
  cancelScheduledEvents(): void;
  readonly loopBars?: LoopBars;
  readonly intervalMs?: number;
  readonly horizonSeconds?: number;
  readonly setIntervalFn?: NonNullable<
    import("./scheduler").SchedulerOptions["setIntervalFn"]
  >;
  readonly clearIntervalFn?: NonNullable<
    import("./scheduler").SchedulerOptions["clearIntervalFn"]
  >;
  /** Lead time before the first step sounds (seconds). */
  readonly startDelaySeconds?: number;
}

export class Transport {
  private readonly getContext: TransportOptions["getContext"];
  private readonly cancelScheduledEvents: () => void;
  private readonly startDelay: number;
  private readonly scheduler: LookaheadScheduler;
  private readonly listeners = new Set<TransportListener>();

  private _playing = false;
  private _bpm = 120;
  private _swing = 0;
  private _loop = true;
  private _loopBars: LoopBars;

  // Compile cursor: absolute audio time of the pass currently being generated.
  private passStart = 0;
  private stepInPass = 0;
  private passIndex = 0;
  private exhausted = false;

  // Absolute audio time when the timeline (step 0 of the first pass) sounds.
  private timelineStart = 0;
  // Loop-relative step offset the timeline started from.
  private startStep = 0;
  /**
   * IN-4 fix (verifier finding: LOOP off mid-play stalled the transport —
   * position parked at the window edge while `playing` stayed true and the
   * button read STOP): true once a non-looping playthrough has ENDED and the
   * transport auto-stopped. Parks the position display at the final step.
   */
  private oneShotEnded = false;

  constructor(opts: TransportOptions) {
    this.getContext = opts.getContext;
    this.cancelScheduledEvents = opts.cancelScheduledEvents;
    this.startDelay = opts.startDelaySeconds ?? 0.1;
    this._loopBars = opts.loopBars ?? 1;
    this.scheduler = new LookaheadScheduler({
      getContext: opts.getContext,
      scheduleEvent: opts.scheduleEvent,
      provideEvents: (after, until) => this.compileTicks(after, until),
      intervalMs: opts.intervalMs,
      horizonSeconds: opts.horizonSeconds,
      setIntervalFn: opts.setIntervalFn,
      clearIntervalFn: opts.clearIntervalFn,
    });
  }

  get snapshot(): TransportSnapshot {
    return {
      playing: this._playing,
      bpm: this._bpm,
      swing: this._swing,
      loop: this._loop,
      loopBars: this._loopBars,
    };
  }

  /** Typed observer; returns an unsubscribe function. No framework imports. */
  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Start playback. `offsetSeconds` positions playback inside the loop
   * pattern (seconds from the loop's step 0); the first sounding step is the
   * first step at or after that offset.
   */
  play(offsetSeconds = 0): void {
    if (this._playing) return;
    const now = this.getContext().currentTime;
    this.timelineStart = now + this.startDelay;
    const groove = { bpm: this._bpm, swing: this._swing };
    this.startStep = Math.min(
      nextStepAtOrAfter(offsetSeconds, groove),
      totalSteps(this._loopBars) - 1,
    );
    this.passStart = this.timelineStart;
    this.stepInPass = this.startStep;
    this.passIndex = 0;
    this.exhausted = false;
    this.oneShotEnded = false;
    this._playing = true;
    this.scheduler.start();
    this.emit();
  }

  stop(): void {
    if (!this._playing) return;
    this.scheduler.stop();
    this.cancelScheduledEvents();
    this._playing = false;
    this.emit();
  }

  setBpm(bpm: number): void {
    const next = clampBpm(bpm);
    if (next === this._bpm) return;
    this._bpm = next;
    this.emit();
  }

  setSwing(swing: number): void {
    const next = clampSwing(swing);
    if (next === this._swing) return;
    this._swing = next;
    this.emit();
  }

  setLoop(loop: boolean): void {
    if (loop === this._loop) return;
    this._loop = loop;
    this.emit();
  }

  setLoopBars(bars: LoopBars): void {
    if (bars === this._loopBars) return;
    this._loopBars = bars;
    this.emit();
  }

  /**
   * Current musical position derived exclusively from ctx.currentTime.
   * Before the timeline starts it reports the (pre-roll) start position.
   * With looping off and the pattern finished, reports the final step.
   */
  /**
   * Loop-relative seconds for the current audio-clock position (DES-4
   * playhead source). Same derivation as getPosition(): pre-roll reports the
   * start step's time; stopped reports the parked position; with looping off
   * and the pattern finished (IN-4: also after the auto-stop), the loop end.
   */
  getLoopTime(): number {
    const groove = { bpm: this._bpm, swing: this._swing };
    if (this.oneShotEnded) return loopLengthSeconds(this._loopBars, this._bpm);
    if (!this._playing) return timeAtStep(this.startStep, groove);
    const loopLen = loopLengthSeconds(this._loopBars, this._bpm);
    const elapsed = this.getContext().currentTime - this.timelineStart;
    if (elapsed < 0) return timeAtStep(this.startStep, groove);
    if (!this._loop && elapsed >= loopLen) return loopLen;
    return ((elapsed % loopLen) + loopLen) % loopLen;
  }

  getPosition(): Position {
    if (this.oneShotEnded)
      return barBeatStep(totalSteps(this._loopBars) - 1);
    if (!this._playing) return barBeatStep(this.startStep);
    const loopLen = loopLengthSeconds(this._loopBars, this._bpm);
    const elapsed = this.getContext().currentTime - this.timelineStart;
    const local =
      elapsed < 0
        ? timeAtStep(this.startStep, { bpm: this._bpm, swing: this._swing })
        : ((elapsed % loopLen) + loopLen) % loopLen;
    if (!this._loop && elapsed >= loopLen) {
      return barBeatStep(totalSteps(this._loopBars) - 1);
    }
    return barBeatStep(
      stepIndexAtTime(local, {
        bars: this._loopBars,
        bpm: this._bpm,
        swing: this._swing,
      }),
    );
  }

  private compileTicks(_after: number, until: number): readonly EngineEvent[] {
    // IN-4: a finished one-shot auto-stops on the first refill after its last
    // step has sounded — `playing` goes false (the button says PLAY again),
    // the position parks at the final step, and no later refill schedules or
    // emits anything. Nothing is cancelled: every compiled event has already
    // sounded, and tails (release + FX) ring out naturally.
    if (
      this.exhausted &&
      !this._loop &&
      this._playing &&
      this.getContext().currentTime >= this.passStart
    ) {
      this.finishOneShot();
      return [];
    }
    const events: EngineEvent[] = [];
    if (this.exhausted) return events;
    const groove = { bpm: this._bpm, swing: this._swing };
    const steps = totalSteps(this._loopBars);
    const stepDur = secondsPerStep(this._bpm);

    while (this.passStart + timeAtStep(this.stepInPass, groove) <= until) {
      const time = this.passStart + timeAtStep(this.stepInPass, groove);
      events.push({
        type: "tick",
        time,
        step: this.passIndex * steps + this.stepInPass,
      });
      this.stepInPass += 1;
      if (this.stepInPass === steps) {
        this.stepInPass = 0;
        this.passStart += steps * stepDur;
        this.passIndex += 1;
        if (!this._loop) {
          this.exhausted = true;
          break;
        }
      }
    }
    return events;
  }

  private emit(): void {
    const snap = this.snapshot;
    for (const listener of this.listeners) listener(snap);
  }

  /**
   * IN-4: the non-looping playthrough reached its end (all steps sounded).
   * Stop the scheduler, flip `playing` off, and park the position at the
   * final step — the observable "song finished" state. Re-enabling LOOP does
   * not resurrect playback (press PLAY); `play()` clears the parked flag.
   */
  private finishOneShot(): void {
    this.oneShotEnded = true;
    this.startStep = totalSteps(this._loopBars) - 1;
    this._playing = false;
    this.scheduler.stop();
    this.emit();
  }
}

// Re-export for consumer convenience without DOM/framework coupling.
export { STEPS_PER_BAR };
