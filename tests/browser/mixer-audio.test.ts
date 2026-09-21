import { describe, expect, it } from "vitest";
import {
  createChannelProcessing,
  createMasterProcessing,
  dbToGain,
  prepareMixer,
} from "../../src/audio/mixer";
import {
  DEFAULT_CHANNEL,
  DEFAULT_MASTER,
  equalizerBands,
  type ChannelProcessing,
  type MasterProcessing,
} from "../../src/document/mixer";
import { createDefaultProject } from "../../src/document/schema";
import { renderProjectToBuffer } from "../../src/audio/render";

async function render(
  channel: ChannelProcessing,
  master?: MasterProcessing,
  frequency = 250,
  amplitude = 0.2,
) {
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  await prepareMixer(ctx);
  const buffer = ctx.createBuffer(2, 44100, 44100);
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < 44100; i++)
      buffer.getChannelData(c)[i] =
        Math.sin((i * 2 * Math.PI * frequency) / 44100) * amplitude;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const processing = createChannelProcessing(ctx, channel);
  source.connect(processing.input);
  if (master) {
    await prepareMixer(ctx);
    const out = createMasterProcessing(ctx, master);
    processing.output.connect(out.input);
    out.output.connect(ctx.destination);
  } else processing.output.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}
const rms = (data: Float32Array) =>
  Math.sqrt(
    data.slice(10000).reduce((sum, x) => sum + x * x, 0) /
      (data.length - 10000),
  );
describe("shared mixer DSP", () => {
  it("bypasses transparently and pans the channel without leaking left", async () => {
    const neutral = await render(DEFAULT_CHANNEL);
    expect(rms(neutral.getChannelData(0))).toBeCloseTo(0.2 / Math.SQRT2, 3);
    const right = await render({ ...DEFAULT_CHANNEL, pan: 1 });
    expect(rms(right.getChannelData(0))).toBeLessThan(1e-6);
    expect(rms(right.getChannelData(1))).toBeGreaterThan(0.1);
  });
  it("attenuates low frequencies with EQ and reduces loud signals with compression", async () => {
    const dry = await render(DEFAULT_CHANNEL, undefined, 60, 0.5);
    const eq = await render(
      {
        ...DEFAULT_CHANNEL,
        eq: { ...DEFAULT_CHANNEL.eq, enabled: true, lowCut: 300 },
      },
      undefined,
      60,
      0.5,
    );
    expect(rms(eq.getChannelData(0))).toBeLessThan(
      rms(dry.getChannelData(0)) * 0.1,
    );
    const compressed = await render(
      {
        ...DEFAULT_CHANNEL,
        compressor: {
          ...DEFAULT_CHANNEL.compressor,
          enabled: true,
          threshold: -30,
          ratio: 8,
        },
      },
      undefined,
      60,
      0.5,
    );
    expect(rms(compressed.getChannelData(0))).toBeLessThan(
      rms(dry.getChannelData(0)) * 0.5,
    );
  });
  it("bounds both channels even under severe overload without nonfinite samples", async () => {
    const output = await render(
      DEFAULT_CHANNEL,
      {
        ...DEFAULT_MASTER,
        limiter: { enabled: true, ceiling: -3, release: 0.08 },
      },
      900,
      4,
    );
    for (let c = 0; c < 2; c++) {
      let peak = 0;
      for (const sample of output.getChannelData(c)) {
        expect(Number.isFinite(sample)).toBe(true);
        peak = Math.max(peak, Math.abs(sample));
      }
      expect(peak).toBeLessThanOrEqual(dbToGain(-3) + 1e-6);
      expect(peak).toBeGreaterThan(0.6);
    }
  });
  it("exports the same channel processing and preserves legacy default output", async () => {
    const base = createDefaultProject();
    const patterned = {
      ...base,
      patterns: {
        ...base.patterns,
        lead: base.patterns.lead!.map((p) =>
          p.kind === "pitched"
            ? { ...p, notes: [{ start: 0, length: 4, degree: 0 }] }
            : p,
        ),
      },
    };
    const dry = await renderProjectToBuffer(patterned, {
      arrangement: "linear",
    });
    const processed = await renderProjectToBuffer(
      {
        ...patterned,
        mixer: {
          master: DEFAULT_MASTER,
          channels: { lead: { ...DEFAULT_CHANNEL, pan: 1 } },
        },
      },
      { arrangement: "linear" },
    );
    expect(rms(processed.channels[0])).toBeLessThan(
      rms(dry.channels[0]) * 0.01,
    );
    expect(rms(processed.channels[1])).toBeGreaterThan(0.001);
    const masterFiltered = await renderProjectToBuffer(
      {
        ...patterned,
        mixer: {
          channels: {},
          master: {
            ...DEFAULT_MASTER,
            fxChain: [
              {
                type: "filter",
                bypassed: false,
                params: { cutoffHz: 20, q: 0.7 },
              },
            ],
          },
        },
      },
      { arrangement: "linear" },
    );
    expect(rms(masterFiltered.channels[0])).toBeLessThan(
      rms(dry.channels[0]) * 0.1,
    );
  });
});

it("master filter processes the summed output and bypass restores the dry signal", async () => {
  const dry = await render(DEFAULT_CHANNEL, DEFAULT_MASTER, 4000);
  const device = {
    type: "filter" as const,
    bypassed: false,
    params: { cutoffHz: 120, q: 0.7 },
  };
  const wet = await render(
    DEFAULT_CHANNEL,
    { ...DEFAULT_MASTER, fxChain: [device] },
    4000,
  );
  const bypass = await render(
    DEFAULT_CHANNEL,
    { ...DEFAULT_MASTER, fxChain: [{ ...device, bypassed: true }] },
    4000,
  );
  expect(rms(wet.getChannelData(0))).toBeLessThan(
    rms(dry.getChannelData(0)) * 0.05,
  );
  expect(rms(bypass.getChannelData(0))).toBeCloseTo(
    rms(dry.getChannelData(0)),
    5,
  );
});
describe("flexible EQ audio", () => {
  it("renders converted legacy bands identically to old documents", async () => {
    const eq = {
      ...DEFAULT_CHANNEL.eq,
      enabled: true,
      lowCut: 65,
      low: 2,
      mid: -3,
      midHz: 750,
      high: 4,
    };
    const legacy = await render({ ...DEFAULT_CHANNEL, eq });
    const converted = await render({
      ...DEFAULT_CHANNEL,
      eq: { ...eq, bands: [...equalizerBands(eq)] },
    });
    expect(Array.from(converted.getChannelData(0))).toEqual(
      Array.from(legacy.getChannelData(0)),
    );
  });
  it("applies changed types and positions, and bypasses individual or removed bands", async () => {
    const band = {
      id: 1,
      type: "notch" as const,
      frequency: 250,
      gain: 0,
      q: 2,
      enabled: true,
    };
    const withBands = (bands: import("../../src/document/mixer").EqBand[]) => ({
      ...DEFAULT_CHANNEL,
      eq: { ...DEFAULT_CHANNEL.eq, enabled: true, bands },
    });
    const dry = rms((await render(withBands([]))).getChannelData(0));
    const notch = rms((await render(withBands([band]))).getChannelData(0));
    const moved = rms(
      (await render(withBands([{ ...band, frequency: 4000 }]))).getChannelData(
        0,
      ),
    );
    const bell = rms(
      (
        await render(withBands([{ ...band, type: "peaking", gain: 6 }]))
      ).getChannelData(0),
    );
    const bypass = rms(
      (await render(withBands([{ ...band, enabled: false }]))).getChannelData(
        0,
      ),
    );
    expect(notch).toBeLessThan(dry * 0.01);
    expect(moved).toBeGreaterThan(dry * 0.98);
    expect(bell).toBeGreaterThan(dry * 1.9);
    expect(bypass).toBeCloseTo(dry, 6);
  });
});
