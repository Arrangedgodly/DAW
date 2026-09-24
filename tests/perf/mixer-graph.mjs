/** Opt-in browser graph probe. Run only in a manager-granted clear-host slot. */
/* global process, performance, AudioContext, AudioNode, MessagePort, navigator, window, document, structuredClone, setTimeout */
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const flag = process.argv.indexOf("--out");
if (flag < 0 || !process.argv[flag + 1])
  throw new Error("Usage: node tests/perf/mixer-graph.mjs --out <raw.json> [--runs 8]");
const output = resolve(process.argv[flag + 1]);
const runsFlag = process.argv.indexOf("--runs");
const runs = runsFlag < 0 ? 8 : Number(process.argv[runsFlag + 1]);
if (!Number.isInteger(runs) || runs < 2 || runs > 30)
  throw new Error("--runs must be an integer from 2 to 30");

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No Vite TCP address");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    window.__mixerEvents = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (value, transfer) {
      if (value?.type === "events")
        window.__mixerEvents.push({ at: performance.now(), count: value.events?.length ?? 0 });
      return post.call(this, value, transfer);
    };
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".booth-btn-play")) window.__mixerClick = performance.now();
    }, true);
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".booth-btn-play").first().waitFor();
  await page.locator(".booth-btn-play").first().click();
  await page.waitForFunction(() => window.__mixerEvents.some((event) => event.count > 0));
  const play = await page.evaluate(() => ({ click: window.__mixerClick,
    firstPost: window.__mixerEvents.find((event) => event.count > 0),
    events: structuredClone(window.__mixerEvents) }));
  await page.locator(".booth-btn-play").first().click();

  const result = { revision: process.env.GIT_COMMIT ?? null, browser: await browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent), platform: process.platform,
    arch: process.arch, runs, play, cases: [], errors };
  for (let pass = 0; pass < runs; pass++) {
    // Rotate order to reduce systematic cache/thermal ordering bias.
    const cases = [
      { lanes: 4, mode: "default" }, { lanes: 4, mode: "enabled" },
      { lanes: 4, mode: "stripped" }, { lanes: 8, mode: "default" },
      { lanes: 8, mode: "enabled" }, { lanes: 8, mode: "stripped" },
    ];
    for (let step = 0; step < cases.length; step++) {
      const config = cases[(step + pass) % cases.length];
      const sample = await page.evaluate(async ({ lanes, mode }) => {
        const mixer = await import("/src/audio/mixer.ts");
        const defaults = await import("/src/document/mixer.ts");
        const ctx = new AudioContext({ sampleRate: 44100 });
        const moduleStart = performance.now();
        if (mode !== "stripped") await mixer.prepareMixer(ctx);
        const moduleMs = performance.now() - moduleStart;
        const counts = {};
        const nodes = [];
        let connections = 0;
        const restore = [];
        const methods = ["createGain", "createBiquadFilter", "createStereoPanner", "createWaveShaper"];
        for (const name of methods) {
          const original = ctx[name];
          ctx[name] = function (...args) {
            const node = original.apply(this, args);
            counts[name] = (counts[name] ?? 0) + 1;
            nodes.push(node);
            return node;
          };
          restore.push(() => { ctx[name] = original; });
        }
        const OriginalWorklet = window.AudioWorkletNode;
        window.AudioWorkletNode = class extends OriginalWorklet {
          constructor(...args) {
            super(...args);
            const name = `AudioWorkletNode:${args[1]}`;
            counts[name] = (counts[name] ?? 0) + 1;
            nodes.push(this);
          }
        };
        restore.push(() => { window.AudioWorkletNode = OriginalWorklet; });
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (...args) {
          connections++;
          return connect.apply(this, args);
        };
        restore.push(() => { AudioNode.prototype.connect = connect; });
        const enabled = mode === "enabled";
        const bands = Array.from({ length: 8 }, (_, i) => ({ id: i + 1,
          type: "peaking", frequency: 100 * 1.8 ** i, gain: 3, q: 0.7, enabled: true }));
        const channel = enabled ? { ...defaults.DEFAULT_CHANNEL,
          eq: { ...defaults.DEFAULT_EQ, enabled: true, bands },
          compressor: { ...defaults.DEFAULT_COMPRESSOR, enabled: true } }
          : defaults.DEFAULT_CHANNEL;
        const masterSettings = enabled ? { ...defaults.DEFAULT_MASTER,
          compressor: { ...defaults.DEFAULT_COMPRESSOR, enabled: true },
          limiter: { ...defaults.DEFAULT_MASTER.limiter, enabled: true } }
          : defaults.DEFAULT_MASTER;
        let setupMs;
        let graph;
        try {
          const start = performance.now();
          const masterGain = ctx.createGain();
          const master = mode === "stripped" ? null :
            mixer.createMasterProcessing(ctx, masterSettings);
          if (master) {
            masterGain.connect(master.input);
            master.output.connect(ctx.destination);
          } else masterGain.connect(ctx.destination);
          const channels = [];
          for (let i = 0; i < lanes; i++) {
            const laneGain = ctx.createGain();
            const processing = mode === "stripped" ? null : mixer.createChannelProcessing(ctx, channel);
            if (processing) processing.output.connect(laneGain);
            laneGain.connect(masterGain);
            channels.push({ input: processing?.input ?? laneGain, laneGain });
          }
          setupMs = performance.now() - start;
          graph = { master, channels };
        } finally {
          for (const undo of restore.reverse()) undo();
        }
        // A continuous source checks that the graph actually reaches an output tap.
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        (graph.master?.output ?? graph.channels[0].laneGain).connect(analyser);
        const osc = ctx.createOscillator();
        osc.frequency.value = 220;
        osc.connect(graph.channels[0].input);
        osc.start();
        await ctx.resume();
        const stateAfterResume = ctx.state;
        await new Promise((resolve) => setTimeout(resolve, 110));
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        const peak = data.reduce((value, next) => Math.max(value, Math.abs(next)), 0);
        osc.stop();
        osc.disconnect();
        await ctx.close();
        return { lanes, mode, moduleMs, setupMs, counts, connections,
          totalNodes: nodes.length, outputPeak: peak, stateAfterResume,
          stateAfterClose: ctx.state, sampleRate: ctx.sampleRate };
      }, config);
      result.cases.push({ pass, step, ...sample });
    }
  }
  if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
} finally {
  await browser?.close();
  await server.close();
}
