/**
 * Transport state machine: stopped/playing, loop on/off, BPM, swing.
 * Owns a LookaheadScheduler; the "compiler" (provideEvents) emits
 * metronome-style tick events at every 16th-step time (swing applied),
 * derived purely from absolute audio-clock times via time.ts.
 *
 * LL-2 (i3-4, KL-1 position law — the playhead-basis swap): the transport's
 * cycle basis is the LCM OF LANE CHAIN TOTALS, pushed by the engineBridge
 * as `cycleSteps` (the same LCM the offline export renders — i3-5; at
 * powers-of-two chain totals it is simply the longest lane). The global
 * step stream is unchanged: each pass compiles `cycleSteps` steps, so the
 * booth's BAR.BEAT.STEP readout wraps at the full LCM cycle and a LOOP-off
 * one-shot plays EXACTLY one full LCM cycle then parks. Per-lane sweeps
 * are computed grid-side against each lane's OWN chain total (LaneGrid's
 * readFrame) — the transport stays the one global clock.
 */

import {
  type EngineEvent,
  type ScheduleEventFn,
  LookaheadScheduler,
} from "./scheduler";
import {
  type Position,
  STEPS_PER_BAR,
  barBeatStep,
  clampBpm,
  clampSwing,
  nextStepAtOrAfter,
  secondsPerStep,
  stepIndexAtTime,
  timeAtStep,
} from "./time";

export interface TransportSnapshot {
  readonly playing: boolean;
  readonly bpm: number;
  readonly swing: number;
  readonly loop: boolean;
  /** LL-2: the cycle basis = the LCM of lane chain totals (steps). */
  readonly cycleSteps: number;
}

export type TransportListener = (state: TransportSnapshot) => void;

export interface TransportOptions {
  getContext(): { readonly currentTime: number };
  scheduleEvent: ScheduleEventFn;
  /** Injected cancel: must cancel every pending scheduled event. */
  cancelScheduledEvents(): void;
  /**
   * LL-2: the transport's cycle basis in steps (= the LCM of lane chain
   * totals; the engineBridge derives it from the document). Default 16 =
   * one bar (the fresh project's LCM).
   */
  readonly cycleSteps?: number;
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
  /** LL-2: the cycle basis (steps) — see the class doc. */
  private _cycleSteps: number;

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
    this._cycleSteps = opts.cycleSteps ?? 16;
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
      cycleSteps: this._cycleSteps,
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
      this._cycleSteps - 1,
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
    // R-3 (critique P2-4 / deferred #11, the IN-4 non-blocking note): a
    // one-shot pass EXHAUSTS its compile cursor one horizon before the last
    // step sounds. Re-enabling LOOP inside that window used to leave
    // `exhausted` latched: compileTicks returned [] forever while `playing`
    // stayed true (dead air; the auto-stop can never fire either — it
    // requires !loop). Re-arm the cursor so looping RESUMES: seamlessly at
    // the upcoming pass boundary while the tail still sounds, else from the
    // first step at/after now. Leave-loop-off and the whole IN-4 one-shot
    // auto-stop law are untouched (the re-arm only runs on loop=true).
    if (loop && this.exhausted && this._playing) this.rearmAfterExhaustion();
    this.emit();
  }

  /**
   * R-3: point the compile cursor at the first step that has not sounded.
   * The exhaustion break compiled THROUGH the pass end only, so nothing
   * before the cursor can double-schedule; steps already past are skipped
   * (they were never heard — scheduling them now would be a late burst).
   */
  private rearmAfterExhaustion(): void {
    const now = this.getContext().currentTime;
    const groove = { bpm: this._bpm, swing: this._swing };
    const steps = this._cycleSteps;
    const loopLen = steps * secondsPerStep(this._bpm);
    // Skip whole passes that ended while the auto-stop raced us (normally
    // < one refill interval; a throttled background tab can make this
    // several — the 1-2 s horizon still covers the resume).
    while (this.passStart + loopLen <= now) {
      this.passStart += loopLen;
      this.passIndex += 1;
    }
    // First step of the current pass at/after now (nextStepAtOrAfter is 0
    // for a not-yet-started pass: the seamless tail case). The clamp mirrors
    // play()'s startStep law for the swung last-step edge.
    this.stepInPass = Math.min(
      nextStepAtOrAfter(now - this.passStart, groove),
      steps - 1,
    );
    this.exhausted = false;
  }

  /**
   * LL-2: set the cycle basis (the engineBridge's LCM of lane chain totals).
   * Value-compared — a no-op push never emits.
   *
   * MID-PLAY changes (a reachable gesture since BC-1: the rail `+` appends a
   * 1-bar blank to a playing lane's chain; LL-1's resize edits a chained
   * pattern) RE-BASE THE CURSOR ON THE ABSOLUTE STEP GRID: the session's
   * lane anchors ride the global step stream, so the stream must stay
   * CONTIGUOUS across the swap (no gap, no duplicate — the quantized-switch
   * boundary windows depend on it; the CI touch-gate fix lineage's
   * iteration-mode defer windows are computed against `lastDeliveredStep`).
   * Passes are even-carved (cycle totals are multiples of 16 steps), so an
   * absolute step's sounding time decomposes exactly across any carving:
   * the re-based pass restarts so the next unsounded step keeps its exact
   * timeline slot. While exhausted (the one-shot tail) the cursor is spent —
   * only the basis swaps (the auto-stop/re-arm laws then run on the new
   * length; a corner, never reachable without a chain edit inside the final
   * 1.5 s tail of a LOOP-off pass).
   */
  setCycleSteps(steps: number): void {
    if (steps === this._cycleSteps) return;
    if (this._playing && !this.exhausted) {
      const abs = this.passIndex * this._cycleSteps + this.stepInPass;
      this.passIndex = Math.floor(abs / steps);
      this.stepInPass = abs - this.passIndex * steps;
      this.passStart =
        this.timelineStart +
        this.passIndex * steps * secondsPerStep(this._bpm);
    }
    this._cycleSteps = steps;
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
    if (this.oneShotEnded)
      return this._cycleSteps * secondsPerStep(this._bpm);
    if (!this._playing) return timeAtStep(this.startStep, groove);
    const loopLen = this._cycleSteps * secondsPerStep(this._bpm);
    const elapsed = this.getContext().currentTime - this.timelineStart;
    if (elapsed < 0) return timeAtStep(this.startStep, groove);
    if (!this._loop && elapsed >= loopLen) return loopLen;
    return ((elapsed % loopLen) + loopLen) % loopLen;
  }

  getPosition(): Position {
    if (this.oneShotEnded) return barBeatStep(this._cycleSteps - 1);
    if (!this._playing) return barBeatStep(this.startStep);
    const loopLen = this._cycleSteps * secondsPerStep(this._bpm);
    const elapsed = this.getContext().currentTime - this.timelineStart;
    const local =
      elapsed < 0
        ? timeAtStep(this.startStep, { bpm: this._bpm, swing: this._swing })
        : ((elapsed % loopLen) + loopLen) % loopLen;
    if (!this._loop && elapsed >= loopLen) {
      return barBeatStep(this._cycleSteps - 1);
    }
    return barBeatStep(
      stepIndexAtTime(local, {
        steps: this._cycleSteps,
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
    const steps = this._cycleSteps;
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
    this.startStep = this._cycleSteps - 1;
    this._playing = false;
    this.scheduler.stop();
    this.emit();
  }
}

// Re-export for consumer convenience without DOM/framework coupling.
export { STEPS_PER_BAR };
