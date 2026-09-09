/**
 * VZ-IM-5 browser gate — the canvas FINGERPRINT (determinism probe) on the
 * canary trio + the REAL built bundle (plan.md §"VZ-IM-5" acceptance):
 *
 * 1. SAME SEED ⇒ IDENTICAL canvas fingerprint across two boots — both at
 *    the in-page idiom (two independent engine lifecycles rendering the
 *    same (preset, seed) rig with the same injected clock: byte-equal
 *    region signatures, rest AND lit frames) and on the BUILT bundle (two
 *    full app boots: VizPage's fixed first-boot deal renders byte-equal
 *    pixels — the render-fingerprint precedent, canvas side).
 * 2. DIFFERENT SEED ⇒ DIFFERENT fingerprint (reroll re-deals the rig).
 * 3. FOUR LANE HUES as four DISTINCT sampled colors (first-light: each
 *    lane-bound bloom ignites in its own tokens.css hue; nearest-hue
 *    classification of each anchor region at peak, plus pairwise-distinct
 *    signatures).
 * 4. THE RIG IS THE LIGHT (built bundle): idle VIZ shows the static lit
 *    rest rig (anchor regions differ from ground; consecutive frames are
 *    byte-identical — the calm law's still diagram), play drives canvas
 *    activity at every lane's anchor, and after STOP the stage settles
 *    back to zero pixel changes (one-shots die, nothing pulses forever).
 *
 * Cost law (the plan's getImageData risk note): every fingerprint samples
 * FIXED SMALL regions only (8×8 backing px each, ≤ 6 regions per frame).
 *
 * In-page idiom (viz-mount precedent): product modules imported directly,
 * tokens loaded via base.css exactly as deployed; the engine's every DOM
 * effect (hues read once, sprite baking at dpr 1) exercised for real in
 * Chromium's rasterizer — the same class the CI gates run on.
 */

import { describe, expect, it } from "vitest";
import {
  bootVizApp,
  sleep,
  vizHarnessLog,
  type CanvasRegionSpec,
} from "./viz-harness";
import {
  generateArrangement,
  VIZ_CANARY_PRESET_IDS,
  VIZ_PRESETS,
} from "../../src/viz/presets";
import {
  anchorOf,
  createVizNodeEngine,
  degToUnitVector,
  defaultBootArrangement,
  orbitBodyForPitch,
  orbitBodyPoint,
  sparkFanAngles,
  stageOf,
} from "../../src/viz/nodes";
import { LANE_IDS, type LaneId } from "../../src/document/schema";
// Token base exactly as deployed (the viz-mount precedent): without it
// every var(--color-*) invalidates and the engine's token reads come back
// empty — hues would skip and the fingerprint would be ground-only.
import "../../src/styles/base.css";

const CANVAS_W = 800;
const CANVAS_H = 600;
const REGION_SIZE = 8;
/** The pitches that land at each lane window's CENTER (p = 0.5). */
const MID_PITCH: Record<LaneId, number> = {
  drums: 82,
  bass: 48,
  chords: 60,
  lead: 72,
};

type Signature = number[] | null;

/** Byte signature of one small region of a 2d context. */
function regionSignature(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
): Signature {
  const x = Math.round(fx * CANVAS_W) - (REGION_SIZE >> 1);
  const y = Math.round(fy * CANVAS_H) - (REGION_SIZE >> 1);
  return Array.from(
    ctx.getImageData(x, y, REGION_SIZE, REGION_SIZE).data,
  );
}

function signaturesEqual(a: Signature, b: Signature): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function tokenRgb(name: string): [number, number, number] {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`token ${name} is not #rrggbb: "${v}"`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  const dr = a[0]! - b[0]!;
  const dg = a[1]! - b[1]!;
  const db = a[2]! - b[2]!;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** A named canvas sample point (fraction of the 800×600 page canvas). */
interface SamplePoint {
  readonly name: string;
  readonly fx: number;
  readonly fy: number;
}

/** The beats value the lit frame renders at (kept in ONE place). */
const LIT_BEATS = 4.25;
/** The lit frame's ignition birth + read instants (audio-clock seconds). */
const LIT_BIRTH = 10;
const LIT_NOW = 10.08;

/**
 * The sample points for a rig (product math, one truth): each node's
 * anchor, plus orbit REST bodies (phase-only) and orbit LIT bodies (at the
 * lit frame's beats — ignitions land where the revolution has carried the
 * body, which is exactly where a fixed anchor sample would miss them).
 */
function rigSamplePoints(
  arrangement: ReturnType<typeof generateArrangement>,
): SamplePoint[] {
  const stage = stageOf(CANVAS_W, CANVAS_H);
  const points: SamplePoint[] = [
    { name: "ground", fx: 0.03, fy: 0.03 },
  ];
  arrangement.nodes.forEach((node, i) => {
    const anchor = anchorOf(node, stage);
    points.push({
      name: `anchor${i}`,
      fx: anchor.x / CANVAS_W,
      fy: anchor.y / CANVAS_H,
    });
    if (node.kind === "orbit") {
      const rest = orbitBodyPoint(node, 0, 0, stage);
      points.push({
        name: `orbitRest${i}`,
        fx: rest.x / CANVAS_W,
        fy: rest.y / CANVAS_H,
      });
      // The pitch-selected body at the lit frame's beats (MID_PITCH maps
      // to the window center → p = 0.5).
      const live = orbitBodyPoint(
        node,
        orbitBodyForPitch(node, 0.5),
        LIT_BEATS,
        stage,
      );
      points.push({
        name: `orbitLive${i}`,
        fx: live.x / CANVAS_W,
        fy: live.y / CANVAS_H,
      });
    }
    if (node.kind === "spark") {
      // Shard heads at the lit instant: shards FLY outward from the
      // anchor (their corridor never crosses it), so the head of shard 0
      // is the deterministic sample point for the burst.
      const angles = sparkFanAngles(node, 0.5);
      const reach = Number(node.params.reach ?? 0.2);
      const decay = Number(node.params.decay ?? 0.18);
      const u = Math.min(1, (LIT_NOW - LIT_BIRTH) / decay);
      const dir = degToUnitVector(angles[0]!);
      points.push({
        name: `sparkHead${i}`,
        fx: (anchor.x + dir.x * reach * u * stage.unit) / CANVAS_W,
        fy: (anchor.y + dir.y * reach * u * stage.unit) / CANVAS_H,
      });
    }
  });
  return points;
}

/** Render one frame of a rig into a fresh page canvas → point signatures. */
function renderRig(
  arrangement: ReturnType<typeof generateArrangement>,
  lit: boolean,
  points: SamplePoint[] = rigSamplePoints(arrangement),
): Record<string, Signature> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("no 2d context");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const ground = tokenRgb("--color-ground");
  ctx.fillStyle = `rgb(${ground[0]},${ground[1]},${ground[2]})`;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const engine = createVizNodeEngine({
    arrangement,
    dpr: 1, // the page canvas is 1:1 — deterministic blits at unit scale
  });
  if (lit) {
    for (const lane of LANE_IDS) {
      engine.ignite({
        lane,
        pitch: MID_PITCH[lane],
        velocity: 1,
        audibleAt: LIT_BIRTH,
      });
    }
    engine.onFrame(
      ctx,
      { index: 0, width: CANVAS_W, height: CANVAS_H, dpr: 1, time: 0 },
      LIT_NOW, // just past peak: bright, mid-envelope
      LIT_BEATS,
    );
  } else {
    engine.onFrame(
      ctx,
      { index: 0, width: CANVAS_W, height: CANVAS_H, dpr: 1, time: 0 },
      Number.NaN, // no audio clock: the static rest rig only
      Number.NaN,
    );
  }
  engine.dispose();
  const out: Record<string, Signature> = {};
  for (const point of points) {
    out[point.name] = regionSignature(ctx, point.fx, point.fy);
  }
  return out;
}

describe("VZ-IM-5 canvas fingerprint — seeded determinism (canary trio, in-page)", () => {
  const SEED_A = 20260904;
  const SEED_B = 987654321;

  it.each(VIZ_CANARY_PRESET_IDS)(
    "%s: same seed ⇒ byte-identical fingerprint across two engines (rest + lit)",
    (presetId) => {
      const preset = VIZ_PRESETS.find((p) => p.id === presetId)!;
      const rest = renderRig(generateArrangement(preset, SEED_A), false);
      const lit = renderRig(generateArrangement(preset, SEED_A), true);
      for (const frame of [
        ["rest", rest] as const,
        ["lit", lit] as const,
      ]) {
        const [label, boot1] = frame;
        const boot2 = renderRig(generateArrangement(preset, SEED_A), label === "lit");
        for (const key of Object.keys(boot1)) {
          expect(
            signaturesEqual(boot1[key], boot2[key]),
            `${presetId} ${label} region ${key} differs across boots`,
          ).toBe(true);
        }
      }
      // And the lit frame genuinely IGNITES (differs from rest somewhere
      // besides the ground corner — the rig reacts, not just re-renders).
      const ignited = Object.keys(rest).some(
        (k) => k !== "ground" && !signaturesEqual(rest[k], lit[k]),
      );
      expect(ignited, `${presetId} must visibly ignite`).toBe(true);
    },
  );

  it.each(VIZ_CANARY_PRESET_IDS)(
    "%s: different seed ⇒ different fingerprint (reroll re-deals)",
    (presetId) => {
      const preset = VIZ_PRESETS.find((p) => p.id === presetId)!;
      const rigA = generateArrangement(preset, SEED_A);
      const rigB = generateArrangement(preset, SEED_B);
      // Sample the UNION of both rigs' points against BOTH renders: the
      // points are FIXED once named, so a re-dealt rig reads differently
      // wherever its light actually moved (a per-rig point set alone would
      // follow the rig and compare equal trivially).
      const points = [
        ...rigSamplePoints(rigA).map((p) => ({ ...p, name: `A:${p.name}` })),
        ...rigSamplePoints(rigB).map((p) => ({ ...p, name: `B:${p.name}` })),
      ];
      const restA = renderRig(rigA, false, points);
      const restB = renderRig(rigB, false, points);
      const differsRest = Object.keys(restA).some(
        (k) => !signaturesEqual(restA[k], restB[k]),
      );
      const litA = renderRig(rigA, true, points);
      const litB = renderRig(rigB, true, points);
      const differsLit = Object.keys(litA).some(
        (k) => !signaturesEqual(litA[k], litB[k]),
      );
      vizHarnessLog("im5-fingerprint", {
        preset: presetId,
        differsRest,
        differsLit,
      });
      expect(differsRest || differsLit).toBe(true);
    },
  );

  it("first-light: the four lane hues appear as four DISTINCT sampled colors", () => {
    const preset = VIZ_PRESETS.find((p) => p.id === "first-light")!;
    const rig = generateArrangement(preset, SEED_A);
    const lit = renderRig(rig, true);
    const rest = renderRig(rig, false);
    const hueRgb: Record<string, [number, number, number]> = {};
    for (const lane of LANE_IDS)
      hueRgb[lane] = tokenRgb(`--color-lane-${lane}`);
    const sampled: Record<string, number[]> = {};
    for (const lane of LANE_IDS) {
      // The lane's own bloom anchor (first-light binds one bloom per lane;
      // rigRegions sampled it as anchor<nodeIndex>).
      const nodeIndex = rig.nodes.findIndex((n) => n.placement.lane === lane);
      expect(nodeIndex, `first-light must bind a node to ${lane}`).toBeGreaterThanOrEqual(0);
      const sig = lit[`anchor${nodeIndex}`]!;
      // The ignition visibly lit this anchor above its own resting state.
      expect(
        JSON.stringify(sig) !== JSON.stringify(rest[`anchor${nodeIndex}`]),
        `${lane} anchor must ignite above its rest mark`,
      ).toBe(true);
      // Nearest lane hue by RGB distance = the node's own binding lane.
      const px: [number, number, number] = [sig[0]!, sig[1]!, sig[2]!];
      const nearest = LANE_IDS.reduce((best, candidate) =>
        rgbDistance(px, hueRgb[candidate]!) < rgbDistance(px, hueRgb[best]!)
          ? candidate
          : best,
      );
      expect(nearest, `${lane} anchor reads as ${nearest}`).toBe(lane);
      sampled[lane] = sig;
    }
    // FOUR DISTINCT sampled colors: pairwise-different signatures.
    for (const a of LANE_IDS) {
      for (const b of LANE_IDS) {
        if (a === b) continue;
        expect(
          JSON.stringify(sampled[a]) !== JSON.stringify(sampled[b]),
          `${a} and ${b} anchors must sample distinctly`,
        ).toBe(true);
      }
    }
  });
});

describe("VZ-IM-5 built-bundle gate — the real wiring (default rig)", () => {
  it(
    "two boots render identical idle fingerprints; play drives activity; stop settles",
    { timeout: 240_000 },
    async () => {
      // Rig regions for the page's own default deal (1280×960 harness box).
      const rig = defaultBootArrangement();
      const stage = stageOf(1280, 960);
      const regions: CanvasRegionSpec[] = [
        { name: "ground", fx: 0.03, fy: 0.03, size: REGION_SIZE },
        { name: "center", fx: 0.5, fy: 0.5, size: REGION_SIZE },
      ];
      for (const lane of LANE_IDS) {
        const node = rig.nodes.find((n) => n.placement.lane === lane)!;
        const anchor = anchorOf(node, stage);
        regions.push({
          name: lane,
          fx: anchor.x / 1280,
          fy: anchor.y / 960,
          size: REGION_SIZE,
        });
      }

      const fingerprints: Record<string, number[] | null>[] = [];
      for (let boot = 0; boot < 2; boot++) {
        const h = await bootVizApp();
        try {
          await h.openViz();
          // Idle: static + lit — two reads a few frames apart are identical
          // (the still diagram), and anchors differ from the ground corner.
          await sleep(250);
          const read1 = h.readCanvasRegions(regions);
          await sleep(250);
          const read2 = h.readCanvasRegions(regions);
          for (const region of regions) {
            expect(
              JSON.stringify(read1[region.name]) ===
                JSON.stringify(read2[region.name]),
              `boot ${boot}: idle region ${region.name} must be static`,
            ).toBe(true);
          }
          for (const lane of LANE_IDS) {
            expect(
              JSON.stringify(read1[lane]) !==
                JSON.stringify(read1.ground),
              `boot ${boot}: lane ${lane} anchor must be lit above ground`,
            ).toBe(true);
          }
          fingerprints.push(read1);

          if (boot === 0) {
            // Play: every lane's anchor sees canvas activity (the rig fires).
            const anchor = await h.play();
            void anchor;
            const activity = await h.sampleCanvasActivity({
              durationMs: 2500,
              regions: regions.filter((r) => r.name !== "ground"),
            });
            for (const lane of LANE_IDS) {
              expect(
                activity.regionChangeCounts[lane],
                `lane ${lane} anchor must react while playing`,
              ).toBeGreaterThan(0);
            }
            // Stop + settle: one-shots die (≤ 0.4 s windows), the stage
            // returns to the still diagram — ZERO changes after settling.
            await h.stop();
            await sleep(800);
            const canvasBefore = h.canvas();
            const settled = await h.sampleCanvasActivity({
              durationMs: 500,
              regions: regions.filter((r) => r.name !== "ground"),
            });
            vizHarnessLog("im5-settled", {
              changes: settled.changes.map((c) => ({
                t: Math.round(c.t),
                regions: c.regions,
                audio: c.audio,
              })),
              counts: settled.regionChangeCounts,
              backing: [
                canvasBefore.width,
                canvasBefore.height,
                h.canvas().width,
                h.canvas().height,
              ],
            });
            // One-shot windows (≤ 0.4 s) died inside the settle sleep; the
            // stage must be pixel-still. Tolerance for EXACTLY ONE single-
            // instant change touching several regions at once: that is the
            // environmental one-frame repaint class (layout/scrollbar → RO
            // → integer backing swap redraws everything once) — engine
            // motion would be per-lane and recurring, never simultaneous-
            // and-once. Logged loudly either way; a SECOND confirmation
            // window must then be absolutely still.
            expect(
              settled.changes.length,
              "stopped transport must settle (at most one transient repaint)",
            ).toBeLessThanOrEqual(1);
            if (settled.changes.length > 0) {
              const confirm = await h.sampleCanvasActivity({
                durationMs: 300,
                regions: regions.filter((r) => r.name !== "ground"),
              });
              expect(
                confirm.changes,
                "the transient must be a one-off repaint, not motion",
              ).toHaveLength(0);
            }
          }
        } finally {
          await h.teardown();
        }
      }

      // TWO BOOTS, ONE FINGERPRINT (the same-seed law on the built bundle).
      for (const region of regions) {
        expect(
          JSON.stringify(fingerprints[0]![region.name]) ===
            JSON.stringify(fingerprints[1]![region.name]),
          `region ${region.name} fingerprint differs across boots`,
        ).toBe(true);
      }
      vizHarnessLog("im5-bundle-fingerprint", {
        regions: regions.map((r) => r.name),
        verdict: "identical across two boots",
      });
    },
  );
});
