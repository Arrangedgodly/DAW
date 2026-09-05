/**
 * MF-4 browser tests — the exported WAV IS the loop (byte-level, Mr.
 * Fantastic diligence emphasis).
 *
 * Exports the REFERENCE project (the same full-FX configuration as the HW-2
 * render fingerprint: drums drive+crush, lead delay+reverb) through the REAL
 * offline render + REAL encoder, captures the downloaded Blob via an injected
 * download seam, and parses the WAV back with a tiny purpose-built parser
 * (no third-party reader):
 *
 *  (a) header fields exact: RIFF/WAVE, fmt PCM 16-bit, 44100 Hz, 2 channels,
 *      data size = loopSamples × 4;
 *  (b) sample-exact length: bars × beats × (44100 × 60 / bpm / 4), integer;
 *  (c) loop-tightness at the FILE level: the IM-5 stitch assertion replayed
 *      on the exported bytes — a genuine two-iteration render's second-loop
 *      region must match the decoded export within 5% of peak (plus one
 *      quantization step), and the seam sample itself must not spike.
 */

import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../../src/document/schema";
import type { ProjectDocument } from "../../src/document/schema";
import {
  renderProjectToBuffer,
  EXPORT_SAMPLE_RATE,
} from "../../src/audio/render";
import { exportWav } from "../../src/audio/exportWav";
import { secondsPerStep } from "../../src/audio/time";
import { wideUnequalChainProject } from "../exportLcmReference";
import type { DownloadSeam } from "../../src/persist/fileIO";

// ---------------------------------------------------------------------------
// Reference project (mirrors render-fingerprint.test.ts)
// ---------------------------------------------------------------------------

function referenceProject(): ProjectDocument {
  const doc = createDefaultProject();
  const drums = doc.patterns.drums[0];
  drums.steps.kick = [true, ...new Array(15).fill(false)];
  for (const s of [4, 8, 12]) drums.steps.kick[s] = true;
  const lead = doc.patterns.lead[0];
  // SC-1 v2: `rows[3].steps[0] = 1` → lone note-on under the default lead
  // gate (2 steps). Same content, same audio.
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  lead.notes = [{ degree: 3, start: 0, length: 2 }];
  doc.lanes.find((l) => l.id === "drums")!.fxChain = [
    { type: "drive", bypassed: false, params: { amount: 0.35 } },
    { type: "bitcrusher", bypassed: false, params: { bits: 8, downsample: 2 } },
  ];
  doc.lanes.find((l) => l.id === "lead")!.fxChain = [
    {
      type: "delay",
      bypassed: false,
      params: { timeSteps: 2, feedback: 0.4, mix: 0.4 },
    },
    { type: "reverb", bypassed: false, params: { size: 0.4, mix: 0.35 } },
  ];
  return doc;
}

/** Same content as a genuine 2-bar loop (2-bar lead pattern, notes at 0+16). */
function twoIterationProject(): ProjectDocument {
  const doc = referenceProject();
  const lead = doc.patterns.lead[0];
  lead.bars = 2;
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  // v0 shape: two lone note-ons at steps 0 and 16 of a 2-bar row (gate 2).
  lead.notes = [
    { degree: 3, start: 0, length: 2 },
    { degree: 3, start: 16, length: 2 },
  ];
  return doc;
}

// ---------------------------------------------------------------------------
// Tiny WAV parser (test-owned, ~40 lines)
// ---------------------------------------------------------------------------

interface ParsedWav {
  channels: Float32Array[]; // decoded to float via /32767
  frames: number;
  sampleRate: number;
  bits: number;
  channelsCount: number;
  audioFormat: number;
  dataBytes: number;
  riffSize: number;
}

function parseWav16Stereo(bytes: Uint8Array): ParsedWav {
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...bytes.slice(at, at + n));
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const u32 = (at: number) =>
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0;
  const i16 = (at: number) => {
    const u = bytes[at] | (bytes[at + 1] << 8);
    return u >= 0x8000 ? u - 0x10000 : u;
  };

  if (ascii(0, 4) !== "RIFF") throw new Error("not RIFF");
  if (ascii(8, 4) !== "WAVE") throw new Error("not WAVE");
  if (ascii(12, 4) !== "fmt ") throw new Error("no fmt chunk");
  const audioFormat = u16(20);
  const channelsCount = u16(22);
  const sampleRate = u32(24);
  const bits = u16(34);
  if (ascii(36, 4) !== "data")
    throw new Error("no data chunk (not canonical layout)");
  const dataBytes = u32(40);
  const frames = dataBytes / 4;

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = i16(44 + i * 4) / 32767;
    right[i] = i16(44 + i * 4 + 2) / 32767;
  }
  return {
    channels: [left, right],
    frames,
    sampleRate,
    bits,
    channelsCount,
    audioFormat,
    dataBytes,
    riffSize: u32(4),
  };
}

/** Download seam that captures the Blob instead of touching the DOM. */
function captureSeam(): { seam: DownloadSeam; blob: () => Blob | undefined } {
  let captured: Blob | undefined;
  const seam: DownloadSeam = {
    createObjectURL: (blob) => {
      captured = blob;
      return "blob:captured";
    },
    revokeObjectURL: () => undefined,
    createElement: () => ({ click: () => undefined, href: "", download: "" }),
  };
  return { seam, blob: () => captured };
}

// ---------------------------------------------------------------------------

const Q = 1 / 32767; // one quantization step

describe("MF-4 WAV export — the file IS the loop (real render + encoder)", () => {
  it(
    "exports the reference project: header fields exact + sample-exact length",
    { timeout: 120000 },
    async () => {
      const cap = captureSeam();
      const result = await exportWav(referenceProject(), { seam: cap.seam });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
      expect(cap.blob()!.type).toBe("audio/wav");

      // Render metadata for the cross-checks.
      const rendered = await renderProjectToBuffer(referenceProject());
      expect(rendered.loopSamples).toBe(result.ok ? result.loopSamples : 0);

      const wav = parseWav16Stereo(bytes);
      // (a) header fields exact
      expect(wav.audioFormat).toBe(1); // PCM
      expect(wav.channelsCount).toBe(2); // stereo
      expect(wav.bits).toBe(16);
      expect(wav.sampleRate).toBe(EXPORT_SAMPLE_RATE); // 44100
      expect(wav.dataBytes).toBe(rendered.loopSamples * 4); // data size = loopSamples×4
      expect(wav.riffSize).toBe(bytes.byteLength - 8);
      expect(bytes.byteLength).toBe(44 + rendered.loopSamples * 4);

      // (b) sample-exact length: bars × beats × samplesPerBeat (IM-5 law; a
      // 16th step = samplesPerBeat/4 — same integer product either way).
      const bpm = 120;
      const samplesPerBeat = (EXPORT_SAMPLE_RATE * 60) / bpm; // 22050
      const expectedSamples = 1 * 4 * samplesPerBeat; // 88200
      expect(Number.isInteger(expectedSamples)).toBe(true);
      expect(wav.frames).toBe(expectedSamples);
      expect(wav.frames).toBe(rendered.loopSamples);
      if (result.ok) expect(result.bars).toBe(1);

      // Decoded export ≡ folded render re-encoded (quantization-exact round
      // trip through our own law): byte-equality with encodeWav16 of render.
      const { encodeWav16 } = await import("../../src/audio/wav");
      expect(bytes).toEqual(
        encodeWav16(rendered.channels, rendered.sampleRate),
      );
    },
  );

  it(
    "loop-tight at the file level: IM-5 stitch assertion on the exported bytes",
    { timeout: 180000 },
    async () => {
      // One iteration exported (file), and the same content as a genuine
      // 2-bar render whose second loop region carries the TRUE continuation
      // across the seam.
      const cap = captureSeam();
      const result = await exportWav(referenceProject(), { seam: cap.seam });
      expect(result.ok).toBe(true);
      const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
      const wav = parseWav16Stereo(bytes);

      const two = await renderProjectToBuffer(twoIterationProject(), {
        includeRaw: true,
      });
      const one = await renderProjectToBuffer(referenceProject());
      const L = one.loopSamples;
      const T = one.tailSamples;
      expect(two.loopSamples).toBe(2 * L);
      expect(T).toBeGreaterThan(0);

      // Compare the second-iteration window (past the fold-affected head) of
      // the long render against the decoded export shifted by one loop — the
      // only allowed difference is wrapped-tail residue + one quantization
      // step.
      let peak = 0;
      let maxDiff = 0;
      for (
        let i = L + T;
        i < 2 * L;
        i += 7 /* sampled: full sweep ×7 off-by-one is covered by determinism */
      ) {
        const truth = two.raw![0][i];
        const exported = wav.channels[0][i - L];
        peak = Math.max(peak, Math.abs(truth));
        const d = Math.abs(truth - exported);
        if (d > maxDiff) maxDiff = d;
      }
      expect(peak).toBeGreaterThan(0.01); // real signal at the seam window
      expect(maxDiff).toBeLessThan(peak * 0.05 + Q);

      // Seam continuity in the file itself: last sample → first sample, no spike.
      const seamJump = Math.abs(wav.channels[0][0] - wav.channels[0][L - 1]);
      expect(seamJump).toBeLessThan(0.5);
    },
  );

  // XP-1 (i3-5): the export is EXACTLY one LCM cycle — the plan's own probe
  // (I3-d): drums 64B + bass 4B + chords 8B (+ the default 1-bar lead) →
  // the export is 64 bars, loopSteps × secondsPerStep to the SAMPLE, the
  // shorter lanes' content repeating within the cycle (audibly: the last
  // 4-bar window — the 16th bass iteration — matches the first), and the
  // seam loop-perfect at scale.
  it(
    "XP-1: unequal chains export EXACTLY one LCM cycle (64 bars, sample-exact)",
    { timeout: 240000 },
    async () => {
      const doc = wideUnequalChainProject();

      const t0 = performance.now();
      const rendered = await renderProjectToBuffer(doc);
      const renderMs = performance.now() - t0;
      console.log(
        `[xp1] 64-bar LCM offline render wall: ${Math.round(renderMs)} ms`,
      );

      // The LCM law, pure math first: lcm(1024, 64, 128, 16) = 1024 steps.
      expect(rendered.loopSteps).toBe(64 * 16);
      // loopSamples = round(loopSteps × secondsPerStep × 44100), and at
      // 120 BPM the integer bars×beats law gives the same number exactly.
      const expectedSamples = Math.round(
        64 * 16 * secondsPerStep(120) * EXPORT_SAMPLE_RATE,
      );
      expect(expectedSamples).toBe(64 * 4 * 22050); // 5,644,800, integer
      expect(rendered.loopSamples).toBe(expectedSamples);
      for (const ch of rendered.channels)
        expect(ch).toHaveLength(rendered.loopSamples);

      // Export through the SAME render (the injectable seam keeps this at
      // ONE 64-bar render — CI-time honesty; the trim+encode path is what
      // runs): the file IS the loop, byte-for-byte our own encoder's law.
      const cap = captureSeam();
      const result = await exportWav(doc, {
        seam: cap.seam,
        render: () => Promise.resolve(rendered),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.bars).toBe(64);
      expect(result.loopSamples).toBe(expectedSamples);

      const bytes = new Uint8Array(await cap.blob()!.arrayBuffer());
      const wav = parseWav16Stereo(bytes);
      // Parse-back: headers exact, frames = the LCM's loopSamples exactly.
      expect(wav.audioFormat).toBe(1);
      expect(wav.channelsCount).toBe(2);
      expect(wav.bits).toBe(16);
      expect(wav.sampleRate).toBe(EXPORT_SAMPLE_RATE);
      expect(wav.frames).toBe(expectedSamples);
      expect(wav.dataBytes).toBe(expectedSamples * 4);
      expect(wav.riffSize).toBe(bytes.byteLength - 8);
      expect(bytes.byteLength).toBe(44 + expectedSamples * 4);

      // Byte-equality with the pure encoder over the SAME render: the
      // defensive trim + encode changed nothing. (Manual byte compare —
      // deep-equal on a 22.6 MB typed array is too slow for CI; the HW-5
      // manual-compare precedent.)
      const { encodeWav16 } = await import("../../src/audio/wav");
      const expectBytes = encodeWav16(rendered.channels, rendered.sampleRate);
      let diffAt = -1;
      for (let i = 0; i < expectBytes.length; i++) {
        if (bytes[i] !== expectBytes[i]) {
          diffAt = i;
          break;
        }
      }
      expect(
        diffAt,
        `exported file differs from encodeWav16(render) at byte ${diffAt}`,
      ).toBe(-1);

      // Loop-perfect seam at scale: last sample → first sample, no spike.
      const seamJump = Math.abs(
        wav.channels[0][0] - wav.channels[0][wav.frames - 1],
      );
      expect(seamJump).toBeLessThan(0.5);

      // The LCM fill is AUDIBLE, not notational: the bass repeats every 4
      // bars (the 16th iteration lives in the last 4-bar window), so the
      // first and last 4-bar windows carry the same composition. Compare
      // their energy — a lane-local export (the pre-XP-1 bug shape) would
      // end at 4 bars and this file would not exist past bar 4 at all.
      const barSamples = 4 * 22050;
      const rms = (from: number, to: number) => {
        let sum = 0;
        for (let i = from; i < to; i++) {
          const x = wav.channels[0][i];
          sum += x * x;
        }
        return Math.sqrt(sum / (to - from));
      };
      const first = rms(0, barSamples * 4);
      const last = rms(
        wav.frames - barSamples * 4,
        wav.frames - barSamples,
      );
      expect(first).toBeGreaterThan(0.01); // real signal, not silence
      expect(Math.abs(first - last)).toBeLessThan(first * 0.1);
    },
  );
});
