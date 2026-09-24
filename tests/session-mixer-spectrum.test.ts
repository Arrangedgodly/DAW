import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";

function spectrumSession() {
  const seenRightBuffers: Float32Array<ArrayBuffer>[] = [];
  const makeTap = (values: number[]) => ({
    context: { sampleRate: 44100 },
    getFloatFrequencyData(out: Float32Array<ArrayBuffer>) {
      if (values[0] === 6) seenRightBuffers.push(out);
      out.set(values.slice(0, out.length));
    },
  });
  const session = new Session();
  const taps = new Map([
    ["lead", [makeTap([-40, -18, -70]), makeTap([-30, -25, -60])]],
    ["master", [makeTap([-20, -55, -15]), makeTap([-10, -50, -35])]],
  ]);
  const internals = session as unknown as {
    mixerTaps: Map<
      string,
      {
        taps: (ReturnType<typeof makeTap> & { disconnect(): void })[];
        source: { disconnect(): void };
        split: { disconnect(): void };
      }
    >;
    mixerSpectrumScratch: Float32Array<ArrayBuffer> | null;
  };
  for (const [lane, channelTaps] of taps) {
    internals.mixerTaps.set(lane, {
      taps: channelTaps.map((tap) => ({ ...tap, disconnect() {} })),
      source: { disconnect() {} },
      split: { disconnect() {} },
    });
  }
  return { session, internals, seenRightBuffers };
}

describe("Session.readMixerSpectrum", () => {
  it("takes the per-bin stereo maximum and returns the live sample rate", () => {
    const { session } = spectrumSession();
    const out = new Float32Array(3);
    expect(session.readMixerSpectrum("lead", out)).toBe(44100);
    expect([...out]).toEqual([-30, -18, -60]);
  });

  it("reuses private scratch across meter selection and protects prior outputs", () => {
    const { session, internals, seenRightBuffers } = spectrumSession();
    const first = new Float32Array(3);
    session.readMixerSpectrum("lead", first);
    const heldFirst = [...first];
    const firstScratch = internals.mixerSpectrumScratch;
    const second = new Float32Array(3);
    session.readMixerSpectrum("master", second);

    expect(internals.mixerSpectrumScratch).toBe(firstScratch);
    expect(seenRightBuffers[0]).toBe(seenRightBuffers[1]);
    expect([...first]).toEqual(heldFirst);
    expect([...second]).toEqual([-10, -50, -15]);
  });

  it("resizes scratch only when output length changes and releases it with taps", () => {
    const { session, internals } = spectrumSession();
    session.readMixerSpectrum("lead", new Float32Array(3));
    const initialScratch = internals.mixerSpectrumScratch;
    session.readMixerSpectrum("master", new Float32Array(2));
    expect(internals.mixerSpectrumScratch).not.toBe(initialScratch);
    expect(internals.mixerSpectrumScratch?.length).toBe(2);

    session.releaseMixerTaps();
    expect(internals.mixerSpectrumScratch).toBeNull();
  });

  it("fills missing meters with negative infinity and uses the fallback rate", () => {
    const { session } = spectrumSession();
    const out = new Float32Array([1, 2, 3]);
    expect(session.readMixerSpectrum("bass", out)).toBe(48000);
    expect([...out]).toEqual([-Infinity, -Infinity, -Infinity]);
  });
});
