/**
 * FX-strip logic (DES-5, pure — no DOM, no store import).
 *
 * Everything the lit console strip renders and commits funnels through these
 * pure functions/tables so the module-list semantics, reorder/keyboard-move
 * math, slider mappings (log cutoff) and live numeric readout formatting are
 * testable without a browser (scaleChip.ts pattern).
 *
 * Schema is the authority for param names (schema.ts FxDevice): filter
 * kind/cutoffHz/q · drive amount · bitcrusher bits/downsample · delay
 * timeSteps/feedback/mix · reverb size/mix. The UI's world-vocabulary labels
 * (FILTER/DRIVE/CRUSH/DELAY/REVERB, sync units 1/8 · 1/8. · 1/4 · 1/2) map
 * onto those names; delay sync units map to 16th steps (2/3/4/8).
 */

import { reverbSeconds } from "../audio/fx";
import type { FxDevice, LaneId, ProjectDocument } from "../document/schema";
import { MAX_FX_PER_LANE } from "../document/schema";

export type FxDeviceType = FxDevice["type"];

/** Add-menu order (world vocabulary). */
export const FX_DEVICE_TYPES: readonly FxDeviceType[] = [
  "filter",
  "drive",
  "bitcrusher",
  "delay",
  "reverb",
];

/** Silkscreen module labels (world vocabulary). */
export const FX_DEVICE_LABELS: Readonly<Record<FxDeviceType, string>> = {
  filter: "FILTER",
  drive: "DRIVE",
  bitcrusher: "CRUSH",
  delay: "DELAY",
  reverb: "REVERB",
};

/** Factory defaults for the add action (musically neutral starting points). */
export function defaultFxDevice(type: FxDeviceType): FxDevice {
  switch (type) {
    case "filter":
      return {
        type: "filter",
        bypassed: false,
        params: { kind: "lowpass", cutoffHz: 8000, q: 1 },
      };
    case "drive":
      return { type: "drive", bypassed: false, params: { amount: 0.3 } };
    case "bitcrusher":
      return {
        type: "bitcrusher",
        bypassed: false,
        params: { bits: 8, downsample: 4 },
      };
    case "delay":
      return {
        type: "delay",
        bypassed: false,
        params: { timeSteps: 2, feedback: 0.35, mix: 0.35 },
      };
    case "reverb":
      return {
        type: "reverb",
        bypassed: false,
        params: { size: 0.4, mix: 0.3 },
      };
  }
}

// ---------------------------------------------------------------------------
// Param descriptors (drives both rendering and the readout formatting)
// ---------------------------------------------------------------------------

/** A continuous numeric param rendered as a range slider. */
export interface FxSliderSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Log-map the slider position (cutoff only; slider is 0–1000). */
  readonly log?: boolean;
}

/** A discrete param rendered as a select. */
export interface FxChoiceSpec<V extends string | number = string | number> {
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: V; readonly label: string }[];
}

const FILTER_KIND: FxChoiceSpec<"lowpass" | "highpass" | "bandpass"> = {
  key: "kind",
  label: "TYPE",
  options: [
    { value: "lowpass", label: "LP" },
    { value: "highpass", label: "HP" },
    { value: "bandpass", label: "BP" },
  ],
};

/** Delay sync units over the 16th-step grid (task vocabulary → timeSteps). */
export const DELAY_SYNC_UNITS: readonly {
  readonly steps: number;
  readonly label: string;
}[] = [
  { steps: 2, label: "1/8" },
  { steps: 3, label: "1/8." },
  { steps: 4, label: "1/4" },
  { steps: 8, label: "1/2" },
];

const DELAY_SYNC: FxChoiceSpec<number> = {
  key: "timeSteps",
  label: "SYNC",
  options: DELAY_SYNC_UNITS.map((u) => ({ value: u.steps, label: u.label })),
};

export interface FxDeviceSpec {
  readonly type: FxDeviceType;
  readonly label: string;
  readonly sliders: readonly FxSliderSpec[];
  readonly choices: readonly FxChoiceSpec<never>[];
}

// `choices` is heterogeneous per device; one erased cast keeps the table flat.
export const FX_DEVICE_SPECS: Readonly<Record<FxDeviceType, FxDeviceSpec>> = {
  filter: {
    type: "filter",
    label: FX_DEVICE_LABELS.filter,
    sliders: [
      {
        key: "cutoffHz",
        label: "CUTOFF",
        min: 20,
        max: 20000,
        step: 1,
        log: true,
      },
      { key: "q", label: "Q", min: 0.1, max: 18, step: 0.1 },
    ],
    choices: [FILTER_KIND as unknown as FxChoiceSpec<never>],
  },
  drive: {
    type: "drive",
    label: FX_DEVICE_LABELS.drive,
    sliders: [{ key: "amount", label: "AMOUNT", min: 0, max: 1, step: 0.01 }],
    choices: [],
  },
  bitcrusher: {
    type: "bitcrusher",
    label: FX_DEVICE_LABELS.bitcrusher,
    sliders: [
      { key: "bits", label: "BITS", min: 1, max: 16, step: 1 },
      { key: "downsample", label: "DECIMATE", min: 1, max: 64, step: 1 },
    ],
    choices: [],
  },
  delay: {
    type: "delay",
    label: FX_DEVICE_LABELS.delay,
    sliders: [
      { key: "feedback", label: "FEEDBACK", min: 0, max: 0.95, step: 0.01 },
      { key: "mix", label: "MIX", min: 0, max: 1, step: 0.01 },
    ],
    choices: [DELAY_SYNC as unknown as FxChoiceSpec<never>],
  },
  reverb: {
    type: "reverb",
    label: FX_DEVICE_LABELS.reverb,
    sliders: [
      { key: "size", label: "SIZE", min: 0, max: 1, step: 0.01 },
      { key: "mix", label: "MIX", min: 0, max: 1, step: 0.01 },
    ],
    choices: [],
  },
};

// ---------------------------------------------------------------------------
// Module list (the strip's render model)
// ---------------------------------------------------------------------------

export interface FxModule {
  readonly index: number;
  readonly device: FxDevice;
  readonly spec: FxDeviceSpec;
}

/** Render model: chain order + specs, straight from the document. */
export function fxModuleList(chain: readonly FxDevice[]): readonly FxModule[] {
  return chain.map((device, index) => ({
    index,
    device,
    spec: FX_DEVICE_SPECS[device.type],
  }));
}

export function laneFxChain(
  doc: ProjectDocument,
  lane: LaneId,
): readonly FxDevice[] {
  return doc.lanes.find((l) => l.id === lane)?.fxChain ?? [];
}

export function fxChainFull(chain: readonly FxDevice[]): boolean {
  return chain.length >= MAX_FX_PER_LANE;
}

// ---------------------------------------------------------------------------
// Reorder + keyboard-move math (shared by drag-drop and move buttons)
// ---------------------------------------------------------------------------

/** Clamp a target index into [0, len). */
export function moveIndex(to: number, len: number): number {
  return Math.min(len - 1, Math.max(0, to));
}

/** Keyboard/drag move by delta; true when the move would change anything. */
export function canMoveFx(index: number, delta: -1 | 1, len: number): boolean {
  const target = index + delta;
  return target >= 0 && target < len;
}

/** Pure reorder (returns input identity for no-ops). */
export function reorderChain(
  chain: readonly FxDevice[],
  from: number,
  to: number,
): readonly FxDevice[] {
  const len = chain.length;
  if (from < 0 || from >= len) return chain;
  const target = moveIndex(to, len);
  if (target === from) return chain;
  const next = [...chain];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

// ---------------------------------------------------------------------------
// Slider mappings (log cutoff — usable keyboard steps at both ends)
// ---------------------------------------------------------------------------

const CUTOFF_MIN = 20;
const CUTOFF_MAX = 20000;
const CUTOFF_LOG = Math.log(CUTOFF_MAX / CUTOFF_MIN);

/** Hz → 0..1000 slider position. */
export function cutoffToSlider(hz: number): number {
  const clamped = Math.min(CUTOFF_MAX, Math.max(CUTOFF_MIN, hz));
  return Math.round((Math.log(clamped / CUTOFF_MIN) / CUTOFF_LOG) * 1000);
}

/** 0..1000 slider position → Hz. */
export function sliderToCutoff(slider: number): number {
  const t = Math.min(1, Math.max(0, slider / 1000));
  return Math.round(CUTOFF_MIN * Math.exp(t * CUTOFF_LOG));
}

/** The numeric value a param's range input should carry. */
export function paramToSlider(spec: FxSliderSpec, value: number): number {
  return spec.log ? cutoffToSlider(value) : value;
}

/** Back from the range input to the document value. */
export function sliderToParam(spec: FxSliderSpec, slider: number): number {
  return spec.log ? sliderToCutoff(slider) : slider;
}

// ---------------------------------------------------------------------------
// Live numeric readouts (--font-value; the variable-font-specimen raise)
// ---------------------------------------------------------------------------

function hz(hzValue: number): string {
  return hzValue >= 1000
    ? `${(hzValue / 1000).toFixed(1)} kHz`
    : `${Math.round(hzValue)} Hz`;
}

function pct(unitInterval: number): string {
  return `${Math.round(unitInterval * 100)} %`;
}

/** Format any param value with its unit (readouts + aria-valuetext). */
export function formatFxParam(
  type: FxDeviceType,
  key: string,
  value: number | string,
): string {
  switch (`${type}.${key}`) {
    case "filter.kind":
      return (
        FILTER_KIND.options.find((o) => o.value === value)?.label ??
        String(value)
      );
    case "filter.cutoffHz":
      return hz(value as number);
    case "filter.q":
      return `${(value as number).toFixed(1)} Q`;
    case "drive.amount":
      return pct(value as number);
    case "bitcrusher.bits":
      return `${value} BIT`;
    case "bitcrusher.downsample":
      return `×${value}`;
    case "delay.timeSteps":
      return (
        DELAY_SYNC_UNITS.find((u) => u.steps === value)?.label ?? `${value}/16`
      );
    case "delay.feedback":
    case "delay.mix":
    case "reverb.mix":
      return pct(value as number);
    case "reverb.size":
      // 0..1 size knob → 0.7–1.5 s decay (reverbSeconds, RES-4 cap).
      return `${reverbSeconds(value as number).toFixed(1)} S`;
    default:
      return String(value);
  }
}
