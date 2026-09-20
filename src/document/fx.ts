import * as v from "valibot";

export type FxDevice =
  | {
      readonly type: "filter";
      readonly bypassed: boolean;
      readonly params: {
        readonly kind?: "lowpass" | "highpass" | "bandpass";
        readonly cutoffHz: number;
        readonly q: number;
      };
    }
  | {
      readonly type: "drive";
      readonly bypassed: boolean;
      readonly params: { readonly amount: number };
    }
  | {
      readonly type: "bitcrusher";
      readonly bypassed: boolean;
      readonly params: { readonly bits: number; readonly downsample: number };
    }
  | {
      readonly type: "delay";
      readonly bypassed: boolean;
      readonly params: {
        readonly timeSteps: number;
        readonly feedback: number;
        readonly mix: number;
      };
    }
  | {
      readonly type: "reverb";
      readonly bypassed: boolean;
      readonly params: { readonly size: number; readonly mix: number };
    };

export const MAX_FX_PER_LANE = 3;
export const MAX_FX_PER_MASTER = 8;

const UnitInterval = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

export const FxDeviceSchema = v.variant("type", [
  v.strictObject({
    type: v.literal("filter"),
    bypassed: v.boolean(),
    params: v.strictObject({
      // IM-4: response kind; omitted = lowpass (v1 documents written before
      // the field existed stay valid — MF-1 schema stays backward compatible).
      kind: v.optional(v.picklist(["lowpass", "highpass", "bandpass"])),
      cutoffHz: v.pipe(v.number(), v.minValue(20), v.maxValue(20000)),
      q: v.pipe(v.number(), v.minValue(0.1), v.maxValue(18)),
    }),
  }),
  v.strictObject({
    type: v.literal("drive"),
    bypassed: v.boolean(),
    params: v.strictObject({ amount: UnitInterval }),
  }),
  v.strictObject({
    type: v.literal("bitcrusher"),
    bypassed: v.boolean(),
    params: v.strictObject({
      bits: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
      downsample: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(1),
        v.maxValue(64),
      ),
    }),
  }),
  v.strictObject({
    type: v.literal("delay"),
    bypassed: v.boolean(),
    params: v.strictObject({
      timeSteps: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
      feedback: v.pipe(v.number(), v.minValue(0), v.maxValue(0.95)),
      mix: UnitInterval,
    }),
  }),
  v.strictObject({
    type: v.literal("reverb"),
    bypassed: v.boolean(),
    params: v.strictObject({ size: UnitInterval, mix: UnitInterval }),
  }),
]);
