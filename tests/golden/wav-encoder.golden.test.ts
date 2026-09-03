/**
 * Golden: byte-exact WAV of a small synthetic buffer (MF-4 / RES-5a, HW-3).
 *
 * The encoder is pure TS → deterministic bytes; the full file (44-byte header
 * + 2 interleaved frames) is pinned via the SHA-256 manifest. The hand-
 * computed byte-for-byte expectation in the second test doubles as a
 * self-check that the pinned bytes are the SPEC bytes, not just "whatever the
 * encoder emitted on day one".
 */

import { describe, expect, it } from "vitest";
import { encodeWav16 } from "../../src/audio/wav";
import { expectGolden } from "./golden";

const GOLDEN_NAME = "wav/encoder-stereo-2frame-v1";

/** L = [0, 0.5], R = [−1, 1] @ 44100 — every output byte hand-computable. */
function syntheticWav(): Uint8Array {
  return encodeWav16(
    [new Float32Array([0, 0.5]), new Float32Array([-1, 1])],
    44100,
  );
}

describe("golden: encodeWav16 synthetic stereo buffer", () => {
  it("matches the manifest SHA-256 + byteLength", () => {
    expectGolden(GOLDEN_NAME, syntheticWav());
  });

  it("equals the hand-computed spec bytes exactly", () => {
    const wav = syntheticWav();
    const expected = [
      // RIFF header
      0x52,
      0x49,
      0x46,
      0x46,
      0x2c,
      0x00,
      0x00,
      0x00, // "RIFF", 44
      0x57,
      0x41,
      0x56,
      0x45, // "WAVE"
      // fmt chunk
      0x66,
      0x6d,
      0x74,
      0x20,
      0x10,
      0x00,
      0x00,
      0x00, // "fmt ", 16
      0x01,
      0x00, // PCM
      0x02,
      0x00, // stereo
      0x44,
      0xac,
      0x00,
      0x00, // 44100
      0x10,
      0xb1,
      0x02,
      0x00, // byteRate 176400
      0x04,
      0x00, // blockAlign
      0x10,
      0x00, // 16 bits
      // data chunk
      0x64,
      0x61,
      0x74,
      0x61,
      0x08,
      0x00,
      0x00,
      0x00, // "data", 8 bytes
      // frames L0 R0 L1 R1
      0x00,
      0x00, // 0
      0x01,
      0x80, // −32767
      0x00,
      0x40, // 16384
      0xff,
      0x7f, // 32767
    ];
    expect(wav.byteLength).toBe(expected.length);
    expect([...wav]).toEqual(expected);
  });
});
