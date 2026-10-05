import { el } from "@elemaudio/core";
import OfflineRenderer from "@elemaudio/offline-renderer";
import { createReverbDevice, renderImpulseResponse } from "../../src/audio/fx";

const SAMPLE_RATE = 44_100;
const BLOCK_SIZE = 512;
const PRIME_FRAMES = BLOCK_SIZE * 2;
const SETTLE_FRAMES = BLOCK_SIZE * 8;
const PROGRAM_SECONDS = 8;
const PASSES = 5;
const REVERB_SEED = 0x5eed;
const REVERB_SIZE = 0.65;
const REVERB_MIX = 0.5;
// Observed maximum was 5.96e-8: one float32 ULP at a unit-scale signal.
const FLOAT32_PARITY_PEAK_TOLERANCE = 1e-7;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLElement>("#result")!;
type Stereo = readonly [Float32Array, Float32Array];
type Topology = "wire" | "wet" | "fixed" | "production";

const reverbDevice = {
  type: "reverb" as const,
  bypassed: false,
  params: { size: REVERB_SIZE, mix: REVERB_MIX },
};
const ir = renderImpulseResponse({ seed: REVERB_SEED, size: REVERB_SIZE, sampleRate: SAMPLE_RATE });
const irFrames = ir.channels[0].length;

function makeInput(seconds: number, firstTransientOffset = 0): [Float32Array, Float32Array] {
  const count = Math.round(SAMPLE_RATE * seconds);
  const channels: [Float32Array, Float32Array] = [new Float32Array(count), new Float32Array(count)];
  for (let beat = 0; beat < 16; beat++) {
    const start = Math.round((beat * 60 / 120) * SAMPLE_RATE) + (beat === 0 ? firstTransientOffset : 0);
    for (let i = 0; i < 180; i++) {
      const index = start + i;
      if (index >= count) throw new Error(`Input transient ${beat} exceeds ${count} frames`);
      const envelope = Math.exp(-i / 34);
      const sample = (i === 0 ? 0.8 : 0) + Math.sin(i * 1.71) * envelope * 0.18;
      channels[0][index] = sample;
      channels[1][index] = sample * (0.96 + Math.sin(i * 0.07) * 0.03);
    }
  }
  return channels;
}

function zeros(frames: number): [Float32Array, Float32Array] {
  return [new Float32Array(frames), new Float32Array(frames)];
}

function concatenate(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function outputLength(inputFrames: number): number {
  return Math.ceil((inputFrames + irFrames) / BLOCK_SIZE) * BLOCK_SIZE;
}

function assertStereo(label: string, value: Stereo, frames?: number): void {
  if (value[0].length !== value[1].length || (frames !== undefined && value[0].length !== frames)) {
    throw new Error(`${label}: invalid stereo lengths ${value[0].length}/${value[1].length}, expected ${frames ?? "equal"}`);
  }
  for (const channel of value) {
    for (const sample of channel) if (!Number.isFinite(sample)) throw new Error(`${label}: non-finite sample`);
  }
}

function assertSilent(label: string, value: Stereo): void {
  assertStereo(label, value);
  const peak = Math.max(...value.map((channel) => channel.reduce((m, sample) => Math.max(m, Math.abs(sample)), 0)));
  if (peak !== 0) throw new Error(`${label}: expected silence, got peak ${peak}`);
}

function assertEqual(label: string, actual: Float32Array, expected: Float32Array, tolerance = 2e-6): void {
  if (actual.length !== expected.length) throw new Error(`${label}: length mismatch`);
  let peak = 0;
  let peakIndex = -1;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i]! - expected[i]!);
    if (error > peak) { peak = error; peakIndex = i; }
  }
  if (peak > tolerance) throw new Error(`${label}: peak error ${peak} at ${peakIndex} exceeds ${tolerance}`);
}

function assertParity(label: string, actual: Stereo, reference: Stereo): ReturnType<typeof compare> {
  const delta = compare(actual, reference);
  if (delta.peak > FLOAT32_PARITY_PEAK_TOLERANCE) {
    throw new Error(`${label}: peak difference ${delta.peak} at ${delta.peakChannel}:${delta.peakIndex} exceeds measured float32 tolerance ${FLOAT32_PARITY_PEAK_TOLERANCE}`);
  }
  return delta;
}

function summarize(left: Float32Array, right: Float32Array) {
  let energy = 0;
  let peak = 0;
  let peakIndex = 0;
  let peakChannel = "L";
  for (let i = 0; i < left.length; i++) {
    energy += left[i]! ** 2 + right[i]! ** 2;
    if (Math.abs(left[i]!) > peak) { peak = Math.abs(left[i]!); peakIndex = i; peakChannel = "L"; }
    if (Math.abs(right[i]!) > peak) { peak = Math.abs(right[i]!); peakIndex = i; peakChannel = "R"; }
  }
  return { rms: Math.sqrt(energy / (left.length * 2)), peak, peakIndex, peakChannel };
}

function compare(left: Stereo, ref: Stereo) {
  if (left[0].length !== ref[0].length || left[1].length !== ref[1].length) throw new Error("Comparison length mismatch");
  let errorSquare = 0;
  let refSquare = 0;
  let peak = 0;
  let peakIndex = 0;
  let peakChannel = "L";
  const firstNonzeroActual: [number | null, number | null] = [null, null];
  const firstNonzeroReference: [number | null, number | null] = [null, null];
  for (let ch = 0; ch < 2; ch++) {
    for (let i = 0; i < left[ch]!.length; i++) {
      const actual = left[ch]![i]!;
      const expected = ref[ch]![i]!;
      const difference = actual - expected;
      errorSquare += difference * difference;
      refSquare += expected * expected;
      if (actual !== 0 && firstNonzeroActual[ch] === null) firstNonzeroActual[ch] = i;
      if (expected !== 0 && firstNonzeroReference[ch] === null) firstNonzeroReference[ch] = i;
      if (Math.abs(difference) > peak) { peak = Math.abs(difference); peakIndex = i; peakChannel = ch === 0 ? "L" : "R"; }
    }
  }
  const window = (start: number, end: number) => {
    let e = 0; let r = 0;
    for (let ch = 0; ch < 2; ch++) for (let i = start; i < Math.min(end, left[ch]!.length); i++) {
      e += (left[ch]![i]! - ref[ch]![i]!) ** 2;
      r += ref[ch]![i]! ** 2;
    }
    return Math.sqrt(e / Math.max(r, 1e-30));
  };
  return {
    relativeRms: Math.sqrt(errorSquare / Math.max(refSquare, 1e-30)),
    peak, peakIndex, peakChannel, firstNonzeroActual, firstNonzeroReference,
    startup0to100ms: window(0, Math.round(SAMPLE_RATE * 0.1)),
    settled100to500ms: window(Math.round(SAMPLE_RATE * 0.1), Math.round(SAMPLE_RATE * 0.5)),
    tail500msToEnd: window(Math.round(SAMPLE_RATE * 0.5), left[0].length),
  };
}

async function renderNative(topology: Topology, input: Stereo, frameCount = outputLength(input[0].length)) {
  assertStereo("native input", input);
  const context = new OfflineAudioContext(2, frameCount, SAMPLE_RATE);
  const sourceBuffer = context.createBuffer(2, input[0].length, SAMPLE_RATE);
  sourceBuffer.copyToChannel(input[0], 0);
  sourceBuffer.copyToChannel(input[1], 1);
  const player = context.createBufferSource();
  player.buffer = sourceBuffer;
  if (topology === "production") {
    const device = createReverbDevice(context, reverbDevice, { seed: REVERB_SEED });
    player.connect(device.input as AudioNode);
    (device.output as AudioNode).connect(context.destination);
  } else if (topology === "wire") {
    player.connect(context.destination);
  } else {
    const impulse = context.createBuffer(2, irFrames, SAMPLE_RATE);
    impulse.copyToChannel(ir.channels[0], 0);
    impulse.copyToChannel(ir.channels[1], 1);
    const convolver = context.createConvolver();
    convolver.normalize = false;
    convolver.buffer = impulse;
    const wet = context.createGain();
    wet.gain.value = REVERB_MIX;
    if (topology === "fixed") {
      const dry = context.createGain();
      dry.gain.value = 1 - 0.5 * REVERB_MIX;
      player.connect(dry).connect(context.destination);
      player.connect(convolver).connect(wet).connect(context.destination);
    } else player.connect(convolver).connect(wet).connect(context.destination);
  }
  player.start();
  const startedAt = performance.now();
  const buffer = await context.startRendering();
  const elapsedMs = performance.now() - startedAt;
  const output: Stereo = [buffer.getChannelData(0), buffer.getChannelData(1)];
  assertStereo(`native ${topology}`, output, frameCount);
  return { elapsedMs, output };
}

async function renderElementary(topology: Topology, input: Stereo, frameCount = outputLength(input[0].length)) {
  assertStereo("Elementary input", input);
  const core = new OfflineRenderer();
  await core.initialize({
    numInputChannels: 2, numOutputChannels: 2, sampleRate: SAMPLE_RATE,
    virtualFileSystem: { "/ir-left": ir.channels[0], "/ir-right": ir.channels[1] },
  });
  const channelGraph = (channel: number, path: string) => {
    const dry = el.in({ channel });
    if (topology === "wire") return dry;
    const wet = el.convolve({ path }, dry);
    if (topology === "wet") return el.mul(REVERB_MIX, wet);
    return el.add(el.mul(1 - 0.5 * REVERB_MIX, dry), el.mul(REVERB_MIX, wet));
  };
  await core.render(channelGraph(0, "/ir-left"), channelGraph(1, "/ir-right"));
  const discard = zeros(PRIME_FRAMES);
  core.process(zeros(PRIME_FRAMES), discard);
  assertSilent("Elementary 1024-frame public-API prime", discard);
  const output = zeros(frameCount);
  const startedAt = performance.now();
  core.process([input[0], input[1]], output);
  const elapsedMs = performance.now() - startedAt;
  assertStereo(`Elementary ${topology}`, output, frameCount);
  return { elapsedMs, output };
}

function impulseAt(index: number, channel: "L" | "R" | "both"): Stereo {
  const left = new Float32Array(BLOCK_SIZE * 4);
  const right = new Float32Array(BLOCK_SIZE * 4);
  if (channel !== "R") left[index] = 1;
  if (channel !== "L") right[index] = 1;
  return [left, right];
}

function raw(values: readonly number[]): string { return values.map((value) => value.toFixed(2)).join(", "); }
function pct(value: number): string { return `${(value * 100).toFixed(4)}%`; }
function fmtMs(value: number): string { return `${value.toFixed(2)} ms`; }
function median(values: readonly number[]): number { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!; }

async function runImpulseProbes(): Promise<string[]> {
  const lines: string[] = [];
  for (const index of [0, BLOCK_SIZE, BLOCK_SIZE * 2]) {
    const input = impulseAt(index, "L");
    const native = await renderNative("wire", input, input[0].length);
    const elementary = await renderElementary("wire", input, input[0].length);
    assertEqual(`dry left impulse ${index}`, elementary.output[0], native.output[0], 0);
    assertEqual(`dry left impulse ${index} right isolation`, elementary.output[1], native.output[1], 0);
    if (Math.abs(native.output[0][index]! - 1) > 2e-6) throw new Error(`Native impulse ${index} has wrong index/amplitude`);
    const rightPeak = elementary.output[1].reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    lines.push(`Dry left impulse @${index}: output @${index} = ${native.output[0][index]!.toFixed(7)}; right-channel peak ${rightPeak.toExponential(2)}; exact-index parity ✓`);
  }
  const rightDryInput = impulseAt(0, "R");
  const rightDryNative = await renderNative("wire", rightDryInput, rightDryInput[0].length);
  const rightDryElementary = await renderElementary("wire", rightDryInput, rightDryInput[0].length);
  assertEqual("dry right impulse parity", rightDryElementary.output[1], rightDryNative.output[1], 0);
  assertEqual("dry right impulse isolation", rightDryElementary.output[0], rightDryNative.output[0], 0);
  if (rightDryNative.output[1][0] !== 1) throw new Error("Right dry impulse failed at sample zero");
  const dryCrossfeed = rightDryElementary.output[0].reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
  if (dryCrossfeed !== 0) throw new Error(`Dry right impulse leaked to left output: ${dryCrossfeed}`);
  lines.push(`Dry right impulse @0: output @0 = ${rightDryNative.output[1][0]!.toFixed(7)}; left-channel peak ${dryCrossfeed.toExponential(2)}; isolation asserted ✓`);
  for (const side of ["L", "R"] as const) {
    const input = impulseAt(0, side);
    const native = await renderNative("fixed", input);
    const elementary = await renderElementary("fixed", input);
    const delta = assertParity(`${side}-only fixed full wet probe`, elementary.output, native.output);
    const oppositeChannel = side === "L" ? 1 : 0;
    const nativeCrossfeed = native.output[oppositeChannel]!.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    const elementaryCrossfeed = elementary.output[oppositeChannel]!.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    if (Math.abs(nativeCrossfeed - elementaryCrossfeed) > FLOAT32_PARITY_PEAK_TOLERANCE) {
      throw new Error(`${side}-only crossfeed mismatch ${Math.abs(nativeCrossfeed - elementaryCrossfeed)}`);
    }
    lines.push(`${side}-only full stereo IR probe: rel RMS ${pct(delta.relativeRms)}, peak ${delta.peak.toExponential(3)} @${delta.peakChannel}:${delta.peakIndex}; opposite-channel peak native/Elementary ${nativeCrossfeed.toExponential(3)}/${elementaryCrossfeed.toExponential(3)}; parity and channel mapping asserted`);
  }
  return lines;
}

async function benchmark() {
  runButton.disabled = true;
  result.textContent = "Running deterministic parity diagnostics…";
  await new Promise((resolve) => setTimeout(resolve, 40));
  const originalInput = makeInput(PROGRAM_SECONDS);
  const inputSnapshot: Stereo = [originalInput[0].slice(), originalInput[1].slice()];
  const frames = outputLength(originalInput[0].length);
  const inputHashes = originalInput.map((channel) => channel.reduce((sum, value, i) => (sum + value * (i + 1)) % 1_000_000_007, 0));

  // Isolated fixed-gain topology comparisons use independent renderer state and include the complete IR tail.
  const dryInput = makeInput(PROGRAM_SECONDS);
  const dryNative = await renderNative("wire", dryInput, frames);
  const dryElementary = await renderElementary("wire", dryInput, frames);
  const dryDelta = compare(dryElementary.output, dryNative.output);
  assertEqual("full dry wire left", dryElementary.output[0], dryNative.output[0], 0);
  assertEqual("full dry wire right", dryElementary.output[1], dryNative.output[1], 0);
  const wetNative = await renderNative("wet", originalInput, frames);
  const wetElementary = await renderElementary("wet", originalInput, frames);
  const wetDelta = assertParity("full-tail fixed wet parity", wetElementary.output, wetNative.output);
  const fixedNative = await renderNative("fixed", originalInput, frames);
  const fixedElementary = await renderElementary("fixed", originalInput, frames);
  const fixedDelta = assertParity("full-tail fixed full-chain parity", fixedElementary.output, fixedNative.output);
  const impulseLines = await runImpulseProbes();

  // Time-zero production behavior is reported directly over its first 100 ms; no samples are cropped.
  const startupFrames = Math.round(SAMPLE_RATE * 0.1);
  const startupNative = await renderNative("production", originalInput, frames);
  const startupStats = summarize(startupNative.output[0].subarray(0, startupFrames), startupNative.output[1].subarray(0, startupFrames));

  // Both timed engines render the same 4096-sample silent pre-roll plus program and full tail.
  const preRoll = zeros(SETTLE_FRAMES);
  const settledInput: Stereo = [concatenate(preRoll[0], originalInput[0]), concatenate(preRoll[1], originalInput[1])];
  const settledFrames = outputLength(settledInput[0].length);
  const warmNative = await renderNative("production", settledInput, settledFrames);
  const warmElementary = await renderElementary("fixed", settledInput, settledFrames);
  let native = warmNative;
  let elementary = warmElementary;
  const nativeTimes: number[] = [];
  const elementaryTimes: number[] = [];
  for (let pass = 0; pass < PASSES; pass++) {
    result.textContent = `Settled throughput pass ${pass + 1}/${PASSES}…`;
    if (pass % 2 === 0) {
      native = await renderNative("production", settledInput, settledFrames); nativeTimes.push(native.elapsedMs);
      elementary = await renderElementary("fixed", settledInput, settledFrames); elementaryTimes.push(elementary.elapsedMs);
    } else {
      elementary = await renderElementary("fixed", settledInput, settledFrames); elementaryTimes.push(elementary.elapsedMs);
      native = await renderNative("production", settledInput, settledFrames); nativeTimes.push(native.elapsedMs);
    }
  }
  const nativeMedian = median(nativeTimes);
  const elementaryMedian = median(elementaryTimes);

  // Context metadata is device-reported only. This is not a physical latency measurement.
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  const contextInfo = {
    sampleRate: audioContext.sampleRate,
    baseLatency: audioContext.baseLatency,
    outputLatency: "outputLatency" in audioContext ? (audioContext as AudioContext & { outputLatency: number }).outputLatency : null,
  };
  await audioContext.close();
  assertEqual("input immutability L", originalInput[0], inputSnapshot[0], 0);
  assertEqual("input immutability R", originalInput[1], inputSnapshot[1], 0);
  const currentHashes = originalInput.map((channel) => channel.reduce((sum, value, i) => (sum + value * (i + 1)) % 1_000_000_007, 0));
  if (inputHashes.some((hash, i) => hash !== currentHashes[i])) throw new Error("Input hash changed during render");

  const report = [
    `Environment: ${navigator.userAgent}`,
    `Platform: ${navigator.platform}; visibility=${document.visibilityState}; Chromium/browser build is given by the user agent above`,
    `Device context metadata: ${contextInfo.sampleRate} Hz; baseLatency=${contextInfo.baseLatency == null ? "unavailable" : fmtMs(contextInfo.baseLatency * 1000)}; outputLatency=${contextInfo.outputLatency == null ? "unavailable" : fmtMs(contextInfo.outputLatency * 1000)} (reported metadata only)`,
    `Workload: ${PROGRAM_SECONDS}s stereo program + ${irFrames} IR frames (${ir.lengthSeconds.toFixed(6)}s); ${SAMPLE_RATE} Hz; block=${BLOCK_SIZE}; output=${frames} frames; ${PASSES} timed passes after one warm-up per engine; seeded IR 0x${REVERB_SEED.toString(16)}; mix=${REVERB_MIX}; size=${REVERB_SIZE}`,
    `Prime: ${PRIME_FRAMES} silent samples in two blocks after Elementary render(); version-specific safe margin over observed 882-sample / 20ms root fade. Prime asserted silent.`,
    "",
    `Dry wire parity, all ${frames} frames: relative RMS ${pct(dryDelta.relativeRms)}, peak ${dryDelta.peak.toExponential(3)} @${dryDelta.peakChannel}:${dryDelta.peakIndex}.`,
    `Fixed wet ConvolverNode vs el.convolve, all channels/tail: relative RMS ${pct(wetDelta.relativeRms)}, peak ${wetDelta.peak.toExponential(3)} @${wetDelta.peakChannel}:${wetDelta.peakIndex}; first nonzero indices L/R Elementary ${wetDelta.firstNonzeroActual.join("/")} vs native ${wetDelta.firstNonzeroReference.join("/")}; windows 0-100ms ${pct(wetDelta.startup0to100ms)}, 100-500ms ${pct(wetDelta.settled100to500ms)}, tail ${pct(wetDelta.tail500msToEnd)}.`,
    `Fixed full chain (dry 0.75 + wet 0.5), all channels/tail: relative RMS ${pct(fixedDelta.relativeRms)}, peak ${fixedDelta.peak.toExponential(3)} @${fixedDelta.peakChannel}:${fixedDelta.peakIndex}; windows 0-100ms ${pct(fixedDelta.startup0to100ms)}, 100-500ms ${pct(fixedDelta.settled100to500ms)}, tail ${pct(fixedDelta.tail500msToEnd)}; asserted peak tolerance ${FLOAT32_PARITY_PEAK_TOLERANCE}.`,
    ...impulseLines,
    `Production createReverbDevice cold startup (actual time-zero signal, first 100ms): RMS ${startupStats.rms.toFixed(8)}, peak ${startupStats.peak.toFixed(8)} @${startupStats.peakChannel}:${startupStats.peakIndex}. Its 10ms target automation is distinct from fixed-gain parity.`,
    `Settled production throughput: source delayed by ${SETTLE_FRAMES} silent frames (${(SETTLE_FRAMES / SAMPLE_RATE * 1000).toFixed(2)}ms); native uses createReverbDevice; Elementary uses fixed 0.75/0.5 graph. Same ${settledFrames} frames including pre-roll and complete tail; pre-roll is included in both processing times.`,
    `Native startRendering raw ms: ${raw(nativeTimes)}; median ${fmtMs(nativeMedian)}; ${(settledFrames / SAMPLE_RATE * 1000 / nativeMedian).toFixed(2)}x real time.`,
    `Elementary process raw ms: ${raw(elementaryTimes)}; median ${fmtMs(elementaryMedian)}; ${(settledFrames / SAMPLE_RATE * 1000 / elementaryMedian).toFixed(2)}x real time.`,
    `Relative processing-time delta (Elementary vs native): ${((elementaryMedian / nativeMedian - 1) * 100).toFixed(2)}%. Timing includes native asynchronous startRendering vs synchronous Elementary process with JS/WASM block copies; excludes graph setup, IR creation, buffer allocation, and channel extraction.`,
    `Settled pass final-output parity (same full pre-roll/program/tail array): ${pct(compare(elementary.output, native.output).relativeRms)} relative RMS.`,
    "",
    "Interpretation: fixed-gain probes isolate renderer/convolution parity. Production startup preserves its actual automation. Timings are offline throughput estimates, not DSP CPU load, quantum deadline success, physical latency, or an engine recommendation. Repeat on target browsers/devices and audition live output before engine selection.",
  ];
  result.textContent = report.join("\n");
}

runButton.addEventListener("click", () => {
  void benchmark().catch((error: unknown) => {
    result.textContent = `Benchmark failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  }).finally(() => { runButton.disabled = false; });
});
