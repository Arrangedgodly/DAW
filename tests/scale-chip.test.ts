/**
 * DES-3 scale-chip tests: chip label semantics (project vs lane override),
 * popover action semantics (one-action detach/return through a fake store),
 * and the effective-scale recompile trigger for header-driven changes
 * (popover seam → real store actions → fake session, no audio/browser).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUndo,
  docStore,
  setLaneScaleOverride,
  setProjectScale,
  setLaneSoundId,
  undo,
} from "../src/state/store";
import {
  announceScale,
  applyLaneOverride,
  applyProjectScale,
  laneScaleChipLabel,
  MODE_SHORT,
  projectScaleChipLabel,
  returnToProjectScale,
  type ScaleStoreSeam,
} from "../src/state/scaleChip";
import { connectStoreToEngine } from "../src/state/engineBridge";
import { soundOptionsFor } from "../src/components/laneMeta";
import { DRUM_KITS, PRESET_LIBRARY } from "../src/audio/presets";
import type { Session } from "../src/engine/session";
import type { LaneId } from "../src/document/schema";

function doc() {
  return docStore.getState().doc;
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

describe("scale chip labels", () => {
  it("default: lane follows the project scale → PROJECT source", () => {
    const chip = laneScaleChipLabel(doc(), "bass");
    expect(chip.source).toBe("PROJECT");
    expect(chip.text).toBe(`PROJECT · C ${MODE_SHORT.minor}`);
    expect(chip.overridden).toBe(false);
  });

  it("override active → LANE source, independent of project changes", () => {
    setLaneScaleOverride("lead", { root: 2, mode: "dorian" });
    setProjectScale({ root: 7, mode: "major" });

    const lead = laneScaleChipLabel(doc(), "lead");
    expect(lead.source).toBe("LANE");
    expect(lead.text).toBe(`LANE · D ${MODE_SHORT.dorian}`);
    expect(lead.overridden).toBe(true);

    // Sibling lanes still show the (new) project scale.
    const bass = laneScaleChipLabel(doc(), "bass");
    expect(bass.text).toBe(`PROJECT · G ${MODE_SHORT.major}`);
    expect(bass.overridden).toBe(false);
  });

  it("clearing the override returns the chip to PROJECT", () => {
    setLaneScaleOverride("chords", { root: 9, mode: "phrygian" });
    expect(laneScaleChipLabel(doc(), "chords").source).toBe("LANE");
    setLaneScaleOverride("chords", null);
    const chip = laneScaleChipLabel(doc(), "chords");
    expect(chip.source).toBe("PROJECT");
    expect(chip.text).toBe(`PROJECT · C ${MODE_SHORT.minor}`);
  });

  it("booth project chip never reports a LANE source", () => {
    setLaneScaleOverride("bass", { root: 4, mode: "lydian" });
    const chip = projectScaleChipLabel(doc());
    expect(chip.source).toBe("PROJECT");
    expect(chip.text).toBe(`C ${MODE_SHORT.minor}`);
    expect(chip.overridden).toBe(false);
  });

  it("aria-live announcement names lane, scale, and origin", () => {
    setLaneScaleOverride("bass", { root: 2, mode: "dorian" });
    expect(announceScale(laneScaleChipLabel(doc(), "bass"), "BASS")).toBe(
      "BASS scale: D dorian — lane override",
    );
    expect(announceScale(laneScaleChipLabel(doc(), "lead"), "LEAD")).toBe(
      "LEAD scale: C minor — project scale",
    );
  });
});

describe("popover semantics (fake store seam)", () => {
  function fakeSeam() {
    return {
      setProjectScale: vi.fn(),
      setLaneScaleOverride: vi.fn(),
    };
  }

  it("OVERRIDE LANE commits the picked root+mode as one action", () => {
    const seam: ScaleStoreSeam = fakeSeam();
    const scale = applyLaneOverride(seam, "lead", 2, "dorian");
    expect(scale).toEqual({ root: 2, mode: "dorian" });
    expect(seam.setLaneScaleOverride).toHaveBeenCalledExactlyOnceWith("lead", {
      root: 2,
      mode: "dorian",
    });
  });

  it("USE PROJECT SCALE is exactly one detach action (null override)", () => {
    const seam: ScaleStoreSeam = fakeSeam();
    returnToProjectScale(seam, "chords");
    expect(seam.setLaneScaleOverride).toHaveBeenCalledExactlyOnceWith(
      "chords",
      null,
    );
  });

  it("booth commit writes the project scale, never an override", () => {
    const seam: ScaleStoreSeam = fakeSeam();
    applyProjectScale(seam, 7, "mixolydian");
    expect(seam.setProjectScale).toHaveBeenCalledExactlyOnceWith({
      root: 7,
      mode: "mixolydian",
    });
    expect(seam.setLaneScaleOverride).not.toHaveBeenCalled();
  });
});

describe("header-driven changes recompile the lane (engine bridge)", () => {
  // Reuse the engine-bridge fake-session shape (compiles + pushed scales).
  function fakeSession() {
    const s = {
      compiles: [] as LaneId[],
      scales: {} as Record<string, unknown>,
      sounds: {} as Record<string, string>,
      setLaneEvents: (lane: LaneId) => {
        s.compiles.push(lane);
      },
      setLaneSchedule: (lane: LaneId) => {
        s.compiles.push(lane);
      },
      setLaneScale: (lane: string, scale: unknown) => {
        s.scales[lane] = scale;
      },
      setLaneSound: (lane: string, id: string) => {
        s.sounds[lane] = id;
      },
      setLaneChain: () => {},
      setLaneMix: () => {},
      setLaneOctave: () => {}, // RC-1: the register push (audition path)
      setBpm: () => {},
      setSwingAmount: () => {},
      setMetronome: () => {},
      transport: { setLoopBars: () => {}, snapshot: { bpm: 120, swing: 0 } },
    };
    return s;
  }

  it("popover override + return (real store as the seam) recompiles and re-scales", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    // The REAL store actions behind the popover buttons:
    const seam: ScaleStoreSeam = {
      setProjectScale,
      setLaneScaleOverride,
    };

    s.compiles.length = 0;
    applyLaneOverride(seam, "bass", 2, "dorian");
    // laneOverrides is replaced wholesale, so the bridge conservatively
    // recompiles every pitched lane (never drums) — bass got the new scale.
    expect(new Set(s.compiles)).toEqual(new Set(["bass", "chords", "lead"]));
    expect(s.scales["bass"]).toMatchObject({ root: 2, mode: "dorian" });
    expect(s.scales["chords"]).toMatchObject({ root: 0, mode: "minor" });

    s.compiles.length = 0;
    returnToProjectScale(seam, "bass");
    expect(new Set(s.compiles)).toEqual(new Set(["bass", "chords", "lead"]));
    expect(s.scales["bass"]).toMatchObject({ root: 0, mode: "minor" });

    disconnect();
  });

  it("preset stepper write (setLaneSoundId) recompiles that lane", () => {
    const s = fakeSession();
    const disconnect = connectStoreToEngine(s as unknown as Session);
    s.compiles.length = 0;
    setLaneSoundId("lead", "preset-lead-2");
    expect(s.compiles).toEqual(["lead"]);
    expect(s.sounds["lead"]).toBe("preset-lead-2");
    disconnect();
  });
});

describe("sound options", () => {
  it("drums cycle kits; pitched lanes cycle their own presets only", () => {
    // PS-1: the libraries now carry 10 kits / 12 presets per lane — assert
    // against the libraries themselves (stepper order = insertion order)
    // plus the lane-scoping law, instead of pinning every id by hand.
    const kitIds = Object.keys(DRUM_KITS);
    expect(kitIds.length).toBeGreaterThanOrEqual(10);
    expect(soundOptionsFor("drums").map((o) => o.id)).toEqual(kitIds);
    for (const lane of ["bass", "chords", "lead"] as const) {
      const expected = Object.keys(PRESET_LIBRARY).filter((id) =>
        id.startsWith(`preset-${lane}-`),
      );
      expect(expected.length).toBeGreaterThanOrEqual(12);
      expect(soundOptionsFor(lane).map((o) => o.id)).toEqual(expected);
      // every lane option is that lane's (no cross-lane leakage, no kits).
      expect(
        soundOptionsFor(lane).every((o) => o.id.startsWith(`preset-${lane}-`)),
      ).toBe(true);
    }
  });
});
