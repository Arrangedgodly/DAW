/**
 * Offline render pipeline (IM-5, RES-2 parity law).
 *
 * Renders one loop iteration of the whole project plus the FX tail through an
 * OfflineAudioContext using the SAME graph builders and the SAME song compiler
 * as the live path, then folds the tail into the loop start so the buffer
 * stitches seamlessly (D2: "render loop + tail, fold tail into loop").
 *
 * Parity construction (what makes offline == live):
 * - addModule per context on the OfflineAudioContext (createVoiceEngine does
 *   this; it also registers 'bitcrusher' for the FX chains).
 * - Identical per-lane subgraph: voice-engine worklet → FxChainHost
 *   (ramp head + devices via createRealFxDeviceFactory, same laneSeed
 *   formula) → lane gain → master gain → destination. This mirrors
 *   Session.ensureVoiceEngine/buildLaneChain exactly (session master volume
 *   default 0.9; no soft-clip stage exists on the live path yet — when one
 *   lands, it must be added here in the same position).
 * - The FULL compiled event list (all lanes, one loop iteration, lanes with
 *   shorter chains wrapping against the common loop) is preloaded via
 *   sendEvents BEFORE startRendering() — the hard parity rule.
 * - PS-4: sample-backed lanes ride a native SampleVoiceHost on the SAME
 *   offline context (per-lane FX chains unchanged); every referenced asset
 *   is decoded before anything is scheduled, so the render is deterministic
 *   (recordings + playbackRate, no seeds).
 * - Seeded PRNGs everywhere downstream (reverb IRs derive from laneSeed).
 * - HW-5 export-mix law (coordinator resolution at LY-1 verification): the
 *   render applies the document's lane mix — volume/mute/solo render exactly
 *   as heard, through the SAME pure law the live session uses
 *   (documentLaneMixGains → laneMixGain, schema.ts). Each lane's FX-chain
 *   sink passes through a dedicated per-lane mix gain (STATIC value, no
 *   de-click ramp — the render starts at t=0 with nothing sounding) BEFORE
 *   the serial unity sum chain, so a lane's mix scales only its own signal
 *   and the deterministic fan-in law below is unchanged. Canonical-empty
 *   mixes are all-unity gains (x*1 === x, bit-exact) — pre-mix documents
 *   render byte-identically.
 *
 * Loop-length semantics: lanes are poly-looping (each lane's chain wraps
 * independently, IM-7). The export loop is the least common multiple of all
 * lanes' chain step counts, so every lane's arrangement phase-locks within
 * one render. Chain steps are multiples of 16 and swing delays cancel over
 * step pairs, so the loop duration is exactly loopSteps × secondsPerStep
 * regardless of swing.
 *
 * Tail-fold semantics (precise): let L = loopSamples, T = tailSamples
 * (computeTailSamples, IM-4). Render length is exactly L + T. The returned
 * buffer is raw[0..L) with, for every i in [0, T), out[i] += raw[L + i].
 * I.e. the tail beyond the loop is wrapped and added to the FIRST tail-length
 * samples — stitching out+out reproduces the infinite-loop signal up to the
 * (sub-threshold) energy still ringing beyond one tail.
 *
 * MF-4 (WAV encoder) consumes the returned RenderedLoop directly:
 * Float32Array[] channels (interleave + quantize there) + exact metadata.
 */

import { compileLaneSchedule, resolveChainPatterns } from "./song";
import { type GrooveOptions, timeAtStep, secondsPerStep } from "./time";
import {
  computeTailSamples,
  type FxDevice,
  type FxTiming,
  FxChainHost,
  type RampGainLike,
  createRealFxDeviceFactory,
  createSoftClipNode,
  softClip,
} from "./fx";
import {
  createSampleVoiceHostFor,
  createVoiceEngine,
  createBitcrusherNode,
  workletContextFor,
  type SampleVoiceHost,
} from "./voiceEngine";
import { getDrumKit, getPreset, type VoiceNoteOnEvent } from "./presets";
import { effectiveScale } from "../document/scales";
import {
  LANE_IDS,
  type LaneId,
  type ProjectDocument,
  deriveLoopBarsCompat,
  documentLaneMixGains,
} from "../document/schema";

export const EXPORT_SAMPLE_RATE = 44100;

/** What MF-4's WAV encoder consumes (documented export contract). */
export interface RenderedLoop {
  /** Stereo channels of the loop-tight buffer (length = loopSamples). */
  readonly channels: readonly Float32Array[];
  readonly loopSamples: number;
  readonly tailSamples: number;
  readonly sampleRate: number;
  /** Steps in one loop iteration (LCM of lane chain lengths). */
  readonly loopSteps: number;
  readonly bpm: number;
  /**
   * Un-folded render (length loopSamples + tailSamples), for tests/diagnostics
   * only — MF-4 consumes `channels`. Present when opts.includeRaw is set.
   */
  readonly raw?: readonly Float32Array[];
}

export interface RenderProjectOptions {
  /**
   * Injectable context factory (day-one contract: injected AudioContext
   * factory). Default constructs a real OfflineAudioContext — the single
   * DOM-touching line of this module.
   */
  readonly createContext?: (
    channels: number,
    lengthSamples: number,
    sampleRate: number,
  ) => BaseAudioContext & { startRendering(): Promise<AudioBuffer> };
  /** Override the worklet module URL (tests). */
  readonly moduleUrl?: string;
  /**
   * Wait after sendEvents before startRendering (default 25 ms): postMessage
   * delivery races startRendering in Chromium (observed flake, TH-1).
   */
  readonly settleMs?: number;
  /** Include the un-folded loop+tail render in the result (tests). */
  readonly includeRaw?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in node)
// ---------------------------------------------------------------------------

export function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
}

/**
 * Export loop length in steps: LCM over lanes with a non-empty chain.
 * Empty list → the v3 compat derivation × 16 (the retired transport
 * loopBars fallback, re-based engine-side at SV-1; degenerate all-empty
 * docs only — resolveChainPatterns falls back to first-pattern otherwise,
 * so real exports always take the LCM path, i3-5).
 */
export function computeLoopSteps(
  laneChainSteps: readonly number[],
  fallbackBars: number,
): number {
  let steps = 0;
  for (const s of laneChainSteps) {
    if (s > 0) steps = steps === 0 ? s : lcm(steps, s);
  }
  return steps > 0 ? steps : fallbackBars * 16;
}

/**
 * Expand one lane's chain schedule over the export loop: chain-local step s
 * plays at every global step ≡ s (mod chainSteps); event time is exactly
 * timeAtStep(globalStep, groove) (segment offsets are even, so this equals
 * the compiler's segment-local times — see song.ts). Sorted by time.
 */
export function expandLaneEventsForLoop(
  schedule: {
    readonly chainSteps: number;
    readonly byStep: ReadonlyMap<number, readonly VoiceNoteOnEvent[]>;
  },
  loopSteps: number,
  groove: GrooveOptions,
): VoiceNoteOnEvent[] {
  const events: VoiceNoteOnEvent[] = [];
  if (schedule.chainSteps <= 0) return events;
  for (let step = 0; step < loopSteps; step++) {
    const local =
      ((step % schedule.chainSteps) + schedule.chainSteps) %
      schedule.chainSteps;
    const bucket = schedule.byStep.get(local);
    if (!bucket) continue;
    const time = timeAtStep(step, groove);
    for (const e of bucket) events.push({ ...e, time });
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

/**
 * Fold the tail into the loop start (pure): returns new channel arrays of
 * length loopSamples where out[i] += raw[loopSamples + i] for i < tailSamples.
 */
export function foldTail(
  raw: readonly Float32Array[],
  loopSamples: number,
): Float32Array[] {
  const tailSamples = raw[0].length - loopSamples;
  if (tailSamples < 0) throw new Error("foldTail: buffer shorter than loop");
  return raw.map((ch) => {
    const out = new Float32Array(loopSamples);
    out.set(ch.subarray(0, loopSamples));
    for (let i = 0; i < tailSamples; i++) out[i] += ch[loopSamples + i];
    return out;
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function laneScheduleFor(
  doc: ProjectDocument,
  lane: LaneId,
  groove: GrooveOptions,
) {
  const chain = resolveChainPatterns(doc, lane);
  if (chain.length === 0) return null;
  const laneConf = doc.lanes.find((l) => l.id === lane)!;
  // Same compiler invocation as the live path (state/engineBridge.ts).
  return compileLaneSchedule({
    chain,
    preset:
      lane === "drums"
        ? (getDrumKit((laneConf as { kitId: string }).kitId) ??
          getDrumKit("kit-default")!)
        : (getPreset((laneConf as { presetId: string }).presetId) ??
          getPreset("preset-lead-1")!),
    gate: laneConf.gate,
    groove,
    ...(lane === "drums"
      ? {}
      : {
          scale: effectiveScale(doc, lane),
          stackChord: lane === "chords",
        }),
  });
}

/** Same chain-head ramp adapter shape as Session.makeRampGain. */
function makeRampGain(gain: GainNode): RampGainLike {
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

/**
 * Render one loop-tight stereo buffer of the project offline.
 * See module doc for parity construction and tail-fold semantics.
 */
export async function renderProjectToBuffer(
  doc: ProjectDocument,
  opts: RenderProjectOptions = {},
): Promise<RenderedLoop> {
  const groove: GrooveOptions = {
    bpm: doc.transport.bpm,
    swing: doc.transport.swing,
  };

  // 1. Compile every lane with the shared compiler (the only scheduling
  //    authority — the SAME output the live path consumes).
  const schedules = LANE_IDS.map((lane) => laneScheduleFor(doc, lane, groove));
  const loopSteps = computeLoopSteps(
    schedules.map((s) => s?.chainSteps ?? 0),
    deriveLoopBarsCompat(doc), // v3: the retired loopBars fallback, derived
  );
  const loopSamples = Math.round(
    loopSteps * secondsPerStep(groove.bpm) * EXPORT_SAMPLE_RATE,
  );

  // 2. Tail budget from the document's FX chains (IM-4).
  const tailSamples = computeTailSamples(
    LANE_IDS.map((lane) => doc.lanes.find((l) => l.id === lane)?.fxChain ?? []),
    groove.bpm,
    EXPORT_SAMPLE_RATE,
  );

  const createContext =
    opts.createContext ??
    ((channels: number, length: number, sampleRate: number) =>
      new OfflineAudioContext(channels, length, sampleRate));
  const ctx = createContext(2, loopSamples + tailSamples, EXPORT_SAMPLE_RATE);

  // 3. Identical graph: voice engines (one addModule on THIS context) →
  //    per-lane FX chain → lane gain → master (0.9, session default) → dest.
  const host = await createVoiceEngine(
    workletContextFor(ctx),
    LANE_IDS.length,
    {
      moduleUrl: opts.moduleUrl,
    },
  );
  // PS-4 offline parity law: sample-backed lanes render through the native
  // SampleVoiceHost on THIS context, and every referenced asset is decoded
  // BEFORE any source is scheduled and before startRendering() — the
  // same-buffers/same-rates construction keeps the render deterministic
  // (sample events carry no seeds). Synth-only projects never even load the
  // content module (the host is created only when a ref exists).
  const sampleRefs = new Set<string>();
  for (const schedule of schedules) {
    if (!schedule) continue;
    for (const events of schedule.byStep.values()) {
      for (const e of events) {
        if (e.sample) sampleRefs.add(e.sample.ref);
      }
    }
  }
  const sampleHost: SampleVoiceHost | null =
    sampleRefs.size > 0
      ? await createSampleVoiceHostFor(ctx, LANE_IDS.length)
      : null;
  if (sampleHost) await sampleHost.preload([...sampleRefs]);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // Committed master soft-clip (D2–D4; landed with PX-1) — the same node the
  // live session master uses (parity law: identical graph both paths).
  const clip = createSoftClipNode(ctx);
  master.connect(clip);
  clip.connect(ctx.destination);
  const chains: FxChainHost[] = [];
  const laneDevices: (readonly FxDevice[] | null)[] = [];
  // Deterministic fan-in (HW-4 finding, 2026-09-02): OfflineAudioContext
  // renders graphs with 4+ parallel branches into one node NONDETERMINISTICALLY
  // at the last float ULP — Chromium parallelizes independent branch
  // processing past a width threshold and the fan-in sum order then varies
  // run to run (reproduced with pure native BufferSources → gains → one
  // gain: n=4 differs, n=3 bit-identical; ~0.05% of samples cross an int16
  // boundary in the exported WAV). Sum the lanes through a SERIAL chain of
  // unity gains instead: every node has ≤ 2 inputs, so no branch parallelism
  // and the addition order is fixed by construction. Unity multiplication is
  // exact in FP (x*1 === x), so the mix law is unchanged.
  const laneGains: GainNode[] = [];
  // HW-5 export-mix vector: the document's volume/mute/solo through the SAME
  // pure law the live session applies (schema.ts). Canonical-empty mixes are
  // all 1s, so pre-mix documents keep their exact bytes (unity is exact in FP).
  const mixGains = documentLaneMixGains(doc);
  LANE_IDS.forEach((lane, i) => {
    const laneGain = ctx.createGain();
    laneGain.gain.value = 1;
    // Serial fan-in: lane i's sum node receives lane i-1's running sum and
    // its own FX chain sink; only the LAST lane's gain reaches the master
    // (connecting an intermediate one as well would duplicate that lane's
    // signal — caught by the demoSong RMS gate during HW-4).
    if (i > 0) laneGains[i - 1]!.connect(laneGain);
    if (i === LANE_IDS.length - 1) laneGain.connect(master);
    laneGains.push(laneGain);
    // HW-5: the lane's mix rides a DEDICATED static gain between its FX-chain
    // sink and the serial unity sum node — the sum nodes keep the
    // deterministic fan-in law above, and a lane's mix scales only its own
    // signal (mute = exact zeros into the sum; solo/volume per laneMixGain).
    const mixGain = ctx.createGain();
    mixGain.gain.value = mixGains[i]!;
    mixGain.connect(laneGain);
    const laneSeed = (0x5eed ^ ((i + 1) * 0x85ebca6b)) >>> 0;
    const timing = (): FxTiming => ({ bpm: groove.bpm, when: ctx.currentTime });
    const chain = new FxChainHost({
      source: {
        connect: (destination) => {
          host.connect(i, destination as AudioNode);
          // PS-4: the lane's sample voice output sinks into the SAME chain
          // head (per-lane FX chains apply to sampled lanes as today).
          sampleHost?.connect(i, destination as AudioNode);
        },
        disconnect: () => undefined,
      },
      sink: mixGain,
      ramp: makeRampGain(ctx.createGain()),
      createDevice: createRealFxDeviceFactory(ctx, {
        laneSeed,
        createBitcrusher: (c) => createBitcrusherNode(c),
      }),
      timing,
    });
    chains.push(chain);
    const devices = doc.lanes.find((l) => l.id === lane)?.fxChain ?? null;
    laneDevices.push(devices);
    if (devices && devices.length > 0) chain.setChain(devices);
  });

  // 4. Preload the FULL event list (all lanes) before startRendering.
  for (let i = 0; i < LANE_IDS.length; i++) {
    const schedule = schedules[i];
    if (!schedule) continue;
    const expanded = expandLaneEventsForLoop(schedule, loopSteps, groove);
    if (!sampleHost) {
      host.sendEvents(i, expanded);
      continue;
    }
    // PS-4: partition per lane — synth events to the worklet (acks below),
    // sample events to the already-preloaded native host.
    const synth: VoiceNoteOnEvent[] = [];
    const sampleEvents: VoiceNoteOnEvent[] = [];
    for (const e of expanded) (e.sample ? sampleEvents : synth).push(e);
    if (synth.length > 0) host.sendEvents(i, synth);
    if (sampleEvents.length > 0) sampleHost.sendEvents(i, sampleEvents);
  }

  // postMessage delivery must land before rendering starts (Chromium race).
  // HW-4 finding: a fixed settle sleep was insufficient under a busy page
  // (live app realm) — late events landed at the next quantum and shifted
  // onsets. Wait for the worklet's explicit {type:'loaded'} acks instead,
  // with the settle sleep kept only as the bounded fallback tail.
  await host.waitUntilLoaded();
  await new Promise((r) => setTimeout(r, opts.settleMs ?? 0));

  // 5. Render, fold, return.
  const buffer = await ctx.startRendering();
  // HW-2 cross-config guard: the export contract is 44100 Hz exactly (D2
  // "explicit 44100 Hz"). A misbehaving injected factory that built its
  // context at another rate would silently rescale every loop length —
  // refuse instead of returning a wrong-rate buffer.
  if (buffer.sampleRate !== EXPORT_SAMPLE_RATE) {
    throw new Error(
      `renderProjectToBuffer: rendered buffer sample rate ${buffer.sampleRate} ` +
        `≠ export rate ${EXPORT_SAMPLE_RATE} — the context factory must build ` +
        `contexts at the requested rate`,
    );
  }
  chains.forEach((c) => c.dispose());
  host.dispose();
  sampleHost?.dispose();

  const raw = [buffer.getChannelData(0), buffer.getChannelData(1)].map((c) =>
    Float32Array.from(c),
  );
  // The tail fold SUMS loop + wrapped tail AFTER the master soft-clip node,
  // so the folded result can exceed the node's ceiling at the seam. The
  // export is the folded loop — apply the same committed soft-clip law
  // (pure fn, identical curve) to the final samples so the exported loop is
  // bounded exactly like the live path.
  const folded = foldTail(raw, loopSamples).map((ch) =>
    Float32Array.from(ch, (x) => softClip(x)),
  );
  return {
    channels: folded,
    ...(opts.includeRaw ? { raw } : {}),
    loopSamples,
    tailSamples,
    sampleRate: buffer.sampleRate,
    loopSteps,
    bpm: groove.bpm,
  };
}
