import {
  DEFAULT_CHANNEL,
  DEFAULT_MASTER,
  type ChannelProcessing,
  type Compressor,
  type MasterProcessing,
} from "../document/mixer";
import {
  createSoftClipNode,
  FxChainHost,
  createRealFxDeviceFactory,
} from "./fx";
import { createBitcrusherNode } from "./voiceEngine";
import limiterUrl from "./worklets/mixerLimiter.js?url&no-inline";

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (gain: number): number =>
  20 * Math.log10(Math.max(1e-6, gain));
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
export function prepareMixer(ctx: BaseAudioContext): Promise<void> {
  let task = loaded.get(ctx);
  if (!task) {
    task = ctx.audioWorklet.addModule(limiterUrl).catch((error) => {
      loaded.delete(ctx);
      throw error;
    });
    loaded.set(ctx, task);
  }
  return task;
}
function ramp(
  ctx: BaseAudioContext,
  param: AudioParam,
  value: number,
  initial: boolean,
) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  if (initial) param.setValueAtTime(value, t);
  else {
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + 0.008);
  }
}
function compressor(ctx: BaseAudioContext) {
  const input = ctx.createGain(),
    output = ctx.createGain();
  const dry = ctx.createGain(),
    wet = ctx.createGain();
  const node = new AudioWorkletNode(ctx, "bitbounce-mixer-compressor", {
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  let reduction = 0;
  let enabled = false;
  node.port.onmessage = (event: MessageEvent<number>) => {
    reduction = event.data;
  };
  input.connect(dry).connect(output);
  input.connect(node).connect(wet).connect(output);
  return {
    input,
    output,
    reduction: () => (enabled ? reduction : 0),
    set(p: Compressor, initial = false) {
      enabled = p.enabled;
      node.parameters
        .get("enabled")!
        .setValueAtTime(p.enabled ? 1 : 0, ctx.currentTime);
      ramp(ctx, dry.gain, p.enabled ? 0 : 1, initial);
      ramp(ctx, wet.gain, p.enabled ? dbToGain(p.makeup) : 0, initial);
      for (const key of ["threshold", "ratio", "attack", "release"] as const)
        ramp(ctx, node.parameters.get(key)!, p[key], initial);
    },
  };
}
export function createChannelProcessing(
  ctx: BaseAudioContext,
  settings = DEFAULT_CHANNEL,
) {
  const input = ctx.createGain(),
    eqDry = ctx.createGain(),
    eqWet = ctx.createGain(),
    eqOut = ctx.createGain();
  const hp = ctx.createBiquadFilter(),
    low = ctx.createBiquadFilter(),
    mid = ctx.createBiquadFilter(),
    high = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.Q.value = Math.SQRT1_2;
  low.type = "lowshelf";
  low.frequency.value = 150;
  mid.type = "peaking";
  mid.Q.value = 0.7;
  high.type = "highshelf";
  high.frequency.value = 6000;
  input.connect(eqDry).connect(eqOut);
  input
    .connect(hp)
    .connect(low)
    .connect(mid)
    .connect(high)
    .connect(eqWet)
    .connect(eqOut);
  const comp = compressor(ctx),
    pan = ctx.createStereoPanner();
  eqOut.connect(comp.input);
  comp.output.connect(pan);
  const set = (p: ChannelProcessing, initial = false) => {
    ramp(ctx, eqDry.gain, p.eq.enabled ? 0 : 1, initial);
    ramp(ctx, eqWet.gain, p.eq.enabled ? 1 : 0, initial);
    ramp(ctx, hp.frequency, p.eq.lowCut, initial);
    ramp(ctx, low.gain, p.eq.low, initial);
    ramp(ctx, mid.frequency, p.eq.midHz, initial);
    ramp(ctx, mid.gain, p.eq.mid, initial);
    ramp(ctx, high.gain, p.eq.high, initial);
    ramp(ctx, pan.pan, p.pan, initial);
    comp.set(p.compressor, initial);
  };
  set(settings, true);
  return { input, output: pan, set, reduction: comp.reduction };
}
export function createMasterProcessing(
  ctx: BaseAudioContext,
  settings = DEFAULT_MASTER,
  bpm: () => number = () => 120,
) {
  const input = ctx.createGain(),
    comp = compressor(ctx),
    output = ctx.createGain();
  const legacy = createSoftClipNode(ctx),
    legacyGain = ctx.createGain(),
    limitGain = ctx.createGain();
  const limiter = new AudioWorkletNode(ctx, "bitbounce-mixer-limiter", {
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  let reduction = 0;
  limiter.port.onmessage = (event: MessageEvent<number>) => {
    reduction = event.data;
  };
  const head = ctx.createGain();
  const chain = new FxChainHost({
    source: input,
    sink: comp.input,
    ramp: {
      input: head,
      output: head,
      rampTo(value, when, seconds) {
        head.gain.cancelScheduledValues(when);
        head.gain.setValueAtTime(1 - value, when);
        head.gain.linearRampToValueAtTime(value, when + seconds);
      },
    },
    createDevice: createRealFxDeviceFactory(ctx, {
      laneSeed: 0x4d415354,
      createBitcrusher: createBitcrusherNode,
    }),
    timing: () => ({ bpm: bpm(), when: ctx.currentTime }),
  });
  let currentChain = settings.fxChain;
  if (currentChain?.length) chain.setChain(currentChain);
  comp.output.connect(legacy).connect(legacyGain).connect(output);
  comp.output.connect(limiter).connect(limitGain).connect(output);
  const set = (p: MasterProcessing, initial = false) => {
    if (p.fxChain !== currentChain) {
      currentChain = p.fxChain;
      chain.setChain(currentChain ?? []);
    }
    ramp(ctx, input.gain, dbToGain(p.gainDb), initial);
    comp.set(p.compressor, initial);
    // The new limiter replaces the legacy soft clipper. Never stack both.
    ramp(ctx, legacyGain.gain, p.limiter.enabled ? 0 : 1, initial);
    ramp(ctx, limitGain.gain, p.limiter.enabled ? 1 : 0, initial);
    limiter.parameters
      .get("enabled")!
      .setValueAtTime(p.limiter.enabled ? 1 : 0, ctx.currentTime);
    limiter.parameters
      .get("ceiling")!
      .setValueAtTime(dbToGain(p.limiter.ceiling), ctx.currentTime);
    limiter.parameters
      .get("release")!
      .setValueAtTime(p.limiter.release, ctx.currentTime);
  };
  set(settings, true);
  return {
    input,
    output,
    set,
    reduction: comp.reduction,
    limiterReduction: () => reduction,
    syncBpm: () => chain.syncBpm(false),
  };
}
