/**
 * PX-1 tests — the WELCOME SONG demo.
 *
 * Nobody can HEAR a unit test (human listen is explicitly R12's session),
 * so the demo is verified STRUCTURALLY here: document validity (strict
 * schema + semantics), chord diatonicity, bass-root alignment, melody-in-
 * scale with breathing room, drum anchors, groove, cues, preset references;
 * plus the boot contract (first run → demo, NEW → empty default) and the
 * first-run nudge state machine. Acoustic/metric verification (energy,
 * onsets, peak) lives in tests/browser/demoSong.test.ts through the REAL
 * offline render; canonical bytes are pinned in tests/golden.
 */

import { describe, expect, it } from "vitest";
import { createDemoProject } from "../src/document/demoSong";
import { type PitchedPattern } from "../src/document/schema";
import { isProjectEmpty } from "../src/state/emptyProject";
import { validateProject } from "../src/document/validate";
import { degreeToMidi, toEffectiveScale } from "../src/document/scales";
import { PRESET_LIBRARY, DRUM_KITS } from "../src/audio/presets";
import { encode } from "../src/document/codec";
import { expectGolden } from "./golden/golden";
import { createMemoryProjectDb } from "../src/persist/db";
import { initPersistence } from "../src/persist/boot";
import { createNewProject } from "../src/persist/newProject";
import { docStore } from "../src/state/store";
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

  it("chains four 1-bar patterns per lane into one 4-bar loop", () => {
    for (const laneId of ["drums", "bass", "chords", "lead"] as const) {
      expect(doc.patterns[laneId]).toHaveLength(4);
      expect(doc.patterns[laneId].every((p) => p.bars === 1)).toBe(true);
      expect(doc.songChain[laneId]).toHaveLength(4);
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

describe("PX-1 structural musicality", () => {
  it("chords: i–VI–III–VII, one diatonic triad per bar (stack semantics)", () => {
    const roots = [0, 5, 2, 6];
    doc.patterns.chords.forEach((pattern, i) => {
      const on = noteOns(pattern as PitchedPattern);
      expect(on.size).toBe(1); // exactly one chord per bar
      const degree = [...on.keys()][0]!;
      expect(degree).toBe(roots[i]);
      // The stacked triad [d, d+2, d+4] is diatonic by construction; assert
      // it against the concrete scale pitch classes anyway (the law, not the
      // implementation).
      for (const off of [0, 2, 4]) {
        const pc = degreeToMidi(scale, degree + off, 3) % 12;
        expect(scalePitchClasses.has(pc)).toBe(true);
      }
      // Long pad: one note at the downbeat, sustained ≈ the whole bar
      // (v1: note-on + 9 sustain markers; v2: gate 6 + 9 = length 15).
      expect(on.get(degree)!).toEqual([0]);
      const pad = pattern.notes.find((n) => n.degree === degree)!;
      expect(pad.start).toBe(0);
      expect(pad.length).toBe(15);
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
    // Approach note: last bar's step-14 note walks B♭→C (deg 6→7) into the loop.
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
    // degrees; a diatonic triad outline (≤4, e.g. the DROP's F5+B♭5 double
    // stop) is the allowed leap, nothing wider.
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
    // The demo is a REAL saved project row.
    const row = await db.getRecord(result.projectId);
    expect(row!.name).toBe("WELCOME SONG");
    expect(() => validateProject(JSON.parse(row!.json))).not.toThrow();
    await result.controller.stop();
    dismissFirstRunNudge();
  });

  it("second boot restores the demo row (no nudge)", async () => {
    const db = createMemoryProjectDb();
    const first = await initPersistence({ db, now: () => 1000 });
    await first.controller.stop();
    dismissFirstRunNudge();
    const second = await initPersistence({ db, now: () => 2000 });
    expect(second.restored).toBe(true);
    expect(second.projectId).toBe(first.projectId);
    expect(docStore.getState().doc.name).toBe("WELCOME SONG");
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
