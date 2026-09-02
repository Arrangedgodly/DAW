/**
 * PX-2 browser test — every preset in the library must render correctly
 * through the REAL engine (OfflineAudioContext + voice-engine worklet):
 * non-silent, no NaN/Infinity, and peak within sane bounds. Extends the
 * voice-load pattern (one lane, one event) across the whole content set.
 */

import { describe, expect, it } from "vitest";
import {
  DRUM_KITS,
  PRESET_LIBRARY,
  noteParamsFor,
  type VoicePreset,
} from "../../src/audio/presets";
import { DRUM_PIECES } from "../../src/document/schema";
import { findNonFinite, renderOffline } from "./helpers";

/** Representative middle-of-lane MIDI note per pitched lane. */
const LANE_MIDI = { bass: 40, chords: 55, lead: 67 } as const;

function renderDuration(p: VoicePreset): number {
  const { attack, decay, release } = p.envelope;
  return attack + decay + 0.4 /* hold */ + release + 0.3 /* tail margin */;
}

interface RenderStats {
  readonly peak: number;
  readonly nonFinite: number;
}

async function renderPresetOnce(p: VoicePreset, midi?: number): Promise<RenderStats> {
  const ev = noteParamsFor(p, { time: 0.05, midi, holdSeconds: 0.4 });
  const { mono } = await renderOffline({
    startTime: 0.05,
    duration: renderDuration(p) + 0.05,
    lanes: [[ev]],
  });
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  return { peak, nonFinite: findNonFinite(mono) };
}

describe("preset library renders correctly through the real engine", () => {
  it("every pitched preset is audible, finite, and within sane peak bounds", async () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      const lane = p.id.split("-")[1] as keyof typeof LANE_MIDI;
      const { peak, nonFinite } = await renderPresetOnce(p, LANE_MIDI[lane]);
      expect(nonFinite, `${p.id} produced NaN/Infinity`).toBe(0);
      expect(peak, `${p.id} rendered silent`).toBeGreaterThan(0.01);
      expect(peak, `${p.id} peak out of sane bounds`).toBeLessThanOrEqual(1.2);
    }
  }, 120_000);

  it("every drum kit piece is audible, finite, and within sane peak bounds", async () => {
    for (const kit of Object.values(DRUM_KITS)) {
      for (const pieceName of DRUM_PIECES) {
        const { peak, nonFinite } = await renderPresetOnce(kit.pieces[pieceName]);
        expect(nonFinite, `${kit.id}.${pieceName} produced NaN/Infinity`).toBe(0);
        expect(peak, `${kit.id}.${pieceName} rendered silent`).toBeGreaterThan(0.005);
        expect(peak, `${kit.id}.${pieceName} peak out of sane bounds`).toBeLessThanOrEqual(1.2);
      }
    }
  }, 120_000);
});
