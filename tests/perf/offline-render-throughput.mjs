/** Opt-in offline WAV throughput probe. Run only in the manager's timing slot. */
/* global process, window, performance, navigator, OfflineAudioContext, MessagePort, crypto, console */
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outFlag = process.argv.indexOf("--out");
const labelFlag = process.argv.indexOf("--label");
const output = outFlag < 0 ? null : process.argv[outFlag + 1];
const label = labelFlag < 0 ? null : process.argv[labelFlag + 1];
if (!output || !["baseline", "candidate"].includes(label)) {
  throw new Error(
    "Usage: node tests/perf/offline-render-throughput.mjs --label baseline|candidate --out <raw.json>",
  );
}

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string")
    throw new Error("No Vite TCP address");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.addInitScript(() => {
    const probe = { native: [], posts: [] };
    window.__offlineThroughput = probe;
    const startRendering = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = async function () {
      const sample = {
        start: performance.now(),
        frames: this.length,
        channels: this.destination.channelCount,
        sampleRate: this.sampleRate,
      };
      probe.native.push(sample);
      try {
        return await startRendering.call(this);
      } finally {
        sample.end = performance.now();
      }
    };
    const postMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (value, transfer) {
      if (value?.type === "events") {
        probe.posts.push({
          at: performance.now(),
          count: value.events?.length ?? 0,
        });
      }
      return postMessage.call(this, value, transfer);
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const result = {
    label,
    revision: process.env.GIT_COMMIT ?? null,
    capturedAt: new Date().toISOString(),
    mode: "Vite development server, headless Chromium, one page, serial passes",
    browser: await browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: process.platform,
    arch: process.arch,
    viewport: { width: 1280, height: 720 },
    samples: [],
  };
  for (const workload of ["welcome", "glass-arcade"]) {
    for (let pass = 0; pass < 6; pass++) {
      const sample = await page.evaluate(async (id) => {
        const { createBuiltInDemo } =
          await import("/src/document/builtInDemos.ts");
        const { renderProjectToBuffer } = await import("/src/audio/render.ts");
        const { encodeWav16 } = await import("/src/audio/wav.ts");
        const probe = window.__offlineThroughput;
        probe.native.length = 0;
        probe.posts.length = 0;
        const doc = createBuiltInDemo(id);
        const start = performance.now();
        const rendered = await renderProjectToBuffer(doc, {
          arrangement: "linear",
        });
        const renderEnd = performance.now();
        const native = probe.native[0];
        if (!native || probe.native.length !== 1 || native.end === undefined) {
          throw new Error(
            `Expected one completed native render, got ${probe.native.length}`,
          );
        }
        const lastPost = probe.posts.at(-1);
        const frames = rendered.outputSamples ?? rendered.loopSamples;
        const encodeStart = performance.now();
        const bytes = encodeWav16(
          rendered.channels.map((channel) => channel.subarray(0, frames)),
          rendered.sampleRate,
        );
        const encodeEnd = performance.now();
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        const wavSha256 = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        return {
          workload: id,
          renderMs: renderEnd - start,
          setupMs: lastPost ? lastPost.at - start : null,
          ackAndSettleMs: lastPost ? native.start - lastPost.at : null,
          preNativeMs: native.start - start,
          nativeMs: native.end - native.start,
          copyAndFoldMs: renderEnd - native.end,
          encodeMs: encodeEnd - encodeStart,
          native,
          posts: [...probe.posts],
          frames,
          loopSamples: rendered.loopSamples,
          tailSamples: rendered.tailSamples,
          outputChannels: rendered.channels.length,
          sampleRate: rendered.sampleRate,
          wavBytes: bytes.byteLength,
          wavSha256,
        };
      }, workload);
      result.samples.push({ pass, ...sample });
    }
  }
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  console.log(resolve(output));
} finally {
  await browser?.close();
  await server.close();
}
