/**
 * PX-3 Euclidean rhythm tests — canonical pattern table (the musician's
 * E(p,n) reference shapes), rotation behavior, degenerate cases, and the
 * inverse matchEuclid used for the fill control's custom-state readout.
 */

import { describe, expect, it } from "vitest";
import { euclid, matchEuclid, patternEquals } from "../src/audio/euclid";

const on = (pattern: string): boolean[] =>
  [...pattern].map((c) =>
    c === "x"
      ? true
      : c === "."
        ? false
        : (() => {
            throw new Error(`bad char ${c}`);
          })(),
  );

describe("euclid algorithm (threshold method)", () => {
  it("E(3,8) = x..x..x.", () => {
    expect(euclid(3, 8)).toEqual(on("x..x..x."));
  });

  it("E(5,16) spreads evenly", () => {
    expect(euclid(5, 16)).toEqual(on("x...x..x..x..x.."));
  });

  it("E(2,3) = x.x", () => {
    expect(euclid(2, 3)).toEqual(on("x.x"));
  });

  it("E(4,16) = four-on-floor", () => {
    expect(euclid(4, 16)).toEqual(on("x...x...x...x..."));
  });

  it("E(1,4) and its rotations place the single onset per rotation", () => {
    expect(euclid(1, 4, 0)).toEqual(on("x..."));
    expect(euclid(1, 4, 1)).toEqual(on(".x.."));
    expect(euclid(1, 4, 2)).toEqual(on("..x."));
    expect(euclid(1, 4, 3)).toEqual(on("...x"));
  });

  it("rotation shifts E(3,8) onsets around the ring", () => {
    expect(euclid(3, 8, 1)).toEqual(on(".x..x..x"));
    expect(euclid(3, 8, 2)).toEqual(on("x.x..x.."));
    expect(euclid(3, 8, 8)).toEqual(on("x..x..x.")); // full turn = identity
    expect(euclid(3, 8, -1)).toEqual(euclid(3, 8, 7)); // negative wraps
  });

  it("edge cases: 0 pulses = silence, pulses = steps = all on", () => {
    expect(euclid(0, 8)).toEqual(new Array(8).fill(false));
    expect(euclid(8, 8)).toEqual(new Array(8).fill(true));
    expect(euclid(0, 0)).toEqual([]);
  });

  it("clamps out-of-range pulses", () => {
    expect(euclid(-3, 4)).toEqual(new Array(4).fill(false));
    expect(euclid(9, 4)).toEqual(new Array(4).fill(true));
  });

  it("every pattern keeps exactly `pulses` onsets", () => {
    for (let steps = 1; steps <= 17; steps++) {
      for (let pulses = 0; pulses <= steps; pulses++) {
        const p = euclid(pulses, steps);
        expect(p.length).toBe(steps);
        expect(p.filter(Boolean).length).toBe(pulses);
      }
    }
  });
});

describe("matchEuclid (custom-state detection)", () => {
  it("recovers canonical parameters for unrotated patterns", () => {
    expect(matchEuclid(on("x..x..x."))).toEqual({ pulses: 3, rotation: 0 });
    expect(matchEuclid(on("x...x..x..x..x.."))).toEqual({
      pulses: 5,
      rotation: 0,
    });
    expect(matchEuclid(on("x.x"))).toEqual({ pulses: 2, rotation: 0 });
  });

  it("recovers rotated patterns", () => {
    expect(matchEuclid(on(".x..x..x"))).toEqual({ pulses: 3, rotation: 1 });
    expect(matchEuclid(on("...x"))).toEqual({ pulses: 1, rotation: 3 });
  });

  it("empty and full rows match their degenerate patterns", () => {
    expect(matchEuclid(new Array(8).fill(false))).toEqual({
      pulses: 0,
      rotation: 0,
    });
    expect(matchEuclid(new Array(8).fill(true))).toEqual({
      pulses: 8,
      rotation: 0,
    });
  });

  it("a hand-edited (non-Euclidean) row matches nothing", () => {
    expect(matchEuclid(on("x.x.x..."))).toBeNull(); // uneven 3/8
    expect(matchEuclid(on("xx......"))).toBeNull(); // clumped
    expect(matchEuclid(on("x...x....x......"))).toBeNull(); // 3/16 off-grid
  });

  it("prefers the smallest canonical parameterisation", () => {
    // A single onset at 0 is E(1,·) rot 0 — not some higher-pulse read.
    expect(matchEuclid(on("x......."))).toEqual({ pulses: 1, rotation: 0 });
  });

  it("patternEquals compares element-wise", () => {
    expect(patternEquals([true, false], [true, false])).toBe(true);
    expect(patternEquals([true, false], [false, true])).toBe(false);
    expect(patternEquals([true], [true, false])).toBe(false);
  });
});
