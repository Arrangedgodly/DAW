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
import type { ProjectDocument } from "../../src/document/schema";
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
  // SC-1 v2: `rows[3].steps[0] = 1` → a lone note-on under the default lead
  // gate (2 steps). Same content, same audio.
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  lead.notes = [{ degree: 3, start: 0, length: 2 }];
  return doc;
}

/** Same content, maximum musical swing (odd 16ths delayed half a step). */
function projectSwing(): ProjectDocument {
  const doc = projectPlain();
  const lead = doc.patterns.lead[0];
  // Also place notes on odd steps so swing actually moves content.
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  lead.notes = [
    { degree: 3, start: 0, length: 2 },
    { degree: 3, start: 3, length: 2 },
    { degree: 3, start: 9, length: 2 },
  ];
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

/**
 * XP-1 (i3-5): the 128-bar worst case — one lane at the top of the v3
 * powers-of-two vocabulary (2048 steps ≈ 4.3 min @120 BPM) against the
 * default 1-bar lanes. The export cycle is the LCM = 2048 steps; drums
 * four-on-the-floor across the whole extent keeps real signal everywhere
 * (the fold seam included).
 */
function project128Bars(): ProjectDocument {
  const doc = projectPlain();
  const drums = doc.patterns.drums[0];
  if (drums.kind !== "drums") throw new Error("expected drums");
  drums.bars = 128;
  const len = 128 * 16;
  drums.steps = {
    kick: Array.from({ length: len }, (_, i) => i % 4 === 0),
    snare: Array.from({ length: len }, (_, i) => i % 8 === 4),
    hat: Array.from({ length: len }, (_, i) => i % 2 === 0),
    openhat: new Array<boolean>(len).fill(false),
    clap: new Array<boolean>(len).fill(false),
    tom: new Array<boolean>(len).fill(false),
  };
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
  // XP-1 (i3-5): deterministic offline render at the 128-bar WORST CASE —
  // the IM-5 fold law holds at the new scale (loopSteps 2048, ~11.3M
  // samples/channel; the recorded wall-time probe for the busy-guard UX:
  // both renders run concurrently, matching the suite's Promise.all law).
  { name: "XP-1: 128-bar worst case (LCM 2048 steps, fold at scale)", doc: project128Bars },
];

describe("HW-2 double-render determinism (real worklet + FX graph)", () => {
  it.each(CASES)(
    "same project rendered twice is bit-identical: $name",
    { timeout: 120000 },
    async ({ doc }) => {
      const t0 = performance.now();
      const [a, b] = await Promise.all([
        renderProjectToBuffer(doc()),
        renderProjectToBuffer(doc()),
      ]);
      // XP-1 recorded probe: the wall-time of the worst case (concurrent
      // double render — the number the busy-guard UX is sized against).
      if (a.loopSteps >= 2048) {
        console.log(
          `[xp1] 128-bar worst case: ${a.loopSamples} samples/ch, concurrent double render ${Math.round(performance.now() - t0)} ms wall`,
        );
      }

      // Metadata identical (loop/tail math is pure — swing must not move it).
      expect(a.loopSamples).toBe(b.loopSamples);
      expect(a.tailSamples).toBe(b.tailSamples);
      expect(a.loopSteps).toBe(b.loopSteps);
      expect(a.sampleRate).toBe(EXPORT_SAMPLE_RATE);
      expect(b.sampleRate).toBe(EXPORT_SAMPLE_RATE);
      // XP-1: the 128-bar case's cycle IS the LCM law (2048 steps, and the
      // sample math is integer-exact at 44100).
      if (a.loopSteps === 2048) {
        expect(a.loopSamples).toBe(128 * 4 * ((44100 * 60) / 120));
      }

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

/**
 * SC-2 (iteration 2): per-note lengths are REAL durations in the render — a
 * note sounds for length × secondsPerStep and releases at that boundary
 * (per-sample ADSR hold), independent of the lane gate (which is only the
 * single-click default). Proven through offline ONSET/OFFSET ENERGY WINDOWS:
 * one 2-step note at step 0 and one 8-step note at step 4 (lead lane only,
 * preset-lead-1: attack 1 ms, sustain 0.8, release 50 ms, no FX) — the gaps
 * between/after the notes must be silent, and the 8-step note must still be
 * sounding a full 3+ steps beyond any gate-length interpretation.
 */
describe("SC-2 note-length engine — sustained notes via energy windows", () => {
  const SR = EXPORT_SAMPLE_RATE;

  function rms(ch: Float32Array, fromSec: number, toSec: number): number {
    const from = Math.round(fromSec * SR);
    const to = Math.round(toSec * SR);
    let sum = 0;
    for (let i = from; i < to; i++) sum += ch[i] * ch[i];
    return Math.sqrt(sum / (to - from));
  }

  it(
    "a ≥2-step note plays sustained: onset/offset land at the note boundaries",
    { timeout: 90000 },
    async () => {
      const doc = projectPlain();
      // Replace the lead content: 2-step note @0, 8-step note @4 (degree 2).
      // Lane gate stays at its default (2 steps) — irrelevant to durations.
      const lead = doc.patterns.lead[0];
      if (lead.kind !== "pitched") throw new Error("expected pitched lead");
      lead.notes = [
        { degree: 0, start: 0, length: 2 },
        { degree: 2, start: 4, length: 8 },
      ];
      // Nothing else sounds (projectPlain puts drums on 0/4/8/12 — clear it).
      const drums = doc.patterns.drums[0];
      drums.steps.kick = new Array(16).fill(false);

      const result = await renderProjectToBuffer(doc);
      expect(result.loopSamples).toBe(1 * 4 * ((SR * 60) / 120)); // 1 bar
      const ch = result.channels[0];

      // Onset 1 at t=0: energy present through the 2-step hold.
      expect(rms(ch, 0.0, 0.2)).toBeGreaterThan(0.02);
      // Offset 1 at t=2 steps (0.25 s) + 50 ms release: gap is silent.
      expect(rms(ch, 0.35, 0.48)).toBeLessThan(1e-4);
      // Onset 2 at t=4 steps (0.5 s): energy starts exactly there.
      expect(rms(ch, 0.5, 0.6)).toBeGreaterThan(0.02);
      // SUSTAINED: at 3.2–7.2 steps in (0.8–1.4 s) the 8-step note still
      // sounds — a gate-length (2-step) interpretation would be silent here.
      expect(rms(ch, 0.8, 1.4)).toBeGreaterThan(0.02);
      // Offset 2 at t=12 steps (1.5 s) + release: loop tail is silent.
      expect(rms(ch, 1.62, 1.98)).toBeLessThan(1e-4);

      // The two channels carry the same mono sum (worklet writes all chans).
      for (let i = 0; i < result.loopSamples; i++) {
        if (result.channels[1][i] !== ch[i]) {
          expect.fail(`channel divergence at sample ${i}`);
        }
      }
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
