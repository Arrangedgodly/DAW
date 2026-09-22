import {
  addFxDevice,
  removeFxDevice,
  moveFxDevice,
  setFxParam,
  setFxBypassed,
} from "../src/state/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultProject } from "../src/document/schema";
import {
  DEFAULT_CHANNEL,
  DEFAULT_MASTER,
  DEFAULT_MIXER,
} from "../src/document/mixer";
import { validateProject } from "../src/document/validate";
import {
  measureArrangementContext,
  measureAudio,
  proposeAutoMix,
  type AudioStats,
} from "../src/audio/autoMix";
import { docStore, commitDocumentEdit, undo } from "../src/state/store";
import {
  setChannelProcessing,
  setMasterProcessing,
  restoreMix,
} from "../src/state/mixer";
import { connectStoreToEngine } from "../src/state/engineBridge";
import { Session } from "../src/engine/session";

const options = { amount: 1, balance: true, eq: true, dynamics: true };
const stats = (db: number): AudioStats => ({
  active: true,
  activeDb: db,
  peak: 0.5,
  crest: 10,
  lowMidRatio: 0,
});
beforeEach(() => {
  docStore.setState({ doc: createDefaultProject() });
  docStore.temporal.getState().clear();
});
describe("mixer persistence and history", () => {
  it("keeps old documents unchanged and validates additive settings", () => {
    const old = createDefaultProject();
    expect(validateProject(old).mixer).toBeUndefined();
    expect(validateProject({ ...old, mixer: DEFAULT_MIXER }).mixer).toEqual(
      DEFAULT_MIXER,
    );
    expect(() =>
      validateProject({
        ...old,
        mixer: {
          ...DEFAULT_MIXER,
          master: { ...DEFAULT_MASTER, gainDb: Infinity },
        },
      }),
    ).toThrow();
    expect(() =>
      validateProject({
        ...old,
        mixer: {
          ...DEFAULT_MIXER,
          channels: { lead: { ...DEFAULT_CHANNEL, pan: 5 } },
        },
      }),
    ).toThrow();
  });
  it("makes processing undoable and pushes it to the session without changing notes", () => {
    const session = new Session();
    const sync = vi.spyOn(session, "setMixer");
    const disconnect = connectStoreToEngine(session);
    const before = docStore.getState().doc;
    setChannelProcessing("lead", (p) => ({ ...p, pan: -0.4 }));
    expect(docStore.getState().doc.patterns).toBe(before.patterns);
    expect(docStore.getState().doc.mixer?.channels.lead?.pan).toBe(-0.4);
    expect(sync).toHaveBeenLastCalledWith(docStore.getState().doc.mixer);
    undo();
    expect(docStore.getState().doc).toBe(before);
    disconnect();
  });
  it("restores mix settings while retaining later notes and rejects stale apply", () => {
    const before = docStore.getState().doc;
    setMasterProcessing((p) => ({ ...p, gainDb: -4 }));
    const changed = docStore.getState().doc;
    commitDocumentEdit(changed, { ...changed, name: "Later edit" });
    expect(() => commitDocumentEdit(before, changed)).toThrow(/changed/);
    restoreMix(before);
    expect(docStore.getState().doc.name).toBe("Later edit");
    expect(docStore.getState().doc.mixer).toBeUndefined();
  });
});
describe("restrained Auto Mix", () => {
  it("makes room only when supporting tracks play under the lead", () => {
    const lead = new Float32Array(1000);
    const chordsUnderLead = new Float32Array(1000);
    const chordsInBreak = new Float32Array(1000);
    lead.fill(0.2, 0, 500);
    chordsUnderLead.fill(0.2, 0, 500);
    chordsInBreak.fill(0.2, 500);
    const master = [new Float32Array(1000), new Float32Array(1000)];
    const together = measureArrangementContext(
      [[lead], [chordsUnderLead]],
      ["lead", "chords"],
      master,
      1000,
    );
    const apart = measureArrangementContext(
      [[lead], [chordsInBreak]],
      ["lead", "chords"],
      master,
      1000,
    );
    expect(together.overlap.lead?.chords).toBe(1);
    expect(apart.overlap.lead?.chords).toBe(0);
    const doc = createDefaultProject();
    const laneStats = {
      lead: stats(-12),
      chords: { ...stats(-12), lowMidRatio: 0.3 },
    };
    const under = proposeAutoMix(
      doc,
      laneStats,
      { ...options, dynamics: false },
      together,
    );
    const breakOnly = proposeAutoMix(
      doc,
      laneStats,
      { ...options, dynamics: false },
      apart,
    );
    expect(
      under.document.lanes.find((lane) => lane.id === "chords")!.volume,
    ).toBeLessThan(
      breakOnly.document.lanes.find((lane) => lane.id === "chords")!.volume!,
    );
    expect(under.document.mixer?.channels.chords?.eq.enabled).toBe(true);
    expect(breakOnly.document.mixer?.channels.chords).toBeUndefined();
  });
  it("adds bounded master level only when the rendered mix has headroom", () => {
    const doc = createDefaultProject();
    const quiet = proposeAutoMix(doc, { lead: stats(-12) }, options, {
      overlap: {},
      master: { ...stats(-20), peak: 0.4 },
    });
    const hot = proposeAutoMix(doc, { lead: stats(-12) }, options, {
      overlap: {},
      master: { ...stats(-20), peak: 1.2 },
    });
    expect(quiet.document.mixer?.master.gainDb).toBe(2);
    expect(hot.document.mixer?.master.gainDb).toBeLessThan(0);
    const alreadyLimited = proposeAutoMix(
      {
        ...doc,
        mixer: {
          ...DEFAULT_MIXER,
          master: {
            ...DEFAULT_MASTER,
            limiter: { ...DEFAULT_MASTER.limiter, enabled: true },
          },
        },
      },
      { lead: stats(-12) },
      options,
      { overlap: {}, master: { ...stats(-20), peak: 0.4 } },
    );
    expect(alreadyLimited.document.mixer?.master.gainDb).toBe(0);
  });
  it("ignores silence when measuring active loudness", () => {
    const short = Float32Array.from(
      { length: 1000 },
      (_, i) => 0.2 * Math.sin(i * 0.2),
    );
    const long = new Float32Array(10000);
    long.set(short);
    expect(measureAudio(long, 1000).activeDb).toBeCloseTo(
      measureAudio(short, 1000).activeDb,
      5,
    );
    expect(measureAudio(new Float32Array(1000), 1000).active).toBe(false);
  });
  it("caps level changes at 3 dB, preserves locks and existing creative effects", () => {
    const base = createDefaultProject();
    const doc = {
      ...base,
      mixer: {
        ...DEFAULT_MIXER,
        channels: { bass: { ...DEFAULT_CHANNEL, locked: true } },
      },
    };
    const proposal = proposeAutoMix(
      doc,
      {
        drums: stats(-10),
        bass: stats(-30),
        lead: stats(-8),
        chords: stats(-20),
      },
      options,
    );
    expect(proposal.document.lanes.find((l) => l.id === "bass")).toBe(
      doc.lanes.find((l) => l.id === "bass"),
    );
    for (const lane of proposal.document.lanes) {
      const before = doc.lanes.find((l) => l.id === lane.id)!;
      expect(lane.fxChain).toBe(before.fxChain);
      expect(
        20 * Math.log10((lane.volume ?? 1) / (before.volume ?? 1)),
      ).toBeGreaterThanOrEqual(-3.00001);
    }
    expect(proposal.document.patterns).toBe(doc.patterns);
  });
  it("leaves authored EQ and compression alone, and honors opt-outs", () => {
    const base = createDefaultProject();
    const channel = {
      ...DEFAULT_CHANNEL,
      eq: { ...DEFAULT_CHANNEL.eq, enabled: true, mid: 4 },
      compressor: { ...DEFAULT_CHANNEL.compressor, enabled: true, ratio: 4 },
    };
    const doc = {
      ...base,
      mixer: { ...DEFAULT_MIXER, channels: { lead: channel } },
    };
    const result = proposeAutoMix(
      doc,
      { lead: { ...stats(-12), crest: 25, lowMidRatio: 0.8 } },
      { ...options, balance: false },
    );
    expect(result.document.mixer?.channels.lead).toBe(channel);
    const off = proposeAutoMix(
      doc,
      { lead: stats(-12) },
      { amount: 1, balance: false, eq: false, dynamics: false },
    );
    expect(off.document).toBe(doc);
    expect(
      proposeAutoMix(doc, { lead: stats(-12) }, { ...options, amount: 0 })
        .document,
    ).toBe(doc);
  });
});

describe("master effect rack", () => {
  it("persists ordered devices, validates parameters, and supports undo without touching tracks", () => {
    const tracks = docStore.getState().doc.lanes;
    expect(addFxDevice("master", "filter")).toBe(true);
    expect(addFxDevice("master", "delay")).toBe(true);
    setFxParam("master", 0, "cutoffHz", 500);
    setFxBypassed("master", 1, true);
    moveFxDevice("master", 1, 0);
    const saved = validateProject(
      JSON.parse(JSON.stringify(docStore.getState().doc)),
    );
    expect(saved.mixer?.master.fxChain?.map((d) => d.type)).toEqual([
      "delay",
      "filter",
    ]);
    expect(saved.mixer?.master.fxChain?.[0].bypassed).toBe(true);
    expect(saved.mixer?.master.fxChain?.[1].params).toMatchObject({
      cutoffHz: 500,
    });
    expect(docStore.getState().doc.lanes).toBe(tracks);
    expect(() => setFxParam("master", 1, "cutoffHz", -1)).toThrow();
    removeFxDevice("master", 0);
    expect(docStore.getState().doc.mixer?.master.fxChain).toHaveLength(1);
    undo();
    expect(docStore.getState().doc.mixer?.master.fxChain).toHaveLength(2);
  });
  it("retains subsequent master effects when restoring an Auto Mix", () => {
    const before = docStore.getState().doc;
    setMasterProcessing((p) => ({ ...p, gainDb: -6 }));
    addFxDevice("master", "reverb");
    restoreMix(before);
    expect(docStore.getState().doc.mixer?.master.gainDb).toBe(0);
    expect(docStore.getState().doc.mixer?.master.fxChain?.[0].type).toBe(
      "reverb",
    );
  });
});

it("allows eight master devices and rejects a ninth without changing the document", () => {
  for (let i = 0; i < 8; i++)
    expect(addFxDevice("master", "filter")).toBe(true);
  const before = docStore.getState().doc;
  expect(addFxDevice("master", "delay")).toBe(false);
  expect(docStore.getState().doc).toBe(before);
  expect(validateProject(before).mixer?.master.fxChain).toHaveLength(8);
});
