/**
 * WAV download: render one finite linear arrangement, retain its release/FX
 * tail, encode 16-bit stereo PCM, then download <name>.bitbounce.wav.
 * Rendering owns an independent audio graph and cannot interrupt playback.
 * Legacy injected cycle renders retain their exact loop-tight frame count.
 */

import { renderProjectToBuffer, type RenderedLoop } from "./render";
import { encodeWav16, WAV_BYTES_PER_SAMPLE } from "./wav";
import type { ProjectDocument } from "../document/schema";
import { safeFileStem, type DownloadSeam } from "../persist/fileIO";

export const WAV_EXTENSION = ".bitbounce.wav";

export type ExportWavFailureKind = "render" | "encode" | "io";

export interface ExportWavFailure {
  readonly ok: false;
  readonly kind: ExportWavFailureKind;
  readonly message: string;
  readonly suggestion: string;
}

export interface ExportWavSuccess {
  readonly ok: true;
  readonly filename: string;
  /** Bars in the arranged song, excluding the release tail. */
  readonly bars: number;
  readonly loopSamples: number;
  readonly sampleRate: number;
  readonly byteLength: number;
}

export type ExportWavResult = ExportWavSuccess | ExportWavFailure;

export interface ExportWavOptions {
  /** Injectable renderer (unit tests); default = the real offline render. */
  readonly render?: (doc: ProjectDocument) => Promise<RenderedLoop>;
  /** Download seam (unit tests). */
  readonly seam?: DownloadSeam;
}

function downloadBytes(
  filename: string,
  bytes: Uint8Array,
  seam: DownloadSeam,
): void {
  // slice() gives a Uint8Array<ArrayBuffer> (BlobPart wants a plain
  // ArrayBuffer-backed view), copying once — sub-megabyte payloads.
  const blob = new Blob([bytes.slice()], { type: "audio/wav" });
  const url = seam.createObjectURL(blob);
  try {
    const anchor = seam.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    seam.revokeObjectURL(url);
  }
}

/**
 * Export the project's linear song as a 16-bit stereo WAV download.
 * Returns a typed result; throws nothing.
 */
export async function exportWav(
  project: ProjectDocument,
  opts: ExportWavOptions = {},
): Promise<ExportWavResult> {
  const render =
    opts.render ??
    ((doc: ProjectDocument) =>
      renderProjectToBuffer(doc, { arrangement: "linear" }));

  let rendered: RenderedLoop;
  try {
    rendered = await render(project);
  } catch {
    return {
      ok: false,
      kind: "render",
      message: "WAV could not be rendered.",
      suggestion: "Playback is untouched — try exporting again.",
    };
  }

  // Honor the renderer's exact output length, including linear release tails.
  const outputSamples = rendered.outputSamples ?? rendered.loopSamples;
  const loop = rendered.channels.map((ch) =>
    ch.length === outputSamples ? ch : ch.subarray(0, outputSamples),
  );

  let bytes: Uint8Array;
  try {
    bytes = encodeWav16(loop, rendered.sampleRate);
  } catch {
    return {
      ok: false,
      kind: "encode",
      message: "WAV encoding failed.",
      suggestion: "Playback is untouched — this is a bug; please report it.",
    };
  }

  const filename = `${safeFileStem(project.name)}${WAV_EXTENSION}`;
  try {
    downloadBytes(filename, bytes, opts.seam ?? defaultSeam());
  } catch {
    return {
      ok: false,
      kind: "io",
      message: "WAV file could not be saved.",
      suggestion: "Check the browser's download settings, then try again.",
    };
  }

  return {
    ok: true,
    filename,
    bars: rendered.loopSteps / 16,
    loopSamples: rendered.loopSamples,
    sampleRate: rendered.sampleRate,
    byteLength: bytes.byteLength,
  };
}

/** Expected WAV byte length for a loop (test/verification helper). */
export function expectedWavByteLength(loopSamples: number): number {
  return 44 + loopSamples * 2 /* channels */ * WAV_BYTES_PER_SAMPLE;
}

function defaultSeam(): DownloadSeam {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createElement: (tag) =>
      document.createElement(tag as "a") as HTMLAnchorElement,
  };
}
