import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngineContext } from "../src/audio/context";
import {
  Session,
  getSession,
  resetSharedSession,
  type SessionOptions,
} from "../src/engine/session";

function fakeContext(start = 0) {
  const ctx = {
    currentTime: start,
    sampleRate: 44100,
    state: "suspended" as AudioContextState,
    async resume() {
      ctx.state = "running";
    },
  };
  return ctx;
}

function makeSession(opts: Partial<SessionOptions> = {}) {
  const ctx = fakeContext();
  const playTickSound = vi.fn();
  const cancelTickSounds = vi.fn();
  const session = new Session({
    engine: new AudioEngineContext(() => ctx),
    playTickSound,
    cancelTickSounds,
    ...opts,
  });
  return { ctx, session, playTickSound, cancelTickSounds };
}

describe("Session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSharedSession();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetSharedSession();
  });

  it("exposes a lazy singleton (no AudioContext constructed until used)", () => {
    expect(getSession()).toBe(getSession());
    expect(getSession().engine.created).toBe(false);
    expect(getSession().transport).toBe(getSession().transport);
  });

  it("togglePlay unlocks the context, then starts playback", async () => {
    const { ctx, session } = makeSession();
    expect(ctx.state).toBe("suspended");
    await session.togglePlay();
    expect(ctx.state).toBe("running"); // unlock ran first
    expect(session.transport.snapshot.playing).toBe(true);
    await session.togglePlay();
    expect(session.transport.snapshot.playing).toBe(false);
  });

  it("forwards bpm/swing through the transport's clamping", () => {
    const { session } = makeSession();
    session.setBpm(999);
    expect(session.transport.snapshot.bpm).toBe(200);
    session.setBpm(10);
    expect(session.transport.snapshot.bpm).toBe(60);
    session.setSwingAmount(7);
    expect(session.transport.snapshot.swing).toBe(1);
    session.setSwingAmount(-1);
    expect(session.transport.snapshot.swing).toBe(0);
  });

  it("setMasterVolume clamps to 0..1 and reports the stored value", () => {
    const { session } = makeSession();
    session.setMasterVolume(2);
    expect(session.masterVolume).toBe(1);
    session.setMasterVolume(-1);
    expect(session.masterVolume).toBe(0);
    session.setMasterVolume(0.5);
    expect(session.masterVolume).toBe(0.5);
  });

  it("metronome off by default: ticks schedule no clicks", async () => {
    const { session, playTickSound } = makeSession();
    await session.togglePlay();
    expect(session.transport.snapshot.playing).toBe(true);
    expect(playTickSound).not.toHaveBeenCalled();
    await session.togglePlay();
  });

  it("metronome clicks only on quarter notes; downbeat on bar starts", async () => {
    const { session, playTickSound, cancelTickSounds } = makeSession();
    session.setMetronome(true);
    await session.togglePlay();
    // 120 bpm, start delay 0.1 s, horizon 1.5 s: quarter steps 0,4,8
    expect(playTickSound.mock.calls).toEqual([
      [0.1, true], // step 0 — bar downbeat
      [0.6, false], // step 4
      [1.1, false], // step 8
    ]);
    await session.togglePlay();
    expect(cancelTickSounds).toHaveBeenCalledTimes(1);
  });

  it("toggling the metronome mid-play applies from the next scheduled tick", async () => {
    const { ctx, session, playTickSound } = makeSession();
    await session.togglePlay();
    expect(playTickSound).not.toHaveBeenCalled();
    session.setMetronome(true);
    ctx.currentTime = 1;
    vi.advanceTimersByTime(200); // refill schedules the next horizon
    expect(playTickSound.mock.calls.length).toBeGreaterThan(0);
    expect(
      playTickSound.mock.calls.every(
        ([, downbeat]) => typeof downbeat === "boolean",
      ),
    ).toBe(true);
    await session.togglePlay();
  });

  it("subscribe passes through to transport snapshots", async () => {
    const { session } = makeSession();
    const seen: boolean[] = [];
    const unsubscribe = session.subscribe((s) => seen.push(s.playing));
    await session.togglePlay();
    await session.togglePlay();
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });
});
