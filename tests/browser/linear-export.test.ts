import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { parseMidi } from "midi-file";
import { createComponent } from "solid-js";
import { createDefaultProject } from "../../src/document/schema";
import { renderProjectToBuffer } from "../../src/audio/render";
import { exportWav } from "../../src/audio/exportWav";
import PatternMidiExport from "../../src/components/PatternMidiExport";
import { loadDocument } from "../../src/state/store";

describe("linear WAV and pattern MIDI", () => {
  it("renders a finite pass with a silent shorter lane and repeat duration, then encodes the retained tail", async () => {
    const doc = createDefaultProject();
    const drums = doc.patterns.drums[0];
    drums.steps.kick = [true, ...Array<boolean>(15).fill(false)];
    doc.patterns.lead[0].bars = 3;
    doc.playbackRules = {
      drums: [{ unit: "repeats", amount: 2, action: "random" }],
    };
    const result = await renderProjectToBuffer(doc, {
      arrangement: "linear",
      includeRaw: true,
    });
    expect(result.loopSteps).toBe(48);
    expect(result.outputSamples).toBe(result.loopSamples + result.tailSamples);
    expect(result.channels[0]).toEqual(result.raw![0]);
    const energy = (bar: number) => {
      const samples = result.channels[0].subarray(
        bar * 88200,
        bar * 88200 + 20000,
      );
      return samples.reduce((sum, x) => sum + x * x, 0);
    };
    expect(energy(0)).toBeGreaterThan(1);
    expect(energy(1)).toBeGreaterThan(1);
    expect(energy(2)).toBe(0);
    let blob: Blob | undefined;
    const exported = await exportWav(doc, {
      render: async () => result,
      seam: {
        createObjectURL: (b) => {
          blob = b;
          return "blob:test";
        },
        revokeObjectURL() {},
        createElement: () => ({ href: "", download: "", click() {} }),
      },
    });
    expect(exported).toMatchObject({ ok: true, bars: 3 });
    const bytes = new DataView(await blob!.arrayBuffer());
    expect(bytes.getUint32(40, true)).toBe(result.outputSamples! * 4);
  });

  it("default WAV export keeps the ending release instead of folding it into the start", async () => {
    const doc = createDefaultProject();
    const p = doc.patterns.lead[0];
    if (p.kind !== "pitched") throw new Error("pitched");
    p.notes = [{ degree: 3, start: 15, length: 1 }];
    let blob: Blob | undefined;
    const result = await exportWav(doc, {
      seam: {
        createObjectURL: (b) => {
          blob = b;
          return "blob:test";
        },
        revokeObjectURL() {},
        createElement: () => ({ href: "", download: "", click() {} }),
      },
    });
    expect(result).toMatchObject({ ok: true, bars: 1 });
    const view = new DataView(await blob!.arrayBuffer());
    const frames = view.getUint32(40, true) / 4;
    expect(frames).toBeGreaterThan(88200);
    let tailPeak = 0;
    for (let i = 0; i < 1000; i++)
      expect(view.getInt16(44 + i * 4, true)).toBe(0);
    for (let i = 88200; i < frames; i++)
      tailPeak = Math.max(tailPeak, Math.abs(view.getInt16(44 + i * 4, true)));
    expect(tailPeak).toBeGreaterThan(10);
  });

  it("the pattern control downloads only its selected block through the real lazy import", async () => {
    const doc = createDefaultProject();
    const p = doc.patterns.lead[0];
    p.bars = 3;
    if (p.kind !== "pitched") throw new Error("pitched");
    p.notes = [{ degree: 3, start: 1, length: 2 }];
    loadDocument(doc);
    const host = document.createElement("div");
    document.body.append(host);
    let blob: Blob | undefined;
    const original = URL.createObjectURL;
    URL.createObjectURL = (b) => {
      blob = b as Blob;
      return "blob:test";
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};
    const dispose = render(
      () =>
        createComponent(PatternMidiExport, { lane: "lead", patternId: p.id }),
      host,
    );
    try {
      host.querySelector("button")!.click();
      await expect.poll(() => blob).toBeDefined();
      const midi = parseMidi(new Uint8Array(await blob!.arrayBuffer()));
      expect(midi.header.numTracks).toBe(2);
      expect(midi.tracks[1].filter((e) => e.type === "noteOn")).toHaveLength(1);
      expect(midi.tracks[1].reduce((tick, e) => tick + e.deltaTime, 0)).toBe(
        5760,
      );
    } finally {
      dispose();
      host.remove();
      URL.createObjectURL = original;
      HTMLAnchorElement.prototype.click = click;
    }
  });
});
