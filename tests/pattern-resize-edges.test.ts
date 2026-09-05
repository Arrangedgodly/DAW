/**
 * HL-1 (iteration 3, i3-4 edges) unit laws — the RESIZE-TRUNCATION edge table.
 *
 * The store half of the table (the browser half — pointer/keyboard twins,
 * mid-play, basis swap — is tests/browser/pattern-resize-edges.test.ts).
 * The invariant under EVERY row: a refusal NEVER writes the store or the
 * undo history; a commit is always the full ladder step; the blocking note
 * is always deterministic (greatest end, ties by latest start, drums ties
 * by DRUM_PIECES scan order).
 *
 * | # | Edge                                              | Law                     |
 * |---|---------------------------------------------------|-------------------------|
 * | 1 | pitched note END exactly at the new end           | CLEAN shrink proceeds   |
 * | 2 | pitched note end one grid-step past               | REFUSES, blocks         |
 * | 3 | note ANCHORED exactly at the new end              | REFUSES (any length)    |
 * | 4 | note fully past the new end                       | REFUSES, greatest end   |
 * | 5 | note SPANNING the shrink edge                     | REFUSES; wording names  |
 * |   |                                                   | the ANCHOR bar          |
 * | 6 | sustained tail (length > gate) crossing           | REFUSES (extent law,    |
 * |   |                                                   | not the gate)           |
 * | 7 | drums hit at newSteps−1 / at newSteps             | clean / refuses         |
 * | 8 | drums ties: two pieces at the same step           | DRUM_PIECES order wins  |
 * | 9 | multiple candidates past the end                  | greatest end, tie →     |
 * |   |                                                   | latest start (pitched + |
 * |   |                                                   | drums)                  |
 * |10 | wording at every row type                         | exact E10 strings       |
 * |11 | 128→1 with content in bar 1                       | one call, clean         |
 * |12 | 128 with a note at 2047 (bar 128)                 | refuses, `AT BAR 128`   |
 * |13 | grow at the 128 limit                             | no-op (never wraps)     |
 * |14 | refused → moved → shrunk                          | undo lands on the        |
 * |   |                                                   | post-move state; the    |
 * |   |                                                   | refusal wrote NO history|
 * |15 | empty pattern (no notes / all-false rows)         | shrinks cleanly at      |
 * |   |                                                   | every vocabulary size   |
 * |16 | grow keeps an overhanging note byte-identical     | start/length untouched  |
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DRUM_PIECES,
  createDefaultProject,
  type DrumPattern,
  type PitchedPattern,
} from "../src/document/schema";
import {
  addNote,
  canUndo,
  docStore,
  loadDocument,
  removeNote,
  resizePattern,
  undo,
} from "../src/state/store";
import {
  barOfStep,
  resizeRefusalAnnouncement,
} from "../src/state/patternRail";

function doc() {
  return docStore.getState().doc;
}

function historyDepth(): number {
  return docStore.temporal.getState().pastStates.length;
}

/** Load `doc()` with `bass-1`'s notes replaced (test-authored content). */
function withBassNotes(
  notes: readonly { degree: number; start: number; length: number }[],
): void {
  loadDocument({
    ...doc(),
    patterns: {
      ...doc().patterns,
      bass: [
        { ...(doc().patterns.bass[0] as PitchedPattern), notes: [...notes] },
      ],
    },
  });
}

/** Load `doc()` with one drums piece row replaced. */
function withDrumRow(piece: (typeof DRUM_PIECES)[number], steps: boolean[]):
  void {
  const p = doc().patterns.drums[0] as DrumPattern;
  loadDocument({
    ...doc(),
    patterns: {
      ...doc().patterns,
      drums: [{ ...p, steps: { ...p.steps, [piece]: steps } }],
    },
  });
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
  loadDocument(createDefaultProject());
});

// ---------------------------------------------------------------------------
// Rows 1-6: pitched boundary geometry
// ---------------------------------------------------------------------------

describe("HL-1 resize edge table — pitched boundaries", () => {
  it("row 1: a note ENDING exactly at the new end shrinks clean", () => {
    resizePattern("bass", "bass-1", 2); // 32 steps; a 1-bar target = 16
    withBassNotes([{ degree: 0, start: 8, length: 8 }]); // end 16 == 16
    expect(resizePattern("bass", "bass-1", 1)).toEqual({ ok: true, bars: 1 });
    expect((doc().patterns.bass[0] as PitchedPattern).bars).toBe(1);
    expect((doc().patterns.bass[0] as PitchedPattern).notes).toEqual([
      { degree: 0, start: 8, length: 8 },
    ]);
  });

  it("row 2: one grid-step of overhang refuses", () => {
    resizePattern("bass", "bass-1", 2);
    withBassNotes([{ degree: 0, start: 8, length: 8.25 }]); // end 16.25
    const before = doc();
    const res = resizePattern("bass", "bass-1", 1);
    expect(res).toEqual({
      ok: false,
      reason: "blocked",
      toBars: 1,
      blocking: { row: 0, start: 8, length: 8.25 },
    });
    expect(doc()).toBe(before);
  });

  it("row 3: a note ANCHORED exactly at the new end refuses at any length", () => {
    resizePattern("bass", "bass-1", 2);
    withBassNotes([{ degree: 0, start: 16, length: 0.25 }]); // end 16.25
    const res = resizePattern("bass", "bass-1", 1);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      expect(res.blocking.start).toBe(16);
    } else {
      throw new Error("expected a typed refusal");
    }
  });

  it("row 4: a note fully past the new end refuses", () => {
    resizePattern("bass", "bass-1", 2);
    withBassNotes([{ degree: 4, start: 20, length: 4 }]); // entirely in bar 2
    const res = resizePattern("bass", "bass-1", 1);
    expect(res.ok).toBe(false);
  });

  it("row 5: a note SPANNING the shrink edge refuses; the wording names the ANCHOR bar", () => {
    resizePattern("bass", "bass-1", 4); // 64 steps
    // Anchored in bar 3 (step 44), sustains across the 48-step edge into
    // bar 4 (end 54) — spanning, not merely past.
    withBassNotes([{ degree: 0, start: 44, length: 10 }]);
    const res = resizePattern("bass", "bass-1", 3); // 64 → 48 steps
    expect(res).toEqual({
      ok: false,
      reason: "blocked",
      toBars: 3,
      blocking: { row: 0, start: 44, length: 10 },
    });
    // The E10 wording carries the note's identity: its ANCHOR bar (3), not
    // the bar the tail crosses into (4) — deterministic across callers.
    expect(
      resizeRefusalAnnouncement("A", 3, "C", barOfStep(44)),
    ).toBe(
      "CANNOT SHRINK PATTERN A TO 3 BARS · C NOTE AT BAR 3 WOULD BE LOST · MOVE OR SHORTEN IT FIRST",
    );
    expect(barOfStep(44)).toBe(3);
  });

  it("row 6: a sustained tail crossing the boundary refuses even when the GATE portion fits", () => {
    resizePattern("bass", "bass-1", 2); // 32 steps
    // Gate-sized onset lives in bar 1 (step 14 < 16), sustain tail crosses.
    withBassNotes([{ degree: 0, start: 14, length: 4 }]); // end 18
    const res = resizePattern("bass", "bass-1", 1);
    expect(res).toEqual({
      ok: false,
      reason: "blocked",
      toBars: 1,
      blocking: { row: 0, start: 14, length: 4 },
    });
  });
});

// ---------------------------------------------------------------------------
// Rows 7-9: drums boundaries + determinism
// ---------------------------------------------------------------------------

describe("HL-1 resize edge table — drums boundaries + determinism", () => {
  it("row 7: the last in-bounds hit is clean; the first out-of-bounds hit refuses", () => {
    resizePattern("drums", "drums-1", 2); // 32 steps; a 1-bar target = 16
    const clean = new Array<boolean>(32).fill(false);
    clean[15] = true; // newSteps−1: the last step a 1-bar shrink keeps
    withDrumRow("hat", clean);
    expect(resizePattern("drums", "drums-1", 1)).toEqual({ ok: true, bars: 1 });
    // Re-grow (the hit is preserved — content rides the grow law), then the
    // first OUT-of-bounds hit (exactly the 1-bar end) refuses.
    expect(resizePattern("drums", "drums-1", 2).ok).toBe(true);
    const blocked = new Array<boolean>(32).fill(false);
    blocked[16] = true; // exactly the 1-bar end
    withDrumRow("hat", blocked);
    const res = resizePattern("drums", "drums-1", 1);
    expect(res).toEqual({
      ok: false,
      reason: "blocked",
      toBars: 1,
      blocking: { row: "hat", start: 16, length: 1 },
    });
  });

  it("row 8: two pieces at the same step — the DRUM_PIECES scan order names the row (deterministic)", () => {
    resizePattern("drums", "drums-1", 2);
    const p = doc().patterns.drums[0] as DrumPattern;
    const snare = [...p.steps.snare];
    const hat = [...p.steps.hat];
    snare[20] = true;
    hat[20] = true;
    loadDocument({
      ...doc(),
      patterns: {
        ...doc().patterns,
        drums: [{ ...p, steps: { ...p.steps, snare, hat } }],
      },
    });
    const res = resizePattern("drums", "drums-1", 1);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      // Equal end + equal start: the FIRST piece in DRUM_PIECES order wins
      // (the strict > comparisons never replace the incumbent).
      expect(DRUM_PIECES.indexOf("snare")).toBeLessThan(
        DRUM_PIECES.indexOf("hat"),
      );
      expect(res.blocking.row).toBe("snare");
    } else {
      throw new Error("expected a typed refusal");
    }
  });

  it("row 9: many candidates — greatest end blocks; equal ends → latest start (pitched AND drums)", () => {
    // Pitched: end 76 / 74 / 76 — the later-start of the end-76 pair wins.
    resizePattern("bass", "bass-1", 8);
    withBassNotes([
      { degree: 1, start: 70, length: 6 }, // end 76
      { degree: 2, start: 66, length: 8 }, // end 74
      { degree: 3, start: 72, length: 4 }, // end 76 ← latest start
    ]);
    let res = resizePattern("bass", "bass-1", 4);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      expect(res.blocking).toEqual({ row: 3, start: 72, length: 4 });
    } else {
      throw new Error("expected a typed refusal");
    }

    // Drums: hits at steps 70 (end 71) and 100 (end 101) — the later one.
    resizePattern("drums", "drums-1", 8);
    const d = doc().patterns.drums[0] as DrumPattern;
    const kick = [...d.steps.kick];
    const tom = [...d.steps.tom];
    kick[70] = true;
    tom[100] = true;
    loadDocument({
      ...doc(),
      patterns: {
        ...doc().patterns,
        drums: [{ ...d, steps: { ...d.steps, kick, tom } }],
      },
    });
    res = resizePattern("drums", "drums-1", 4);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      expect(res.blocking).toEqual({ row: "tom", start: 100, length: 1 });
    } else {
      throw new Error("expected a typed refusal");
    }
  });
});

// ---------------------------------------------------------------------------
// Row 10: the wording at every row type
// ---------------------------------------------------------------------------

describe("HL-1 resize edge table — refusal wording at each row type", () => {
  it("drums piece rows are the uppercase piece; pitched rows are pitch names (C at degree 0, C′ at degree 7)", () => {
    expect(resizeRefusalAnnouncement("B", 4, "OPENHAT", 5)).toBe(
      "CANNOT SHRINK PATTERN B TO 4 BARS · OPENHAT NOTE AT BAR 5 WOULD BE LOST · MOVE OR SHORTEN IT FIRST",
    );
    const base = createDefaultProject();
    void base;
    // Pitch-name formatting is resizeRowLabel's job (pinned in
    // pattern-resize.test.ts); here the boundary arithmetic that feeds the
    // wording: barOfStep at the vocabulary extremes.
    expect(barOfStep(0)).toBe(1);
    expect(barOfStep(15)).toBe(1);
    expect(barOfStep(16)).toBe(2);
    expect(barOfStep(2047)).toBe(128); // the last anchor bar
    expect(barOfStep(2032)).toBe(128); // first step of bar 128
  });
});

// ---------------------------------------------------------------------------
// Rows 11-13: the vocabulary extremes
// ---------------------------------------------------------------------------

describe("HL-1 resize edge table — 128↔1 extremes", () => {
  it("row 11: 128→1 with all content in bar 1 is ONE clean call", () => {
    expect(resizePattern("bass", "bass-1", 128).ok).toBe(true);
    withBassNotes([{ degree: 0, start: 3, length: 2 }]);
    expect(resizePattern("bass", "bass-1", 1)).toEqual({ ok: true, bars: 1 });
    const p = doc().patterns.bass[0] as PitchedPattern;
    expect(p.bars).toBe(1);
    expect(p.notes).toEqual([{ degree: 0, start: 3, length: 2 }]);
  });

  it("row 12: a note anchored at 2047 (bar 128) refuses with the AT BAR 128 identity", () => {
    expect(resizePattern("bass", "bass-1", 128).ok).toBe(true);
    withBassNotes([{ degree: 0, start: 2047, length: 1 }]);
    const res = resizePattern("bass", "bass-1", 64);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      expect(res.blocking.start).toBe(2047);
      expect(barOfStep(res.blocking.start)).toBe(128);
    } else {
      throw new Error("expected a typed refusal");
    }
  });

  it("row 13: grow at the 128 limit is a typed no-op (never wraps, never throws)", () => {
    expect(resizePattern("drums", "drums-1", 128).ok).toBe(true);
    const before = doc();
    expect(resizePattern("drums", "drums-1", 128)).toEqual({
      ok: false,
      reason: "no-op",
    });
    expect(doc()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Row 14: undo across refused→moved→shrunk sequences
// ---------------------------------------------------------------------------

describe("HL-1 resize edge table — undo across refusals", () => {
  it("a refusal writes NO history; undo after refused→moved→shrunk lands on the post-move state", () => {
    // Setup: 8-bar pattern with a blocking note in bar 5.
    expect(resizePattern("bass", "bass-1", 8).ok).toBe(true);
    expect(addNote("bass", "bass-1", { degree: 0, start: 64, length: 4 })).toBe(
      true,
    );
    const depthBefore = historyDepth();

    // REFUSED shrink: no store write, no history entry.
    expect(resizePattern("bass", "bass-1", 4).ok).toBe(false);
    expect(historyDepth()).toBe(depthBefore);

    // Move the note (remove + re-add in-bounds — the refusal's own advice).
    expect(removeNote("bass", "bass-1", 0, 64)).toBe(true);
    expect(addNote("bass", "bass-1", { degree: 0, start: 10, length: 4 })).toBe(
      true,
    );
    const postMove = doc();

    // The shrink now proceeds; ONE undo returns exactly to post-move.
    expect(resizePattern("bass", "bass-1", 4)).toEqual({ ok: true, bars: 4 });
    undo();
    expect(doc()).toEqual(postMove);
    expect((doc().patterns.bass[0] as PitchedPattern).bars).toBe(8);
    expect((doc().patterns.bass[0] as PitchedPattern).notes).toContainEqual({
      degree: 0,
      start: 10,
      length: 4,
    });
  });

  it("refused-then-GROWN-then-undo: the refusal stays invisible to history", () => {
    expect(resizePattern("bass", "bass-1", 2).ok).toBe(true);
    withBassNotes([{ degree: 0, start: 20, length: 4 }]); // end 24 > 16
    expect(resizePattern("bass", "bass-1", 1).ok).toBe(false);
    expect(resizePattern("bass", "bass-1", 4).ok).toBe(true);
    undo();
    // Back to the 2-bar state with the blocking note intact — the refused
    // attempt in between left no phantom state to undo into.
    expect((doc().patterns.bass[0] as PitchedPattern).bars).toBe(2);
    expect((doc().patterns.bass[0] as PitchedPattern).notes).toEqual([
      { degree: 0, start: 20, length: 4 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rows 15-16: empty patterns + grow byte-identity
// ---------------------------------------------------------------------------

describe("HL-1 resize edge table — empty patterns + grow identity", () => {
  it("row 15: an EMPTY pattern shrinks cleanly at every vocabulary size", () => {
    withBassNotes([]);
    for (const bars of [128, 64, 32, 16, 8, 4, 2] as const) {
      expect(resizePattern("bass", "bass-1", bars)).toEqual({
        ok: true,
        bars,
      });
    }
    expect(resizePattern("bass", "bass-1", 1)).toEqual({ ok: true, bars: 1 });

    // The drums twin: all-false rows at 128 shrink to 1, rows truncated.
    expect(resizePattern("drums", "drums-1", 128).ok).toBe(true);
    expect(resizePattern("drums", "drums-1", 1)).toEqual({ ok: true, bars: 1 });
    const p = doc().patterns.drums[0] as DrumPattern;
    for (const piece of DRUM_PIECES) {
      expect(p.steps[piece]).toHaveLength(16);
      expect(p.steps[piece].every((s) => !s)).toBe(true);
    }
  });

  it("row 16: grow keeps an OVERHANGING note byte-identical (start/length untouched)", () => {
    // Legal per the schema overhang law: start 15 + length 8 in a 1-bar
    // pattern sustains past the pattern end.
    withBassNotes([{ degree: 0, start: 15, length: 8 }]);
    const before = (doc().patterns.bass[0] as PitchedPattern).notes;
    expect(resizePattern("bass", "bass-1", 4).ok).toBe(true);
    expect((doc().patterns.bass[0] as PitchedPattern).notes).toEqual(before);
    // ...and the same note now blocks the shrink back (it spans past 16).
    expect(resizePattern("bass", "bass-1", 1).ok).toBe(false);
  });
});
