/**
 * WAV export pipeline (MF-4): render → trim to EXACT loopSamples → encode →
 * Blob download `<name>.bitbounce.wav`.
 *
 * The exported file IS the loop: renderProjectToBuffer (IM-5) already folds
 * the FX tail into the loop start, so `channels` is the loop-tight buffer of
 * length loopSamples. We still slice defensively to loopSamples — the file
 * length is the product's core promise (sample-exact
 * bars×beats×samples-per-beat), so the encoder must never see one sample
 * more or fewer.
 *
 * Playback isolation (verified): the render builds its OWN
 * OfflineAudioContext and its own worklet/voice-engine/FX instances; the only
 * module-level state in the engine path is a per-context WeakSet of loaded
 * worklet modules (voiceEngine.ts). Exporting while playing cannot touch the
 * live graph — no shared mutable state exists between the two.
 *
 * Error taxonomy (Hulk law, mirrors fileIO.ts): typed results, never
 * exceptions across the API boundary. render-failure is the one failure kind
 * an offline render can produce in practice (context/worklet construction);
 * encode throws are a programmer error (stereo contract is structural) and
 * surface as the same typed failure with the cause message.
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
  /** bars in the exported loop (loopSteps / 16 — display only). */
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
 * Export the project's loop as a loop-tight 16-bit stereo WAV download.
 * Returns a typed result; throws nothing.
 */
export async function exportWav(
  project: ProjectDocument,
  opts: ExportWavOptions = {},
): Promise<ExportWavResult> {
  const render =
    opts.render ?? ((doc: ProjectDocument) => renderProjectToBuffer(doc));

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

  // Trim to EXACTLY the loop region (defensive: the folded buffer's channel
  // length is the contract, the file length is the promise).
  const loop = rendered.channels.map((ch) =>
    ch.length === rendered.loopSamples
      ? ch
      : ch.subarray(0, rendered.loopSamples),
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
