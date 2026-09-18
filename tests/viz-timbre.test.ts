import { describe, expect, it } from "vitest";
import {
  createTimbreAnalyser,
  createTimbreTracker,
  fft,
  TIMBRE_WINDOW,
} from "../src/viz/timbre";
import { createCompositionEngine } from "../src/viz/compositionEngine";
import { defaultComposition } from "../src/viz/composition";

const RATE = 44100;
const N = TIMBRE_WINDOW;

function sine(hz: number, amp = 0.5, start = 0): Float32Array {
  return Float32Array.from(
    { length: N },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * (start + i)) / RATE),
  );
}
function noise(amp = 0.5, seed = 1): Float32Array {
  let s = seed;
  return Float32Array.from({ length: N }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return amp * ((s >>> 0) / 4294967296 - 0.5) * 2;
  });
}
/** A sustained window, analysed twice so flux compares like with like. */
function steady(make: (start: number) => Float32Array) {
  const a = createTimbreAnalyser();
  a.analyse(make(0), RATE);
  return a.analyse(make(N), RATE);
}

describe("timbre analysis", () => {
  it("fft finds a pure bin", () => {
    const re = Float32Array.from({ length: 64 }, (_, i) =>
      Math.cos((2 * Math.PI * 5 * i) / 64),
    );
    const im = new Float32Array(64);
    fft(re, im);
    expect(Math.hypot(re[5]!, im[5]!)).toBeCloseTo(32, 3);
    expect(Math.hypot(re[6]!, im[6]!)).toBeLessThan(1e-3);
  });

  it("reads silence as silent", () => {
    const f = createTimbreAnalyser().analyse(new Float32Array(N), RATE);
    expect(f.level).toBe(0);
    expect(f.flux).toBe(0);
  });

  it("orders loudness by amplitude", () => {
    const quiet = steady((s) => sine(440, 0.02, s)).level;
    const loud = steady((s) => sine(440, 0.5, s)).level;
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet + 0.3);
  });

  it("hears a bass as dark and low, a high tone as bright", () => {
    const bass = steady((s) => sine(80, 0.5, s));
    const high = steady((s) => sine(5000, 0.5, s));
    expect(bass.brightness).toBeLessThan(0.15);
    expect(high.brightness).toBeGreaterThan(0.8);
    expect(bass.low).toBeGreaterThan(0.9);
    expect(high.high).toBeGreaterThan(0.9);
  });

  it("separates noise from tone", () => {
    const tone = steady((s) => sine(440, 0.5, s));
    const hiss = steady((s) => noise(0.5, s + 7));
    expect(tone.noisiness).toBeLessThan(0.2);
    expect(hiss.noisiness).toBeGreaterThan(0.6);
  });

  it("scores an onset far above a sustained note", () => {
    const sustained = steady((s) => sine(220, 0.5, s)).flux;
    const a = createTimbreAnalyser();
    a.analyse(new Float32Array(N), RATE);
    const onset = a.analyse(sine(220, 0.5), RATE).flux;
    expect(onset).toBeGreaterThan(0.8);
    expect(sustained).toBeLessThan(0.1);
  });

  it("does not read sustained noise as a stream of attacks", () => {
    const t = createTimbreTracker();
    let last = t.update("drums", noise(0.3, 1), RATE, 1 / 60);
    for (let k = 2; k < 40; k++)
      last = t.update("drums", noise(0.3, k), RATE, 1 / 60);
    expect(last.transient).toBeLessThan(0.35);
  });

  it("smooths a pluck's release but snaps to its attack", () => {
    const t = createTimbreTracker();
    const hit = t.update("lead", sine(440, 0.5), RATE, 1 / 60);
    expect(hit.transient).toBeGreaterThan(0.8);
    expect(hit.level).toBeGreaterThan(0.4);
    const after = t.update("lead", new Float32Array(N), RATE, 1 / 60);
    expect(after.level).toBeGreaterThan(0.2);
    expect(after.level).toBeLessThan(hit.level);
    // Character holds through the tail.
    expect(after.brightness).toBeCloseTo(hit.brightness, 5);
  });
});

describe("composition engine with timbre", () => {
  it("keeps a lane alive through its measured tail after MIDI ends", () => {
    const engine = createCompositionEngine(defaultComposition(), {});
    engine.setPlaying(true);
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === "save" || key === "restore"
            ? () => undefined
            : typeof key === "string"
              ? (...args: unknown[]) => void calls.push(key, ...args.map(String))
              : undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const frame = { index: 0, width: 400, height: 300, dpr: 1, time: 0 };
    engine.draw(ctx, frame, 10, 120);
    expect(calls.length).toBe(0); // nothing sounding, nothing drawn
    engine.setTimbre("chords", {
      level: 0.6,
      transient: 0,
      brightness: 0.4,
      noisiness: 0.1,
      low: 0.3,
      mid: 0.6,
      high: 0.1,
    });
    engine.draw(ctx, frame, 10.1, 120);
    expect(calls).toContain("stroke");
    expect(engine.probe().timbre.chords?.level).toBe(0.6);
    engine.setPlaying(false);
    expect(engine.probe().timbre.chords).toBeNull();
  });
});
