/** Opt-in measurement on a physical Android Chrome tab. Run only in a granted timing slot. */
/* global process, window, document, performance, navigator, AudioContext, AudioWorkletNode, MessagePort, PerformanceObserver, structuredClone */
import { createServer } from "vite";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { gzipSync } from "node:zlib";

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const output = argument("--out");
const adb = argument("--adb");
const conditionsPath = argument("--conditions");
if (!output || !adb || !conditionsPath) throw new Error("Usage: node tests/perf/android-live.mjs --adb <adb.exe> --conditions <conditions.json> --out <raw.json>");
const conditions = JSON.parse(await readFile(resolve(conditionsPath), "utf8"));
for (const key of ["outputRoute", "batteryPercent", "thermalState", "accessory", "usbDebugApproval"])
  if (conditions[key] === undefined) throw new Error(`Conditions file needs ${key}; use null if unobserved`);
if (conditions.outputRoute !== "phone-speaker") throw new Error("This run requires confirmed phone-speaker output");
const adbCall = (...args) => execFileSync(adb, args, { encoding: "utf8" }).trim();
const devices = adbCall("devices", "-l");
const authorized = devices.split(/\r?\n/).filter((line) => /\sdevice\s/.test(line) && !/^emulator-/.test(line));
if (authorized.length !== 1) throw new Error(`Expected one authorized physical Android device; adb reported:\n${devices}`);
if (adbCall("shell", "getprop", "ro.kernel.qemu") === "1") throw new Error("Refusing an Android emulator; connect the physical phone");
const properties = Object.fromEntries([
  ["model", "ro.product.model"], ["manufacturer", "ro.product.manufacturer"],
  ["device", "ro.product.device"], ["androidRelease", "ro.build.version.release"],
  ["sdk", "ro.build.version.sdk"],
].map(([name, key]) => [name, adbCall("shell", "getprop", key) || null]));
const result = {
  schema: 1, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  mode: "vite-dev-android-chrome-cdp", capturedAt: new Date().toISOString(),
  device: { ...properties, adbVersion: adbCall("version"), browser: null, userAgent: null,
    ...conditions },
  cdPort: 9222, pageUrl: "http://localhost:5173/", windows: [], traces: [], errors: [],
};
const server = await createServer({ server: { host: "127.0.0.1", port: 5173, strictPort: true } });
let browser;
try {
  await server.listen();
  // adb reverse keeps the server on host loopback and gives Android Chrome a
  // trustworthy localhost origin. The CDP forward likewise binds only locally.
  adbCall("reverse", "tcp:5173", "tcp:5173");
  adbCall("forward", "tcp:9222", "localabstract:chrome_devtools_remote");
  browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { noDefaults: true });
  result.device.browser = await browser.version();
  const context = browser.contexts()[0];
  if (!context) throw new Error("Android Chrome exposed no default CDP context");
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.push({ type: "pageerror", message: String(error) }));
  page.on("console", (message) => {
    if (message.type() === "error") result.errors.push({ type: "console", message: message.text() });
  });
  await page.addInitScript(() => {
    const NativeContext = AudioContext;
    const NativeNode = AudioWorkletNode;
    const nativePost = MessagePort.prototype.postMessage;
    const nativeInterval = window.setInterval;
    const nativeRaf = window.requestAnimationFrame;
    const ports = new WeakMap();
    const callbackKinds = new WeakMap();
    const state = { posts: [], replies: [], refills: [], frames: [], longTasks: [], gestures: [],
      contexts: [], nodes: [], visibility: [], recording: false, longTaskSupported: false };
    window.__androidLive = state;
    const stamp = () => ({ wallMs: performance.now(), audioTime: window.__androidAudioContext?.currentTime ?? null });
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args);
        window.__androidAudioContext = this;
        state.contexts.push({ ...stamp(), sampleRate: this.sampleRate,
          baseLatency: this.baseLatency ?? null, outputLatency: this.outputLatency ?? null });
      }
    };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, options) {
        super(context, name, options);
        if (name === "voice-engine") {
          const lane = state.nodes.length;
          ports.set(this.port, lane);
          state.nodes.push({ lane, ...stamp() });
          this.port.addEventListener("message", (event) => {
            if (!state.recording) return;
            const value = event.data;
            if (value?.type === "loaded" || value?.type === "consumed")
              state.replies.push({ lane, type: value.type, count: value.count ?? null,
                untilTime: value.untilTime ?? null, ...stamp() });
          });
        }
      }
    };
    MessagePort.prototype.postMessage = function (value, transfer) {
      if (state.recording && value?.type === "events" && Array.isArray(value.events))
        state.posts.push({ lane: ports.get(this) ?? null, ...stamp(), count: value.events.length,
          events: value.events.map((event) => ({ time: event.time, type: event.type ?? null })) });
      return nativePost.call(this, value, transfer);
    };
    window.setInterval = function (callback, delay, ...args) {
      if (delay !== 25 || typeof callback !== "function") return nativeInterval.call(this, callback, delay, ...args);
      return nativeInterval.call(this, (...callbackArgs) => {
        if (state.recording) state.refills.push({ ...stamp(), hidden: document.hidden });
        callback(...callbackArgs);
      }, delay, ...args);
    };
    window.requestAnimationFrame = function (callback) {
      if (!callbackKinds.has(callback)) {
        const stack = new Error().stack ?? "";
        callbackKinds.set(callback, stack.includes("/src/grid/renderer.ts") ? "grid" :
          stack.includes("/src/viz/renderer.ts") ? "visualizer" : "other");
      }
      const kind = callbackKinds.get(callback);
      return nativeRaf.call(window, (time) => {
        const start = performance.now();
        try { callback(time); }
        finally {
          if (state.recording && (kind === "grid" || kind === "visualizer"))
            state.frames.push({ kind, at: start, callbackMs: performance.now() - start });
        }
      });
    };
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      state.longTaskSupported = true;
      new PerformanceObserver((list) => {
        if (state.recording) for (const entry of list.getEntries())
          state.longTasks.push({ at: entry.startTime, durationMs: entry.duration, name: entry.name });
      }).observe({ type: "longtask" });
    }
    document.addEventListener("click", (event) => {
      if (state.recording && event.target?.closest?.(".booth-btn-play")) state.gestures.push(stamp());
    }, true);
    document.addEventListener("visibilitychange", () => {
      if (state.recording) state.visibility.push({ ...stamp(), hidden: document.hidden });
    });
  });
  const load = async (workload) => {
    await page.goto(result.pageUrl, { waitUntil: "domcontentloaded" });
    await page.locator(".booth-btn-play").first().waitFor();
    await page.waitForFunction(async () => {
      const { getBootDb } = await import("/src/persist/boot.ts");
      return getBootDb() !== null;
    });
    await page.evaluate(async (id) => {
      const { createBuiltInDemo } = await import("/src/document/builtInDemos.ts");
      const { loadDocument } = await import("/src/state/store.ts");
      loadDocument(createBuiltInDemo(id));
    }, workload);
  };
  const play = async (workload, temperature, pass, durationMs) => {
    const errorStart = result.errors.length;
    await page.evaluate(() => {
      const state = window.__androidLive;
      for (const key of ["posts", "replies", "refills", "frames", "longTasks", "gestures", "visibility"])
        state[key] = [];
      state.recording = true;
    });
    await page.locator(".booth-btn-play").first().click();
    await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(durationMs);
    const end = await page.evaluate(() => ({ wallMs: performance.now(), audioTime: window.__androidAudioContext?.currentTime ?? null }));
    await page.locator(".booth-btn-play").first().click();
    await page.waitForTimeout(100);
    const data = await page.evaluate(() => {
      window.__androidLive.recording = false;
      return structuredClone(window.__androidLive);
    });
    result.windows.push({ workload, temperature, pass, durationMs, end, data,
      errors: result.errors.slice(errorStart) });
    await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  };
  result.device.userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
  for (const workload of ["welcome", "glass-arcade"]) {
    for (let pass = 1; pass <= 5; pass++) {
      await load(workload);
      if (!result.device.userAgent) result.device.userAgent = await page.evaluate(() => navigator.userAgent);
      await play(workload, "fresh-page", pass, 1500);
    }
    // Warm Play shares the current page and audio context after Stop.
    for (let pass = 1; pass <= 5; pass++) await play(workload, "repeat-play", pass, 1500);
  }
  await load("glass-arcade");
  const tracePath = `${resolve(output).replace(/\.json$/i, "")}-eight-lane-trace.json.gz`;
  const session = await context.newCDPSession(page);
  const events = [];
  session.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  const completed = new Promise((accept) => session.once("Tracing.tracingComplete", accept));
  await session.send("Tracing.start", { categories: "devtools.timeline,v8,blink.user_timing", transferMode: "ReportEvents" });
  try { await play("glass-arcade", "eight-lane-sustained", 1, 10000); }
  finally { await session.send("Tracing.end"); await completed; }
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, gzipSync(JSON.stringify({ traceEvents: events })));
  result.traces.push({ workload: "glass-arcade", file: tracePath, events: events.length });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  await page.close();
} catch (error) {
  result.errors.push({ type: "harness", message: String(error), at: new Date().toISOString() });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  throw error;
} finally {
  await browser?.close();
  await server.close();
  try { adbCall("forward", "--remove", "tcp:9222"); } catch { /* preserve primary error */ }
  try { adbCall("reverse", "--remove", "tcp:5173"); } catch { /* preserve primary error */ }
}
