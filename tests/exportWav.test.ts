/**
 * MF-4 unit tests — exportWav pipeline (render seam injected; the REAL render
 * is exercised browser-side in tests/browser/exportWav.test.ts).
 *
 * Laws under test:
 * - the exported file is trimmed to EXACTLY loopSamples (the loop region of
 *   the folded buffer — the file IS the loop);
 * - filename = sanitized stem + ".bitbounce.wav", blob type audio/wav;
 * - typed failures (render throws → ok:false kind:"render"), never throws;
 * - byte length = 44 + loopSamples × 4.
 */

import { describe, expect, it } from "vitest";
import {
  exportWav,
  WAV_EXTENSION,
  expectedWavByteLength,
} from "../src/audio/exportWav";
import type { DownloadSeam } from "../src/persist/fileIO";
import type { ProjectDocument } from "../src/document/schema";
import { createDefaultProject } from "../src/document/schema";
import type { RenderedLoop } from "../src/audio/render";
import { encodeWav16 } from "../src/audio/wav";

function fakeLoop(loopSamples: number, overLong = 0): RenderedLoop {
  const mk = () => new Float32Array(loopSamples + overLong).fill(0.25);
  return {
    channels: [mk(), mk()],
    loopSamples,
    tailSamples: 0,
    sampleRate: 44100,
    loopSteps: 16,
    bpm: 120,
  };
}

function captureSeam(): {
  seam: DownloadSeam;
  downloads: { name: string; blob: Blob }[];
} {
  const downloads: { name: string; blob: Blob }[] = [];
  let n = 0;
  const seam: DownloadSeam = {
    createObjectURL: (blob) => {
      downloads.push({ name: `#pending-${n++}`, blob });
      return `blob:fake-${n}`;
    },
    revokeObjectURL: () => undefined,
    createElement: () => ({ click: () => undefined, href: "", download: "" }),
  };
  return { seam, downloads };
}

async function lastDownloadBytes(cap: {
  downloads: { name: string; blob: Blob }[];
}): Promise<Uint8Array> {
  const blob = cap.downloads[cap.downloads.length - 1]!.blob;
  return new Uint8Array(await blob.arrayBuffer());
}

describe("exportWav — trim + encode + download", () => {
  it("trims to EXACTLY loopSamples and downloads a byte-exact audio/wav file", async () => {
    const cap = captureSeam();
    const doc = createDefaultProject();
    const result = await exportWav(doc, {
      render: () => Promise.resolve(fakeLoop(88200, 100)), // 100 samples too long
      seam: cap.seam,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loopSamples).toBe(88200);
    expect(result.bars).toBe(1); // loopSteps 16 / 16
    expect(result.byteLength).toBe(expectedWavByteLength(88200)); // 44 + 88200×4
    const bytes = await lastDownloadBytes(cap);
    expect(bytes.byteLength).toBe(44 + 88200 * 4);
    // Encoded content = the TRIMMED buffer through the same pure encoder.
    const expected = encodeWav16(
      [new Float32Array(88200).fill(0.25), new Float32Array(88200).fill(0.25)],
      44100,
    );
    expect(bytes).toEqual(expected);
    expect(cap.downloads).toHaveLength(1);
    expect(result.filename.endsWith(WAV_EXTENSION)).toBe(true);
  });

  it("filename = path-sanitized stem + extension", async () => {
    const cap = captureSeam();
    const doc = {
      ...createDefaultProject(),
      name: "../my song/\\x",
    } as ProjectDocument;
    const result = await exportWav(doc, {
      render: () => Promise.resolve(fakeLoop(16)),
      seam: cap.seam,
    });
    expect(result.ok && result.filename).toBe(`..my songx${WAV_EXTENSION}`);
  });

  it("falls back to a safe stem for empty/blank names", async () => {
    const cap = captureSeam();
    const doc = { ...createDefaultProject(), name: "///" } as ProjectDocument;
    const result = await exportWav(doc, {
      render: () => Promise.resolve(fakeLoop(16)),
      seam: cap.seam,
    });
    expect(result.ok && result.filename).toBe(`project${WAV_EXTENSION}`);
  });
});

describe("exportWav — typed failures (never throws)", () => {
  it("render failure → ok:false kind render with recovery suggestion", async () => {
    const cap = captureSeam();
    const result = await exportWav(createDefaultProject(), {
      render: () => Promise.reject(new Error("boom")),
      seam: cap.seam,
    });
    expect(result).toMatchObject({ ok: false, kind: "render" });
    if (result.ok) return;
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.suggestion.length).toBeGreaterThan(0);
    expect(cap.downloads).toHaveLength(0); // nothing downloaded on failure
  });

  it("blob type is audio/wav", async () => {
    const cap = captureSeam();
    await exportWav(createDefaultProject(), {
      render: () => Promise.resolve(fakeLoop(64)),
      seam: cap.seam,
    });
    expect(cap.downloads[0]!.blob.type).toBe("audio/wav");
  });
});
