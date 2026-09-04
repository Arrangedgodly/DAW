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
  bpm: number;
  swing: number;
  metronome: boolean;
  loopBars: number;
  /** SV-1: how many times the transport basis was pushed (churn teeth). */
  setLoopBarsCalls: number;
  compiles: LaneId[];
  setLaneSchedule(lane: LaneId, schedule: LaneSchedule): void;
  setLaneSound(lane: LaneId, id: string): void;
  setLaneChain(lane: LaneId, devices: readonly unknown[]): void;
  setLaneScale(lane: string, scale: EffectiveScale | null): void;
  setLaneMix(lane: LaneId, mix: LaneMix): void;
  setBpm(bpm: number): void;
  setSwingAmount(a: number): void;
  setMetronome(on: boolean): void;
  transport: {
    setLoopBars(bars: number): void;
    snapshot: { bpm: number; swing: number };
  };
}

function fakeSession(): FakeSession {
  const s: FakeSession = {
    schedules: new Map(),
    sounds: {},
    scales: {},
    mixes: {},
    bpm: -1,
    swing: -1,
    metronome: false,
    loopBars: -1,
    setLoopBarsCalls: 0,
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
      setLoopBars(bars) {
        s.loopBars = bars;
        s.setLoopBarsCalls++;
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
    // SV-1 (J6): the derived loop basis is authoritative through the compat
    // window — the default's all-1-bar patterns derive 1 (the retired
    // persisted field's value, engine-side).
    expect(s.loopBars).toBe(1);
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
    expect(s.loopBars).toBe(1); // unchanged transport object basis: still 1
    expect(new Set(s.compiles)).toEqual(
      new Set(["drums", "bass", "chords", "lead"]),
    );
    disconnect();
  });

  it("SV-1 compat derivation: pattern-bars edits re-push the derived loop basis (E5)", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    s.setLoopBarsCalls = 0;

    // Widening the vocabulary through the store: a 2-bar pattern derives 2.
    addPattern("drums", 2, "B");
    expect(s.loopBars).toBe(2);
    // The derivation CLAMPS at 4 through the compat window (the transport
    // LoopBars type stays 1|2|4 until LL-2 re-bases it).
    addPattern("lead", 8, "B");
    expect(s.loopBars).toBe(4);
    // …and stays 4 at the vocabulary ceiling.
    addPattern("bass", 128, "B");
    expect(s.loopBars).toBe(4);

    // Content-only edits do NOT re-push (value-compared derivation — no
    // spurious setLoopBars churn on note toggles).
    const callsBefore = s.setLoopBarsCalls;
    togglePitchedCell("bass", 0, 0);
    expect(s.setLoopBarsCalls).toBe(callsBefore);
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
