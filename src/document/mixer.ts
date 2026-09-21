import * as v from "valibot";
import { FxDeviceSchema, MAX_FX_PER_MASTER } from "./fx";

const bounded = (min: number, max: number) =>
  v.pipe(v.number(), v.finite(), v.minValue(min), v.maxValue(max));
export const EQ_BAND_TYPES = [
  "peaking",
  "lowshelf",
  "highshelf",
  "highpass",
  "lowpass",
  "notch",
  "bandpass",
] as const;
export const MAX_EQ_BANDS = 8;
export const EqBandSchema = v.strictObject({
  id: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_EQ_BANDS)),
  type: v.picklist(EQ_BAND_TYPES),
  frequency: bounded(20, 20000),
  gain: bounded(-18, 18),
  q: bounded(0.1, 18),
  enabled: v.boolean(),
});
export const EqSchema = v.strictObject({
  enabled: v.boolean(),
  lowCut: bounded(20, 400),
  low: bounded(-12, 12),
  mid: bounded(-12, 12),
  midHz: bounded(150, 8000),
  high: bounded(-12, 12),
  // Absent on older documents. Explicit bands, including an empty array, take precedence.
  bands: v.optional(
    v.pipe(
      v.array(EqBandSchema),
      v.maxLength(MAX_EQ_BANDS),
      v.check(
        (bands) => new Set(bands.map((b) => b.id)).size === bands.length,
        "EQ band IDs must be unique",
      ),
    ),
  ),
});
export const CompressorSchema = v.strictObject({
  enabled: v.boolean(),
  threshold: bounded(-60, 0),
  ratio: bounded(1, 12),
  attack: bounded(0.001, 0.1),
  release: bounded(0.02, 1),
  makeup: bounded(0, 12),
});
export const ChannelProcessingSchema = v.strictObject({
  pan: bounded(-1, 1),
  locked: v.boolean(),
  eq: EqSchema,
  compressor: CompressorSchema,
});
export const MasterProcessingSchema = v.strictObject({
  fxChain: v.optional(
    v.pipe(v.array(FxDeviceSchema), v.maxLength(MAX_FX_PER_MASTER)),
  ),
  gainDb: bounded(-24, 6),
  compressor: CompressorSchema,
  limiter: v.strictObject({
    enabled: v.boolean(),
    ceiling: bounded(-12, -0.1),
    release: bounded(0.02, 0.5),
  }),
});
export const MixerSchema = v.strictObject({
  channels: v.strictObject({
    drums: v.optional(ChannelProcessingSchema),
    bass: v.optional(ChannelProcessingSchema),
    chords: v.optional(ChannelProcessingSchema),
    lead: v.optional(ChannelProcessingSchema),
    extra1: v.optional(ChannelProcessingSchema),
    extra2: v.optional(ChannelProcessingSchema),
    extra3: v.optional(ChannelProcessingSchema),
    extra4: v.optional(ChannelProcessingSchema),
  }),
  master: MasterProcessingSchema,
});
export type Equalizer = v.InferOutput<typeof EqSchema>;
export type EqBand = v.InferOutput<typeof EqBandSchema>;
export const eqBandHasGain = (band: EqBand) =>
  ["peaking", "lowshelf", "highshelf"].includes(band.type);
export const eqBandHasQ = (band: EqBand) =>
  !["lowshelf", "highshelf"].includes(band.type);
/** Lazy conversion preserves the exact four-filter topology of existing mixes. */
export function equalizerBands(eq: Equalizer): readonly EqBand[] {
  return (
    eq.bands ?? [
      {
        id: 1,
        type: "highpass",
        frequency: eq.lowCut,
        gain: 0,
        q: Math.SQRT1_2,
        enabled: true,
      },
      {
        id: 2,
        type: "lowshelf",
        frequency: 150,
        gain: eq.low,
        q: 1,
        enabled: true,
      },
      {
        id: 3,
        type: "peaking",
        frequency: eq.midHz,
        gain: eq.mid,
        q: 0.7,
        enabled: true,
      },
      {
        id: 4,
        type: "highshelf",
        frequency: 6000,
        gain: eq.high,
        q: 1,
        enabled: true,
      },
    ]
  );
}
export type Compressor = v.InferOutput<typeof CompressorSchema>;
export type ChannelProcessing = v.InferOutput<typeof ChannelProcessingSchema>;
export type MasterProcessing = v.InferOutput<typeof MasterProcessingSchema>;
export type MixerSettings = v.InferOutput<typeof MixerSchema>;
export const DEFAULT_EQ: Equalizer = {
  enabled: false,
  lowCut: 20,
  low: 0,
  mid: 0,
  midHz: 350,
  high: 0,
};
export const DEFAULT_COMPRESSOR: Compressor = {
  enabled: false,
  threshold: -18,
  ratio: 2,
  attack: 0.025,
  release: 0.15,
  makeup: 0,
};
export const DEFAULT_CHANNEL: ChannelProcessing = {
  pan: 0,
  locked: false,
  eq: DEFAULT_EQ,
  compressor: DEFAULT_COMPRESSOR,
};
export const DEFAULT_MASTER: MasterProcessing = {
  gainDb: 0,
  compressor: DEFAULT_COMPRESSOR,
  limiter: { enabled: false, ceiling: -1, release: 0.08 },
};
export const DEFAULT_MIXER: MixerSettings = {
  channels: {},
  master: DEFAULT_MASTER,
};
