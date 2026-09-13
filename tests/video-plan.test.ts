import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/document/schema";
import { createVideoPlan, videoCycleBars } from "../src/viz/videoPlan";

describe("video clip timing", () => {
  it("uses the same common cycle as audio export and keeps earlier held notes for visual warmup", () => {
    const doc = createDefaultProject();
    doc.patterns.lead[0].bars = 4;
    doc.patterns.lead[0].notes = [{ degree: 3, start: 8, length: 24 }];
    expect(videoCycleBars(doc)).toBe(4);
    const plan = createVideoPlan(doc, 2, 3);
    expect(plan.startSample).toBe(88200);
    expect(plan.endSample).toBe(264600);
    expect(plan.duration).toBe(4);
    expect(plan.frames).toBe(120);
    expect(
      plan.hits.some(
        (hit) => hit.lane === "lead" && hit.audibleAt < plan.startSeconds,
      ),
    ).toBe(true);
  });
  it("omits muted instruments and preserves swing", () => {
    const doc = createDefaultProject();
    doc.transport.swing = 0.3;
    doc.patterns.drums[0].steps.kick[1] = true;
    const hit = createVideoPlan(doc).hits.find((h) => h.lane === "drums")!;
    expect(hit.audibleAt).toBeGreaterThan(0.125);
    doc.lanes[0].mute = true;
    expect(createVideoPlan(doc).hits).toHaveLength(0);
  });
  it("rejects invalid ranges and oversized cycles before rendering", () => {
    const doc = createDefaultProject();
    for (const [start, end] of [
      [0, 1],
      [1, 2],
      [2, 1],
      [NaN, 1],
      [1, 1.5],
    ])
      expect(() => createVideoPlan(doc, start, end)).toThrow("bar range");
    doc.patterns.lead[0].bars = 128;
    doc.transport.bpm = 60;
    expect(() => createVideoPlan(doc, 1, 1)).toThrow("5 minutes");
  });
});
