/**
 * LL-1 (iteration 3, i3-4) unit laws: the pattern-LENGTH ladder.
 *
 * Covers the store's `resizePattern` (grow/clean-shrink/refuse-by-default,
 * determinism of the blocking note, undo family `resize:<lane>:<pattern>`),
 * the pure patternRail helpers (ladder navigation + the E10 announcement
 * texts, keyboard.md v3 §"Pattern resize"), a spot check of the LP-1
 * bounded step lookup now living in production (the exhaustive equivalence
 * sweep is tests/lp1-perf-spike.test.ts), and the F10 real-bars bucketing
 * through Session.setLaneEvents (tests/session-lane-events.test.ts carries
 * the delivery-side twin).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultProject,
  type DrumPattern,
  type PitchedPattern,
} from "../src/document/schema";
import {
  addNote,
  canUndo,
  docStore,
  loadDocument,
  resizePattern,
  undo,
} from "../src/state/store";
import {
  barOfStep,
  nextPatternLength,
  resizeLimitAnnouncement,
  resizeRefusalAnnouncement,
  resizeRowLabel,
  resizeSuccessAnnouncement,
} from "../src/state/patternRail";
import { secondsPerStep, stepOfTimeBounded } from "../src/audio/time";

function doc() {
  return docStore.getState().doc;
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
  loadDocument(createDefaultProject());
});

// ---------------------------------------------------------------------------
// The ladder + announcement texts (E10 — exact strings)
// ---------------------------------------------------------------------------

describe("length ladder", () => {
  it("walks one vocabulary step in both directions", () => {
    expect(nextPatternLength(1, 1)).toBe(2);
    expect(nextPatternLength(2, 1)).toBe(4);
    expect(nextPatternLength(4, 1)).toBe(8);
    expect(nextPatternLength(8, 1)).toBe(16);
    expect(nextPatternLength(16, 1)).toBe(32);
    expect(nextPatternLength(32, 1)).toBe(64);
    expect(nextPatternLength(64, 1)).toBe(128);
    expect(nextPatternLength(128, -1)).toBe(64);
    expect(nextPatternLength(8, -1)).toBe(4);
    expect(nextPatternLength(2, -1)).toBe(1);
  });

  it("null at both limits (the announcing no-op inputs)", () => {
    expect(nextPatternLength(128, 1)).toBeNull();
    expect(nextPatternLength(1, -1)).toBeNull();
  });

  it("E10 texts: success, limit (pluralized at 1), refusal", () => {
    expect(resizeSuccessAnnouncement("B", 8)).toBe("PATTERN B · 8 BARS");
    expect(resizeSuccessAnnouncement("B", 1)).toBe("PATTERN B · 1 BAR");
    expect(resizeLimitAnnouncement("B", 128)).toBe(
      "PATTERN B · 128 BARS · AT LIMIT",
    );
    expect(resizeLimitAnnouncement("B", 1)).toBe("PATTERN B · 1 BAR · AT LIMIT");
    expect(
      resizeRefusalAnnouncement("B", 4, "SNARE", 5),
    ).toBe(
      "CANNOT SHRINK PATTERN B TO 4 BARS · SNARE NOTE AT BAR 5 WOULD BE LOST · MOVE OR SHORTEN IT FIRST",
    );
    expect(resizeRefusalAnnouncement("A", 2, "C′", 1)).toBe(
      "CANNOT SHRINK PATTERN A TO 2 BARS · C′ NOTE AT BAR 1 WOULD BE LOST · MOVE OR SHORTEN IT FIRST",
    );
  });

  it("row labels: drum pieces uppercase; pitched rows as the grid's pitch names", () => {
    const base = createDefaultProject();
    expect(resizeRowLabel(base, "drums", 2)).toBe("HAT");
    // Default project = C minor: degree 0 → C, degree 7 → C′ (one octave up).
    expect(resizeRowLabel(base, "bass", 0)).toBe("C");
    expect(resizeRowLabel(base, "bass", 7)).toBe("C′");
  });

  it("barOfStep is 1-based over 16-step bars", () => {
    expect(barOfStep(0)).toBe(1);
    expect(barOfStep(15)).toBe(1);
    expect(barOfStep(16)).toBe(2);
    expect(barOfStep(64)).toBe(5);
    expect(barOfStep(2047)).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Store: resizePattern — grow / clean shrink / refusal / undo
// ---------------------------------------------------------------------------

describe("resizePattern (store)", () => {
  it("grows a drums pattern: bars + every piece row extended with empty steps", () => {
    const res = resizePattern("drums", "drums-1", 8);
    expect(res).toEqual({ ok: true, bars: 8 });
    const p = doc().patterns.drums[0] as DrumPattern;
    expect(p.bars).toBe(8);
    for (const piece of ["kick", "snare", "hat", "openhat", "clap", "tom"]) {
      expect(p.steps[piece as keyof typeof p.steps].length).toBe(128);
    }
  });

  it("grows a pitched pattern without touching notes", () => {
    expect(addNote("bass", "bass-1", { degree: 0, start: 3, length: 2 })).toBe(
      true,
    );
    const before = (doc().patterns.bass[0] as PitchedPattern).notes;
    const res = resizePattern("bass", "bass-1", 16);
    expect(res.ok).toBe(true);
    const p = doc().patterns.bass[0] as PitchedPattern;
    expect(p.bars).toBe(16);
    expect(p.notes).toEqual(before); // byte-identical content
  });

  it("clean shrink proceeds: drums rows truncated, pitched notes untouched", () => {
    resizePattern("drums", "drums-1", 4);
    resizePattern("bass", "bass-1", 4);
    addNote("bass", "bass-1", { degree: 0, start: 3, length: 2 });
    const notesBefore = (doc().patterns.bass[0] as PitchedPattern).notes;
    expect(resizePattern("drums", "drums-1", 1).ok).toBe(true);
    expect(resizePattern("bass", "bass-1", 1).ok).toBe(true);
    const drums = doc().patterns.drums[0] as DrumPattern;
    expect(drums.bars).toBe(1);
    expect(drums.steps.kick.length).toBe(16);
    expect((doc().patterns.bass[0] as PitchedPattern).notes).toEqual(
      notesBefore,
    );
  });

  it("REFUSES a shrink that would lose a drum hit past the new end (store untouched)", () => {
    resizePattern("drums", "drums-1", 8); // 128 steps
    const p = doc().patterns.drums[0] as DrumPattern;
    const hat = [...p.steps.hat];
    hat[100] = true; // bar 7 — past a 4-bar end
    loadDocument({
      ...doc(),
      patterns: {
        ...doc().patterns,
        drums: [{ ...p, steps: { ...p.steps, hat } }],
      },
    });
    const before = doc();
    const res = resizePattern("drums", "drums-1", 4);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      expect(res.toBars).toBe(4);
      expect(res.blocking.row).toBe("hat");
      expect(res.blocking.start).toBe(100);
      expect(res.blocking.length).toBe(1);
    } else {
      throw new Error("expected a typed refusal");
    }
    expect(doc()).toBe(before); // no commit, no history
  });

  it("REFUSES a shrink that would cut any pitched note extent; blocking note is deterministic (greatest end, ties → latest start)", () => {
    resizePattern("bass", "bass-1", 8); // 128 steps
    // Three candidates past a 4-bar (64-step) end: the note with the
    // GREATEST END blocks (length 8 beats length 6 at a later start; the
    // equal-end tie resolves to the latest start).
    addNote("bass", "bass-1", { degree: 1, start: 70, length: 6 }); // end 76
    addNote("bass", "bass-1", { degree: 2, start: 66, length: 8 }); // end 74
    addNote("bass", "bass-1", { degree: 3, start: 70, length: 8 }); // end 78 ← blocks
    const before = doc();
    const res = resizePattern("bass", "bass-1", 4);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === "blocked") {
      expect(res.blocking.row).toBe(3);
      expect(res.blocking.start).toBe(70);
      expect(res.blocking.length).toBe(8);
    } else {
      throw new Error("expected a typed refusal");
    }
    expect(doc()).toBe(before);
  });

  it("a tail crossing the new end also refuses (no silent truncation — shorten it first)", () => {
    resizePattern("bass", "bass-1", 2); // 32 steps
    addNote("bass", "bass-1", { degree: 0, start: 14, length: 4 }); // end 18 > 16
    const res = resizePattern("bass", "bass-1", 1);
    expect(res.ok).toBe(false);
    // Shorten it (end 16 ≤ 16) → the shrink proceeds.
    loadDocument({
      ...doc(),
      patterns: {
        ...doc().patterns,
        bass: [
          {
            ...(doc().patterns.bass[0] as PitchedPattern),
            notes: [{ degree: 0, start: 14, length: 2 }],
          },
        ],
      },
    });
    expect(resizePattern("bass", "bass-1", 1).ok).toBe(true);
  });

  it("no-op and not-found are typed, silent non-commits", () => {
    expect(resizePattern("drums", "drums-1", 1)).toEqual({
      ok: false,
      reason: "no-op",
    });
    expect(resizePattern("drums", "drums-99", 2)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("undo: ONE step reverts a resize (bars + drum rows); rapid ladder repeats coalesce per family", () => {
    expect(resizePattern("drums", "drums-1", 2).ok).toBe(true);
    expect(resizePattern("drums", "drums-1", 4).ok).toBe(true);
    const after = doc();
    undo();
    const reverted = doc().patterns.drums[0] as DrumPattern;
    // The coalescing family glues the rapid 1→2→4 burst into ONE gesture
    // (the KL-1 note-resize discrete-commit precedent).
    expect(reverted.bars).toBe(1);
    expect(reverted.steps.kick.length).toBe(16);
    expect(doc()).not.toBe(after);
  });

  it("reaches the full vocabulary: 1 → 128 → 1", () => {
    let bars: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 = 1;
    for (let i = 0; i < 7; i++) {
      const next = nextPatternLength(bars, 1)!;
      expect(resizePattern("drums", "drums-1", next).ok).toBe(true);
      bars = next;
    }
    expect((doc().patterns.drums[0] as DrumPattern).bars).toBe(128);
    expect((doc().patterns.drums[0] as DrumPattern).steps.tom.length).toBe(
      2048,
    );
  });
});

// ---------------------------------------------------------------------------
// The bounded step lookup in production (LP-1 §10b spot check — the
// exhaustive sweep is the LP-1 node harness)
// ---------------------------------------------------------------------------

describe("stepOfTimeBounded (production port spot check)", () => {
  it("matches the scan semantics at boundaries, mid-steps and swing extremes", () => {
    const groove = { bpm: 120, swing: 0.5 };
    const steps = 2048;
    const spb = secondsPerStep(120);
    const scan = (t: number): number => {
      for (let i = 0; i < steps - 1; i++) {
        const t0 = (i + (i % 2 === 1 ? 0.5 : 0)) * spb;
        const t1 = (i + 1 + ((i + 1) % 2 === 1 ? 0.5 : 0)) * spb;
        if (t >= t0 && t < t1) return i;
      }
      return steps - 1;
    };
    for (const step of [0, 1, 2, 63, 512, 1000, 2046, 2047]) {
      const t = (step + (step % 2 === 1 ? 0.5 : 0)) * spb;
      expect(stepOfTimeBounded(t, groove, steps)).toBe(scan(t));
      expect(stepOfTimeBounded(t + spb * 0.4, groove, steps)).toBe(
        scan(t + spb * 0.4),
      );
    }
    // The last step owns [t(2047), loop end) — the scan's fallback.
    expect(stepOfTimeBounded(steps * spb - 1e-9, groove, steps)).toBe(2047);
    // Degenerate tiny patterns keep the scan's fallbacks.
    expect(stepOfTimeBounded(0, groove, 1)).toBe(0);
  });
});
