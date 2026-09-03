/**
 * HU-2 device-change + unexpected-suspend logic via fake event targets:
 * devicechange → master duck + info handler; statechange suspended while
 * playing → unexpected-suspend handler; running again → resumed; suspended
 * while STOPPED (user stop) → nothing (not a failure).
 */

import { describe, expect, it, vi } from "vitest";
import {
  isSuspiciousState,
  watchAudioDevices,
  type AudioContextLike,
  type MediaDevicesLike,
} from "../src/engine/deviceWatch";

class FakeMediaDevices implements MediaDevicesLike {
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: "devicechange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "devicechange", listener: () => void): void {
    this.listeners.delete(listener);
  }
  fireDeviceChange(): void {
    for (const l of [...this.listeners]) l();
  }
}

class FakeContext implements AudioContextLike {
  state = "running";
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.delete(listener);
  }
  setState(state: string): void {
    this.state = state;
    for (const l of [...this.listeners]) l();
  }
}

function setup(overrides: { playing?: boolean } = {}) {
  const media = new FakeMediaDevices();
  const ctx = new FakeContext();
  const duck = vi.fn();
  const unlock = vi.fn(async () => undefined);
  const onDeviceChange = vi.fn();
  const onUnexpectedSuspend = vi.fn();
  const onAudioResumed = vi.fn();
  let playing = overrides.playing ?? true;
  const dispose = watchAudioDevices(
    { mediaDevices: media, getContext: () => ctx },
    { isPlaying: () => playing, duckMaster: duck, unlock },
    { onDeviceChange, onUnexpectedSuspend, onAudioResumed },
  );
  return {
    media,
    ctx,
    duck,
    unlock,
    onDeviceChange,
    onUnexpectedSuspend,
    onAudioResumed,
    dispose,
    setPlaying: (v: boolean) => {
      playing = v;
    },
  };
}

describe("devicechange handling", () => {
  it("ducks the master (keeps the context) and notifies once per event", () => {
    const s = setup();
    s.media.fireDeviceChange();
    expect(s.duck).toHaveBeenCalledTimes(1);
    expect(s.onDeviceChange).toHaveBeenCalledTimes(1);
    s.media.fireDeviceChange();
    expect(s.duck).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  it("detaches on dispose (no leaks)", () => {
    const s = setup();
    s.dispose();
    s.media.fireDeviceChange();
    expect(s.onDeviceChange).not.toHaveBeenCalled();
  });
});

describe("unexpected suspend (statechange)", () => {
  it("suspended while PLAYING → resume affordance; running again → cleared", () => {
    const s = setup({ playing: true });
    s.ctx.setState("suspended");
    expect(s.onUnexpectedSuspend).toHaveBeenCalledTimes(1);
    expect(s.onAudioResumed).not.toHaveBeenCalled();
    s.ctx.setState("running");
    expect(s.onAudioResumed).toHaveBeenCalledTimes(1);
  });

  it("iOS 'interrupted' counts as suspicious", () => {
    const s = setup({ playing: true });
    s.ctx.setState("interrupted");
    expect(s.onUnexpectedSuspend).toHaveBeenCalledTimes(1);
  });

  it("suspended while STOPPED (user stop) is NOT a failure", () => {
    const s = setup({ playing: false });
    s.ctx.setState("suspended");
    expect(s.onUnexpectedSuspend).not.toHaveBeenCalled();
    // But if playback starts and the context stays down, nothing fires until
    // a state change arrives — the statechange listener is the only source.
    s.setPlaying(true);
    s.ctx.setState("running");
    expect(s.onAudioResumed).toHaveBeenCalledTimes(1);
  });

  it("isSuspiciousState covers suspended/interrupted/closed only", () => {
    expect(isSuspiciousState("suspended")).toBe(true);
    expect(isSuspiciousState("interrupted")).toBe(true);
    expect(isSuspiciousState("closed")).toBe(true);
    expect(isSuspiciousState("running")).toBe(false);
  });
});

describe("late-bound context", () => {
  it("attaches once the lazily-created context exists", async () => {
    vi.useFakeTimers();
    let ctx: FakeContext | null = null;
    const onUnexpectedSuspend = vi.fn();
    const dispose = watchAudioDevices(
      { mediaDevices: null, getContext: () => ctx },
      {
        isPlaying: () => true,
        duckMaster: () => undefined,
        unlock: async () => undefined,
      },
      {
        onDeviceChange: () => undefined,
        onUnexpectedSuspend,
        onAudioResumed: () => undefined,
      },
    );
    ctx = new FakeContext();
    vi.advanceTimersByTime(600); // poll interval
    ctx.setState("suspended");
    expect(onUnexpectedSuspend).toHaveBeenCalledTimes(1);
    dispose();
    vi.useRealTimers();
  });
});
