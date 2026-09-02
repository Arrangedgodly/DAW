/**
 * Golden: byte-exact MIDI export of the MF-5 reference project (HW-3).
 * Pure TS → deterministic bytes (own typed model + midi-file writeMidi);
 * pinned via SHA-256 manifest, regenerated only via `npm run goldens:update`.
 */
import { describe, expect, it } from "vitest";
import { encodeMidi } from "../../src/audio/exportMidi";
import { expectGolden } from "./golden";
import { referenceMidiProject } from "../midiReference";

const GOLDEN_NAME = "midi/reference-project-v1";

function referenceMidiBytes(): Uint8Array {
  return encodeMidi(referenceMidiProject());
}

describe("golden: reference project MIDI export bytes", () => {
  it("matches the manifest SHA-256 + byteLength", () => {
    expectGolden(GOLDEN_NAME, referenceMidiBytes());
  });

  it("is a plausible SMF (MThd magic, format 1, 5 tracks, 480 PPQ)", () => {
    const bytes = referenceMidiBytes();
    const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
    expect(tag(0)).toBe("MThd");
    expect(tag(14)).toBe("MTrk");
    const u16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];
    expect(u16(8)).toBe(1); // format 1
    expect(u16(10)).toBe(5); // 1 tempo/cue track + 4 lanes
    expect(u16(12)).toBe(480); // PPQ
  });
});
