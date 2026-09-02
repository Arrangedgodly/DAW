/**
 * Master soft-clip (D2–D4 committed design; landed with PX-1 because the
 * demo is the first dense 4-lane mix and per-lane voice sums exceed ±1 with
 * no cross-lane headroom). Pure-math properties + the parity contract: the
 * LIVE session master and the OFFLINE render master route through the SAME
 * node factory, so exports and playback clip identically.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SOFT_CLIP_CEILING, softClip, softClipCurve, createSoftClipNode } from "../src/audio/fx";

describe("softClip (pure)", () => {
  it("is bounded: |y| < ceiling for every input, however hot", () => {
    for (const x of [0.001, 0.5, 0.9, 1, 1.5, 3, 10, 100, -1.2, -7]) {
      expect(Math.abs(softClip(x))).toBeLessThanOrEqual(SOFT_CLIP_CEILING);
    }
  });

  it("is near-transparent at conversational levels (≤2% compression ≤0.5)", () => {
    for (const x of [0.1, 0.25, 0.4, 0.5]) {
      expect(Math.abs(softClip(x) - x) / x).toBeLessThan(0.02);
    }
  });

  it("is odd and monotonic (transients keep their order)", () => {
    for (const x of [0.1, 0.7, 2]) expect(softClip(-x)).toBeCloseTo(-softClip(x), 12);
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const y = softClip((i / 100) * 4 - 2);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  it("curve: fixed length, endpoints at ±softClip(1), values within the ceiling", () => {
    const curve = softClipCurve();
    expect(curve).toHaveLength(1024);
    expect(curve[0]).toBeCloseTo(softClip(-1), 6);
    expect(curve[1023]).toBeCloseTo(softClip(1), 6);
    for (const v of curve) expect(Math.abs(v)).toBeLessThanOrEqual(SOFT_CLIP_CEILING);
    // Cached: same reference on repeat calls (no per-render allocation).
    expect(softClipCurve()).toBe(curve);
  });

  it("node factory returns a WaveShaper wired with the cached curve (oversample none: bound is exact)", () => {
    let assigned: Float32Array | null = null;
    let oversample = "";
    const node = createSoftClipNode({
      createWaveShaper: () =>
        ({
          connect: () => undefined,
          set curve(c: Float32Array) {
            assigned = c;
          },
          set oversample(o: string) {
            oversample = o;
          },
        }) as unknown as WaveShaperNode,
    });
    expect(typeof node.connect).toBe("function");
    expect(assigned).toBe(softClipCurve());
    expect(oversample).toBe("none");
  });
});

describe("soft-clip parity contract (live session ↔ offline render)", () => {
  const sessionSrc = readFileSync("src/engine/session.ts", "utf8");
  const renderSrc = readFileSync("src/audio/render.ts", "utf8");

  it("both master paths route through createSoftClipNode", () => {
    expect(sessionSrc).toMatch(/createSoftClipNode/);
    expect(renderSrc).toMatch(/createSoftClipNode/);
  });
});
