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
  appendBlankPattern,
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
  clampSlotTo,
  nextPatternLabel,
  patternCreatedAnnouncement,
  patternPool,
  pendingAnnouncement,
  queuedLanesAnnouncement,
  railTiles,
  RAIL_ROWS,
  rangeCommitSlot,
  rangeExtend,
  rangeIncludes,
  rangeRows,
  structurePendingAnnouncement,
  tileState,
} from "../src/state/patternRail";
import {
  cueSweepBegin,
  cueSweepCommit,
  cueSweepMove,
  cueSweepMoved,
  DBLTAP_RADIUS_PX,
  DBLTAP_WINDOW_MS,
  isDoubleTap,
  type TapRecord,
} from "../src/interaction/drag";
import type { LaneId } from "../src/document/schema";
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

function pending(
  over: Partial<PendingSwitchSnapshot> = {},
): PendingSwitchSnapshot {
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
    expect(tiles.map((t) => t.patternId)).toEqual([
      "drums-1",
      "drums-1",
      "drums-1",
    ]);
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
      pendingAnnouncement(
        "DRUMS",
        pending({ mode: "iteration", appliesAtStep: 32 }),
      ),
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
      chainCues: {
        drums: ["INTRO", null],
        bass: [null],
        chords: [null],
        lead: [null],
      },
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
      chainCues: {
        drums: ["A", "B"],
        bass: [null],
        chords: [null],
        lead: [null],
      },
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
      chainCues: {
        drums: ["0123456789012"],
        bass: [null],
        chords: [null],
        lead: [null],
      },
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
    expect(doc().patterns.bass.find((p) => p.id === id)).toMatchObject({
      bars: 2,
      name: "B",
    });
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

  // IN-4 (verifier finding: `+`-append twice then Delete on an appended slot
  // threw an uncaught ProjectValidationError and the slot survived): the cue
  // callback must map the OLD chain's slots — withChain previously truncated
  // the cue array to the NEW length first, so a slot removal dropped one
  // entry too many and the parallel-length invariant failed validation.
  it("append twice then Delete any appended slot: cues stay parallel, nothing throws", () => {
    for (const lane of ["drums", "bass", "chords", "lead"] as const) {
      const selected = doc().songChain[lane][0]!;
      appendChainSlot(lane, selected);
      appendChainSlot(lane, selected);
      const len = doc().songChain[lane].length;
      for (const slot of [len - 2, len - 1]) {
        expect(() => removeChainSlot(lane, slot)).not.toThrow();
        expect(doc().songChain[lane]).toHaveLength(len - 1);
        // Full-schema validity includes the chain↔cues parallel invariant.
        expect(() => validateProject(doc())).not.toThrow();
        if (doc().chainCues)
          expect(doc().chainCues![lane].length).toBe(
            doc().songChain[lane].length,
          );
        appendChainSlot(lane, selected); // restore length for the next pass
      }
      if (doc().chainCues)
        for (const l of ["drums", "bass", "chords", "lead"] as const)
          expect(doc().chainCues![l].length).toBe(doc().songChain[l].length);
    }
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

  // BC-1 (I3-a): the rail `+` store law — one press creates a NEW blank
  // next-letter pattern AND appends it in ONE commit.
  it("appendBlankPattern creates a named blank pattern and chains it in one commit", () => {
    const poolBefore = doc().patterns.bass.length;
    const chainBefore = [...doc().songChain.bass];
    const id = appendBlankPattern("bass", nextPatternLabel(poolBefore));
    // Pool grows by the blank (1 bar, next-letter name, no content)…
    expect(doc().patterns.bass).toHaveLength(poolBefore + 1);
    const created = doc().patterns.bass.find((p) => p.id === id);
    expect(created).toMatchObject({ name: "B", bars: 1 });
    if (created?.kind === "pitched") expect(created.notes).toEqual([]);
    // …and the chain gained exactly one slot playing it (unlabeled cue).
    expect(doc().songChain.bass).toEqual([...chainBefore, id]);
    expect(doc().chainCues?.bass ?? doc().songChain.bass.map(() => null))
      .toHaveLength(doc().songChain.bass.length);
    expect(() => validateProject(doc())).not.toThrow();
  });

  it("one + press = ONE undo step: create and append co-revert together", () => {
    const poolBefore = doc().patterns.lead.length;
    const chainBefore = [...doc().songChain.lead];
    appendBlankPattern("lead", nextPatternLabel(poolBefore));
    expect(canUndo()).toBe(true);
    undo();
    // A single Ctrl+Z reverts BOTH halves of the gesture (the removePattern
    // single-commit precedent — no coalescing family, nothing half-undone).
    expect(doc().patterns.lead).toHaveLength(poolBefore);
    expect(doc().songChain.lead).toEqual(chainBefore);
  });

  it("two deliberate + presses are two undo steps (structural actions never coalesce)", () => {
    const poolBefore = doc().patterns.drums.length;
    const chainBefore = [...doc().songChain.drums];
    appendBlankPattern("drums", nextPatternLabel(poolBefore));
    appendBlankPattern(
      "drums",
      nextPatternLabel(doc().patterns.drums.length),
    );
    undo();
    // First Ctrl+Z takes back only the SECOND press…
    expect(doc().patterns.drums).toHaveLength(poolBefore + 1);
    expect(doc().songChain.drums).toHaveLength(chainBefore.length + 1);
    undo();
    // …the second takes back the first.
    expect(doc().patterns.drums).toHaveLength(poolBefore);
    expect(doc().songChain.drums).toEqual(chainBefore);
  });

  it("nextPatternLabel walks A..Z then P27+ by pool index", () => {
    expect(nextPatternLabel(0)).toBe("A");
    expect(nextPatternLabel(1)).toBe("B");
    expect(nextPatternLabel(25)).toBe("Z");
    expect(nextPatternLabel(26)).toBe("P27");
    expect(nextPatternLabel(30)).toBe("P31");
  });

  it("patternCreatedAnnouncement is the E11 twin (label, bars pluralized, appended)", () => {
    expect(patternCreatedAnnouncement("B", 1)).toBe(
      "PATTERN B CREATED · 1 BAR · APPENDED",
    );
    expect(patternCreatedAnnouncement("P27", 4)).toBe(
      "PATTERN P27 CREATED · 4 BARS · APPENDED",
    );
  });
});

function setLaneChainForTest(
  lane: "drums" | "bass" | "lead",
  ids: string[],
): void {
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

// ---------------------------------------------------------------------------
// IN-3 multi-clip cueing (keyboard.md v2 §"Rail multi-clip cue selection")
// ---------------------------------------------------------------------------

/** Four-slot rows on drums/chords/lead, TWO on bass (carry-clamp coverage). */
const lengths = (): Record<LaneId, number> => ({
  drums: 4,
  bass: 2,
  chords: 4,
  lead: 4,
});

describe("IN-3 range selection (Shift+arrows) — pure geometry", () => {
  it("clampSlotTo clamps into the row, never wraps (empty rows pin to 0)", () => {
    expect(clampSlotTo(4, 7)).toBe(3);
    expect(clampSlotTo(4, -1)).toBe(0);
    expect(clampSlotTo(2, 3)).toBe(1);
    expect(clampSlotTo(0, 2)).toBe(0);
  });

  it("extends along the row from the shift anchor; the anchor stays put", () => {
    const first = rangeExtend(null, { lane: "drums", slot: 0 }, "ArrowRight", lengths());
    expect(first).toEqual({
      anchor: { lane: "drums", slot: 0 },
      focus: { lane: "drums", slot: 1 },
    });
    const second = rangeExtend(first, first.focus, "ArrowRight", lengths());
    expect(second.anchor).toEqual({ lane: "drums", slot: 0 });
    expect(second.focus).toEqual({ lane: "drums", slot: 2 });
    // Extending LEFT from the anchor still moves the focus edge (a range can
    // shrink past the anchor — the anchor marks where the shift BEGAN).
    const left = rangeExtend(second, second.focus, "ArrowLeft", lengths());
    expect(left.anchor).toEqual({ lane: "drums", slot: 0 });
    expect(left.focus).toEqual({ lane: "drums", slot: 1 });
  });

  it("never wraps: clamps at the row's first/last slot and top/bottom row", () => {
    const atZero = rangeExtend(
      null,
      { lane: "drums", slot: 0 },
      "ArrowLeft",
      lengths(),
    );
    expect(atZero.focus).toEqual({ lane: "drums", slot: 0 });
    const atLast = rangeExtend(
      null,
      { lane: "drums", slot: 3 },
      "ArrowRight",
      lengths(),
    );
    expect(atLast.focus).toEqual({ lane: "drums", slot: 3 });
    const topRow = rangeExtend(
      null,
      { lane: "drums", slot: 2 },
      "ArrowUp",
      lengths(),
    );
    expect(topRow.focus).toEqual({ lane: "drums", slot: 2 }); // stays
    const bottomRow = rangeExtend(
      null,
      { lane: "lead", slot: 1 },
      "ArrowDown",
      lengths(),
    );
    expect(bottomRow.focus).toEqual({ lane: "lead", slot: 1 }); // stays
  });

  it("Shift+↑/↓ carries the slot into the adjacent row, clamped to its length", () => {
    const down = rangeExtend(
      null,
      { lane: "drums", slot: 3 },
      "ArrowDown",
      lengths(),
    );
    expect(down.focus).toEqual({ lane: "bass", slot: 1 }); // carried, clamped to 2
    const downAgain = rangeExtend(down, down.focus, "ArrowDown", lengths());
    expect(downAgain.focus).toEqual({ lane: "chords", slot: 1 }); // stays clamped
    const up = rangeExtend(downAgain, downAgain.focus, "ArrowUp", lengths());
    expect(up.focus).toEqual({ lane: "bass", slot: 1 }); // carried back
  });

  it("rangeRows lists touched rows top→bottom regardless of drag direction", () => {
    const upward = {
      anchor: { lane: "chords", slot: 2 } as const,
      focus: { lane: "drums", slot: 1 } as const,
    };
    expect(rangeRows(upward)).toEqual(["drums", "bass", "chords"]);
    const downward = {
      anchor: { lane: "drums", slot: 0 } as const,
      focus: { lane: "bass", slot: 1 } as const,
    };
    expect(rangeRows(downward)).toEqual(["drums", "bass"]);
  });

  it("rangeCommitSlot = the focus-edge column, clamped to each row's length", () => {
    const range = {
      anchor: { lane: "drums", slot: 0 } as const,
      focus: { lane: "bass", slot: 3 } as const, // bass only has 2 slots
    };
    expect(rangeCommitSlot(range, 4)).toBe(3); // drums: fits
    expect(rangeCommitSlot(range, 2)).toBe(1); // bass: clamped
  });

  it("rangeIncludes marks the 2D anchor↔focus box", () => {
    const range = {
      anchor: { lane: "drums", slot: 1 } as const,
      focus: { lane: "bass", slot: 3 } as const,
    };
    expect(rangeIncludes(range, "drums", 1)).toBe(true);
    expect(rangeIncludes(range, "drums", 3)).toBe(true);
    expect(rangeIncludes(range, "drums", 0)).toBe(false);
    expect(rangeIncludes(range, "bass", 1)).toBe(true); // clamped row still marks 1..2 tiles
    expect(rangeIncludes(range, "chords", 2)).toBe(false); // row not touched
    expect(rangeIncludes(range, "lead", 2)).toBe(false);
  });

  it("the E5 summary line is exact (both paths announce the same text)", () => {
    expect(queuedLanesAnnouncement(1)).toBe("QUEUED 1 LANES");
    expect(queuedLanesAnnouncement(3)).toBe("QUEUED 3 LANES");
  });
});

describe("IN-3 cue sweep (pointer gesture) — pure reducers", () => {
  it("begins at the pressed tile; same-tile moves are no-ops (same ref)", () => {
    const sweep = cueSweepBegin("drums", 1);
    expect(sweep.origin).toEqual({ lane: "drums", slot: 1 });
    expect(cueSweepMove(sweep, "drums", 1)).toBe(sweep); // ref equality
    expect(cueSweepMove(sweep, null, -1)).toBe(sweep); // off-tile
    expect(cueSweepMoved(sweep)).toBe(false); // unmoved = the click law
  });

  it("tracks every touched tile; per lane the LAST touch wins", () => {
    let sweep = cueSweepBegin("drums", 0);
    sweep = cueSweepMove(sweep, "drums", 1);
    sweep = cueSweepMove(sweep, "drums", 2);
    sweep = cueSweepMove(sweep, "bass", 0);
    sweep = cueSweepMove(sweep, "bass", 1);
    sweep = cueSweepMove(sweep, "drums", 1); // BACK into drums: 1 supersedes 2
    expect([...sweep.touched].sort()).toEqual([
      "bass:0",
      "bass:1",
      "drums:0",
      "drums:1",
      "drums:2",
    ]);
    expect(sweep.lastByLane.get("drums")).toBe(1);
    expect(sweep.lastByLane.get("bass")).toBe(1);
    expect(cueSweepMoved(sweep)).toBe(true);
  });

  it("commit = one cue target per touched lane, rows top→bottom", () => {
    let sweep = cueSweepBegin("lead", 3);
    sweep = cueSweepMove(sweep, "chords", 0);
    sweep = cueSweepMove(sweep, "drums", 2);
    sweep = cueSweepMove(sweep, "chords", 3); // chords last touch = 3
    expect(cueSweepCommit(sweep, RAIL_ROWS)).toEqual([
      { lane: "drums", slot: 2 },
      { lane: "chords", slot: 3 },
      { lane: "lead", slot: 3 },
    ]);
  });

  it("the committed state equals clicking each touched tile in sweep order", () => {
    // drums 0→1→2 then back to 1: individual clicks would leave pending=1
    // (the second click on 1 supersedes the 2 switch — IM-7 law).
    let sweep = cueSweepBegin("drums", 0);
    sweep = cueSweepMove(sweep, "drums", 1);
    sweep = cueSweepMove(sweep, "drums", 2);
    sweep = cueSweepMove(sweep, "drums", 1);
    expect(cueSweepCommit(sweep, RAIL_ROWS)).toEqual([{ lane: "drums", slot: 1 }]);
  });
});

describe("MB-2 dbltap twins (touch) — pure decision", () => {
  const tap = (
    target: string,
    time: number,
    x = 100,
    y = 100,
  ): TapRecord => ({ x, y, time, target });

  it("two taps on the same target inside the window+radius are a dbltap", () => {
    const first = tap("drums:1", 1_000);
    expect(isDoubleTap(null, first)).toBe(false); // no predecessor
    expect(isDoubleTap(first, tap("drums:1", 1_200, 112, 108))).toBe(true);
  });

  it("different targets never pair (tile vs its cue line are separate targets)", () => {
    const first = tap("drums:1", 1_000);
    expect(isDoubleTap(first, tap("drums:1:cue", 1_200))).toBe(false);
    expect(isDoubleTap(first, tap("bass:1", 1_200))).toBe(false);
  });

  it("outside the time window it is two taps, not a dbltap", () => {
    const first = tap("drums:1", 1_000);
    expect(
      isDoubleTap(first, tap("drums:1", 1_000 + DBLTAP_WINDOW_MS + 1)),
    ).toBe(false);
    expect(
      isDoubleTap(first, tap("drums:1", 1_000 + DBLTAP_WINDOW_MS)),
    ).toBe(true); // the boundary itself pairs
  });

  it("outside the radius (a finger drags away) it is not a dbltap", () => {
    const first = tap("drums:1", 1_000, 0, 0);
    const dx = DBLTAP_RADIUS_PX; // exactly on the circle
    expect(isDoubleTap(first, tap("drums:1", 1_100, dx, 0))).toBe(true);
    expect(
      isDoubleTap(first, tap("drums:1", 1_100, dx + 1, 0)),
    ).toBe(false);
  });

  it("a consumed pair resets: the third tap starts a fresh pair", () => {
    // The rail nulls the record after firing — the next two taps must pair
    // again (rename, then rename again later, never a stale triple).
    const first = tap("drums:1", 1_000);
    expect(isDoubleTap(first, tap("drums:1", 1_200))).toBe(true);
    expect(isDoubleTap(null, tap("drums:1", 1_400))).toBe(false); // reset
    expect(isDoubleTap(tap("drums:1", 1_400), tap("drums:1", 1_600))).toBe(
      true,
    );
  });
});
