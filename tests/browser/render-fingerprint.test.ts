/**
 * HW-2 — render fingerprint canary (D8 / RES-7).
 *
 * A SHA-256 fingerprint of the REFERENCE project's offline render (full-FX:
 * exercise every device + the tail fold) is stored in
 * tests/golden/manifest.json under `render/reference-loop-fp-v1`.
 *
 * THE HASH IS ENVIRONMENT-PINNED. RES-7 records that cross-platform /
 * cross-engine render hashes are NOT stable (SIMD/libm paths differ); the
 * only meaningful comparison is against the same pinned Chromium delivered
 * by the playwright version recorded in the manifest entry's `renderEnv`.
 *
 * Semantics (deliberately soft — a canary, not a lock):
 * - The test ALWAYS passes when the tolerance checks pass (finite audio,
 *   sane peak, exact loop length at 44100).
 * - If the hash differs from the manifest (or the entry is missing), a loud
 *   "RENDER FINGERPRINT DRIFT" warning is printed to the console — meaning
 *   something changed the render output (engine code, browser build, or an
 *   unintentional dependency bump). If the change is deliberate, regenerate
 *   with: npm run goldens:update
 * - Regeneration: the test emits a `RENDER_FINGERPRINT_RECORD <json>` line
 *   consumed by the node-side onConsoleLog hook (tests/golden/
 *   render-fp-recorder.ts, wired in vite.config.ts) which writes the
 *   manifest ONLY under UPDATE_GOLDENS=1. CI never regenerates.
 */

import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../../src/document/schema";
import type { ProjectDocument } from "../../src/document/schema";
import {
  renderProjectToBuffer,
  EXPORT_SAMPLE_RATE,
} from "../../src/audio/render";
import { assertCleanAudio, hashChannelsHex } from "./helpers";
import { RENDER_FP_PREFIX, RENDER_FP_GOLDEN_NAME } from "../golden/render-fp-protocol";

const GOLDEN_NAME = RENDER_FP_GOLDEN_NAME;

/** Reference project: default content + drums drive/crush + lead delay+reverb. */
function referenceProject(): ProjectDocument {
  const doc = createDefaultProject();
  const drums = doc.patterns.drums[0];
  drums.steps.kick = [true, ...new Array(15).fill(false)];
  for (const s of [4, 8, 12]) drums.steps.kick[s] = true;
  const lead = doc.patterns.lead[0];
  lead.rows[3].steps[0] = 1;
  doc.lanes.find((l) => l.id === "drums")!.fxChain = [
    { type: "drive", bypassed: false, params: { amount: 0.35 } },
    { type: "bitcrusher", bypassed: false, params: { bits: 8, downsample: 2 } },
  ];
  doc.lanes.find((l) => l.id === "lead")!.fxChain = [
    { type: "delay", bypassed: false, params: { timeSteps: 2, feedback: 0.4, mix: 0.4 } },
    { type: "reverb", bypassed: false, params: { size: 0.4, mix: 0.35 } },
  ];
  return doc;
}

interface GoldenEntryLike {
  sha256?: string;
  byteLength?: number;
  renderEnv?: { playwright?: string; chromium?: string };
}

async function loadManifestEntry(): Promise<GoldenEntryLike | undefined> {
  const manifest = (await import("../golden/manifest.json")).default as {
    goldens?: Record<string, GoldenEntryLike>;
  };
  return manifest.goldens?.[GOLDEN_NAME];
}

describe("HW-2 render fingerprint canary (soft — never blocks)", () => {
  it("reference render passes tolerance checks; hash drift only warns", { timeout: 90000 }, async () => {
    const result = await renderProjectToBuffer(referenceProject());

    // --- Hard tolerance checks (these DO fail the test) ---
    expect(result.sampleRate).toBe(EXPORT_SAMPLE_RATE);
    // 1 bar @120 BPM = exactly 88200 samples (integer bars×beats law).
    expect(result.loopSamples).toBe(1 * 4 * ((44100 * 60) / 120));
    expect(result.tailSamples).toBeGreaterThan(0); // delay + reverb tails
    expect(result.channels).toHaveLength(2);
    for (const ch of result.channels) expect(ch).toHaveLength(result.loopSamples);
    const peak = assertCleanAudio(result.channels, "reference render");
    expect(peak).toBeGreaterThan(0.05); // audibly non-trivial content
    expect(peak).toBeLessThanOrEqual(4); // sane master sum (0.9 master gain)

    // --- Fingerprint canary (soft: warning only, by design) ---
    const hash = await hashChannelsHex(result.channels);
    const byteLength =
      result.channels.reduce((n, ch) => n + ch.byteLength, 0);
    const entry = await loadManifestEntry();

    // Always offer the current fingerprint to the node-side recorder; it
    // only writes under UPDATE_GOLDENS=1 (npm run goldens:update).
    console.log(
      RENDER_FP_PREFIX +
        JSON.stringify({
          name: GOLDEN_NAME,
          sha256: hash,
          byteLength,
          sampleRate: result.sampleRate,
          loopSamples: result.loopSamples,
        }),
    );

    if (!entry?.sha256) {
       
      console.warn(
        `[render-fingerprint] no manifest entry for '${GOLDEN_NAME}' — seed it with: npm run goldens:update`,
      );
    } else if (entry.sha256 !== hash) {
       
      console.warn(
        `[render-fingerprint] RENDER FINGERPRINT DRIFT on '${GOLDEN_NAME}': ` +
          `manifest ${entry.sha256} (playwright env: ${entry.renderEnv?.playwright ?? "?"}, ` +
          `${entry.renderEnv?.chromium ?? "?"}) vs current ${hash}. ` +
          `This is NOT a failure — the hash is environment-pinned (pinned Chromium via ` +
          `playwright; not comparable across engines/platforms). ` +
          `If the change is deliberate, regenerate: npm run goldens:update`,
      );
    } else {
      // Match: record the healthy state for the run log.
       
      console.log(
        `[render-fingerprint] '${GOLDEN_NAME}' matches manifest (${hash.slice(0, 12)}…)`,
      );
    }
    expect(true).toBe(true); // canary never blocks
  });
});
