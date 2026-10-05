// Generated from 27acaec:src/audio/fx.ts; regenerate with scripts/prepare-fx-control-cost-baseline.mjs.
import {
  renderImpulseResponse,
  type FxDeviceInstance,
} from "../../../src/audio/fx";
import type { FxDevice } from "../../../src/document/schema";

export function createBaselineReverbDevice(
  ctx: BaseAudioContext,
  device: Extract<FxDevice, { type: "reverb" }>,
  opts: { readonly seed: number },
): FxDeviceInstance {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const convolver = ctx.createConvolver();
  const wet = ctx.createGain();
  const output = ctx.createGain();

  convolver.normalize = false;
  const ir = renderImpulseResponse({
    seed: opts.seed,
    size: device.params.size,
    sampleRate: ctx.sampleRate,
  });
  const buffer = ctx.createBuffer(2, ir.channels[0].length, ctx.sampleRate);
  buffer.copyToChannel(ir.channels[0], 0);
  buffer.copyToChannel(ir.channels[1], 1);
  convolver.buffer = buffer;

  input.connect(dry);
  input.connect(convolver);
  dry.connect(output);
  convolver.connect(wet);
  wet.connect(output);

  const apply = (d: typeof device, when: number) => {
    wet.gain.setTargetAtTime(d.params.mix, when, 0.01);
    dry.gain.setTargetAtTime(1 - 0.5 * d.params.mix, when, 0.01);
  };
  apply(device, ctx.currentTime);

  return {
    kind: "reverb",
    input,
    output,
    setParams(d) {
      if (d.type !== "reverb") return;
      // Size changes regenerate the (seeded, deterministic) IR.
      if (d.params.size !== device.params.size) {
        const next = renderImpulseResponse({
          seed: opts.seed,
          size: d.params.size,
          sampleRate: ctx.sampleRate,
        });
        const buf = ctx.createBuffer(
          2,
          next.channels[0].length,
          ctx.sampleRate,
        );
        buf.copyToChannel(next.channels[0], 0);
        buf.copyToChannel(next.channels[1], 1);
        convolver.buffer = buf;
      }
      apply(d, ctx.currentTime);
    },
    dispose() {
      for (const n of [input, dry, convolver, wet, output]) n.disconnect();
    },
  };
}
