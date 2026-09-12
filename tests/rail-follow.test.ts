/**
 * Refinement-7 unit gate — the rail active-tile follow (critique P2-3 /
 * deferred #14, the HW-5 observation): Session.getSoundingPattern must
 * reflect the slot that is SOUNDING per lane, by AUDIBLE audio-clock time,
 * as the chain position advances naturally during playback.
 *
 * Why a new seam (and not "update activePatternId at delivery"): delivery
 * runs a full horizon AHEAD of audibility and lastDeliveredStep is a
 * session-lifetime high-water mark (the IN-3-era finding) — so the follow
 * reads a per-lane sounding LEDGER stamped with each slot's first audible
 * step time against ctx.currentTime. These tests pin the exact laws:
 *
 * 1. AUDIBLE-TIME ACCURACY: a slot delivered into the engine's horizon but
 *    not yet audible does NOT light; it lights exactly at its step's
 *    absolute time — with no new delivery call in between (pure clock read).
 * 2. PER-LANE INDEPENDENCE: lanes with different chain shapes follow their
 *    own slot schedules.
 * 3. NATURAL WRAP: the follow returns to slot 0 at the chain-iteration
 *    boundary's audible time (no switch involved).
 * 4. STOP PARKS + FRESH PLAY: stopped keeps the last pattern that actually
 *    sounded (entries cancelled by the stop never read); a fresh play
 *    flushes the ledger (the R-3 cursor-flush law extended) and reads the
 *    imminent slot 0; before any playback the seam reports null so the UI
 *    keeps the getActivePattern fallback.
 * 5. SWITCH LANDING: a boundary-mode quantized switch flips the follow at
 *    the boundary's AUDIBLE time while getActivePattern flips at DELIVERY —
 *    the two seams stay distinct, IM-7 semantics untouched (pinned by
 *    quantized-switch.test.ts unchanged).
 *
 * Harness conventions: quantized-switch.test.ts (fake ctx, injected voice
 * host, manual refill, TIMELINE = play() at now=10 + 0.1 start delay, swing
 * 0, SPB = 0.125 s/step at 120 bpm) — with horizonSeconds 1.0 so one refill
 * delivers a full horizon AHEAD of the clock (the window law 1 needs).
 */

import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";
import { compileLaneSchedule, type LaneSchedule } from "../src/audio/song";
import { getDrumKit, getPreset } from "../src/audio/presets";
import { EventOutbox, type VoiceEngineHost } from "../src/audio/voiceEngine";
import type { AudioContextLike } from "../src/audio/context";
import { toEffectiveScale } from "../src/document/scales";
import type {
  DrumPattern,
  LaneId,
  Pattern,
  PitchedPattern,
} from "../src/document/schema";

const KIT = getDrumKit("kit-default")!;
const GROOVE = { bpm: 120, swing: 0 };
const SPB = 0.125;
const TIMELINE = 10.1; // play() at ctx.now = 10 + 0.1 start delay

function drumPattern(
  id: string,
  bars: 1 | 2,
  kickSteps: number[],
): DrumPattern {
  const kick = new Array(16 * bars).fill(false);
  for (const s of kickSteps) kick[s] = true;
  const empty = () => new Array(16 * bars).fill(false);
  return {
    kind: "drums",
    id,
    name: id,
    bars,
    steps: {
      kick,
      snare: empty(),
      hat: empty(),
      openhat: empty(),
      clap: empty(),
      tom: empty(),
    },
  };
}

function scheduleFor(chain: Pattern[]): LaneSchedule {
  return compileLaneSchedule({
    chain,
    preset: KIT,
    gate: { unit: "steps", value: 1 },
    groove: GROOVE,
  });
}

const A1 = drumPattern("A1", 1, [0]);
const B1 = drumPattern("B1", 1, [0, 8]);

function bassPattern(id: string): PitchedPattern {
  return {
    kind: "pitched",
    id,
    name: id,
    bars: 1,
    rowDegrees: [0],
    notes: [{ degree: 0, start: 0, length: 1 }],
  };
}

function bassSchedule(chain: Pattern[]): LaneSchedule {
  return compileLaneSchedule({
    chain,
    preset: getPreset("preset-bass-1")!,
    gate: { unit: "steps", value: 1 },
    groove: GROOVE,
    scale: toEffectiveScale({ root: 0, mode: "minor" }),
  });
}

interface Harness {
  session: Session;
  /** Absolute audio-clock time of a global step (swing 0). */
  timeOf: (step: number) => number;
  /** Advance the clock and run one refill (delivers into now + horizon). */
  deliverAt: (when: number) => Promise<void>;
  /** Move the clock with NO delivery (pure sounding-read conditions). */
  setNow: (when: number) => void;
}

async function makeHarness(
  initial: Partial<Record<LaneId, LaneSchedule>>,
): Promise<Harness> {
  const state = { now: 10 };
  const ctx: AudioContextLike = {
    get currentTime() {
      return state.now;
    },
    sampleRate: 44100,
    state: "running",
    resume: async () => {},
  } as unknown as AudioContextLike;
  const host: VoiceEngineHost = {
    outbox: new EventOutbox(4),
    sendEvents: () => {},
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
  for (const [lane, schedule] of Object.entries(initial) as [
    LaneId,
    LaneSchedule,
  ][]) {
    session.setLaneSchedule(lane, schedule);
  }
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
    setNow: (when) => {
      state.now = when;
    },
  };
}

describe("rail active-tile follow (refinement-7, sounding ledger)", () => {
  it("distinguishes repeated patterns by their audible chain slot", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, A1, B1]) });
    await h.deliverAt(10);
    expect(h.session.getSoundingSlot("drums")).toBe(0);
    await h.deliverAt(11.9);
    h.setNow(h.timeOf(16) - 0.001);
    expect(h.session.getSoundingSlot("drums")).toBe(0);
    h.setNow(h.timeOf(16) + 0.001);
    expect(h.session.getSoundingPattern("drums")).toBe("A1");
    expect(h.session.getSoundingSlot("drums")).toBe(1);
    await h.deliverAt(13.9);
    h.setNow(h.timeOf(32) + 0.001);
    expect(h.session.getSoundingPattern("drums")).toBe("B1");
    expect(h.session.getSoundingSlot("drums")).toBe(2);
    h.session.transport.stop();
  });

  it("lights the slot at its AUDIBLE time — not at delivery (horizon-ahead slot stays dark)", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    // One refill at play time delivers steps 0..7 (times ≤ 11.0): slot 0 only.
    await h.deliverAt(10.0);
    // Pre-roll: nothing audible yet → the imminent first entry (slot 0).
    h.setNow(10.05);
    expect(h.session.getSoundingPattern("drums")).toBe("A1");

    // Refill late inside slot 0: the horizon delivers PAST the slot-1
    // boundary (step 16's time 12.1 ≤ 11.9 + 1.0) — the engine already
    // holds slot 1's events, but the clock has not reached them.
    await h.deliverAt(11.9);
    expect(h.timeOf(16)).toBe(12.1);
    h.setNow(12.1 - 1e-3);
    expect(
      h.session.getSoundingPattern("drums"),
      "delivered-but-not-audible slot stays dark",
    ).toBe("A1");
    // Pure clock read — no delivery call between: it lights exactly at the
    // slot's first audible step time.
    h.setNow(12.1 + 1e-3);
    expect(h.session.getSoundingPattern("drums")).toBe("B1");
  });

  it("each lane follows its own chain shape (per-lane independence)", async () => {
    // Drums: two 1-bar slots (boundaries at 16, 32, …). Bass: a 1-bar slot
    // then a 2-bar slot (chain 48 steps; slot 1 spans steps 16..47) — the
    // lanes' slot schedules deliberately disagree.
    const bassLong: PitchedPattern = {
      kind: "pitched",
      id: "BB",
      name: "BB",
      bars: 2,
      rowDegrees: [0],
      notes: [
        { degree: 0, start: 0, length: 1 },
        { degree: 0, start: 16, length: 1 },
      ],
    };
    const h = await makeHarness({
      drums: scheduleFor([A1, B1]),
      bass: bassSchedule([bassPattern("BA"), bassLong]),
    });
    await h.deliverAt(10.0);
    await h.deliverAt(11.9);
    h.setNow(12.2); // step 16+ audible: drums slot 1, bass slot 1
    expect(h.session.getSoundingPattern("drums")).toBe("B1");
    expect(h.session.getSoundingPattern("bass")).toBe("BB");
    await h.deliverAt(14.0);
    h.setNow(14.2); // step 32+ audible: drums WRAPPED to slot 0…
    expect(h.session.getSoundingPattern("drums")).toBe("A1");
    expect(
      h.session.getSoundingPattern("bass"),
      "…but bass is still inside its 2-bar slot 1 (own chain shape)",
    ).toBe("BB");
  });

  it("natural chain wrap returns to slot 0 at the iteration boundary's audible time", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverAt(10.0);
    await h.deliverAt(11.9); // slot 1 delivered (12.1)
    await h.deliverAt(14.0); // steps past 32's time (14.1) not yet audible…
    h.setNow(14.05);
    expect(h.session.getSoundingPattern("drums")).toBe("B1");
    h.setNow(14.15); // …step 32 audible: iteration 2, slot 0
    expect(h.session.getSoundingPattern("drums")).toBe("A1");
  });

  it("stopped parks on the last-sounded slot; cancelled future entries never read; fresh play flushes", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverAt(10.0);
    await h.deliverAt(11.9); // slot 1 (12.1) delivered but not yet audible
    h.session.transport.stop();
    h.setNow(12.5); // past the cancelled slot-1 time while stopped
    expect(
      h.session.getSoundingPattern("drums"),
      "stop cancels undelivered audio — the park keeps the last-sounded slot",
    ).toBe("A1");

    // Fresh play: ledger flushed with the R-3 cursor (togglePlay start
    // branch) → the follow reads the imminent slot 0 again.
    await h.session.togglePlay();
    await h.deliverAt(13.0);
    expect(h.session.getSoundingPattern("drums")).toBe("A1");
  });

  it("before any playback the seam reports null (UI keeps the getActivePattern fallback)", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    h.session.transport.stop();
    expect(h.session.getSoundingPattern("drums")).toBeNull();
    expect(h.session.getActivePattern("drums")).toBe("A1"); // unchanged seam
  });

  it("a boundary switch flips the follow at the boundary's AUDIBLE time; getActivePattern flips at DELIVERY (seams distinct)", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverAt(10.0);
    await h.deliverAt(10.7); // steps 0..12 delivered (inside slot 0)
    const alt = drumPattern("ALT", 1, [4]);
    h.session.setActivePattern("drums", "ALT", scheduleFor([alt]));
    expect(h.session.getPendingSwitch("drums")!.appliesAtStep).toBe(16);

    await h.deliverAt(11.9); // step 16 delivered (12.1): switch LANDS here
    expect(
      h.session.getActivePattern("drums"),
      "IM-7 seam flips at delivery (unchanged semantics)",
    ).toBe("ALT");
    h.setNow(12.05);
    expect(
      h.session.getSoundingPattern("drums"),
      "follow waits for the boundary to SOUND",
    ).toBe("A1");
    h.setNow(12.15);
    expect(h.session.getSoundingPattern("drums")).toBe("ALT");
  });

  it("the ledger stays bounded across arbitrarily long playback (many wraps)", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    // 8 full iterations (256 steps ≈ 32 s), delivering one horizon at a time.
    for (let step = 0; step <= 256; step += 6) {
      await h.deliverAt(h.timeOf(step) - 1e-3);
      h.setNow(h.timeOf(step) + 1e-3);
      const local = Math.floor(step / 16) % 2;
      expect(h.session.getSoundingPattern("drums")).toBe(local ? "B1" : "A1");
    }
  });
});
