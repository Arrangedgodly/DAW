/**
 * HW-2 — audio determinism suite (D8 audio layer / RES-7).
 *
 * 1. Double-render determinism, parameterized: three projects (plain, swing
 *    0.5, full-FX chains on every lane) rendered TWICE each through the REAL
 *    worklet + FX graph must be BIT-IDENTICAL — hashed (SHA-256 over the
 *    Float32 channel bytes) AND sample-compared with float equality. This
 *    extends the IM-5 single-case proof into a configuration sweep: swing
 *    (time-math path) and every FX device (native DSP + seeded IR/delay
 *    paths) are all exercised for same-input → same-output.
 * 2. Cross-config stability: the render path must always build its context
 *    at exactly 44100 Hz (D2 "explicit 44100 Hz"). The injected factory
 *    receives the export rate; a factory that produces another rate must be
 *    rejected by the render's own guard (throws) instead of silently
 *    rescaling the loop.
 *
 * The render-fingerprint canary (expected-hash drift warning) lives in
 * render-fingerprint.test.ts; the NaN/Inf scan is the shared
 * assertCleanAudio helper (helpers.ts), reused here.
 */

import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../../src/document/schema";
import { createDemoProject } from "../../src/document/demoSong";
import type { ProjectDocument, PitchedCell } from "../../src/document/schema";
import {
  renderProjectToBuffer,
  EXPORT_SAMPLE_RATE,
} from "../../src/audio/render";
import { assertCleanAudio, hashChannelsHex } from "./helpers";

/** Default project with drums on 0/4/8/12 and one lead note at step 0. */
function projectPlain(): ProjectDocument {
  const doc = createDefaultProject();
  const drums = doc.patterns.drums[0];
  drums.steps.kick = [true, ...new Array(15).fill(false)];
  for (const s of [4, 8, 12]) drums.steps.kick[s] = true;
  const lead = doc.patterns.lead[0];
  lead.rows[3].steps[0] = 1;
  return doc;
}

/** Same content, maximum musical swing (odd 16ths delayed half a step). */
function projectSwing(): ProjectDocument {
  const doc = projectPlain();
  const lead = doc.patterns.lead[0];
  // Also place notes on odd steps so swing actually moves content.
  const wide = new Array(16).fill(0);
  wide[0] = 1;
  wide[3] = 1;
  wide[9] = 1;
  lead.rows[3].steps = wide as PitchedCell[];
  doc.transport = { ...doc.transport, swing: 0.5 };
  return doc;
}

/**
 * Full-FX: all five devices spread across lanes (each lane at most 3,
 * MAX_FX_PER_LANE). Exercises filter/drive/bitcrusher (native + worklet),
 * synced delay (feedback loop), seeded reverb IR (xorshift32, laneSeed) and
 * the tail budget in one render.
 */
function projectFullFx(): ProjectDocument {
  const doc = projectSwing();
  doc.lanes.find((l) => l.id === "drums")!.fxChain = [
    { type: "drive", bypassed: false, params: { amount: 0.4 } },
    { type: "bitcrusher", bypassed: false, params: { bits: 6, downsample: 3 } },
  ];
  doc.lanes.find((l) => l.id === "bass")!.fxChain = [
    {
      type: "filter",
      bypassed: false,
      params: { kind: "lowpass", cutoffHz: 900, q: 1.2 },
    },
  ];
  doc.lanes.find((l) => l.id === "chords")!.fxChain = [
    {
      type: "delay",
      bypassed: false,
      params: { timeSteps: 3, feedback: 0.35, mix: 0.3 },
    },
    { type: "reverb", bypassed: false, params: { size: 0.5, mix: 0.3 } },
  ];
  doc.lanes.find((l) => l.id === "lead")!.fxChain = [
    { type: "reverb", bypassed: false, params: { size: 0.35, mix: 0.35 } },
    {
      type: "filter",
      bypassed: false,
      params: { kind: "highpass", cutoffHz: 200, q: 0.8 },
    },
    { type: "drive", bypassed: false, params: { amount: 0.2 } },
  ];
  return doc;
}

interface DeterminismCase {
  name: string;
  doc: () => ProjectDocument;
}

const CASES: DeterminismCase[] = [
  { name: "plain (no FX, no swing)", doc: projectPlain },
  { name: "swing 0.5 with off-grid notes", doc: projectSwing },
  { name: "full-FX chains on every lane", doc: projectFullFx },
  // HW-4 regression: this suite's own projects never sounded more than 2
  // lanes, and OfflineAudioContext fan-in with 4+ parallel branches was
  // found (HW-4 e2e byte-compare) to sum nondeterministically at the last
  // float ULP — fixed in render.ts by serial-chaining the lane sums. The
  // dense 4-sounding-lane demo pins that fix.
  {
    name: "demo song (4 dense lanes, 4-pattern chains)",
    doc: createDemoProject,
  },
];

describe("HW-2 double-render determinism (real worklet + FX graph)", () => {
  it.each(CASES)(
    "same project rendered twice is bit-identical: $name",
    { timeout: 120000 },
    async ({ doc }) => {
      const [a, b] = await Promise.all([
        renderProjectToBuffer(doc()),
        renderProjectToBuffer(doc()),
      ]);

      // Metadata identical (loop/tail math is pure — swing must not move it).
      expect(a.loopSamples).toBe(b.loopSamples);
      expect(a.tailSamples).toBe(b.tailSamples);
      expect(a.loopSteps).toBe(b.loopSteps);
      expect(a.sampleRate).toBe(EXPORT_SAMPLE_RATE);
      expect(b.sampleRate).toBe(EXPORT_SAMPLE_RATE);

      // Bit-identity, both directions: hash equality AND per-sample float
      // equality (the hash proves totality; the loop pinpoints any drift).
      const [ha, hb] = await Promise.all([
        hashChannelsHex(a.channels),
        hashChannelsHex(b.channels),
      ]);
      expect(ha).toBe(hb);
      expect(a.channels).toHaveLength(2);
      for (let c = 0; c < 2; c++) {
        const ca = a.channels[c];
        const cb = b.channels[c];
        expect(ca.length).toBe(cb.length);
        for (let i = 0; i < ca.length; i++) {
          if (ca[i] !== cb[i]) {
            expect.fail(`channel ${c} sample ${i}: ${ca[i]} !== ${cb[i]}`);
          }
        }
      }

      // Sanity: the render is real audio and uncontaminated (shared scan).
      assertCleanAudio(a.channels, "determinism render a");
    },
  );
});

describe("HW-2 cross-config sample-rate stability (44100 law)", () => {
  it(
    "render path always requests 2ch @ 44100 from its context factory",
    { timeout: 90000 },
    async () => {
      const seen: { channels: number; length: number; sampleRate: number }[] =
        [];
      const result = await renderProjectToBuffer(projectPlain(), {
        createContext: (channels, length, sampleRate) => {
          seen.push({ channels, length, sampleRate });
          return new OfflineAudioContext(channels, length, sampleRate);
        },
      });
      expect(seen).toHaveLength(1);
      expect(seen[0].channels).toBe(2);
      expect(seen[0].sampleRate).toBe(EXPORT_SAMPLE_RATE);
      expect(seen[0].length).toBe(result.loopSamples + result.tailSamples);
      expect(result.sampleRate).toBe(EXPORT_SAMPLE_RATE);
    },
  );

  it(
    "a factory building contexts at another rate is rejected (throws)",
    { timeout: 90000 },
    async () => {
      await expect(
        renderProjectToBuffer(projectPlain(), {
          // Hostile factory: ignores the requested rate (48 kHz device rate).
          createContext: (channels, length) =>
            new OfflineAudioContext(channels, length, 48000),
        }),
      ).rejects.toThrow(/44100/);
    },
  );
});
