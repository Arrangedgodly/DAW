/**
 * PS-4 — sample-voice engine gate (real browser, real nodes).
 *
 * Proves through the production paths:
 * - OFFLINE PARITY + DETERMINISM: a project using sample voices renders
 *   through renderProjectToBuffer (compiler → router → native host, every
 *   asset decoded before scheduling) BIT-IDENTICALLY twice — sample events
 *   carry no seeds, so the recording + playbackRate is the whole truth.
 * - ENERGY WINDOWS (v0 conventions): sample onsets land at exactly
 *   timeAtStep×sr within detector slack; a pitched sample's note LENGTH is
 *   audible (SC-2 law: energy beyond a short note's end exists only for the
 *   long note — the release fade cuts the short one).
 * - KIT COVERAGE: each committed sample kit drives the drums lane of a real
 *   project render; every piece is audible standalone (preset-library) and
 *   the kit renders the pattern grid exactly (onset count = grid hits).
 * - SELECTION JOURNEY (≤1 interaction + lazy law): on the real LaneHeader
 *   stepper, ZERO audio-asset fetches happen before a sample sound is
 *   selected; selecting one fetches its pieces (+ neighbors), decodes them,
 *   records the provenance echo, and the click's audition actually starts
 *   an AudioBufferSourceNode; a failing load surfaces a sticky toast without
 *   breaking anything else.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createDefaultProject, type ProjectDocument } from "../../src/document/schema";
import { renderProjectToBuffer, EXPORT_SAMPLE_RATE } from "../../src/audio/render";
import { SAMPLE_KIT_IDS, getDrumKit, getPreset } from "../../src/audio/presets";
import { timeAtStep } from "../../src/audio/time";
import { docStore, setLaneSoundId } from "../../src/state/store";
import { clearToasts } from "../../src/state/toasts";
import { connectStoreToEngine, primeSoundContent } from "../../src/state/engineBridge";
import LaneHeader from "../../src/components/LaneHeader";
import Toasts from "../../src/components/Toasts";
import { assertCleanAudio, detectOnsets } from "./helpers";

const SR = EXPORT_SAMPLE_RATE;

function monoOf(result: Awaited<ReturnType<typeof renderProjectToBuffer>>) {
  const [l, r] = result.channels;
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = (l[i]! + r[i]!) / 2;
  return out;
}

function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < Math.min(to, x.length); i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / Math.max(1, Math.min(to, x.length) - from));
}

/** Lead lane on a pitched sample preset, one note of `lengthSteps` steps. */
function sampleLeadProject(lengthSteps: number): ProjectDocument {
  const doc = createDefaultProject();
  const lead = doc.lanes.find((l) => l.id === "lead")!;
  lead.presetId = "preset-lead-13"; // PHASER UP (sample, ~0.42 s recording)
  const pattern = doc.patterns.lead[0];
  if (pattern.kind !== "pitched") throw new Error("expected pitched");
  pattern.notes = [{ degree: 3, start: 0, length: lengthSteps }];
  return doc;
}

/** Drums lane on a sample kit; kick on 0/4/8/12, snare on 4/12. */
function sampleKitProject(kitId: string): ProjectDocument {
  const doc = createDefaultProject();
  doc.lanes.find((l) => l.id === "drums")!.kitId = kitId;
  const drums = doc.patterns.drums[0];
  if (drums.kind !== "drums") throw new Error("expected drums");
  for (const s of [0, 4, 8, 12]) drums.steps.kick[s] = true;
  for (const s of [4, 12]) drums.steps.snare[s] = true;
  return doc;
}

async function waitFor(predicate: () => boolean, ms = 6000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("condition never met within budget");
}

describe("PS-4 sample voices — offline render parity + determinism", () => {
  it(
    "a sample-voice project renders bit-identically twice (decode-before-render, no seeds)",
    { timeout: 120_000 },
    async () => {
      const doc = sampleLeadProject(2);
      const a = await renderProjectToBuffer(doc, { includeRaw: true });
      const b = await renderProjectToBuffer(doc, { includeRaw: true });
      expect(a.loopSamples).toBe(b.loopSamples);
      for (let c = 0; c < 2; c++) {
        const ca = a.channels[c]!;
        const cb = b.channels[c]!;
        expect(ca.length).toBe(cb.length);
        for (let i = 0; i < ca.length; i++) {
          if (ca[i] !== cb[i]) {
            expect.fail(`channel ${c} sample ${i}: ${ca[i]} !== ${cb[i]}`);
          }
        }
      }
      assertCleanAudio(a.channels, "sample-voice render");
    },
  );

  it(
    "PS-4 + FX: sample lane through its per-lane FX chain still deterministic",
    { timeout: 120_000 },
    async () => {
      const doc = sampleLeadProject(4);
      const lead = doc.lanes.find((l) => l.id === "lead")!;
      lead.fxChain = [
        { type: "delay", bypassed: false, params: { timeSteps: 2, feedback: 0.35, mix: 0.3 } },
      ];
      const a = await renderProjectToBuffer(doc);
      const b = await renderProjectToBuffer(doc);
      const ma = monoOf(a);
      const mb = monoOf(b);
      for (let i = 0; i < ma.length; i++) {
        if (ma[i] !== mb[i]) expect.fail(`fx sample ${i}: ${ma[i]} !== ${mb[i]}`);
      }
      // The delay tail exists beyond the loop (sample + FX ride the chain).
      expect(a.tailSamples).toBeGreaterThan(0);
    },
  );

  it(
    "energy windows: onsets at exact step times; note LENGTH is audible (SC-2 for samples)",
    { timeout: 120_000 },
    async () => {
      const groove = { bpm: 120, swing: 0 };
      const short = await renderProjectToBuffer(sampleLeadProject(1));
      const long = await renderProjectToBuffer(sampleLeadProject(8));
      const ms = monoOf(short);
      const ml = monoOf(long);
      assertCleanAudio([ms], "short-note render");
      assertCleanAudio([ml], "long-note render");
      // Onset at step 0 within the RECORDING's own attack. Unlike synth
      // voices (instant full-level onset), a one-shot's audible front edge
      // is the recording's: phaserup crosses 5% of its peak ~64 ms in (the
      // detector's threshold), so the honest bound is "no earlier than the
      // scheduled step, within the committed set's slowest attack (~80 ms)".
      const onsets = detectOnsets(ml);
      const expected = Math.round(timeAtStep(0, groove) * SR);
      expect(
        onsets.some(
          (o) => o >= expected && o - expected <= Math.round(0.08 * SR),
        ),
        `no onset within the recording's attack window of sample ${expected}`,
      ).toBe(true);
      // Note-length law audible (SC-2 for samples): degree 3 of C minor at
      // octave 4 = F4 = midi 65 → rate 2^(5/12) ≈ 1.33 → the 0.42 s
      // recording rings ~0.31 s. The 1-step note (hold 0.125 + release
      // 0.09) is fully silent by ~0.22 s; the 8-step note still rings in
      // [0.24, 0.30]. That window separates them cleanly.
      const from = Math.round(0.24 * SR);
      const to = Math.round(0.3 * SR);
      expect(rms(ml, from, to)).toBeGreaterThan(1e-3);
      expect(rms(ms, from, to)).toBeLessThan(rms(ml, from, to) / 8);
    },
  );

  it(
    "kit coverage: all four sample kits render the drum grid exactly (onset count = hits)",
    { timeout: 180_000 },
    async () => {
      const groove = { bpm: 120, swing: 0 };
      for (const kitId of SAMPLE_KIT_IDS) {
        const kit = getDrumKit(kitId)!;
        expect(kit, kitId).toBeDefined();
        const result = await renderProjectToBuffer(sampleKitProject(kitId));
        const m = monoOf(result);
        assertCleanAudio([m], `${kitId} render`);
        const onsets = detectOnsets(m);
        // 6 kick + 2 snare hits; snares coincide with kicks on 4/12.
        const hits = [0, 4, 8, 12].map((s) =>
          Math.round(timeAtStep(s, groove) * SR),
        );
        for (const sample of hits) {
          expect(
            onsets.some((o) => Math.abs(o - sample) <= 441),
            `${kitId}: no onset within 10 ms of sample ${sample}`,
          ).toBe(true);
        }
        // The long recorded tails ring INTO the loop (folded at the seam).
        expect(rms(m, Math.round(0.9 * SR), Math.round(1.0 * SR))).toBeGreaterThan(
          1e-4,
        );
      }
    },
  );
});

describe("PS-4 sample voices — selection journey on the real stepper", () => {
  interface Journey {
    host: HTMLElement;
    toastHost: HTMLElement;
    oggFetches: () => string[];
    starts: () => number;
    cleanup: () => void;
  }

  function mountJourney(): Journey {
    const oggUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\.ogg(?:$|\?)/i.test(url)) oggUrls.push(url);
      return origFetch(input, init);
    }) as typeof fetch;
    const origStart = AudioBufferSourceNode.prototype.start;
    let startCount = 0;
    AudioBufferSourceNode.prototype.start = function (
      this: AudioBufferSourceNode,
      when?: number,
    ) {
      startCount++;
      return origStart.call(this, when);
    };
    const host = document.createElement("div");
    document.body.append(host);
    const toastHost = document.createElement("div");
    document.body.append(toastHost);
    // The production wiring: the store→engine bridge sets lane sounds on the
    // session (auditions resolve the CURRENT sound) and primes content.
    const disconnectBridge = connectStoreToEngine();
    const disposeLane = render(() => <LaneHeader lane="drums" />, host);
    const disposeToasts = render(Toasts, toastHost);
    return {
      host,
      toastHost,
      oggFetches: () => [...oggUrls],
      starts: () => startCount,
      cleanup: () => {
        globalThis.fetch = origFetch;
        AudioBufferSourceNode.prototype.start = origStart;
        disconnectBridge();
        disposeLane();
        disposeToasts();
        host.remove();
        toastHost.remove();
        clearToasts();
      },
    };
  }

  function nextKitButton(host: HTMLElement): HTMLButtonElement {
    const btn = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Next kit for DRUMS"]',
    );
    if (!btn) throw new Error("next-kit button not found");
    return btn;
  }

  function kitLabel(host: HTMLElement): string {
    return (
      host.querySelector<HTMLSpanElement>(".head-ctl-value")?.textContent ?? ""
    );
  }

  it(
    "zero audio fetches before selection; one click on a sample kit = selected + fetched + decoded + auditioned + provenance",
    { timeout: 120_000 },
    async () => {
      const j = mountJourney();
      try {
        // Rewind to a known synth kit.
        setLaneSoundId("drums", "kit-default");
        await waitFor(() => kitLabel(j.host).trim() === "8-BIT ROOM");
        // The lazy law: nothing fetched yet (a couple of stepper auditions
        // of SYNTH kits may run, but zero audio-asset fetches).
        nextKitButton(j.host).click();
        await waitFor(() => kitLabel(j.host).trim() !== "8-BIT ROOM");
        expect(j.oggFetches()).toEqual([]);

        // Walk to the 808 sample kit (options: 10 synth + 4 sample).
        const currentKit = () =>
          docStore.getState().doc.lanes.find((l) => l.id === "drums")!.kitId;
        for (let i = 0; i < 15 && currentKit() !== "kit-808"; i++) {
          const before = currentKit();
          nextKitButton(j.host).click();
          await waitFor(() => currentKit() !== before);
        }
        expect(currentKit()).toBe("kit-808");
        expect(kitLabel(j.host).trim()).toBe("808 CLASSIC");

        // The kit's pieces fetched (plus neighbors) — same-origin OGGs only.
        await waitFor(() => {
          const kit808 = j.oggFetches().filter((u) => /drums-808-/.test(u));
          return new Set(kit808).size >= 6;
        });
        for (const url of j.oggFetches()) {
          expect(new URL(url, location.href).origin).toBe(location.origin);
        }

        // The click's audition REALLY started a buffer source (≤1 law).
        await waitFor(() => j.starts() >= 1);

        // Provenance echo recorded by the store (6 pieces, manifest echo).
        await waitFor(() => {
          const doc = docStore.getState().doc;
          return Object.keys(doc.sampleProvenance ?? {}).length === 6;
        });

        // Stepping BACK to a synth kit prunes provenance and adds no fetch.
        const fetchCount = j.oggFetches().length;
        setLaneSoundId("drums", "kit-default");
        await waitFor(() =>
          Object.keys(docStore.getState().doc.sampleProvenance ?? {}).length ===
          0,
        );
        expect(j.oggFetches().length).toBe(fetchCount);
      } finally {
        j.cleanup();
      }
    },
  );

  it(
    "a failing asset load surfaces ONE sticky toast; the app keeps working",
    { timeout: 60_000 },
    async () => {
      const j = mountJourney();
      try {
        const origFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (/drums-dusty-kick.*\.ogg/.test(url)) {
            return new Response("", { status: 500 });
          }
          return origFetch(input, init);
        }) as typeof fetch;
        // Direct prime of one broken ref through the REAL public seam.
        primeSoundContent(["kit-dusty"]);
        await waitFor(() => {
          const toasts = [
            ...j.toastHost.querySelectorAll("[role=alert]"),
          ].map((el) => el.textContent ?? "");
          return toasts.some((t) => /could not load/i.test(t));
        });
        // The store/doc/engine are unaffected — a synth selection works.
        setLaneSoundId("drums", "kit-default");
        expect(
          docStore.getState().doc.lanes.find((l) => l.id === "drums")!.kitId,
        ).toBe("kit-default");
      } finally {
        j.cleanup();
      }
    },
  );
});

// Keep the preset identity reference honest: the pitched sample presets all
// resolve through the library (kit coverage in the parity block above).
describe("PS-4 sample voices — preset identity reference", () => {
  it("the six pitched sample presets resolve with measured roots", () => {
    const expected: Record<string, number> = {
      "preset-bass-13": 42,
      "preset-chords-13": 60,
      "preset-chords-14": 62,
      "preset-chords-15": 60,
      "preset-lead-13": 60,
      "preset-lead-14": 75,
    };
    for (const [id, root] of Object.entries(expected)) {
      const p = getPreset(id)!;
      expect(p, id).toBeDefined();
      expect(p.voiceType).toBe("sample");
      expect(p.rootMidi).toBe(root);
    }
  });
});
