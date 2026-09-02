/**
 * IM-7 song-compiler tests: a lane's chain compiles to exact chain-local
 * steps across mixed 1/2/4-bar patterns; per-lane chains are independent;
 * empty/unknown chain ids fall back per the documented semantics.
 */

import { describe, expect, it } from "vitest";
import {
  compileLaneSchedule,
  compileSong,
  resolveChainPatterns,
} from "../src/audio/song";
import { getDrumKit } from "../src/audio/presets";
import { timeAtStep } from "../src/audio/time";
import {
  createDefaultProject,
  type DrumPattern,
  type Pattern,
  type ProjectDocument,
} from "../src/document/schema";

const KIT = getDrumKit("kit-default")!;
const GATE = { unit: "steps", value: 1 } as const;

function drumPattern(id: string, bars: 1 | 2 | 4, onSteps: number[]): DrumPattern {
  const kick = new Array(16 * bars).fill(false);
  for (const s of onSteps) kick[s] = true;
  return {
    kind: "drums",
    id,
    name: id,
    bars,
    steps: {
      kick,
      snare: new Array(16 * bars).fill(false),
      hat: new Array(16 * bars).fill(false),
      openhat: new Array(16 * bars).fill(false),
      clap: new Array(16 * bars).fill(false),
      tom: new Array(16 * bars).fill(false),
    },
  };
}

function docWithDrumChain(patterns: Pattern[], chain: string[]): ProjectDocument {
  const doc = createDefaultProject();
  return { ...doc, patterns: { ...doc.patterns, drums: patterns }, songChain: { ...doc.songChain, drums: chain } };
}

describe("resolveChainPatterns", () => {
  const doc = docWithDrumChain([drumPattern("A", 1, []), drumPattern("B", 1, [])], ["A"]);

  it("resolves chain ids in order (repeats allowed)", () => {
    const ids = resolveChainPatterns(
      docWithDrumChain(doc.patterns.drums, ["B", "A", "B"]),
      "drums",
    ).map((p) => p.id);
    expect(ids).toEqual(["B", "A", "B"]);
  });

  it("skips unknown ids inside a non-empty chain", () => {
    const ids = resolveChainPatterns(docWithDrumChain(doc.patterns.drums, ["A", "zzz", "B"]), "drums").map((p) => p.id);
    expect(ids).toEqual(["A", "B"]);
  });

  it("empty chain or all-unknown ids fall back to the first pattern", () => {
    expect(resolveChainPatterns(docWithDrumChain(doc.patterns.drums, []), "drums").map((p) => p.id)).toEqual(["A"]);
    expect(resolveChainPatterns(docWithDrumChain(doc.patterns.drums, ["x", "y"]), "drums").map((p) => p.id)).toEqual(["A"]);
  });
});

describe("compileLaneSchedule", () => {
  it("mixed 1/2/4-bar chain: exact chain-local steps and segment table", () => {
    // A(1 bar, kick at 0), B(2 bars, kick at 0 and 3), C(4 bars, kick at 5).
    const chain = [
      drumPattern("A", 1, [0]),
      drumPattern("B", 2, [0, 3]),
      drumPattern("C", 4, [5]),
    ];
    const groove = { bpm: 120, swing: 0 };
    const schedule = compileLaneSchedule({ chain, preset: KIT, gate: GATE, groove });

    expect(schedule.chainSteps).toBe(16 + 32 + 64); // 112
    expect(schedule.segments).toEqual([
      { patternId: "A", startStep: 0, steps: 16 },
      { patternId: "B", startStep: 16, steps: 32 },
      { patternId: "C", startStep: 48, steps: 64 },
    ]);
    // Events land at exactly segment-start + pattern-local step.
    expect([...schedule.byStep.keys()].sort((a, b) => a - b)).toEqual([0, 16, 19, 53]);
    // Pattern-local times are exact (loop-relative within the pattern).
    expect(schedule.byStep.get(19)![0].time).toBe(timeAtStep(3, groove));
    expect(schedule.byStep.get(53)![0].time).toBe(timeAtStep(5, groove));
  });

  it("swing stays pattern-local exact: segment offsets are even, parity preserved", () => {
    const groove = { bpm: 123, swing: 0.5 };
    const chain = [drumPattern("A", 1, [0]), drumPattern("B", 1, [1])];
    const schedule = compileLaneSchedule({ chain, preset: KIT, gate: GATE, groove });
    expect(schedule.byStep.get(0)![0].time).toBe(0); // A's even step unaffected
    expect(schedule.byStep.get(17)![0].time).toBe(timeAtStep(1, groove)); // B's odd step stays odd
  });

  it("an event on the last step of a segment maps to the segment's final step", () => {
    const chain = [drumPattern("A", 1, [0]), drumPattern("B", 1, [15])];
    const schedule = compileLaneSchedule({ chain, preset: KIT, gate: GATE, groove: { bpm: 120, swing: 0 } });
    expect([...schedule.byStep.keys()].sort((a, b) => a - b)).toEqual([0, 31]);
  });

  it("single-pattern chain loops as one segment (empty-chain fallback shape)", () => {
    const chain = [drumPattern("A", 2, [0])];
    const schedule = compileLaneSchedule({ chain, preset: KIT, gate: GATE, groove: { bpm: 120, swing: 0 } });
    expect(schedule.chainSteps).toBe(32);
    expect(schedule.segments).toEqual([{ patternId: "A", startStep: 0, steps: 32 }]);
  });
});

describe("compileSong", () => {
  it("compiles per-lane chains independently (different lengths per lane)", () => {
    const doc = createDefaultProject();
    const drumsB = drumPattern("drums-B", 2, [0, 4]);
    const doc2: ProjectDocument = {
      ...doc,
      patterns: { ...doc.patterns, drums: [doc.patterns.drums[0], drumsB] },
      songChain: { ...doc.songChain, drums: ["drums-1", "drums-B"] },
    };
    const songs = compileSong(doc2, { bpm: 120, swing: 0 });
    expect(Object.keys(songs).sort()).toEqual(["bass", "chords", "drums", "lead"]);
    // Drums: 1-bar + 2-bar chain = 48 steps; others stay at their 1-bar chains.
    expect(songs.drums.chainSteps).toBe(48);
    expect(songs.bass.chainSteps).toBe(16);
    expect(songs.lead.segments).toEqual([{ patternId: "lead-1", startStep: 0, steps: 16 }]);
  });

  it("pitched lanes compile chord stacking through the chain", () => {
    const doc = createDefaultProject();
    // Two note-ons in the default chords pattern (degrees 0 and 3).
    const chordRows = (doc.patterns.chords[0] as { rows: { degree: number; steps: number[] }[] }).rows;
    chordRows[0].steps[0] = 1;
    chordRows[3].steps[8] = 1;
    const songs = compileSong(doc, { bpm: 120, swing: 0 });
    // Chords stack triads: 2 note-ons → 6 events across the chain.
    const events = [...songs.chords.byStep.values()].flat();
    expect(events.length).toBe(6);
    expect(songs.chords.byStep.get(0)!.length).toBe(3);
    expect(songs.chords.byStep.get(8)!.length).toBe(3);
  });
});
