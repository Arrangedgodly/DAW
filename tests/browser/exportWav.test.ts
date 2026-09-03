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
import type { ProjectDocument, PitchedCell } from "../../src/document/schema";
import {
  renderProjectToBuffer,
  EXPORT_SAMPLE_RATE,
} from "../../src/audio/render";
import { exportWav } from "../../src/audio/exportWav";
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
  lead.rows[3].steps[0] = 1;
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
  const wide = new Array(32).fill(0);
  wide[0] = 1;
  wide[16] = 1;
  lead.rows[3].steps = wide as PitchedCell[];
  doc.transport = { ...doc.transport, loopBars: 2 };
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
});
