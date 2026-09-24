/** Opt-in, serial fresh-context Play probe. Run in an uncontended slot. */
/* global process, console, window, performance, AudioWorklet, AudioContext, MessagePort, document, navigator, structuredClone */
import { createServer, preview } from "vite";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const output = flag("--out", null);
if (!output) throw new Error("Usage: node tests/perf/cold-start.mjs --out <raw.json> [--mode dev|built] [--runs N]");
const mode = flag("--mode", "dev");
const runs = Number(flag("--runs", "12"));
if (!["dev", "built"].includes(mode) || !Number.isInteger(runs) || runs < 1)
  throw new Error("Invalid mode or runs");
const server = mode === "dev"
  ? await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } })
  : await preview({ preview: { host: "127.0.0.1", port: 0, strictPort: false } });
let browser;
try {
  if (mode === "dev") await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  browser = await chromium.launch({ headless: true });
  const result = {
    revision: process.env.GIT_COMMIT ?? null, mode, runs, browser: await browser.version(),
    platform: process.platform, arch: process.arch, viewport: { width: 1280, height: 720 },
    samples: [],
  };
  for (let pass = 0; pass < runs; pass++) {
    const context = await browser.newContext({ viewport: result.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      const data = { clicks: [], resumes: [], modules: [], fetches: [], decodes: [], messages: [] };
      window.__coldStartProbe = data;
      const now = () => performance.now();
      const originalResume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = async function () {
        const sample = { start: now(), stateBefore: this.state };
        data.resumes.push(sample);
        try { return await originalResume.call(this); }
        finally { sample.end = now(); sample.stateAfter = this.state; }
      };
      const originalModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = async function (url, options) {
        const sample = { url: String(url), start: now() };
        data.modules.push(sample);
        try { return await originalModule.call(this, url, options); }
        finally { sample.end = now(); }
      };
      const originalFetch = window.fetch;
      window.fetch = async function (...args) {
        const sample = { url: String(args[0]?.url ?? args[0]), start: now() };
        data.fetches.push(sample);
        try { return await originalFetch.apply(this, args); }
        finally { sample.end = now(); }
      };
      const originalDecode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (...args) {
        const sample = { start: now(), bytes: args[0]?.byteLength ?? null };
        data.decodes.push(sample);
        const result = originalDecode.apply(this, args);
        return result.then((value) => { sample.end = now(); return value; }, (error) => {
          sample.end = now(); sample.error = String(error); throw error;
        });
      };
      const originalPost = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (value, transfer) {
        if (value?.type === "events") data.messages.push({
          at: now(), count: value.events?.length ?? 0,
          firstAudioTime: value.events?.[0]?.time ?? null,
          events: value.events?.map((event) => ({
            type: event.type, lane: event.lane, note: event.note, sample: event.sample ?? null,
          })) ?? [],
        });
        return originalPost.call(this, value, transfer);
      };
      document.addEventListener("click", (event) => {
        if (event.target?.closest?.(".booth-btn-play")) data.clicks.push(now());
      }, true);
    });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.locator(".booth-btn-play").first().waitFor();
      if (mode === "dev") {
        await page.waitForFunction(async () => {
          const { getBootDb } = await import("/src/persist/boot.ts");
          return getBootDb() !== null;
        });
        await page.evaluate(async () => {
          const { createBuiltInDemo } = await import("/src/document/builtInDemos.ts");
          const { loadDocument } = await import("/src/state/store.ts");
          loadDocument(createBuiltInDemo("welcome"));
        });
      }
      // The built app boots into Welcome. Keep its default content for the release check.
      await page.locator(".booth-btn-play").first().click();
      await page.waitForFunction(() => window.__coldStartProbe.messages.some((m) => m.count > 0), null, { timeout: 10000 });
      await page.waitForTimeout(100);
      await page.locator(".booth-btn-play").first().filter({ hasText: "STOP" }).click();
      const beforeWarm = await page.evaluate(() => window.__coldStartProbe.messages.length);
      await page.locator(".booth-btn-play").first().click();
      await page.waitForFunction((count) => window.__coldStartProbe.messages.length > count, beforeWarm, { timeout: 10000 });
      await page.waitForTimeout(100);
      const data = await page.evaluate(() => structuredClone(window.__coldStartProbe));
      const [coldClick, , warmClick] = data.clicks;
      const coldPost = data.messages.find((m) => m.count > 0 && m.at >= coldClick);
      const warmPost = data.messages.find((m) => m.count > 0 && m.at >= warmClick);
      result.userAgent ??= await page.evaluate(() => navigator.userAgent);
      result.samples.push({ pass, coldMs: coldPost ? coldPost.at - coldClick : null,
        warmMs: warmPost ? warmPost.at - warmClick : null, errors, data });
    } catch (error) {
      result.samples.push({ pass, coldMs: null, warmMs: null, errors: [...errors, String(error)],
        data: await page.evaluate(() => structuredClone(window.__coldStartProbe)).catch(() => null) });
    } finally {
      await context.close();
    }
    console.log(`${mode} ${pass + 1}/${runs}: cold=${result.samples.at(-1).coldMs?.toFixed(1) ?? "null"} ms`);
  }
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  console.log(resolve(output));
} finally {
  await browser?.close();
  if (mode === "dev") await server.close();
  else await new Promise((done) => server.httpServer.close(done));
}
