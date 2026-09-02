/**
 * IM-4 unit tests — FxChainHost wiring/reorder/bypass logic via fake nodes
 * (typed minimal FxConn surface; no Web Audio in node).
 */

import { describe, expect, it } from "vitest";
import {
  CHAIN_FADE_IN_SECONDS,
  CHAIN_FADE_OUT_SECONDS,
  FxChainHost,
  type CreateFxDevice,
  type FxConn,
  type FxDeviceInstance,
  type FxTiming,
  type RampGainLike,
} from "../src/audio/fx";
import type { FxDevice } from "../src/document/schema";

/** Fake connectable node recording connect/disconnect edges by identity. */
class FakeNode implements FxConn {
  readonly connectedTo: FakeNode[] = [];
  connect(destination: FxConn): unknown {
    this.connectedTo.push(destination as FakeNode);
    return destination;
  }
  disconnect(...args: unknown[]): unknown {
    if (args.length === 0) this.connectedTo.length = 0;
    else {
      const target = args[0] as FakeNode;
      const i = this.connectedTo.indexOf(target);
      if (i >= 0) this.connectedTo.splice(i, 1);
    }
    return undefined;
  }
}

class FakeRamp implements RampGainLike {
  readonly node = new FakeNode();
  readonly ramps: { value: number; when: number; seconds: number }[] = [];
  get input(): FxConn {
    return this.node;
  }
  get output(): FxConn {
    return this.node;
  }
  rampTo(value: 0 | 1, when: number, seconds: number): void {
    this.ramps.push({ value, when, seconds });
  }
}

interface FakeDevice extends FxDeviceInstance {
  readonly inNode: FakeNode;
  readonly outNode: FakeNode;
  disposed: boolean;
  paramPushes: number;
  bpmSyncs: number;
}

function fakeDevice(device: FxDevice): FakeDevice {
  const inNode = new FakeNode();
  const outNode = new FakeNode();
  const dev: FakeDevice = {
    kind: device.type,
    inNode,
    outNode,
    disposed: false,
    paramPushes: 0,
    bpmSyncs: 0,
    input: inNode,
    output: outNode,
    setParams() {
      dev.paramPushes++;
    },
    dispose() {
      dev.disposed = true;
    },
  };
  if (device.type === "delay") {
    dev.syncBpm = () => {
      dev.bpmSyncs++;
    };
  }
  return dev;
}

interface Harness {
  host: FxChainHost;
  source: FakeNode;
  sink: FakeNode;
  ramp: FakeRamp;
  created: FxDevice[];
  devices(): FakeDevice[];
}

function harness(devices: readonly FxDevice[]): Harness {
  const source = new FakeNode();
  const sink = new FakeNode();
  const ramp = new FakeRamp();
  const created: FxDevice[] = [];
  const createDevice: CreateFxDevice = (device) => {
    created.push(device);
    return fakeDevice(device);
  };
  const timing = (): FxTiming => ({ bpm: 120, when: 10 });
  const host = new FxChainHost({ source, sink, ramp, createDevice, timing });
  if (devices.length > 0) host.setChain(devices);
  const h: Harness = {
    host,
    source,
    sink,
    ramp,
    created,
    devices() {
      return (host as unknown as { wired: { instance: FakeDevice }[] }).wired.map(
        (w) => w.instance,
      );
    },
  };
  return h;
}

const filter = (bypassed = false): FxDevice => ({
  type: "filter",
  bypassed,
  params: { cutoffHz: 800, q: 1 },
});
const drive = (bypassed = false): FxDevice => ({
  type: "drive",
  bypassed,
  params: { amount: 0.5 },
});
const delay = (bypassed = false): FxDevice => ({
  type: "delay",
  bypassed,
  params: { timeSteps: 4, feedback: 0.4, mix: 0.4 },
});

describe("FxChainHost", () => {
  it("wires source → ramp → devices in order → sink", () => {
    const h = harness([filter(), drive()]);
    const [a, b] = h.devices();
    expect(h.source.connectedTo).toContain(h.ramp.node);
    expect(h.ramp.node.connectedTo).toContain(a!.inNode);
    expect(a!.outNode.connectedTo).toContain(b!.inNode);
    expect(b!.outNode.connectedTo).toContain(h.sink);
  });

  it("rebuild wraps topology changes in the de-click fade pair", () => {
    const h = harness([filter()]);
    h.ramp.ramps.length = 0;
    h.host.setChain([filter(), drive()]); // structural add
    const ramps = h.ramp.ramps.map((r) => r.value);
    expect(ramps).toEqual([0, 1]);
    expect(h.ramp.ramps[0]!.seconds).toBe(CHAIN_FADE_OUT_SECONDS);
    expect(h.ramp.ramps[1]!.seconds).toBe(CHAIN_FADE_IN_SECONDS);
    expect(h.ramp.ramps[1]!.when).toBe(10 + CHAIN_FADE_OUT_SECONDS);
  });

  it("param-only edit reuses instances (no fade, no rebuild)", () => {
    const h = harness([filter()]);
    const before = h.devices();
    h.ramp.ramps.length = 0;
    h.host.setChain([{ ...filter(), params: { cutoffHz: 2000, q: 2 } }]);
    const after = h.devices();
    expect(after[0]).toBe(before[0]); // same instance
    expect(after[0]!.paramPushes).toBe(1);
    expect(h.ramp.ramps).toEqual([]); // no topology change → no fade
    expect(h.created.length).toBe(1); // no new device
  });

  it("bypass toggles reconnect-around: instance alive, out of path", () => {
    const h = harness([filter(), drive()]);
    const [f, d] = h.devices();
    h.host.setChain([filter(true), drive()]);
    // Filter bypassed: ramp connects straight to drive; filter's chain edges gone.
    expect(h.ramp.node.connectedTo).not.toContain(f!.inNode);
    expect(h.ramp.node.connectedTo).toContain(d!.inNode);
    expect(f!.disposed).toBe(false); // reconnect-around, not destroyed
    expect(h.created.length).toBe(2); // no rebuild
    // Un-bypass puts it back in path.
    h.host.setChain([filter(), drive()]);
    expect(h.ramp.node.connectedTo).toContain(f!.inNode);
    expect(f!.outNode.connectedTo).toContain(d!.inNode);
  });

  it("bypassing the only device wires ramp straight to sink", () => {
    const h = harness([delay()]);
    h.host.setChain([delay(true)]);
    const [d] = h.devices();
    expect(h.ramp.node.connectedTo).not.toContain(d!.inNode);
    expect(h.ramp.node.connectedTo).toContain(h.sink);
    expect(d!.disposed).toBe(false);
  });

  it("reorder rebuilds in the new order (documented strategy)", () => {
    const h = harness([filter(), drive()]);
    const old = h.devices();
    h.host.setChain([drive(), filter()]); // swapped
    const next = h.devices();
    expect(next.length).toBe(2);
    expect(next[0]).not.toBe(old[0]); // fresh instances
    expect(next[0]!.kind).toBe("drive");
    expect(next[1]!.kind).toBe("filter");
    expect(old.every((d) => d.disposed)).toBe(true); // old ones disposed
    const [a, b] = next;
    expect(h.ramp.node.connectedTo).toContain(a!.inNode);
    expect(a!.outNode.connectedTo).toContain(b!.inNode);
    expect(b!.outNode.connectedTo).toContain(h.sink);
  });

  it("removing a device rebuilds and disposes it", () => {
    const h = harness([filter(), drive()]);
    const old = h.devices();
    h.host.setChain([filter()]);
    expect(h.devices().length).toBe(1);
    expect(old[1]!.disposed).toBe(true);
    expect(h.devices()[0]!.outNode.connectedTo).toContain(h.sink);
  });

  it("empty chain = pure pass-through ramp → sink", () => {
    const h = harness([filter()]);
    const old = h.devices()[0]!;
    h.host.setChain([]);
    expect(h.devices()).toEqual([]);
    expect(h.ramp.node.connectedTo).toContain(h.sink);
    expect(h.ramp.node.connectedTo).not.toContain(old.inNode);
  });

  it("syncBpm forwards to synced devices only", () => {
    const h = harness([filter(), delay()]);
    h.host.syncBpm(true);
    const [f, d] = h.devices();
    expect(d!.bpmSyncs).toBe(1);
    expect(f!.bpmSyncs).toBe(0);
  });

  it("dispose tears down instances", () => {
    const h = harness([filter(), drive()]);
    h.host.dispose();
    expect(h.devices().every((d) => d.disposed)).toBe(true);
  });
});
