/**
 * DES-5 FX-console-strip tests: module-list render model + reorder/keyboard
 * math + readout formatting (pure seam), store FX actions (add cap, remove,
 * move, bypass, param commits + drag coalescing), and the store→engine
 * wiring through a fake session seam (fx edits push setLaneChain live, IM-4).
 * No audio, no browser.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  addFxDevice,
  canUndo,
  docStore,
  moveFxDevice,
  removeFxDevice,
  setFxBypassed,
  setFxParam,
  undo,
} from "../src/state/store";
import { connectStoreToEngine } from "../src/state/engineBridge";
import {
  DELAY_SYNC_UNITS,
  FX_DEVICE_LABELS,
  FX_DEVICE_SPECS,
  FX_DEVICE_TYPES,
  canMoveFx,
  cutoffToSlider,
  defaultFxDevice,
  formatFxParam,
  fxChainFull,
  fxModuleList,
  laneFxChain,
  moveIndex,
  reorderChain,
  sliderToCutoff,
} from "../src/state/fxStrip";
import type { Session } from "../src/engine/session";
import type { LaneId } from "../src/document/schema";

function doc() {
  return docStore.getState().doc;
}

function chain(lane: LaneId = "bass") {
  return laneFxChain(doc(), lane);
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

// ---------------------------------------------------------------------------
// Pure seam
// ---------------------------------------------------------------------------

describe("fxStrip module list (render model)", () => {
  it("lists modules in chain order with matching specs + labels", () => {
    const list = fxModuleList([
      defaultFxDevice("filter"),
      defaultFxDevice("delay"),
      defaultFxDevice("reverb"),
    ]);
    expect(list.map((m) => m.spec.label)).toEqual([
      FX_DEVICE_LABELS.filter,
      FX_DEVICE_LABELS.delay,
      FX_DEVICE_LABELS.reverb,
    ]);
    expect(list.map((m) => m.index)).toEqual([0, 1, 2]);
    for (const mod of list) {
      expect(mod.spec).toBe(FX_DEVICE_SPECS[mod.device.type]);
    }
  });

  it("covers exactly the five world-vocabulary device types", () => {
    expect(FX_DEVICE_TYPES).toEqual(["filter", "drive", "bitcrusher", "delay", "reverb"]);
  });

  it("flags chain-full at the 3-device cap", () => {
    expect(fxChainFull([])).toBe(false);
    expect(fxChainFull([defaultFxDevice("drive")])).toBe(false);
    expect(
      fxChainFull([defaultFxDevice("drive"), defaultFxDevice("drive"), defaultFxDevice("drive")]),
    ).toBe(true);
  });
});

describe("fxStrip reorder + keyboard-move math", () => {
  const three = () => [
    defaultFxDevice("filter"),
    defaultFxDevice("drive"),
    defaultFxDevice("reverb"),
  ];

  it("reorders by moving a device to a target index", () => {
    const next = reorderChain(three(), 0, 2);
    expect(next.map((d) => d.type)).toEqual(["drive", "reverb", "filter"]);
  });

  it("keeps identity for no-ops and out-of-range sources", () => {
    const c = three();
    expect(reorderChain(c, 1, 1)).toBe(c);
    expect(reorderChain(c, -1, 0)).toBe(c);
    expect(reorderChain(c, 3, 0)).toBe(c);
  });

  it("clamps drag targets into the chain", () => {
    expect(moveIndex(99, 3)).toBe(2);
    expect(moveIndex(-7, 3)).toBe(0);
  });

  it("keyboard move buttons are enabled only when a neighbor exists", () => {
    expect(canMoveFx(0, -1, 3)).toBe(false);
    expect(canMoveFx(0, 1, 3)).toBe(true);
    expect(canMoveFx(2, 1, 3)).toBe(false);
    expect(canMoveFx(2, -1, 3)).toBe(true);
  });
});

describe("fxStrip slider mappings + readout formatting", () => {
  it("log-maps cutoff both ways inside the schema range", () => {
    for (const hzValue of [20, 100, 440, 8000, 20000]) {
      // Log slider granularity is 1/1000 of a decade → ≤0.25 % round-trip.
      expect(Math.abs(sliderToCutoff(cutoffToSlider(hzValue)) - hzValue)).toBeLessThanOrEqual(
        Math.max(1, hzValue * 0.01),
      );
    }
    // Slider extremes clamp to the schema bounds.
    expect(sliderToCutoff(-5)).toBe(20);
    expect(sliderToCutoff(1001)).toBe(20000);
    expect(cutoffToSlider(1)).toBe(0);
    expect(cutoffToSlider(99999)).toBe(1000);
  });

  it("formats every param with units for the live readouts", () => {
    expect(formatFxParam("filter", "cutoffHz", 8000)).toBe("8.0 kHz");
    expect(formatFxParam("filter", "cutoffHz", 320)).toBe("320 Hz");
    expect(formatFxParam("filter", "q", 1.2)).toBe("1.2 Q");
    expect(formatFxParam("filter", "kind", "bandpass")).toBe("BP");
    expect(formatFxParam("drive", "amount", 0.42)).toBe("42 %");
    expect(formatFxParam("bitcrusher", "bits", 8)).toBe("8 BIT");
    expect(formatFxParam("bitcrusher", "downsample", 4)).toBe("×4");
    expect(formatFxParam("delay", "timeSteps", 3)).toBe("1/8.");
    expect(formatFxParam("delay", "feedback", 0.5)).toBe("50 %");
    expect(formatFxParam("delay", "mix", 0.35)).toBe("35 %");
    expect(formatFxParam("reverb", "size", 0.4)).toBe("1.0 S"); // 0.7 s + 0.8·0.4
    expect(formatFxParam("reverb", "mix", 0.3)).toBe("30 %");
  });

  it("maps delay sync units to 16th steps (1/8 · dotted · 1/4 · 1/2)", () => {
    expect(DELAY_SYNC_UNITS.map((u) => u.steps)).toEqual([2, 3, 4, 8]);
  });
});

// ---------------------------------------------------------------------------
// Store actions
// ---------------------------------------------------------------------------

describe("store FX actions", () => {
  it("adds devices up to the 3 cap, then refuses", () => {
    expect(addFxDevice("bass", "filter")).toBe(true);
    expect(addFxDevice("bass", "delay")).toBe(true);
    expect(addFxDevice("bass", "reverb")).toBe(true);
    expect(addFxDevice("bass", "drive")).toBe(false);
    expect(chain("bass").map((d) => d.type)).toEqual(["filter", "delay", "reverb"]);
  });

  it("adds schema-valid defaults", () => {
    addFxDevice("lead", "bitcrusher");
    const device = chain("lead")[0]!;
    expect(device).toEqual({
      type: "bitcrusher",
      bypassed: false,
      params: { bits: 8, downsample: 4 },
    });
  });

  it("removes a device by index and ignores out-of-range", () => {
    addFxDevice("bass", "filter");
    addFxDevice("bass", "drive");
    const before = doc();
    removeFxDevice("bass", 7);
    expect(doc()).toBe(before); // no-op keeps identity
    removeFxDevice("bass", 0);
    expect(chain("bass").map((d) => d.type)).toEqual(["drive"]);
  });

  it("reorders through the clamped move action; no-op keeps identity", () => {
    addFxDevice("bass", "filter");
    addFxDevice("bass", "drive");
    addFxDevice("bass", "reverb");
    const before = doc();
    moveFxDevice("bass", 0, 99); // clamps to end
    expect(chain("bass").map((d) => d.type)).toEqual(["drive", "reverb", "filter"]);
    const mid = doc();
    moveFxDevice("bass", 1, 1); // no-op
    expect(doc()).toBe(mid);
    expect(doc()).not.toBe(before);
  });

  it("toggles bypass on one device", () => {
    addFxDevice("bass", "drive");
    setFxBypassed("bass", 0, true);
    expect(chain("bass")[0]!.bypassed).toBe(true);
    setFxBypassed("bass", 0, false);
    expect(chain("bass")[0]!.bypassed).toBe(false);
  });

  it("commits param edits (numeric + choice) and throws on out-of-range", () => {
    addFxDevice("bass", "delay");
    setFxParam("bass", 0, "feedback", 0.8);
    expect(chain("bass")[0]!.params).toMatchObject({
      timeSteps: 2,
      feedback: 0.8,
      mix: 0.35,
    });
    setFxParam("bass", 0, "timeSteps", 4); // choice select → numeric
    expect((chain("bass")[0]!.params as { timeSteps: number }).timeSteps).toBe(4);
    const before = doc();
    expect(() => setFxParam("bass", 0, "feedback", 2)).toThrow(); // > 0.95
    expect(doc()).toBe(before); // store untouched
    expect(() => setFxParam("bass", 9, "mix", 0.5)).toThrow(); // no such device
  });

  it("coalesces rapid same-param drags into one undo step", () => {
    addFxDevice("bass", "drive");
    setFxParam("bass", 0, "amount", 0.2);
    setFxParam("bass", 0, "amount", 0.4);
    setFxParam("bass", 0, "amount", 0.6);
    undo(); // one undo returns to the pre-gesture state
    expect((chain("bass")[0]!.params as { amount: number }).amount).toBeCloseTo(0.3);
    undo(); // the add is still one more step
    expect(chain("bass")).toHaveLength(0);
    expect(canUndo()).toBe(false);
  });

  it("does not coalesce across different params", () => {
    addFxDevice("bass", "reverb");
    setFxParam("bass", 0, "size", 0.8);
    setFxParam("bass", 0, "mix", 0.8);
    undo();
    expect(chain("bass")[0]!.params).toMatchObject({ size: 0.8, mix: 0.3 });
  });
});

// ---------------------------------------------------------------------------
// Engine wiring (fake bridge, IM-4)
// ---------------------------------------------------------------------------

interface FakeSession {
  chains: Map<LaneId, readonly unknown[]>;
  setLaneEvents(): void;
  setLaneSchedule(): void;
  setLaneSound(): void;
  setLaneChain(lane: LaneId, devices: readonly unknown[]): void;
  setLaneScale(): void;
  setBpm(): void;
  setSwingAmount(): void;
  setMetronome(): void;
  transport: { setLoopBars(): void; snapshot: { bpm: number; swing: number } };
}

function fakeSession(): FakeSession {
  const s: FakeSession = {
    chains: new Map(),
    setLaneEvents() {},
    setLaneSchedule() {},
    setLaneSound() {},
    setLaneChain(lane, devices) {
      s.chains.set(lane, devices);
    },
    setLaneScale() {},
    setBpm() {},
    setSwingAmount() {},
    setMetronome() {},
    transport: { setLoopBars() {}, snapshot: { bpm: 120, swing: 0 } },
  };
  return s;
}

describe("engineBridge pushes fx edits live (IM-4)", () => {
  it("every FX action lands in session.setLaneChain on the same commit", () => {
    const session = fakeSession();
    const disconnect = connectStoreToEngine(session as unknown as Session);

    addFxDevice("bass", "filter");
    expect(session.chains.get("bass")).toHaveLength(1);
    expect((session.chains.get("bass") as { type: string }[])[0]!.type).toBe("filter");

    setFxParam("bass", 0, "cutoffHz", 1200);
    expect(
      (session.chains.get("bass") as { params: { cutoffHz: number } }[])[0]!.params.cutoffHz,
    ).toBe(1200);

    setFxBypassed("bass", 0, true);
    expect((session.chains.get("bass") as { bypassed: boolean }[])[0]!.bypassed).toBe(true);

    addFxDevice("bass", "delay");
    moveFxDevice("bass", 0, 1);
    expect((session.chains.get("bass") as { type: string }[]).map((d) => d.type)).toEqual([
      "delay",
      "filter",
    ]);

    removeFxDevice("bass", 0);
    expect((session.chains.get("bass") as { type: string }[]).map((d) => d.type)).toEqual([
      "filter",
    ]);

    disconnect();
  });
});
