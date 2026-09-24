/** Opt-in browser probe. Run only in an uncontended timing slot. */
/* global process, window, performance, AudioWorklet, AudioContext, MessagePort, AnalyserNode, IDBObjectStore, OfflineAudioContext, document, navigator, structuredClone, console */
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { summarizePlay } from "./latency-math.mjs";

const outputFlag = process.argv.indexOf("--out");
if (outputFlag < 0 || !process.argv[outputFlag + 1]) {
  throw new Error("Usage: node tests/perf/latency-map.mjs --out <raw.json>");
}
const output = resolve(process.argv[outputFlag + 1]);
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No Vite TCP address");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const data = { modules: [], messages: [], resumes: [], frames: [], analyser: [], idbPuts: [], offlineRenders: [], clicks: [] };
    window.__latencyProbe = data;
    const now = () => performance.now();
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, options) {
      const sample = { url: String(url), start: now() };
      data.modules.push(sample);
      try { return await addModule.call(this, url, options); }
      finally { sample.end = now(); }
    };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = async function () {
      const sample = { start: now(), stateBefore: this.state, sampleRate: this.sampleRate };
      data.resumes.push(sample);
      try { return await resume.call(this); }
      finally {
        sample.end = now(); sample.stateAfter = this.state;
        sample.baseLatency = this.baseLatency ?? null;
        sample.outputLatency = this.outputLatency ?? null;
      }
    };
    const send = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (value, transfer) {
      if (value?.type === "events") {
        data.messages.push({ at: now(), count: value.events?.length ?? 0,
          firstAudioTime: value.events?.[0]?.time ?? null });
      }
      return send.call(this, value, transfer);
    };
    const analyse = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function (array) {
      const start = now();
      try { return analyse.call(this, array); }
      finally { data.analyser.push({ at: start, ms: now() - start, bins: array.length }); }
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const start = now();
      const request = put.apply(this, args);
      const sample = { start, issueMs: now() - start, store: this.name };
      data.idbPuts.push(sample);
      request.addEventListener("success", () => { sample.done = now(); });
      request.addEventListener("error", () => { sample.error = String(request.error); });
      return request;
    };
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = async function () {
      const sample = { start: now(), frames: this.length, sampleRate: this.sampleRate };
      data.offlineRenders.push(sample);
      try { return await render.call(this); }
      finally { sample.end = now(); }
    };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (callback) {
      return raf.call(window, (time) => {
        const start = now();
        try { callback(time); }
        finally { data.frames.push({ at: time, ms: now() - start }); }
      });
    };
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".booth-btn-play")) data.clicks.push(now());
    }, true);
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".booth-btn-play").first().waitFor();
  await page.waitForFunction(async () => {
    const { getBootDb } = await import("/src/persist/boot.ts");
    return getBootDb() !== null;
  });
  const result = {
    revision: process.env.GIT_COMMIT ?? null,
    browser: await browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: process.platform,
    arch: process.arch,
    viewport: { width: 1280, height: 720 },
    samples: [],
  };
  for (const workload of ["welcome", "glass-arcade"]) {
    await page.evaluate(async (id) => {
      const { createBuiltInDemo } = await import("/src/document/builtInDemos.ts");
      const { loadDocument } = await import("/src/state/store.ts");
      loadDocument(createBuiltInDemo(id));
      const p = window.__latencyProbe;
      p.modules = []; p.messages = []; p.resumes = []; p.frames = [];
      p.analyser = []; p.idbPuts = []; p.offlineRenders = []; p.clicks = [];
    }, workload);
    for (let pass = 0; pass < 3; pass++) {
      await page.locator(".booth-btn-play").first().click();
      await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).waitFor({ timeout: 10000 });
      await page.waitForTimeout(700);
      await page.locator(".booth-btn-play").first().click();
      const data = await page.evaluate(() => structuredClone(window.__latencyProbe));
      result.samples.push({ workload, phase: pass === 0 && workload === "welcome" ? "cold-play" : "warm-play",
        pass, summary: summarizePlay(data), data });
      await page.evaluate(() => {
        const p = window.__latencyProbe;
        p.modules = []; p.messages = []; p.resumes = []; p.frames = []; p.analyser = []; p.idbPuts = []; p.clicks = [];
      });
    }
    const edits = await page.evaluate(async () => {
      const { toggleDrumStep } = await import("/src/state/store.ts");
      const start = performance.now();
      toggleDrumStep("kick", 0);
      return { commitMs: performance.now() - start, at: start };
    });
    await page.waitForTimeout(1100);
    result.samples.push({ workload, phase: "edit-autosave", edits,
      data: await page.evaluate(() => structuredClone(window.__latencyProbe)) });
    await page.evaluate(() => { window.__latencyProbe.frames = []; window.__latencyProbe.analyser = []; });
    await page.locator(".booth-btn-play").first().click();
    await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).waitFor();
    await page.waitForTimeout(600);
    result.samples.push({ workload, phase: "grid-playing", pass: 0,
      data: await page.evaluate(() => structuredClone(window.__latencyProbe)) });
    await page.evaluate(() => { window.__latencyProbe.frames = []; window.__latencyProbe.analyser = []; });
    await page.evaluate(async () => {
      const { showPhonePage } = await import("/src/state/phonePage.ts");
      showPhonePage("mixer");
    });
    await page.waitForTimeout(600);
    result.samples.push({ workload, phase: "mixer-playing", pass: 0,
      data: await page.evaluate(() => structuredClone(window.__latencyProbe)) });
    await page.evaluate(async () => {
      const { showPhonePage } = await import("/src/state/phonePage.ts");
      showPhonePage("edit");
      const { openViz } = await import("/src/state/vizMode.ts");
      openViz();
    });
    await page.evaluate(() => { window.__latencyProbe.frames = []; });
    await page.waitForTimeout(600);
    result.samples.push({ workload, phase: "viz-playing", pass: 0,
      data: await page.evaluate(() => structuredClone(window.__latencyProbe)) });
    await page.evaluate(async () => {
      const { closeViz } = await import("/src/state/vizMode.ts");
      closeViz();
    });
    await page.locator(".booth-btn-play").first().click();
    await page.evaluate(() => {
      const p = window.__latencyProbe;
      p.frames = []; p.analyser = []; p.idbPuts = [];
    });
  }
  for (const workload of ["welcome", "glass-arcade"]) {
    for (let pass = 0; pass < 3; pass++) {
      const phase = await page.evaluate(async (id) => {
        const { createBuiltInDemo } = await import("/src/document/builtInDemos.ts");
        const { renderProjectToBuffer } = await import("/src/audio/render.ts");
        const { encodeWav16 } = await import("/src/audio/wav.ts");
        const doc = createBuiltInDemo(id);
        const start = performance.now();
        const rendered = await renderProjectToBuffer(doc, { arrangement: "linear" });
        const renderedAt = performance.now();
        const frames = rendered.outputSamples ?? rendered.loopSamples;
        const bytes = encodeWav16(rendered.channels.map((ch) => ch.subarray(0, frames)), rendered.sampleRate);
        return { totalMs: performance.now() - start, renderMs: renderedAt - start,
          encodeMs: performance.now() - renderedAt, frames: rendered.outputSamples ?? rendered.loopSamples,
          bytes: bytes.byteLength };
      }, workload);
      result.samples.push({ workload, phase: "offline-wav", pass, ...phase,
        offlineRenders: await page.evaluate(() => {
          const copy = structuredClone(window.__latencyProbe.offlineRenders);
          window.__latencyProbe.offlineRenders = [];
          return copy;
        }) });
    }
  }
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(output);
} finally {
  await browser?.close();
  await server.close();
}
