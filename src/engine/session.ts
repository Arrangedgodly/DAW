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
import {
  STEPS_PER_BEAT,
  STEPS_PER_BAR,
  clampSwing,
  stepIndexAtTime,
} from "../audio/time";
import { type LaneSchedule, type LaneSegment } from "../audio/song";
import { clamp } from "../lib/clamp";
import {
  type DrumKit,
  type VoiceNoteOnEvent,
  type VoicePreset,
  getDrumKit,
  getPreset,
  noteParamsFor,
  sampleRefsForSound,
} from "../audio/presets";
import {
  type LaneVoiceRouter,
  type SampleVoiceContextLike,
  type SampleVoiceHost,
  createLaneVoiceRouter,
  createSampleVoiceHostFor,
} from "../audio/voiceEngine";
import {
  type VoiceEngineHost,
  createVoiceEngine,
  createBitcrusherNode,
  isWorkletCapable,
  workletContextFor,
} from "../audio/voiceEngine";
import {
  type FxConn,
  type FxDevice,
  type FxTiming,
  FxChainHost,
  type RampGainLike,
  createRealFxDeviceFactory,
  createSoftClipNode,
} from "../audio/fx";
import {
  DEFAULT_LANE_MIX,
  DRUM_PIECES,
  LANE_IDS,
  type DrumPiece,
  type LaneId,
  type LaneMix,
  laneMixGain,
} from "../document/schema";
import {
  type EffectiveScale,
  degreeToMidi,
  toEffectiveScale,
} from "../document/scales";

/** Audio-node surface the default metronome/master wiring needs. */
interface AudioNodeContext extends AudioContextLike {
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createWaveShaper(): WaveShaperNode;
}

function hasAudioNodes(ctx: AudioContextLike): ctx is AudioNodeContext {
  return (
    "destination" in ctx &&
    typeof (ctx as AudioNodeContext).createOscillator === "function" &&
    typeof (ctx as AudioNodeContext).createGain === "function" &&
    typeof (ctx as AudioNodeContext).createWaveShaper === "function"
  );
}

export type TickSoundPlayer = (when: number, downbeat: boolean) => void;

// --- IM-7 helpers: chain-schedule surgery (pure, module-private) ------------

/** Engine-side pending quantized switch (mutable state lives per lane). */
interface PendingSwitch {
  readonly laneId: LaneId;
  readonly toPatternId: string;
  /** Standalone-compiled schedule of the target pattern (one segment). */
  readonly schedule: LaneSchedule;
  /** Exact global step where the switch lands (null = once playing). */
  readonly appliesAtStep: number | null;
  readonly segmentIndex: number;
  /** "boundary" = in-place slot swap; "iteration" = rebuild at chain wrap. */
  readonly mode: "boundary" | "iteration";
}

export interface PendingSwitchSnapshot {
  readonly lane: LaneId;
  readonly fromPatternId: string;
  readonly toPatternId: string;
  readonly appliesAtStep: number | null;
  readonly mode: "boundary" | "iteration";
}

function snapshotSwitch(
  lane: LaneId,
  pending: PendingSwitch,
  fromPatternId: string,
): PendingSwitchSnapshot {
  return {
    lane,
    fromPatternId,
    toPatternId: pending.toPatternId,
    appliesAtStep: pending.appliesAtStep,
    mode: pending.mode,
  };
}

/** Same segment id/steps sequence → structure unchanged (content edit). */
function sameStructure(a: LaneSchedule, b: LaneSchedule): boolean {
  if (a.segments.length !== b.segments.length) return false;
  return a.segments.every(
    (s, i) =>
      s.patternId === b.segments[i].patternId &&
      s.steps === b.segments[i].steps,
  );
}

/**
 * Refinement-7 (critique P2-3 / deferred #14 — the HW-5 observation): one
 * sounding-ledger entry per lane, stamped with the ABSOLUTE AUDIO-CLOCK time
 * a chain slot's first step sounds. Delivery runs a horizon AHEAD of
 * audibility and lastDeliveredStep is a session-lifetime high-water mark, so
 * the rail's active-tile follow looks entries up against ctx.currentTime
 * instead: the tile lights when the slot SOUNDS, not when the engine hands
 * it over (transport-accurate), and never disturbs scheduling — IM-7 switch
 * and schedule-build semantics are untouched.
 */
interface SoundingEntry {
  readonly at: number;
  readonly patternId: string;
}

/**
 * Rewrite `byStep` so `slot` plays `pattern`'s events at the slot's position
 * (in-place slot substitution — same step count by construction).
 */
function substituteInPlace(
  byStep: Map<number, readonly VoiceNoteOnEvent[]>,
  slot: LaneSegment,
  pattern: LaneSchedule,
): void {
  for (let s = slot.startStep; s < slot.startStep + slot.steps; s++)
    byStep.delete(s);
  for (const [step, events] of pattern.byStep) {
    byStep.set(step + slot.startStep, [...events]);
  }
}

/** Copy steps [from, from+count) of `source` into `target` at `to`. */
function mergeShifted(
  target: Map<number, readonly VoiceNoteOnEvent[]>,
  source: ReadonlyMap<number, readonly VoiceNoteOnEvent[]>,
  to: number,
  from: number,
  count = Number.POSITIVE_INFINITY,
): void {
  for (const [step, events] of source) {
    if (step >= from && step < from + count) {
      target.set(step - from + to, [...events]);
    }
  }
}

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
  /**
   * Injectable voice-engine host factory (tests). Receives the raw context;
   * returns null when the context cannot host worklets (node fakes).
   */
  readonly createVoiceEngineHost?: (
    ctx: AudioContextLike,
  ) => Promise<VoiceEngineHost | null>;
  /**
   * PS-4: injectable sample-voice host factory (tests). Receives the raw
   * context; null when it cannot host AudioBufferSourceNodes (node fakes).
   */
  readonly createSampleVoiceHost?: (
    ctx: AudioContextLike,
  ) => Promise<SampleVoiceHost | null>;
}

export class Session {
  readonly engine: AudioEngineContext;
  readonly transport: Transport;

  private _metronome = false;
  private _volume = 0.9;
  private master: GainNode | null = null;
  private readonly playTickSound: TickSoundPlayer;
  private readonly cancelTickSounds: () => void;
  private readonly createVoiceEngineHost: NonNullable<
    SessionOptions["createVoiceEngineHost"]
  >;
  private readonly createSampleVoiceHostImpl: NonNullable<
    SessionOptions["createSampleVoiceHost"]
  >;
  private voiceEnginePromise: Promise<LaneVoiceRouter | null> | null = null;
  /** PS-4: the live context's native sample-voice host (lazy, retryable). */
  private sampleHostPromise: Promise<SampleVoiceHost | null> | null = null;
  /** Current sound id per lane (presetId for pitched, kitId for drums). */
  private laneSounds: Record<LaneId, string> = {
    drums: "kit-default",
    bass: "preset-bass-1",
    chords: "preset-chords-1",
    lead: "preset-lead-1",
  };
  /**
   * Effective scale per pitched lane (IM-6): the engineBridge pushes
   * effectiveScale(project, lane) here so audition matches what compilation
   * plays. Falls back to the document default (C minor) until connected.
   */
  private laneScales: Partial<
    Record<Exclude<LaneId, "drums">, EffectiveScale>
  > = {};

  constructor(opts: SessionOptions = {}) {
    this.engine = opts.engine ?? new AudioEngineContext();
    this.playTickSound = opts.playTickSound ?? this.defaultPlayTick.bind(this);
    this.cancelTickSounds =
      opts.cancelTickSounds ?? this.defaultCancelTicks.bind(this);
    this.createVoiceEngineHost =
      opts.createVoiceEngineHost ?? this.defaultCreateVoiceEngine.bind(this);
    this.createSampleVoiceHostImpl =
      opts.createSampleVoiceHost ??
      this.defaultCreateSampleVoiceHost.bind(this);
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
    // Refinement-7: a stop CANCELS every event still inside the audible
    // future (transport.stop → cancelScheduledEvents). Truncate the sounding
    // ledgers at the stop moment so the rail follow parks on the last slot
    // that actually sounded — time keeps flowing past the cancelled stamps,
    // so the lookup alone could not tell "sounded" from "cancelled". (The
    // IN-4 auto-stop is a no-op here: everything compiled has sounded.)
    this.transport.subscribe((snap) => {
      if (snap.playing) return;
      const now = this.engine.getContext().currentTime;
      for (const ledger of this.soundingLedger) {
        while (ledger.length > 0 && ledger[ledger.length - 1]!.at > now)
          ledger.pop();
      }
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
      this.stopAllVoices();
    } else {
      // Warm the voice engines during the pre-roll so the first pattern step
      // is never dropped waiting on the worklet module load.
      this.resetVoiceStealCount(); // steal stats are per-play (HU-2)
      // R-3: play-from-stop FLUSHES the delivery cursor. The new play's
      // global step restarts at 0, so every lane's chain-local 0 must be
      // that step — anchors and lastDeliveredStep are otherwise
      // session-lifetime state left over from the previous pass (a mid-play
      // iteration-mode rebuild can leave an anchor non-aligned with the
      // current chain length, mis-placing or silencing the first iteration
      // of the next play; a stale high-water step defers stopped switch
      // requests past slot 0). Same law as the while-stopped schedule push.
      for (const pb of this.lanePlayback) pb.anchorStep = 0;
      this.lastDeliveredStep = -1;
      // Refinement-7: the sounding ledger is per-play too — a fresh play's
      // follow starts at the chain's slot 0 (imminent entry), never parked on
      // the previous play's last-sounded slot.
      for (const ledger of this.soundingLedger) ledger.length = 0;
      if (this.lanePlayback.length > 0) void this.ensureVoiceEngine();
      this.transport.play();
    }
  }

  setLoop(on: boolean): void {
    this.transport.setLoop(on);
  }

  /** Clamps and forwards to the transport (single clamping authority). */
  setBpm(bpm: number): void {
    this.transport.setBpm(bpm);
    // Tempo-synced devices (delay) glide to the new musical time (τ=15 ms).
    for (const chain of this.chainHosts) chain?.syncBpm(false);
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

  /**
   * HU-2 device-change pop guard: a ~30 ms fade to silence and back (130 ms)
   * around an audio device transition. No-op until the master gain exists
   * (nothing is sounding). The context is NEVER recreated — voices would die.
   */
  duckMaster(): void {
    if (!this.master) return;
    const t = this.engine.getContext().currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.03);
    g.linearRampToValueAtTime(this._volume, t + 0.13);
  }

  // -------------------------------------------------------------------------
  // Voice-steal stats (HU-2) — DEV/e2e-inspectable only, by design.
  //
  // Rationale (recorded per the town-hall "no dropouts surprise" claim):
  // stealing IS the policy working — free→oldest-release→oldest with a 4 ms
  // de-click fade guarantees a voice for every event within the 8/lane pool.
  // Surfacing it as user UI would advertise correct behavior as a failure.
  // The counter is exposed for console/e2e assertions only, reset per play.
  // -------------------------------------------------------------------------

  private stolenVoices = 0;

  /** Voices stolen this play (console/e2e diagnostics; not user UI). */
  get voiceStealCount(): number {
    return this.stolenVoices;
  }

  /** Reset per play (togglePlay's start branch). */
  resetVoiceStealCount(): void {
    this.stolenVoices = 0;
  }

  /** VoiceEngineHost onStolen callback (real worklet path only). */
  private noteVoiceStolen(): void {
    this.stolenVoices += 1;
  }

  /** Transport observer passthrough (coarse state only, never 60 Hz data). */
  subscribe(
    listener: import("../audio/transport").TransportListener,
  ): () => void {
    return this.transport.subscribe(listener);
  }

  /** Only quarter-note steps click; bar starts get the downbeat pitch. */
  private onScheduledTick(step: number, when: number): void {
    this.deliverLaneEvents(step, when);
    if (!this._metronome) return;
    if (step % STEPS_PER_BEAT !== 0) return;
    this.playTickSound(when, step % STEPS_PER_BAR === 0);
  }

  // -------------------------------------------------------------------------
  // Pattern playback seam (DES-4 → IM-7: per-lane chains + quantized switching)
  // -------------------------------------------------------------------------

  /**
   * Per-lane chain playback state (IM-7). The document's song chain compiles
   * (pure, src/audio/song.ts) into a LaneSchedule; the session owns the
   * PLAYBACK cursor and every live mutation of it:
   *
   * - `anchorStep` — global step of chain-local step 0 for the iteration the
   *   cursor is in. Chain-local step = step − anchor (advanced per delivered
   *   step; each lane wraps independently — poly-loop).
   * - PENDING SWITCH — `setActivePattern` records {requested, appliesAtStep}
   *   where appliesAtStep is the FIRST segment boundary of that lane strictly
   *   after the last step already handed to the voice engine (exact step,
   *   observable). When delivery reaches it, the target slot's pattern is
   *   substituted for this and every future iteration (engine state, NOT a
   *   document edit). Same bar count → exact boundary substitution; different
   *   bar count → the whole schedule is rebuilt at the next chain-iteration
   *   boundary (segment lengths change; no mid-iteration chaos).
   * - PENDING SCHEDULE — chain edits pushed while playing (structure change:
   *   different segment sequence) are deferred to the lane's next iteration
   *   boundary. Same-sequence pushes (pattern content/gate/preset edits) swap
   *   the event map immediately (DES-4 rule: next un-emitted step) and
   *   re-apply stored same-shape substitutions. A structure change supersedes
   *   a pending switch and drops substitutions (the chain IS the arrangement).
   * - While stopped, a switch request is stored pending and applies at the
   *   first boundary once playing (slot 0 at play start).
   */
  private lanePlayback: {
    schedule: LaneSchedule;
    /** Global step where the current iteration started (chain-local 0). */
    anchorStep: number;
    /** Live slot substitutions: segment index → pattern schedule. */
    substitutions: Map<number, { patternId: string; schedule: LaneSchedule }>;
    pendingSwitch: PendingSwitch | null;
    pendingSchedule: LaneSchedule | null;
    /** Pattern id a pending switch/last switch targeted (UI state source). */
    activePatternId: string;
  }[] = [];

  /** Engine-side pending switch (observable for the DES-6 pending indicator). */
  private switchListeners = new Set<(lane: LaneId) => void>();
  /** Highest global step already handed to the voice engines. */
  private lastDeliveredStep = -1;
  /**
   * Refinement-7: per-lane sounding ledger (see SoundingEntry). Appended in
   * deliverLaneEvents whenever the lane's delivery crosses into a different
   * chain segment; pruned to one audible-past anchor + the audible future.
   */
  private soundingLedger: SoundingEntry[][] = [];

  getPendingSwitch(lane: LaneId): PendingSwitchSnapshot | null {
    const pb = this.lanePlayback[LANE_IDS.indexOf(lane)];
    if (!pb?.pendingSwitch) return null;
    const from =
      pb.schedule.segments[pb.pendingSwitch.segmentIndex]?.patternId ??
      pb.activePatternId;
    return snapshotSwitch(lane, pb.pendingSwitch, from);
  }

  /** Pattern id the lane's active slot plays (post-switch state). */
  getActivePattern(lane: LaneId): string | null {
    return this.lanePlayback[LANE_IDS.indexOf(lane)]?.activePatternId ?? null;
  }

  /**
   * Refinement-7: the pattern this lane is SOUNDING at the audio clock's now
   * (the rail active-tile source). While playing: the latest entry that has
   * become audible — or, before the first step sounds (the pre-roll), the
   * imminent first entry, so the slot about to sound reads active. While
   * stopped: parks on the last pattern that actually sounded; null before
   * any playback (callers fall back to getActivePattern). Entries scheduled
   * but cancelled by a stop (still in the audible future) never read.
   */
  getSoundingPattern(lane: LaneId): string | null {
    const ledger = this.soundingLedger[LANE_IDS.indexOf(lane)];
    if (!ledger || ledger.length === 0) return null;
    const now = this.engine.getContext().currentTime;
    let sounding: SoundingEntry | null = null;
    for (const entry of ledger) {
      if (entry.at <= now) sounding = entry;
      else break;
    }
    if (sounding) return sounding.patternId;
    return this.transport.snapshot.playing ? ledger[0]!.patternId : null;
  }

  /** Observe pending-switch changes (request/apply/cancel); unsubscribing. */
  subscribeSwitches(listener: (lane: LaneId) => void): () => void {
    this.switchListeners.add(listener);
    return () => this.switchListeners.delete(listener);
  }

  /**
   * DES-6: true when a chain STRUCTURE edit is still deferred to this lane's
   * next iteration boundary (queued by setLaneSchedule while playing). Lets
   * the pattern rail show "pending" for arrangement edits too, not just
   * pattern switches.
   */
  hasPendingSchedule(lane: LaneId): boolean {
    return this.lanePlayback[LANE_IDS.indexOf(lane)]?.pendingSchedule != null;
  }

  private emitSwitch(lane: LaneId): void {
    for (const l of this.switchListeners) l(lane);
  }

  /**
   * Push a compiled chain schedule (engineBridge). Structure changes (the
   * segment id/steps sequence differs) are deferred to the lane's next
   * iteration boundary while playing; same-structure pushes replace the
   * event map immediately (next un-emitted step, DES-4) and replay same-shape
   * substitutions.
   */
  setLaneSchedule(laneId: LaneId, schedule: LaneSchedule): void {
    const index = LANE_IDS.indexOf(laneId);
    const current = this.lanePlayback[index];
    if (!current || !this.transport.snapshot.playing) {
      this.lanePlayback[index] = {
        schedule,
        anchorStep: 0,
        substitutions: new Map(),
        pendingSwitch: null,
        pendingSchedule: null,
        activePatternId: schedule.segments[0]?.patternId ?? "",
      };
      this.emitSwitch(laneId);
      return;
    }
    if (sameStructure(current.schedule, schedule)) {
      // Content edit: swap events, keep cursor, replay surviving substitutions.
      const next = new Map(schedule.byStep);
      for (const [segIndex, sub] of current.substitutions) {
        const seg = schedule.segments[segIndex];
        if (seg && seg.steps === sub.schedule.chainSteps) {
          substituteInPlace(next, seg, sub.schedule);
        }
      }
      current.schedule = { ...schedule, byStep: next };
      return;
    }
    // Structure edit: quantized to the next iteration boundary.
    current.pendingSchedule = schedule;
    current.pendingSwitch = null; // chain edit supersedes a pending switch
    current.substitutions.clear();
    this.emitSwitch(laneId);
  }

  /**
   * QUANTIZED LIVE SWITCH (IM-7): request that this lane's active chain slot
   * becomes `patternId` at the lane's next pattern boundary. `patternSchedule`
   * is the target pattern compiled standalone (one segment). Takes effect at
   * exactly `appliesAtStep` (observable via getPendingSwitch/subscribeSwitches)
   * — never mid-pattern, never touching other lanes.
   */
  setActivePattern(
    laneId: LaneId,
    patternId: string,
    patternSchedule: LaneSchedule,
  ): void {
    const index = LANE_IDS.indexOf(laneId);
    const pb = this.lanePlayback[index];
    if (!pb) return;
    // Boundary selection (documented): the FIRST upcoming boundary of this
    // lane strictly after the last emitted step. If the requested pattern has
    // the same bar count as that boundary's slot, the switch lands exactly
    // there ("boundary" mode). Otherwise it is deferred to the next chain-
    // ITERATION boundary ("iteration" mode — segment lengths change, so the
    // schedule is rebuilt there, never mid-iteration).
    const boundary = this.transport.snapshot.playing
      ? this.nextBoundaryAfter(
          index,
          this.lastDeliveredStep,
          patternSchedule.chainSteps,
        )
      : null;
    if (
      boundary &&
      boundary.mode === "boundary" &&
      pb.schedule.segments[boundary.segment].patternId === patternId
    ) {
      // Switching to what the slot already plays = cancel any pending switch.
      pb.pendingSwitch = null;
      pb.substitutions.delete(boundary.segment);
      this.emitSwitch(laneId);
      return;
    }
    pb.pendingSwitch = {
      laneId,
      toPatternId: patternId,
      schedule: patternSchedule,
      appliesAtStep: boundary ? boundary.step : null,
      segmentIndex: boundary ? boundary.segment : 0,
      mode: boundary ? boundary.mode : "iteration",
    };
    this.emitSwitch(laneId);
  }

  /**
   * First boundary of lane `index` strictly after `fromStep`. A pattern of
   * `candidateSteps` steps fits at the first upcoming slot only when the bar
   * count matches; otherwise the boundary is the next iteration wrap.
   */
  private nextBoundaryAfter(
    index: number,
    fromStep: number,
    candidateSteps: number,
  ): { step: number; segment: number; mode: "boundary" | "iteration" } | null {
    const pb = this.lanePlayback[index];
    if (!pb || pb.schedule.segments.length === 0) return null;
    const { chainSteps, segments } = pb.schedule;
    let local: number;
    let iterationStart: number;
    if (fromStep < 0) {
      local = -1; // before anything: the first boundary is iteration step 0
      iterationStart = 0;
    } else {
      local =
        (((fromStep - pb.anchorStep) % chainSteps) + chainSteps) % chainSteps;
      iterationStart = fromStep - local;
    }
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startStep > local) {
        return segments[i].steps === candidateSteps
          ? {
              step: iterationStart + segments[i].startStep,
              segment: i,
              mode: "boundary",
            }
          : {
              step: iterationStart + chainSteps,
              segment: 0,
              mode: "iteration",
            };
      }
    }
    // Past the last segment: the next iteration's slot 0.
    return segments[0].steps === candidateSteps
      ? { step: iterationStart + chainSteps, segment: 0, mode: "boundary" }
      : { step: iterationStart + chainSteps, segment: 0, mode: "iteration" };
  }

  private applyDueSwitch(
    pb: (typeof this.lanePlayback)[number],
    step: number,
  ): void {
    const pending = pb.pendingSwitch;
    if (!pending) return;
    // Must land exactly ON a segment boundary of the current schedule.
    const { chainSteps, segments } = pb.schedule;
    const local =
      (((step - pb.anchorStep) % chainSteps) + chainSteps) % chainSteps;
    const segIndex = segments.findIndex((s) => s.startStep === local);
    const atBoundary = segIndex >= 0;
    const due =
      pending.appliesAtStep !== null
        ? step >= pending.appliesAtStep && atBoundary
        : atBoundary; // requested while stopped: first boundary once playing
    if (!due) return;
    if (pending.mode === "boundary") {
      const seg = segments[segIndex];
      if (!seg || seg.steps !== pending.schedule.chainSteps) {
        // Shape drifted (structure edit raced us) — drop rather than corrupt.
        pb.pendingSwitch = null;
        this.emitSwitch(pending.laneId);
        return;
      }
      const byStep = new Map(pb.schedule.byStep);
      substituteInPlace(byStep, seg, pending.schedule);
      pb.schedule = {
        chainSteps,
        segments: segments.map((s, i) =>
          i === segIndex ? { ...s, patternId: pending.toPatternId } : s,
        ),
        byStep,
      };
      pb.substitutions.set(segIndex, {
        patternId: pending.toPatternId,
        schedule: pending.schedule,
      });
    } else {
      // Different bar count: rebuild at this iteration boundary so every
      // following segment shifts by the length delta, exactly.
      const target = segments[segIndex] ?? segments[0];
      const i = segments.indexOf(target);
      const newSegments: LaneSegment[] = [];
      const byStep = new Map<number, VoiceNoteOnEvent[]>();
      let cursor = 0;
      segments.forEach((seg, j) => {
        if (j === i) {
          newSegments.push({
            patternId: pending.toPatternId,
            startStep: cursor,
            steps: pending.schedule.chainSteps,
          });
          mergeShifted(byStep, pending.schedule.byStep, cursor, 0);
          cursor += pending.schedule.chainSteps;
        } else {
          newSegments.push({ ...seg, startStep: cursor });
          mergeShifted(
            byStep,
            pb.schedule.byStep,
            cursor,
            seg.startStep,
            seg.steps,
          );
          cursor += seg.steps;
        }
      });
      pb.schedule = { chainSteps: cursor, segments: newSegments, byStep };
      pb.substitutions.set(i, {
        patternId: pending.toPatternId,
        schedule: pending.schedule,
      });
      pb.anchorStep = step; // this boundary starts the rebuilt iteration
    }
    pb.activePatternId = pending.toPatternId;
    pb.pendingSwitch = null;
    this.emitSwitch(pending.laneId);
  }

  /**
   * Legacy single-pattern seam (DES-4 tests): builds a one-segment schedule.
   */
  setLaneEvents(
    laneId: LaneId,
    events: readonly VoiceNoteOnEvent[],
    patternSteps: number,
  ): void {
    const byStep = new Map<number, VoiceNoteOnEvent[]>();
    const groove = {
      bpm: this.transport.snapshot.bpm,
      swing: this.transport.snapshot.swing,
    };
    for (const event of events) {
      const step = stepIndexAtTime(event.time, {
        bars: 4,
        bpm: groove.bpm,
        swing: groove.swing,
      });
      const bucket = byStep.get(step);
      if (bucket) bucket.push(event);
      else byStep.set(step, [event]);
    }
    this.setLaneSchedule(laneId, {
      chainSteps: patternSteps,
      segments: [
        {
          patternId: this.getActivePattern(laneId) ?? "pattern",
          startStep: 0,
          steps: patternSteps,
        },
      ],
      byStep,
    });
  }

  /** Step-local delivery on the transport tick: the audio path for patterns. */
  private deliverLaneEvents(step: number, when: number): void {
    if (this.lanePlayback.length === 0) return;
    this.lastDeliveredStep = Math.max(this.lastDeliveredStep, step);
    void this.ensureVoiceEngine().then((host) => {
      if (!host) return;
      const laneCount = LANE_IDS.length;
      for (let i = 0; i < laneCount; i++) {
        const pb = this.lanePlayback[i];
        if (!pb) continue;
        let local = step - pb.anchorStep;
        // A deferred structure swap lands exactly on an iteration boundary.
        if (
          pb.pendingSchedule &&
          ((local % pb.schedule.chainSteps) + pb.schedule.chainSteps) %
            pb.schedule.chainSteps ===
            0 &&
          local >= 0
        ) {
          pb.schedule = pb.pendingSchedule;
          pb.pendingSchedule = null;
          pb.anchorStep = step;
          local = 0;
          // DES-6: the rail's structure-pending indicator clears exactly here.
          this.emitSwitch(LANE_IDS[i]);
        }
        while (local >= pb.schedule.chainSteps) {
          pb.anchorStep += pb.schedule.chainSteps;
          local -= pb.schedule.chainSteps;
        }
        this.applyDueSwitch(pb, step);
        // Recompute local: a rebuild switch may have re-anchored.
        local =
          (((step - pb.anchorStep) % pb.schedule.chainSteps) +
            pb.schedule.chainSteps) %
          pb.schedule.chainSteps;
        // Refinement-7: record the sounding slot for the rail follow. The
        // entry carries this tick's AUDIBLE time (delivery runs ahead), so
        // the ledger can be read time-accurately against ctx.currentTime.
        const seg = pb.schedule.segments.find(
          (s) => local >= s.startStep && local < s.startStep + s.steps,
        );
        if (seg) {
          const ledger = (this.soundingLedger[i] ??= []);
          const last = ledger[ledger.length - 1];
          if (!last || last.patternId !== seg.patternId)
            ledger.push({ at: when, patternId: seg.patternId });
          // Prune: one audible-past anchor + the audible future is all the
          // lookup ever needs (bounded across arbitrarily long playback).
          const now = this.engine.getContext().currentTime;
          while (ledger.length > 1 && ledger[1]!.at <= now) ledger.shift();
        }
        const events = pb.schedule.byStep.get(local);
        if (events)
          host.sendEvents(
            i,
            events.map((e) => ({ ...e, time: when })),
          );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Voice engine + audition (IM-3)
  // -------------------------------------------------------------------------

  /** Choose the sound a lane auditions with (presetId or kitId). */
  setLaneSound(laneId: LaneId, presetOrKitId: string): void {
    this.laneSounds[laneId] = presetOrKitId;
  }

  /** Set the effective scale a pitched lane auditions in (engineBridge). */
  setLaneScale(
    laneId: Exclude<LaneId, "drums">,
    scale: EffectiveScale | null,
  ): void {
    if (scale === null) delete this.laneScales[laneId];
    else this.laneScales[laneId] = scale;
  }

  /**
   * AUDITION: trigger one voice of a lane immediately (grid placement,
   * browser). `degreeOrDrum` is a scale degree for pitched lanes or a drum
   * piece for the drums lane. Pitched lanes resolve the degree against the
   * lane's effective scale (chord lanes trigger the diatonic triad, matching
   * compileLaneEvents' stackChord semantics).
   */
  async audition(
    laneId: LaneId,
    degreeOrDrum: number | DrumPiece,
  ): Promise<void> {
    await this.engine.unlock();
    const host = await this.ensureVoiceEngine();
    if (!host) return;
    // PS-4: a sample-backed audition resolves the sample host AND the
    // specific assets first (fast — selection prefetched them; a first-ever
    // selection decodes here), then stamps `when` fresh — one click both
    // selects and sounds (≤1 interaction law). Synth sounds never touch the
    // content module. Load failures surface via the selection-time prefetch
    // toast; the audition itself simply does not sound.
    const refs = sampleRefsForSound(this.laneSounds[laneId]);
    if (refs.length > 0) {
      const sampleHost = await host.ensureSampleVoice().catch(() => null);
      if (sampleHost) await sampleHost.preload(refs).catch(() => undefined);
    }
    const when = this.engine.getContext().currentTime + 0.03;
    const events = this.buildAuditionEvents(laneId, degreeOrDrum, when);
    if (events.length === 0) return;
    host.sendEvents(LANE_IDS.indexOf(laneId), events);
  }

  /** Stop everything the voice engines are sounding (transport stop). */
  stopAllVoices(): void {
    void this.ensureVoiceEngine().then((host) => host?.allOff());
  }

  private buildAuditionEvents(
    laneId: LaneId,
    degreeOrDrum: number | DrumPiece,
    when: number,
  ) {
    if (laneId === "drums") {
      const kit = this.resolveDrumKit();
      const pieceName =
        typeof degreeOrDrum === "string" &&
        (DRUM_PIECES as readonly string[]).includes(degreeOrDrum)
          ? (degreeOrDrum as DrumPiece)
          : "kick";
      const piece = kit.pieces[pieceName];
      return [
        noteParamsFor(piece, {
          time: when,
          holdSeconds: Math.max(
            piece.envelope.attack + piece.envelope.decay,
            0.05,
          ),
          seedSalt: DRUM_PIECES.indexOf(pieceName),
        }),
      ];
    }
    const preset = this.resolvePitchedPreset(laneId);
    const degree = typeof degreeOrDrum === "number" ? degreeOrDrum : 0;
    // Lane's effective scale when connected; the project default (C minor)
    // before the engineBridge pushes the document's scale.
    const scale =
      this.laneScales[laneId] ?? toEffectiveScale({ root: 0, mode: "minor" });
    const octaveBase = preset.pitchRange?.octaveBase ?? 4;
    // Chord lanes audition the diatonic triad, one voice per chord tone.
    const offsets = laneId === "chords" ? [0, 2, 4] : [0];
    return offsets.map((offset) =>
      noteParamsFor(preset, {
        time: when,
        midi: degreeToMidi(scale, degree + offset, octaveBase),
        holdSeconds: 0.25,
        seedSalt: degree + offset,
      }),
    );
  }

  private resolveDrumKit(): DrumKit {
    return getDrumKit(this.laneSounds.drums) ?? getDrumKit("kit-default")!;
  }

  private resolvePitchedPreset(laneId: Exclude<LaneId, "drums">): VoicePreset {
    const fallback: Record<Exclude<LaneId, "drums">, string> = {
      bass: "preset-bass-1",
      chords: "preset-chords-1",
      lead: "preset-lead-1",
    };
    return getPreset(this.laneSounds[laneId]) ?? getPreset(fallback[laneId])!;
  }

  // -------------------------------------------------------------------------
  // FX chain graph (IM-4): voice-engine → [devices…] → lane gain → master
  // -------------------------------------------------------------------------

  /** Desired chain per lane (document fxChain via the engineBridge). */
  private laneChains: (readonly FxDevice[] | null)[] = [];
  private readonly chainHosts: (FxChainHost | null)[] = [];

  // -------------------------------------------------------------------------
  // LY-1 quadrant mix (per-lane volume / mute / solo). The mix rides the SAME
  // per-lane gain node the FX chain sinks into (session.ts laneGain); solo
  // ducks every non-solo lane to silence (mute is per-lane). The engineBridge
  // pushes the document's mix on the same lane-object identity as FX chains.
  // -------------------------------------------------------------------------

  private laneMix: LaneMix[] = LANE_IDS.map(() => ({ ...DEFAULT_LANE_MIX }));
  private laneGains: (GainNode | null)[] = [];

  /**
   * Push one lane's mix (document values via the engineBridge). Recomputes
   * EVERY lane's effective gain — solo changes other lanes' audibility, so a
   * one-lane push can move all four gains. Applied to the gain nodes with an
   * 8 ms de-click ramp (the chain-head fade vocabulary); before the nodes
   * exist (nothing sounding yet) the values are simply remembered.
   */
  setLaneMix(laneId: LaneId, mix: LaneMix): void {
    this.laneMix[LANE_IDS.indexOf(laneId)] = { ...mix };
    this.applyLaneGains();
  }

  /** Current stored mix of a lane (inspector/e2e). */
  getLaneMix(laneId: LaneId): LaneMix {
    return this.laneMix[LANE_IDS.indexOf(laneId)] ?? { ...DEFAULT_LANE_MIX };
  }

  /**
   * Effective gain law (LY-1, HW-5-shared): mute silences the lane; if ANY
   * lane is soloed, every non-solo lane silences too; otherwise the lane's
   * linear volume applies. Delegates to the ONE pure law (schema.ts
   * laneMixGain) so the offline render/export path cannot drift from live
   * monitoring.
   */
  private effectiveLaneGain(index: number): number {
    return laneMixGain(this.laneMix, index);
  }

  private applyLaneGains(): void {
    for (let i = 0; i < this.laneGains.length; i++) {
      const gain = this.laneGains[i];
      if (!gain) continue;
      const target = this.effectiveLaneGain(i);
      const t = this.engine.getContext().currentTime;
      const param = gain.gain;
      // De-click: cancel anything pending, hold the current value, ramp over
      // 8 ms (the FX chain-head fade pair's fade-in vocabulary).
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(target, t + 0.008);
    }
  }

  /** The lane's mix gain node (created once, connected to the master). */
  private ensureLaneGain(laneIndex: number, master: GainNode): GainNode | null {
    if (this.laneGains[laneIndex]) return this.laneGains[laneIndex]!;
    const ctx = this.engine.getContext();
    if (!hasAudioNodes(ctx)) return null;
    const gain = ctx.createGain();
    gain.gain.value = this.effectiveLaneGain(laneIndex);
    gain.connect(master);
    this.laneGains[laneIndex] = gain;
    return gain;
  }

  /**
   * Push a lane's FX chain (document order). Topology edits rebuild the lane
   * subgraph glitch-free (3 ms fade-out / 8 ms fade-in on the chain head —
   * documented in src/audio/fx.ts); param edits ride AudioParam ramps.
   */
  setLaneChain(laneId: LaneId, devices: readonly FxDevice[]): void {
    const index = LANE_IDS.indexOf(laneId);
    this.laneChains[index] = devices;
    this.chainHosts[index]?.setChain(devices);
  }

  /**
   * Chain-head de-click gain: the 1→0→1 fade pair means the ramp always
   * starts from the opposite endpoint of the requested value.
   */
  private static makeRampGain(gain: GainNode): RampGainLike {
    return {
      input: gain,
      output: gain,
      rampTo(value, when, seconds) {
        const param = gain.gain;
        param.cancelScheduledValues(when);
        param.setValueAtTime(1 - value, when);
        param.linearRampToValueAtTime(value, when + seconds);
      },
    };
  }

  /** Build one lane's chain subgraph (idempotent; called once per lane). */
  private buildLaneChain(
    host: VoiceEngineHost,
    laneIndex: number,
    master: GainNode,
  ): void {
    if (this.chainHosts[laneIndex]) return;
    const ctx = this.engine.getContext();
    if (!isWorkletCapable(ctx)) return;
    // LY-1: the lane gain is the shared mix node (volume/mute/solo) — created
    // in ensureVoiceEngine for every lane, worklet or not, so the mix law is
    // identical on both paths.
    const laneGain =
      this.laneGains[laneIndex] ?? this.ensureLaneGain(laneIndex, master);
    if (!laneGain) return;
    const rampGain = Session.makeRampGain(ctx.createGain());
    const laneSeed = (0x5eed ^ ((laneIndex + 1) * 0x85ebca6b)) >>> 0;
    const timing = (): FxTiming => ({
      bpm: this.transport.snapshot.bpm,
      when: ctx.currentTime,
    });
    const chain = new FxChainHost({
      // Adapter: the voice-engine host owns the per-lane worklet node.
      source: {
        connect: (destination: FxConn) =>
          host.connect(laneIndex, destination as AudioNode),
        disconnect: () => undefined,
      },
      sink: laneGain,
      ramp: rampGain,
      createDevice: createRealFxDeviceFactory(ctx, {
        laneSeed,
        // The voice-engine module (which also registers 'bitcrusher') is
        // loaded by createVoiceEngine before any chain exists.
        createBitcrusher: (c) => createBitcrusherNode(c),
      }),
      timing,
    });
    this.chainHosts[laneIndex] = chain;
    const devices = this.laneChains[laneIndex];
    if (devices && devices.length > 0) chain.setChain(devices);
  }

  private defaultCreateVoiceEngine: NonNullable<
    SessionOptions["createVoiceEngineHost"]
  > = async (ctx) => {
    if (!isWorkletCapable(ctx)) return null;
    return createVoiceEngine(workletContextFor(ctx), LANE_IDS.length, {
      onStolen: () => this.noteVoiceStolen(),
    });
  };

  /**
   * PS-4: the native sample host on the live context. The content loader is
   * imported lazily INSIDE createSampleVoiceHostFor — no audio-asset bytes
   * touch the boot→play path (TH-4(d)).
   */
  private defaultCreateSampleVoiceHost: NonNullable<
    SessionOptions["createSampleVoiceHost"]
  > = async (ctx) => {
    const c = ctx as AudioContextLike & Partial<SampleVoiceContextLike>;
    if (
      typeof c.createBufferSource !== "function" ||
      typeof c.createGain !== "function"
    ) {
      return null; // node fakes without native nodes
    }
    return createSampleVoiceHostFor(
      c as SampleVoiceContextLike,
      LANE_IDS.length,
      {
        onStolen: () => this.noteVoiceStolen(),
      },
    );
  };

  /** The live context's sample host (memoized; retries after a failure). */
  private ensureSampleVoiceHost(): Promise<SampleVoiceHost | null> {
    this.sampleHostPromise ??= Promise.resolve(
      this.createSampleVoiceHostImpl(this.engine.getContext()),
    ).catch((err: unknown) => {
      this.sampleHostPromise = null; // next selection retries
      throw err;
    });
    return this.sampleHostPromise;
  }

  /**
   * PS-4 selection-time prefetch: decode `refs` on the LIVE context so the
   * next PLAY (and the audition) finds them cached. Rejects with the
   * loader's typed error — callers surface per the Hulk conventions.
   */
  async primeSound(refs: readonly string[]): Promise<void> {
    if (refs.length === 0) return;
    const host = await this.ensureSampleVoiceHost();
    if (!host) return;
    await host.preload(refs);
  }

  private ensureVoiceEngine(): Promise<LaneVoiceRouter | null> {
    this.voiceEnginePromise ??= this.createVoiceEngineHost(
      this.engine.getContext(),
    ).then((host) => {
      if (!host) return null;
      // PS-4: every lane routes through the router — synth events to the
      // worklet, sample events to the (lazily created) native host.
      const router = createLaneVoiceRouter(host, () =>
        this.ensureSampleVoiceHost(),
      );
      const master = this.ensureMaster();
      if (master) {
        for (let i = 0; i < LANE_IDS.length; i++) {
          // LY-1: the lane gain (mix node) exists on every path — worklet
          // graphs sink their FX chain into it; the exotic no-worklet
          // fallback connects the voice engine through it directly. The mix
          // law (volume/mute/solo) is therefore identical either way.
          const laneGain = this.ensureLaneGain(i, master);
          // IM-4: voice engine → FX chain (chain head = ramp gain) → lane
          // gain → master. The chain host owns everything between the
          // worklet node and the lane gain.
          this.buildLaneChain(router, i, master);
          // No worklet-graph context (exotic fallback): straight through the
          // lane gain to master.
          if (!this.chainHosts[i] && laneGain) router.connect(i, laneGain);
        }
      }
      return router;
    });
    return this.voiceEnginePromise;
  }

  /**
   * Lazily builds the master gain wired to the destination through the
   * committed soft-clip stage (D2-D4; landed with PX-1) - the same node the
   * offline render master uses (parity law).
   */
  private ensureMaster(): GainNode | null {
    if (this.master) return this.master;
    const ctx = this.engine.getContext();
    if (!hasAudioNodes(ctx)) return null;
    const gain = ctx.createGain();
    gain.gain.value = this._volume;
    const clip = createSoftClipNode(ctx);
    gain.connect(clip);
    clip.connect(ctx.destination);
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
