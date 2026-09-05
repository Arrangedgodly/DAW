/**
 * IM-6 engine-bridge tests: scale wiring and recompilation triggers, via a
 * fake session seam (no audio, no browser).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  canUndo,
  docStore,
  setLaneChain,
  setLaneGate,
  setLaneMix,
  setLaneScaleOverride,
  setProjectScale,
  setTransport,
  togglePitchedCell,
  undo,
  addPattern,
  appendBlankPattern,
  resizePattern,
} from "../src/state/store";
import { connectStoreToEngine } from "../src/state/engineBridge";
import type { Session } from "../src/engine/session";
import type { LaneSchedule } from "../src/audio/song";
import type { EffectiveScale } from "../src/document/scales";
import type { LaneId, LaneMix } from "../src/document/schema";

interface FakeSession {
  schedules: Map<LaneId, LaneSchedule>;
  sounds: Record<string, string>;
  scales: Record<string, EffectiveScale>;
  mixes: Record<string, LaneMix>;
  /** RC-1: pushed lane register offsets (audition path). */
  octaves: Record<string, number>;
  bpm: number;
  swing: number;
  metronome: boolean;
  /** LL-2: the pushed transport cycle basis (LCM of lane chain totals). */
  cycleSteps: number;
  /** LL-2: how many times the transport basis was pushed (churn teeth). */
  setCycleStepsCalls: number;
  compiles: LaneId[];
  setLaneSchedule(lane: LaneId, schedule: LaneSchedule): void;
  setLaneSound(lane: LaneId, id: string): void;
  setLaneChain(lane: LaneId, devices: readonly unknown[]): void;
  setLaneScale(lane: string, scale: EffectiveScale | null): void;
  setLaneMix(lane: LaneId, mix: LaneMix): void;
  /** RC-1: the register offset push for auditions. */
  setLaneOctave(lane: string, octave: number | null): void;
  setBpm(bpm: number): void;
  setSwingAmount(a: number): void;
  setMetronome(on: boolean): void;
  transport: {
    setCycleSteps(steps: number): void;
    snapshot: { bpm: number; swing: number };
  };
}

function fakeSession(): FakeSession {
  const s: FakeSession = {
    schedules: new Map(),
    sounds: {},
    scales: {},
    mixes: {},
    octaves: {},
    bpm: -1,
    swing: -1,
    metronome: false,
    cycleSteps: -1,
    setCycleStepsCalls: 0,
    compiles: [],
    setLaneSchedule(lane, schedule) {
      s.schedules.set(lane, schedule);
      s.compiles.push(lane);
    },
    setLaneSound(lane, id) {
      s.sounds[lane] = id;
    },
    setLaneChain() {
      // IM-4 chain pushes are covered by the fx suites.
    },
    setLaneScale(lane, scale) {
      if (scale === null) delete s.scales[lane];
      else s.scales[lane] = scale;
    },
    setLaneMix(lane, mix) {
      s.mixes[lane] = mix;
    },
    setLaneOctave(lane, octave) {
      if (octave === null || octave === 0) delete s.octaves[lane];
      else s.octaves[lane] = octave;
    },
    setBpm(bpm) {
      s.bpm = bpm;
    },
    setSwingAmount(a) {
      s.swing = a;
    },
    setMetronome(on) {
      s.metronome = on;
    },
    transport: {
      setCycleSteps(steps) {
        s.cycleSteps = steps;
        s.setCycleStepsCalls++;
      },
      snapshot: { bpm: 120, swing: 0 },
    },
  };
  return s;
}

beforeEach(() => {
  // Rewind to the initial document, then drop all history (redo would
  // otherwise re-apply the previous test's edits and refill `past`).
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

describe("connectStoreToEngine", () => {
  it("initial push syncs transport, lane sounds/scales, and compiles all lanes", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    disconnect();

    expect(s.bpm).toBe(120);
    // LL-2 (E5 re-based): the transport cycle basis = the LCM of lane chain
    // totals — the default's four 1-bar chains give 16 steps (v0.1's basis
    // exactly; the zero-drift shape).
    expect(s.cycleSteps).toBe(16);
    expect(s.sounds["drums"]).toBe("kit-default");
    expect(s.sounds["lead"]).toBe("preset-lead-1");
    // Pitched lanes got their effective scale (project default C minor).
    expect(s.scales["bass"]).toMatchObject({ root: 0, mode: "minor" });
    expect(new Set(s.compiles)).toEqual(
      new Set(["drums", "bass", "chords", "lead"]),
    );
  });

  it("scale change recompiles pitched lanes with the new scale, not drums", () => {
    const s = fakeSession();
    togglePitchedCell("bass", 0, 0); // one event so recompilation is observable
    const disconnect = connectStoreToEngine(s as unknown as Session);
    s.compiles.length = 0;

    setProjectScale({ root: 4, mode: "major" });
    expect(new Set(s.compiles)).toEqual(new Set(["bass", "chords", "lead"]));
    expect(s.compiles).not.toContain("drums");
    expect(s.scales["bass"]).toMatchObject({ root: 4, mode: "major" });
    // The bass event's frequency followed the new scale (E major degree 0 = E,
    // bass preset octaveBase 2 → E2).
    const bassEvents = [...s.schedules.get("bass")!.byStep.values()].flat();
    const bassEvent = bassEvents[0];
    expect(bassEvent.freq).toBeCloseTo(82.41, 1);

    disconnect();
  });

  it("per-lane override changes recompile only affected pitched lane's scale", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    setLaneScaleOverride("chords", { root: 7, mode: "dorian" });
    expect(s.scales["chords"]).toMatchObject({ root: 7, mode: "dorian" });
    expect(s.scales["bass"]).toMatchObject({ root: 0, mode: "minor" });

    setLaneScaleOverride("chords", null);
    expect(s.scales["chords"]).toMatchObject({ root: 0, mode: "minor" });
    disconnect();
  });

  it("gate change recompiles that lane; chain change recompiles via first-pattern selection", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    s.compiles.length = 0;
    setLaneGate("drums", { unit: "steps", value: 2 });
    expect(s.compiles).toEqual(["drums"]);

    s.compiles.length = 0;
    const b = addPattern("drums", 1, "B");
    setLaneChain("drums", [b]);
    expect(s.compiles).toContain("drums");
    disconnect();
  });

  it("transport change syncs session transport and recompiles (groove input)", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    s.compiles.length = 0;
    setTransport({ bpm: 150 });
    expect(s.bpm).toBe(150);
    expect(s.cycleSteps).toBe(16); // unchanged chain totals: still the LCM 16
    expect(new Set(s.compiles)).toEqual(
      new Set(["drums", "bass", "chords", "lead"]),
    );
    disconnect();
  });

  it("LL-2 basis: the transport cycle = the LCM of lane CHAIN totals (E5 re-based — pool-only patterns never move it)", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    s.setCycleStepsCalls = 0;
    const doc = () => docStore.getState().doc;
    const chainId = (lane: LaneId) => doc().songChain[lane][0]!;

    // Resize the CHAINED drums pattern 1→2 bars: chain total 32 → LCM 32.
    expect(resizePattern("drums", chainId("drums"), 2).ok).toBe(true);
    expect(s.cycleSteps).toBe(32);

    // IM-6 split (SE-1, the LL-2 half): an UNCHAINED pool pattern — however
    // wide — never moves the playhead basis (grid extent follows pattern
    // bars [LL-1]; playhead follows CHAIN totals [this law]).
    const pool = addPattern("lead", 128, "B");
    expect(doc().songChain.lead).not.toContain(pool);
    expect(s.cycleSteps).toBe(32);

    // Resize lead's CHAINED pattern to 8 bars: LCM(32, 128, 16, 16) = 128.
    expect(resizePattern("lead", chainId("lead"), 8).ok).toBe(true);
    expect(s.cycleSteps).toBe(128);

    // A multi-slot chain makes an INCOMMENSURATE total: the rail `+`
    // appends a 1-bar blank next to the 2-bar pattern → drums [2-bar,
    // 1-bar] = 48 steps → the TRUE LCM (48, 128, 16, 16) = 384 — not the
    // longest lane (the powers-of-two coincidence does not carry the law).
    const blank = appendBlankPattern("drums", "E");
    expect(doc().songChain.drums).toEqual([chainId("drums"), blank]);
    expect(doc().patterns.drums.find((p) => p.id === blank)!.bars).toBe(1);
    expect(s.cycleSteps).toBe(384);

    // Content-only edits do NOT re-push (value-compared derivation — no
    // spurious setCycleSteps churn on note toggles).
    const callsBefore = s.setCycleStepsCalls;
    togglePitchedCell("bass", 0, 0);
    expect(s.setCycleStepsCalls).toBe(callsBefore);
    disconnect();
  });

  it("LY-1: mix edits push effectiveLaneMix to the session on the lane commit", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    // Default push: canonical-empty mix = the default triple on every lane.
    expect(s.mixes["bass"]).toEqual({ volume: 1, mute: false, solo: false });
    setLaneMix("bass", { volume: 0.25, solo: true });
    expect(s.mixes["bass"]).toEqual({ volume: 0.25, mute: false, solo: true });
    // The OTHER lanes re-push too (solo ducks them — the session recomputes
    // all four gains from one lane's push).
    expect(s.mixes["lead"]).toEqual({ volume: 1, mute: false, solo: false });
    // Mix edits do NOT recompile lane schedules (no groove/scale input).
    s.compiles.length = 0;
    setLaneMix("lead", { mute: true });
    expect(s.compiles).toHaveLength(0);
    disconnect();
  });
});
