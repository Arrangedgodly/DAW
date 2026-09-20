/**
 * Drum hit lengths + per-piece GATE / ONE-SHOT playback modes.
 *
 *   - `DrumPattern.lengths` (sparse, per hit) sets how long a gated hit sounds
 *   - `DrumsLane.pieceModes` chooses gate vs one-shot per drum piece
 *   - both are optional and canonical-empty: documents that never use them
 *     keep their exact bytes and compile exactly as before
 */

import { beforeEach, describe, expect, it } from "vitest";
import { compileLaneEvents } from "../src/audio/compile";
import { getDrumKit } from "../src/audio/presets";
import { buildDrumNotes } from "../src/audio/exportMidi";
import { secondsPerStep } from "../src/audio/time";
import { decode, encode } from "../src/document/codec";
import {
  createDefaultProject,
  type DrumPattern,
  type DrumsLane,
} from "../src/document/schema";
import {
  docStore,
  loadDocument,
  removeDrumHit,
  resizeDrumHit,
  setDrumHit,
  setDrumPieceMode,
  doublePattern,
  toggleDrumStep,
} from "../src/state/store";

const groove = { bpm: 120, swing: 0 };
const stepSec = secondsPerStep(groove.bpm);

function blankDrums(): DrumPattern {
  const doc = createDefaultProject();
  const p = doc.patterns.drums[0];
  if (p.kind !== "drums") throw new Error("expected a drums pattern");
  return p;
}

function withHits(
  hits: Array<{ piece: "kick" | "hat"; step: number; length?: number }>,
): DrumPattern {
  const base = blankDrums();
  const steps = { ...base.steps };
  const lengths: Record<string, Record<string, number>> = {};
  for (const h of hits) {
    steps[h.piece] = steps[h.piece].map((on, i) => on || i === h.step);
    if (h.length !== undefined)
      (lengths[h.piece] ??= {})[String(h.step)] = h.length;
  }
  return {
    ...base,
    steps,
    ...(Object.keys(lengths).length > 0 ? { lengths } : {}),
  };
}

describe("compileLaneEvents — drum hit length + modes", () => {
  const synthKit = getDrumKit("kit-default")!; // synth pieces: gated by nature
  const sampleKit = getDrumKit("kit-808")!; // recordings: one-shot by nature
  const gate = { unit: "steps", value: 1 } as const;

  it("a hit without a length override sounds for the lane gate (unchanged)", () => {
    const [e] = compileLaneEvents({
      pattern: withHits([{ piece: "kick", step: 0 }]),
      preset: synthKit,
      gate,
      groove,
    });
    expect(e.holdSeconds).toBeCloseTo(1 * stepSec, 9);
  });

  it("a gated hit sounds for its own length", () => {
    const events = compileLaneEvents({
      pattern: withHits([
        { piece: "kick", step: 0, length: 3 },
        { piece: "kick", step: 8, length: 0.5 },
      ]),
      preset: synthKit,
      gate,
      groove,
    });
    expect(events.map((e) => e.holdSeconds)).toEqual([
      3 * stepSec,
      0.5 * stepSec,
    ]);
  });

  it("a one-shot synth piece rings its whole envelope, ignoring hit length", () => {
    const env = synthKit.pieces.kick.envelope;
    const [e] = compileLaneEvents({
      pattern: withHits([{ piece: "kick", step: 0, length: 0.25 }]),
      preset: synthKit,
      gate,
      groove,
      drumModes: { kick: "oneshot" },
    });
    expect(e.holdSeconds).toBeCloseTo(env.attack + env.decay, 9);
  });

  it("samples default to one-shot and can be forced to gated", () => {
    const pattern = withHits([{ piece: "kick", step: 0, length: 2 }]);
    const [natural] = compileLaneEvents({
      pattern,
      preset: sampleKit,
      gate,
      groove,
    });
    expect(natural.sample?.oneShot).toBe(true);

    const [gated] = compileLaneEvents({
      pattern,
      preset: sampleKit,
      gate,
      groove,
      drumModes: { kick: "gate" },
    });
    expect(gated.sample?.oneShot).toBe(false);
    expect(gated.holdSeconds).toBeCloseTo(2 * stepSec, 9);
  });

  it("other pieces are unaffected by one piece's mode", () => {
    const events = compileLaneEvents({
      pattern: withHits([
        { piece: "kick", step: 0 },
        { piece: "hat", step: 0 },
      ]),
      preset: sampleKit,
      gate,
      groove,
      drumModes: { kick: "gate" },
    });
    const kick = events.find((e) => e.sample?.ref.endsWith(".kick"))!;
    const hat = events.find((e) => e.sample?.ref.endsWith(".hat"))!;
    expect(kick.sample?.oneShot).toBe(false);
    expect(hat.sample?.oneShot).toBe(true);
  });
});

describe("MIDI export honors hit length", () => {
  it("uses the authored length, else the lane gate", () => {
    const notes = buildDrumNotes(
      [
        withHits([
          { piece: "kick", step: 0, length: 4 },
          { piece: "hat", step: 2 },
        ]),
      ],
      { unit: "steps", value: 1 },
      120,
    );
    const kick = notes.find((n) => n.tick === 0)!;
    const hat = notes.find((n) => n.tick !== 0)!;
    expect(kick.durationTicks).toBe(hat.durationTicks * 4);
  });
});

describe("drum hit store actions", () => {
  beforeEach(() => loadDocument(createDefaultProject()));
  const pid = () => docStore.getState().doc.patterns.drums[0].id;
  const pat = () => {
    const p = docStore.getState().doc.patterns.drums[0];
    if (p.kind !== "drums") throw new Error("drums");
    return p;
  };
  const gateSteps = () => {
    const l = docStore
      .getState()
      .doc.lanes.find((x) => x.id === "drums") as DrumsLane;
    return l.gate.unit === "steps" ? l.gate.value : 1;
  };

  it("a plain placement stores no length (canonical bytes unchanged)", () => {
    const before = encode(docStore.getState().doc);
    expect(setDrumHit(pid(), "kick", 0)).toBe(true);
    expect(pat().steps.kick[0]).toBe(true);
    expect(pat().lengths).toBeUndefined();
    removeDrumHit(pid(), "kick", 0);
    expect(encode(docStore.getState().doc)).toBe(before);
  });

  it("place with a length, resize, and remove clean up after themselves", () => {
    setDrumHit(pid(), "snare", 4, 3);
    expect(pat().lengths?.snare?.["4"]).toBe(3);

    resizeDrumHit(pid(), "snare", 4, 5.13); // snaps to the 0.25 grid
    expect(pat().lengths?.snare?.["4"]).toBe(5.25);

    // Resizing back to the lane gate drops the override entirely.
    resizeDrumHit(pid(), "snare", 4, gateSteps());
    expect(pat().lengths).toBeUndefined();

    setDrumHit(pid(), "snare", 4, 2);
    removeDrumHit(pid(), "snare", 4);
    expect(pat().steps.snare[4]).toBe(false);
    expect(pat().lengths).toBeUndefined();
  });

  it("resizing a step with no hit is a no-op", () => {
    expect(resizeDrumHit(pid(), "kick", 3, 4)).toBe(false);
    expect(pat().lengths).toBeUndefined();
  });

  it("toggling a hit off clears its length so a re-toggle starts fresh", () => {
    setDrumHit(pid(), "hat", 2, 4);
    toggleDrumStep("hat", 2); // off
    toggleDrumStep("hat", 2); // on again
    expect(pat().lengths).toBeUndefined();
  });

  it("piece modes are canonical-empty and clearable", () => {
    const before = encode(docStore.getState().doc);
    setDrumPieceMode("kick", "oneshot");
    const lane = () =>
      docStore.getState().doc.lanes.find((l) => l.id === "drums") as DrumsLane;
    expect(lane().pieceModes).toEqual({ kick: "oneshot" });
    setDrumPieceMode("kick", null);
    expect(lane().pieceModes).toBeUndefined();
    expect(encode(docStore.getState().doc)).toBe(before);
  });

  it("doubling a pattern repeats the lengths in the second half", () => {
    setDrumHit(pid(), "kick", 2, 3);
    doublePattern("drums", pid());
    expect(pat().bars).toBe(2);
    expect(pat().lengths?.kick).toEqual({ "2": 3, "18": 3 });
  });
});

describe("codec round-trip", () => {
  it("lengths and pieceModes survive encode → decode exactly", () => {
    const doc = createDefaultProject();
    const base = doc.patterns.drums[0] as DrumPattern;
    const withLen: DrumPattern = {
      ...withHits([{ piece: "kick", step: 4, length: 2.5 }]),
      id: base.id,
    };
    const lane = doc.lanes.find((l) => l.id === "drums") as DrumsLane;
    const next = {
      ...doc,
      lanes: doc.lanes.map((l) =>
        l === lane
          ? ({ ...lane, pieceModes: { snare: "oneshot" } } as DrumsLane)
          : l,
      ),
      patterns: { ...doc.patterns, drums: [withLen] },
    };
    const round = decode(encode(next));
    expect((round.patterns.drums[0] as DrumPattern).lengths).toEqual({
      kick: { "4": 2.5 },
    });
    expect(
      (round.lanes.find((l) => l.id === "drums") as DrumsLane).pieceModes,
    ).toEqual({ snare: "oneshot" });
    expect(encode(round)).toBe(encode(next));
  });

  it("rejects an off-grid length", () => {
    const doc = createDefaultProject();
    const bad = {
      ...doc,
      patterns: {
        ...doc.patterns,
        drums: [{ ...withHits([{ piece: "kick", step: 0, length: 1.1 }]) }],
      },
    };
    expect(() => decode(encode(bad))).toThrow();
  });
});
