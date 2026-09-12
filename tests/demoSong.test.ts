/**
 * PX-1 tests — the WELCOME SONG demo; PX-4 re-based + extended for the
 * POLY-LOOP arrangement (i3-4: lanes loop at unequal cycle lengths).
 *
 * Nobody can HEAR a unit test (human listen stays the pending-human carry),
 * so the demo is verified STRUCTURALLY here: document validity (strict
 * schema + semantics), the poly-loop lane cycles + LCM song cycle, chord
 * diatonicity, bass-root alignment, melody-in-scale with breathing room,
 * drum anchors, groove, cues, preset references; plus the boot contract
 * (first run → demo, NEW → empty default) and the first-run nudge state
 * machine. Acoustic/metric verification (energy, onsets, peak) lives in
 * tests/browser/demoSong.test.ts through the REAL offline render; canonical
 * bytes are pinned in tests/golden.
 */

import { describe, expect, it } from "vitest";
import { createDemoProject } from "../src/document/demoSong";
import { type PitchedPattern } from "../src/document/schema";
import { isProjectEmpty } from "../src/state/emptyProject";
import { validateProject } from "../src/document/validate";
import { degreeToMidi, toEffectiveScale } from "../src/document/scales";
import { PRESET_LIBRARY, DRUM_KITS } from "../src/audio/presets";
import { encode } from "../src/document/codec";
import { laneCycleSteps } from "../src/audio/song";
import { exportCycleSteps } from "../src/audio/exportMidi";
import { expectGolden } from "./golden/golden";
import { createMemoryProjectDb } from "../src/persist/db";
import { initPersistence } from "../src/persist/boot";
import { createNewProject } from "../src/persist/newProject";
import { docStore, setProjectName } from "../src/state/store";
import {
  armFirstRunNudge,
  dismissFirstRunNudge,
  firstRunNudge,
} from "../src/state/firstRun";

const doc = createDemoProject();
const scale = toEffectiveScale(doc.scale);
const scalePitchClasses = new Set(
  scale.intervals.map((i) => (i + scale.root) % 12),
);

/** Note-on steps of a pitched pattern, by degree (v2 notes). */
function noteOns(p: PitchedPattern): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const note of p.notes) {
    const list = out.get(note.degree) ?? [];
    list.push(note.start);
    out.set(note.degree, list);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

describe("PX-1 demo document validity", () => {
  it("passes strict validation (schema + semantics + canonicalization)", () => {
    expect(() => validateProject(createDemoProject())).not.toThrow();
  });

  it("uses only real PX-2 preset and kit ids", () => {
    const drums = doc.lanes.find((l) => l.id === "drums")!;
    expect(DRUM_KITS[drums.kitId]).toBeDefined();
    for (const lane of doc.lanes) {
      if (lane.id === "drums") continue;
      expect(PRESET_LIBRARY[lane.presetId]).toBeDefined();
    }
  });

  it("has swing in the committed 15–25% pocket and a sane tempo", () => {
    expect(doc.transport.swing).toBeGreaterThanOrEqual(0.15);
    expect(doc.transport.swing).toBeLessThanOrEqual(0.25);
    expect(doc.transport.bpm).toBeGreaterThanOrEqual(90);
    expect(doc.transport.bpm).toBeLessThanOrEqual(160);
  });

  it("carries section cue labels on the chain (VERSE…DROP)", () => {
    const cues = doc.chainCues!.chords;
    expect(cues[0]).toBe("VERSE");
    expect(cues[3]).toBe("DROP");
    expect(cues.every((c) => c === null || typeof c === "string")).toBe(true);
  });
});

describe("PX-4 poly-loop arrangement (i3-4)", () => {
  /** The lane's CYCLE in bars: its chain total (LL-2 laneCycleSteps / 16). */
  const cycleBars = (lane: "drums" | "bass" | "chords" | "lead"): number =>
    laneCycleSteps(doc, lane) / 16;

  it("runs the lanes at UNEQUAL powers-of-two cycles: chords 8B · drums 4B · lead 4B · bass 4B", () => {
    expect(cycleBars("chords")).toBe(8);
    expect(cycleBars("drums")).toBe(4);
    expect(cycleBars("lead")).toBe(4);
    expect(cycleBars("bass")).toBe(4);
    // Genuinely unequal — the poly-loop demonstration is the lanes weaving,
    // the harmonic long lane against the rhythm section, not four copies of
    // one length.
    expect(new Set([8, 4]).size).toBe(2);
    // Every pattern is a powers-of-two member of the I3-d vocabulary, and
    // the demo stays inside the v1/v2 vocabulary {1,2,4} — the migration
    // fixtures project THIS document as an era-legal save (the poly-loop
    // lives in the chain totals, the recorded PX-4 law). Four chain slots
    // per lane (the phone-rail law: the condensed row keeps the `+` append
    // reachable beside the tiles).
    for (const lane of ["drums", "bass", "chords", "lead"] as const) {
      for (const pattern of doc.patterns[lane]) {
        expect([1, 2, 4, 8, 16, 32, 64, 128]).toContain(pattern.bars);
        expect([1, 2, 4]).toContain(pattern.bars);
      }
      expect(doc.songChain[lane]).toHaveLength(4);
    }
  });

  it("the song CYCLE is the LCM = the longest lane (8 bars) — what one-shot and exports span", () => {
    expect(exportCycleSteps(doc)).toBe(8 * 16);
    expect(exportCycleSteps(doc) / 16).toBe(Math.max(8, 4, 4, 4));
  });

  it("chords: the LONG lane — four distinct 2-bar patterns (one chord held two bars each)", () => {
    expect(doc.patterns.chords).toHaveLength(4);
    expect(doc.patterns.chords.every((p) => p.bars === 2)).toBe(true);
    expect(doc.songChain.chords).toHaveLength(4);
    expect(new Set(doc.songChain.chords).size).toBe(4);
  });

  it("drums/bass/lead: four 1-bar patterns each (the rhythm section's 4-bar cycles)", () => {
    expect(doc.patterns.drums.every((p) => p.bars === 1)).toBe(true);
    expect(doc.patterns.bass.every((p) => p.bars === 1)).toBe(true);
    expect(doc.patterns.lead.every((p) => p.bars === 1)).toBe(true);
  });
});

describe("PX-1 structural musicality (PX-4 poly-loop re-base)", () => {
  it("chords: i–VI–III–VII, one diatonic triad per 2-bar pattern, re-attacking each bar downbeat", () => {
    const roots = [0, 5, 2, 6];
    doc.patterns.chords.forEach((pattern, i) => {
      const on = noteOns(pattern as PitchedPattern);
      expect(on.size).toBe(1); // exactly one chord root per pattern
      const degree = [...on.keys()][0]!;
      expect(degree).toBe(roots[i]);
      // The stacked triad [d, d+2, d+4] is diatonic by construction; assert
      // it against the concrete scale pitch classes anyway (the law, not the
      // implementation).
      for (const off of [0, 2, 4]) {
        const pc = degreeToMidi(scale, degree + off, 3) % 12;
        expect(scalePitchClasses.has(pc)).toBe(true);
      }
      // Long pads: one note per BAR downbeat (steps 0 and 16 of the 2-bar
      // pattern), each sustained ≈ the whole bar (gate 6 + 9 = length 15).
      expect(on.get(degree)!).toEqual([0, 16]);
      for (const pad of pattern.notes) {
        expect(pad.length).toBe(15);
      }
    });
  });

  it("bass: locks to each bar's chord root at a plausible register, with an approach note", () => {
    const chordRoots = [0, 5, 2, 6];
    doc.patterns.bass.forEach((pattern, i) => {
      const on = noteOns(pattern as PitchedPattern);
      const degree = [...on.keys()][0]!;
      expect(degree).toBe(chordRoots[i]!); // root-locked
      expect(degree).toBeLessThanOrEqual(6); // first-position register
      const steps = on.get(degree)!;
      expect(steps[0]).toBe(0); // anchored on the downbeat
      expect(steps.length).toBeGreaterThanOrEqual(4); // a real bass line, not a drone
    });
    // Approach note: last bar's step-14 note walks B♭→C (deg 6→7) into the
    // bass cycle's wrap.
    const lastBass = noteOns(doc.patterns.bass[3] as PitchedPattern);
    expect(lastBass.get(7)).toEqual([14]);
  });

  it("lead: melody in scale, syncopated, with rests — not a wall of 16ths", () => {
    let totalNotes = 0;
    let offBeatNotes = 0;
    for (const pattern of doc.patterns.lead as PitchedPattern[]) {
      const on = noteOns(pattern);
      const count = [...on.values()].reduce((n, s) => n + s.length, 0);
      totalNotes += count;
      expect(count).toBeGreaterThanOrEqual(2); // every bar says something
      expect(count).toBeLessThanOrEqual(8); // breathing room (≤ half the steps)
      for (const [degree, steps] of on) {
        const pc = degreeToMidi(scale, degree, 4) % 12;
        expect(scalePitchClasses.has(pc)).toBe(true); // in scale
        for (const s of steps) if (s % 2 === 1) offBeatNotes++;
      }
    }
    expect(totalNotes).toBeGreaterThanOrEqual(10); // a phrase, across 4 bars
    expect(offBeatNotes).toBeGreaterThanOrEqual(4); // syncopation present
    // Rests: the very first melody bar opens on a rest (step 0 silent).
    const firstBar = doc.patterns.lead[0] as PitchedPattern;
    expect(firstBar.notes.every((n) => n.start !== 0)).toBe(true);
    // Stepwise + triad motion: consecutive attacks move mostly by 1–2 scale
    // degrees; a diatonic triad outline (≤4, e.g. the peak bar's F5+B♭5
    // double stop) is the allowed leap, nothing wider.
    for (const pattern of doc.patterns.lead as PitchedPattern[]) {
      const events: [number, number][] = [];
      for (const [degree, steps] of noteOns(pattern))
        for (const s of steps) events.push([s, degree]);
      events.sort((a, b) => a[0] - b[0]);
      let stepwise = 0;
      for (let i = 1; i < events.length; i++) {
        const leap = Math.abs(events[i]![1] - events[i - 1]![1]);
        expect(leap).toBeLessThanOrEqual(4);
        if (leap <= 2) stepwise++;
      }
      expect(stepwise).toBeGreaterThanOrEqual(Math.ceil(events.length / 2));
    }
    // The RC-1 default-window law: the melody reads in the ROWS 6–12 window
    // on first boot — degree 13 never carries a note.
    const leadDegrees = new Set(
      (doc.patterns.lead as PitchedPattern[]).flatMap((p) =>
        p.notes.map((n) => n.degree),
      ),
    );
    expect(leadDegrees.has(13)).toBe(false);
  });

  it("drums: kick/snare backbone anchored, hats groove, one real fill", () => {
    for (const [i, pattern] of doc.patterns.drums.entries()) {
      expect(pattern.steps.kick[0]).toBe(true); // downbeat anchored in EVERY bar
      expect(pattern.steps.hat.some(Boolean)).toBe(true); // time-keeper present
      if (i < 3) {
        expect(pattern.steps.snare[4]).toBe(true); // backbeat
        expect(pattern.steps.snare[12]).toBe(true);
      }
    }
    // Fill bar: ≥2 snare/tom hits in the last quarter, kick still on 0/8.
    const fill = doc.patterns.drums[3]!.steps;
    const tail = [12, 13, 14, 15].filter((s) => fill.snare[s] || fill.tom[s]);
    expect(tail.length).toBeGreaterThanOrEqual(3);
    expect(fill.kick[8]).toBe(true);
  });
});

describe("PX-1 boot contract", () => {
  it("first run creates the WELCOME SONG demo (and arms the nudge)", async () => {
    dismissFirstRunNudge();
    const db = createMemoryProjectDb();
    const result = await initPersistence({ db, now: () => 1000 });
    expect(result.restored).toBe(false);
    expect(docStore.getState().doc.name).toBe("WELCOME SONG");
    expect(firstRunNudge()).toBe(true);
    // Untouched demos are not saved projects.
    const row = await db.getRecord(result.projectId);
    expect(row).toBeUndefined();
    await result.controller.stop();
    dismissFirstRunNudge();
  });

  it("second boot restores an edited demo copy (no nudge)", async () => {
    const db = createMemoryProjectDb();
    const first = await initPersistence({ db, now: () => 1000 });
    setProjectName("My welcome variation");
    await first.controller.stop();
    dismissFirstRunNudge();
    const second = await initPersistence({ db, now: () => 2000 });
    expect(second.restored).toBe(true);
    expect(second.projectId).toBe(first.projectId);
    expect(docStore.getState().doc.name).toBe("My welcome variation");
    expect(firstRunNudge()).toBe(false); // not a first run anymore
    await second.controller.stop();
  });

  it("NEW still creates the EMPTY default project", async () => {
    const fresh = await createNewProject(createMemoryProjectDb(), {
      newId: () => "new-1",
      now: () => 42,
    });
    expect(fresh.doc.name).toBe("Untitled");
    expect(() => validateProject(fresh.doc)).not.toThrow();
    // Empty by the app's own predicate — the demo is NOT (first-run contrast).
    expect(isProjectEmpty(fresh.doc)).toBe(true);
    expect(isProjectEmpty(createDemoProject())).toBe(false);
  });

  it("first-run nudge: arm → visible until dismissed by first play", () => {
    dismissFirstRunNudge();
    expect(firstRunNudge()).toBe(false);
    armFirstRunNudge();
    expect(firstRunNudge()).toBe(true);
    dismissFirstRunNudge();
    expect(firstRunNudge()).toBe(false);
  });
});

describe("PX-1 golden: canonical demo bytes (SV-1: renamed -v3 — loopBars key dropped, composition unchanged)", () => {
  it("matches the manifest SHA-256 + byteLength (deterministic factory)", () => {
    expectGolden(
      "codec/demo-project-canonical-v3",
      new TextEncoder().encode(encode(doc)),
    );
  });
});
