/**
 * VZ-TH-2 browser gate — the THIN PATH timing probe on the BUILT bundle
 * (plan.md §"VZ-TH-2", the M1 exit): the first canvas reaction for a hit
 * lands within one frame (≤ ~17 ms) AFTER its audible time, never before,
 * probed against TRANSPORT-DERIVED audible times over the demo's opening
 * bars. This is THE test of the run's schedule-vs-audible assumption
 * (Strange contingency 1 tripwire: > 1 frame skew ⇒ stop and re-plan).
 *
 * Method (all quantities in the AUDIO-clock domain — no wall-clock flake):
 * - bootVizApp (VZ-HW-2): the real hashed bundle in a fresh iframe, wiped
 *   IDB ⇒ the deterministic first-run demo; openViz; then start the rAF
 *   canvas-activity sampler BEFORE play so the pre-first-hit window (events
 *   already delivered at schedule time, held by the offset queue) is under
 *   observation — a schedule-time leak would flash there and fail Law A.
 * - play() returns the PlayAnchor bracket for `timelineStart`;
 *   globalStepAudibleTime() derives each global step's audible window.
 * - The demo's note-carrying steps per lane come from the app's OWN
 *   scheduling authority (compileLaneSchedule + resolveChainPatterns,
 *   src/audio/song.ts — the same pure path engineBridge compiles through,
 *   replicated with the same fallbacks), so the hit grid is the engine's,
 *   not a restatement.
 * - Lane attribution (VZ-IM-5 inheritance): the placeholder band flash is
 *   retired — hits ignite the RIG now (src/viz/nodes.ts, fed through the
 *   pipeline's onDueHits seam), so one small sampled region sits at each
 *   lane-bound node's anchor of the page's deterministic default deal
 *   (defaultBootArrangement: fixed preset + seed — the same source of
 *   truth VizPage renders). The First Light rig binds one bloom per lane,
 *   so each region attributes pixel changes to that lane's hits only (the
 *   bloom radius comfortably covers the pitch-displaced ignition point).
 *
 * Laws asserted:
 * A. NEVER EARLY (strict, every change): each region change at audio time
 *    A follows at least one hit of that lane whose audible window's UPPER
 *    bound is ≤ A — provably not before the audible time whichever side of
 *    the anchor bracket the truth sits on. This also covers "no reaction
 *    fires while merely scheduled" (the queue holds the scheduler's ~1.5 s
 *    lead-up: the whole pre-first-hit span must stay pixel-silent).
 * B. ONE FRAME (statistically honest under CI frame jitter, the
 *    frame-budget ≥95% law's convention): per hit, the first change at/after
 *    its audible window ⇒ latency A − hi; p50 ≤ 17 ms (one frame @ 60 Hz)
 *    and max ≤ 50 ms (two long frames). The byte-diff probe cannot always
 *    distinguish a hit's ignition from the previous hit's final decay tick
 *    when same-lane gaps approach the 100 ms decay — that ambiguity only
 *    ever UNDERREPORTS latency, so the ceilings stay conservative.
 * C. LANE HUE (House Lights): at an ignition frame each lane's region
 *    reads closer to its tokens.css lane hue than to the ground, at a
 *    brightness consistent with the compiled event level (adaptive
 *    threshold, tokens read from the iframe's own computed styles).
 * D. STOP: after STOP (+ decay settle), a sampled window shows ZERO canvas
 *    changes — the queue is cleared (unit-proven mechanism), no new
 *    reactions fire post-stop. Idle-before-play shows zero changes too.
 */

import { describe, expect, it } from "vitest";
import {
  bootVizApp,
  globalStepAudibleTime,
  sleep,
  vizHarnessLog,
  type CanvasRegionSpec,
  type PlayAnchor,
  type VizTransportFacts,
} from "./viz-harness";
import {
  compileLaneSchedule,
  resolveChainPatterns,
} from "../../src/audio/song";
import { getDrumKit, getPreset } from "../../src/audio/presets";
import { effectiveScale } from "../../src/document/scales";
import { createDemoProject } from "../../src/document/demoSong";
import { LANE_IDS, type LaneId } from "../../src/document/schema";
import { anchorOf, defaultBootArrangement, stageOf } from "../../src/viz/nodes";

/** One frame at 60 Hz in audio-clock seconds (the law's budget). */
const ONE_FRAME_SECONDS = 17 / 1000;
/** Hard ceiling: two long CI frames (frame-budget convention slack). */
const MAX_LATENCY_SECONDS = 50 / 1000;
/**
 * First-play bring-up, audio-clock seconds from timelineStart, excluded
 * from the one-frame/coverage laws (LOGGED, never silent): the engine's
 * voice-engine/worklet boot chains note delivery behind
 * `ensureVoiceEvents().then(...)` (src/engine/session.ts deliverLaneEvents)
 * and the iframe's main thread stalls compiling it — taps for steps inside
 * this window can arrive after their audible time (stale-dropped ⇒ a
 * boot-window "miss") and the sampler's own rAF callback can stall (the
 * first run measured one 537 ms sample gap there, with p50 = 7 ms
 * everywhere else). This is ENGINE bring-up, not viz timing; the viz must
 * (and does) reflect exactly what the audio did. Law A (never early) keeps
 * the FULL span — no change may ever precede a hit's audible time.
 */
const BOOT_SKIP_SECONDS = 1.2;
/** Lane-region sample size (backing px, the harness default class). */
const REGION_SIZE = 8;

/** Per-lane compiled hit facts for the demo (the engine's own authority). */
interface LaneHitFacts {
  readonly chainSteps: number;
  readonly steps: ReadonlySet<number>;
  /** Max event level (velocity) over the first pass — the hue threshold. */
  readonly maxLevel: number;
}

/**
 * Compile the demo's per-lane hit facts exactly the way engineBridge's
 * laneScheduleFor does (same inputs, same fallbacks — src/state/
 * engineBridge.ts): WHICH chain-local steps carry note-ons, plus the max
 * compiled level used for the adaptive hue threshold.
 */
function demoLaneHitFacts(): Record<LaneId, LaneHitFacts> {
  const doc = createDemoProject();
  const groove = {
    bpm: doc.transport.bpm,
    swing: doc.transport.swing,
  };
  const out = {} as Record<LaneId, LaneHitFacts>;
  for (const lane of LANE_IDS) {
    const laneConf = doc.lanes.find((l) => l.id === lane)!;
    const schedule = compileLaneSchedule({
      chain: resolveChainPatterns(doc, lane),
      preset:
        lane === "drums"
          ? (getDrumKit((laneConf as { kitId: string }).kitId) ??
            getDrumKit("kit-default")!)
          : (getPreset((laneConf as { presetId: string }).presetId) ??
            getPreset("preset-lead-1")!),
      gate: laneConf.gate,
      groove,
      ...(lane === "drums"
        ? {}
        : {
            scale: effectiveScale(doc, lane),
            stackChord: lane === "chords",
          }),
    });
    const steps = new Set<number>();
    let maxLevel = 0;
    for (const [step, events] of schedule.byStep) {
      steps.add(step);
      for (const e of events)
        if (Number.isFinite(e.level)) maxLevel = Math.max(maxLevel, e.level);
    }
    out[lane] = { chainSteps: schedule.chainSteps, steps, maxLevel };
  }
  return out;
}

/** A lane hit with its bracketed transport-derived audible window. */
interface HitWindow {
  readonly lane: LaneId;
  readonly globalStep: number;
  readonly lo: number;
  readonly hi: number;
}

/** All lane hits whose audible window falls inside [spanLo, spanHi]. */
function hitsInSpan(
  factsMap: Record<LaneId, LaneHitFacts>,
  transport: VizTransportFacts,
  anchor: PlayAnchor,
  spanLo: number,
  spanHi: number,
): HitWindow[] {
  const out: HitWindow[] = [];
  for (let g = 0; ; g++) {
    const { lo, hi } = globalStepAudibleTime(g, transport, anchor);
    if (lo > spanHi) break;
    if (hi >= spanLo) {
      for (const lane of LANE_IDS) {
        const f = factsMap[lane];
        if (f.steps.has(g % f.chainSteps))
          out.push({ lane, globalStep: g, lo, hi });
      }
    }
    if (g > 4096) break; // unreachable guard
  }
  return out;
}

function rgbDistance(a: readonly number[], b: readonly number[]): number {
  const dr = a[0]! - b[0]!;
  const dg = a[1]! - b[1]!;
  const db = a[2]! - b[2]!;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Parse a #rrggbb tokens.css value into rgb. */
function tokenRgb(win: Window, name: string): [number, number, number] {
  const v = win
    .getComputedStyle(win.document.documentElement)
    .getPropertyValue(name)
    .trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`token ${name} is not #rrggbb: "${v}"`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("VZ-TH-2 thin path — tap → offset queue → one-frame lane-hue flash (M1 probe)", () => {
  it(
    "first canvas reaction lands ≤ one frame after audible time, never before; lane-hued; stopped transport stops reactions",
    { timeout: 150_000 },
    async () => {
      // Rig-anchor lane regions (VZ-IM-5): the default deal's per-lane node
      // anchors in the harness's 1280×960 iframe box — the deterministic
      // positions VizPage's engine actually lights.
      const rig = defaultBootArrangement();
      const rigStage = stageOf(1280, 960);
      const laneRegions: CanvasRegionSpec[] = LANE_IDS.map((name) => {
        const node = rig.nodes.find((n) => n.placement.lane === name);
        if (!node) throw new Error(`default rig binds no node to ${name}`);
        const anchor = anchorOf(node, rigStage);
        return {
          name,
          fx: anchor.x / 1280,
          fy: anchor.y / 960,
          size: REGION_SIZE,
        };
      });
      const h = await bootVizApp();
      try {
        // --- 0. The demo's hit grid, from the engine's own compiler -------
        const hitFacts = demoLaneHitFacts();
        for (const lane of LANE_IDS) {
          if (hitFacts[lane].steps.size === 0)
            throw new Error(`demo lane ${lane} compiled to zero hit steps`);
        }

        // --- 1. Open VIZ first: the whole pre-play span is observed -------
        await h.openViz();

        // --- 2. IDLE: transport stopped ⇒ pixel-silent ground -------------
        const idle = await h.sampleCanvasActivity({
          durationMs: 400,
          regions: laneRegions,
        });
        expect(
          idle.changes,
          "idle VIZ (stopped transport) must be pixel-silent",
        ).toHaveLength(0);

        // --- 3. Sample BEFORE play: the merely-scheduled window is on ---
        // --- the record; then the real PLAY through the booth button. -----
        const sampling = h.sampleCanvasActivity({
          durationMs: 5000,
          regions: laneRegions,
        });
        const anchor = await h.play();
        const report = await sampling;

        // The audio-domain observation span (samples pair wall + audio).
        const audioSamples = report.samples.filter((s) => s.audio !== null);
        expect(audioSamples.length).toBeGreaterThan(0);
        const spanStart = audioSamples[0]!.audio!;
        const spanEnd = audioSamples[audioSamples.length - 1]!.audio!;
        // Hits whose ignition or decay could land inside the span.
        const hits = hitsInSpan(
          hitFacts,
          h.facts,
          anchor,
          spanStart - 0.45, // max one-shot window (0.4 s) + settle slack —
          // VZ-IM-5's envelopes reach farther than the old 0.1 s flash, so
          // a hit this far before the span can still change pixels in it.
          spanEnd,
        );
        expect(hits.length).toBeGreaterThan(0);

        // --- 4. Laws A + B per lane ------------------------------------
        // Steady state only for B (boot window skipped, logged); A keeps
        // every change on the full span.
        const bootCutoff = anchor.timelineStartLo + BOOT_SKIP_SECONDS;
        const law: Record<
          string,
          {
            changes: number;
            hits: number;
            early: number;
            missed: number;
            latencies: number[];
            minGapMs: number;
          }
        > = {};
        let anyEarly = false;
        let bootSkipped = 0;
        for (const lane of LANE_IDS) {
          const changes = report.samples
            .filter((s) => s.audio !== null && s.regions.includes(lane))
            .map((s) => s.audio!);
          const laneHits = hits.filter((x) => x.lane === lane);
          // Law A — NEVER EARLY (strict): every change follows a hit whose
          // audible UPPER bound has passed.
          const early = changes.filter(
            (a) => !laneHits.some((x) => a >= x.hi - 1e-9),
          );
          // Law B — first reaction per hit, latency vs the upper bound.
          const latencies: number[] = [];
          let missed = 0;
          for (const x of laneHits) {
            if (x.hi < bootCutoff) {
              bootSkipped++;
              continue;
            }
            const first = changes.find((a) => a >= x.hi - 1e-9);
            if (first === undefined) missed++;
            else latencies.push(first - x.hi);
          }
          const sortedHis = laneHits.map((x) => x.hi).sort((p, q) => p - q);
          let minGapMs = Number.POSITIVE_INFINITY;
          for (let i = 1; i < sortedHis.length; i++)
            minGapMs = Math.min(
              minGapMs,
              (sortedHis[i]! - sortedHis[i - 1]!) * 1000,
            );
          law[lane] = {
            changes: changes.length,
            hits: laneHits.length,
            early: early.length,
            missed,
            latencies,
            minGapMs,
          };
          if (early.length > 0) anyEarly = true;
        }

        const allLatencies = LANE_IDS.flatMap((l) => law[l]!.latencies);
        const sortedLat = [...allLatencies].sort((a, b) => a - b);
        const p50 =
          sortedLat.length > 0
            ? sortedLat[Math.floor(sortedLat.length / 2)]!
            : Number.POSITIVE_INFINITY;
        const maxLat =
          sortedLat.length > 0
            ? sortedLat[sortedLat.length - 1]!
            : Number.NEGATIVE_INFINITY;
        const withinOneFrame = sortedLat.filter(
          (v) => v <= ONE_FRAME_SECONDS,
        ).length;
        const steadyHits = hits.filter((x) => x.hi >= bootCutoff).length;
        const totalMissed = LANE_IDS.reduce((n, l) => n + law[l]!.missed, 0);

        vizHarnessLog("th2-probe", {
          span: [
            +(spanStart - anchor.timelineStartLo).toFixed(3),
            +(spanEnd - anchor.timelineStartLo).toFixed(3),
          ],
          hits: hits.length,
          steadyHits,
          bootSkipped,
          changes: LANE_IDS.map((l) => `${l}:${law[l]!.changes}`).join(" "),
          missed: totalMissed,
          early: anyEarly,
          latencySamples: sortedLat.length,
          p50ms: +(p50 * 1000).toFixed(1),
          maxms: +(maxLat * 1000).toFixed(1),
          latenciesMs: sortedLat.map((v) => +(v * 1000).toFixed(1)),
          perLane: Object.fromEntries(
            LANE_IDS.map((l) => [
              l,
              {
                hits: law[l]!.hits,
                changes: law[l]!.changes,
                missed: law[l]!.missed,
                minGapMs:
                  law[l]!.minGapMs === Number.POSITIVE_INFINITY
                    ? null
                    : +law[l]!.minGapMs.toFixed(1),
              },
            ]),
          ),
        });

        // Law A: NEVER EARLY — hard, every change, every lane, full span.
        expect(
          anyEarly,
          `changes before their hit's audible time: ${JSON.stringify(
            Object.fromEntries(LANE_IDS.map((l) => [l, law[l]!.early])),
          )}`,
        ).toBe(false);

        // Law B: one frame typical (≥90% of steady hits ≤ 17 ms, p50 ≤ 17),
        // hard ceiling for residual CI frame jitter, and coverage — the
        // overwhelming majority of steady hits visibly react.
        expect(sortedLat.length).toBeGreaterThan(0);
        expect(p50, "median first-reaction latency ≤ one frame").toBeLessThan(
          ONE_FRAME_SECONDS,
        );
        expect(
          withinOneFrame / sortedLat.length,
          "≥90% of first reactions within one frame",
        ).toBeGreaterThanOrEqual(0.9);
        expect(
          maxLat,
          "max first-reaction latency ≤ two long frames",
        ).toBeLessThan(MAX_LATENCY_SECONDS);
        expect(
          totalMissed / steadyHits,
          "≥85% of steady hits land a visible reaction",
        ).toBeLessThan(0.15);

        // Transport kept playing under VIZ + reactions the whole span.
        expect(h.playing()).toBe(true);

        // --- 5. Law C — LANE HUE at ignition (tokens are the authority) --
        const groundRgb = tokenRgb(h.win, "--color-ground");
        const hueRgb: Record<string, [number, number, number]> = {};
        const hueBudget: Record<string, number> = {};
        for (const lane of LANE_IDS) {
          hueRgb[lane] = tokenRgb(h.win, `--color-lane-${lane}`);
          // Adaptive: accept a read at ≥60% of the lane's compiled peak
          // level (ratio (1−a)/a at a = 0.6·peak), tolerating 1–2 frames
          // of decay before the read. VZ-IM-5 adaptation: the rig draws
          // RADIAL GLOW sprites whose ignition point pitch-displaces from
          // the sampled anchor and whose alpha rides the one-shot envelope,
          // so a fixed sample's brightness cannot equal the solid-flash
          // peak — cap the required hue fraction at 0.45. The HUE law is
          // unweakened: additive lane-hue light over the near-black ground
          // stays exactly on the ground→hue ray at ANY brightness, so any
          // captured fraction genuinely identifies the lane.
          const peak = Math.min(1, Math.max(0.05, hitFacts[lane].maxLevel));
          const a = Math.min(0.45, 0.6 * peak);
          hueBudget[lane] = (1 - a) / a;
        }
        const captured: Partial<Record<string, [number, number, number]>> = {};
        await new Promise<void>((resolve, reject) => {
          const deadline = h.win.performance.now() + 12_000;
          let prev: Record<string, number[] | null> | null = null;
          const tick = (): void => {
            const now = h.readCanvasRegions(laneRegions);
            if (prev) {
              for (const lane of LANE_IDS) {
                if (captured[lane]) continue;
                const sig = now[lane];
                const before = prev[lane];
                if (!sig || !before || sig.length !== before.length) continue;
                let diff = false;
                for (let i = 0; i < sig.length; i++) {
                  if (sig[i] !== before[i]) {
                    diff = true;
                    break;
                  }
                }
                if (!diff) continue;
                const px: [number, number, number] = [
                  sig[0]!,
                  sig[1]!,
                  sig[2]!,
                ];
                const ratio =
                  rgbDistance(px, hueRgb[lane]!) /
                  Math.max(1e-6, rgbDistance(px, groundRgb));
                if (ratio <= hueBudget[lane]!) captured[lane] = px;
              }
            }
            prev = now;
            if (LANE_IDS.every((l) => captured[l])) resolve();
            else if (h.win.performance.now() > deadline)
              reject(
                new Error(
                  `lane-hue flash not observed for: ${LANE_IDS.filter(
                    (l) => !captured[l],
                  ).join(", ")}`,
                ),
              );
            else h.win.requestAnimationFrame(tick);
          };
          h.win.requestAnimationFrame(tick);
        });
        vizHarnessLog(
          "th2-hue",
          Object.fromEntries(
            LANE_IDS.map((l) => [
              l,
              { captured: captured[l], hue: hueRgb[l], ground: groundRgb },
            ]),
          ),
        );
        for (const lane of LANE_IDS) {
          const px = captured[lane]!;
          expect(
            rgbDistance(px, hueRgb[lane]!) <=
              hueBudget[lane]! * rgbDistance(px, groundRgb),
            `${lane} ignition pixel must read as its tokens lane hue`,
          ).toBe(true);
        }

        // --- 6. Law D — STOP clears the queue; no reactions after --------
        await h.stop();
        await sleep(250); // let any in-flight decay (≤100 ms) fully settle
        const post = await h.sampleCanvasActivity({
          durationMs: 800,
          regions: laneRegions,
        });
        vizHarnessLog("th2-stop", { changesAfterStop: post.changes.length });
        expect(
          post.changes,
          "stopped transport ⇒ zero canvas reactions (queue cleared)",
        ).toHaveLength(0);
        expect(h.playing()).toBe(false);
      } finally {
        await h.teardown();
      }
    },
  );
});
