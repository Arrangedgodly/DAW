import type { LaneId, ProjectDocument } from "../document/schema";
import {
  DEFAULT_CHANNEL,
  DEFAULT_MIXER,
  type MixerSettings,
} from "../document/mixer";
import { dbToGain, gainToDb } from "./mixer";

export interface AudioStats {
  peak: number;
  activeDb: number;
  crest: number;
  lowMidRatio: number;
  active: boolean;
}
export interface ArrangementContext {
  /** Fraction of a track's musical energy that plays alongside another track. */
  overlap: Partial<Record<LaneId, Partial<Record<LaneId, number>>>>;
  master: AudioStats;
}

/** Compare tracks in time, so a pad in a lead break is not treated as masking it. */
export function measureArrangementContext(
  stems: readonly (readonly Float32Array[])[],
  ids: readonly LaneId[],
  master: readonly Float32Array[],
  sampleRate: number,
): ArrangementContext {
  const block = Math.max(1, Math.round(sampleRate / 10));
  const length = Math.max(0, ...stems.map((s) => s[0]?.length ?? 0));
  const windows = stems.map((channels) => {
    const energy: number[] = [];
    for (let offset = 0; offset < length; offset += block) {
      const end = Math.min(length, offset + block);
      let sum = 0;
      for (const channel of channels)
        for (let i = offset; i < end; i++) {
          const x = channel[i] ?? 0;
          if (Number.isFinite(x)) sum += x * x;
        }
      energy.push(sum / Math.max(1, (end - offset) * channels.length));
    }
    const threshold = Math.max(1e-7, Math.max(0, ...energy) / 64);
    return energy.map((value) => (value >= threshold ? value : 0));
  });
  const overlap: ArrangementContext["overlap"] = {};
  ids.forEach((id, i) => {
    const primary = windows[i] ?? [];
    const total = primary.reduce((sum, value) => sum + value, 0);
    if (!total) return;
    const others: Partial<Record<LaneId, number>> = {};
    ids.forEach((other, j) => {
      if (i === j) return;
      others[other] =
        primary.reduce(
          (sum, value, index) => sum + (windows[j]?.[index] ? value : 0),
          0,
        ) / total;
    });
    overlap[id] = others;
  });
  return { overlap, master: measureStereo(master, sampleRate) };
}
/** Active 100 ms windows exclude rests. This is RMS, not an LUFS estimate. */
export function measureAudio(
  samples: Float32Array,
  sampleRate: number,
): AudioStats {
  const block = Math.max(1, Math.round(sampleRate / 10));
  let peak = 0,
    total = 0,
    count = 0,
    low = 0,
    broad = 0,
    lowMid = 0,
    energy = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 120) / sampleRate);
  const b = 1 - Math.exp((-2 * Math.PI * 500) / sampleRate);
  for (let offset = 0; offset < samples.length; offset += block) {
    let sum = 0;
    const end = Math.min(samples.length, offset + block);
    for (let i = offset; i < end; i++) {
      const x = Number.isFinite(samples[i]) ? samples[i] : 0;
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      low += a * (x - low);
      broad += b * (x - broad);
      lowMid += (broad - low) ** 2;
      energy += x * x;
    }
    const mean = sum / (end - offset);
    if (mean > 1e-8) {
      total += sum;
      count += end - offset;
    }
  }
  const activeDb = gainToDb(Math.sqrt(total / Math.max(1, count)));
  return {
    peak,
    activeDb,
    crest: gainToDb(peak) - activeDb,
    lowMidRatio: lowMid / Math.max(1e-12, energy),
    active: count > 0,
  };
}
export interface AutoMixOptions {
  amount: number;
  balance: boolean;
  eq: boolean;
  dynamics: boolean;
}
export function measureStereo(
  channels: readonly Float32Array[],
  sampleRate: number,
): AudioStats {
  const stats = channels.map((channel) => measureAudio(channel, sampleRate));
  const activeDb = gainToDb(
    Math.sqrt(
      stats.reduce((sum, s) => sum + dbToGain(s.activeDb) ** 2, 0) /
        Math.max(1, stats.length),
    ),
  );
  const peak = Math.max(0, ...stats.map((s) => s.peak));
  return {
    active: stats.some((s) => s.active),
    activeDb,
    peak,
    crest: gainToDb(peak) - activeDb,
    lowMidRatio:
      stats.reduce((sum, s) => sum + s.lowMidRatio, 0) /
      Math.max(1, stats.length),
  };
}
export interface MixProposal {
  document: ProjectDocument;
  changes: string[];
}
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

export function proposeAutoMix(
  doc: ProjectDocument,
  stats: Partial<Record<LaneId, AudioStats>>,
  options: AutoMixOptions,
  context?: ArrangementContext,
): MixProposal {
  const amount = clamp(options.amount, 0, 1);
  const original = doc.mixer ?? DEFAULT_MIXER;
  const mixer: MixerSettings = {
    channels: { ...original.channels },
    master: original.master,
  };
  const changes: string[] = [];
  const active = doc.lanes.filter(
    (lane) => !lane.mute && stats[lane.id]?.active,
  );
  const levels = active
    .map((lane) => stats[lane.id]!.activeDb)
    .sort((a, b) => a - b);
  if (!levels.length || amount === 0)
    return { document: doc, changes: ["No changes needed."] };
  const reference = levels[Math.floor((levels.length - 1) / 2)];
  const lanes = doc.lanes.map((lane) => {
    const s = stats[lane.id],
      current = original.channels[lane.id] ?? DEFAULT_CHANNEL;
    if (!s?.active || lane.mute || current.locked || (lane.volume ?? 1) === 0)
      return lane;
    let processing = current;
    let volume = lane.volume ?? 1;
    if (options.balance) {
      const leadOverlap = context?.overlap.lead?.[lane.id] ?? 0;
      const role =
        lane.id === "chords"
          ? -1 - 1.5 * leadOverlap
          : lane.id === "bass"
            ? -1
            : lane.id.startsWith("extra")
              ? -1.5 * leadOverlap
              : 0;
      const adjustment = clamp(reference + role - s.activeDb, -3, 3) * amount;
      const next = clamp(volume * dbToGain(adjustment), 0, 1);
      const actual = gainToDb(next / volume);
      if (Math.abs(actual) >= 0.1) {
        volume = next;
        changes.push(
          `${lane.id}: level ${actual > 0 ? "+" : ""}${actual.toFixed(1)} dB${leadOverlap > 0.25 && lane.id !== "lead" ? " because it often plays with lead" : ""}.`,
        );
      }
    }
    // Keep authored EQ/compressor settings. Only add a small, broad correction.
    if (
      options.eq &&
      !current.eq.enabled &&
      current.eq.bands === undefined &&
      s.lowMidRatio > 0.18 &&
      lane.id !== "bass" &&
      lane.id !== "drums" &&
      (lane.id === "lead" || (context?.overlap.lead?.[lane.id] ?? 0) > 0.25)
    ) {
      processing = {
        ...processing,
        eq: { ...current.eq, enabled: true, midHz: 350, mid: -1.5 * amount },
      };
      changes.push(
        `${lane.id}: broad cut of ${(1.5 * amount).toFixed(1)} dB at 350 Hz${(context?.overlap.lead?.[lane.id] ?? 0) > 0.25 ? " to make room for lead" : ""}.`,
      );
    }
    if (options.dynamics && !current.compressor.enabled && s.crest > 14) {
      processing = {
        ...processing,
        compressor: {
          ...current.compressor,
          enabled: true,
          threshold: clamp(gainToDb(s.peak) - 4 * amount, -60, 0),
          ratio: 1 + amount,
          attack: 0.025,
          release: 0.15,
          makeup: 0,
        },
      };
      changes.push(`${lane.id}: gentle compression for isolated peaks.`);
    }
    if (processing !== current) mixer.channels[lane.id] = processing;
    return volume === (lane.volume ?? 1) ? lane : { ...lane, volume };
  });
  if (options.dynamics) {
    // The rendered master gives a useful headroom estimate; the summed stem
    // bound remains the fallback for callers without an arrangement render.
    const peakBound =
      lanes.reduce((sum, lane) => {
        if (lane.mute) return sum;
        return (
          sum +
          ((stats[lane.id]?.peak ?? 0) * (lane.volume ?? 1)) /
            Math.max(1e-6, doc.lanes.find((l) => l.id === lane.id)?.volume ?? 1)
        );
      }, 0) *
      0.9 *
      dbToGain(original.master.gainDb);
    const observedPeak = context?.master.active
      ? context.master.peak
      : peakBound;
    const trim = clamp(-1 - gainToDb(observedPeak), -6, 0) * amount;
    const lift =
      context?.master.active &&
      !original.master.compressor.enabled &&
      !original.master.limiter.enabled
        ? Math.min(
            clamp(-16 - context.master.activeDb, 0, 2),
            clamp(-1 - gainToDb(observedPeak), 0, 2),
          ) * amount
        : 0;
    const gainChange = clamp(trim + lift, -6, 2);
    mixer.master = {
      ...original.master,
      gainDb: clamp(original.master.gainDb + gainChange, -24, 6),
      compressor: original.master.compressor.enabled
        ? original.master.compressor
        : {
            ...original.master.compressor,
            enabled: true,
            threshold: clamp(
              (context?.master.activeDb ?? reference) + 5,
              -30,
              -6,
            ),
            ratio: 1 + 0.75 * amount,
            attack: 0.03,
            release: 0.2,
            makeup: 0,
          },
      limiter: { ...original.master.limiter, enabled: true },
    };
    changes.push(
      `Master: ${Math.abs(gainChange) >= 0.1 ? `${gainChange > 0 ? "+" : ""}${gainChange.toFixed(1)} dB input, ` : ""}gentle glue and sample-peak limiting.`,
    );
  }
  const changed = changes.length > 0;
  return {
    document: changed ? { ...doc, lanes, mixer } : doc,
    changes: changed
      ? changes
      : ["The current mix already fits these limits. No changes needed."],
  };
}
