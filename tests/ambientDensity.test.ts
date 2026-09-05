/**
 * T10 tests — the DEPTH-BAND density wash's document derivation
 * (route.md playback-reactivity #8). The wash itself is CSS; what MUST be
 * unit-pinned is the law it derives from: the band is a PURE function of
 * document state (set drum steps + pitched notes), quantized to 4 steps,
 * never playback/signal state (D2), with the shipped states placed
 * honestly (empty NEW → 0, WELCOME SONG demo → 2, a filled-out
 * arrangement → 3).
 */

import { describe, expect, it } from "vitest";
import { createDemoProject } from "../src/document/demoSong";
import {
  createDefaultProject,
  type DrumPattern,
  type PitchedPattern,
  type ProjectDocument,
} from "../src/document/schema";
import {
  arrangementContent,
  DENSITY_BAND_EDGE_MEDIUM,
  DENSITY_BAND_EDGE_SPARSE,
  densityBand,
} from "../src/state/ambientDensity";

/** A drums pattern with every piece hitting every step (maximum content). */
function saturatedDrums(bars: number, name: string): DrumPattern {
  const width = 16 * bars;
  const steps = {} as Record<string, boolean[]>;
  for (const piece of ["kick", "snare", "hat", "openhat", "clap", "tom"]) {
    steps[piece] = new Array<boolean>(width).fill(true);
  }
  return { kind: "drums", id: `drums-${name}`, name, bars: bars as 1, steps };
}

/** A pitched pattern carrying exactly `n` notes on its manifest degrees. */
function pitchedWithNotes(n: number): PitchedPattern {
  const notes = Array.from({ length: n }, (_, i) => ({
    degree: i % 7,
    start: i % 16,
    length: 1,
  }));
  return {
    kind: "pitched",
    id: "x-1",
    name: "X",
    bars: 1,
    rowDegrees: [0, 1, 2, 3, 4, 5, 6],
    notes,
  };
}

function withPatterns(
  doc: ProjectDocument,
  drums: DrumPattern[],
  bass: PitchedPattern[],
): ProjectDocument {
  return {
    ...doc,
    patterns: {
      drums,
      bass,
      chords: doc.patterns.chords,
      lead: doc.patterns.lead,
    },
  };
}

describe("T10 density wash — document derivation (route.md #8)", () => {
  it("the fresh default project is band 0 (empty stage, wash off)", () => {
    const doc = createDefaultProject();
    expect(arrangementContent(doc)).toBe(0);
    expect(densityBand(doc)).toBe(0);
  });

  it("the WELCOME SONG demo lands in band 2 (medium) at 97 content", () => {
    const demo = createDemoProject();
    expect(arrangementContent(demo)).toBe(97);
    expect(densityBand(demo)).toBe(2);
  });

  it("band edges are exact: 1..40 sparse, 41..128 medium, 129+ dense", () => {
    const base = createDefaultProject();
    expect(DENSITY_BAND_EDGE_SPARSE).toBe(40);
    expect(DENSITY_BAND_EDGE_MEDIUM).toBe(128);

    const at1 = withPatterns(base, [], [pitchedWithNotes(1)]);
    expect(arrangementContent(at1)).toBe(1);
    expect(densityBand(at1)).toBe(1);

    const at40 = withPatterns(base, [], [pitchedWithNotes(40)]);
    expect(densityBand(at40)).toBe(1);

    const at41 = withPatterns(base, [], [pitchedWithNotes(41)]);
    expect(densityBand(at41)).toBe(2);

    const at128 = withPatterns(base, [], [pitchedWithNotes(128)]);
    expect(densityBand(at128)).toBe(2);

    const at129 = withPatterns(base, [], [pitchedWithNotes(129)]);
    expect(densityBand(at129)).toBe(3);
  });

  it("drum steps and pitched notes count the same (one content law)", () => {
    const base = createDefaultProject();
    // 16 set steps (one piece row saturated for one bar) vs 16 notes.
    const steps = new Array<boolean>(16).fill(true);
    const drums: DrumPattern = {
      kind: "drums",
      id: "drums-s",
      name: "S",
      bars: 1,
      steps: {
        kick: [...steps],
        snare: new Array<boolean>(16).fill(false),
        hat: new Array<boolean>(16).fill(false),
        openhat: new Array<boolean>(16).fill(false),
        clap: new Array<boolean>(16).fill(false),
        tom: new Array<boolean>(16).fill(false),
      },
    };
    expect(arrangementContent(withPatterns(base, [drums], []))).toBe(16);
    expect(arrangementContent(withPatterns(base, [], [pitchedWithNotes(16)]))).toBe(16);
  });

  it("a saturated drums pattern reaches band 3 (filled-out arrangement)", () => {
    const base = createDefaultProject();
    const doc = withPatterns(base, [saturatedDrums(1, "max")], []);
    expect(arrangementContent(doc)).toBe(96); // 6 pieces × 16 steps
    // Demo (96) + one saturated 2-bar drums pattern clears the dense edge.
    const demo = createDemoProject();
    const dense = withPatterns(
      demo,
      [...demo.patterns.drums, saturatedDrums(2, "fill")],
      [],
    );
    expect(densityBand(dense)).toBe(3);
  });
});
