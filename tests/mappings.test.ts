import { describe, expect, it } from "vitest";
import {
  clampBpmUi,
  formatBeatAnnouncement,
  formatPosition,
  gainToVolumePercent,
  swingAmountToPercent,
  swingPercentToAmount,
  volumePercentToGain,
} from "../src/engine/mappings";

describe("booth mappings", () => {
  it("clamps and rounds tempo to the 60–200 transport range", () => {
    expect(clampBpmUi(0)).toBe(60);
    expect(clampBpmUi(999)).toBe(200);
    expect(clampBpmUi(120)).toBe(120);
    expect(clampBpmUi(120.6)).toBe(121);
    expect(clampBpmUi(-5)).toBe(60);
  });

  it("maps swing percent ↔ amount with clamping on both sides", () => {
    expect(swingPercentToAmount(0)).toBe(0);
    expect(swingPercentToAmount(50)).toBe(0.5);
    expect(swingPercentToAmount(100)).toBe(1);
    expect(swingPercentToAmount(-10)).toBe(0);
    expect(swingPercentToAmount(150)).toBe(1);
    expect(swingAmountToPercent(0)).toBe(0);
    expect(swingAmountToPercent(0.37)).toBe(37);
    expect(swingAmountToPercent(2)).toBe(100);
    expect(swingAmountToPercent(swingPercentToAmount(64))).toBe(64);
  });

  it("maps volume percent ↔ linear gain with clamping", () => {
    expect(volumePercentToGain(0)).toBe(0);
    expect(volumePercentToGain(80)).toBeCloseTo(0.8);
    expect(volumePercentToGain(120)).toBe(1);
    expect(gainToVolumePercent(0.25)).toBe(25);
    expect(gainToVolumePercent(volumePercentToGain(73))).toBe(73);
  });

  it("formats 1-based BAR.BEAT.STEP LED text and beat announcements", () => {
    expect(formatPosition({ bar: 0, beat: 0, step: 0 })).toBe("1.1.1");
    expect(formatPosition({ bar: 1, beat: 2, step: 3 })).toBe("2.3.4");
    expect(formatBeatAnnouncement({ bar: 1, beat: 2, step: 3 })).toBe(
      "BAR 2 · BEAT 3",
    );
  });
});
