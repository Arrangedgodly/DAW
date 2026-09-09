/**
 * VZ-HW-2 — the harness SELF-CHECK (the plan's validation note says the
 * harness is "proven via VZ-TH-2's run; harness self-check included there";
 * this standing file is that self-check, runnable NOW and after every
 * harness change, so VZ-TH-2 inherits an already-proven machine — and so
 * this task's own validation matrix (§0.1) runs something real in the
 * browser project).
 *
 * One ordered journey through the harness's full surface against the REAL
 * BUILT bundle (globalSetup dist/, iframe law, IDB wiped per boot):
 *
 *   1. KNOWN-PATTERN BOOT — first-run demo mounted deterministically (4
 *      lanes, VERSE cue polled at boot), transport facts derived from the
 *      same demoSong source the app loads (112 BPM, swing 0.2, 16-step
 *      passes), and the preset/seed localStorage seam seeded through the
 *      product's own serializer (VZ-IM-3 live: the app READS the key —
 *      this boot's deliberately unknown presetId exercises the discard-
 *      to-default fallback while the stored bytes stay byte-exact).
 *   2. VIZ OPEN — the real booth button mounts exactly one page + sized
 *      canvas; the VZ-IM-4 skeleton laws observable through the iframe
 *      boundary (DPR-capped integer backing store, opaque token ground).
 *   3. TRANSPORT DRIVE — play() via the real button: the audio context is
 *      captured (audioNow advances), the anchor brackets timelineStart
 *      tightly (audio-clock quanta, never wall-clock), the transport-derived
 *      step math orders correctly, and the playhead really runs (the e2e
 *      ≥8-distinct-transforms law).
 *   4. MODULE ACTIVITY COUNTER — the iframe rAF-callback DELTA between VIZ
 *      open and closed isolates the viz renderer's loop (≥20/s, the
 *      load-robust counting precedent), with the transport still playing
 *      across the close (transport isolation).
 *   5. CANVAS ACTIVITY PROBE — rAF-cadence sampling of fixed small regions:
 *      the sampler runs (≥20 samples / 1.5 s); STOPPED (VIZ open, transport
 *      stopped) the resting rig is pixel-STATIC — zero changes (VZ-IM-5's
 *      still diagram, and no detector false positives); PLAYING the rig
 *      genuinely reacts (≥1 change — the VZ-IM-5 inheritance of the old
 *      ground-only-skeleton law: the canvas is supposed to draw now); the
 *      paired wall/audio samples are monotonic and drift-bounded; and the
 *      detector is SENSITIVE (a real pixel write inside one region is read
 *      back — no fake pass on a detector that can only ever report "no
 *      change").
 *   6. STOP — the button returns to PLAY.
 */

import { describe, expect, it } from "vitest";
import {
  bootVizApp,
  globalStepAudibleTime,
  sleep,
  vizHarnessLog,
  VIZ_PREFS_STORAGE_KEY,
  type VizAppHarness,
} from "./viz-harness";

/** Distinct playhead transforms over a wall-clock window (e2e law). */
async function playheadChanges(app: VizAppHarness, ms: number): Promise<number> {
  let last = "";
  let changes = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const ph = app.doc().querySelector<HTMLElement>(".grid-playhead");
    if (ph) {
      const t = ph.style.transform;
      if (t !== last) {
        last = t;
        changes++;
      }
    }
    await sleep(65);
  }
  return changes;
}

/** iframe rAF callbacks per second over a wall-clock window. */
async function rafRate(app: VizAppHarness, ms: number): Promise<number> {
  const before = app.instrument().rafCallbacks;
  await sleep(ms);
  const after = app.instrument().rafCallbacks;
  return ((after - before) / ms) * 1000;
}

describe("VZ-HW-2 viz harness self-check (built app)", () => {
  it(
    "boots the known demo, opens VIZ, drives transport deterministically, reports canvas activity honestly",
    { timeout: 180_000 },
    async () => {
      const app = await bootVizApp({
        width: 1280,
        height: 960,
        vizPrefs: { presetId: "__hw2_selfcheck__", seed: 20260904 },
      });
      try {
        // --- 1. KNOWN-PATTERN BOOT ---------------------------------------
        expect(app.$$(".lane-grid").length).toBe(4);
        const facts = app.facts;
        expect(facts.bpm).toBe(112);
        expect(facts.swing).toBe(0.2);
        expect(facts.stepsPerPass).toBe(16); // 1-bar demo patterns
        expect(facts.stepSeconds).toBeCloseTo(60 / 112 / 4, 6);
        // Preset/seed seam: exact VZ-IM-3 envelope under the REAL key,
        // seeded by the product's own serializer (VZ-IM-3 reads it at VIZ
        // mount; this unknown presetId is discarded → the default deal
        // renders — the fallback journey rides along for free).
        expect(app.win.localStorage.getItem(VIZ_PREFS_STORAGE_KEY)).toBe(
          JSON.stringify({
            version: 1,
            presetId: "__hw2_selfcheck__",
            seed: 20260904,
          }),
        );

        // --- 2. VIZ OPEN (real booth button) ------------------------------
        const canvas = await app.openViz();
        expect(app.$$(".viz-page").length).toBe(1);
        expect(
          app.$<HTMLButtonElement>(".booth-btn-viz").getAttribute("aria-pressed"),
        ).toBe("true");
        // VZ-IM-4 skeleton laws, observed through the iframe boundary:
        const dpr = Math.min(app.win.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        expect(Math.round(rect.width)).toBeGreaterThan(0);
        expect(canvas.width).toBe(Math.round(rect.width * dpr));
        expect(canvas.height).toBe(Math.round(rect.height * dpr));
        const c2d = canvas.getContext("2d");
        expect(c2d).toBeTruthy();
        const px = c2d!.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;
        expect([px[0], px[1], px[2], px[3]]).toEqual([13, 11, 16, 255]);

        // --- 2b. STILL RIG (VIZ open, transport stopped) ------------------
        // VZ-IM-5: the resting marks are a STATIC still diagram — the
        // sampler must report ZERO changes over a stopped window (the old
        // no-false-positives law, now carried by the calm-law rest rig).
        const still = await app.sampleCanvasActivity({ durationMs: 600 });
        expect(
          still.changes,
          `resting rig must be pixel-static: ${JSON.stringify(
            still.changes.map((c) => c.regions),
          )}`,
        ).toEqual([]);

        // --- 3. TRANSPORT DRIVE + anchor ----------------------------------
        const anchor = await app.play();
        expect(app.playing()).toBe(true);
        const inst = app.instrument();
        expect(inst.contextCount).toBe(1); // the one legal engine context
        // NOTE: resumes may be 0 here — CI's no-user-gesture autoplay flag
        // makes a fresh context start RUNNING, so unlock() can skip
        // resume() entirely; the anchor's lower bound then rides the
        // post-click-dispatch read (see play()).
        expect(anchor.ctxAfterClick ?? anchor.ctxAtClick).not.toBeNull();
        // audioNow advances (the captured live clock).
        const a0 = app.audioNow();
        await sleep(250);
        expect(app.audioNow()).toBeGreaterThan(a0);
        // Anchor bracket: ordered and tight (audio-clock quanta domain).
        expect(anchor.timelineStartHi).toBeGreaterThanOrEqual(
          anchor.timelineStartLo,
        );
        const bracket = anchor.timelineStartHi - anchor.timelineStartLo;
        expect(bracket).toBeLessThan(0.05);
        // Transport-derived step math: pass spacing exact, steps ordered.
        const s0 = globalStepAudibleTime(0, facts, anchor);
        const sPass = globalStepAudibleTime(facts.stepsPerPass, facts, anchor);
        expect(sPass.lo - s0.lo).toBeCloseTo(
          facts.stepsPerPass * facts.stepSeconds,
          6,
        );
        expect(globalStepAudibleTime(1, facts, anchor).lo).toBeGreaterThan(
          s0.hi,
        );
        // Playhead really runs (e2e law: ≥8 distinct transforms / 1.5 s).
        expect(await playheadChanges(app, 1500)).toBeGreaterThanOrEqual(8);

        // --- 4. CANVAS ACTIVITY PROBE (playing, VIZ open) -----------------
        const report = await app.sampleCanvasActivity({ durationMs: 1500 });
        expect(
          report.samples.length,
          `only ${report.samples.length} samples in 1.5 s`,
        ).toBeGreaterThanOrEqual(20);
        // VZ-IM-5 inheritance: the rig DRAWS while playing — the probe must
        // see real reactions (the old skeleton-law zero is asserted on the
        // stopped window above; a playing zero would now mean a DEAD rig).
        expect(
          report.changes.length,
          `the rig must react while playing: ${JSON.stringify(
            report.regionChangeCounts,
          )}`,
        ).toBeGreaterThanOrEqual(1);
        expect(report.pixelsPerSample).toBe(3 * 8 * 8); // cost evidence
        // Paired wall/audio samples: audio monotonic, drift-bounded.
        const paired = report.samples.filter(
          (s) => s.audio !== null,
        );
        expect(paired.length).toBe(report.samples.length);
        for (let i = 1; i < paired.length; i++)
          expect(paired[i]!.audio).toBeGreaterThanOrEqual(
            paired[i - 1]!.audio!,
          );
        const wallSpanS =
          (paired[paired.length - 1]!.t - paired[0]!.t) / 1000;
        const audioSpan =
          paired[paired.length - 1]!.audio! - paired[0]!.audio!;
        expect(Math.abs(audioSpan - wallSpanS)).toBeLessThan(0.05);

        // Detector SENSITIVITY (no fake pass): a real pixel write inside the
        // CENTER region is read back changed; an untouched region is not.
        // The write rides the live context's own CSS-px transform (no ctx
        // state mutated), and the skeleton's next ground fill reverts it.
        {
          const before = app.readCanvasRegions();
          const bx = Math.round(0.5 * canvas.width) - 4;
          const by = Math.round(0.5 * canvas.height) - 4;
          c2d!.fillStyle = "#ffffff";
          c2d!.fillRect(bx / dpr, by / dpr, 8 / dpr, 8 / dpr);
          const after = app.readCanvasRegions();
          expect(after.center, "center region must see the write").not.toEqual(
            before.center,
          );
          expect(after["low-left"]).toEqual(before["low-left"]);
        }

        // --- 5. MODULE ACTIVITY COUNTER + transport isolation -------------
        const openRate = await rafRate(app, 1500);
        await app.closeViz();
        expect(app.vizOpen()).toBe(false);
        expect(
          app.$<HTMLButtonElement>(".booth-btn-viz").getAttribute("aria-pressed"),
        ).toBe("false");
        // Transport never stopped across the open→close cycle.
        expect(app.playing()).toBe(true);
        expect(app.audioNow()).toBeGreaterThan(a0);
        const closedRate = await rafRate(app, 1500);
        expect(
          openRate - closedRate,
          `viz loop rAF delta too small (open ${openRate.toFixed(1)}/s vs closed ${closedRate.toFixed(1)}/s)`,
        ).toBeGreaterThanOrEqual(20);

        // --- 6. STOP -------------------------------------------------------
        await app.stop();
        expect(app.playing()).toBe(false);

        vizHarnessLog("selfcheck", {
          transport: facts,
          anchorBracketS: Number(bracket.toFixed(4)),
          canvasSamples: report.samples.length,
          canvasSampleHz: Number(report.sampleHz.toFixed(1)),
          canvasChanges: report.changes.length,
          rafOpenPerS: Number(openRate.toFixed(1)),
          rafClosedPerS: Number(closedRate.toFixed(1)),
          audioContexts: inst.contextCount,
          resumes: inst.resumes,
        });
      } finally {
        await app.teardown();
      }
    },
    180_000,
  );
});
