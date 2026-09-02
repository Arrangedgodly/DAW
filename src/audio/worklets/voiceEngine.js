/**
 * Bitbounce voice-engine AudioWorklet processor (IM-3, RES-3 / D2–D4).
 *
 * One instance per lane; hosts create it via createVoiceEngine()
 * (src/audio/voiceEngine.ts) which loads this file with
 * `new URL('./voiceEngine.js', import.meta.url)` — Vite serves it in dev and
 * emits it verbatim as a build asset, so this file MUST be plain,
 * self-contained JavaScript with no imports.
 *
 * The DSP functions below are an inline twin of src/audio/dsp.ts (the
 * canonical, node-tested copy); tests/worklet-parity.test.ts asserts both
 * produce identical values. Change both or neither.
 *
 * Rules (hard): no allocation inside process(), preallocated voices,
 * monomorphic shapes, seeded LFSR only — never Math.random.
 */

// --- DSP twin of src/audio/dsp.ts -----------------------------------------

var STEAL_FADE_SECONDS = 0.004;
var MAX_VOICE_FREQ = 12400;

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function polyblep(t, dt) {
  if (t < dt) {
    var x1 = t / dt;
    return 2 * x1 - x1 * x1 - 1;
  }
  if (t > 1 - dt) {
    var x2 = (t - 1) / dt;
    return x2 * x2 + 2 * x2 + 1;
  }
  return 0;
}

function pulseValue(phase, duty) {
  return phase < duty ? 1 : -1;
}

function pulseSample(phase, duty, dt) {
  var v = pulseValue(phase, duty);
  v += polyblep(phase, dt);
  var tFall = phase - duty + 1;
  v -= tFall < 1 ? polyblep(tFall, dt) : polyblep(tFall - 1, dt);
  return v;
}

function triangleValue(phase) {
  var phase01 = phase % 1;
  if (phase01 < 0) phase01 += 1;
  var idx = phase01 * 32;
  idx = idx | 0;
  if (idx > 31) idx = 31;
  var t = idx < 16 ? 15 - idx : idx - 16;
  return (2 * t) / 15 - 1;
}

function lfsrNext(reg, shortMode) {
  var feedback = (reg & 1) ^ ((reg >> (shortMode ? 6 : 1)) & 1);
  return ((feedback << 14) | (reg >>> 1)) & 0x7fff;
}

function lfsrOutput(reg) {
  return reg & 1 ? -1 : 1;
}

function adsrLevel(t, attack, decay, sustain, release, hold) {
  if (t < 0) return 0;
  if (t < attack) return attack > 0 ? t / attack : 1;
  if (t < attack + decay) {
    return decay > 0 ? 1 - ((1 - sustain) * (t - attack)) / decay : sustain;
  }
  if (t < hold) return sustain;
  var rt = t - hold;
  if (rt < release) {
    return release > 0 ? sustain * (1 - rt / release) : 0;
  }
  return 0;
}

// --- Voice ------------------------------------------------------------------

var WAVE_TRIANGLE = 1;

/** One preallocated voice. All numeric fields; one shape, ever. */
function Voice() {
  this.active = false;
  // pending trigger (sample offset within the current block, or -1)
  this.startOffset = -1;
  // steal fade: >0 counts samples remaining of fade-out before trigger starts
  this.killRemaining = 0;
  this.killTotal = 0;
  // oscillator
  this.wave = 0;
  this.phase = 0;
  this.freq = 440;
  this.freqEnd = 440;
  this.sweepRemaining = 0; // seconds of sweep left
  this.sweepPerSample = 0; // Hz per sample
  this.duty = 0.5;
  // noise
  this.noiseMix = 0;
  this.noiseShort = false;
  this.noiseRate = 4; // samples per LFSR clock
  this.noiseCountdown = 4;
  this.lfsr = 1;
  // envelope (seconds / 0..1)
  this.attack = 0;
  this.decay = 0;
  this.sustain = 1;
  this.release = 0.05;
  this.hold = 0.1;
  this.level = 1;
  // runtime
  this.t = 0; // seconds since onset
  this.releasing = false;
  this.releaseT = 0; // seconds since release start
  this.startedAt = 0; // ctx time of onset (steal policy)
  this.nextEvent = null; // deferred trigger while a steal fade runs
}

function triggerVoice(v, e, whenTime) {
  v.active = true;
  v.startedAt = whenTime;
  v.t = 0;
  v.releasing = false;
  v.releaseT = 0;
  v.wave = e.wave;
  v.freq = Math.min(e.freq, MAX_VOICE_FREQ);
  v.freqEnd = Math.min(e.freqEnd, MAX_VOICE_FREQ);
  if (e.sweepSeconds > 0 && v.freqEnd !== v.freq) {
    v.sweepRemaining = e.sweepSeconds;
    v.sweepPerSample = (v.freqEnd - v.freq) / (e.sweepSeconds * sampleRate);
  } else {
    v.sweepRemaining = 0;
    v.sweepPerSample = 0;
    v.freqEnd = v.freq;
  }
  v.phase = 0;
  v.duty = e.duty;
  v.noiseMix = e.noiseMix;
  v.noiseShort = !!e.noiseShort;
  v.noiseRate = e.noiseRate > 0 ? e.noiseRate : 4;
  v.noiseCountdown = v.noiseRate;
  v.lfsr = e.seed >= 1 && e.seed <= 32767 ? e.seed : 1;
  v.attack = e.attack;
  v.decay = e.decay;
  v.sustain = e.sustain;
  v.release = e.release;
  v.hold = e.holdSeconds;
  v.level = e.level;
}

/**
 * Per-sample voice output; returns 0 for pre-onset samples. Advances all
 * voice state by exactly one sample.
 */
function voiceSample(v, invSampleRate) {
  if (!v.active || v.startOffset >= 0) return 0; // not yet onset inside block

  // envelope
  var env;
  if (v.releasing) {
    v.releaseT += invSampleRate;
    env =
      v.release > 0
        ? v.sustain * Math.max(0, 1 - v.releaseT / v.release)
        : 0;
    if (v.releaseT >= v.release) {
      v.active = false;
      return 0;
    }
  } else {
    v.t += invSampleRate;
    env = adsrLevel(
      v.t,
      v.attack,
      v.decay,
      v.sustain,
      v.release,
      v.hold,
    );
    if (v.t >= v.hold) v.releasing = true;
  }

  // oscillator + noise
  var osc = 0;
  if (v.noiseMix < 1) {
    if (v.wave === WAVE_TRIANGLE) {
      osc = triangleValue(v.phase);
      v.phase += v.freq * invSampleRate;
      if (v.phase >= 1) v.phase -= Math.floor(v.phase);
    } else {
      osc = pulseSample(v.phase, v.duty, v.freq * invSampleRate);
      v.phase += v.freq * invSampleRate;
      if (v.phase >= 1) v.phase -= Math.floor(v.phase);
    }
  }
  var noise = 0;
  if (v.noiseMix > 0) {
    noise = lfsrOutput(v.lfsr);
    v.noiseCountdown -= 1;
    if (v.noiseCountdown <= 0) {
      v.lfsr = lfsrNext(v.lfsr, v.noiseShort);
      v.noiseCountdown = v.noiseRate;
    }
  }
  if (v.sweepRemaining > 0) {
    v.sweepRemaining -= invSampleRate;
    v.freq += v.sweepPerSample;
    if (v.sweepRemaining <= 0) v.freq = v.freqEnd;
  }

  var mix = osc * (1 - v.noiseMix) + noise * v.noiseMix;
  return mix * env * v.level;
}

// --- Processor --------------------------------------------------------------

var VOICE_COUNT = 8;

// MUST be a class extending AudioWorkletProcessor: a plain-function
// constructor registers without error but Chromium never runs it (no
// process(), no port messages — total silence). Found by the TH-1 browser
// suite; the node tests passed fakes, so the shape was never exercised.
// (The node parity import has no AudioWorkletProcessor global, hence the
// guarded base class.)
var __ProcessorBase =
  typeof AudioWorkletProcessor === "function" ? AudioWorkletProcessor : class {};
class VoiceEngineProcessor extends __ProcessorBase {
  constructor() {
    super();
    // events arrive sorted from the host; merged here (message thread —
    // allocation allowed), consumed by pointer, never shifted per-sample.
    this.pending = [];
    this.pendingIndex = 0;
    this.consumedUntil = -1;
    this.voices = [];
    for (var i = 0; i < VOICE_COUNT; i++) this.voices.push(new Voice());
    this.nextParams = null; // scratch only during message handling
    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "events" && Array.isArray(msg.events)) {
        for (var i = 0; i < msg.events.length; i++) {
          this.pending.push(msg.events[i]);
        }
        this.pending.sort(byTime);
      } else if (msg.type === "all-off") {
        this.allOff();
      }
    };
  }
}

function byTime(a, b) {
  return a.time - b.time;
}

/**
 * Voice stealing (RES-3): free → oldest-in-release → oldest overall.
 * A stolen voice gets a STEAL_FADE_SECONDS fade-out before the new note's
 * onset (killRemaining counts samples of that fade).
 */
VoiceEngineProcessor.prototype.stealVoice = function () {
  var voices = this.voices;
  var best = -1;
  // 1. free
  for (var i = 0; i < voices.length; i++) {
    if (!voices[i].active) return voices[i];
  }
  // 2. oldest in release
  for (var j = 0; j < voices.length; j++) {
    var v = voices[j];
    if (v.releasing && (best < 0 || v.startedAt < voices[best].startedAt)) {
      best = j;
    }
  }
  if (best >= 0) return voices[best];
  // 3. oldest overall
  best = 0;
  for (var k = 1; k < voices.length; k++) {
    if (voices[k].startedAt < voices[best].startedAt) best = k;
  }
  return voices[best];
};

VoiceEngineProcessor.prototype.allOff = function () {
  var voices = this.voices;
  for (var i = 0; i < voices.length; i++) {
    var v = voices[i];
    if (v.active && !v.releasing) {
      v.releasing = true;
      v.releaseT = 0;
    }
  }
};

VoiceEngineProcessor.prototype.process = function (_inputs, outputs) {
  var out = outputs[0];
  var ch = out[0];
  var blockLength = ch.length;
  var invSampleRate = 1 / sampleRate;

  // Fire timestamped events at their exact sample boundary. An event whose
  // time already passed (late by less than a block) fires at sample 0.
  while (this.pendingIndex < this.pending.length) {
    var e = this.pending[this.pendingIndex];
    var offset = Math.round((e.time - currentTime) * sampleRate);
    if (offset >= blockLength) break;
    this.pendingIndex++;
    if (offset < 0) offset = 0;
    var voice = this.stealVoice();
    if (!voice.active) {
      triggerVoice(voice, e, e.time);
      voice.startOffset = offset;
      voice.killRemaining = 0;
      voice.nextEvent = null;
    } else {
      // busy voice: fade the old note out first (de-click), then trigger
      voice.nextEvent = e;
      voice.killRemaining = Math.max(
        1,
        Math.round(STEAL_FADE_SECONDS * sampleRate),
      );
      voice.killTotal = voice.killRemaining;
    }
  }

  var voices = this.voices;
  for (var s = 0; s < blockLength; s++) {
    var sum = 0;
    for (var vi = 0; vi < voices.length; vi++) {
      var v = voices[vi];
      if (!v.active) continue;
      if (v.killRemaining > 0) {
        // fade the stolen note out linearly, then trigger the pending note
        var fade = v.killRemaining / v.killTotal;
        sum += voiceSample(v, invSampleRate) * fade;
        v.killRemaining -= 1;
        if (v.killRemaining === 0) {
          triggerVoice(v, v.nextEvent, currentTime + (s + 1) * invSampleRate);
          v.startOffset = -1; // onset on the very next sample
          v.nextEvent = null;
        }
        continue;
      }
      if (v.startOffset >= 0) {
        if (s < v.startOffset) continue;
        v.startOffset = -1; // onset
      }
      sum += voiceSample(v, invSampleRate);
    }
    ch[s] = sum;
    for (var c = 1; c < out.length; c++) out[c][s] = sum;
  }

  // Consumed-watermark: report how far we have played through the queue so
  // the host can track backlog / detect starvation (research refinement).
  while (
    this.pendingIndex < this.pending.length &&
    this.pending[this.pendingIndex].time <= currentTime
  ) {
    this.pendingIndex++;
  }
  if (this.pendingIndex > 0) {
    // compact consumed prefix (message-thread-free, amortized O(1) cost here)
    if (this.pendingIndex === this.pending.length) {
      this.pending.length = 0;
      this.pendingIndex = 0;
      this.consumedUntil = currentTime;
      this.port.postMessage({ type: "consumed", untilTime: currentTime });
    } else if (this.pending[this.pendingIndex - 1].time > this.consumedUntil) {
      this.consumedUntil = this.pending[this.pendingIndex - 1].time;
      this.port.postMessage({ type: "consumed", untilTime: this.consumedUntil });
    }
  }

  return true;
};

// --- Bitcrusher processor (IM-4, RES-4) -------------------------------------
//
// Same module as the voice engine (one addModule per context, D2–D4). True
// decimation needs one sample of state, so WaveShaper cannot do it. Params
// arrive as port messages (no automation needed for a character effect).

class BitcrusherProcessor extends __ProcessorBase {
  constructor() {
    super();
    this.bits = 8;
    this.downsample = 1;
    this.countdown = 0;
    this.heldL = 0;
    this.heldR = 0;
    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || msg.type !== "params") return;
      if (Number.isFinite(msg.bits)) this.bits = Math.min(16, Math.max(1, msg.bits));
      if (Number.isFinite(msg.downsample)) {
        this.downsample = Math.min(64, Math.max(1, Math.round(msg.downsample)));
      }
    };
  }
}

BitcrusherProcessor.prototype.process = function (inputs, outputs) {
  var out = outputs[0];
  var inChL = inputs[0] && inputs[0][0] ? inputs[0][0] : null;
  var inChR = inputs[0] && inputs[0][1] ? inputs[0][1] : inChL;
  var blockLength = out[0].length;
  var levels = Math.pow(2, this.bits) - 1;
  for (var s = 0; s < blockLength; s++) {
    if (this.countdown <= 0) {
      // hold-and-decimate: quantize the held input sample (twin of
      // quantizeBits in src/audio/fx.ts — change both or neither)
      var xl = inChL ? inChL[s] : 0;
      var xr = inChR ? inChR[s] : 0;
      this.heldL = Math.round(((xl + 1) / 2) * levels) / levels * 2 - 1;
      this.heldR = Math.round(((xr + 1) / 2) * levels) / levels * 2 - 1;
      this.countdown = this.downsample;
    }
    this.countdown -= 1;
    for (var c = 0; c < out.length; c++) {
      out[c][s] = c === 0 ? this.heldL : this.heldR;
    }
  }
  return true;
};

// --- Registration + test seam ----------------------------------------------

if (
  typeof AudioWorkletProcessor === "function" &&
  typeof registerProcessor === "function"
) {
  registerProcessor("voice-engine", VoiceEngineProcessor);
  registerProcessor("bitcrusher", BitcrusherProcessor);
}

/**
 * Test seam (node): tests/worklet-parity.test.ts installs this hook BEFORE
 * importing the file and receives the inline DSP twin for comparison
 * against src/audio/dsp.ts. Never runs in a real worklet.
 */
if (typeof globalThis.__bbRegisterVoiceEngineDsp === "function") {
  globalThis.__bbRegisterVoiceEngineDsp({
    midiToFreq: midiToFreq,
    polyblep: polyblep,
    pulseValue: pulseValue,
    pulseSample: pulseSample,
    triangleValue: triangleValue,
    lfsrNext: lfsrNext,
    lfsrOutput: lfsrOutput,
    adsrLevel: adsrLevel,
  });
}
