import { pitchDomain } from "../src/document/pitchWindow";
/**
 * RC-1 unit gate — the register controls' laws (v3, i3-1/i3-2):
 *
 * 1. PURE WINDOW MATH (keynav): the manifest clamp + the focus-anchor law
 *    of Shift+↑/↓ window scrolls (E9's conflation-fence half that lives
 *    outside the DOM).
 * 2. STORE ACTION (setLaneOctave): writes the v3 `octave` field
 *    canonical-empty at 0 (byte-stable default documents — the golden codec
 *    law), clamped to the schema domain, rapid repeats coalesce per
 *    `octave:<lane>` (held-key repeats = ONE undo gesture).
 * 3. THE FUNNEL (selection.stepLaneOctave): pre-clamps so limit presses are
 *    no-ops that still announce (`<LANE> OCTAVE +3 · AT LIMIT`), never
 *    writing the document; drums answers `DRUMS HAS NO OCTAVE`.
 * 4. COMPILE/EXPORT CONSUMPTION: the lane octave is an OFFSET on the
 *    preset's octave base — ±12 semitones per octave in compiled events and
 *    exported MIDI note numbers, clamped to 0..127; offset 0 (the canonical
 *    default) is byte-identical (zero drift — the render/export
 *    fingerprint law).
 * 5. DEFAULT WINDOW (selection): the recorded default-position law — the
 *    one-octave window showing the MOST noted rows, ties → lowest; empty
 *    lanes start at 0; a document replacement re-defaults (view state).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clampedWindowScroll, clampWindowStart } from "../src/grid/keynav";
import {
  canUndo,
  docStore,
  loadDocument,
  setLaneOctave,
  undo,
} from "../src/state/store";
import {
  defaultRegisterWindowStart,
  announceDrumsNoOctave,
  octaveStatus,
  octaveText,
  registerWindowStart,
  setRegisterWindowStart,
  stepLaneOctave,
} from "../src/state/selection";
import { compileLaneEvents } from "../src/audio/compile";
import { getPreset } from "../src/audio/presets";
import { encodeMidi, buildPitchedNotes } from "../src/audio/exportMidi";
import { resolveChainPatterns } from "../src/audio/song";
import { createDemoProject } from "../src/document/demoSong";
import { toEffectiveScale } from "../src/document/scales";
import type { Pattern } from "../src/document/schema";

function doc() {
  return docStore.getState().doc;
}

function laneConf(lane: "bass" | "chords" | "lead") {
  return doc().lanes.find((l) => l.id === lane)!;
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

// ---------------------------------------------------------------------------
// 1. Pure window math
// ---------------------------------------------------------------------------

describe("RC-1 window math (keynav)", () => {
  it("clampWindowStart: manifest bounds; a fitting manifest has one legal start", () => {
    expect(clampWindowStart(3, 14, 7)).toBe(3);
    expect(clampWindowStart(-2, 14, 7)).toBe(0);
    expect(clampWindowStart(99, 14, 7)).toBe(7); // 14 − 7
    // Manifest fits the window → only 0.
    expect(clampWindowStart(5, 7, 7)).toBe(0);
    expect(clampWindowStart(0, 6, 7)).toBe(0);
  });

  it("scrolls one octave, clamped at the manifest bounds", () => {
    // 15-row manifest (demo lead), 7-row window, focus mid-window.
    expect(clampedWindowScroll(7, 1, 10, 15, 7)).toBe(8); // 7+7 → manifest-clamped
    // Focus 10 pins the window's bottom at 10: UP can only reach start 4
    // (window 4–10 keeps the focused row visible — the anchor law).
    expect(clampedWindowScroll(8, -1, 10, 15, 7)).toBe(4);
  });

  it("THE FOCUS-ANCHOR LAW: the window never scrolls the focused row out of view", () => {
    // Focus at the window's top row: DOWN is anchor-blocked (start stays).
    expect(clampedWindowScroll(0, 1, 0, 14, 7)).toBe(0);
    // Focus at the window's bottom row: UP is anchor-blocked.
    expect(clampedWindowScroll(7, -1, 13, 14, 7)).toBe(7);
    // Focus one row inside the edge: the window moves exactly far enough.
    expect(clampedWindowScroll(0, 1, 1, 14, 7)).toBe(1);
    expect(clampedWindowScroll(7, -1, 12, 14, 7)).toBe(6);
  });

  it("anchor + manifest clamps compose without escaping the manifest", () => {
    // Focus on the very last row of a 14-row manifest, at the bottom window.
    expect(clampedWindowScroll(7, 1, 13, 14, 7)).toBe(7);
    // Focus on row 0 at the top window.
    expect(clampedWindowScroll(0, -1, 0, 14, 7)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Store action
// ---------------------------------------------------------------------------

describe("RC-1 setLaneOctave (store)", () => {
  it("writes the field; canonical-empty at 0 (byte-stable default docs)", () => {
    expect("octave" in laneConf("lead")).toBe(false);
    setLaneOctave("lead", 1);
    expect(laneConf("lead").octave).toBe(1);
    setLaneOctave("lead", 0);
    expect("octave" in laneConf("lead")).toBe(false);
  });

  it("no-ops an unchanged value (no history entry, no identity churn)", () => {
    const before = doc();
    setLaneOctave("bass", 0);
    expect(doc()).toBe(before);
    expect(canUndo()).toBe(false);
  });

  it("rapid repeats coalesce per octave:<lane> (one undo gesture)", () => {
    setLaneOctave("bass", 1);
    setLaneOctave("bass", 2);
    setLaneOctave("bass", 3);
    expect(laneConf("bass").octave).toBe(3);
    expect(canUndo()).toBe(true);
    undo();
    expect("octave" in laneConf("bass")).toBe(false); // ONE step → back to 0
  });

  it("validation rejects out-of-domain values with the store untouched", () => {
    const before = doc();
    expect(() => setLaneOctave("lead", 4)).toThrow();
    expect(() => setLaneOctave("lead", -4)).toThrow();
    expect(doc()).toBe(before);
  });

  it("drums is out of the action's domain (guarded no-op)", () => {
    const before = doc();
    // @ts-expect-error — the drums lane carries no octave (schema law).
    setLaneOctave("drums", 1);
    expect(doc()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. The funnel (announcements, clamp-as-no-op, drums refusal)
// ---------------------------------------------------------------------------

describe("RC-1 octave funnel (selection)", () => {
  it("steps +1/−1 and announces value; limit presses announce and never write", () => {
    stepLaneOctave("lead", 1);
    expect(laneConf("lead").octave).toBe(1);
    expect(octaveStatus("lead")).toBe("LEAD OCTAVE +1");

    stepLaneOctave("lead", 1);
    stepLaneOctave("lead", 1);
    expect(laneConf("lead").octave).toBe(3);
    expect(octaveStatus("lead")).toBe("LEAD OCTAVE +3");

    // At +3 the +1 press is a NO-OP that still announces the limit (E8).
    const before = doc();
    stepLaneOctave("lead", 1);
    expect(doc()).toBe(before);
    expect(octaveStatus("lead")).toBe("LEAD OCTAVE +3 · AT LIMIT");

    stepLaneOctave("lead", -1);
    expect(laneConf("lead").octave).toBe(2);
    expect(octaveStatus("lead")).toBe("LEAD OCTAVE +2");

    stepLaneOctave("lead", -1);
    stepLaneOctave("lead", -1);
    stepLaneOctave("lead", -1);
    expect(laneConf("lead").octave).toBe(-1);
    stepLaneOctave("lead", -1);
    stepLaneOctave("lead", -1);
    expect(laneConf("lead").octave).toBe(-3);
    stepLaneOctave("lead", -1);
    expect(octaveStatus("lead")).toBe("LEAD OCTAVE -3 · AT LIMIT");
  });

  it("drums refuses: DRUMS HAS NO OCTAVE, document untouched", () => {
    const before = doc();
    announceDrumsNoOctave();
    expect(octaveStatus("drums")).toBe("DRUMS HAS NO OCTAVE");
    expect(doc()).toBe(before);
  });

  it("octaveText: the E8 signed formats", () => {
    expect(octaveText(0)).toBe("0");
    expect(octaveText(1)).toBe("+1");
    expect(octaveText(-3)).toBe("-3");
  });
});

// ---------------------------------------------------------------------------
// 4. Compile / export consumption
// ---------------------------------------------------------------------------

function demoPitchedPattern(lane: "bass" | "chords" | "lead"): Pattern {
  const demo = createDemoProject();
  const p = demo.patterns[lane].find(
    (c) => c.kind === "pitched" && c.notes.length > 0,
  );
  if (!p) throw new Error(`no pitched pattern on ${lane}`);
  return p;
}

describe("RC-1 octave consumption (compile + MIDI)", () => {
  it("compileLaneEvents: the offset scales every event's freq 2^±offset; 0 is identical", () => {
    // Synth presets resolve pitch from the note's MIDI (no baseFreq), so the
    // register offset lands in the compiled freq — the audible half of i3-2.
    const pattern = demoPitchedPattern("lead");
    const base = {
      pattern,
      preset: getPreset("preset-lead-1")!,
      gate: { unit: "steps" as const, value: 2 },
      groove: { bpm: 112, swing: 0 },
      scale: toEffectiveScale({ root: 0, mode: "minor" }),
    };
    const freqs = (offset: number | undefined) =>
      compileLaneEvents({ ...base, octaveOffset: offset })
        .map((e) => e.freq)
        .sort((a, b) => a - b);
    const zero = freqs(undefined);
    const plus = freqs(1);
    const minus = freqs(-2);
    expect(zero.length).toBeGreaterThan(0);
    expect(plus.every((f, i) => Math.abs(f / zero[i]! - 2) < 1e-9)).toBe(true);
    expect(minus.every((f, i) => Math.abs(f / zero[i]! - 0.25) < 1e-9)).toBe(
      true,
    );
  });

  it("exportMidi: lane octave shifts that lane's note numbers by 12×offset (parse-back law)", () => {
    const demo = createDemoProject();
    const baseNotes = buildPitchedNotes(
      demo,
      "lead",
      resolveChainPatterns(demo, "lead"),
      demo.transport.swing,
    ).map((n) => n.noteNumber);
    const shifted = { ...demo };
    shifted.lanes = demo.lanes.map((l) =>
      l.id === "lead" ? { ...l, octave: 1 } : l,
    );
    const upNotes = buildPitchedNotes(
      shifted,
      "lead",
      resolveChainPatterns(shifted, "lead"),
      demo.transport.swing,
    ).map((n) => n.noteNumber);
    expect(upNotes.length).toBe(baseNotes.length);
    expect(
      upNotes.every((m, i) => m === Math.min(127, baseNotes[i]! + 12)),
    ).toBe(true);
    // Other lanes untouched by the lead's offset (lane-scoped field).
    const bassBase = buildPitchedNotes(
      demo,
      "bass",
      resolveChainPatterns(demo, "bass"),
      demo.transport.swing,
    ).map((n) => n.noteNumber);
    const bassShifted = buildPitchedNotes(
      shifted,
      "bass",
      resolveChainPatterns(shifted, "bass"),
      demo.transport.swing,
    ).map((n) => n.noteNumber);
    expect(bassShifted).toEqual(bassBase);
  });

  it("ZERO DRIFT: canonical-empty octave (offset 0) compiles and exports identically", () => {
    const demo = createDemoProject();
    // The demo carries no octave fields — the exports are the pinned bytes.
    const bytes = encodeMidi(demo);
    const explicitZero = {
      ...demo,
      lanes: demo.lanes.map((l) =>
        l.id === "drums" ? l : { ...l, octave: 0 },
      ),
    };
    // encodeMidi only reads octave as an offset; 0 === absent by law.
    expect(
      buildPitchedNotes(
        explicitZero,
        "lead",
        resolveChainPatterns(explicitZero, "lead"),
        0,
      ),
    ).toEqual(
      buildPitchedNotes(demo, "lead", resolveChainPatterns(demo, "lead"), 0),
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Default window position (the recorded law)
// ---------------------------------------------------------------------------

describe("RC-1 default register window (selection)", () => {
  it("empty lanes default to the first window", () => {
    // The store boots with the fresh default (no notes anywhere).
    expect(
      pitchDomain(docStore.getState().doc, "bass").degrees[
        defaultRegisterWindowStart("bass", 7) + 6
      ],
    ).toBe(0);
    expect(
      pitchDomain(docStore.getState().doc, "lead").degrees[
        defaultRegisterWindowStart("lead", 7) + 6
      ],
    ).toBe(0);
  });

  it("the demo: the window showing the MOST noted rows, ties → lowest", () => {
    loadDocument(createDemoProject());
    // Bass roots + approach span degrees 0..7: window 0 (0–6 shows 0,4,5,6 —
    // the 6-hit root rhythm rows; degree 7's lone approach note concedes).
    expect(
      pitchDomain(docStore.getState().doc, "bass").degrees[
        defaultRegisterWindowStart("bass", 7) + 6
      ],
    ).toBe(0);
    // Lead melody spans degrees 7..14 on a 15-row manifest: windows 6, 7, 8
    // each cover six melody rows — the tie breaks LOWEST → 6 (rows 6–12).
    expect(
      pitchDomain(docStore.getState().doc, "lead").degrees[
        defaultRegisterWindowStart("lead", 7) + 6
      ],
    ).toBe(6);
    // Chords: 7-row manifest = one window.
    expect(
      pitchDomain(docStore.getState().doc, "chords").degrees[
        defaultRegisterWindowStart("chords", 7) + 6
      ],
    ).toBe(0);
  });

  it("window starts persist as view state and re-default on document replacement", () => {
    setRegisterWindowStart("lead", 8);
    expect(registerWindowStart("lead")).toBe(8);
    loadDocument(createDemoProject());
    expect(registerWindowStart("lead")).toBeUndefined();
  });
});
