/**
 * VZ-TH-2 unit tests — the hit pipeline wiring: tap → offset queue →
 * onFrame drain → minimal lane-hue flash. Node-driven with every effect
 * injected (subscriptions, audio clock, hues, queue — the module's own
 * seam design), plus the pure flash-math tables. The BUILT-bundle journey
 * with real transport + canvas pixels is tests/browser/viz-thin-path.test.ts
 * (this suite proves the mechanism; that one proves the law end-to-end).
 *
 * What is pinned here mechanically:
 * - THE ONE-FRAME LAW (wiring side): a hit delivered at schedule time
 *   draws NOTHING until a frame whose injected audio clock has crossed its
 *   audibleAt — then draws on that very frame. Schedule-time leakage has no
 *   code path: the only clock is `audioTime()`, read inside onFrame.
 * - Stop clears the queue (a tapped-but-not-yet-audible event never fires
 *   after `playing: false`), while an already-lit flash decays naturally.
 * - The flash envelope: linear one-shot from velocity at audibleAt to zero
 *   at +VIZ_FLASH_DECAY_SECONDS, provably never early and never unbounded.
 * - Lane mapping: LANE_IDS order → stacked fixed bands, each drawn in its
 *   own tokens-provided hue, alpha = current intensity, globalAlpha
 *   restored (the next frame's ground fill must never inherit a decay).
 * - Stale arrivals (the R3 shared grace) drop at the drain inside the
 *   pipeline too — never a burst.
 * - Teardown: dispose unsubscribes BOTH seams exactly once; idempotent.
 */

import { describe, expect, it, vi } from "vitest";
import { LANE_IDS, type LaneId } from "../src/document/schema";
import type { VizNoteOn } from "../src/engine/session";
import {
  VIZ_FLASH_DECAY_SECONDS,
  createVizPipeline,
  flashIntensity,
  laneBand,
} from "../src/viz/pipeline";
import { createOffsetQueue } from "../src/viz/offsetQueue";
import type { VizFrameInfo } from "../src/viz/renderer";

// ---------------------------------------------------------------------------
// Test doubles (plain objects — node, no DOM/Web Audio)
// ---------------------------------------------------------------------------

interface RecordedFill {
  readonly style: string;
  readonly alpha: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A recording 2d-context stub: property writes + fillRect calls. */
function recorderContext(): {
  ctx: CanvasRenderingContext2D;
  fills: RecordedFill[];
} {
  const fills: RecordedFill[] = [];
  let alpha = 1;
  let style = "";
  const ctx = {
    set globalAlpha(v: number) {
      alpha = v;
    },
    get globalAlpha() {
      return alpha;
    },
    set fillStyle(v: string) {
      style = v;
    },
    get fillStyle() {
      return style;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style, alpha, x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

const HUES: Record<LaneId, string> = {
  drums: "#f23d4c",
  bass: "#ffb300",
  chords: "#35d07f",
  lead: "#4da6ff",
};

/** The full injected-seam harness: captured listeners + fake audio clock. */
function wired() {
  let noteListener: ((n: VizNoteOn) => void) | null = null;
  let transportListener:
    ((snap: { readonly playing: boolean }) => void) | null = null;
  const unsubNotes = vi.fn();
  const unsubTransport = vi.fn();
  const clock = { now: Number.NaN };
  const pipeline = createVizPipeline({
    subscribeNoteOns: (l) => {
      noteListener = l;
      return unsubNotes;
    },
    subscribeTransport: (l) => {
      transportListener = l;
      return unsubTransport;
    },
    audioTime: () => clock.now,
    laneHues: HUES,
  });
  const { ctx, fills } = recorderContext();
  const frame = (width = 800, height = 600): VizFrameInfo => ({
    index: 0,
    width,
    height,
    dpr: 1,
    time: 0,
  });
  const draw = (width?: number, height?: number): void =>
    pipeline.onFrame(ctx, frame(width, height));
  const tap = (lane: LaneId, audibleAt: number, velocity = 0.8): void =>
    noteListener!({ lane, pitch: 60, velocity, audibleAt });
  return {
    pipeline,
    clock,
    fills,
    ctx,
    frame,
    draw,
    tap,
    stopTransport: () => transportListener!({ playing: false }),
    startTransport: () => transportListener!({ playing: true }),
    unsubNotes,
    unsubTransport,
  };
}

// ---------------------------------------------------------------------------
// Pure math — the one-shot envelope (never early, bounded)
// ---------------------------------------------------------------------------

describe("flashIntensity — the one-shot envelope (VZ-TH-2)", () => {
  it("is exactly 0 before `at` — never early, not even one frame", () => {
    expect(flashIntensity(10, 1, 10 - 1 / 60)).toBe(0);
    expect(flashIntensity(10, 1, 10 - 1e-6)).toBe(0);
    expect(flashIntensity(10, 1, Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("peaks at velocity exactly at `at`, decays linearly to 0 at +decay", () => {
    expect(flashIntensity(10, 0.8, 10)).toBeCloseTo(0.8, 12);
    const half = flashIntensity(10, 1, 10 + VIZ_FLASH_DECAY_SECONDS / 2);
    expect(half).toBeCloseTo(0.5, 12);
    const end = 10 + VIZ_FLASH_DECAY_SECONDS;
    expect(flashIntensity(10, 0.9, end)).toBe(0);
    expect(flashIntensity(10, 0.9, end + 5)).toBe(0); // bounded: gone forever
  });

  it("clamps peak into [0,1] and reads 0 on any non-finite argument", () => {
    expect(flashIntensity(10, 2, 10)).toBe(1);
    expect(flashIntensity(10, -3, 10)).toBe(0);
    expect(flashIntensity(Number.NaN, 1, 10)).toBe(0);
    expect(flashIntensity(10, Number.NaN, 10)).toBe(0);
    expect(flashIntensity(10, 1, Number.NaN)).toBe(0);
    expect(flashIntensity(10, 1, 10, Number.NaN)).toBe(0);
    expect(flashIntensity(10, 1, 10, 0)).toBe(0);
  });
});

describe("laneBand — fixed per-lane fields (VZ-TH-2)", () => {
  it("stacks the four lanes as quarters of the height, centered cores", () => {
    const w = 800;
    const h = 600;
    const bands = LANE_IDS.map((_, i) => laneBand(i, w, h));
    // Bands are quarter-height slivers, top to bottom in LANE_IDS order.
    bands.forEach((b, i) => {
      expect(b.y).toBeCloseTo(i * (h / 4) + (h / 4) * 0.2, 9);
      expect(b.height).toBeCloseTo((h / 4) * 0.6, 9);
      expect(b.x).toBeCloseTo(w * 0.3, 9);
      expect(b.width).toBeCloseTo(w * 0.4, 9);
    });
    // Distinct, non-overlapping vertical fields per lane.
    expect(bands[0]!.y).toBeLessThan(bands[1]!.y);
    expect(bands[1]!.y).toBeLessThan(bands[2]!.y);
    expect(bands[2]!.y).toBeLessThan(bands[3]!.y);
  });

  it("collapses degenerate boxes to zero (the draw skips them)", () => {
    expect(laneBand(0, 0, 600)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(laneBand(0, Number.NaN, 600)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(laneBand(0, 800, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

// ---------------------------------------------------------------------------
// The wiring — tap → queue → drain → flash
// ---------------------------------------------------------------------------

describe("pipeline wiring — schedule-time never draws, audible time does (VZ-TH-2)", () => {
  it("holds a scheduled hit across frames, then flashes on the crossing frame", () => {
    const t = wired();
    t.clock.now = 10; // schedule-time delivery (1.5 s early, the horizon)
    t.tap("drums", 11.5, 0.8);
    // Frames strictly before the audible time: the canvas stays untouched.
    for (let f = 1; f / 60 < 1.5; f++) {
      t.draw();
      expect(t.fills).toHaveLength(0);
    }
    expect(t.pipeline.probe().queued).toBe(1);
    // The frame whose audio clock has crossed audibleAt: the flash lands.
    t.clock.now = 11.5;
    t.draw();
    expect(t.fills).toHaveLength(1);
    expect(t.fills[0]!.style).toBe(HUES.drums);
    expect(t.fills[0]!.alpha).toBeCloseTo(0.8, 9);
    expect(t.pipeline.probe().queued).toBe(0);
  });

  it("draws every lane in its own hue at its own fixed band", () => {
    const t = wired();
    t.clock.now = 100;
    for (const lane of LANE_IDS) t.tap(lane, 100, 0.5);
    t.draw();
    expect(t.fills).toHaveLength(4);
    LANE_IDS.forEach((lane, i) => {
      const fill = t.fills.find((f) => f.style === HUES[lane]);
      expect(fill, `lane ${lane} drew in its token hue`).toBeTruthy();
      // LANE_IDS order → stacked bands (drums is the top field).
      const band = laneBand(i, 800, 600);
      expect(fill!.y).toBe(Math.round(band.y));
      expect(fill!.h).toBe(Math.round(band.height));
    });
  });

  it("coalesces same-tick stacked events (a chord) into one ignition set", () => {
    const t = wired();
    t.clock.now = 50;
    t.tap("chords", 50, 0.6);
    t.tap("chords", 50, 0.6);
    t.tap("chords", 50, 0.6);
    t.draw();
    expect(t.fills).toHaveLength(1); // one field, one flash
    expect(t.pipeline.probe().drained).toBe(3); // all three released
    expect(t.pipeline.probe().ignitions.chords).toBe(3);
  });

  it("decays to nothing within VIZ_FLASH_DECAY_SECONDS and stays gone", () => {
    const t = wired();
    t.clock.now = 20;
    t.tap("bass", 20, 1);
    t.draw();
    expect(t.fills).toHaveLength(1);
    expect(t.fills[0]!.alpha).toBeCloseTo(1, 9);
    // Mid-decay: dimmer, still the lane hue.
    t.clock.now = 20 + VIZ_FLASH_DECAY_SECONDS / 2;
    t.draw();
    expect(t.fills).toHaveLength(2);
    expect(t.fills[1]!.alpha).toBeCloseTo(0.5, 9);
    // Past the envelope: no draw at all (cost law — nothing left to paint).
    t.clock.now = 20 + VIZ_FLASH_DECAY_SECONDS;
    t.draw();
    expect(t.fills).toHaveLength(2);
  });

  it("restores globalAlpha — the next frame's ground fill inherits nothing", () => {
    const t = wired();
    t.clock.now = 30;
    t.tap("lead", 30, 0.7);
    t.draw();
    expect(t.fills).toHaveLength(1);
    expect(t.ctx.globalAlpha).toBe(1);
    // And an idle frame after a flash leaves the context untouched.
    t.clock.now = 30 + VIZ_FLASH_DECAY_SECONDS;
    t.draw();
    expect(t.fills).toHaveLength(1);
    expect(t.ctx.globalAlpha).toBe(1);
  });

  it("a non-finite clock (no AudioContext yet) parks drain and draw safely", () => {
    const t = wired();
    t.clock.now = 5;
    t.tap("drums", 6, 0.9);
    t.clock.now = Number.NaN; // VizPage pre-play guard
    t.draw();
    expect(t.fills).toHaveLength(0);
    expect(t.pipeline.probe().queued).toBe(1); // held, not lost
    t.clock.now = 6; // context exists from here
    t.draw();
    expect(t.fills).toHaveLength(1);
  });

  it("drops stale arrivals at the drain — late frames never burst (R3)", () => {
    const t = wired();
    t.clock.now = 10;
    t.tap("drums", 10, 0.8);
    // The page was hidden/parked past the shared grace: the event is stale.
    t.clock.now = 10 + 0.032 + 1e-3;
    t.draw();
    expect(t.fills).toHaveLength(0);
    expect(t.pipeline.probe().drained).toBe(0);
    expect(t.pipeline.probe().queued).toBe(0); // dropped, not held
  });
});

describe("stop law — the queue clears, lit light fades (VZ-TH-2)", () => {
  it("a tapped-but-not-yet-audible event never fires after playing: false", () => {
    const t = wired();
    t.clock.now = 10;
    t.tap("drums", 10 + 0.2, 0.8); // scheduled ahead, still future
    t.stopTransport();
    t.clock.now = 10 + 0.2; // its audible time arrives — post-stop
    t.draw();
    expect(t.fills).toHaveLength(0);
    expect(t.pipeline.probe().drained).toBe(0);
  });

  it("an already-lit flash decays naturally across the stop (fade, no snap)", () => {
    const t = wired();
    t.clock.now = 10;
    t.tap("drums", 10, 0.9);
    t.draw();
    expect(t.fills).toHaveLength(1);
    t.stopTransport(); // mid-decay
    t.clock.now = 10 + VIZ_FLASH_DECAY_SECONDS / 2;
    t.draw();
    expect(t.fills).toHaveLength(2);
    expect(t.fills[1]!.alpha).toBeCloseTo(0.45, 9); // continues its envelope
    t.clock.now = 10 + VIZ_FLASH_DECAY_SECONDS;
    t.draw();
    expect(t.fills).toHaveLength(2); // and still bounded
  });
});

describe("overlap policy — a louder fresh hit re-ignites, softer is kept (VZ-TH-2)", () => {
  it("replaces when the new hit is louder than the decaying light", () => {
    const t = wired();
    t.clock.now = 10;
    t.tap("drums", 10, 0.9);
    t.draw();
    // Half-decayed (0.45); a 0.8 hit lands: the field re-ignites to 0.8.
    t.clock.now = 10 + VIZ_FLASH_DECAY_SECONDS / 2;
    t.tap("drums", t.clock.now, 0.8);
    t.draw();
    expect(t.fills).toHaveLength(2);
    expect(t.fills[1]!.alpha).toBeCloseTo(0.8, 9);
    expect(t.pipeline.probe().ignitions.drums).toBe(2);
  });

  it("keeps the louder decay when the new hit is softer (HU-3 owns policy)", () => {
    const t = wired();
    t.clock.now = 10;
    t.tap("drums", 10, 0.9);
    t.draw();
    t.clock.now = 10 + VIZ_FLASH_DECAY_SECONDS / 2;
    t.tap("drums", t.clock.now, 0.2); // below the 0.45 still lit
    t.draw();
    expect(t.fills).toHaveLength(2);
    expect(t.fills[1]!.alpha).toBeCloseTo(0.45, 9); // follows the first decay
    expect(t.pipeline.probe().ignitions.drums).toBe(1);
  });
});

describe("teardown — dispose unsubscribes both seams exactly once (VZ-TH-2)", () => {
  it("unsubscribes the tap and the transport observer; idempotent", () => {
    const t = wired();
    expect(t.unsubNotes).not.toHaveBeenCalled();
    expect(t.unsubTransport).not.toHaveBeenCalled();
    t.pipeline.dispose();
    expect(t.unsubNotes).toHaveBeenCalledTimes(1);
    expect(t.unsubTransport).toHaveBeenCalledTimes(1);
    t.pipeline.dispose();
    expect(t.unsubNotes).toHaveBeenCalledTimes(1);
    expect(t.unsubTransport).toHaveBeenCalledTimes(1);
  });

  it("the queue is injectable and default-constructed equivalently", () => {
    // The default path: no queue passed → a real offset queue with the
    // engine-horizon capacity (wired() above exercised it implicitly; pin
    // the override path here so tests can rely on either).
    const q = createOffsetQueue({ capacity: 4 });
    const pipeline = createVizPipeline({
      subscribeNoteOns: () => () => {},
      subscribeTransport: () => () => {},
      audioTime: () => 1,
      laneHues: HUES,
      queue: q,
    });
    q.insert({ lane: "drums", pitch: 36, velocity: 1, audibleAt: 1 });
    expect(pipeline.probe().queued).toBe(1);
    expect(pipeline.probe().drained).toBe(0);
    expect(pipeline.probe().ignitions).toEqual({
      drums: 0,
      bass: 0,
      chords: 0,
      lead: 0,
    });
  });
});
