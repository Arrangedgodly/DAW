/**
 * PS-4 — SampleVoiceHost unit gate (node fakes; the browser suite proves the
 * real-node path end to end). Pins the host's laws:
 * - scheduling: envelope ramps + playbackRate + start/stop windows for the
 *   one-shot (drums) and note-length-gated (pitched, SC-2) variants;
 * - the DROP law: an undecoded buffer never blocks — the event is counted
 *   and skipped (live only; offline preloads first);
 * - voice stealing mirrors the worklet (8/lane, de-click fade on steal);
 * - allOff de-clicks everything;
 * - per-recording peak normalization (bounded makeup × preset level);
 * - the lane router partitions synth vs sample events through ONE seam.
 */

import { describe, expect, it, vi } from "vitest";
import {
  SAMPLE_MAX_MAKEUP,
  SAMPLE_VOICES_PER_LANE,
  createLaneVoiceRouter,
  createSampleVoiceHost,
  type LaneVoiceRouter,
  type SampleBufferSourceLike,
  type SampleGainLike,
  type SampleParamLike,
  type SampleVoiceContextLike,
  type SampleVoiceHost,
} from "../src/audio/voiceEngine";
import { noteParamsFor, type VoiceNoteOnEvent } from "../src/audio/presets";
import { getPreset } from "../src/audio/presets";
import { getDrumKit } from "../src/audio/presets";

// --- fakes -------------------------------------------------------------------

class FakeParam implements SampleParamLike {
  value = 0;
  readonly sets: [number, number][] = [];
  readonly ramps: [number, number][] = [];
  readonly cancels: number[] = [];
  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.sets.push([value, startTime]);
  }
  linearRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.ramps.push([value, endTime]);
  }
  cancelScheduledValues(cancelTime: number): void {
    this.cancels.push(cancelTime);
  }
}

class FakeGain implements SampleGainLike {
  readonly gain = new FakeParam();
  readonly connectedTo: unknown[] = [];
  connect(destination: unknown): unknown {
    this.connectedTo.push(destination);
    return this;
  }
  disconnect(): void {}
}

class FakeSource implements SampleBufferSourceLike {
  buffer: AudioBuffer | null = null;
  readonly playbackRate = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: ((event: Event) => void) | null = null;
  connect(destination: unknown): unknown {
    void destination;
    return this;
  }
  disconnect(): void {}
  start(when?: number): void {
    this.startedAt = when ?? 0;
  }
  stop(when?: number): void {
    this.stoppedAt = when ?? 0;
  }
}

function fakeBuffer(durationSeconds: number, peak: number): AudioBuffer {
  const data = new Float32Array(64);
  data[0] = peak;
  return {
    duration: durationSeconds,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function fakeCtx() {
  const sources: FakeSource[] = [];
  const gains: FakeGain[] = [];
  return {
    sources,
    gains,
    ctx: {
      currentTime: 100,
      sampleRate: 44100,
      createBufferSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      createGain: () => {
        const g = new FakeGain();
        gains.push(g);
        return g;
      },
    } as unknown as SampleVoiceContextLike,
    advance(seconds: number) {
      (this.ctx as { currentTime: number }).currentTime += seconds;
    },
  };
}

function fakeLoader(buffers: Map<string, AudioBuffer>) {
  const loads: string[] = [];
  return {
    loads,
    loader: {
      load: (_ctx: unknown, id: string) => {
        loads.push(id);
        const buffer = buffers.get(id);
        if (!buffer) return Promise.reject(new Error(`no buffer ${id}`));
        return Promise.resolve(buffer);
      },
      peek: (_ctx: unknown, id: string) => buffers.get(id),
    },
  };
}

/** A sample drum event through the REAL wire format (kit 808 kick). */
function drumEvent(time: number, hold = 0.125): VoiceNoteOnEvent {
  const kick = getDrumKit("kit-808")!.pieces.kick;
  return noteParamsFor(kick, { time, holdSeconds: hold });
}

/** A pitched sample event through the REAL wire format (PURE TONE). */
function pitchedEvent(
  time: number,
  midi: number,
  hold = 0.3,
): VoiceNoteOnEvent {
  const preset = getPreset("preset-chords-13")!;
  return noteParamsFor(preset, { time, midi, holdSeconds: hold });
}

// --- host laws ----------------------------------------------------------------

describe("SampleVoiceHost (unit fakes)", () => {
  it("schedules a pitched sample: rate from rootMidi, ADSR-shaped gain, stop at min(natural, hold+release)", () => {
    const h = fakeCtx();
    const buffers = new Map([
      ["voice.chords.tone", fakeBuffer(1.0, 1.0)],
    ]);
    const host = createSampleVoiceHost(
      h.ctx,
      4,
      fakeLoader(buffers).loader,
    );
    const ev = pitchedEvent(10, 72, 0.3); // +12 semitones over root 60
    host.sendEvents(0, [ev]);
    expect(h.sources).toHaveLength(1);
    const src = h.sources[0]!;
    expect(src.buffer).toBe(buffers.get("voice.chords.tone"));
    expect(src.playbackRate.value).toBeCloseTo(2, 9);
    expect(src.startedAt).toBe(10);
    const preset = getPreset("preset-chords-13")!;
    // gains[0] is the lane bus (unity); the VOICE gain is gains[1].
    const g = h.gains[1]!.gain;
    // peak 1.0 → makeup 0.5; gain ramps to level × makeup
    const target = preset.level * Math.min(SAMPLE_MAX_MAKEUP, 0.5 / 1.0);
    expect(g.sets[0]).toEqual([0, 10]);
    expect(g.ramps[0]![0]).toBeCloseTo(target, 9);
    expect(g.ramps[0]![1]).toBeCloseTo(10 + Math.min(preset.envelope.attack, 0.05), 9);
    // SC-2: release fades FROM the hold boundary
    expect(g.sets.some(([v, t]) => v === target && t === 10.3)).toBe(true);
    expect(g.ramps.some(([v, t]) => v === 0 && Math.abs(t - (10.3 + preset.envelope.release)) < 1e-9)).toBe(true);
    // hold+release (0.39) < natural (1 s / rate 2 = 0.5) → stop at hold edge
    expect(src.stoppedAt).toBeCloseTo(10 + 0.3 + preset.envelope.release + 0.005, 6);
    // …and when the note OUTLASTS the recording, the natural end wins.
    const long = pitchedEvent(20, 72, 1.5);
    host.sendEvents(0, [long]);
    expect(h.sources[1]!.stoppedAt).toBeCloseTo(20 + 0.5 + 0.005, 6);
  });

  it("schedules a drum sample one-shot: rate 1, natural length, attack-only shaping", () => {
    const h = fakeCtx();
    const buffers = new Map([["drums.808.kick", fakeBuffer(2.5, 0.3)]]);
    const host = createSampleVoiceHost(h.ctx, 4, fakeLoader(buffers).loader);
    host.sendEvents(0, [drumEvent(10, 0.125)]); // gate 125 ms must NOT cut it
    expect(h.sources).toHaveLength(1);
    const src = h.sources[0]!;
    expect(src.playbackRate.value).toBe(1);
    expect(src.stoppedAt).toBeCloseTo(10 + 2.5 + 0.005, 6);
    const g = h.gains[1]!.gain;
    // attack de-click ramp to the trimmed level only — the recording owns
    // the rest of the envelope (no hold/release shaping on one-shots)
    expect(g.ramps.length).toBe(1);
    expect(g.sets.length).toBe(1);
    // peak 0.3 (float32) → makeup capped at min(4, 0.5/peak)
    const kick = getDrumKit("kit-808")!.pieces.kick;
    expect(g.ramps[0]![0]).toBeCloseTo(
      kick.level * Math.min(SAMPLE_MAX_MAKEUP, 0.5 / 0.3),
      6,
    );
  });

  it("DROP law: an undecoded buffer is counted and skipped, never thrown", () => {
    const h = fakeCtx();
    const host = createSampleVoiceHost(
      h.ctx,
      4,
      fakeLoader(new Map()).loader,
    );
    const onDrop = vi.fn();
    const host2 = createSampleVoiceHost(h.ctx, 4, fakeLoader(new Map()).loader, {
      onDrop,
    });
    void host;
    host2.sendEvents(1, [drumEvent(10)]);
    expect(h.sources).toHaveLength(0);
    expect(host2.droppedCount()).toBe(1);
    expect(host2.droppedCount("drums.808.kick")).toBe(1);
    expect(onDrop).toHaveBeenCalledWith("drums.808.kick");
  });

  it("steals at 8 voices/lane with a de-click fade; prefers voices past their hold", () => {
    const h = fakeCtx();
    (h.ctx as { currentTime: number }).currentTime = 0;
    const buffers = new Map([
      ["voice.chords.tone", fakeBuffer(5.0, 1.0)],
    ]);
    const host = createSampleVoiceHost(h.ctx, 4, fakeLoader(buffers).loader);
    for (let i = 0; i < SAMPLE_VOICES_PER_LANE; i++) {
      host.sendEvents(2, [pitchedEvent(0.1 + i * 0.01, 60, 10)]);
    }
    expect(host.stolenCount(2)).toBe(0);
    // 9th voice: nothing in release yet → oldest overall (started 0.1) falls.
    host.sendEvents(2, [pitchedEvent(5, 60, 10)]);
    expect(host.stolenCount(2)).toBe(1);
    const victim = h.sources[0]!;
    expect(victim.stoppedAt).not.toBeNull();
    // The victim got a cancel + fade-to-zero (de-click) before its stop.
    const victimGain = h.gains[1]!.gain;
    expect(victimGain.cancels.length).toBeGreaterThan(0);
    expect(victimGain.ramps.some(([v]) => v === 0)).toBe(true);

    // Release preference: a fresh pool where the NEWEST voice is the only
    // one past its hold boundary — the steal must take IT, not the oldest.
    const h2 = fakeCtx();
    (h2.ctx as { currentTime: number }).currentTime = 0;
    const host2 = createSampleVoiceHost(
      h2.ctx,
      4,
      fakeLoader(buffers).loader,
    );
    for (let i = 0; i < SAMPLE_VOICES_PER_LANE - 1; i++) {
      host2.sendEvents(2, [pitchedEvent(0.1 + i * 0.01, 60, 100)]); // long holds
    }
    host2.sendEvents(2, [pitchedEvent(0.5, 60, 0.2)]); // newest, hold ends 0.7
    expect(host2.stolenCount(2)).toBe(0);
    h2.advance(0.71);
    host2.sendEvents(2, [pitchedEvent(5, 60, 100)]);
    expect(host2.stolenCount(2)).toBe(1);
    // The 0.5-started voice (h2.sources[7], the newest) is the victim: its
    // stop was pulled to NOW (de-click retire), while every long-hold voice
    // keeps its far-future natural stop (~5.105).
    expect(h2.sources[7]!.stoppedAt!).toBeLessThanOrEqual(0.72);
    for (let i = 0; i < 7; i++) {
      expect(h2.sources[i]!.stoppedAt!).toBeGreaterThan(5);
    }
  });

  it("allOff de-clicks and stops every live voice", () => {
    const h = fakeCtx();
    const buffers = new Map([
      ["voice.chords.tone", fakeBuffer(5.0, 1.0)],
      ["drums.808.kick", fakeBuffer(2.5, 0.5)],
    ]);
    const host = createSampleVoiceHost(h.ctx, 4, fakeLoader(buffers).loader);
    host.sendEvents(0, [drumEvent(10)]);
    host.sendEvents(1, [pitchedEvent(10, 60)]);
    host.sendEvents(3, [pitchedEvent(10, 67)]);
    expect(h.sources.length).toBe(3);
    host.allOff();
    for (const src of h.sources) {
      expect(src.stoppedAt).not.toBeNull();
      expect(src.stoppedAt!).toBeLessThanOrEqual(
        (h.ctx as { currentTime: number }).currentTime + 0.01,
      );
    }
  });

  it("preload decodes through the loader (deduped) and rejects on failure; settled never rejects", async () => {
    const h = fakeCtx();
    const { loader, loads } = fakeLoader(
      new Map([["drums.808.kick", fakeBuffer(1, 1)]]),
    );
    const host = createSampleVoiceHost(h.ctx, 4, loader);
    await host.preload(["drums.808.kick", "drums.808.kick"]);
    expect(loads).toEqual(["drums.808.kick"]);
    await host.settled();
    const failing = createSampleVoiceHost(
      h.ctx,
      4,
      fakeLoader(new Map()).loader,
    );
    await expect(failing.preload(["nope"])).rejects.toThrow(/no buffer/);
    await expect(failing.settled()).resolves.toBeUndefined();
  });

  it("lane routing partitions synth vs sample events through one seam", async () => {
    const h = fakeCtx();
    const buffers = new Map([["drums.808.kick", fakeBuffer(1, 1)]]);
    const workletSends: [number, VoiceNoteOnEvent[]][] = [];
    const worklet = {
      outbox: { enqueue() {}, handleWatermark() {}, pendingCount: () => 0, totalPending: () => 0, oldestPendingTime: () => null },
      sendEvents: (laneIndex: number, events: readonly VoiceNoteOnEvent[]) => {
        workletSends.push([laneIndex, [...events]]);
      },
      connect: () => undefined,
      allOff: () => undefined,
      waitUntilLoaded: () => Promise.resolve(),
      dispose: () => undefined,
    };
    let sampleHostRef: SampleVoiceHost | null = null;
    const router: LaneVoiceRouter = createLaneVoiceRouter(worklet, () => {
      sampleHostRef ??= createSampleVoiceHost(h.ctx, 4, fakeLoader(buffers).loader);
      return Promise.resolve(sampleHostRef);
    });
    const synthEvent = noteParamsFor(getPreset("preset-bass-1")!, {
      time: 1,
      midi: 40,
      holdSeconds: 0.2,
    });
    const sample = drumEvent(1);
    router.sendEvents(0, [synthEvent]);
    expect(workletSends).toHaveLength(1);
    expect(workletSends[0]![1]).toHaveLength(1);
    router.sendEvents(0, [sample]);
    expect(workletSends).toHaveLength(1); // nothing new to the worklet
    await vi.waitFor(() => expect(h.sources).toHaveLength(1));
    expect(router.hasSampleVoice()).toBe(true);
    expect(h.sources[0]!.playbackRate.value).toBe(1);
    // connect() fans BOTH hosts' lane outputs into the chain destination.
    const dest = {} as AudioNode;
    router.connect(0, dest);
    await router.waitUntilLoaded(10);
    router.allOff();
    router.dispose();
  });
});
