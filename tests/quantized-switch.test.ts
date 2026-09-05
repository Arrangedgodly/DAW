/**
 * IM-7 quantized live-switching tests (fake ctx, exact-equality timing):
 * - a switch requested after step k applies EXACTLY at the lane's next
 *   pattern boundary (never mid-pattern, never touching other lanes);
 * - mismatched bar counts defer to the next chain-iteration boundary with an
 *   exact schedule rebuild (following segments shifted);
 * - chain (structure) edits re-derive the schedule at the next iteration
 *   boundary only; content edits apply at the next delivered step (DES-4);
 * - pending state is observable for the UI.
 */

import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";
import { compileLaneSchedule, type LaneSchedule } from "../src/audio/song";
import { getDrumKit, getPreset } from "../src/audio/presets";
import { EventOutbox, type VoiceEngineHost } from "../src/audio/voiceEngine";
import type { AudioContextLike } from "../src/audio/context";
import { toEffectiveScale } from "../src/document/scales";
import type { DrumPattern, LaneId, Pattern } from "../src/document/schema";

const KIT = getDrumKit("kit-default")!;
const GATE = { unit: "steps", value: 1 } as const;
const GROOVE = { bpm: 120, swing: 0 };
const SPB = 0.125; // seconds per 16th at 120 bpm
const TIMELINE = 10.1; // play() at ctx.now = 10 + 0.1 start delay

function drumPattern(
  id: string,
  bars: 1 | 2 | 4,
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
    gate: GATE,
    groove: GROOVE,
  });
}

interface Harness {
  session: Session;
  sent: { lane: number; step: number; time: number; freq: number | undefined }[];
  deliverUpTo(step: number): Promise<void>;
  /** R-3: manual refill at an absolute audio-clock time (re-play clocks). */
  deliverAt(when: number): Promise<void>;
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
  const sent: Harness["sent"] = [];
  // Step attribution is exact: delivered events carry the tick's absolute
  // time = TIMELINE + globalStep * SPB (swing 0). R-3 also keeps the raw
  // time so re-played passes (a NEW timeline start) can be attributed.
  const host: VoiceEngineHost = {
    outbox: new EventOutbox(4),
    sendEvents: (lane, events) => {
      for (const e of events) {
        sent.push({
          lane,
          step: Math.round((e.time - TIMELINE) / SPB),
          time: e.time,
          freq: e.freq,
        });
      }
    },
    connect: () => {},
    allOff: () => {},
    dispose: () => {},
  };
  let intervalCb: (() => void) | null = null;
  const session = new Session({
    engine: { getContext: () => ctx, unlock: async () => {} } as never,
    createVoiceEngineHost: async () => host,
    horizonSeconds: 0.1,
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
  };
  const deliverUpTo = async (step: number) => {
    // Clock just past step `step`'s tick: the 0.1 s horizon covers exactly
    // steps 0..step (the next tick is 0.125 s away).
    state.now = TIMELINE + step * SPB + 1e-6;
    intervalCb!();
    await settle();
  };
  const deliverAt = async (when: number) => {
    state.now = when + 1e-6;
    intervalCb!();
    await settle();
  };
  return { session, sent, deliverUpTo, deliverAt };
}

function freqsAt(
  h: Harness,
  lane: number,
  step: number,
): (number | undefined)[] {
  return h.sent
    .filter((s) => s.lane === lane && s.step === step)
    .map((s) => s.freq);
}

const A1 = drumPattern("A1", 1, [0]); // kick at pattern step 0
const B1 = drumPattern("B1", 1, [0, 8]); // kicks at pattern steps 0 and 8
const C2 = drumPattern("C2", 2, [0, 8, 24]); // 2 bars

describe("quantized live switching (IM-7)", () => {
  it("same-bar switch applies at the very next segment boundary, exactly", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverUpTo(5); // steps 0..5 delivered (inside segment A1)
    expect(freqsAt(h, 0, 0).length).toBe(1); // A1 kick fired at step 0

    const alt = drumPattern("ALT", 1, [4]); // kick at pattern step 4
    h.session.setActivePattern("drums", "ALT", scheduleFor([alt]));
    const pending = h.session.getPendingSwitch("drums")!;
    expect(pending.appliesAtStep).toBe(16); // EXACT: next boundary after step 5
    expect(pending.mode).toBe("boundary");
    expect(pending.toPatternId).toBe("ALT");
    expect(pending.fromPatternId).toBe("B1"); // the slot being switched

    await h.deliverUpTo(15);
    expect(h.session.getPendingSwitch("drums")).not.toBeNull(); // still pending
    await h.deliverUpTo(16);
    expect(h.session.getPendingSwitch("drums")).toBeNull(); // applied exactly here
    expect(freqsAt(h, 0, 16)).toEqual([]); // ALT has NO event at its step 0
    await h.deliverUpTo(20);
    expect(freqsAt(h, 0, 20).length).toBe(1); // ALT kick at chain step 16+4
    // Slot substitution persists into the next iteration (16 → 48).
    await h.deliverUpTo(52);
    expect(freqsAt(h, 0, 52).length).toBe(1); // 48 + 4
    expect(h.session.getActivePattern("drums")).toBe("ALT");
  });

  it("mismatched-bar switch defers to the iteration boundary and rebuilds exactly", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverUpTo(5);
    h.session.setActivePattern("drums", "C2", scheduleFor([C2]));
    const pending = h.session.getPendingSwitch("drums")!;
    // First upcoming boundary (16, slot B1, 1 bar) cannot fit a 2-bar pattern.
    expect(pending.mode).toBe("iteration");
    expect(pending.appliesAtStep).toBe(32); // EXACT: next chain-iteration boundary

    await h.deliverUpTo(31);
    expect(freqsAt(h, 0, 16).length).toBe(1); // original B1 still plays at 16
    expect(freqsAt(h, 0, 24).length).toBe(1); // B1's step 8 at chain 24
    await h.deliverUpTo(32);
    expect(h.session.getPendingSwitch("drums")).toBeNull();
    expect(freqsAt(h, 0, 32).length).toBe(1); // C2 kick at rebuilt local 0
    // New chain [C2(32), B1(16)] = 48 steps: C2's step 24 → global 56.
    await h.deliverUpTo(56);
    expect(freqsAt(h, 0, 56).length).toBe(1);
    // B1 shifted from local 16 to local 32: global 64 / 72.
    await h.deliverUpTo(64);
    await h.deliverUpTo(72);
    expect(freqsAt(h, 0, 64).length).toBe(1);
    expect(freqsAt(h, 0, 72).length).toBe(1);
  });

  it("switching never disturbs other lanes (per-lane independence)", async () => {
    const bassA: Pattern = {
      kind: "pitched",
      id: "bass-A",
      name: "A",
      bars: 1,
      rowDegrees: [0],
      notes: [{ degree: 0, start: 0, length: 1 }], // v0: lone note-on, gate 1
    };
    const bassSchedule = compileLaneSchedule({
      chain: [bassA],
      preset: getPreset("preset-bass-1")!,
      gate: { unit: "steps", value: 1 },
      groove: GROOVE,
      scale: toEffectiveScale({ root: 0, mode: "minor" }),
    });
    const h = await makeHarness({
      drums: scheduleFor([A1, B1]),
      bass: bassSchedule,
    });
    await h.deliverUpTo(5);
    h.session.setActivePattern(
      "drums",
      "ALT",
      scheduleFor([drumPattern("ALT", 1, [4])]),
    );
    await h.deliverUpTo(20);
    // Bass keeps firing at its own chain wrap (16 steps) regardless.
    expect(freqsAt(h, 1, 0).length).toBe(1);
    expect(freqsAt(h, 1, 16).length).toBe(1);
    expect(h.session.getPendingSwitch("bass")).toBeNull();
  });

  it("chain edits re-derive the schedule only at the next iteration boundary", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverUpTo(5);
    h.session.setActivePattern(
      "drums",
      "ALT",
      scheduleFor([drumPattern("ALT", 1, [2])]),
    );
    // Structure edit while playing supersedes the pending switch.
    h.session.setLaneSchedule("drums", scheduleFor([A1, B1, A1]));
    expect(h.session.getPendingSwitch("drums")).toBeNull();
    await h.deliverUpTo(31);
    expect(freqsAt(h, 0, 16).length).toBe(1); // OLD schedule still plays B1
    await h.deliverUpTo(32);
    // New chain (48 steps) begins exactly at step 32: A1 at local 0.
    expect(freqsAt(h, 0, 32).length).toBe(1);
    await h.deliverUpTo(48);
    await h.deliverUpTo(64);
    expect(freqsAt(h, 0, 48).length).toBe(1); // B1 at new local 16
    expect(freqsAt(h, 0, 64).length).toBe(1); // third slot A1 at local 32
  });

  it("content edits (same structure) apply at the next delivered step (DES-4)", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverUpTo(5);
    const editedA = drumPattern("A1", 1, [0, 6]);
    h.session.setLaneSchedule("drums", scheduleFor([editedA, B1])); // same segments
    await h.deliverUpTo(6);
    expect(freqsAt(h, 0, 6).length).toBe(1); // audible at the next delivered step
  });

  it("pending-switch changes are observable via subscribeSwitches", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    const observed: (string | null)[] = [];
    h.session.subscribeSwitches((lane) => {
      if (lane === "drums") {
        observed.push(h.session.getPendingSwitch("drums")?.toPatternId ?? null);
      }
    });
    await h.deliverUpTo(5);
    h.session.setActivePattern(
      "drums",
      "ALT",
      scheduleFor([drumPattern("ALT", 1, [4])]),
    );
    await h.deliverUpTo(16);
    expect(observed).toEqual(["ALT", null]); // requested, then applied
  });

  // IN-3 (multi-clip cueing): the rail's one-gesture commit fires ONE
  // requestPatternSwitch per touched lane in the same tick. Laws:
  // (a) each lane lands exactly at ITS own next boundary — the simultaneous
  //     requests never interact; (b) a second request on the same lane
  //     supersedes (identical semantics to clicking each tile individually).
  it("multi-lane one-gesture commits land independently, exactly at their boundaries", async () => {
    const h = await makeHarness({
      drums: scheduleFor([A1, B1]), // boundaries at 16, 32 (chain wrap)
      bass: scheduleFor([A1, B1, A1]), // boundaries at 16, 32, 48
    });
    await h.deliverUpTo(5);
    // One gesture, two lanes (the rail funnel order: top→bottom).
    h.session.setActivePattern(
      "drums",
      "D-ALT",
      scheduleFor([drumPattern("D-ALT", 1, [4])]),
    );
    h.session.setActivePattern(
      "bass",
      "B-ALT",
      scheduleFor([drumPattern("B-ALT", 1, [6])]),
    );
    const drumsPending = h.session.getPendingSwitch("drums")!;
    const bassPending = h.session.getPendingSwitch("bass")!;
    expect(drumsPending.toPatternId).toBe("D-ALT");
    expect(drumsPending.appliesAtStep).toBe(16);
    expect(bassPending.toPatternId).toBe("B-ALT");
    expect(bassPending.appliesAtStep).toBe(16); // bass's own next boundary
    // Both still pending just before the boundary; both applied EXACTLY at 16.
    await h.deliverUpTo(15);
    expect(h.session.getPendingSwitch("drums")).not.toBeNull();
    expect(h.session.getPendingSwitch("bass")).not.toBeNull();
    await h.deliverUpTo(16);
    expect(h.session.getPendingSwitch("drums")).toBeNull();
    expect(h.session.getPendingSwitch("bass")).toBeNull();
    await h.deliverUpTo(20);
    await h.deliverUpTo(22);
    expect(freqsAt(h, 0, 20).length).toBe(1); // D-ALT kick at 16+4
    expect(freqsAt(h, 1, 22).length).toBe(1); // B-ALT kick at 16+6
    expect(h.session.getActivePattern("drums")).toBe("D-ALT");
    expect(h.session.getActivePattern("bass")).toBe("B-ALT");
    // Chords/lead were never touched by the gesture: no pending, no switches.
    expect(h.session.getPendingSwitch("chords")).toBeNull();
    expect(h.session.getPendingSwitch("lead")).toBeNull();
  });

  it("same-lane double request (sweep re-entry / individual clicks) supersedes", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverUpTo(5);
    h.session.setActivePattern(
      "drums",
      "ALT-1",
      scheduleFor([drumPattern("ALT-1", 1, [4])]),
    );
    h.session.setActivePattern(
      "drums",
      "ALT-2",
      scheduleFor([drumPattern("ALT-2", 1, [5])]),
    );
    const pending = h.session.getPendingSwitch("drums")!;
    expect(pending.toPatternId).toBe("ALT-2"); // the LAST request owns the lane
    await h.deliverUpTo(16);
    await h.deliverUpTo(21);
    expect(h.session.getActivePattern("drums")).toBe("ALT-2");
    expect(freqsAt(h, 0, 21).length).toBe(1); // ALT-2 kick at 16+5
    expect(freqsAt(h, 0, 20).length).toBe(0); // ALT-1 never landed
  });

  // R-3 (refinement entry 3): play-from-stop must FLUSH the delivery
  // cursor. Anchor steps (and the lastDeliveredStep high-water) are
  // session-lifetime state; after an iteration-mode rebuild the anchor is
  // left at a global step that need not align with the NEW chain length
  // (32-step chain rebuilt at step 32 into a 48-step chain → anchor 32).
  // The next play's global step restarts at 0, so without the flush the
  // lane delivers chain-local (0 − 32) mod 48 = 16 — a slot with no event
  // here, i.e. silent for the first steps while `playing` reads true (the
  // same dead-air class the critique measured on LOOP re-enable).
  it("R-3: play-from-stop flushes the cursor — a fresh play's step 0 is chain-local 0 for every lane (no stale-anchor dead air)", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    await h.deliverUpTo(5);
    h.session.setActivePattern("drums", "C2", scheduleFor([C2])); // 2 bars
    await h.deliverUpTo(32); // iteration rebuild lands: anchor 16→ chain 48
    expect(h.session.getActivePattern("drums")).toBe("C2");

    // STOP, then PLAY through the real togglePlay path (the flush lives in
    // its start branch — transport.play() alone must not be used here).
    h.session.transport.stop();
    const ctx = h.session.engine.getContext();
    const newTimeline = ctx.currentTime + 0.1; // togglePlay's startDelay
    await h.session.togglePlay();
    expect(h.session.transport.snapshot.playing).toBe(true);

    // The fresh play's step 0 delivers the CURRENT chain's local 0 (C2's
    // kick), not a stale-anchor slot. C2 kicks at local 0, 8, 24.
    await h.deliverAt(newTimeline + 0 * SPB);
    const step0 = h.sent.filter(
      (s) => s.lane === 0 && Math.abs(s.time - newTimeline) < 1e-9,
    );
    expect(step0.length).toBe(1); // audible at the very first step
    await h.deliverAt(newTimeline + 8 * SPB);
    const step8 = h.sent.filter(
      (s) => s.lane === 0 && Math.abs(s.time - (newTimeline + 8 * SPB)) < 1e-9,
    );
    expect(step8.length).toBe(1); // C2's second kick on-grid
    h.session.transport.stop();
  });

  // LL-2 (seam G4): the lane's LIVE cycle basis — what the per-lane
  // playhead sweep and the `p` announcement's lane half read.
  it("getLaneCycleSteps tracks the live schedule through substitutions and iteration rebuilds; null before any push", async () => {
    const h = await makeHarness({ drums: scheduleFor([A1, B1]) });
    // Pre-push lane (bass never scheduled here): null — callers fall back
    // to the doc-derived chain total.
    expect(h.session.getLaneCycleSteps("bass")).toBeNull();
    // The pushed chain: A1(16) + B1(16) = 32 steps.
    expect(h.session.getLaneCycleSteps("drums")).toBe(32);
    // Same-bar-count switch (boundary substitution): the total is unchanged
    // the moment it lands (slot-for-slot, by construction).
    h.session.setActivePattern("drums", "A1", scheduleFor([A1]));
    await h.deliverUpTo(16); // B1's slot boundary: substitution lands
    expect(h.session.getLaneCycleSteps("drums")).toBe(32);
    // A bar-count-changing switch (C2, 2 bars) rebuilds the iteration at
    // the chain wrap, replacing slot 0: the LIVE cycle grows to
    // [C2(32), B1(16)] = 48 the moment the rebuild lands.
    h.session.setActivePattern("drums", "C2", scheduleFor([C2]));
    await h.deliverUpTo(32); // chain wrap: the iteration rebuild lands
    expect(h.session.getLaneCycleSteps("drums")).toBe(48);
    h.session.transport.stop();
  });
});
