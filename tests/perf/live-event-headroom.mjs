/** Opt-in live scheduler probe. Run serially on an idle host. */
/* global process, window, performance, AudioContext, AudioWorkletNode, MessagePort, document, navigator, structuredClone */
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { release, version } from "node:os";

const outIndex = process.argv.indexOf("--out");
if (outIndex < 0 || !process.argv[outIndex + 1]) {
  throw new Error("Usage: node tests/perf/live-event-headroom.mjs --out <raw.json>");
}
const output = resolve(process.argv[outIndex + 1]);
const result = {
  revision: process.env.GIT_COMMIT ?? null,
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  osVersion: version(),
  viewport: { width: 1280, height: 720 },
  browser: null,
  userAgent: null,
  windows: [],
  errors: [],
};
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No Vite TCP address");
  browser = await chromium.launch({ headless: true });
  result.browser = await browser.version();
  const context = await browser.newContext({ viewport: result.viewport });
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.push({ kind: "pageerror", message: String(error) }));
  page.on("console", (message) => {
    if (message.type() === "error") result.errors.push({ kind: "console", message: message.text() });
  });
  await page.addInitScript(() => {
    const NativeContext = AudioContext;
    const NativeNode = AudioWorkletNode;
    const nativePost = MessagePort.prototype.postMessage;
    const nativeInterval = window.setInterval;
    const nativeClear = window.clearInterval;
    const lanes = new WeakMap();
    const state = {
      posts: [], replies: [], refills: [], visibility: [], contexts: [],
      timerIds: [], clickTimes: [], nodes: [],
    };
    window.__liveProbe = state;
    const stamp = () => ({ wallMs: performance.now(), audioTime: window.__liveAudioContext?.currentTime ?? null });
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args);
        window.__liveAudioContext = this;
        state.contexts.push({ ...stamp(), sampleRate: this.sampleRate, baseLatency: this.baseLatency ?? null, outputLatency: this.outputLatency ?? null });
      }
    };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, options) {
        super(context, name, options);
        if (name === "voice-engine") {
          const lane = state.nodes.length;
          lanes.set(this.port, lane);
          state.nodes.push({ lane, ...stamp() });
          this.port.addEventListener("message", (event) => {
            const value = event.data;
            if (value?.type === "loaded" || value?.type === "consumed") {
              state.replies.push({ lane, type: value.type, count: value.count ?? null,
                untilTime: value.untilTime ?? null, ...stamp() });
            }
          });
        }
      }
    };
    MessagePort.prototype.postMessage = function (value, transfer) {
      if (value?.type === "events" && Array.isArray(value.events)) {
        state.posts.push({ ...stamp(), lane: lanes.get(this) ?? null, count: value.events.length,
          events: value.events.map((event) => ({ time: event.time, type: event.type ?? null })) });
      }
      return nativePost.call(this, value, transfer);
    };
    window.setInterval = function (callback, delay, ...args) {
      if (delay !== 25 || typeof callback !== "function") return nativeInterval.call(this, callback, delay, ...args);
      const id = nativeInterval.call(this, (...callbackArgs) => {
        state.refills.push({ ...stamp(), hidden: document.hidden });
        callback(...callbackArgs);
      }, delay, ...args);
      state.timerIds.push(id);
      return id;
    };
    window.clearInterval = function (id) {
      return nativeClear.call(this, id);
    };
    document.addEventListener("visibilitychange", () => {
      state.visibility.push({ ...stamp(), hidden: document.hidden });
    });
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".booth-btn-play")) state.clickTimes.push(stamp());
    }, true);
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".booth-btn-play").first().waitFor();
  await page.waitForFunction(async () => {
    const { getBootDb } = await import("/src/persist/boot.ts");
    return getBootDb() !== null;
  });
  result.userAgent = await page.evaluate(() => navigator.userAgent);

  for (const workload of ["welcome", "glass-arcade"]) {
    await page.evaluate(async (id) => {
      const { createBuiltInDemo } = await import("/src/document/builtInDemos.ts");
      const { loadDocument } = await import("/src/state/store.ts");
      loadDocument(createBuiltInDemo(id));
    }, workload);
    for (let pass = 0; pass < 6; pass++) {
      await page.evaluate(() => {
        const probe = window.__liveProbe;
        probe.posts = []; probe.replies = []; probe.refills = [];
        probe.visibility = []; probe.clickTimes = [];
      });
      const errorStart = result.errors.length;
      await page.locator(".booth-btn-play").first().click();
      await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).waitFor({ timeout: 10000 });
      await page.waitForTimeout(1400);
      const end = await page.evaluate(() => ({ wallMs: performance.now(), audioTime: window.__liveAudioContext?.currentTime ?? null }));
      await page.locator(".booth-btn-play").first().click();
      await page.waitForTimeout(100);
      result.windows.push({ workload, pass, visibility: "foreground", end,
        data: await page.evaluate(() => structuredClone(window.__liveProbe)),
        errors: result.errors.slice(errorStart) });
    }
  }
  await page.evaluate(() => {
    const probe = window.__liveProbe;
    probe.posts = []; probe.replies = []; probe.refills = [];
    probe.visibility = []; probe.clickTimes = [];
  });
  const errorStart = result.errors.length;
  await page.locator(".booth-btn-play").first().click();
  await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).waitFor();
  const cover = await page.context().newPage();
  await cover.goto("about:blank");
  await cover.bringToFront();
  await page.waitForTimeout(2500);
  const hiddenEnd = await page.evaluate(() => ({ wallMs: performance.now(), audioTime: window.__liveAudioContext?.currentTime ?? null, hidden: document.hidden }));
  await page.bringToFront();
  await page.locator(".booth-btn-play").first().click();
  await page.waitForTimeout(100);
  result.windows.push({ workload: "glass-arcade", pass: 0, visibility: "hidden-attempt", end: hiddenEnd,
    data: await page.evaluate(() => structuredClone(window.__liveProbe)),
    errors: result.errors.slice(errorStart) });
  await cover.close();
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(`${output}\n`);
} finally {
  await browser?.close();
  await server.close();
}
