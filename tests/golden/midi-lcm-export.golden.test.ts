/**
 * Golden (XP-1, i3-5): byte-exact MIDI export of the UNEQUAL-CHAIN LCM
 * reference project. Pins the LCM cycle law at the serialization level:
 * shorter chains' notes AND cue markers repeat at their chain length within
 * the export cycle (drums [2B,2B] walks once; bass 2B ×2; chords/lead 1B ×4;
 * the bass cue marker recurs at its chain boundary). Pure TS → deterministic
 * bytes; pinned via the SHA-256 manifest, regenerated only via
 * `npm run goldens:update` (the sanctioned path — justification in
 * docs/dev/goldens.md "Regeneration history", XP-1 entry).
 */
import { describe, expect, it } from "vitest";
import { parseMidi } from "midi-file";
import { encodeMidi, LANE_CHANNELS } from "../../src/audio/exportMidi";
import { expectGolden } from "./golden";
import { lcmCycleProject } from "../exportLcmReference";

const GOLDEN_NAME = "midi/lcm-cycle-project-v1";

function lcmReferenceBytes(): Uint8Array {
  return encodeMidi(lcmCycleProject());
}

describe("golden: LCM-cycle (unequal chains) MIDI export bytes", () => {
  it("matches the manifest SHA-256 + byteLength", () => {
    expectGolden(GOLDEN_NAME, lcmReferenceBytes());
  });

  it("spans exactly one 4-bar cycle: repeated chain content at exact ticks", () => {
    const bytes = lcmReferenceBytes();
    const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
    expect(tag(0)).toBe("MThd");
    expect(tag(14)).toBe("MTrk");
    const u16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];
    expect(u16(8)).toBe(1); // format 1
    expect(u16(10)).toBe(5); // 1 tempo/cue track + 4 lanes
    expect(u16(12)).toBe(480); // PPQ

    // The LAW this golden exists for: the bass (2-bar chain in a 4-bar
    // cycle) sounds in BOTH half-cycles, the 1-bar lanes in all four, and
    // the markers repeat with their lane's chain.
    const parsed = parseMidi([...bytes]);
    const onTicks = (trackIndex: number, channel: number): number[] => {
      const out: number[] = [];
      let t = 0;
      for (const e of parsed.tracks[trackIndex]) {
        t += e.deltaTime;
        if (e.type === "noteOn" && e.channel === channel) out.push(t);
      }
      return out;
    };
    // Track 2 = bass: 2 iterations at 0 / 3840 (32 steps × 120 ticks).
    expect(onTicks(2, LANE_CHANNELS.bass)).toEqual([0, 3840]);
    // Track 3 = chords: triad × 4 iterations at every bar downbeat (3
    // noteOns per onset — the stack law).
    const chordOnsets = onTicks(3, LANE_CHANNELS.chords);
    expect(chordOnsets).toHaveLength(12);
    expect([...new Set(chordOnsets)]).toEqual([0, 1920, 3840, 5760]);
    // Track 0 markers: GROOVE repeats at the bass chain boundary (3840).
    const markers = parsed.tracks[0]
      .filter((e) => e.type === "marker")
      .map((e) => (e.type === "marker" ? e.text : ""))
      .sort();
    expect(markers).toEqual(["DROP", "GROOVE", "GROOVE", "VERSE"]);
  });
});
