/**
 * DES-6 pattern-rail tests: tile derivation from chain + patterns, pending
 * state mapping from the engine's getPendingSwitch snapshot, cue-label
 * schema round-trip (document data, migration-safe default), collapse/
 * expand selection preservation, and the pure keyboard/clamp helpers.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/document/schema";
import { validateProject } from "../src/document/validate";
import {
  appendChainSlot,
  addPattern,
  canUndo,
  docStore,
  duplicatePattern,
  removeChainSlot,
  removePattern,
  renamePattern,
  setChainCue,
  setLaneChain,
  undo,
} from "../src/state/store";
import {
  clampCue,
  clampSlot,
  patternPool,
  pendingAnnouncement,
  railTiles,
  structurePendingAnnouncement,
  tileState,
} from "../src/state/patternRail";
import type { PendingSwitchSnapshot } from "../src/engine/session";
import {
  activeLane,
  activePatterns,
  focusCell,
  getActivePattern,
  selectPattern,
  toggleViewMode,
  viewMode,
} from "../src/state/selection";

function doc() {
  return docStore.getState().doc;
}

function pending(over: Partial<PendingSwitchSnapshot> = {}): PendingSwitchSnapshot {
  return {
    lane: "drums",
    fromPatternId: "drums-1",
    toPatternId: "drums-2",
    appliesAtStep: 16,
    mode: "boundary",
    ...over,
  };
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

describe("rail tile derivation", () => {
  it("derives one tile per chain slot with pattern data and cue", () => {
    const base = createDefaultProject();
    const withChain = {
      ...base,
      songChain: {
        ...base.songChain,
        drums: ["drums-1", "drums-1", "drums-1"],
      },
      chainCues: {
        drums: [null, "VERSE", "DROP"],
        bass: [null],
        chords: [null],
        lead: [null],
      },
    } as typeof base;
    const tiles = railTiles(withChain, "drums");
    expect(tiles.map((t) => t.slot)).toEqual([0, 1, 2]);
    expect(tiles.map((t) => t.patternId)).toEqual(["drums-1", "drums-1", "drums-1"]);
    // Repeats are distinct slots — the second A can be the DROP.
    expect(tiles.map((t) => t.cue)).toEqual([null, "VERSE", "DROP"]);
    expect(tiles[0]).toMatchObject({ name: "A", bars: 1 });
  });

  it("falls back to a '?' tile for an unknown id (never crashes)", () => {
    const base = createDefaultProject();
    const broken = {
      ...base,
      songChain: { ...base.songChain, lead: ["lead-1", "nope"] },
    } as typeof base;
    const tiles = railTiles(broken, "lead");
    expect(tiles[1]).toMatchObject({ patternId: "nope", name: "?", bars: 1 });
  });

  it("pattern pool lists the lane's patterns", () => {
    const base = createDefaultProject();
    expect(patternPool(base, "bass")).toEqual([
      { patternId: "bass-1", name: "A", bars: 1 },
    ]);
  });
});

describe("pending-state mapping from getPendingSwitch", () => {
  const tiles = [
    { slot: 0, patternId: "drums-1", name: "A", bars: 1, cue: null },
    { slot: 1, patternId: "drums-2", name: "B", bars: 1, cue: null },
  ] as const;

  it("pending switch marks the target tile pending (top precedence)", () => {
    const state = tileState(tiles[1], {
      activePatternId: "drums-1",
      pending: pending(),
      structurePending: false,
      selectedPatternId: "drums-1",
    });
    expect(state).toBe("pending");
    // Even the currently-active tile is NOT active-marked while superseded:
    expect(
      tileState(tiles[0], {
        activePatternId: "drums-1",
        pending: pending(),
        structurePending: false,
        selectedPatternId: "drums-1",
      }),
    ).toBe("selected"); // selection, not "active": the switch is taking over
  });

  it("active maps from the engine's active pattern; selected from the editing selection", () => {
    expect(
      tileState(tiles[0], {
        activePatternId: "drums-1",
        pending: null,
        structurePending: false,
        selectedPatternId: "drums-2",
      }),
    ).toBe("active");
    expect(
      tileState(tiles[1], {
        activePatternId: "drums-1",
        pending: null,
        structurePending: false,
        selectedPatternId: "drums-2",
      }),
    ).toBe("selected");
    expect(
      tileState(tiles[1], {
        activePatternId: null,
        pending: null,
        structurePending: true,
        selectedPatternId: "drums-1",
      }),
    ).toBe("idle");
  });

  it("announcements are text-equivalent (pending, iteration mode, structure)", () => {
    expect(pendingAnnouncement("DRUMS", pending())).toBe(
      "DRUMS: switching to drums-2 at step 16",
    );
    expect(
      pendingAnnouncement("DRUMS", pending({ mode: "iteration", appliesAtStep: 32 })),
    ).toBe("DRUMS: switching to drums-2 at step 32 (next chain pass)");
    expect(pendingAnnouncement("DRUMS", pending({ appliesAtStep: null }))).toBe(
      "DRUMS: switching to drums-2 when playback starts",
    );
    expect(structurePendingAnnouncement("BASS")).toBe(
      "BASS: chain change queued — lands at the next chain pass",
    );
  });
});

describe("cue label schema round-trip (document data)", () => {
  it("default project has no cues (migration-safe: field absent)", () => {
    const def = createDefaultProject();
    expect(def.chainCues).toBeUndefined();
    // ...and validates cleanly without the field:
    expect(() => validateProject(def)).not.toThrow();
    expect(validateProject(def).chainCues ?? null).toBeNull();
  });

  it("labels survive validate → JSON → validate", () => {
    const def = createDefaultProject();
    const withCues = {
      ...def,
      songChain: { ...def.songChain, drums: ["drums-1", "drums-1"] },
      chainCues: { drums: ["INTRO", null], bass: [null], chords: [null], lead: [null] },
    } as typeof def;
    const validated = validateProject(withCues);
    expect(validated.chainCues?.drums).toEqual(["INTRO", null]);
    const round = validateProject(JSON.parse(JSON.stringify(validated)));
    expect(round.chainCues?.drums).toEqual(["INTRO", null]);
  });

  it("cue slot count must match the chain length (semantic check)", () => {
    const def = createDefaultProject();
    const bad = {
      ...def,
      chainCues: { drums: ["A", "B"], bass: [null], chords: [null], lead: [null] },
    } as typeof def;
    try {
      validateProject(bad);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as { issues: readonly string[] }).issues.join("\n")).toMatch(
        /chainCues\.drums/,
      );
    }
  });

  it("cue labels longer than CUE_MAX_CHARS are rejected; canonical empty collapses to null", () => {
    const def = createDefaultProject();
    const long = {
      ...def,
      chainCues: { drums: ["0123456789012"], bass: [null], chords: [null], lead: [null] },
    } as typeof def;
    expect(() => validateProject(long)).toThrow();
    const blank = {
      ...def,
      chainCues: { drums: ["  "], bass: [null], chords: [null], lead: [null] },
    } as typeof def;
    expect(validateProject(blank).chainCues).toBeNull();
  });
});

describe("store actions: patterns + chain + cues", () => {
  it("addPattern appends a pattern of the chosen bar count; appendChainSlot chains it", () => {
    const id = addPattern("bass", 2, "B");
    expect(doc().patterns.bass.map((p) => p.id)).toContain(id);
    expect(doc().patterns.bass.find((p) => p.id === id)).toMatchObject({ bars: 2, name: "B" });
    expect(doc().songChain.bass).toEqual(["bass-1"]); // added, not yet chained
    appendChainSlot("bass", id);
    expect(doc().songChain.bass).toEqual(["bass-1", id]);
    // Parallel cue array (canonical null until a label exists).
    expect(doc().chainCues?.bass ?? [null, null]).toEqual([null, null]);
  });

  it("duplicatePattern deep-copies content under a fresh id", () => {
    const id = duplicatePattern("lead", "lead-1");
    expect(id).not.toBe("lead-1");
    expect(doc().patterns.lead.find((p) => p.id === id)?.name).toBe("A+");
  });

  it("renamePattern renames", () => {
    renamePattern("chords", "chords-1", "MAIN");
    expect(doc().patterns.chords[0]!.name).toBe("MAIN");
  });

  it("removePattern refuses the last pattern and strips chain occurrences with cue remap", () => {
    expect(removePattern("drums", "drums-1")).toBe(false); // only one
    const b = addPattern("drums", 1, "B");
    // chain: [A, B, A] with cues [INTRO, null, DROP]
    setLaneChainForTest("drums", ["drums-1", b, "drums-1"]);
    setChainCue("drums", 0, "INTRO");
    setChainCue("drums", 2, "DROP");
    expect(removePattern("drums", "drums-1")).toBe(true);
    expect(doc().patterns.drums.map((p) => p.id)).toEqual([b]);
    expect(doc().songChain.drums).toEqual([b]);
    expect(doc().chainCues).toBeNull(); // no labels survive → canonical null
  });

  it("removePattern shifts surviving slots left, each keeping its own cue", () => {
    const b = addPattern("bass", 1, "B");
    setLaneChainForTest("bass", ["bass-1", b, b, "bass-1"]);
    setChainCue("bass", 1, "VERSE");
    setChainCue("bass", 3, "DROP");
    removePattern("bass", b);
    expect(doc().songChain.bass).toEqual(["bass-1", "bass-1"]);
    // Surviving slots keep their per-slot labels positionally.
    expect(doc().chainCues?.bass).toEqual([null, "DROP"]);
  });

  it("removeChainSlot refuses the last slot and splices chain + cues", () => {
    expect(removeChainSlot("lead", 0)).toBe(false);
    const b = addPattern("lead", 1, "B");
    appendChainSlot("lead", b);
    setChainCue("lead", 0, "VERSE");
    expect(removeChainSlot("lead", 0)).toBe(true);
    expect(doc().songChain.lead).toEqual([b]);
    expect(doc().chainCues?.lead ?? [null]).toEqual([null]);
  });

  it("setChainCue sets, clears, and rejects over-length labels untouched", () => {
    setChainCue("drums", 0, "  VERSE  ");
    expect(doc().chainCues?.drums).toEqual(["VERSE"]);
    const before = doc();
    expect(() => setChainCue("drums", 0, "0123456789012")).toThrow();
    expect(doc()).toBe(before);
    setChainCue("drums", 0, "");
    expect(doc().chainCues).toBeNull();
  });

  it("chain edits are one undo step each (no coalescing family)", () => {
    setChainCue("drums", 0, "VERSE");
    appendChainSlot("drums", "drums-1");
    undo();
    expect(doc().songChain.drums).toEqual(["drums-1"]);
    expect(doc().chainCues?.drums).toEqual(["VERSE"]);
    undo();
    expect(doc().chainCues ?? null).toBeNull();
  });
});

function setLaneChainForTest(lane: "drums" | "bass" | "lead", ids: string[]): void {
  setLaneChain(lane, ids);
}

describe("collapse/expand never loses your place", () => {
  it("viewMode toggles; selection (lane, pattern, cell) survives both directions", () => {
    expect(viewMode()).toBe("chain");
    selectPattern("bass", "bass-1");
    focusCell({ lane: "bass", row: 2, step: 9 });
    const laneBefore = activeLane();
    const patternsBefore = activePatterns();

    toggleViewMode();
    expect(viewMode()).toBe("focus");
    expect(activeLane()).toBe(laneBefore);
    expect(activePatterns()).toEqual(patternsBefore);
    expect(getActivePattern("bass")).toBe("bass-1");

    toggleViewMode();
    expect(viewMode()).toBe("chain");
    expect(activePatterns()).toEqual(patternsBefore);
  });

  it("view mode never enters the document or its history", () => {
    const before = doc();
    toggleViewMode();
    expect(doc()).toBe(before);
    expect(canUndo()).toBe(false);
    toggleViewMode();
  });
});

describe("keyboard helpers", () => {
  it("clampSlot clamps within the row and handles empty rows", () => {
    expect(clampSlot(4, 0, -1)).toBe(0);
    expect(clampSlot(4, 2, 1)).toBe(3);
    expect(clampSlot(4, 3, 1)).toBe(3);
    expect(clampSlot(0, 2, 1)).toBe(0);
  });

  it("clampCue collapses whitespace and caps length", () => {
    expect(clampCue("  verse   two ", 12)).toBe("verse two");
    expect(clampCue("0123456789012", 12)).toBe("012345678901");
  });
});
