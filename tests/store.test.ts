/**
 * DES-4/IM-6 store tests: document toggle actions + zundo undo/redo (limit 50)
 * with rapid-edit coalescing (same family within 350 ms → one undo step).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUndo,
  docStore,
  redo,
  setProjectName,
  toggleDrumStep,
  togglePitchedCell,
  undo,
} from "../src/state/store";
import {
  PROJECT_NAME_MAX_CHARS,
  normalizeProjectName,
} from "../src/state/projectName";
import { pitchedCellAt, resolveGateSteps } from "../src/document/schema";

function doc() {
  return docStore.getState().doc;
}

beforeEach(() => {
  // Rewind history to the initial state before each test.
  // Rewind to the initial document, then drop all history (redo would
  // otherwise re-apply the previous test's edits and refill `past`).
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("doc store toggles", () => {
  it("drums: toggles a step off→on→off", () => {
    expect(doc().patterns.drums[0].kind).toBe("drums");
    const on = doc().patterns.drums[0].steps.kick[0];
    expect(on).toBe(false);

    const first = toggleDrumStep("kick", 0);
    expect(first.turnedOn).toBe(true);
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(true);
    // Sibling steps and pieces untouched.
    expect(doc().patterns.drums[0].steps.kick[1]).toBe(false);
    expect(doc().patterns.drums[0].steps.snare[0]).toBe(false);

    const second = toggleDrumStep("kick", 0);
    expect(second.turnedOn).toBe(false);
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(false);
  });

  it("pitched: cycles 0→1→0 and reports audition on placement only", () => {
    const before = doc().patterns.bass[0];
    expect(before.kind).toBe("pitched");

    const on = togglePitchedCell("bass", 3, 5);
    expect(on.turnedOn).toBe(true);
    const pattern = doc().patterns.bass[0];
    expect(pattern.kind).toBe("pitched");
    if (pattern.kind !== "pitched") return;
    // v2 (SC-1): a single click places a note of the lane-gate default
    // length (bass default gate = 2 steps) — "1" in the v1 cell view.
    const gateSteps = resolveGateSteps(
      doc().lanes.find((l) => l.id === "bass")!.gate,
      doc().transport.bpm,
    );
    expect(pitchedCellAt(pattern, gateSteps, 3, 5)).toBe(1);
    expect(pattern.notes).toContainEqual({
      degree: 3,
      start: 5,
      length: gateSteps,
    });

    const off = togglePitchedCell("bass", 3, 5);
    expect(off.turnedOn).toBe(false);
    const after = doc().patterns.bass[0];
    expect(after.kind).toBe("pitched");
    if (after.kind !== "pitched") return;
    expect(pitchedCellAt(after, gateSteps, 3, 5)).toBe(0);
    expect(after.notes).toEqual([]);
  });

  it("pitched rows cover two octaves (grid expansion)", () => {
    const pattern = doc().patterns.bass[0];
    expect(pattern.kind).toBe("pitched");
    if (pattern.kind !== "pitched") return;
    expect(pattern.rowDegrees).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    const chords = doc().patterns.chords[0];
    expect(chords.kind).toBe("pitched");
    if (chords.kind === "pitched") {
      expect(chords.rowDegrees).toHaveLength(7);
    }
  });

  it("document stays schema-valid after edits", async () => {
    toggleDrumStep("hat", 7);
    togglePitchedCell("lead", 13, 15);
    const { validateProject } = await import("../src/document/validate");
    expect(() => validateProject(doc())).not.toThrow();
  });
});

describe("undo/redo", () => {
  it("undoes and redoes toggle edits (spaced gestures)", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    toggleDrumStep("kick", 0);
    vi.advanceTimersByTime(400); // outside the coalescing window
    toggleDrumStep("kick", 0); // net-zero edit pair
    vi.advanceTimersByTime(400);
    toggleDrumStep("snare", 4);
    expect(doc().patterns.drums[0].steps.snare[4]).toBe(true);

    undo();
    expect(doc().patterns.drums[0].steps.snare[4]).toBe(false);

    redo();
    expect(doc().patterns.drums[0].steps.snare[4]).toBe(true);

    undo();
    undo(); // kick 0 second toggle
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(true);
  });

  it("rapid toggles coalesce into one undo step", () => {
    toggleDrumStep("kick", 0);
    toggleDrumStep("hat", 3); // same family, within 350 ms
    togglePitchedCell("bass", 2, 1);
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(true);
    expect(doc().patterns.drums[0].steps.hat[3]).toBe(true);

    undo(); // one step reverts the whole gesture
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(false);
    expect(doc().patterns.drums[0].steps.hat[3]).toBe(false);
    const bass = doc().patterns.bass[0];
    if (bass.kind === "pitched") {
      expect(bass.notes.some((n) => n.degree === 2 && n.start === 1)).toBe(
        false,
      );
    }
    expect(canUndo()).toBe(false);
  });

  it("history depth is limited to 50 snapshots", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    for (let i = 0; i < 60; i++) {
      toggleDrumStep("hat", i % 16);
      vi.advanceTimersByTime(400); // every toggle is its own gesture
    }
    let depth = 0;
    while (canUndo()) {
      undo();
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(50);
    // Oldest surviving edit is not step 0's state.
    expect(doc().patterns.drums[0].steps.hat[0]).toBe(true);
  });
});

describe("project name normalizer (i6 §2.1)", () => {
  it("trims ends and collapses internal whitespace runs to one space", () => {
    expect(normalizeProjectName("  My   Song  ")).toBe("My Song");
    expect(normalizeProjectName("\ttabs\tand\nnewlines\r\n")).toBe(
      "tabs and newlines",
    );
  });

  it("empty (or whitespace-only) input → undefined — the no-op signal", () => {
    expect(normalizeProjectName("")).toBeUndefined();
    expect(normalizeProjectName("   ")).toBeUndefined();
    expect(normalizeProjectName("\t\n \r")).toBeUndefined();
  });

  it("clamps to 48 CODE POINTS (never splits a surrogate pair)", () => {
    const exactly = "a".repeat(PROJECT_NAME_MAX_CHARS);
    expect(normalizeProjectName(exactly)).toBe(exactly);
    expect(normalizeProjectName(exactly + "overflow")).toBe(exactly);

    // Emoji are 2 UTF-16 units each: 49 emoji → exactly 48, all whole.
    const emoji = "🎵".repeat(49);
    const clamped = normalizeProjectName(emoji);
    expect([...clamped!]).toHaveLength(PROJECT_NAME_MAX_CHARS);
    expect(clamped).toBe("🎵".repeat(PROJECT_NAME_MAX_CHARS));

    // Mixed cut point: 47 ASCII + one 2-unit emoji + trailing text — the
    // 48th code point is the WHOLE emoji, and nothing after survives.
    const mixed = normalizeProjectName("a".repeat(47) + "🎵udio");
    expect(mixed).toBe("a".repeat(47) + "🎵");

    // No lone surrogates anywhere in any clamped result (UTF-8 safety).
    for (const cp of [...clamped!, ...mixed!]) {
      expect(/^[\uD800-\uDFFF]$/.test(cp)).toBe(false);
    }
  });

  it("clamps AFTER normalizing, so trimmed-away padding never eats the budget", () => {
    const fortySeven = "b".repeat(47);
    expect(normalizeProjectName(`  ${fortySeven}x  extra`)).toBe(
      fortySeven + "x",
    );
  });

  it("returns non-empty names unchanged (duplicates carry no special handling)", () => {
    expect(normalizeProjectName("Untitled")).toBe("Untitled");
    expect(normalizeProjectName("dup")).toBe("dup"); // uniqueness is not this layer's law
  });
});

describe("setProjectName (rename CURRENT project, i6 §2.3)", () => {
  it("commits the normalized name (trim + collapse applied before compare)", () => {
    setProjectName("  Night   Drive  ");
    expect(doc().name).toBe("Night Drive");
    undo();
    expect(doc().name).toBe("Untitled");
  });

  it("one rename = ONE commit, NO coalescing: two renames in the same tick are two history entries", () => {
    setProjectName("first");
    setProjectName("second"); // same tick, still a separate undo step
    expect(doc().name).toBe("second");

    undo();
    expect(doc().name).toBe("first"); // back one rename, not two
    undo();
    expect(doc().name).toBe("Untitled");
    expect(canUndo()).toBe(false);
    redo();
    expect(doc().name).toBe("first");
  });

  it("empty-after-trim input is a NO-OP: no write, no history entry", () => {
    setProjectName("real name");
    setProjectName("   ");
    setProjectName("");
    setProjectName("\t\n");
    expect(doc().name).toBe("real name");
    undo(); // exactly ONE real rename in history
    expect(doc().name).toBe("Untitled");
    expect(canUndo()).toBe(false);
  });

  it("unchanged (normalized-equal) name is a NO-OP: no write, no history entry", () => {
    const before = doc().name;
    setProjectName(before);
    setProjectName(`  ${before}  `); // collapses back to the same name
    expect(doc().name).toBe(before);
    expect(canUndo()).toBe(false);
  });

  it("composes with grid edits in one history timeline (undo order preserved)", () => {
    toggleDrumStep("kick", 0);
    setProjectName("named it");
    toggleDrumStep("snare", 2);

    undo(); // snare
    expect(doc().patterns.drums[0].steps.snare[2]).toBe(false);
    expect(doc().name).toBe("named it");
    undo(); // the rename
    expect(doc().name).toBe("Untitled");
    undo(); // the kick
    expect(doc().patterns.drums[0].steps.kick[0]).toBe(false);
  });
});
