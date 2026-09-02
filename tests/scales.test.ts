import { describe, expect, it } from "vitest";
import { createDefaultProject, type ProjectDocument } from "../src/document/schema";
import {
  MODE_INTERVALS,
  MODE_NAMES,
  chordRows,
  degreeToMidi,
  effectiveScale,
  isModeName,
  modeSize,
} from "../src/document/scales";

describe("mode definitions", () => {
  it("every mode starts at 0 and rises within an octave", () => {
    for (const name of MODE_NAMES) {
      const iv = MODE_INTERVALS[name];
      expect(iv[0]).toBe(0);
      for (let i = 1; i < iv.length; i++) {
        expect(iv[i]).toBeGreaterThan(iv[i - 1]);
        expect(iv[i]).toBeLessThanOrEqual(11);
      }
    }
  });

  it("heptatonic modes have 7 notes, pentatonic 5", () => {
    expect(modeSize("major")).toBe(7);
    expect(modeSize("minor")).toBe(7);
    expect(modeSize("dorian")).toBe(7);
    expect(modeSize("phrygian")).toBe(7);
    expect(modeSize("lydian")).toBe(7);
    expect(modeSize("mixolydian")).toBe(7);
    expect(modeSize("harmonicMinor")).toBe(7);
    expect(modeSize("pentatonicMinor")).toBe(5);
    expect(modeSize("pentatonicMajor")).toBe(5);
  });

  it("recognizes and rejects mode names", () => {
    expect(isModeName("major")).toBe(true);
    expect(isModeName("harmonicMinor")).toBe(true);
    expect(isModeName("ionian")).toBe(false);
    expect(isModeName("")).toBe(false);
  });

  it("spells the reference modes correctly (C root)", () => {
    expect(MODE_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(MODE_INTERVALS.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(MODE_INTERVALS.phrygian).toEqual([0, 1, 3, 5, 7, 8, 10]);
    expect(MODE_INTERVALS.lydian).toEqual([0, 2, 4, 6, 7, 9, 11]);
    expect(MODE_INTERVALS.mixolydian).toEqual([0, 2, 4, 5, 7, 9, 10]);
    expect(MODE_INTERVALS.harmonicMinor).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(MODE_INTERVALS.pentatonicMinor).toEqual([0, 3, 5, 7, 10]);
    expect(MODE_INTERVALS.pentatonicMajor).toEqual([0, 2, 4, 7, 9]);
  });
});

describe("degreeToMidi", () => {
  const cMajor = { root: 0, mode: "major" as const, intervals: MODE_INTERVALS.major };

  it("maps C major degrees in octave 4 to the white keys", () => {
    expect(degreeToMidi(cMajor, 0, 4)).toBe(60); // C4
    expect(degreeToMidi(cMajor, 1, 4)).toBe(62); // D4
    expect(degreeToMidi(cMajor, 6, 4)).toBe(71); // B4
  });

  it("wraps degrees past the mode into higher octaves", () => {
    expect(degreeToMidi(cMajor, 7, 4)).toBe(72); // C5
    expect(degreeToMidi(cMajor, 8, 4)).toBe(74); // D5
    expect(degreeToMidi(cMajor, 14, 4)).toBe(84); // C6
  });

  it("transposes by root and octave base", () => {
    const aMinor = { root: 9, mode: "minor" as const, intervals: MODE_INTERVALS.minor };
    expect(degreeToMidi(aMinor, 0, 3)).toBe(57); // A3
    expect(degreeToMidi(aMinor, 2, 3)).toBe(60); // C4
    expect(degreeToMidi(aMinor, 0, 4)).toBe(69); // A4
  });

  it("pentatonic modes wrap with 5-note octaves", () => {
    const penta = { root: 0, mode: "pentatonicMinor" as const, intervals: MODE_INTERVALS.pentatonicMinor };
    expect(degreeToMidi(penta, 0, 4)).toBe(60); // C
    expect(degreeToMidi(penta, 1, 4)).toBe(63); // Eb
    expect(degreeToMidi(penta, 5, 4)).toBe(72); // C + octave
  });
});

describe("effectiveScale", () => {
  const base: ProjectDocument = JSON.parse(JSON.stringify(createDefaultProject()));

  it("returns the project default when no override exists", () => {
    expect(effectiveScale(base, "bass")).toEqual({
      root: 0,
      mode: "minor",
      intervals: MODE_INTERVALS.minor,
    });
  });

  it("lane override wins over project default", () => {
    const doc: ProjectDocument = JSON.parse(JSON.stringify(base));
    doc.laneOverrides = { bass: { root: 2, mode: "dorian" } };
    expect(effectiveScale(doc, "bass")).toEqual({
      root: 2,
      mode: "dorian",
      intervals: MODE_INTERVALS.dorian,
    });
    // Other lanes still follow the default.
    expect(effectiveScale(doc, "lead").mode).toBe("minor");
    expect(effectiveScale(doc, "lead").root).toBe(0);
  });

  it("explicit null override = follow project default", () => {
    const doc: ProjectDocument = JSON.parse(JSON.stringify(base));
    doc.laneOverrides = { lead: null };
    expect(effectiveScale(doc, "lead").mode).toBe("minor");
  });

  it("pentatonic override changes interval set only for that lane", () => {
    const doc: ProjectDocument = JSON.parse(JSON.stringify(base));
    doc.laneOverrides = { lead: { root: 0, mode: "pentatonicMajor" } };
    expect(effectiveScale(doc, "lead").intervals).toBe(MODE_INTERVALS.pentatonicMajor);
    expect(effectiveScale(doc, "chords").intervals).toBe(MODE_INTERVALS.minor);
  });
});

describe("chordRows", () => {
  it("derives one diatonic triad row per scale degree", () => {
    const cMajor = { root: 0, mode: "major" as const, intervals: MODE_INTERVALS.major };
    const rows = chordRows(cMajor, 4);
    expect(rows).toHaveLength(7);
    // Row 0 = C major triad: C E G = 60 64 67.
    expect(rows[0]).toEqual({ degree: 0, degrees: [0, 2, 4], midi: [60, 64, 67] });
    // Row 1 = D minor triad: D F A = 62 65 69.
    expect(rows[1]).toEqual({ degree: 1, degrees: [1, 3, 5], midi: [62, 65, 69] });
    // Row 2 = E minor: E G B.
    expect(rows[2].midi).toEqual([64, 67, 71]);
    // Row 5 = A minor.
    expect(rows[5].midi).toEqual([69, 72, 76]);
  });

  it("wraps past the top of the mode into the next octave", () => {
    const cMajor = { root: 0, mode: "major" as const, intervals: MODE_INTERVALS.major };
    const rows = chordRows(cMajor, 4);
    // Row 4 (G triad): G B D5 = 67 71 74 — the fifth wraps up an octave.
    expect(rows[4].midi).toEqual([67, 71, 74]);
    // Row 6 (B dim): B D F.
    expect(rows[6].midi).toEqual([71, 74, 77]);
  });

  it("derives minor-key diatonic chords in a minor scale", () => {
    const aMinor = { root: 9, mode: "minor" as const, intervals: MODE_INTERVALS.minor };
    const rows = chordRows(aMinor, 3);
    expect(rows).toHaveLength(7);
    // Row 0 = A minor: A C E = 57 60 64.
    expect(rows[0].midi).toEqual([57, 60, 64]);
    // Row 2 = C major: C E G.
    expect(rows[2].midi).toEqual([60, 64, 67]);
    // Row 5 = F major: F A C5.
    expect(rows[5].midi).toEqual([65, 69, 72]);
  });

  it("yields 5 rows for pentatonic scales", () => {
    const penta = { root: 0, mode: "pentatonicMinor" as const, intervals: MODE_INTERVALS.pentatonicMinor };
    expect(chordRows(penta, 4)).toHaveLength(5);
  });
});
