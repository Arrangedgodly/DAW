import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHANNEL,
  DEFAULT_EQ,
  DEFAULT_MASTER,
  equalizerBands,
  type EqBand,
} from "../src/document/mixer";
import { createDefaultProject } from "../src/document/schema";
import { validateProject } from "../src/document/validate";
import { proposeAutoMix } from "../src/audio/autoMix";

const band: EqBand = {
  id: 1,
  type: "peaking",
  frequency: 1200,
  gain: 4,
  q: 2,
  enabled: true,
};
const project = (bands: unknown) => ({
  ...createDefaultProject(),
  mixer: {
    master: DEFAULT_MASTER,
    channels: { lead: { ...DEFAULT_CHANNEL, eq: { ...DEFAULT_EQ, bands } } },
  },
});
describe("flexible EQ documents", () => {
  it("retains legacy settings and maps the original topology exactly", () => {
    const old = {
      ...DEFAULT_EQ,
      lowCut: 90,
      low: 2,
      mid: -3,
      midHz: 750,
      high: 4,
    };
    expect(equalizerBands(old)).toEqual([
      {
        id: 1,
        type: "highpass",
        frequency: 90,
        gain: 0,
        q: Math.SQRT1_2,
        enabled: true,
      },
      { id: 2, type: "lowshelf", frequency: 150, gain: 2, q: 1, enabled: true },
      {
        id: 3,
        type: "peaking",
        frequency: 750,
        gain: -3,
        q: 0.7,
        enabled: true,
      },
      {
        id: 4,
        type: "highshelf",
        frequency: 6000,
        gain: 4,
        q: 1,
        enabled: true,
      },
    ]);
    expect(old).not.toHaveProperty("bands");
  });
  it("round trips eight movable bands, IDs and bypass while respecting explicit empty EQ", () => {
    const bands = Array.from({ length: 8 }, (_, i) => ({
      ...band,
      id: i + 1,
      frequency: 20000 - i * 2000,
      enabled: i % 2 === 0,
    }));
    const saved = validateProject(JSON.parse(JSON.stringify(project(bands))));
    expect(equalizerBands(saved.mixer!.channels.lead!.eq)).toEqual(bands);
    expect(equalizerBands({ ...DEFAULT_EQ, bands: [] })).toEqual([]);
  });
  it.each([
    [Array.from({ length: 9 }, (_, i) => ({ ...band, id: i + 1 }))],
    [[band, band]],
    [[{ ...band, type: "invalid" }]],
    [[{ ...band, frequency: 0 }]],
    [[{ ...band, gain: 19 }]],
    [[{ ...band, q: Infinity }]],
    [[{ ...band, id: 0 }]],
  ])("rejects malformed bands", (bands) =>
    expect(() => validateProject(project(bands))).toThrow(),
  );
  it("preserves authored bands during Auto Mix, including bypassed custom EQ", () => {
    const doc = validateProject(project([band]));
    const proposal = proposeAutoMix(
      doc,
      {
        lead: {
          active: true,
          activeDb: -12,
          peak: 0.5,
          crest: 10,
          lowMidRatio: 0.8,
        },
      },
      { amount: 1, balance: false, eq: true, dynamics: false },
    );
    expect(proposal.document).toBe(doc);
    expect(proposal.document.mixer!.channels.lead!.eq.bands).toEqual([band]);
  });
});
