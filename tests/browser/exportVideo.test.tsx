import { afterEach, describe, expect, it } from "vitest";
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  AudioBufferSink,
  CanvasSink,
} from "mediabunny";
import { render } from "solid-js/web";
import { page, userEvent } from "vitest/browser";
import VizPage from "../../src/components/VizPage";
import { exportVideo } from "../../src/viz/exportVideo";
import { defaultComposition } from "../../src/viz/composition";
import { createDefaultProject } from "../../src/document/schema";
import { activeCompositionEngines } from "../../src/viz/compositionEngine";
import "../../src/styles/base.css";
import "../../src/styles/membrane.css";

let cleanup: (() => void) | undefined;
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await page.viewport(1280, 800);
});
const options = () => ({
  format: "desktop" as const,
  startBar: 1,
  endBar: 1,
  composition: defaultComposition(),
  colors: { drums: "#ff7777", lead: "#7777ff" },
  ground: "#080b0d",
  signal: new AbortController().signal,
  onProgress: () => {},
});

describe("MP4 visualizer export", () => {
  for (const format of ["desktop", "mobile"] as const) {
    it(`encodes playable ${format} video with audible stereo audio and changing frames`, async () => {
      const doc = createDefaultProject();
      doc.transport.bpm = 240;
      doc.patterns.drums[0].steps.kick[0] = true;
      doc.patterns.drums[0].steps.kick[8] = true;
      const before = JSON.stringify(doc);
      const engines = activeCompositionEngines();
      const blob = await exportVideo(doc, { ...options(), format });
      expect(JSON.stringify(doc)).toBe(before);
      expect(activeCompositionEngines()).toEqual(engines);
      expect(blob.type).toBe("video/mp4");
      const input = new Input({
        source: new BlobSource(blob),
        formats: ALL_FORMATS,
      });
      try {
        const video = (await input.getPrimaryVideoTrack())!;
        const audio = (await input.getPrimaryAudioTrack())!;
        expect(video).toBeTruthy();
        expect(audio).toBeTruthy();
        expect(await video.getCodec()).toBe("avc");
        expect(await audio.getCodec()).toBe("aac");
        expect(await video.getDisplayWidth()).toBe(
          format === "desktop" ? 1920 : 1080,
        );
        expect(await video.getDisplayHeight()).toBe(
          format === "desktop" ? 1080 : 1920,
        );
        expect(await video.computeDuration()).toBeCloseTo(1, 2);
        expect(await audio.computeDuration()).toBeCloseTo(1, 1);
        expect(await audio.getNumberOfChannels()).toBe(2);
        let energy = 0;
        for await (const chunk of new AudioBufferSink(audio).buffers())
          for (const sample of chunk.buffer.getChannelData(0))
            energy += sample * sample;
        expect(energy).toBeGreaterThan(0.01);
        const sink = new CanvasSink(video, {
          width: 80,
          height: 80,
          fit: "contain",
        });
        const a = await sink.getCanvas(0.03);
        const pixelsA = a!.canvas
          .getContext("2d")!
          .getImageData(0, 0, 80, 80)
          .data.slice();
        const b = await sink.getCanvas(0.4);
        const pixelsB = b!.canvas
          .getContext("2d")!
          .getImageData(0, 0, 80, 80).data;
        expect(
          pixelsA.some((value, i) => Math.abs(value - pixelsB[i]!) > 10),
        ).toBe(true);
      } finally {
        input.dispose();
      }
    }, 60000);
  }
  it("honors cancellation without leaving a composition engine alive", async () => {
    const controller = new AbortController();
    const engines = activeCompositionEngines();
    await expect(
      exportVideo(createDefaultProject(), {
        ...options(),
        signal: controller.signal,
        onProgress: (message) => {
          if (message === "Rendering video…") controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(activeCompositionEngines()).toEqual(engines);
  }, 60000);
  it("starts a selected bar at video time zero with its held note already visible", async () => {
    const doc = createDefaultProject();
    doc.transport.bpm = 240;
    doc.patterns.lead[0].bars = 2;
    doc.patterns.lead[0].notes = [{ degree: 3, start: 8, length: 24 }];
    const blob = await exportVideo(doc, {
      ...options(),
      startBar: 2,
      endBar: 2,
    });
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    try {
      const video = (await input.getPrimaryVideoTrack())!;
      expect(await video.getFirstTimestamp()).toBe(0);
      expect(await video.computeDuration()).toBeCloseTo(1, 2);
      const canvas = (await new CanvasSink(video, { width: 160 }).getCanvas(0))!
        .canvas;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      expect(pixels.some((value, index) => index % 4 !== 3 && value > 60)).toBe(
        true,
      );
      const audio = (await input.getPrimaryAudioTrack())!;
      let energy = 0;
      for await (const chunk of new AudioBufferSink(audio).buffers())
        for (const sample of chunk.buffer.getChannelData(0))
          energy += sample * sample;
      expect(energy).toBeGreaterThan(0.01);
    } finally {
      input.dispose();
    }
  }, 60000);
  it("opens the dialog on a phone, fits its controls, and Escape closes it before leaving VIZ", async () => {
    await page.viewport(390, 844);
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <VizPage />, host);
    cleanup = () => {
      dispose();
      host.remove();
    };
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    const dialog = host.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    await page
      .getByRole("combobox", { name: "Format", exact: true })
      .selectOptions("mobile");
    await page
      .getByRole("combobox", { name: "Section", exact: true })
      .selectOptions("range");
    await page
      .getByRole("dialog")
      .screenshot({ path: "artifacts/video-export-phone.png" });
    await userEvent.keyboard("{Escape}");
    expect(dialog.open).toBe(false);
    expect(document.activeElement?.textContent).toBe("Export video");
    await page.viewport(1280, 800);
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Format", exact: true })
      .selectOptions("desktop");
    await page
      .getByRole("dialog")
      .screenshot({ path: "artifacts/video-export-desktop.png" });
    await page.getByRole("button", { name: "Render MP4", exact: true }).click();
    await expect
      .element(page.getByRole("link", { name: "Save MP4", exact: true }))
      .toBeVisible();
    const link = dialog.querySelector("a")!;
    expect(link.download).toMatch(/\.desktop\.mp4$/);
    expect((await fetch(link.href)).headers.get("content-type")).toBe(
      "video/mp4",
    );
  });
});
