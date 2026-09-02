/**
 * HU-2 session surface: master duck (device-change pop guard) and the
 * dev-only voice-steal counter (reset per play, fed by the host's onStolen).
 */

import { describe, expect, it } from "vitest";
import { AudioEngineContext } from "../src/audio/context";
import { Session } from "../src/engine/session";
import { isProjectEmpty } from "../src/state/emptyProject";
import { createDefaultProject } from "../src/document/schema";

function fakeGainParam() {
  return {
    value: 0.9,
    calls: [] as string[],
    setValueAtTime(v: number, t: number) {
      this.value = v;
      this.calls.push(`set(${v.toFixed(3)}@${t.toFixed(3)})`);
    },
    cancelScheduledValues(t: number) {
      this.calls.push(`cancel(@${t.toFixed(3)})`);
    },
    linearRampToValueAtTime(v: number, t: number) {
      this.value = v;
      this.calls.push(`ramp(${v.toFixed(3)}@${t.toFixed(3)})`);
    },
  };
}

function duckableSession() {
  const gain = fakeGainParam();
  const master = { gain, connect: () => undefined };
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
    createGain: () => master as unknown as GainNode,
  };
  const session = new Session({
    engine: new AudioEngineContext(() => ctx),
    playTickSound: () => undefined,
    cancelTickSounds: () => undefined,
  });
  return { session, gain, ensureMaster: () => (session as unknown as { ensureMaster: () => GainNode }).ensureMaster() };
}

describe("Session.duckMaster (HU-2 pop guard)", () => {
  it("is a safe no-op before the master gain exists", () => {
    const { session, gain } = duckableSession();
    session.duckMaster();
    expect(gain.calls).toHaveLength(0);
  });

  it("fades to silence in 30 ms and back by 130 ms, keeping the volume", () => {
    const { session, gain, ensureMaster } = duckableSession();
    ensureMaster();
    session.setMasterVolume(0.8);
    session.duckMaster();
    const ramps = gain.calls.filter((c) => c.startsWith("ramp"));
    expect(ramps).toEqual(["ramp(0.000@10.030)", "ramp(0.800@10.130)"]);
  });
});

describe("voice-steal stats (HU-2, dev-only by design)", () => {
  it("counts steals on the session and resets", () => {
    const session = new Session({
      engine: new AudioEngineContext(() => ({
        currentTime: 0,
        sampleRate: 44100,
        state: "running" as AudioContextState,
        async resume() {
          /* noop */
        },
      })),
      playTickSound: () => undefined,
      cancelTickSounds: () => undefined,
    });
    // The real wiring path: defaultCreateVoiceEngine passes onStolen into
    // createVoiceEngine, which fires it on each {type:'stolen'} worklet
    // message. Simulate the callback the host would invoke.
    const noteVoiceStolen = (
      session as unknown as { noteVoiceStolen: (this: unknown) => void }
    ).noteVoiceStolen;
    noteVoiceStolen.call(session);
    noteVoiceStolen.call(session);
    expect(session.voiceStealCount).toBe(2);
    session.resetVoiceStealCount();
    expect(session.voiceStealCount).toBe(0);
  });

  it("togglePlay's start branch resets the counter (source-verified wiring)", () => {
    expect(Session.prototype.togglePlay.toString()).toContain("resetVoiceStealCount");
  });

  it("the worklet reports steals (source-verified: busy-voice branch posts)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/audio/worklets/voiceEngine.js", "utf8");
    expect(src).toContain('postMessage({ type: "stolen" })');
  });
});

describe("empty-project predicate", () => {
  it("default project is empty; any drum or pitched note clears it", () => {
    expect(isProjectEmpty(createDefaultProject())).toBe(true);

    const withDrum: typeof createDefaultProject = JSON.parse(
      JSON.stringify(createDefaultProject()),
    );
    const drum = withDrum.patterns.drums[0]!;
    if (drum.kind === "drums") drum.steps.kick[0] = true;
    expect(isProjectEmpty(withDrum)).toBe(false);

    const withNote: typeof createDefaultProject = JSON.parse(
      JSON.stringify(createDefaultProject()),
    );
    const lead = withNote.patterns.lead[0]!;
    if (lead.kind === "pitched") lead.rows[0]!.steps[0] = 1;
    expect(isProjectEmpty(withNote)).toBe(false);
  });
});
