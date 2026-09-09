/**
 * VZ-HW-3 — THE JOURNEY SUITE (J1/J2/J3): the three committed town-hall
 * journeys walked END-TO-END on the REAL BUILT BUNDLE (the VZ-HW-2 harness
 * — globalSetup built dist/, bootVizApp serves the exact hashed assets in a
 * wiped-IDB iframe, so every journey starts from the deterministic
 * first-run demo pattern). This file is the standing acceptance suite the
 * plan's M3 exit names; the per-task gates (viz-remote, viz-announcements,
 * viz-reduced-motion, viz-phone, viz-phases, viz-joy-loop, viz-memory …)
 * keep their deeper seam-level laws — this suite proves the JOURNEYS, it
 * does not re-prove their internals (no test-count inflation):
 *
 * J1 — THE CORE LOOP: pattern looping → enter VIZ → hits drive the visuals
 *      → reroll ×3 (distinct deals, coalesced per commit, ONE announcement
 *      per commit) → cycle preset (keyboard) → exit → STILL PLAYING →
 *      re-enter → memory restores the committed deal. The transport never
 *      stops across the whole journey: the booth label law (STOP =
 *      playing) is asserted at every leg AND the audio clock is proven to
 *      have advanced across the span (built-bundle snapshot law — the
 *      in-page snapshot equality is viz-mount §5's pin).
 *
 * J2 — IDLE: transport never started → enter VIZ → the CALM STATIC rig
 *      (pixel-static over a probe window while the loop keeps drawing),
 *      controls live + announced (cycle and reroll both commit and speak
 *      exactly once), help coverage reachable on the surface (`i` → the
 *      info view reads the remote's entries), exit via the `v` twin with
 *      focus returned to the invoker. Distinctness across rerolls is
 *      asserted here via the FINGERPRINT PROBE (still-diagram region
 *      snapshots across consecutive committed deals — the calm window is
 *      the only honest place for byte-level deal comparison; J1's rerolls
 *      happen over an animated stage and prove deal distinctness by their
 *      committed seeds).
 *
 * J3 — REROLL SPAM: 3 waves × 30 rapid REROLL requests → each wave
 *      coalesces to EXACTLY ONE commit + ONE announcement; no buildup (the
 *      stage keeps reacting, the rAF cadence stays one-loop-sane); exit
 *      while a reroll window is PENDING → no late commit (the persisted
 *      envelope still holds the last committed deal after the window would
 *      have fired) and the render loop dies with the page (rAF arm rate
 *      returns to the pre-open baseline; the dispose cancelled its pending
 *      frame). Transport never stops.
 *
 * HONESTY NOTES (§0.7):
 * - "Leak assertions via module probes" at the built-bundle boundary are
 *   the harness's WINDOW-LEVEL module activity counters (rAF arms/fires/
 *   cancels, AudioContext creations — VZ-HW-2's instrumentation class):
 *   the iframe's in-bundle module registries are unreachable from the
 *   tester page BY DESIGN (harness scope note). The registry-level zeroing
 *   (controllers/renderers/engines) is pinned in-page by viz-joy-loop's
 *   exit-while-arranging leg; here the same law is asserted at the
 *   observable boundary.
 * - Engine-ledger budget caps (peakLive ≤ 192) are likewise in-page
 *   (viz-joy-loop); J3's built-bundle budget signal is the frame cadence —
 *   a loop that survived or multiplied would show in the arm rate.
 * - ANNOUNCEMENT COUNTING is exact via a pass-through wrap of the region
 *   element's own textContent accessor (see watchAnnouncements): a
 *   MutationObserver is NOT honest here — observer batches can coalesce
 *   past the announcer's 30 ms clear→set replay gap under load (observed:
 *   a replayed identical line read as "no change" and the count dropped).
 * - The app itself may create its AudioContext at boot (session.ts's
 *   lane-playback engine bring-up) — J2's idle law is that VIZ adds none,
 *   asserted as an unchanged count across the journey, not a global zero.
 * - Timing windows are load-robust (counts ≥ 2/s, ratios only where the
 *   law is hard) per the task's risk note; J1's hits window sits past the
 *   documented ~1.2 s first-play boot-skip (VZ-TH-2's caveat).
 */

import { describe, expect, it } from "vitest";
import {
  bootVizApp,
  DEFAULT_CANVAS_REGIONS,
  poll,
  sleep,
  VIZ_PREFS_STORAGE_KEY,
  type CanvasRegionSpec,
  type VizAppHarness,
} from "./viz-harness";
import {
  VIZ_ON_ANNOUNCEMENT,
  VIZ_ON_IDLE_ANNOUNCEMENT,
  VIZ_REROLL_ANNOUNCEMENT,
  vizPresetAnnouncement,
} from "../../src/viz/announcements";
import {
  generateArrangement,
  VIZ_DEFAULT_PRESET_ID,
  VIZ_PRESETS,
} from "../../src/viz/presets";
import { VIZ_DEFAULT_SEED } from "../../src/viz/nodes";
import { VIZ_REROLL_COALESCE_MS } from "../../src/viz/arrangement";
import { VIZ_IDLE_LINE } from "../../src/components/VizRemote";

/** Machine-readable evidence line (the frame-budget console-line law). */
function journeyLog(tag: string, record: Record<string, unknown>): void {
  console.log(`[VZ-HW-3 ${tag}] ${JSON.stringify(record)}`);
}

// ---------------------------------------------------------------------------
// Built-bundle observation helpers (all reads stay at the observable boundary)
// ---------------------------------------------------------------------------

interface VizEnvelope {
  readonly version: number;
  readonly presetId: string;
  readonly seed: number;
}

/** The persisted deal (null before the first commit — the no-boot-write law). */
function envelopeOrNull(app: VizAppHarness): VizEnvelope | null {
  const raw = app.win.localStorage.getItem(VIZ_PREFS_STORAGE_KEY);
  if (raw === null) return null;
  return JSON.parse(raw) as VizEnvelope;
}

function envelopeOf(app: VizAppHarness): VizEnvelope {
  const env = envelopeOrNull(app);
  if (env === null) throw new Error("no committed viz envelope in memory");
  return env;
}

/** The announcement region's current text (empty string when not yet spoken). */
function announceText(app: VizAppHarness): string {
  return app.$(".viz-announce").textContent ?? "";
}

/**
 * The announcement WRITE LEDGER: wraps the region element's own
 * `textContent` accessor (the iframe is same-origin, so the tester can
 * reach the element instance; every write passes STRAIGHT THROUGH to the
 * real DOM — the harness's AudioContext/rAF instrumentation class, zero
 * product behavior change) so every write the announcer makes is counted
 * EXACTLY. A MutationObserver cannot do this honestly: observer batches
 * can coalesce past the announcer's 30 ms clear→set replay gap under load
 * (observed in the first run: a replayed identical line read as "no
 * change"), but the write itself always lands here. Each emission performs
 * EXACTLY ONE non-empty write (direct writes are one; replays are
 * ""-then-text), so `emissionsOf(text)` counts spoken lines exactly and
 * `writes` keeps the raw sequence (replays show their "" clears).
 */
function watchAnnouncements(region: HTMLElement): {
  readonly writes: readonly string[];
  emissionsOf(text: string): number;
} {
  const writes: string[] = [];
  let proto: object | null = region;
  let descriptor: PropertyDescriptor | undefined;
  while (proto && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "textContent");
    proto = Object.getPrototypeOf(proto);
  }
  if (!descriptor?.get || !descriptor.set)
    throw new Error("textContent accessor not found on the announce region");
  const realGet = descriptor.get;
  const realSet = descriptor.set;
  Object.defineProperty(region, "textContent", {
    get(this: HTMLElement) {
      return realGet.call(this);
    },
    set(this: HTMLElement, value: string) {
      writes.push(String(value ?? ""));
      realSet.call(this, value);
    },
    configurable: true,
  });
  return {
    writes,
    emissionsOf: (text: string) => writes.filter((w) => w === text).length,
  };
}

/**
 * Wait for the next COMMITTED reroll: the persisted envelope gains a seed
 * not among `known` while `presetId` stays `expectedPreset` (rerolls re-deal
 * the same rig). The seed change is the deterministic per-commit signal —
 * announcement text alone cannot separate consecutive identical reroll
 * lines (the replay path clears between them for 30 ms only).
 */
async function awaitRerollCommit(
  app: VizAppHarness,
  known: readonly number[],
  expectedPreset: string,
): Promise<number> {
  let seed = -1;
  await poll(
    () => {
      const env = envelopeOrNull(app);
      if (env === null || env.presetId !== expectedPreset) return false;
      if (!known.includes(env.seed)) {
        seed = env.seed;
        return true;
      }
      return false;
    },
    8000,
    "a committed reroll deal (persisted seed change)",
  );
  return seed;
}

/** Dispatch a key at the iframe's focused element (flows to window). */
function keyAt(app: VizAppHarness, key: string): void {
  const doc = app.doc();
  (doc.activeElement ?? doc.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Native-button keyboard activation, replicated exactly (the DA-3 testing
 * note: synthetic keydowns do not generate the browser's implicit click, so
 * the idiom is keydown + click — the same path a real Enter press takes).
 */
function pressEnter(app: VizAppHarness, el: HTMLElement): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  el.click();
}

/**
 * The iframe's rAF callback rate over a wall-clock window (the harness's
 * window-level module activity counter — every rAF the BUILT app fired,
 * summed across all its loops). Three uses: the open rate (the viz loop is
 * live), the post-spam rate (no loop multiplication — budget sane), and the
 * post-exit rate (the loop died with the page — the leak law).
 */
async function rafRate(app: VizAppHarness, ms: number): Promise<number> {
  const start = app.instrument();
  const t0 = performance.now();
  await sleep(ms);
  const end = app.instrument();
  const seconds = Math.max((performance.now() - t0) / 1000, 0.001);
  return (end.rafCallbacks - start.rafCallbacks) / seconds;
}

/**
 * Lane-anchor regions of ONE deal (the first node dealt per lane,
 * positioned by its placement fractions — anchorOf maps exactly these to
 * stage px, so a region centered there is lit by that deal's own rest
 * marks: the viz-memory/viz-fingerprint detector precedent). The FIXED
 * grid this file first tried proved too sparse (marks are small; two
 * deals can both miss 20 spread points — observed d=0), so snapshots are
 * compared over the DEALS' OWN anchor points instead.
 */
function dealAnchorRegions(presetId: string, seed: number): CanvasRegionSpec[] {
  const preset = VIZ_PRESETS.find((p) => p.id === presetId)!;
  const rig = generateArrangement(preset, seed);
  const anchors: CanvasRegionSpec[] = [];
  for (const node of rig.nodes) {
    const lane = String(node.placement.lane);
    if (lane === "any") continue; // lane-bound anchors only (stable names)
    if (anchors.some((r) => r.name === `a:${lane}`)) continue;
    const x = Number(node.placement.x);
    const y = Number(node.placement.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    anchors.push({
      name: `a:${lane}`,
      fx: Math.min(1, Math.max(0, x)),
      fy: Math.min(1, Math.max(0, y)),
      size: 12,
    });
  }
  return anchors;
}

/** Union of region specs by name (later deals may reuse lane names). */
function unionRegions(
  sets: readonly (readonly CanvasRegionSpec[])[],
): readonly CanvasRegionSpec[] {
  const out: CanvasRegionSpec[] = [];
  for (const set of sets)
    for (const spec of set)
      if (!out.some((r) => r.name === spec.name)) out.push(spec);
  return out;
}

/**
 * Which of `regions` differ between two snapshots (byte-compared per
 * region; null vs non-null counts as differing).
 */
function differingAmong(
  a: Record<string, number[] | null>,
  b: Record<string, number[] | null>,
  regions: readonly CanvasRegionSpec[],
): string[] {
  return regions
    .filter((r) => JSON.stringify(a[r.name] ?? null) !== JSON.stringify(b[r.name] ?? null))
    .map((r) => r.name);
}

/**
 * J1's activity regions: the harness trio PLUS the lane-anchor points of
 * the deterministic DEFAULT deal. Hits ignite AT the anchors, so these are
 * the regions where "hits drive the visuals" is observable no matter where
 * the seeded deal hung its rig (the first run showed the fixed trio alone
 * can straddle a sparse stretch of the demo's staggered opening bars).
 */
const ACTIVITY_REGIONS: readonly CanvasRegionSpec[] = [
  ...DEFAULT_CANVAS_REGIONS,
  ...dealAnchorRegions(VIZ_DEFAULT_PRESET_ID, VIZ_DEFAULT_SEED),
];

// ---------------------------------------------------------------------------
// J1 — the core loop
// ---------------------------------------------------------------------------

describe("VZ-HW-3 journey suite (J1/J2/J3) — the built bundle", () => {
  it(
    "J1 core loop: play → enter → hits drive visuals → reroll ×3 (distinct, coalesced, one announcement per commit) → cycle (keyboard) → exit → still playing → re-enter → memory restored",
    { timeout: 240_000 },
    async () => {
      const app = await bootVizApp();
      try {
        // --- PATTERN LOOPING: the demo plays and KEEPS playing -----------
        await app.play();
        const audioAtEntry = app.audioNow();
        expect(app.playing()).toBe(true);

        // --- ENTER via the booth button (the pointer twin; the invoker
        //     the exit's focus return must name) ---------------------------
        const vizBtn = app.$<HTMLButtonElement>(".booth-btn-viz");
        vizBtn.click();
        await poll(() => app.vizOpen(), 5000, "viz page mounted");
        const canvas = app.canvas();
        await poll(
          () => canvas.width > 1 && canvas.height > 1,
          5000,
          "viz canvas backing store to size",
        );
        // The playing-truthful entry line (DD-2's copy, spoken at entry).
        await poll(
          () => announceText(app) === VIZ_ON_ANNOUNCEMENT,
          6000,
          "playing entry announcement",
        );
        // The readout names the boot deal (the deterministic default).
        expect(
          app.$(".viz-remote-name").textContent?.trim(),
          "boot readout names the default preset",
        ).toBe(VIZ_PRESETS[0]!.name);

        // --- HITS DRIVE THE VISUALS --------------------------------------
        // Grace past the documented ~1.2 s first-play boot-skip (the
        // worklet bring-up delays delivery; VZ-TH-2's logged caveat) so
        // the sample window watches a FLOWING pattern, then sample at rAF
        // cadence over the default deal's own ignition points.
        await sleep(1600);
        const activity = await app.sampleCanvasActivity({
          durationMs: 2500,
          regions: ACTIVITY_REGIONS,
        });
        journeyLog("j1-hits", {
          changes: activity.changes.length,
          samples: activity.samples.length,
          perRegion: activity.regionChangeCounts,
        });
        expect(
          activity.changes.length,
          "canvas reacts while the pattern plays (load-robust ≥~1/s)",
        ).toBeGreaterThanOrEqual(3);

        const ledger = watchAnnouncements(app.$(".viz-announce"));
        const rerollBtn = app.$<HTMLButtonElement>(".viz-remote-reroll");
        // Consecutive reroll lines are IDENTICAL text — the announcer's
        // replay path (clear, then re-set ≤30 ms later) speaks them again.
        // Each commit's speech is awaited by count and given the 90 ms tail
        // so the replay write has always landed before anything counts.
        const awaitRerollSpeech = async (nth: number): Promise<void> => {
          await poll(
            () => ledger.emissionsOf(VIZ_REROLL_ANNOUNCEMENT) >= nth,
            3000,
            `reroll #${nth} announcement`,
          );
          await sleep(90);
        };

        // --- REROLL ×3: distinct committed deals, coalesced, announced
        //     exactly once per commit -------------------------------------
        // #1 via KEYBOARD (the DD-1 rows): entry seeded focus on the roving
        // chain's first control; walk → twice to REROLL, activate w/ Enter.
        expect(
          app.doc().activeElement?.getAttribute("aria-label"),
          "entry focus is the roving seed",
        ).toBe("Previous preset");
        keyAt(app, "ArrowRight"); // → Next preset
        keyAt(app, "ArrowRight"); // → REROLL
        expect(app.doc().activeElement).toBe(rerollBtn);
        pressEnter(app, rerollBtn);
        const seeds: number[] = [VIZ_DEFAULT_SEED];
        seeds.push(await awaitRerollCommit(app, seeds, VIZ_DEFAULT_PRESET_ID));
        await awaitRerollSpeech(1);

        // #2 as a MINI-BURST: two rapid requests inside one coalescing
        // window → ONE commit (J1's own coalescing proof; the full spam
        // set is J3's).
        rerollBtn.click();
        rerollBtn.click();
        seeds.push(await awaitRerollCommit(app, seeds, VIZ_DEFAULT_PRESET_ID));
        await awaitRerollSpeech(2);

        // #3 via the pointer twin.
        rerollBtn.click();
        seeds.push(await awaitRerollCommit(app, seeds, VIZ_DEFAULT_PRESET_ID));
        await awaitRerollSpeech(3);

        expect(new Set(seeds).size, "three rerolls + default = 4 distinct deals").toBe(4);
        journeyLog("j1-rerolls", { seeds, writes: [...ledger.writes] });
        expect(
          ledger.emissionsOf(VIZ_REROLL_ANNOUNCEMENT),
          "ONE reroll announcement per committed deal",
        ).toBe(3);
        expect(app.playing(), "the transport never noticed the re-deals").toBe(true);

        // --- CYCLE PRESET via KEYBOARD (← to Next preset, Enter) ---------
        const next = app.$<HTMLButtonElement>('[aria-label="Next preset"]');
        keyAt(app, "ArrowLeft"); // REROLL → Next preset
        expect(app.doc().activeElement).toBe(next);
        pressEnter(app, next);
        await poll(
          () => app.$(".viz-remote-name").textContent?.trim() === VIZ_PRESETS[1]!.name,
          6000,
          "readout cycles to the second preset",
        );
        expect(
          ledger.emissionsOf(vizPresetAnnouncement(VIZ_PRESETS[1]!.name)),
          "the committed preset switch announced exactly once",
        ).toBe(1);
        // The SEED LAW (arrangement.ts): every committed deal — reroll OR
        // cycle — draws the next seed from the one stream, so the cycle
        // visibly re-deals too. This is the committed envelope the memory
        // leg must restore.
        const committed = envelopeOf(app);
        expect(committed.presetId).toBe(VIZ_PRESETS[1]!.id);
        expect(
          committed.seed,
          "the cycle re-dealt (a fresh seed, never the old rig's)",
        ).not.toBe(seeds[seeds.length - 1]!);
        expect(app.playing()).toBe(true);

        // --- EXIT (Escape): focus returns to the invoker, still playing --
        await app.closeViz();
        await poll(
          () => app.doc().activeElement === vizBtn,
          3000,
          "focus returned to the invoking booth control",
        );
        expect(app.playing(), "still playing at exit").toBe(true);
        // Context-liveness evidence (the audio clock ran the whole span).
        // NOTE (honesty): ctx.currentTime advances whenever the CONTEXT
        // runs — it is NOT itself transport proof; the transport law is
        // the button-label law asserted at every checkpoint above/below,
        // plus the hits-driven canvas activity (a stopped transport would
        // flip the label to PLAY at the very next checkpoint).
        const audioAtExit = app.audioNow();
        journeyLog("j1-exit", { audioSpanSeconds: audioAtExit - audioAtEntry });

        // --- RE-ENTER via `v` (the keyboard entry twin): MEMORY RESTORES -
        keyAt(app, "v");
        await poll(() => app.vizOpen(), 5000, "viz remounted via v");
        await poll(
          () => app.$(".viz-remote-name").textContent?.trim() === VIZ_PRESETS[1]!.name,
          6000,
          "memory restores the committed preset",
        );
        expect(envelopeOf(app), "the committed deal survived the exit").toEqual(
          committed,
        );
        expect(app.playing(), "still playing at re-entry").toBe(true);

        // --- EXIT via the EXIT button (the third funnel twin) ------------
        app.$<HTMLButtonElement>(".viz-remote-exit").click();
        await poll(() => !app.vizOpen(), 5000, "viz unmounted (EXIT button)");
        await poll(
          () => app.doc().activeElement === vizBtn,
          3000,
          "focus returned through the closeViz funnel",
        );
        expect(
          app.playing(),
          "J1's law held to the last step: the music never stopped",
        ).toBe(true);

        // --- VZ-DD-1 HARDENING (finishing critique P2): `v`-entry at BODY
        // focus never exits onto <body>. The critique probe: an exit after
        // a `v` entry left document.activeElement === body while the EXIT
        // help copy promises "focus lands back where you left it". Drop
        // focus to <body> (a pointer user's state), re-enter via `v` —
        // the synthesized invoker is the LAST focused stage control (the
        // exit above just returned focus to the booth VIZ toggle, so the
        // focusin ledger names it) — and the Escape exit lands THERE.
        vizBtn.blur();
        await poll(
          () => app.doc().activeElement === app.doc().body,
          2000,
          "focus dropped to body (the nowhere case)",
        );
        keyAt(app, "v"); // entry with NO focused element
        await poll(() => app.vizOpen(), 5000, "viz mounted via v at body focus");
        await app.closeViz(); // Escape through the one funnel
        await poll(
          () => app.doc().activeElement === vizBtn,
          3000,
          "v-entry at body focus exits to the last focused stage control — never <body>",
        );
        expect(
          app.doc().activeElement,
          "the exit never strands focus on <body>",
        ).not.toBe(app.doc().body);
        expect(app.playing(), "still playing after the hardening leg").toBe(
          true,
        );
        journeyLog("j1-done", { seeds, presetsWalked: [VIZ_PRESETS[0]!.id, VIZ_PRESETS[1]!.id] });
      } finally {
        await app.teardown();
      }
    },
  );

  // -------------------------------------------------------------------------
  // J2 — idle
  // -------------------------------------------------------------------------

  it(
    "J2 idle: calm static rig (loop drawing, pixels frozen) · controls live + announced · reroll deals are distinct still diagrams (fingerprint probe) · help coverage reachable · exit via `v` returns focus · the lazy AudioContext never forced",
    { timeout: 240_000 },
    async () => {
      const app = await bootVizApp();
      try {
        // The transport NEVER started. The app itself may have created a
        // context at boot (session.ts's lane-playback engine bring-up) —
        // the IDLE law under test is that VIZ adds none of its own: the
        // count is captured now and must be UNCHANGED after the whole
        // idle journey (VizPage's guard — the surface never reads the
        // audio clock into existence while stopped).
        const contextsAtBoot = app.instrument().contextCount;

        // --- ENTER idle (stopped transport, booth pointer twin) ----------
        const vizBtn = app.$<HTMLButtonElement>(".booth-btn-viz");
        vizBtn.click();
        await poll(() => app.vizOpen(), 5000, "viz page mounted");
        await poll(
          () => announceText(app) === VIZ_ON_IDLE_ANNOUNCEMENT,
          6000,
          "idle entry announcement",
        );
        expect(
          app.$(".viz-remote-idle").textContent?.trim(),
          "the idle line names the way back (J2 legibility)",
        ).toBe(VIZ_IDLE_LINE);

        // --- CALM STATIC RIG: settled, then pixel-static while the loop
        //     keeps drawing (the phases settle allowance: one-shot tail +
        //     level ease) --------------------------------------------------
        await sleep(1600);
        const armsBefore = app.instrument().rafArms;
        const still = await app.sampleCanvasActivity({ durationMs: 1500 });
        journeyLog("j2-static", {
          changes: still.changes.length,
          samples: still.samples.length,
        });
        expect(still.changes.length, "idle canvas is pixel-static").toBe(0);
        expect(
          app.instrument().rafArms - armsBefore,
          "the render loop keeps drawing (never a dead screen)",
        ).toBeGreaterThan(0);

        // --- CONTROLS LIVE + ANNOUNCED, and the deals are DISTINCT still
        //     diagrams (the fingerprint probe over consecutive commits).
        //     Each snapshot is read at the UNION of every deal-so-far's own
        //     lane anchors; pairs are compared over the EARLIER deal's
        //     anchors — its marks are lit there in its own snapshot and
        //     (the later deal hangs its marks elsewhere) dark/different in
        //     the later one. ------------------------------------------------
        const ledger = watchAnnouncements(app.$(".viz-announce"));
        const rerollBtn = app.$<HTMLButtonElement>(".viz-remote-reroll");
        const anchorSets: readonly CanvasRegionSpec[][] = [
          dealAnchorRegions(VIZ_DEFAULT_PRESET_ID, VIZ_DEFAULT_SEED),
        ];
        const snapshots: Record<string, number[] | null>[] = [
          app.readCanvasRegions(anchorSets[0]!),
        ];
        const seeds: number[] = [VIZ_DEFAULT_SEED];
        for (let i = 0; i < 2; i++) {
          rerollBtn.click();
          const seed = await awaitRerollCommit(app, seeds, VIZ_DEFAULT_PRESET_ID);
          seeds.push(seed);
          anchorSets.push(dealAnchorRegions(VIZ_DEFAULT_PRESET_ID, seed));
          await sleep(1400); // the new still diagram settles (rig re-bake)
          snapshots.push(app.readCanvasRegions(unionRegions(anchorSets)));
        }
        const d01 = differingAmong(snapshots[0]!, snapshots[1]!, anchorSets[0]!);
        const d12 = differingAmong(snapshots[1]!, snapshots[2]!, anchorSets[1]!);
        const d02 = differingAmong(snapshots[0]!, snapshots[2]!, anchorSets[0]!);
        journeyLog("j2-fingerprints", {
          seeds,
          anchorsPerDeal: anchorSets.map((a) => a.length),
          differingPairs: { "0-1": d01.length, "1-2": d12.length, "0-2": d02.length },
        });
        expect(d01.length, "deal 1 ≠ deal 0 at deal 0's own anchors").toBeGreaterThan(0);
        expect(d12.length, "deal 2 ≠ deal 1 at deal 1's own anchors").toBeGreaterThan(0);
        expect(d02.length, "deal 2 ≠ deal 0 at deal 0's own anchors").toBeGreaterThan(0);
        expect(
          ledger.emissionsOf(VIZ_REROLL_ANNOUNCEMENT),
          "each idle reroll announced exactly once",
        ).toBe(2);

        // Cycle: the readout moves and speaks once (live + announced).
        app.$<HTMLButtonElement>('[aria-label="Next preset"]').click();
        await poll(
          () => app.$(".viz-remote-name").textContent?.trim() === VIZ_PRESETS[1]!.name,
          6000,
          "idle cycle moves the readout",
        );
        expect(
          ledger.emissionsOf(vizPresetAnnouncement(VIZ_PRESETS[1]!.name)),
          "the idle cycle announced exactly once",
        ).toBe(1);

        // Calm HOLDS after the re-deal (still pixel-static post-controls).
        await sleep(1400);
        const stillAfter = await app.sampleCanvasActivity({ durationMs: 1000 });
        expect(
          stillAfter.changes.length,
          "the rig re-settles to a static diagram after idle re-deals",
        ).toBe(0);

        // --- HELP COVERAGE REACHABLE on the surface (`i` → info view;
        //     the remote's entries read) ----------------------------------
        keyAt(app, "i");
        await poll(
          () => app.doc().querySelector(".info-view") !== null,
          6000,
          "help mode on the VIZ surface",
        );
        rerollBtn.focus();
        await poll(
          () =>
            (app.doc().querySelector(".info-view")?.textContent ?? "").includes(
              "REROLL",
            ),
          4000,
          "the info view reads the REROLL entry",
        );
        keyAt(app, "i");
        await poll(
          () => app.doc().querySelector(".info-view") === null,
          4000,
          "help mode off",
        );

        // --- EXIT via `v` (the keyboard exit twin): focus returns -------
        keyAt(app, "v");
        await poll(() => !app.vizOpen(), 5000, "viz unmounted (v)");
        await poll(
          () => app.doc().activeElement === vizBtn,
          3000,
          "focus returned to the invoker",
        );
        // Opening/using/closing VIZ at idle never forced the lazy context
        // (whatever the app itself did at boot is the baseline, not VIZ's).
        expect(app.instrument().contextCount).toBe(contextsAtBoot);
        expect(app.playing()).toBe(false); // idle throughout, as committed
        journeyLog("j2-done", { seeds, contextsAtBoot });
      } finally {
        await app.teardown();
      }
    },
  );

  // -------------------------------------------------------------------------
  // J3 — reroll spam
  // -------------------------------------------------------------------------

  it(
    "J3 reroll spam: 3×30 rapid requests coalesce to one commit + one announcement each · no buildup (stage alive, cadence sane) · exit-while-pending commits nothing late · the loop dies with the page · transport never stops",
    { timeout: 240_000 },
    async () => {
      const app = await bootVizApp();
      try {
        await app.play();
        // The CLOSED baseline rAF rate (the app below, playing, viz off) —
        // the post-exit leak law compares against THIS, not a hard number.
        const closedRate = await rafRate(app, 1500);

        const vizBtn = app.$<HTMLButtonElement>(".booth-btn-viz");
        vizBtn.click();
        await poll(() => app.vizOpen(), 5000, "viz page mounted");
        await poll(
          () => announceText(app) === VIZ_ON_ANNOUNCEMENT,
          6000,
          "playing entry announcement",
        );
        const openRate = await rafRate(app, 1500);
        journeyLog("j3-rates", { closedRate, openRate });
        expect(
          openRate,
          "the viz loop is live on top of the app's own loops",
        ).toBeGreaterThan(closedRate);

        // --- THREE SPAM WAVES: 30 rapid requests each → ONE commit -----
        const ledger = watchAnnouncements(app.$(".viz-announce"));
        const rerollBtn = app.$<HTMLButtonElement>(".viz-remote-reroll");
        const seeds: number[] = [];
        let currentSeed = -1;
        for (let wave = 0; wave < 3; wave++) {
          for (let i = 0; i < 30; i++) rerollBtn.click();
          await poll(
            () => {
              const env = envelopeOrNull(app);
              return env !== null && env.seed !== currentSeed;
            },
            8000,
            `spam wave ${wave + 1} to commit`,
          );
          currentSeed = envelopeOf(app).seed;
          seeds.push(currentSeed);
          await sleep(800); // quiet tail — nothing further may speak
          expect(
            ledger.emissionsOf(VIZ_REROLL_ANNOUNCEMENT),
            `wave ${wave + 1}: exactly ONE announcement for 30 requests`,
          ).toBe(wave + 1);
          expect(app.playing(), "spam never touched the transport").toBe(true);
        }
        expect(new Set(seeds).size, "each wave committed a distinct deal").toBe(3);

        // --- NO BUILDUP: the stage still reacts and the cadence is sane
        //     (a loop that multiplied under the spam would show here) ----
        const activity = await app.sampleCanvasActivity({ durationMs: 1500 });
        const postRate = await rafRate(app, 1500);
        journeyLog("j3-post-spam", {
          changes: activity.changes.length,
          samples: activity.samples.length,
          postRate,
          openRate,
        });
        expect(
          activity.changes.length,
          "the re-dealt stage keeps reacting (no dead frames)",
        ).toBeGreaterThanOrEqual(3);
        expect(postRate, "the loop stays one-renderer sane (no rAF storm)").toBeLessThan(
          openRate * 1.75 + 10,
        );
        expect(postRate, "the loop stays alive").toBeGreaterThan(20);

        // --- EXIT-WHILE-PENDING: the window dies, NOTHING commits late --
        const cancelsBefore = app.instrument().rafCancels;
        rerollBtn.click(); // a reroll window is now pending (150 ms)
        await app.closeViz(); // Escape, synchronously inside the window
        expect(
          app.instrument().rafCancels,
          "the renderer's dispose cancelled its pending frame",
        ).toBeGreaterThan(cancelsBefore);
        const seedAtExit = envelopeOf(app).seed;
        await sleep(VIZ_REROLL_COALESCE_MS + 450);
        expect(
          envelopeOf(app).seed,
          "the pending reroll died uncommitted (no late write)",
        ).toBe(seedAtExit);
        expect(seedAtExit, "sanity: the last wave's deal is what persisted").toBe(
          seeds[seeds.length - 1]!,
        );

        // --- THE LOOP DIED WITH THE PAGE: the post-exit rAF rate returns
        //     to the pre-open baseline (a leaked loop would add ~1× more) --
        const afterRate = await rafRate(app, 1500);
        journeyLog("j3-exit", { afterRate, closedRate, seedAtExit });
        expect(
          afterRate,
          "no leaked render loop after exit (rate back to baseline)",
        ).toBeLessThanOrEqual(closedRate + 12);

        expect(app.playing(), "J3's law: the transport never stopped").toBe(true);
      } finally {
        await app.teardown();
      }
    },
  );

  // -------------------------------------------------------------------------
  // VZ-DD-1 hardening — fresh-boot `v` entry (the empty-ledger edge)
  // -------------------------------------------------------------------------
  it(
    "VZ-DD-1 hardening: fresh-boot `v` entry at body focus synthesizes the booth VIZ toggle — the exit lands on the booth, never <body>",
    { timeout: 120_000 },
    async () => {
      const app = await bootVizApp();
      try {
        const vizBtn = app.$<HTMLButtonElement>(".booth-btn-viz");
        // Whatever the boot left focused: a focused control IS the invoker;
        // body focus with an empty last-focus ledger falls back to the
        // booth VIZ toggle (the EXIT copy's "returns to the booth").
        const pre = app.doc().activeElement;
        const expected =
          pre instanceof app.win.HTMLElement && pre !== app.doc().body
            ? pre
            : vizBtn;
        keyAt(app, "v");
        await poll(() => app.vizOpen(), 5000, "viz mounted via v at fresh boot");
        await app.closeViz(); // Escape through the one funnel
        await poll(
          () => app.doc().activeElement === expected,
          3000,
          "exit focus lands on the synthesized invoker",
        );
        expect(
          app.doc().activeElement,
          "fresh-boot `v` entry never strands the exit on <body>",
        ).not.toBe(app.doc().body);
        expect(app.playing()).toBe(false); // idle boot throughout
        journeyLog("harden-v-entry", {
          preEntryFocus: pre === app.doc().body ? "body" : "element",
        });
      } finally {
        await app.teardown();
      }
    },
  );
});
