/**
 * DES-4 session pattern-playback seam: setLaneEvents groups compiled events
 * by pattern step and delivers them on the transport tick for that step at
 * the tick's swung absolute time.
 *
 * VZ-IM-1 block (below): the note-on TAP — subscribeNoteOns must observe
 * exactly the events delivered to the voice host, at delivery (schedule)
 * time, each stamped with the SAME audible `when` the host received;
 * observation-only (host.sendEvents arguments unchanged) and contained (a
 * throwing listener never disturbs audio delivery).
 */

import { describe, expect, it } from "vitest";
import { Session, type VizNoteOn } from "../src/engine/session";
import { compileLaneEvents } from "../src/audio/compile";
import {
  getDrumKit,
  getPreset,
  type VoiceNoteOnEvent,
} from "../src/audio/presets";
import { EventOutbox, type VoiceEngineHost } from "../src/audio/voiceEngine";
import type { AudioContextLike } from "../src/audio/context";
import {
  createDefaultProject,
  type DrumPattern,
  type PitchedPattern,
} from "../src/document/schema";
import { degreeToMidi, toEffectiveScale } from "../src/document/scales";
import { timeAtStep } from "../src/audio/time";

function makeCtx(): { ctx: AudioContextLike; tick: (t: number) => void } {
  const state = { now: 10 };
  const ctx: AudioContextLike = {
    get currentTime() {
      return state.now;
    },
    sampleRate: 44100,
    state: "running",
    resume: async () => {},
  } as unknown as AudioContextLike;
  return { ctx, tick: (t) => (state.now = t) };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Session pattern playback seam", () => {
  it("delivers lane events on the matching tick at the tick time", async () => {
    const { ctx, tick } = makeCtx();
    const sent: { lane: number; events: VoiceNoteOnEvent[] }[] = [];
    const host: VoiceEngineHost = {
      outbox: new EventOutbox(4),
      sendEvents: (lane, events) => sent.push({ lane, events: [...events] }),
      connect: () => {},
      allOff: () => {},
      dispose: () => {},
    };
    let intervalCb: (() => void) | null = null;
    const session = new Session({
      engine: { getContext: () => ctx, unlock: async () => {} } as never,
      createVoiceEngineHost: async () => host,
      setIntervalFn: (cb) => {
        intervalCb = cb as () => void;
        return 0;
      },
      clearIntervalFn: () => {},
    });

    const base = createDefaultProject().patterns.drums[0] as DrumPattern;
    const steps = { ...base.steps, kick: [...base.steps.kick] };
    steps.kick[0] = true;
    steps.kick[4] = true;
    const pattern: DrumPattern = { ...base, steps };
    const groove = { bpm: 120, swing: 0 };
    const events = compileLaneEvents({
      pattern,
      preset: getDrumKit("kit-default")!,
      gate: { unit: "steps", value: 1 },
      groove,
    });
    expect(events.length).toBe(2);

    session.setLaneEvents("drums", events, 16);
    session.transport.play(); // timeline starts at ctx.now + 0.1
    tick(10.05);
    expect(intervalCb).toBeTruthy();
    intervalCb!();
    await flush();

    // Both scheduled ticks (steps 0 and 4, within the horizon) delivered.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const all = sent.flatMap((s) => s.events);
    const times = all.map((e) => e.time).sort((a, b) => a - b);
    expect(times[0]).toBeCloseTo(timeAtStep(0, groove) + 10.1, 6);
    expect(times[1]).toBeCloseTo(timeAtStep(4, groove) + 10.1, 6);
    // Drums lane index 0.
    expect(sent.every((s) => s.lane === 0)).toBe(true);
  });

  it("maps event time to pattern step by the same grid the compiler used", async () => {
    const { ctx, tick } = makeCtx();
    const sent: VoiceNoteOnEvent[][] = [];
    const host: VoiceEngineHost = {
      outbox: new EventOutbox(4),
      sendEvents: (_lane, events) => sent.push([...events]),
      connect: () => {},
      allOff: () => {},
      dispose: () => {},
    };
    let intervalCb: (() => void) | null = null;
    const session = new Session({
      engine: { getContext: () => ctx, unlock: async () => {} } as never,
      createVoiceEngineHost: async () => host,
      setIntervalFn: (cb) => {
        intervalCb = cb as () => void;
        return 0;
      },
      clearIntervalFn: () => {},
    });

    const base = createDefaultProject().patterns.drums[0] as DrumPattern;
    const steps = { ...base.steps, snare: [...base.steps.snare] };
    steps.snare[2] = true; // step 2 = 0.25 s
    const groove = { bpm: 120, swing: 0 };
    const events = compileLaneEvents({
      pattern: { ...base, steps },
      preset: getDrumKit("kit-default")!,
      gate: { unit: "steps", value: 1 },
      groove,
    });

    session.setLaneEvents("drums", events, 16);
    session.transport.play();
    tick(10.05);
    intervalCb!();
    await flush();

    // Step 2's tick carries the snare exactly at its swung time.
    const snare = sent.flat().find((e) => e.freq! > 100);
    expect(snare).toBeDefined();
    expect(snare!.time).toBeCloseTo(timeAtStep(2, groove) + 10.1, 6);
  });
});

// ---------------------------------------------------------------------------
// VZ-IM-1 — the note-on tap (subscribeNoteOns): observation-only, riding the
// same delivery pass as host.sendEvents. Harness conventions:
// rail-follow.test.ts (fake ctx clock, injected voice host, manual refill,
// TIMELINE = play() at now=10 + 0.1 start delay, swing 0, SPB = 0.125 s/step
// at 120 bpm, horizonSeconds 1.0 → one refill delivers steps ≤ now + 1.0 s).
// ---------------------------------------------------------------------------

const TAP_GROOVE = { bpm: 120, swing: 0 };
const SPB = 0.125;
const TIMELINE = 10.1; // play() at ctx.now = 10 + 0.1 start delay
const KIT = getDrumKit("kit-default")!;
const BASS_PRESET = getPreset("preset-bass-1")!;
const SCALE = toEffectiveScale({ root: 0, mode: "minor" });

/** The frozen contract derivation: event fundamental → integer MIDI note. */
function midiOf(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function tapDrumPattern(pieces: {
  kick?: number[];
  snare?: number[];
  hat?: number[];
}): DrumPattern {
  const pick = (steps?: number[]) => {
    const out = new Array(16).fill(false);
    for (const s of steps ?? []) out[s] = true;
    return out as boolean[];
  };
  return {
    kind: "drums",
    id: "tap-drums",
    name: "tap-drums",
    bars: 1,
    steps: {
      kick: pick(pieces.kick),
      snare: pick(pieces.snare),
      hat: pick(pieces.hat),
      openhat: pick(),
      clap: pick(),
      tom: pick(),
    },
  };
}

function tapBassPattern(
  notes: { degree: number; start: number; length: number }[],
): PitchedPattern {
  return {
    kind: "pitched",
    id: "tap-bass",
    name: "tap-bass",
    bars: 1,
    rowDegrees: [0],
    notes,
  };
}

interface TapHarness {
  session: Session;
  /** Absolute audio-clock time of a global step (swing 0). */
  timeOf: (step: number) => number;
  /** Advance the clock and run one refill (delivers into now + 1.0 s). */
  deliverAt: (when: number) => Promise<void>;
  /** Host ground truth: every sendEvents call, in delivery order. */
  hostLog: { lane: number; events: VoiceNoteOnEvent[] }[];
}

async function makeTapHarness(
  lanes: { drums?: DrumPattern; bass?: PitchedPattern } = {},
): Promise<TapHarness> {
  const state = { now: 10 };
  const ctx: AudioContextLike = {
    get currentTime() {
      return state.now;
    },
    sampleRate: 44100,
    state: "running",
    resume: async () => {},
  } as unknown as AudioContextLike;
  const hostLog: { lane: number; events: VoiceNoteOnEvent[] }[] = [];
  const host: VoiceEngineHost = {
    outbox: new EventOutbox(4),
    sendEvents: (lane, events) => hostLog.push({ lane, events: [...events] }),
    connect: () => {},
    allOff: () => {},
    dispose: () => {},
  };
  let intervalCb: (() => void) | null = null;
  const session = new Session({
    engine: { getContext: () => ctx, unlock: async () => {} } as never,
    createVoiceEngineHost: async () => host,
    horizonSeconds: 1.0,
    setIntervalFn: (cb) => {
      intervalCb = cb as () => void;
      return 0;
    },
    clearIntervalFn: () => {},
  });
  if (lanes.drums)
    session.setLaneEvents(
      "drums",
      compileLaneEvents({
        pattern: lanes.drums,
        preset: KIT,
        gate: { unit: "steps", value: 1 },
        groove: TAP_GROOVE,
      }),
      16,
    );
  if (lanes.bass)
    session.setLaneEvents(
      "bass",
      compileLaneEvents({
        pattern: lanes.bass,
        preset: BASS_PRESET,
        gate: { unit: "steps", value: 1 },
        groove: TAP_GROOVE,
        scale: SCALE,
      }),
      16,
    );
  session.transport.play();
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    session,
    timeOf: (step) => TIMELINE + step * SPB,
    deliverAt: async (when) => {
      state.now = when + 1e-6;
      intervalCb!();
      await settle();
    },
    hostLog,
  };
}

describe("Session note-on tap (VZ-IM-1, subscribeNoteOns)", () => {
  it("subscribers receive exactly the events delivered to the host, at exact audible times (table)", async () => {
    const h = await makeTapHarness({
      drums: tapDrumPattern({ kick: [0, 4], snare: [2] }),
      bass: tapBassPattern([{ degree: 0, start: 0, length: 1 }]),
    });
    const taps: VizNoteOn[] = [];
    h.session.subscribeNoteOns((n) => taps.push({ ...n }));

    await h.deliverAt(10.0); // horizon 11.0 → steps 0..7 delivered
    expect(h.hostLog.length).toBeGreaterThan(0);

    // Contract: one tap per event the HOST received, same order, same `when`.
    const hostFlat = h.hostLog.flatMap((c) =>
      c.events.map((e) => ({ lane: c.lane, e })),
    );
    expect(taps.length).toBe(hostFlat.length);
    expect(taps.length).toBe(4); // kick@0, bass@0, snare@2, kick@4
    const laneNames = ["drums", "bass", "chords", "lead"] as const;
    for (let k = 0; k < taps.length; k++) {
      expect(taps[k]!.lane).toBe(laneNames[hostFlat[k]!.lane]);
      expect(taps[k]!.audibleAt).toBe(hostFlat[k]!.e.time); // exact `when`
      expect(taps[k]!.velocity).toBe(hostFlat[k]!.e.level);
      expect(taps[k]!.pitch).toBe(midiOf(hostFlat[k]!.e.freq));
    }

    // Table: exact payloads. Kick fundamental 160 Hz → MIDI 51; the bass
    // degree-0 note → its degreeToMidi note (freq is its exact inverse).
    const bassMidi = degreeToMidi(
      SCALE,
      0,
      BASS_PRESET.pitchRange?.octaveBase ?? 4,
    );
    expect(taps).toEqual([
      {
        lane: "drums",
        pitch: 51,
        velocity: KIT.pieces.kick.level,
        audibleAt: h.timeOf(0),
      },
      {
        lane: "bass",
        pitch: bassMidi,
        velocity: BASS_PRESET.level,
        audibleAt: h.timeOf(0),
      },
      {
        lane: "drums",
        pitch: midiOf(190), // kit-default snare fundamental
        velocity: KIT.pieces.snare.level,
        audibleAt: h.timeOf(2),
      },
      {
        lane: "drums",
        pitch: 51,
        velocity: KIT.pieces.kick.level,
        audibleAt: h.timeOf(4),
      },
    ]);
  });

  it("no emission when lanePlayback is empty (nothing scheduled)", async () => {
    const h = await makeTapHarness(); // no lanes pushed
    const taps: VizNoteOn[] = [];
    h.session.subscribeNoteOns((n) => taps.push(n));

    await h.deliverAt(10.0);

    expect(taps).toEqual([]);
    expect(h.hostLog).toEqual([]);
  });

  it("unsubscribing stops delivery", async () => {
    const h = await makeTapHarness({
      drums: tapDrumPattern({ kick: [0], hat: [10] }),
    });
    const taps: VizNoteOn[] = [];
    const unsubscribe = h.session.subscribeNoteOns((n) => taps.push(n));

    await h.deliverAt(10.0); // steps 0..7 → kick@0
    expect(taps.length).toBe(1);

    unsubscribe();
    await h.deliverAt(10.9); // steps 8..15 → hat@10 (host still gets it)
    expect(taps.length).toBe(1); // frozen after unsubscribe
    expect(
      h.hostLog.some((c) => c.events.some((e) => e.time === h.timeOf(10))),
      "audio delivery continues without subscribers",
    ).toBe(true);
  });

  it("a throwing listener never breaks audio delivery (containment)", async () => {
    const h = await makeTapHarness({
      drums: tapDrumPattern({ kick: [0, 4], snare: [2] }),
    });
    const heard: VizNoteOn[] = [];
    let throwsSeen = 0;
    h.session.subscribeNoteOns(() => {
      throwsSeen++;
      throw new Error("viz observer bug");
    });
    h.session.subscribeNoteOns((n) => heard.push(n));

    await h.deliverAt(10.0); // must not reject

    expect(throwsSeen).toBe(3); // the bad listener ran, contained, every time
    expect(heard.length).toBe(3); // the good listener unaffected
    expect(h.hostLog.length).toBe(3); // audio delivered: 3 host calls
  });

  it("host.sendEvents arguments are unchanged (zero audio change)", async () => {
    const drumPat = tapDrumPattern({ kick: [0, 4], snare: [2] });
    const drumSrc = compileLaneEvents({
      pattern: drumPat,
      preset: KIT,
      gate: { unit: "steps", value: 1 },
      groove: TAP_GROOVE,
    });
    const bassPat = tapBassPattern([{ degree: 0, start: 0, length: 1 }]);
    const bassSrc = compileLaneEvents({
      pattern: bassPat,
      preset: BASS_PRESET,
      gate: { unit: "steps", value: 1 },
      groove: TAP_GROOVE,
      scale: SCALE,
    });
    const h = await makeTapHarness({ drums: drumPat, bass: bassPat });
    h.session.subscribeNoteOns(() => {}); // tap ON while comparing

    await h.deliverAt(10.0);

    // Every host event is byte-identical to its compiled source event except
    // `time`, rewritten to the tick's audible `when` — the pre-tap mapping,
    // unchanged by the tap being active. Delivery order per lane = compiled
    // (time-sorted) order: one bucket per step, steps in order.
    const drums = h.hostLog
      .filter((c) => c.lane === 0)
      .flatMap((c) => c.events);
    const bass = h.hostLog
      .filter((c) => c.lane === 1)
      .flatMap((c) => c.events);
    expect(drums.length).toBe(drumSrc.length);
    expect(bass.length).toBe(bassSrc.length);
    drums.forEach((e, k) =>
      expect(e).toEqual({ ...drumSrc[k]!, time: e.time }),
    );
    bass.forEach((e, k) =>
      expect(e).toEqual({ ...bassSrc[k]!, time: e.time }),
    );
  });

  it("no refill double-delivery: each delivered note-on emits exactly once", async () => {
    const h = await makeTapHarness({
      drums: tapDrumPattern({ kick: [0, 4], hat: [10] }),
      bass: tapBassPattern([{ degree: 0, start: 0, length: 1 }]),
    });
    const taps: VizNoteOn[] = [];
    h.session.subscribeNoteOns((n) => taps.push(n));

    await h.deliverAt(10.0); // steps 0..7
    // Overlapping refill at (almost) the same clock: steps 0..7 are already
    // delivered (lastDeliveredStep high-water) → nothing re-emits.
    await h.deliverAt(10.05);
    expect(taps.length).toBe(3); // kick@0, bass@0, kick@4

    await h.deliverAt(10.9); // steps 8..15 → hat@10, once
    expect(taps.length).toBe(4);

    // Multiset: every scheduled note exactly once across all refills.
    const counts = new Map<string, number>();
    for (const t of taps)
      counts.set(t.lane, (counts.get(t.lane) ?? 0) + 1);
    expect(counts.get("drums")).toBe(3);
    expect(counts.get("bass")).toBe(1);
    const hostTotal = h.hostLog.reduce((n, c) => n + c.events.length, 0);
    expect(hostTotal).toBe(4); // host agrees: no double-delivery anywhere
  });
});
