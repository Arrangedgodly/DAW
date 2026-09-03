import { describe, expect, it } from "vitest";
import {
  EventOutbox,
  VOICE_ENGINE_PROCESSOR_NAME,
  createVoiceEngine,
  defaultVoiceEngineModuleUrl,
  type AudioWorkletContextLike,
  type MessagePortLike,
  type WorkletNodeLike,
} from "../src/audio/voiceEngine";
import type { VoiceNoteOnEvent } from "../src/audio/presets";

function noteEvent(time: number): VoiceNoteOnEvent {
  return {
    type: "note-on",
    time,
    wave: 0,
    freq: 220,
    freqEnd: 220,
    sweepSeconds: 0,
    duty: 0.5,
    noiseMix: 0,
    noiseShort: false,
    noiseRate: 40,
    attack: 0.001,
    decay: 0.05,
    sustain: 0.6,
    release: 0.02,
    holdSeconds: 0.1,
    level: 0.7,
    seed: 123,
  };
}

class FakePort implements MessagePortLike {
  posted: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  /** Simulate the worklet reporting its consumed watermark. */
  reportConsumed(untilTime: number): void {
    this.onmessage?.({ data: { type: "consumed", untilTime } });
  }
}

class FakeNode implements WorkletNodeLike {
  readonly port = new FakePort();
  connectedTo: unknown[] = [];
  disconnected = false;
  connect(destination: AudioNode): void {
    this.connectedTo.push(destination);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

function fakeContext(): {
  ctx: AudioWorkletContextLike;
  modules: string[];
  nodes: FakeNode[];
} {
  const modules: string[] = [];
  const nodes: FakeNode[] = [];
  const ctx: AudioWorkletContextLike = {
    currentTime: 0,
    sampleRate: 44100,
    audioWorklet: {
      async addModule(url: string) {
        modules.push(url);
      },
    },
    createVoiceEngineNode: () => {
      const n = new FakeNode();
      nodes.push(n);
      return n;
    },
  };
  return { ctx, modules, nodes };
}

describe("EventOutbox (pure queue/watermark logic)", () => {
  it("tracks pending per lane; watermark drops consumed events", () => {
    const outbox = new EventOutbox(2);
    outbox.enqueue(0, [noteEvent(1), noteEvent(2), noteEvent(3)]);
    outbox.enqueue(1, [noteEvent(5)]);
    expect(outbox.pendingCount(0)).toBe(3);
    expect(outbox.totalPending()).toBe(4);
    expect(outbox.oldestPendingTime(0)).toBe(1);

    outbox.handleWatermark(0, 2); // worklet played through t=2
    expect(outbox.pendingCount(0)).toBe(1);
    expect(outbox.oldestPendingTime(0)).toBe(3);
    expect(outbox.pendingCount(1)).toBe(1);

    outbox.handleWatermark(0, 3);
    expect(outbox.pendingCount(0)).toBe(0);
    expect(outbox.oldestPendingTime(0)).toBeNull();
  });

  it("monotonic watermarks only; equal-time events drop together", () => {
    const outbox = new EventOutbox(1);
    outbox.enqueue(0, [noteEvent(1), noteEvent(1), noteEvent(1.5)]);
    outbox.handleWatermark(0, 1);
    expect(outbox.pendingCount(0)).toBe(1); // 1.5 survives
    outbox.handleWatermark(0, 0.5); // stale watermark ignored
    expect(outbox.pendingCount(0)).toBe(1);
    outbox.handleWatermark(0, 2);
    expect(outbox.totalPending()).toBe(0);
  });

  it("rejects out-of-range lanes", () => {
    const outbox = new EventOutbox(1);
    expect(() => outbox.enqueue(2, [])).toThrow(/range/);
    expect(() => outbox.handleWatermark(-1, 1)).toThrow(/range/);
  });
});

describe("createVoiceEngine host", () => {
  it("loads the module once, creates one node per lane, wires watermarks", async () => {
    const { ctx, modules, nodes } = fakeContext();
    const host = await createVoiceEngine(ctx, 4, { moduleUrl: "file:///w.js" });
    expect(modules).toEqual(["file:///w.js"]);
    expect(nodes.length).toBe(4);

    host.sendEvents(2, [noteEvent(1), noteEvent(2)]);
    const msg = nodes[2].port.posted[0] as { type: string; events: unknown[] };
    expect(msg.type).toBe("events");
    expect(msg.events.length).toBe(2);
    expect(nodes[0].port.posted.length).toBe(0);

    nodes[2].port.reportConsumed(1);
    expect(host.outbox.pendingCount(2)).toBe(1);
    nodes[2].port.reportConsumed(2);
    expect(host.outbox.pendingCount(2)).toBe(0);
  });

  it("rejects unsorted batches and out-of-range lanes", async () => {
    const { ctx } = fakeContext();
    const host = await createVoiceEngine(ctx, 2, { moduleUrl: "u" });
    expect(() => host.sendEvents(0, [noteEvent(2), noteEvent(1)])).toThrow(
      /sorted/,
    );
    expect(() => host.sendEvents(9, [noteEvent(1)])).toThrow(/range/);
    expect(() => host.sendEvents(0, [])).not.toThrow(); // no-op, nothing posted
  });

  it("connect routes lane outputs; allOff messages every node; dispose clears", async () => {
    const { ctx, nodes } = fakeContext();
    const host = await createVoiceEngine(ctx, 3, { moduleUrl: "u" });
    const dest = {} as AudioNode;
    host.connect(1, dest);
    expect(nodes[1].connectedTo).toEqual([dest]);
    host.allOff();
    for (const n of nodes) {
      const last = n.port.posted[n.port.posted.length - 1] as { type: string };
      expect(last.type).toBe("all-off");
    }
    host.dispose();
    for (const n of nodes) {
      expect(n.disconnected).toBe(true);
      expect(n.port.onmessage).toBeNull();
    }
  });
});

describe("module URL", () => {
  it("processor name is the registered one; default URL points at the worklet asset", () => {
    expect(VOICE_ENGINE_PROCESSOR_NAME).toBe("voice-engine");
    expect(defaultVoiceEngineModuleUrl()).toMatch(/voiceEngine\.js$/);
  });
});
