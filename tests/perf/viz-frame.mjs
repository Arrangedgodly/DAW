/** Opt-in P-06 probe. Run only after the manager grants an uncontended slot. */
/* global process, window, performance, MessagePort, navigator, structuredClone, console */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const flag = process.argv.indexOf("--out");
if (flag < 0 || !process.argv[flag + 1])
  throw new Error("Usage: node tests/perf/viz-frame.mjs --out <raw.json>");
const output = resolve(process.argv[flag + 1]);
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(q * sorted.length) - 1];
};
const summarize = (data) => {
  const durations = data.frames.map((frame) => frame.ms);
  const times = [...new Set(data.frames.map((frame) => frame.at))].sort((a, b) => a - b);
  const intervals = times.slice(1).map((time, i) => time - times[i]);
  return {
    callbacks: durations.length,
    timestamps: times.length,
    callbackP95Ms: quantile(durations, 0.95),
    callbackMaxMs: durations.length ? Math.max(...durations) : null,
    intervalP95Ms: quantile(intervals, 0.95),
    droppedIntervalRatio: intervals.length
      ? intervals.filter((ms) => ms >= 33.4).length / intervals.length : null,
    postedBatches: data.messages.length,
    postedNotes: data.messages.reduce((sum, message) => sum + message.count, 0),
  };
};
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No Vite TCP address");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const data = { frames: [], messages: [] };
    window.__vizFrameProbe = data;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (callback) {
      return raf.call(window, (time) => {
        const start = performance.now();
        try { callback(time); }
        finally { data.frames.push({ at: time, ms: performance.now() - start }); }
      });
    };
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (value, transfer) {
      if (value?.type === "events")
        data.messages.push({ at: performance.now(), count: value.events?.length ?? 0 });
      return post.call(this, value, transfer);
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".booth-btn-play").first().waitFor();
  await page.waitForFunction(async () => {
    const { getBootDb } = await import("/src/persist/boot.ts");
    return getBootDb() !== null;
  });
  await page.evaluate(async () => {
    const { createBuiltInDemo } = await import("/src/document/builtInDemos.ts");
    const { loadDocument } = await import("/src/state/store.ts");
    loadDocument(createBuiltInDemo("glass-arcade"));
  });
  await page.locator(".booth-btn-play").first().click();
  await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  const result = {
    revision: process.env.GIT_COMMIT ?? null,
    browser: await browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: process.platform,
    arch: process.arch,
    viewport: { width: 1280, height: 720 },
    workload: "glass-arcade",
    windows: [],
  };
  await mkdir(dirname(output), { recursive: true });
  for (let pass = 0; pass < 5; pass++) {
    for (const phase of ["grid", "viz"]) {
      await page.evaluate(async (next) => {
        if (next === "viz") {
          const { openViz } = await import("/src/state/vizMode.ts");
          openViz();
        } else {
          const { closeViz } = await import("/src/state/vizMode.ts");
          closeViz();
        }
      }, phase);
      if (phase === "viz") await page.locator(".viz-canvas").waitFor();
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        window.__vizFrameProbe.frames = [];
        window.__vizFrameProbe.messages = [];
      });
      await page.waitForTimeout(1200);
      const data = await page.evaluate(() => structuredClone(window.__vizFrameProbe));
      const pngFile = phase === "viz" && pass === 0
        ? output.replace(/\.json$/i, "") + "-representative.png"
        : null;
      if (pngFile) await page.locator(".viz-canvas").screenshot({ path: pngFile });
      result.windows.push({ pass, phase, summary: summarize(data), data, pngFile });
    }
  }
  // Attribution is separate from the unprofiled comparison windows. CPU
  // sampling and DevTools tracing can change callback timing.
  await page.evaluate(async () => {
    const { openViz } = await import("/src/state/vizMode.ts");
    openViz();
  });
  await page.locator(".viz-canvas").waitFor();
  await page.waitForTimeout(200);
  const traceFile = output.replace(/\.json$/i, "") + "-attribution-trace.json";
  const profileFile = output.replace(/\.json$/i, "") + "-attribution.cpuprofile";
  const traceDone = new Promise((resolveTrace) => cdp.once("Tracing.tracingComplete", resolveTrace));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink,cc",
    transferMode: "ReturnAsStream",
  });
  await cdp.send("Profiler.start");
  await page.waitForTimeout(1800);
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.send("Tracing.end");
  const { stream } = await traceDone;
  let trace = "";
  while (true) {
    const chunk = await cdp.send("IO.read", { handle: stream });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  await writeFile(traceFile, trace);
  await writeFile(profileFile, JSON.stringify(profile));
  result.attribution = { profileFile, traceFile };
  await page.evaluate(async () => {
    const { closeViz } = await import("/src/state/vizMode.ts");
    closeViz();
  });
  await page.locator(".booth-btn-play").first().click();
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(output);
} finally {
  await browser?.close();
  await server.close();
}
