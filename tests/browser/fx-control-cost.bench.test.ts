import { expect, it } from "vitest";
import { createReverbDevice } from "../../src/audio/fx";
import type { FxDevice } from "../../src/document/schema";
import { createBaselineReverbDevice } from "./fixtures/fx-baseline-27acaec";

const enabled = import.meta.env.VITE_FX_CONTROL_COST_BENCH === "1";
const INITIAL: Extract<FxDevice, { type: "reverb" }> = {
  type: "reverb",
  bypassed: false,
  params: { size: 0.2, mix: 0.4 },
};
const UPDATES: Extract<FxDevice, { type: "reverb" }>[] = [];
for (let cycle = 0; cycle < 24; cycle++) {
  UPDATES.push({
    type: "reverb",
    bypassed: false,
    params: { size: 0.8, mix: 0.4 },
  });
  for (const mix of [0.2, 0.6, 0.9]) {
    UPDATES.push({
      type: "reverb",
      bypassed: false,
      params: { size: 0.8, mix },
    });
  }
  UPDATES.push({
    type: "reverb",
    bypassed: false,
    params: { size: 0.2, mix: 0.9 },
  });
}

function instrumentNativeContext() {
  const native = new OfflineAudioContext(2, 128, 44100);
  let bufferAllocations = 0;
  let bufferAssignments = 0;
  const context = new Proxy(native, {
    get(target, property) {
      if (property === "createBuffer") {
        return (...args: Parameters<BaseAudioContext["createBuffer"]>) => {
          bufferAllocations++;
          return target.createBuffer(...args);
        };
      }
      if (property === "createConvolver") {
        return () => {
          const node = target.createConvolver();
          let proto: object | null = Object.getPrototypeOf(node);
          let bufferDescriptor: PropertyDescriptor | undefined;
          while (proto && !bufferDescriptor) {
            bufferDescriptor = Object.getOwnPropertyDescriptor(proto, "buffer");
            proto = Object.getPrototypeOf(proto);
          }
          if (!bufferDescriptor?.get || !bufferDescriptor.set) {
            throw new Error("Native ConvolverNode buffer accessor not found");
          }
          Object.defineProperty(node, "buffer", {
            configurable: true,
            get() {
              return bufferDescriptor!.get!.call(node);
            },
            set(value: AudioBuffer | null) {
              bufferAssignments++;
              bufferDescriptor!.set!.call(node, value);
            },
          });
          return node;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as BaseAudioContext;
  return {
    context,
    native,
    counts: () => ({ bufferAllocations, bufferAssignments }),
  };
}

function runPass(factory: typeof createReverbDevice) {
  const audio = instrumentNativeContext();
  const instance = factory(audio.context, INITIAL, { seed: 1977 });
  const allocationSteps: {
    update: number;
    allocations: number;
    assignments: number;
  }[] = [];
  const start = performance.now();
  for (const [index, device] of UPDATES.entries()) {
    instance.setParams(device);
    allocationSteps.push({ update: index + 1, ...audio.counts() });
  }
  const milliseconds = performance.now() - start;
  const counts = audio.counts();
  instance.dispose();
  return { milliseconds, counts, allocationSteps };
}

it.skipIf(!enabled)(
  "benchmarks baseline and fixed reverb updates on native Chromium audio nodes",
  () => {
    const warmupOrder: string[] = [];
    const measuredOrder: { version: string; milliseconds: number }[] = [];
    const times = { baseline: [] as number[], fixed: [] as number[] };

    for (let pass = 0; pass < 3; pass++) {
      const order =
        pass % 2 === 0 ? ["baseline", "fixed"] : ["fixed", "baseline"];
      for (const version of order) {
        if (version === "baseline") runPass(createBaselineReverbDevice);
        else runPass(createReverbDevice);
        warmupOrder.push(version);
      }
    }

    const raw: Record<string, ReturnType<typeof runPass>> = {};
    for (let pass = 0; pass < 9; pass++) {
      const order =
        pass % 2 === 0 ? ["baseline", "fixed"] : ["fixed", "baseline"];
      for (const version of order) {
        const result =
          version === "baseline"
            ? runPass(createBaselineReverbDevice)
            : runPass(createReverbDevice);
        times[version as "baseline" | "fixed"].push(result.milliseconds);
        measuredOrder.push({ version, milliseconds: result.milliseconds });
        raw[version] = result;
      }
    }

    expect(UPDATES).toHaveLength(120);
    expect(raw.baseline!.counts).toEqual({
      bufferAllocations: 97,
      bufferAssignments: 97,
    });
    expect(raw.fixed!.counts).toEqual({
      bufferAllocations: 49,
      bufferAssignments: 49,
    });
    const report = {
      runtime: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        sampleRateHz: 44100,
        benchmarkClock: "performance.now()",
        outputLatencyMeasured: false,
      },
      workload: {
        seed: 1977,
        sampleRateHz: 44100,
        sizeA: 0.2,
        sizeB: 0.8,
        mixUpdatesAtB: [0.2, 0.6, 0.9],
        cycles: 24,
        setterCallsPerPass: UPDATES.length,
      },
      warmupOrder,
      measuredOrder,
      rawMilliseconds: times,
      baselineAllocationSteps: raw.baseline!.allocationSteps,
      fixedAllocationSteps: raw.fixed!.allocationSteps,
      finalCounts: { baseline: raw.baseline!.counts, fixed: raw.fixed!.counts },
    };
    console.info(`[FX_CONTROL_COST_BENCHMARK]${JSON.stringify(report)}`);
  },
  60000,
);
