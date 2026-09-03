/**
 * MF-4 unit tests — hand-rolled WAV encoder (RES-5a / D5 law).
 *
 * Byte-level exactness is the diligence emphasis: every header field is
 * hand-checked against the 1991-frozen RIFF/WAVE spec, and the int16
 * conversion table is hand-computed (clamp −1..1, scale 32767, round).
 * The full-encoder golden (SHA-256 manifest) lives in tests/golden/.
 */

import { describe, expect, it } from "vitest";
import { encodeWav16, floatToInt16 } from "../src/audio/wav";

const SR = 44100;

function bytesAt(bytes: Uint8Array, from: number, count: number): number[] {
  return [...bytes.slice(from, from + count)];
}

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}

function i16le(bytes: Uint8Array, at: number): number {
  const u = u16le(bytes, at);
  return u >= 0x8000 ? u - 0x10000 : u;
}

describe("floatToInt16 conversion table (clamp · scale 32767 · round)", () => {
  it("bounds: −1 and +1 hit −32767 and +32767 exactly", () => {
    expect(floatToInt16(-1)).toBe(-32767);
    expect(floatToInt16(1)).toBe(32767);
  });

  it("clamps beyond the bounds (never −32768)", () => {
    expect(floatToInt16(-1.5)).toBe(-32767);
    expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(-Infinity)).toBe(-32767);
    expect(floatToInt16(Infinity)).toBe(32767);
  });

  it("rounds via Math.round (halves toward +∞, per ECMAScript)", () => {
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(0.5 / 32767)).toBe(1); // exactly half → up
    expect(floatToInt16(1 / 32767)).toBe(1);
    expect(floatToInt16(0.5 / 32767 - 1e-12)).toBe(0); // just under half-step stays 0
    expect(floatToInt16(1 / 32768)).toBe(1); // 0.99997 — rounds to 1, not to the 32768 half-step
    expect(floatToInt16(0.5)).toBe(16384); // 16383.5 → up
    expect(floatToInt16(-0.5)).toBe(-16383); // −16383.5 → toward +∞
    expect(floatToInt16(-(1 / 32767))).toBe(-1);
  });
});

describe("encodeWav16 — header bytes hand-checked (RIFF/WAVE spec)", () => {
  // 2 frames: L = [0, 0.5], R = [−1, 1] — every value hand-computable.
  const left = new Float32Array([0, 0.5]);
  const right = new Float32Array([-1, 1]);
  const wav = encodeWav16([left, right], SR);

  it("file length = 44 + frames×4", () => {
    expect(wav.byteLength).toBe(44 + 2 * 4);
  });

  it("RIFF chunk: magic, size (file−8), WAVE", () => {
    expect(bytesAt(wav, 0, 4)).toEqual([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    expect(u32le(wav, 4)).toBe(36 + 8); // 44 − 8
    expect(bytesAt(wav, 8, 4)).toEqual([0x57, 0x41, 0x56, 0x45]); // "WAVE"
  });

  it("fmt chunk: PCM 16, stereo, 44100, byteRate, blockAlign, bits", () => {
    expect(bytesAt(wav, 12, 4)).toEqual([0x66, 0x6d, 0x74, 0x20]); // "fmt "
    expect(u32le(wav, 16)).toBe(16); // PCM fmt size
    expect(u16le(wav, 20)).toBe(1); // PCM
    expect(u16le(wav, 22)).toBe(2); // stereo
    expect(u32le(wav, 24)).toBe(44100);
    expect(u32le(wav, 28)).toBe(44100 * 4); // byteRate
    expect(u16le(wav, 32)).toBe(4); // blockAlign
    expect(u16le(wav, 34)).toBe(16); // bits
  });

  it("data chunk: magic + size = frames×4", () => {
    expect(bytesAt(wav, 36, 4)).toEqual([0x64, 0x61, 0x74, 0x61]); // "data"
    expect(u32le(wav, 40)).toBe(8);
  });

  it("interleaved little-endian frames: L0 R0 L1 R1 hand-computed", () => {
    expect(i16le(wav, 44)).toBe(0); // L0
    expect(i16le(wav, 46)).toBe(-32767); // R0 = −1
    expect(i16le(wav, 48)).toBe(16384); // L1 = 0.5
    expect(i16le(wav, 50)).toBe(32767); // R1 = +1
    // Exact bytes for the −32767 (0x8001) little-endian encoding.
    expect(bytesAt(wav, 46, 2)).toEqual([0x01, 0x80]);
  });

  it("round-trips a larger buffer through the same law", () => {
    const n = 1000;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = Math.sin((i / n) * Math.PI * 2) * 1.2; // exercises clamps
      r[i] = -l[i];
    }
    const bytes = encodeWav16([l, r], SR);
    expect(bytes.byteLength).toBe(44 + n * 4);
    for (let i = 0; i < n; i++) {
      // (x || 0) normalizes −0 — a legal quantization output of Math.round.
      expect(i16le(bytes, 44 + i * 4) || 0).toBe(floatToInt16(l[i]) || 0);
      expect(i16le(bytes, 44 + i * 4 + 2) || 0).toBe(floatToInt16(r[i]) || 0);
    }
  });
});

describe("encodeWav16 — the one committed variant (throws otherwise)", () => {
  it("mono throws", () => {
    expect(() => encodeWav16([new Float32Array(4)], SR)).toThrow(/2 channels/);
  });

  it("three channels throw", () => {
    expect(() =>
      encodeWav16(
        [new Float32Array(4), new Float32Array(4), new Float32Array(4)],
        SR,
      ),
    ).toThrow(/2 channels/);
  });

  it("mismatched channel lengths throw", () => {
    expect(() =>
      encodeWav16([new Float32Array(4), new Float32Array(5)], SR),
    ).toThrow(/mismatch/);
  });

  it("empty buffer throws", () => {
    expect(() =>
      encodeWav16([new Float32Array(0), new Float32Array(0)], SR),
    ).toThrow(/empty/);
  });

  it("non-integer / non-positive sample rate throws", () => {
    expect(() =>
      encodeWav16([new Float32Array(2), new Float32Array(2)], 44100.5),
    ).toThrow(/sample rate/);
    expect(() =>
      encodeWav16([new Float32Array(2), new Float32Array(2)], 0),
    ).toThrow(/sample rate/);
  });
});
