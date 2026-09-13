import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { renderProjectToBuffer, EXPORT_SAMPLE_RATE } from "../audio/render";
import type { ProjectDocument, LaneId } from "../document/schema";
import type { VisualComposition } from "./composition";
import { createCompositionEngine } from "./compositionEngine";
import {
  createVideoPlan,
  VIDEO_FORMATS,
  VIDEO_FPS,
  type VideoFormat,
} from "./videoPlan";

export interface VideoExportOptions {
  format: VideoFormat;
  startBar: number;
  endBar: number;
  composition: VisualComposition;
  colors: Partial<Record<LaneId, string>>;
  ground: string;
  signal: AbortSignal;
  onProgress: (message: string, fraction: number) => void;
}

export async function exportVideo(
  project: ProjectDocument,
  options: VideoExportOptions,
): Promise<Blob> {
  // Every input is fixed before the first await, including appearance preferences.
  const doc = structuredClone(project);
  const visual = structuredClone(options.composition);
  const colors = { ...options.colors };
  const plan = createVideoPlan(doc, options.startBar, options.endBar);
  const { width, height } = VIDEO_FORMATS[options.format];
  const check = () => options.signal.throwIfAborted();
  check();
  options.onProgress("Checking MP4 support…", 0);
  const [videoSupported, audioSupported] = await Promise.all([
    canEncodeVideo("avc", { width, height, bitrate: 8_000_000 }),
    canEncodeAudio("aac", {
      numberOfChannels: 2,
      sampleRate: EXPORT_SAMPLE_RATE,
      bitrate: 192_000,
    }),
  ]);
  check();
  if (!videoSupported || !audioSupported)
    throw new Error(
      "This browser cannot encode MP4 video with audio. Try a current version of Chrome, Edge, or Safari on another device.",
    );
  options.onProgress("Rendering track audio…", 0.03);
  const rendered = await renderProjectToBuffer(doc);
  check();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("The video canvas could not be created.");
  const engine = createCompositionEngine(visual, colors);
  engine.setPlaying(true);
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: 8_000_000 });
  const audio = new AudioBufferSource({ codec: "aac", bitrate: 192_000 });
  output.addVideoTrack(video, { frameRate: VIDEO_FPS });
  output.addAudioTrack(audio);
  output.setMetadataTags({ title: doc.name });
  let finalized = false;
  try {
    await output.start();
    let hitIndex = 0;
    const draw = (now: number, index: number) => {
      while (
        hitIndex < plan.hits.length &&
        plan.hits[hitIndex]!.audibleAt <= now
      )
        engine.ignite(plan.hits[hitIndex++]!);
      ctx.fillStyle = options.ground || "#080b0d";
      ctx.fillRect(0, 0, width, height);
      engine.draw(
        ctx,
        { index, width, height, dpr: 1, time: now * 1000 },
        now,
        doc.transport.bpm,
      );
    };
    // Replay preceding frames so a selected range retains its motion and held notes.
    const warmupFrames = Math.ceil(plan.startSeconds * VIDEO_FPS);
    for (let frame = 0; frame < warmupFrames; frame++) {
      check();
      draw(frame / VIDEO_FPS, frame);
      if (frame % 15 === 0) {
        options.onProgress(
          "Preparing the selected section…",
          0.1 + (0.15 * frame) / warmupFrames,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    let audioSample = plan.startSample;
    for (let frame = 0; frame < plan.frames; frame++) {
      check();
      const timestamp = frame / VIDEO_FPS;
      draw(plan.startSeconds + timestamp, warmupFrames + frame);
      await video.add(
        timestamp,
        Math.min(1 / VIDEO_FPS, plan.duration - timestamp),
      );
      // Interleave audio in small chunks, keeping encoder queues and MP4 buffering bounded.
      const nextSample = Math.min(
        plan.endSample,
        plan.startSample +
          Math.round(((frame + 1) / VIDEO_FPS) * rendered.sampleRate),
      );
      if (nextSample > audioSample) {
        const buffer = new AudioBuffer({
          numberOfChannels: 2,
          length: nextSample - audioSample,
          sampleRate: rendered.sampleRate,
        });
        rendered.channels.forEach((channel, index) =>
          buffer.copyToChannel(channel.slice(audioSample, nextSample), index),
        );
        await audio.add(buffer);
        audioSample = nextSample;
      }
      if (frame % 10 === 0) {
        options.onProgress(
          "Rendering video…",
          0.25 + (0.7 * (frame + 1)) / plan.frames,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    check();
    options.onProgress("Finishing MP4…", 0.96);
    await output.finalize();
    finalized = true;
    check();
    if (!target.buffer) throw new Error("The MP4 file could not be completed.");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    engine.dispose();
    if (!finalized) await output.cancel().catch(() => undefined);
    canvas.width = canvas.height = 0;
  }
}
