/* Stereo-linked, zero-lookahead sample-peak limiter. No true-peak claim.
 * Immediate attenuation bounds every output sample; release recovers smoothly.
 * Parameters are sample accurate and shared by live and offline graphs. */
class MixerLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "enabled",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "ceiling",
        defaultValue: 0.89125,
        minValue: 0.01,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "release",
        defaultValue: 0.08,
        minValue: 0.02,
        maxValue: 0.5,
        automationRate: "k-rate",
      },
    ];
  }
  constructor() {
    super();
    this.gain = 1;
    this.blocks = 0;
    this.minimum = 1;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const enabled = parameters.enabled[0] > 0.5;
    const ceiling = parameters.ceiling[0];
    const recovery = 1 - Math.exp(-1 / (sampleRate * parameters.release[0]));
    for (let i = 0; i < output[0].length; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++)
        peak = Math.max(peak, Math.abs(input[c][i] || 0));
      const target = peak > ceiling ? ceiling / peak : 1;
      this.gain = enabled
        ? Math.min(target, this.gain + (1 - this.gain) * recovery)
        : 1;
      this.minimum = Math.min(this.minimum, this.gain);
      for (let c = 0; c < output.length; c++)
        output[c][i] = (input[c]?.[i] || 0) * this.gain;
    }
    if (++this.blocks >= 32) {
      this.port.postMessage(20 * Math.log10(Math.max(1e-9, this.minimum)));
      this.blocks = 0;
      this.minimum = 1;
    }
    return true;
  }
}
registerProcessor("bitbounce-mixer-limiter", MixerLimiter);

/* Explicit makeup only: a 6 dB soft knee, linked peak detector and smoothed
 * gain. No hidden loudness compensation or lookahead in the browser engine. */
class MixerCompressor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "enabled",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "threshold",
        defaultValue: -18,
        minValue: -60,
        maxValue: 0,
        automationRate: "k-rate",
      },
      {
        name: "ratio",
        defaultValue: 2,
        minValue: 1,
        maxValue: 12,
        automationRate: "k-rate",
      },
      {
        name: "attack",
        defaultValue: 0.025,
        minValue: 0.001,
        maxValue: 0.1,
        automationRate: "k-rate",
      },
      {
        name: "release",
        defaultValue: 0.15,
        minValue: 0.02,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }
  constructor() {
    super();
    this.envelope = 0;
    this.gainDb = 0;
    this.blocks = 0;
    this.minimum = 0;
  }
  process(inputs, outputs, p) {
    const input = inputs[0],
      output = outputs[0];
    if (p.enabled[0] < 0.5) {
      for (let c = 0; c < output.length; c++) {
        if (input[c]) output[c].set(input[c]);
        else output[c].fill(0);
      }
      this.gainDb = 0;
      this.envelope = 0;
      return true;
    }
    const attack = Math.exp(-1 / (sampleRate * p.attack[0]));
    const release = Math.exp(-1 / (sampleRate * p.release[0]));
    const detectorRelease = Math.exp(-1 / (sampleRate * 0.02));
    for (let i = 0; i < output[0].length; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++)
        peak = Math.max(peak, Math.abs(input[c][i] || 0));
      this.envelope = Math.max(peak, this.envelope * detectorRelease);
      const over =
        20 * Math.log10(Math.max(1e-9, this.envelope)) - p.threshold[0];
      const slope = 1 / p.ratio[0] - 1;
      const target =
        over < -3
          ? 0
          : over > 3
            ? slope * over
            : (slope * (over + 3) ** 2) / 12;
      const coefficient = target < this.gainDb ? attack : release;
      this.gainDb = coefficient * this.gainDb + (1 - coefficient) * target;
      this.minimum = Math.min(this.minimum, this.gainDb);
      const gain = Math.pow(10, this.gainDb / 20);
      for (let c = 0; c < output.length; c++)
        output[c][i] = (input[c]?.[i] || 0) * gain;
    }
    if (++this.blocks >= 32) {
      this.port.postMessage(this.minimum);
      this.blocks = 0;
      this.minimum = 0;
    }
    return true;
  }
}
registerProcessor("bitbounce-mixer-compressor", MixerCompressor);
