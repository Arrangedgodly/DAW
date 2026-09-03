/**
 * PS-4 — the PS-3 sampleProvenance store writer. Selecting a sample-backed
 * sound records the asset's manifest echo into the document (self-describing
 * exports); moving off it prunes the map back to canonical-empty; undo
 * self-heals through the same pass. Repair commits NEVER add undo steps —
 * the map is derived metadata, not an edit.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUndo,
  docStore,
  setLaneSoundId,
  undo,
} from "../src/state/store";
import { CONTENT_ASSETS } from "../src/assets/content/loader";
import { SAMPLE_KIT_IDS } from "../src/audio/presets";

function doc() {
  return docStore.getState().doc;
}

function historyLength(): number {
  return docStore.temporal.getState().pastStates.length;
}

beforeEach(() => {
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
  // Land the drums lane on a synth kit so each test starts canonical-empty.
  setLaneSoundId("drums", "kit-default");
  while (canUndo()) undo();
  docStore.temporal.getState().clear();
});

describe("PS-4 sample provenance maintenance", () => {
  it("selecting a sample kit records the manifest echo verbatim for its 6 pieces", async () => {
    setLaneSoundId("drums", "kit-808");
    await vi.waitFor(() => {
      expect(doc().sampleProvenance).toBeDefined();
    });
    const map = doc().sampleProvenance!;
    expect(Object.keys(map).sort()).toEqual(
      ["clap", "hat", "kick", "openhat", "snare", "tom"]
        .map((piece) => `drums.808.${piece}`)
        .sort(),
    );
    for (const [ref, entry] of Object.entries(map)) {
      const asset = CONTENT_ASSETS.find((a) => a.id === ref)!;
      expect(asset, ref).toBeDefined();
      expect(entry).toEqual({
        license: asset.license,
        sourceUrl: asset.sourceUrl,
        author: asset.author,
      });
    }
  });

  it("selecting a pitched sample preset records its single voice asset", async () => {
    setLaneSoundId("lead", "preset-lead-13");
    await vi.waitFor(() => {
      expect(doc().sampleProvenance?.["voice.lead.phaserup"]).toBeDefined();
    });
    const entry = doc().sampleProvenance!["voice.lead.phaserup"]!;
    const asset = CONTENT_ASSETS.find((a) => a.id === "voice.lead.phaserup")!;
    expect(entry).toEqual({
      license: asset.license,
      sourceUrl: asset.sourceUrl,
      author: asset.author,
    });
  });

  it("repair commits add no undo steps (derived metadata, not edits)", async () => {
    const before = historyLength();
    setLaneSoundId("drums", "kit-dusty");
    const afterSelection = historyLength();
    expect(afterSelection).toBe(before + 1);
    await vi.waitFor(() => {
      expect(doc().sampleProvenance).toBeDefined();
    });
    expect(historyLength()).toBe(afterSelection);
  });

  it("moving off a sample sound prunes the map to canonical-empty (field absent)", async () => {
    setLaneSoundId("drums", "kit-punch");
    await vi.waitFor(() => {
      expect(doc().sampleProvenance).toBeDefined();
    });
    setLaneSoundId("drums", "kit-default");
    await vi.waitFor(() => {
      expect(doc().sampleProvenance).toBeUndefined();
    });
    expect("sampleProvenance" in doc()).toBe(false);
  });

  it("undo self-heals: reverting a sample selection prunes the echo", async () => {
    setLaneSoundId("drums", "kit-acoustic");
    await vi.waitFor(() => {
      expect(doc().sampleProvenance).toBeDefined();
    });
    undo();
    expect(doc().lanes.find((l) => l.id === "drums")!.kitId).toBe(
      "kit-default",
    );
    await vi.waitFor(() => {
      expect(doc().sampleProvenance).toBeUndefined();
    });
  });

  it("every sample kit selection converges (all four committed kits)", async () => {
    for (const kitId of SAMPLE_KIT_IDS) {
      setLaneSoundId("drums", kitId);
      await vi.waitFor(() => {
        expect(Object.keys(doc().sampleProvenance ?? {})).toHaveLength(6);
      });
    }
  });
});
