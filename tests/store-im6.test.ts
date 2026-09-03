/**
 * IM-6 store tests: full mutation API (gate/preset/kit, scale mutations,
 * persisted transport, pattern primitives, song chain), schema-validation
 * hard-fail behavior, store→document→store round-trip, and deep undo/redo
 * restoration across mixed action sequences.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPattern,
  canRedo,
  canUndo,
  docStore,
  duplicatePattern,
  redo,
  renamePattern,
  setLaneChain,
  setLaneGate,
  setLaneScaleOverride,
  setLaneSoundId,
  setProjectScale,
  setTransport,
  togglePitchedCell,
  undo,
} from "../src/state/store";
import { effectiveScale } from "../src/document/scales";
import { MODE_INTERVALS } from "../src/document/scales";

function doc() {
  return docStore.getState().doc;
}

beforeEach(() => {
  // Rewind to the initial document, then drop all history (redo would
  // otherwise re-apply the previous test's edits and refill `past`).
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("lane config actions", () => {
  it("setLaneGate replaces the gate immutably", () => {
    const before = doc().lanes[1];
    setLaneGate("bass", { unit: "seconds", value: 0.2 });
    const after = doc().lanes.find((l) => l.id === "bass")!;
    expect(after.gate).toEqual({ unit: "seconds", value: 0.2 });
    expect(before.gate).toEqual({ unit: "steps", value: 2 }); // untouched
  });

  it("setLaneGate rejects an out-of-range gate and leaves the store unchanged", () => {
    const before = doc();
    expect(() => setLaneGate("lead", { unit: "seconds", value: 99 })).toThrow();
    expect(doc()).toBe(before);
  });

  it("setLaneSoundId swaps preset (pitched) and kit (drums)", () => {
    setLaneSoundId("lead", "preset-lead-2");
    setLaneSoundId("drums", "kit-808");
    expect(
      (doc().lanes.find((l) => l.id === "lead") as { presetId: string })
        .presetId,
    ).toBe("preset-lead-2");
    expect(
      (doc().lanes.find((l) => l.id === "drums") as { kitId: string }).kitId,
    ).toBe("kit-808");
  });
});

describe("scale mutations", () => {
  it("setProjectScale changes root and mode", () => {
    setProjectScale({ root: 7, mode: "mixolydian" });
    expect(doc().scale).toEqual({ root: 7, mode: "mixolydian" });
    expect(effectiveScale(doc(), "bass").intervals).toBe(
      MODE_INTERVALS.mixolydian,
    );
  });

  it("setLaneScaleOverride sets and clears an override, collapsing to null", () => {
    expect(doc().laneOverrides).toBeNull();
    setLaneScaleOverride("lead", { root: 2, mode: "dorian" });
    expect(doc().laneOverrides?.lead).toEqual({ root: 2, mode: "dorian" });
    expect(effectiveScale(doc(), "lead").root).toBe(2);
    expect(effectiveScale(doc(), "bass").root).toBe(0); // project default

    setLaneScaleOverride("lead", null);
    expect(doc().laneOverrides).toBeNull();
    expect(effectiveScale(doc(), "lead").root).toBe(0);
  });

  it("clearing one override keeps the other", () => {
    setLaneScaleOverride("bass", { root: 5, mode: "phrygian" });
    setLaneScaleOverride("lead", { root: 9, mode: "lydian" });
    setLaneScaleOverride("bass", null);
    expect(doc().laneOverrides?.bass).toBeUndefined();
    expect(doc().laneOverrides?.lead).toEqual({ root: 9, mode: "lydian" });
  });

  it("rejects an unknown mode", () => {
    const before = doc();
    // @ts-expect-error intentionally invalid
    expect(() => setProjectScale({ root: 0, mode: "locrian" })).toThrow();
    expect(doc()).toBe(before);
  });
});

describe("transport persistence", () => {
  it("patches individual fields", () => {
    setTransport({ bpm: 143 });
    expect(doc().transport.bpm).toBe(143);
    setTransport({ swing: 0.4, metronome: true });
    expect(doc().transport.swing).toBe(0.4);
    expect(doc().transport.metronome).toBe(true);
    setTransport({ loopBars: 4 });
    expect(doc().transport.loopBars).toBe(4);
  });

  it("rejects out-of-range bpm", () => {
    const before = doc();
    expect(() => setTransport({ bpm: 500 })).toThrow();
    expect(doc()).toBe(before);
  });

  it("rapid same-field drags coalesce; a different field does not", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    setTransport({ swing: 0.1 });
    setTransport({ swing: 0.2 });
    setTransport({ swing: 0.3 });
    expect(doc().transport.swing).toBe(0.3);
    undo();
    expect(doc().transport.swing).toBe(0); // whole drag = one step
    expect(canUndo()).toBe(false);

    setTransport({ swing: 0.25 });
    setTransport({ bpm: 100 }); // different family → separate entries
    expect(canUndo()).toBe(true);
    undo();
    expect(doc().transport.bpm).toBe(120);
    expect(doc().transport.swing).toBe(0.25);
  });
});

describe("pattern primitives + song chain", () => {
  it("addPattern appends an empty valid pattern and returns its id", () => {
    const id = addPattern("drums", 2, "B");
    const drums = doc().patterns.drums;
    expect(drums).toHaveLength(2);
    const added = drums[1];
    expect(added.id).toBe(id);
    if (added.kind !== "drums") throw new Error("kind");
    expect(added.bars).toBe(2);
    expect(added.steps.kick).toHaveLength(32);

    const leadId = addPattern("lead", 1);
    const lead = doc().patterns.lead.find((p) => p.id === leadId)!;
    if (lead.kind !== "pitched") throw new Error("kind");
    expect(lead.rows).toHaveLength(14); // minor: 7 × 2 octaves
    expect(lead.rows.every((r) => r.steps.every((c) => c === 0))).toBe(true);
  });

  it("duplicatePattern deep-copies content under a fresh id", () => {
    togglePitchedCell("bass", 0, 0);
    const original = doc().patterns.bass[0];
    const id = duplicatePattern("bass", original.id);
    const copy = doc().patterns.bass.find((p) => p.id === id)!;
    expect(copy).not.toBe(original);
    expect(copy.id).not.toBe(original.id);
    if (copy.kind !== "pitched" || original.kind !== "pitched")
      throw new Error("kind");
    expect(copy.rows[0].steps[0]).toBe(1);
    copy.rows[0].steps[0] = 0; // mutate the copy…
    expect(original.rows[0].steps[0]).toBe(1); // …original untouched (deep)
  });

  it("renamePattern renames only the target", () => {
    renamePattern("drums", "drums-1", "MAIN");
    expect(doc().patterns.drums[0].name).toBe("MAIN");
  });

  it("setLaneChain reorders/repeats pattern ids", () => {
    const b = addPattern("drums", 1, "B");
    setLaneChain("drums", [b, "drums-1", "drums-1"]);
    expect(doc().songChain.drums).toEqual([b, "drums-1", "drums-1"]);
  });

  it("setLaneChain rejects unknown ids", () => {
    const before = doc();
    expect(() => setLaneChain("lead", ["nope"])).toThrow();
    expect(doc()).toBe(before);
  });
});

describe("round-trip + deep undo", () => {
  it("store doc survives a document→JSON→store round trip unchanged", () => {
    // Make the doc interesting first.
    togglePitchedCell("bass", 4, 7);
    setProjectScale({ root: 9, mode: "pentatonicMinor" });
    setLaneScaleOverride("chords", { root: 4, mode: "lydian" });
    addPattern("lead", 2, "B");

    const current = doc();
    const serialized = JSON.parse(JSON.stringify(current));
    const roundTripped = JSON.parse(JSON.stringify(serialized));
    expect(roundTripped).toEqual(current); // JSON-safe by construction
    // And the store accepts the serialized document back as its own state.
    docStore.setState({ doc: roundTripped });
    expect(doc()).toEqual(current);
  });

  it("undo/redo restores the document exactly (deep) across mixed actions", () => {
    const initial = JSON.parse(JSON.stringify(doc()));

    togglePitchedCell("lead", 6, 2);
    setProjectScale({ root: 5, mode: "dorian" });
    setLaneScaleOverride("bass", { root: 7, mode: "minor" });
    setLaneGate("chords", { unit: "steps", value: 8 });
    setTransport({ bpm: 96, swing: 0.22, loopBars: 2, metronome: true });
    setLaneSoundId("drums", "kit-808");
    const dup = duplicatePattern("lead", "lead-1");
    renamePattern("lead", dup, "COPY");
    setLaneChain("lead", [dup, "lead-1"]);
    undo();
    redo(); // mid-sequence undo/redo must not corrupt history

    expect(doc()).not.toEqual(initial);
    while (canUndo()) undo();
    expect(JSON.parse(JSON.stringify(doc()))).toEqual(initial);

    while (canRedo()) redo();
    expect(doc().scale).toEqual({ root: 5, mode: "dorian" });
    expect(doc().songChain.lead).toEqual([dup, "lead-1"]);
    expect(doc().transport).toEqual({
      bpm: 96,
      swing: 0.22,
      loopBars: 2,
      metronome: true,
    });
  });
});
