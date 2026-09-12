import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  DRUM_KITS,
  PRESET_LIBRARY,
  SAMPLE_KIT_IDS,
  SAMPLE_PLAYBACK_RATE_MAX,
  SAMPLE_PLAYBACK_RATE_MIN,
  VoicePresetSchema,
  WAVE_CODE,
  getDrumKit,
  getPreset,
  noteParamsFor,
  sampleRefsForSound,
  sampleVoiceFieldIssue,
  type VoicePreset,
} from "../src/audio/presets";
import {
  DRUM_PIECES,
  createDefaultProject,
  SampleProvenanceEntrySchema,
  SampleRefSchema,
} from "../src/document/schema";
import { CONTENT_ASSETS } from "../src/assets/content/loader";

function validatePreset(p: VoicePreset): void {
  expect(typeof p.id).toBe("string");
  expect(
    p.wave === "pulse" ||
      p.wave === "triangle" ||
      p.wave === "noise" ||
      p.wave === "pluck" ||
      p.wave === "bell" ||
      p.wave === "brass",
  ).toBe(true);
  expect(p.duty).toBeGreaterThan(0);
  expect(p.duty).toBeLessThanOrEqual(1);
  expect(p.noiseMix).toBeGreaterThanOrEqual(0);
  expect(p.noiseMix).toBeLessThanOrEqual(1);
  expect(p.level).toBeGreaterThan(0);
  expect(p.level).toBeLessThanOrEqual(1);
  expect(p.seed).toBeGreaterThanOrEqual(1);
  expect(p.seed).toBeLessThanOrEqual(32767);
  expect(p.noiseRate).toBeGreaterThan(0);
  const { attack, decay, sustain, release } = p.envelope;
  for (const seg of [attack, decay, release])
    expect(seg).toBeGreaterThanOrEqual(0);
  expect(sustain).toBeGreaterThanOrEqual(0);
  expect(sustain).toBeLessThanOrEqual(1);
}

/**
 * PS-1 distinctness law (Professor X lens): within a lane, no two presets
 * may share the same audible archetype. The signature spans every axis an
 * owner can hear — wave family (pulse duty kept, since 12.5/25/50 duty ARE
 * different instruments), octave placement, pitch-sweep direction, audible
 * noise texture, envelope attack class, and release class. Two presets with
 * one signature would be "parameter nudges of one voice", which the plan
 * forbids; this makes the rule executable.
 *
 * PS-4 extension: the sample axis is first-class — a recorded voice is its
 * own archetype (voiceType 'sample' + the asset id), so sample presets are
 * distinct from every synth preset AND from each other by construction.
 */
function presetSignature(p: VoicePreset): string {
  if (p.voiceType === "sample") return `sample|${p.sampleRef ?? "?"}`;
  const attackClass =
    p.envelope.attack <= 0.002
      ? "perc"
      : p.envelope.attack < 0.02
        ? "mid"
        : p.envelope.attack < 0.1
          ? "slow"
          : "swell";
  const releaseClass = p.envelope.release <= 0.1 ? "rel-short" : "rel-long";
  const sweep = p.pitchSweep
    ? p.pitchSweep.endRatio < 1
      ? "down"
      : "up"
    : "flat";
  const noise = p.noiseMix > 0.05 ? "airy" : "clean";
  const dutyAxis = p.wave === "pulse" || p.wave === "pluck" ? p.duty : "";
  return [
    p.wave,
    dutyAxis,
    p.pitchRange?.octaveBase ?? "-",
    sweep,
    noise,
    attackClass,
    releaseClass,
  ].join("|");
}

describe("preset library", () => {
  it("has at least 12 presets per pitched lane type (bass/chords/lead) — PS-1 target", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const ids = Object.keys(PRESET_LIBRARY).filter((id) => id.includes(lane));
      expect(ids.length).toBeGreaterThanOrEqual(12);
      for (const id of ids) validatePreset(getPreset(id)!);
    }
  });

  it("presets within a lane are musically distinct (unique audible signatures)", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const presets = Object.values(PRESET_LIBRARY).filter((p) =>
        p.id.includes(lane),
      );
      const seen = new Map<string, string>();
      for (const p of presets) {
        const sig = presetSignature(p);
        expect(
          seen.has(sig),
          `${p.id} sounds like ${seen.get(sig)} (signature ${sig}) — parameter nudge, not a new voice`,
        ).toBe(false);
        seen.set(sig, p.id);
      }
      // Palette breadth: every lane spans ≥3 wave families (pulse/triangle +
      // at least one of noise-texture or Karplus–Strong pluck).
      const waves = new Set(presets.map((p) => p.wave));
      expect(waves.size, `${lane} palette too narrow`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("names are unique and ≤14 chars within a lane (stepper reads one clear label)", () => {
    for (const lane of ["bass", "chords", "lead"] as const) {
      const names = new Set<string>();
      for (const p of Object.values(PRESET_LIBRARY)) {
        if (!p.id.includes(lane)) continue;
        expect(p.name.length).toBeLessThanOrEqual(14);
        expect(names.has(p.name), `${lane} duplicate name ${p.name}`).toBe(
          false,
        );
        names.add(p.name);
      }
    }
    const kitNames = new Set<string>();
    for (const kit of Object.values(DRUM_KITS)) {
      expect(kitNames.has(kit.name), `duplicate kit name ${kit.name}`).toBe(
        false,
      );
      kitNames.add(kit.name);
    }
  });

  it("every preset record is VoicePresetSchema-valid (PX-2 data validity)", () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      expect(() => v.parse(VoicePresetSchema, p), p.id).not.toThrow();
    }
    for (const kit of Object.values(DRUM_KITS)) {
      for (const piece of DRUM_PIECES) {
        expect(
          () => v.parse(VoicePresetSchema, kit.pieces[piece]),
          `${kit.id}.${piece}`,
        ).not.toThrow();
      }
    }
  });

  it("ids are unique and library keys match record ids", () => {
    const seen = new Set<string>();
    for (const [key, p] of Object.entries(PRESET_LIBRARY)) {
      expect(seen.has(p.id), p.id).toBe(false);
      seen.add(p.id);
      expect(key).toBe(p.id);
    }
    for (const kit of Object.values(DRUM_KITS)) {
      for (const piece of DRUM_PIECES) {
        const p = kit.pieces[piece];
        expect(seen.has(p.id), p.id).toBe(false);
        seen.add(p.id);
        expect(p.id.startsWith(`${kit.id}-`)).toBe(true);
      }
    }
  });

  it("all ids referenced by the default project exist in the libraries", () => {
    for (const lane of createDefaultProject().lanes) {
      if (lane.id === "drums") {
        expect(getDrumKit(lane.kitId), lane.kitId).toBeDefined();
      } else {
        expect(getPreset(lane.presetId), lane.presetId).toBeDefined();
      }
    }
  });

  it("pitched presets carry a pitch range with a sane octave", () => {
    for (const p of Object.values(PRESET_LIBRARY)) {
      expect(p.pitchRange?.octaveBase).toBeDefined();
      expect(p.pitchRange!.octaveBase).toBeGreaterThanOrEqual(1);
      expect(p.pitchRange!.octaveBase).toBeLessThanOrEqual(6);
    }
  });

  it("has ≥10 drum kits (PS-1 target), each mapping every drum piece to a preset", () => {
    const kits = Object.values(DRUM_KITS);
    expect(kits.length).toBeGreaterThanOrEqual(10);
    for (const kit of kits) {
      for (const piece of DRUM_PIECES) {
        const p = kit.pieces[piece];
        expect(p, `${kit.id}.${piece}`).toBeDefined();
        validatePreset(p);
      }
    }
  });

  it("synth kits vary the committed character axes (kick sweep, snare mix, hat decay)", () => {
    // PS-4: the axis law governs SYNTH kits (recipe knobs); recorded kits
    // vary by their recordings instead — covered by the sample-kit tests.
    const kits = Object.values(DRUM_KITS).filter(
      (k) => k.pieces.kick.voiceType !== "sample",
    );
    expect(kits.length).toBeGreaterThanOrEqual(10);
    const kickRatios = new Set(
      kits.map((k) => k.pieces.kick.pitchSweep!.endRatio),
    );
    const snareMixes = new Set(kits.map((k) => k.pieces.snare.noiseMix));
    const hatDecays = new Set(kits.map((k) => k.pieces.hat.envelope.decay));
    const kickDecays = new Set(kits.map((k) => k.pieces.kick.envelope.decay));
    // 10 kits, each claiming a distinct groove — the axes must actually
    // separate them (≥8 distinct values per axis leaves honest headroom).
    expect(kickRatios.size).toBeGreaterThanOrEqual(8);
    expect(snareMixes.size).toBeGreaterThanOrEqual(8);
    expect(hatDecays.size).toBeGreaterThanOrEqual(8);
    expect(kickDecays.size).toBeGreaterThanOrEqual(8);
  });

  it("drum kit characters follow the D2/D3 recipes", () => {
    const kit = getDrumKit("kit-default")!;
    expect(kit.pieces.kick.wave).toBe("pulse");
    expect(kit.pieces.kick.pitchSweep?.endRatio).toBeLessThan(1); // pitch-swept
    expect(kit.pieces.snare.noiseMix).toBeGreaterThan(0.5); // noise + tone
    expect(kit.pieces.snare.wave).not.toBe("noise"); // keeps a tone component
    expect(kit.pieces.hat.wave).toBe("noise");
    expect(kit.pieces.hat.noiseMode).toBe("short"); // LFSR short
    expect(kit.pieces.clap.wave).toBe("noise");
    expect(kit.pieces.tom.pitchSweep?.endRatio).toBeLessThan(1);
  });

  it("lookup miss returns undefined; hits return the record", () => {
    expect(getPreset("nope")).toBeUndefined();
    expect(getDrumKit("nope")).toBeUndefined();
    expect(getPreset("preset-bass-1")!.id).toBe("preset-bass-1");
    expect(getDrumKit("kit-default")!.id).toBe("kit-default");
  });
});

describe("noteParamsFor", () => {
  const preset = getPreset("preset-bass-1")!;

  it("derives freq from midi and clamps to the voice cap", () => {
    const ev = noteParamsFor(preset, { time: 1, midi: 36, holdSeconds: 0.2 });
    expect(ev.freq).toBeCloseTo(440 * Math.pow(2, (36 - 69) / 12), 9);
    const high = noteParamsFor(preset, {
      time: 1,
      midi: 127,
      holdSeconds: 0.2,
    });
    expect(high.freq).toBe(12400);
  });

  it("baseFreq overrides midi; sweep target follows endRatio", () => {
    const kick = getDrumKit("kit-default")!.pieces.kick;
    const ev = noteParamsFor(kick, { time: 0, holdSeconds: 0.2 });
    expect(ev.freq).toBe(kick.baseFreq);
    expect(ev.freqEnd).toBeCloseTo(
      kick.baseFreq! * kick.pitchSweep!.endRatio,
      9,
    );
    expect(ev.sweepSeconds).toBe(kick.pitchSweep!.seconds);
  });

  it("noise presets force noiseMix 1; seed is deterministic and in range", () => {
    const hat = getDrumKit("kit-default")!.pieces.hat;
    const a = noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 3 });
    const b = noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 3 });
    expect(a.noiseMix).toBe(1);
    expect(a.noiseShort).toBe(true);
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBeGreaterThanOrEqual(1);
    expect(a.seed).toBeLessThanOrEqual(32767);
    expect(
      noteParamsFor(hat, { time: 2, holdSeconds: 0.05, seedSalt: 4 }).seed,
    ).not.toBe(a.seed);
  });

  it("maps wave names to stable wire codes", () => {
    expect(WAVE_CODE.pulse).toBe(0);
    expect(WAVE_CODE.triangle).toBe(1);
    expect(WAVE_CODE.noise).toBe(2);
    expect(WAVE_CODE.pluck).toBe(3);
    expect(
      noteParamsFor(preset, { time: 0, midi: 60, holdSeconds: 0.1 }).wave,
    ).toBe(0);
  });

  it("pluck presets ride the wire unchanged: wave 3, duty = string decay", () => {
    const pluck = getPreset("preset-bass-7")!;
    const ev = noteParamsFor(pluck, { time: 0.5, midi: 40, holdSeconds: 0.3 });
    expect(ev.wave).toBe(WAVE_CODE.pluck);
    // duty passes through untouched — the worklet derives the KS damping
    // from it (duty × 4 s); no wire-format field was added for pluck.
    expect(ev.duty).toBe(pluck.duty);
    expect(ev.noiseMix).toBe(0); // pure string: excitation is the seeded fill
    expect(ev.freq).toBeCloseTo(440 * Math.pow(2, (40 - 69) / 12), 9);
  });

  it("pluck presets ship without pitchSweep (KS loop length is fixed at trigger)", () => {
    const plucks = Object.values(PRESET_LIBRARY).filter(
      (p) => p.wave === "pluck",
    );
    expect(plucks.length).toBeGreaterThanOrEqual(5); // 2 bass + 2 chords + 2 lead lanes use it
    for (const p of plucks) {
      expect(p.pitchSweep, `${p.id} must not pair pluck with pitchSweep`).toBe(
        undefined,
      );
    }
  });

  // --- PS-4: the sample branch of the wire format ----------------------------

  it("sample presets carry routing data: ref + playbackRate from rootMidi (unclamped by the freq cap)", () => {
    const p = getPreset("preset-chords-13")!; // PURE TONE, rootMidi 60
    const ev = noteParamsFor(p, { time: 0, midi: 72, holdSeconds: 0.3 });
    expect(ev.sample).toBeDefined();
    expect(ev.sample!.ref).toBe("voice.chords.tone");
    expect(ev.sample!.playbackRate).toBeCloseTo(2, 9); // +1 octave
    expect(ev.sample!.oneShot).toBe(false); // pitched: note-length law
    // An extreme note would have been freq-clamped on the synth path; the
    // sample rate derives from raw midi and clamps to its OWN range.
    const wayUp = noteParamsFor(p, { time: 0, midi: 127, holdSeconds: 0.3 });
    expect(wayUp.sample!.playbackRate).toBe(SAMPLE_PLAYBACK_RATE_MAX);
    const wayDown = noteParamsFor(p, { time: 0, midi: 0, holdSeconds: 0.3 });
    expect(wayDown.sample!.playbackRate).toBe(SAMPLE_PLAYBACK_RATE_MIN);
  });

  it("sample drum pieces play one-shot at rate 1 (recordings own their envelope)", () => {
    const kick = getDrumKit("kit-808")!.pieces.kick;
    const ev = noteParamsFor(kick, { time: 0, holdSeconds: 0.125 });
    expect(ev.sample!.ref).toBe("drums.808.kick");
    expect(ev.sample!.playbackRate).toBe(1);
    expect(ev.sample!.oneShot).toBe(true);
  });

  it("synth presets never carry sample data; sample events are deterministic (no seed dependence)", () => {
    expect(
      noteParamsFor(preset, { time: 1, midi: 40, holdSeconds: 0.1 }).sample,
    ).toBeUndefined();
    const samplePreset = getPreset("preset-lead-13")!;
    const a = noteParamsFor(samplePreset, {
      time: 0.25,
      midi: 64,
      holdSeconds: 0.2,
    });
    const b = noteParamsFor(samplePreset, {
      time: 0.25,
      midi: 64,
      holdSeconds: 0.2,
    });
    expect(a.sample).toEqual(b.sample);
    expect(a.sample!.playbackRate).toBeCloseTo(Math.pow(2, (64 - 60) / 12), 9);
  });
});

// ---------------------------------------------------------------------------
// PS-3: the voice-type slot (voiceType / sampleRef / rootMidi) — format laws.
// The sample-voice ENGINE (SampleVoiceHost) is PS-4's; these pin the format.
// ---------------------------------------------------------------------------

describe("PS-3 voice-type slot (preset format)", () => {
  /** A minimal sample-backed preset (PS-4's library entries will look like this). */
  function samplePreset(
    over: Partial<Pick<VoicePreset, "voiceType" | "sampleRef" | "rootMidi">>,
  ): VoicePreset {
    return {
      id: "preset-sample-test",
      name: "SAMPLE TEST",
      wave: "pulse",
      duty: 0.5,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
      noiseMix: 0,
      noiseMode: "long",
      noiseRate: 40,
      level: 0.8,
      pitchRange: { octaveBase: 3 },
      seed: 42,
      ...over,
    };
  }

  it("voice-type slot laws hold across the whole library (PS-4 extension: synth canonical-empty, sample well-formed)", () => {
    const all: VoicePreset[] = [
      ...Object.values(PRESET_LIBRARY),
      ...Object.values(DRUM_KITS).flatMap((kit) => Object.values(kit.pieces)),
    ];
    expect(all.length).toBeGreaterThan(60);
    let sampleVoices = 0;
    for (const p of all) {
      expect(() => v.parse(VoicePresetSchema, p), p.id).not.toThrow();
      if (p.voiceType === "sample") {
        // Sample law: sampleRef REQUIRED (schema), rootMidi iff pitched
        // (drum pieces have baseFreq and play at rate 1), pitchRange iff
        // pitched, and the ref must exist in the committed content manifest.
        expect(p.sampleRef, p.id).toBeDefined();
        const asset = CONTENT_ASSETS.find((a) => a.id === p.sampleRef);
        expect(
          asset,
          `${p.id}: unknown sampleRef ${p.sampleRef}`,
        ).toBeDefined();
        if (p.baseFreq !== undefined) {
          expect(
            p.rootMidi,
            `${p.id}: drum piece carries rootMidi`,
          ).toBeUndefined();
          expect(
            p.pitchRange,
            `${p.id}: drum piece carries pitchRange`,
          ).toBeUndefined();
        } else {
          expect(
            p.rootMidi,
            `${p.id}: pitched sample preset misses rootMidi`,
          ).toBeDefined();
          expect(
            p.pitchRange?.octaveBase,
            `${p.id}: pitched sample preset misses pitchRange`,
          ).toBeDefined();
          const voice = asset as (typeof CONTENT_ASSETS)[number] & {
            rootMidi?: number;
          };
          // Connective pin: the preset's root is the MEASURED manifest value.
          expect(p.rootMidi, `${p.id}: rootMidi drift vs manifest`).toBe(
            voice.rootMidi,
          );
        }
        sampleVoices++;
      } else {
        // Canonical-empty law: synth is expressed by OMITTING the field, and
        // a synth preset carries no half-sample fields.
        expect(p.voiceType, p.id).toBeUndefined();
        expect(p.sampleRef, p.id).toBeUndefined();
        expect(p.rootMidi, p.id).toBeUndefined();
      }
    }
    // The committed content list is wired: 4 sample kits × 6 pieces + 6
    // pitched sample voices = 30 sample-backed presets.
    expect(sampleVoices).toBe(4 * 6 + 6);
  });

  it("PS-4 sample kits: the 4 committed kits map every base piece to its manifest asset", () => {
    expect(SAMPLE_KIT_IDS.length).toBe(4);
    for (const kitId of SAMPLE_KIT_IDS) {
      const kit = getDrumKit(kitId)!;
      expect(kit, kitId).toBeDefined();
      const contentKit = kitId.replace(/^kit-/, "");
      for (const piece of DRUM_PIECES) {
        const p = kit.pieces[piece];
        expect(p.sampleRef, `${kitId}.${piece}`).toBe(
          `drums.${contentKit}.${piece}`,
        );
        expect(
          CONTENT_ASSETS.some((a) => a.id === p.sampleRef),
          `${kitId}.${piece}: ref not in manifest`,
        ).toBe(true);
      }
    }
    // Every committed drum asset is either wired (base piece of a kit) or a
    // recorded variant kept for future curation (the 808 flagship extras).
    const wired = new Set(
      SAMPLE_KIT_IDS.flatMap((id) =>
        DRUM_PIECES.map((piece) => getDrumKit(id)!.pieces[piece].sampleRef),
      ),
    );
    const drumAssets = CONTENT_ASSETS.filter((a) => a.kind === "drums");
    for (const asset of drumAssets) {
      if (!wired.has(asset.id)) {
        // unwired = variant rows of the 808 flagship (kick2/snare2/hat2)
        expect(asset.id.startsWith("drums.808."), `${asset.id} unwired`).toBe(
          true,
        );
        expect((asset as { variant?: number }).variant, `${asset.id}`).toBe(2);
      }
    }
  });

  it("PS-4 sampleRefsForSound resolves kits, sample presets, and synth no-ops", () => {
    for (const kitId of SAMPLE_KIT_IDS) {
      const refs = sampleRefsForSound(kitId);
      expect(refs).toHaveLength(6);
      for (const piece of DRUM_PIECES) {
        expect(refs).toContain(`drums.${kitId.replace(/^kit-/, "")}.${piece}`);
      }
    }
    const samplePresets = Object.values(PRESET_LIBRARY).filter(
      (p) => p.voiceType === "sample" && p.pitchRange !== undefined,
    );
    expect(samplePresets).toHaveLength(6);
    for (const p of samplePresets) {
      expect(sampleRefsForSound(p.id)).toEqual([p.sampleRef]);
    }
    // Synth sounds resolve to zero refs (the lazy loader never engages).
    expect(sampleRefsForSound("kit-default")).toEqual([]);
    expect(sampleRefsForSound("preset-bass-1")).toEqual([]);
    expect(sampleRefsForSound("nope")).toEqual([]);
  });

  it("accepts a well-formed sample preset (sampleRef into the content manifest)", () => {
    const p = samplePreset({
      voiceType: "sample",
      sampleRef: "voice.bass.lowtone",
    });
    const out = v.parse(VoicePresetSchema, p);
    expect(out.voiceType).toBe("sample");
    expect(out.sampleRef).toBe("voice.bass.lowtone");
    expect(out.rootMidi).toBeUndefined();
  });

  it("accepts a sample preset with a measured rootMidi (PS-4 shape)", () => {
    expect(() =>
      v.parse(
        VoicePresetSchema,
        samplePreset({
          voiceType: "sample",
          sampleRef: "drums.808.kick",
          rootMidi: 36,
        }),
      ),
    ).not.toThrow();
  });

  it("explicit voiceType 'synth' stays legal (non-canonical but round-trips; writers omit at default)", () => {
    const out = v.parse(
      VoicePresetSchema,
      samplePreset({ voiceType: "synth" }),
    );
    expect(out.voiceType).toBe("synth");
  });

  const REJECTS: ReadonlyArray<[string, VoicePreset]> = [
    ["sample voice without sampleRef", samplePreset({ voiceType: "sample" })],
    [
      "synth preset (field absent) carrying sampleRef",
      samplePreset({ sampleRef: "voice.bass.lowtone" }),
    ],
    [
      "explicit synth preset carrying sampleRef",
      samplePreset({ voiceType: "synth", sampleRef: "voice.bass.lowtone" }),
    ],
    ["synth preset carrying rootMidi", samplePreset({ rootMidi: 60 })],
    [
      "sampleRef as a URL (ids are stable, URLs are per-build)",
      samplePreset({
        voiceType: "sample",
        sampleRef: "https://bitbounce.test/asset.ogg",
      }),
    ],
    [
      "sampleRef with uppercase segments",
      samplePreset({ voiceType: "sample", sampleRef: "Voice.Bass.Tone" }),
    ],
    [
      "sampleRef without a dot separator",
      samplePreset({ voiceType: "sample", sampleRef: "voicebass" }),
    ],
    ["empty sampleRef", samplePreset({ voiceType: "sample", sampleRef: "" })],
    [
      "rootMidi below the MIDI range",
      samplePreset({
        voiceType: "sample",
        sampleRef: "voice.bass.lowtone",
        rootMidi: -1,
      }),
    ],
    [
      "rootMidi above the MIDI range",
      samplePreset({
        voiceType: "sample",
        sampleRef: "voice.bass.lowtone",
        rootMidi: 128,
      }),
    ],
    [
      "rootMidi not an integer",
      samplePreset({
        voiceType: "sample",
        sampleRef: "voice.bass.lowtone",
        rootMidi: 60.5,
      }),
    ],
    [
      "unknown voiceType discriminant",
      samplePreset({
        voiceType: "sampler",
        sampleRef: "voice.bass.lowtone",
      }) as VoicePreset,
    ],
    [
      "unknown preset field (strictObject still applies)",
      {
        ...samplePreset({
          voiceType: "sample",
          sampleRef: "voice.bass.lowtone",
        }),
        mystery: 1,
      } as unknown as VoicePreset,
    ],
  ];

  for (const [label, presetRecord] of REJECTS) {
    it(`rejects: ${label}`, () => {
      expect(() => v.parse(VoicePresetSchema, presetRecord)).toThrow();
    });
  }

  it("sampleVoiceFieldIssue names the exact broken law (module-load diagnostics)", () => {
    expect(sampleVoiceFieldIssue({ voiceType: "sample" })).toBe(
      "voiceType 'sample' requires sampleRef",
    );
    expect(sampleVoiceFieldIssue({ sampleRef: "voice.bass.lowtone" })).toMatch(
      /sampleRef requires voiceType 'sample'/,
    );
    expect(sampleVoiceFieldIssue({ rootMidi: 60 })).toMatch(
      /rootMidi requires voiceType 'sample'/,
    );
    expect(sampleVoiceFieldIssue({})).toBeUndefined();
    expect(
      sampleVoiceFieldIssue({
        voiceType: "sample",
        sampleRef: "drums.808.kick",
        rootMidi: 36,
      }),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PS-3 connective tissue: the committed content manifest is provenance-
// compatible — every asset id fits the sampleRef grammar, and every row's
// license/sourceUrl/author echo parses as a SampleProvenanceEntry. The
// preset format and the document provenance can carry the manifest verbatim.
// ---------------------------------------------------------------------------

describe("PS-3 manifest ↔ schema provenance compatibility", () => {
  it("every CONTENT_ASSETS id parses SampleRefSchema (preset sampleRef + provenance keys share it)", () => {
    expect(CONTENT_ASSETS.length).toBe(33);
    for (const asset of CONTENT_ASSETS) {
      expect(() => v.parse(SampleRefSchema, asset.id), asset.id).not.toThrow();
    }
  });

  it("every manifest row's license echo parses SampleProvenanceEntrySchema verbatim", () => {
    for (const asset of CONTENT_ASSETS) {
      const entry = {
        license: asset.license,
        sourceUrl: asset.sourceUrl,
        author: asset.author,
      };
      expect(
        () => v.parse(SampleProvenanceEntrySchema, entry),
        asset.id,
      ).not.toThrow();
    }
  });

  it("a sample preset's sampleRef resolves against the manifest (spot: the shape PS-4 will select)", () => {
    const p: VoicePreset = {
      ...getPreset("preset-bass-1")!,
      voiceType: "sample",
      sampleRef: "voice.bass.lowtone",
    };
    expect(() => v.parse(VoicePresetSchema, p)).not.toThrow();
    expect(CONTENT_ASSETS.some((a) => a.id === p.sampleRef)).toBe(true);
  });
});
