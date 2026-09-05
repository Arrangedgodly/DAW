/**
 * DES-4 grid math tests: playhead grid-time→x, quantized step, step-crossing
 * dedupe (trigger glow), and note-run (gate-width) derivation.
 *
 * LL-2 (seam G1/G5 — the per-lane playhead basis): the options are
 * STEPS-typed and carry the LANE's chain-cycle total; the sweep wraps into
 * the renderer's own pattern extent (gridSteps). The per-lane sweep gates
 * below are Doctor Strange's first-landing fence for the basis swap: the
 * sweep law cannot regress silently (plan LL-2 risk row).
 */

import { describe, expect, it } from "vitest";
import {
  columnActive,
  noteRuns,
  playheadX,
  quantizedStep,
  stepsCrossed,
} from "../src/grid/math";
import { loopLengthSeconds, timeAtStep } from "../src/audio/time";

const OPTS = { steps: 16, bpm: 120, swing: 0 } as const;
const STEP_W = 26; // 24px cell + 2px gap

describe("playheadX", () => {
  it("starts at 0 and lands on step boundaries exactly", () => {
    expect(playheadX(0, OPTS, STEP_W)).toBe(0);
    const stepDur = 0.125; // 120 bpm 16ths
    for (let s = 0; s < 16; s++) {
      expect(playheadX(s * stepDur, OPTS, STEP_W)).toBeCloseTo(s * STEP_W, 6);
    }
  });

  it("interpolates linearly between steps (no swing)", () => {
    const x = playheadX(0.0625, OPTS, STEP_W); // half a step
    expect(x).toBeCloseTo(STEP_W / 2, 6);
  });

  it("is swing-aware: delayed off-beats shift x to the audio grid", () => {
    const swung = { steps: 16, bpm: 120, swing: 0.5 };
    const tOdd = timeAtStep(1, swung); // swung late
    const tEven = timeAtStep(2, swung);
    const xOdd = playheadX(tOdd, swung, STEP_W);
    expect(xOdd).toBeCloseTo(STEP_W, 6);
    const xMid = playheadX((tOdd + tEven) / 2, swung, STEP_W);
    expect(xMid).toBeGreaterThan(STEP_W);
    expect(xMid).toBeLessThan(2 * STEP_W);
  });

  it("clamps and wraps within the loop", () => {
    const loopLen = loopLengthSeconds(1, 120);
    expect(playheadX(-1, OPTS, STEP_W)).toBe(0);
    const end = playheadX(loopLen, OPTS, STEP_W);
    expect(end).toBeLessThanOrEqual(16 * STEP_W);
    expect(end).toBeGreaterThan(15.9 * STEP_W);
  });
});

// ---------------------------------------------------------------------------
// LL-2 per-lane sweep gates (i3-4: "per-lane playhead sweep correct at ANY
// length — exact modulo of chain position vs ctx time, per lane").
// ---------------------------------------------------------------------------

describe("LL-2 per-lane sweep (steps-typed basis + pattern-extent wrap)", () => {
  /** 120 bpm: one 16th = 0.125 s. */
  const STEP_DUR = 0.125;

  /**
   * The frame's wrapped clock — exactly what LaneGrid's readFrame supplies
   * (transport.getLoopTime() already wraps at the LCM cycle): the pure
   * functions receive a time in [0, ownCycle) and the LAW is that the lane's
   * sweep position is the exact modulo of the (unwrapped) ctx time against
   * the lane's OWN cycle. playheadX's end clamp is the v0.1 park safety;
   * the wrap itself rides the frame, so the gates feed wrapped times.
   */
  const wrapped = (globalStep: number, cycleSteps: number): number =>
    ((globalStep * STEP_DUR) % (cycleSteps * STEP_DUR) + cycleSteps * STEP_DUR) %
    (cycleSteps * STEP_DUR);

  it("identity at a single-pattern chain: the sweep spans the lane's own cycle exactly (any vocabulary size)", () => {
    // A single-pattern lane: chain total == grid extent (the identity).
    for (const bars of [1, 2, 4, 8, 128]) {
      const steps = bars * 16;
      const opts = { steps, bpm: 120, swing: 0 };
      // The default gridSteps IS the basis — the identity.
      expect(playheadX(0, opts, STEP_W)).toBe(0);
      expect(playheadX((steps - 1) * STEP_DUR, opts, STEP_W)).toBeCloseTo(
        (steps - 1) * STEP_W,
        6,
      );
      // Through one FULL LCM cycle plus a wrap, the wrapped time lands the
      // sweep back at the top (the modulo against its own cycle).
      expect(playheadX(wrapped(steps + 1, steps), opts, STEP_W)).toBeCloseTo(
        STEP_W,
        6,
      );
    }
  });

  it("unequal cycles sweep at their OWN lengths: a 2-bar lane wraps while an 8-bar lane is still mid-sweep (the poly-loop visual)", () => {
    const bass = { steps: 32, bpm: 120, swing: 0 }; // 2-bar cycle
    const drums = { steps: 128, bpm: 120, swing: 0 }; // 8-bar cycle
    // 3 bars in (global step 48): bass (32 steps = 2 bars) has WRAPPED and
    // sits at cycle step 16; drums (128 steps = 8 bars) is still in its
    // FIRST pass at step 48 — the four-quadrants-at-different-positions
    // visual.
    expect(playheadX(wrapped(48, 32), bass, STEP_W)).toBeCloseTo(
      16 * STEP_W,
      6,
    );
    expect(playheadX(wrapped(48, 128), drums, STEP_W)).toBeCloseTo(
      48 * STEP_W,
      6,
    );
    // Exact modulo of the position vs time, per lane — at every step of TWO
    // full LCM cycles (256 steps), each lane's sweep is (global mod own).
    for (let g = 0; g < 256; g++) {
      expect(playheadX(wrapped(g, 32), bass, STEP_W)).toBeCloseTo(
        (g % 32) * STEP_W,
        6,
      );
      expect(playheadX(wrapped(g, 128), drums, STEP_W)).toBeCloseTo(
        (g % 128) * STEP_W,
        6,
      );
    }
  });

  it("multi-slot chain: the sweep wraps into the PATTERN extent with the CHAIN phase (demo parity — 4×1-bar chain under a 1-bar grid)", () => {
    // The demo lane: chain [A,B,C,D] = 64 steps; the grid shows A (16).
    const chain = { steps: 64, bpm: 120, swing: 0 };
    const grid = 16;
    // v0.1 parity: every bar boundary lands the playhead at column 0…
    for (let bar = 0; bar < 4; bar++) {
      expect(
        playheadX(wrapped(bar * 16, 64), chain, STEP_W, grid),
      ).toBe(0);
    }
    // …and the sweep advances one column per step inside every slot.
    for (let g = 0; g < 128; g++) {
      expect(
        playheadX(wrapped(g, 64), chain, STEP_W, grid),
      ).toBeCloseTo((g % 16) * STEP_W, 6);
    }
    // Mid-step interpolation carries across the wrap: step 15 at frac 0.9
    // reads just under column 16 → wraps continuously toward column 0.
    const x = playheadX(15.9 * STEP_DUR, chain, STEP_W, grid);
    expect(x).toBeGreaterThan(15 * STEP_W);
    expect(x).toBeLessThanOrEqual(16 * STEP_W);
  });

  it("an incommensurate grid extent wraps at the CHAIN boundary (chain position, not a pattern-local clock)", () => {
    // Chain [A(1 bar), B(2 bars)] = 48 steps; the grid shows B (32 steps).
    // 32 does NOT divide 48 — the sweep wraps when the CHAIN wraps, jumping
    // from cycle step 47 to 0 (the honest lane restart), never at 32.
    const chain = { steps: 48, bpm: 120, swing: 0 };
    const grid = 32;
    expect(playheadX(wrapped(46, 48), chain, STEP_W, grid)).toBeCloseTo(
      14 * STEP_W,
      6,
    );
    expect(playheadX(wrapped(47, 48), chain, STEP_W, grid)).toBeCloseTo(
      15 * STEP_W,
      6,
    );
    expect(playheadX(wrapped(48, 48), chain, STEP_W, grid)).toBe(0);
  });

  it("the frame's LCM-cycle clock re-bases onto the lane's own cycle (unreduced times wrap; the exact-boundary tail still parks)", () => {
    // The production frame carries the TRANSPORT's LCM-wrapped time, which
    // EXCEEDS a shorter lane's own cycle mid-transport-cycle. The pure
    // functions reduce it (the browser probe's caught law: the v0.1 clamp
    // alone would park a 1-bar lane at its right edge for the whole rest of
    // a long transport cycle).
    const lead = { steps: 16, bpm: 120, swing: 0 }; // 2 s cycle
    expect(playheadX(2.344, lead, STEP_W)).toBeCloseTo(2.752 * STEP_W, 6);
    expect(quantizedStep(2.344, lead)).toBe(2);
    expect(playheadX(4.75, lead, STEP_W)).toBeCloseTo(6 * STEP_W, 6); // 4.75 % 2 = 0.75 = 6 steps
    // t == the lane cycle EXACTLY is the one-shot tail's parked value —
    // the v0.1 far-right park law survives the re-base.
    expect(playheadX(2, lead, STEP_W)).toBeGreaterThan(15.9 * STEP_W);
    expect(quantizedStep(2, lead)).toBe(15);
  });

  it("quantizedStep returns the LANE's chain-cycle step (the renderer wraps it into its own extent)", () => {
    const chain = { steps: 64, bpm: 120, swing: 0 };
    expect(quantizedStep(0, chain)).toBe(0);
    expect(quantizedStep(16 * STEP_DUR, chain)).toBe(16);
    expect(quantizedStep(63.5 * STEP_DUR, chain)).toBe(63);
    // The renderer-side wrap: q % patternSteps — the glow modulus law.
    expect(quantizedStep(16 * STEP_DUR, chain) % 16).toBe(0);
    expect(quantizedStep(17 * STEP_DUR, chain) % 16).toBe(1);
  });
});

describe("stepsCrossed (glow dedupe)", () => {
  it("fires nothing while the column holds", () => {
    expect(stepsCrossed(3, 3, 16)).toEqual([]);
    expect(stepsCrossed(null, 3, 16)).toEqual([]);
  });

  it("fires exactly the entered column on a normal advance", () => {
    expect(stepsCrossed(3, 4, 16)).toEqual([4]);
    expect(stepsCrossed(0, 1, 16)).toEqual([1]);
  });

  it("does not duplicate when frames skip ahead", () => {
    expect(stepsCrossed(4, 7, 16)).toEqual([5, 6, 7]);
  });

  it("wraps at the loop boundary, entering step 0", () => {
    expect(stepsCrossed(15, 0, 16)).toEqual([0]);
    expect(stepsCrossed(14, 0, 16)).toEqual([15, 0]);
  });
});

describe("noteRuns (gate width)", () => {
  it("single note-on without sustain is one 1-step run", () => {
    expect(noteRuns([0, 0, 1, 0])).toEqual([{ start: 2, length: 1 }]);
  });

  it("sustain markers extend the run and join back-to-back notes", () => {
    expect(noteRuns([1, 2, 2, 0, 1, 2])).toEqual([
      { start: 0, length: 3 },
      { start: 4, length: 2 },
    ]);
  });

  it("a sustain marker alone is not a run", () => {
    expect(noteRuns([0, 2, 2])).toEqual([]);
  });

  it("runs truncate at the pattern end", () => {
    expect(noteRuns([0, 0, 1, 2, 2])).toEqual([{ start: 2, length: 3 }]);
  });
});

describe("columnActive", () => {
  it("detects drums, notes, and sustains in a column", () => {
    expect(columnActive([[false], [true]], 0)).toBe(true);
    expect(columnActive([[0], [1]], 0)).toBe(true);
    expect(columnActive([[0], [2]], 0)).toBe(true);
    expect(columnActive([[false], [0]], 0)).toBe(false);
  });
});
