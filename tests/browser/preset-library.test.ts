/**
 * PX-2 browser test — every preset in the library must render correctly
 * through the REAL engine (OfflineAudioContext + voice-engine worklet):
 * non-silent, no NaN/Infinity, and peak within sane bounds. Extends the
 * voice-load pattern (one lane, one event) across the whole content set.
 *
 * PS-4 extension: the library now includes the committed sample content —
 * 4 recorded drum kits + 6 pitched one-shot voices. Those route through the
 * REAL native SampleVoiceHost (helpers.renderOffline decodes each asset on
 * the offline context before scheduling, the render parity law), so the
 * same gates now prove every committed OGG fetches, decodes, and sounds
 * through the production path.
 */

import { describe, expect, it } from "vitest";
import {
  DRUM_KITS,
  PRESET_LIBRARY,
  noteParamsFor,
  type VoicePreset,
} from "../../src/audio/presets";
import { DRUM_PIECES } from "../../src/document/schema";
import { soundFamily } from "../../src/components/laneMeta";
import { findNonFinite, hashChannelsHex, renderOffline } from "./helpers";

function renderDuration(p: VoicePreset): number {
  const { attack, decay, release } = p.envelope;
  return attack + decay + 0.4 /* hold */ + release + 0.3; /* tail margin */
}

interface RenderStats {
  readonly peak: number;
  readonly nonFinite: number;
  readonly fingerprint: string;
}

async function renderPresetOnce(
  p: VoicePreset,
  midi?: number,
): Promise<RenderStats> {
  const ev = {
    ...noteParamsFor(p, { time: 0.05, midi, holdSeconds: 0.4 }),
    seed: 123,
  };
  const { mono } = await renderOffline({
    startTime: 0.05,
    duration: Math.max(4, renderDuration(p) + 0.05),
    lanes: [[ev]],
  });
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  // A fixed window and fixed excitation seed catch identical voices hidden
  // behind different labels, seed values, or render lengths.
  return {
    peak,
    nonFinite: findNonFinite(mono),
    fingerprint: await hashChannelsHex([mono.slice(0, 44100 * 4)]),
  };
}

describe("preset library renders correctly through the real engine", () => {
  it("every pitched preset is audible, finite, and within sane peak bounds", async () => {
    const fingerprints = new Map<string, string>();
    for (const p of Object.values(PRESET_LIBRARY)) {
      const { peak, nonFinite, fingerprint } = await renderPresetOnce(p, 60);
      expect(nonFinite, `${p.id} produced NaN/Infinity`).toBe(0);
      expect(peak, `${p.id} rendered silent`).toBeGreaterThan(0.01);
      expect(peak, `${p.id} peak out of sane bounds`).toBeLessThanOrEqual(1.2);
      const key = `${soundFamily(p.id)}:${fingerprint}`;
      expect(
        fingerprints.has(key),
        `${p.id} repeats ${fingerprints.get(key)} at the same pitch and seed`,
      ).toBe(false);
      fingerprints.set(key, p.id);
    }
  }, 240_000);

  it("every drum kit piece is audible, finite, and within sane peak bounds", async () => {
    const extraFingerprints = new Map<string, string>();
    for (const kit of Object.values(DRUM_KITS)) {
      const kitFingerprints = new Set<string>();
      for (const pieceName of DRUM_PIECES) {
        const { peak, nonFinite, fingerprint } = await renderPresetOnce(
          kit.pieces[pieceName],
        );
        expect(nonFinite, `${kit.id}.${pieceName} produced NaN/Infinity`).toBe(
          0,
        );
        expect(peak, `${kit.id}.${pieceName} rendered silent`).toBeGreaterThan(
          0.005,
        );
        expect(
          peak,
          `${kit.id}.${pieceName} peak out of sane bounds`,
        ).toBeLessThanOrEqual(1.2);
        expect(
          kitFingerprints.has(fingerprint),
          `${kit.id}.${pieceName} repeats another slot`,
        ).toBe(false);
        kitFingerprints.add(fingerprint);
        if (DRUM_PIECES.indexOf(pieceName) >= 6) {
          expect(
            extraFingerprints.has(fingerprint),
            `${kit.id}.${pieceName} repeats ${extraFingerprints.get(fingerprint)}`,
          ).toBe(false);
          extraFingerprints.set(fingerprint, `${kit.id}.${pieceName}`);
        }
      }
    }
  }, 240_000);

  it("PS-4: every pitched sample preset is distinct in the render (identity, not just presence)", async () => {
    // The identity law at audio level: two different recorded voices must
    // produce different renders (fingerprints over the real native path).
    const render = async (id: string) => {
      const p = PRESET_LIBRARY[id]!;
      const { mono } = await renderOffline({
        startTime: 0.05,
        duration: renderDuration(p) + 0.05,
        lanes: [
          [
            noteParamsFor(p, {
              time: 0.05,
              midi: 60,
              holdSeconds: 0.4,
            }),
          ],
        ],
      });
      return await hashChannelsHex([mono]);
    };
    const seen = new Map<string, string>();
    for (const p of Object.values(PRESET_LIBRARY)) {
      if (p.voiceType !== "sample" || p.pitchRange === undefined) continue;
      const fp = await render(p.id);
      expect(
        seen.has(fp),
        `${p.id} renders identically to ${seen.get(fp)}`,
      ).toBe(false);
      seen.set(fp, p.id);
    }
    expect(seen.size).toBe(6);
  }, 240_000);
});
