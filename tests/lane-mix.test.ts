/**
 * LY-1 lane-mix tests: the quadrant strip's VOLUME/MUTE/SOLO law end to end —
 * document fields (canonical-empty at defaults, the chainCues precedent),
 * store actions (undo, coalescing), the session's effective-gain law
 * (solo ducks every non-solo lane), and the engineBridge push.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AudioEngineContext } from "../src/audio/context";
import type { VoiceEngineHost } from "../src/audio/voiceEngine";
import { Session } from "../src/engine/session";
import {
  DEFAULT_LANE_MIX,
  effectiveLaneMix,
  type ProjectDocument,
} from "../src/document/schema";
import { canUndo, docStore, setLaneMix, undo } from "../src/state/store";

// ---------------------------------------------------------------------------
// Store: document shape + undo
// ---------------------------------------------------------------------------

function laneOf(doc: ProjectDocument, lane: string) {
  return doc.lanes.find((l) => l.id === lane)!;
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

describe("setLaneMix (document writes)", () => {
  it("defaults are canonical-empty: a default project carries no mix keys", () => {
    const doc = docStore.getState().doc;
    for (const lane of doc.lanes) {
      expect(lane.volume).toBeUndefined();
      expect(lane.mute).toBeUndefined();
      expect(lane.solo).toBeUndefined();
      expect(effectiveLaneMix(lane)).toEqual(DEFAULT_LANE_MIX);
    }
  });

  it("writes explicit values away from defaults and validates them", () => {
    setLaneMix("bass", { volume: 0.25, mute: true });
    const bass = laneOf(docStore.getState().doc, "bass");
    expect(bass.volume).toBe(0.25);
    expect(bass.mute).toBe(true);
    expect(bass.solo).toBeUndefined();
    // Other lanes untouched.
    expect(laneOf(docStore.getState().doc, "lead").volume).toBeUndefined();
  });

  it("returning to a default OMITS the key again (canonical empty form)", () => {
    setLaneMix("bass", { volume: 0.25, mute: true });
    setLaneMix("bass", { volume: 1, mute: false });
    const bass = laneOf(docStore.getState().doc, "bass");
    expect(bass.volume).toBeUndefined();
    expect(bass.mute).toBeUndefined();
    expect(effectiveLaneMix(bass)).toEqual(DEFAULT_LANE_MIX);
  });

  it("out-of-range volume throws through validation, store untouched", () => {
    const before = docStore.getState().doc;
    expect(() => setLaneMix("lead", { volume: 1.5 })).toThrow();
    expect(() => setLaneMix("lead", { volume: -0.1 })).toThrow();
    expect(docStore.getState().doc).toBe(before);
  });

  it("undo restores the pre-mix document; rapid volume edits coalesce", () => {
    const before = docStore.getState().doc;
    setLaneMix("lead", { volume: 0.8 });
    setLaneMix("lead", { volume: 0.6 });
    setLaneMix("lead", { volume: 0.4 });
    expect(laneOf(docStore.getState().doc, "lead").volume).toBe(0.4);
    undo();
    // All three writes landed inside one 350 ms coalescing window → ONE step.
    expect(docStore.getState().doc).toBe(before);
  });

  it("mix edits on one lane form ONE coalesced gesture (mix:<lane> family)", () => {
    const before = docStore.getState().doc;
    setLaneMix("drums", { volume: 0.5 });
    setLaneMix("drums", { solo: true });
    const drums = laneOf(docStore.getState().doc, "drums");
    expect(drums.volume).toBe(0.5);
    expect(drums.solo).toBe(true);
    undo();
    // Both writes landed inside the 350 ms window on the same lane → one
    // undo step returns to the pre-mix document (a mixing gesture is whole).
    expect(docStore.getState().doc).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Session: effective-gain law (mute / solo-duck / volume)
// ---------------------------------------------------------------------------

function fakeGainParam(initial = 1) {
  return {
    value: initial,
    ramps: [] as string[],
    setValueAtTime(v: number, t: number) {
      this.value = v;
      void t;
    },
    cancelScheduledValues() {
      /* recorded via ramps below */
    },
    linearRampToValueAtTime(v: number, t: number) {
      this.value = v;
      this.ramps.push(
        `ramp(${v.toFixed(3)}@+${(t * 1000 - 10_000).toFixed(0)}ms)`,
      );
    },
  };
}

function mixSession() {
  const gains: ReturnType<typeof fakeGainParam>[] = [];
  const connections: string[] = [];
  const ctx = {
    currentTime: 10,
    sampleRate: 44100,
    state: "running" as AudioContextState,
    async resume() {
      /* noop */
    },
    destination: {} as unknown as AudioNode,
    createOscillator: () => {
      throw new Error("not needed");
    },
    createGain: () => {
      const param = fakeGainParam();
      gains.push(param);
      return {
        gain: param,
        connect: (to: unknown) => {
          connections.push(
            `gain${gains.length}->${(to as { kind?: string })?.kind ?? "node"}`,
          );
        },
      } as unknown as GainNode;
    },
    createWaveShaper: () =>
      ({
        connect: () => undefined,
        curve: null,
        oversample: "none",
      }) as unknown as WaveShaperNode,
  };
  const host: VoiceEngineHost = {
    sendEvents: () => undefined,
    connect: () => undefined,
    allOff: () => undefined,
    waitUntilLoaded: async () => undefined,
  };
  const session = new Session({
    engine: new AudioEngineContext(() => ctx),
    createVoiceEngineHost: async () => host,
    playTickSound: () => undefined,
    cancelTickSounds: () => undefined,
  });
  const ensure = () =>
    (
      session as unknown as {
        ensureVoiceEngine: () => Promise<VoiceEngineHost | null>;
      }
    ).ensureVoiceEngine();
  return { session, gains, connections, ensure };
}

describe("Session.setLaneMix (LY-1 gain law)", () => {
  it("before the graph exists, mix values are remembered and applied at creation", async () => {
    const { session, gains, ensure } = mixSession();
    session.setLaneMix("bass", { volume: 0.25, mute: false, solo: false });
    await ensure();
    // gain[0] = master; gains[1..4] = lanes in LANE_IDS order (drums, bass,
    // chords, lead).
    expect(gains[2]!.value).toBe(0.25);
    expect(gains[1]!.value).toBe(1);
  });

  it("volume ramps with an 8 ms de-click on the lane's own gain only", async () => {
    const { session, gains, ensure } = mixSession();
    await ensure();
    session.setLaneMix("lead", { volume: 0.5, mute: false, solo: false });
    expect(gains[4]!.value).toBe(0.5);
    expect(gains[4]!.ramps).toContain("ramp(0.500@+8ms)");
    expect(gains[1]!.value).toBe(1); // other lanes untouched
    expect(gains[0]!.value).toBe(0.9); // master untouched
  });

  it("mute silences the lane", async () => {
    const { session, gains, ensure } = mixSession();
    await ensure();
    session.setLaneMix("drums", { volume: 1, mute: true, solo: false });
    expect(gains[1]!.value).toBe(0);
    expect(gains[2]!.value).toBe(1);
  });

  it("solo ducks every OTHER lane to silence and restores on solo off", async () => {
    const { session, gains, ensure } = mixSession();
    await ensure();
    session.setLaneMix("chords", { volume: 0.7, mute: false, solo: true });
    expect(gains[3]!.value).toBe(0.7); // the solo lane keeps its volume
    expect(gains[1]!.value).toBe(0); // drums
    expect(gains[2]!.value).toBe(0); // bass
    expect(gains[4]!.value).toBe(0); // lead
    session.setLaneMix("chords", { volume: 0.7, mute: false, solo: false });
    expect(gains[1]!.value).toBe(1);
    expect(gains[2]!.value).toBe(1);
    expect(gains[4]!.value).toBe(1);
  });

  it("mute wins over solo on the same lane (silence is silence)", async () => {
    const { session, gains, ensure } = mixSession();
    await ensure();
    session.setLaneMix("lead", { volume: 1, mute: true, solo: true });
    expect(gains[4]!.value).toBe(0);
  });

  it("getLaneMix reads back the last push", async () => {
    const { session } = mixSession();
    session.setLaneMix("bass", { volume: 0.3, mute: true, solo: false });
    expect(session.getLaneMix("bass")).toEqual({
      volume: 0.3,
      mute: true,
      solo: false,
    });
  });
});
