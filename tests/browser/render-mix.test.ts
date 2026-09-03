/**
 * HW-5 browser gate — the export-mix law (coordinator resolution recorded at
 * LY-1 verification): WAV export APPLIES the lane mix, deterministically,
 * through the existing render pipeline.
 *
 * Project shape (all windows provable): default project with drums KICK on
 * steps 0–7 (first half) and ONE lead note at step 8 (second half) —
 * bass/chords empty. So:
 *  - window A = steps [0, 7.9]: ONLY drums can sound (lead starts at 8);
 *  - window B = steps [8.3, 10]: ONLY lead can sound (kicks stop at 7; the
 *    step-7 decay is allowed 0.3 step of slack).
 *
 * Provable laws (real OfflineAudioContext through the true render path):
 *  (a) MUTE: a muted lane contributes EXACT digital silence — every sample
 *      of its exclusive window is 0.0 in the muted render while the unmuted
 *      render carries energy there; the OTHER lanes' audio is bit-identical
 *      to a render whose muted lane simply has no notes (silence is silence,
 *      however it is reached).
 *  (b) SOLO: solo is exactly the complementary mute vector — render(solo X)
 *      is BIT-IDENTICAL to render(mute every other lane). One law, two
 *      spellings (the LY-1 live session semantics, exported).
 *  (c) VOLUME: a lane's volume scales ONLY that lane (the serial fan-in
 *      stays unity — earlier lanes' window-A energy is unchanged within 2%),
 *      scales it by the linear law (window-B power ratio ≈ 0.25 at gain
 *      0.5), and the render stays deterministic (double render
 *      bit-identical).
 *  (d) CANONICAL-EMPTY: explicit default mix keys (volume 1 / mute false /
 *      solo false) render bit-identically to the canonical-empty document —
 *      the golden byte law (unity gains are exact in FP).
 *
 * The MIDI half of the resolution (notes are data, not a monitor mix) is
 * unit-pinned in tests/exportMidi.test.ts §"HW-5" and e2e-pinned in
 * tests/browser/e2e-iteration2.test.ts.
 */

import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../../src/document/schema";
import type { ProjectDocument } from "../../src/document/schema";
import {
  renderProjectToBuffer,
  EXPORT_SAMPLE_RATE,
  type RenderedLoop,
} from "../../src/audio/render";
import { secondsPerStep } from "../../src/audio/time";

const SR = EXPORT_SAMPLE_RATE;

/** Drums kick steps 0–7 + one lead note at step 8 (exclusive windows). */
function mixProject(): ProjectDocument {
  const doc = createDefaultProject();
  const drums = doc.patterns.drums[0];
  drums.steps.kick = Array.from({ length: 16 }, (_, s) => s < 8);
  const lead = doc.patterns.lead[0];
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  lead.notes = [{ degree: 3, start: 8, length: 2 }];
  return doc;
}

type LanePatch = {
  volume?: number;
  mute?: boolean;
  solo?: boolean;
};

function withLaneMix(
  doc: ProjectDocument,
  patches: Partial<Record<string, LanePatch>>,
): ProjectDocument {
  return {
    ...doc,
    lanes: doc.lanes.map((lane) =>
      patches[lane.id] ? { ...lane, ...patches[lane.id] } : lane,
    ),
  };
}

/** The same content with the DRUMS pattern emptied (no kick steps at all). */
function withoutDrumsNotes(doc: ProjectDocument): ProjectDocument {
  return {
    ...doc,
    patterns: {
      ...doc.patterns,
      drums: doc.patterns.drums.map((p) =>
        p.kind === "drums"
          ? {
              ...p,
              steps: {
                kick: new Array(16).fill(false),
                snare: new Array(16).fill(false),
                hat: new Array(16).fill(false),
                openhat: new Array(16).fill(false),
                clap: new Array(16).fill(false),
                tom: new Array(16).fill(false),
              },
            }
          : p,
      ),
    },
  };
}

function mono(result: RenderedLoop): Float32Array {
  const [l, r] = result.channels;
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) / 2;
  return out;
}

function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0;
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(x.length, Math.ceil(to));
  for (let i = a; i < b; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

function maxAbs(x: Float32Array, from: number, to: number): number {
  let m = 0;
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(x.length, Math.ceil(to));
  for (let i = a; i < b; i++) {
    const v = Math.abs(x[i]);
    if (v > m) m = v;
  }
  return m;
}

function sampleAt(step: number): number {
  return step * secondsPerStep(120) * SR;
}

/** First differing sample between two renders (-1 = bit-identical). */
function firstDiff(a: Float32Array, b: Float32Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe("HW-5 export-mix law (offline render applies volume/mute/solo)", () => {
  it(
    "mute = exact silence in the lane's exclusive window; others bit-identical to notes-removed",
    { timeout: 120_000 },
    async () => {
      const base = mixProject();
      const clean = await renderProjectToBuffer(base);
      const muted = await renderProjectToBuffer(
        withLaneMix(base, { drums: { mute: true } }),
      );
      expect(muted.loopSamples).toBe(clean.loopSamples);
      expect(muted.tailSamples).toBe(clean.tailSamples);

      const mClean = mono(clean);
      const mMuted = mono(muted);

      // Window A (steps 0–7.9): drums-only. Muted → EXACT digital silence;
      // unmuted → real energy. (0.0 comparison is deliberate: a muted lane
      // contributes gain×0 samples and nothing else sounds there.)
      const a0 = sampleAt(0);
      const a1 = sampleAt(7.9);
      expect(maxAbs(mMuted, a0, a1)).toBe(0);
      expect(rms(mClean, a0, a1)).toBeGreaterThan(1e-3);

      // Window B (steps 8.3–10): lead-only. The lead stays audible with the
      // drums muted (muting one lane never silences another).
      const b0 = sampleAt(8.3);
      const b1 = sampleAt(10);
      expect(rms(mMuted, b0, b1)).toBeGreaterThan(1e-3);

      // Silence is silence however it is reached: the muted render is
      // BIT-IDENTICAL to a render whose drums pattern simply has no notes.
      const emptied = await renderProjectToBuffer(withoutDrumsNotes(base));
      const diff = firstDiff(mMuted, mono(emptied));
      expect(
        diff,
        `mute(drums) differs from notes-removed(drums) at sample ${diff} — a muted lane must contribute exact zeros`,
      ).toBe(-1);
    },
  );

  it(
    "solo is exactly the complementary mute vector (bit-identical renders)",
    { timeout: 120_000 },
    async () => {
      const base = mixProject();
      const soloDrums = await renderProjectToBuffer(
        withLaneMix(base, { drums: { solo: true } }),
      );
      const muteOthers = await renderProjectToBuffer(
        withLaneMix(base, {
          bass: { mute: true },
          chords: { mute: true },
          lead: { mute: true },
        }),
      );
      let diff = firstDiff(mono(soloDrums), mono(muteOthers));
      expect(
        diff,
        `solo(drums) ≠ mute(others) at sample ${diff} — solo must duck every non-solo lane to exactly the mute law`,
      ).toBe(-1);

      // The same law mirrored: solo(lead) ≡ mute(drums+bass+chords).
      const soloLead = await renderProjectToBuffer(
        withLaneMix(base, { lead: { solo: true } }),
      );
      const muteAllButLead = await renderProjectToBuffer(
        withLaneMix(base, {
          drums: { mute: true },
          bass: { mute: true },
          chords: { mute: true },
        }),
      );
      diff = firstDiff(mono(soloLead), mono(muteAllButLead));
      expect(diff, `solo(lead) ≠ mute(all-but-lead) at sample ${diff}`).toBe(-1);

      // And the solo lane itself keeps sounding: window B still carries the
      // lead under solo(lead), window A is exactly silent (drums ducked).
      const mSoloLead = mono(soloLead);
      expect(maxAbs(mSoloLead, sampleAt(0), sampleAt(7.5))).toBe(0);
      expect(rms(mSoloLead, sampleAt(8.3), sampleAt(10))).toBeGreaterThan(1e-3);
    },
  );

  it(
    "volume scales ONLY its own lane, linearly, deterministically",
    { timeout: 120_000 },
    async () => {
      const base = mixProject();
      const clean = await renderProjectToBuffer(base);
      const half = await renderProjectToBuffer(
        withLaneMix(base, { lead: { volume: 0.5 } }),
      );
      // Determinism: the same mixed project rendered twice is bit-identical.
      const halfAgain = await renderProjectToBuffer(
        withLaneMix(base, { lead: { volume: 0.5 } }),
      );
      expect(firstDiff(mono(half), mono(halfAgain))).toBe(-1);
      expect(half.loopSamples).toBe(clean.loopSamples);

      const mClean = mono(clean);
      const mHalf = mono(half);

      // Window A (drums-only, earlier in the serial sum than lead): the
      // lead's volume must NOT scale the running sum — drums energy unchanged
      // (this is the fan-in regression: a mix value on a SUM node would fail).
      const ratioA =
        rms(mHalf, sampleAt(0), sampleAt(7.9)) /
        rms(mClean, sampleAt(0), sampleAt(7.9));
      expect(ratioA).toBeGreaterThan(0.98);
      expect(ratioA).toBeLessThan(1.02);

      // Window B (lead-only): linear gain 0.5 → the RMS AMPLITUDE ratio is
      // 0.5 (the master soft-clip is near-linear at this level; 2% band).
      const ratioB =
        rms(mHalf, sampleAt(8.3), sampleAt(10)) /
        rms(mClean, sampleAt(8.3), sampleAt(10));
      expect(ratioB).toBeGreaterThan(0.49);
      expect(ratioB).toBeLessThan(0.51);
    },
  );

  it(
    "canonical-empty mix ≡ explicit default keys (golden byte law)",
    { timeout: 120_000 },
    async () => {
      const base = mixProject();
      const explicitDefaults = withLaneMix(base, {
        drums: { volume: 1, mute: false, solo: false },
        bass: { volume: 1, mute: false, solo: false },
        chords: { volume: 1, mute: false, solo: false },
        lead: { volume: 1, mute: false, solo: false },
      });
      const a = await renderProjectToBuffer(base);
      const b = await renderProjectToBuffer(explicitDefaults);
      const diff = firstDiff(mono(a), mono(b));
      expect(
        diff,
        `explicit default mix keys changed the render at sample ${diff} — unity gains must be exact`,
      ).toBe(-1);
    },
  );
});
