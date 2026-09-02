/**
 * WAV encoder — 16-bit stereo PCM, hand-rolled (MF-4 / RES-5a, D5 law).
 *
 * ~60 lines, zero dependencies, full byte-level control: the exported WAV is
 * the product's core promise (loop-perfect game audio), so every byte is
 * written here and pinned by a SHA-256 golden (tests/golden/) plus
 * hand-computed header/sample assertions in tests/wav.test.ts.
 *
 * Exactly ONE variant is supported on purpose: stereo, 16-bit PCM, 44100 Hz
 * (the export render contract, EXPORT_SAMPLE_RATE). Anything else throws —
 * a silently-misencoded loop is worse than a loud error.
 *
 * Quantization law (sample-exact, documented): clamp v to [−1, 1], scale by
 * 32767, Math.round (ECMAScript: halves round toward +∞, so +half → up and
 * −half → up too — deterministic and pinned by tests). −1 → −32767 (0x8001)
 * and +1 → +32767 (0x7FFF): the −32768 code is deliberately never produced,
 * so decoding with any standard player maps back into [−1, +1]
 * symmetrically.
 *
 * Pure function: no DOM, no globals, no allocation beyond the output.
 */

export const WAV_HEADER_BYTES = 44;
export const WAV_BYTES_PER_SAMPLE = 2; // 16-bit
export const WAV_CHANNELS = 2; // stereo only (the one committed variant)

function writeAscii(bytes: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

function writeU16(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
}

/** float → int16 with the documented clamp/scale/round law. */export function floatToInt16(v: number): number {
  const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(clamped * 32767);
}

function int16LE(bytes: Uint8Array, at: number, value: number): void {
  const u = value < 0 ? value + 0x10000 : value; // two's complement LE
  bytes[at] = u & 0xff;
  bytes[at + 1] = (u >>> 8) & 0xff;
}

/**
 * Encode stereo channels as a 44100-family 16-bit PCM WAV file:
 * 44-byte RIFF header + interleaved little-endian int16 frames
 * (L0 R0 L1 R1 …). `sampleRate` is written verbatim (render contract: 44100).
 *
 * Throws on: channel count ≠ 2, mismatched channel lengths, empty buffer,
 * non-integer/non-positive sample rate.
 */
export function encodeWav16(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  if (channels.length !== WAV_CHANNELS) {
    throw new Error(
      `encodeWav16: exactly ${WAV_CHANNELS} channels required, got ${channels.length}`,
    );
  }
  const [left, right] = channels;
  if (left.length !== right.length) {
    throw new Error(
      `encodeWav16: channel length mismatch (${left.length} vs ${right.length})`,
    );
  }
  const frames = left.length;
  if (frames === 0) throw new Error("encodeWav16: empty buffer");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWav16: invalid sample rate ${sampleRate}`);
  }

  const blockAlign = WAV_CHANNELS * WAV_BYTES_PER_SAMPLE;
  const dataBytes = frames * blockAlign;
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);

  writeAscii(out, 0, "RIFF");
  writeU32(out, 4, 36 + dataBytes); // RIFF chunk size = file − 8
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  writeU32(out, 16, 16); // fmt chunk size (PCM)
  writeU16(out, 20, 1); // audio format: PCM
  writeU16(out, 22, WAV_CHANNELS);
  writeU32(out, 24, sampleRate);
  writeU32(out, 28, sampleRate * blockAlign); // byte rate
  writeU16(out, 32, blockAlign);
  writeU16(out, 34, 16); // bits per sample
  writeAscii(out, 36, "data");
  writeU32(out, 40, dataBytes);

  let at = WAV_HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    int16LE(out, at, floatToInt16(left[i]));
    int16LE(out, at + 2, floatToInt16(right[i]));
    at += 4;
  }
  return out;
}
