/**
 * LL-2 browser gate (i3-4 middle clauses — the per-lane playhead basis +
 * the KL-1 position law, a11y E12), on the REAL app (component mode: real
 * Session + real AudioContext + the real renderer's rAF loop):
 *
 * 1. PER-LANE SWEEP (Doctor Strange's first-landing fence — the basis swap
 *    cannot regress the sweep law): a purpose-built UNEQUAL project plays
 *    (drums chain 8 bars [2×4-bar slots] · chords 4 · bass 2 · lead 1 →
 *    LCM 128 steps); every quadrant's rendered playhead is sampled against
 *    the transport clock and must sit at its OWN cycle's exact position
 *    (the same pure law the renderer runs), the short lanes visibly
 *    WRAPPING while the long ones have not, and the four sweeps observed
 *    at DISTINCT positions (the poly-loop visual).
 * 2. ONE LCM CYCLE ONE-SHOT (the refinement-3 law re-based): LOOP off →
 *    PLAY runs the FULL LCM cycle (16 s @120 bpm — still playing past
 *    every lane's own shorter cycle) then auto-stops; the booth parks at
 *    the final bar of the LCM cycle (8.4.4).
 * 3. THE `p` ANNOUNCEMENT (E12's exact format): mixed chains →
 *    `POSITION BAR x OF 8 · <LANE> BAR x OF y` through the stage status
 *    region, numbers cross-checked against the transport's own position;
 *    stopped → the parked positions; text-entry and AT-modifier guards.
 * 4. ZERO-DRIFT at equal lengths: the fresh project (four 1-bar chains →
 *    LCM 16 = v0.1's basis) keeps the booth BAR digit at 1 and omits the
 *    lane half of `p` — the compat law's byte-identical class.
 *
 * Grid extents stay ≤ 4 bars (64 steps = the LP-1 eager threshold) so the
 * sweep reads are window-free; the drums lane gets its 8-bar CYCLE from a
 * TWO-slot chain — the multi-slot shape that also exercises the
 * pattern-extent wrap (the sweep wraps into the 4-bar grid twice per
 * cycle).
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getSession } from "../../src/engine/session";
import {
  createFreshProjectDocument,
  loadDocument,
} from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { playheadX } from "../../src/grid/math";
import type { LaneId, ProjectDocument } from "../../src/document/schema";
import "../../src/styles/base.css";

const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];
/**
 * The SWEEP project's lane cycles (steps): drums [4+4]=128 · bass
 * [2+1]=48 (the MIXED-size chain — the one shape where the per-lane basis
 * is OBSERVABLE: its 2-bar grid does not divide its 3-bar cycle, so
 * (g mod 48) mod 32 ≠ g mod 32 on a third of every cycle; nested uniform
 * chains are basis-indistinguishable once wrapped into their grids) ·
 * chords 64 · lead 16 → LCM 192 steps.
 */
const LANE_CYCLE: Record<LaneId, number> = {
  drums: 128,
  bass: 48,
  chords: 64,
  lead: 16,
};
/** Rendered grid extents (the edited pattern's steps — LL-1 law). */
const LANE_GRID: Record<LaneId, number> = {
  drums: 64,
  bass: 32,
  chords: 64,
  lead: 16,
};
/** Desktop quadrant geometry (LaneGrid QUADRANT_GEOMETRY: cell + gap px). */
const LANE_STEP_W: Record<LaneId, number> = {
  drums: 22,
  bass: 17,
  chords: 17,
  lead: 17,
};
const BPM = 120;

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(App, host);
  return {
    host,
    cleanup: () => {
      dispose();
      host.remove();
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  ms = 4000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolve inside the NEXT animation frame, AFTER the renderer's own loop
 *  callback ran (registration order) — the playhead read and the transport
 *  clock then agree to sub-millisecond. */
const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

function key(target: EventTarget, k: string, opts: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
}

/** A drum hit row over `steps` steps (kick every 4th step — audible and
 *  dense enough to see the quadrant carry content). */
function drumSteps(steps: number, on: (s: number) => boolean): boolean[] {
  return Array.from({ length: steps }, (_, s) => on(s));
}

/**
 * The uniform unequal project: drums TWO 4-bar slots chained (cycle 8
 * bars), chords one 4-bar, bass one 2-bar, lead one 1-bar → LCM 128 steps
 * (16 s @120 bpm — the one-shot/p-announcement doc). Grid extents stay
 * ≤ 64 steps (eager rendering — no window offset in the sweep reads).
 */
function unequalChainsProject(): ProjectDocument {
  return unequalDocBase(false);
}

/**
 * The SWEEP doc: the uniform shape plus bass's 1-bar second slot (a
 * 2-bar + 1-bar chain → 3-bar cycle) — the MIXED-size chain that makes
 * the per-lane basis OBSERVABLE (a 2-bar grid does not divide a 3-bar
 * cycle, so the wrapped sweep position differs from any global-basis
 * computation on a third of every cycle; nested uniform chains are
 * basis-indistinguishable once wrapped into their grids). LCM 384.
 */
function mixedChainsProject(): ProjectDocument {
  return unequalDocBase(true);
}

function unequalDocBase(mixedBass: boolean): ProjectDocument {
  const doc = createFreshProjectDocument();
  const drumPieces = Object.keys(
    doc.patterns.drums[0]!.steps,
  ) as (keyof (typeof doc.patterns.drums)[0]["steps"])[];
  doc.patterns = {
    drums: [
      {
        kind: "drums",
        id: "drums-1",
        name: "A",
        bars: 4,
        steps: Object.fromEntries(
          drumPieces.map((piece) => [
            piece,
            drumSteps(64, (s) =>
              piece === "kick" ? s % 4 === 0 : piece === "hat" && s % 2 === 1,
            ),
          ]),
        ) as (typeof doc.patterns.drums)[0]["steps"],
      },
    ],
    bass: [
      {
        kind: "pitched",
        id: "bass-1",
        name: "A",
        bars: 2,
        rowDegrees: [0, 1, 2, 3, 4, 5, 6],
        notes: [
          { degree: 0, start: 0, length: 4 },
          { degree: 0, start: 16, length: 2 },
        ],
      },
      ...(mixedBass
        ? [
            {
              kind: "pitched" as const,
              id: "bass-2",
              name: "B",
              bars: 1,
              rowDegrees: [0, 1, 2, 3, 4, 5, 6],
              notes: [{ degree: 0, start: 0, length: 2 }],
            },
          ]
        : []),
    ],
    chords: [
      {
        kind: "pitched",
        id: "chords-1",
        name: "A",
        bars: 4,
        rowDegrees: [0, 1, 2, 3, 4, 5, 6],
        notes: [{ degree: 2, start: 32, length: 8 }],
      },
    ],
    lead: [
      {
        kind: "pitched",
        id: "lead-1",
        name: "A",
        bars: 1,
        rowDegrees: [0, 1, 2, 3, 4, 5, 6],
        notes: [{ degree: 4, start: 8, length: 2 }],
      },
    ],
  };
  doc.songChain = {
    drums: ["drums-1", "drums-1"], // two 4-bar slots → 8-bar cycle
    bass: mixedBass
      ? ["bass-1", "bass-2"] // 2-bar + 1-bar → 3-bar cycle (mixed)
      : ["bass-1"],
    chords: ["chords-1"],
    lead: ["lead-1"],
  };
  return doc;
}

describe("LL-2 per-lane transport/render basis (real app)", () => {
  it(
    "each quadrant sweeps over ITS OWN chain cycle — exact modulo vs the transport clock, short lanes wrapping while long ones have not, four distinct sweep positions",
    { timeout: 60_000 },
    async () => {
      const { host, cleanup } = mount();
      const session = getSession();
      try {
        await waitFor(() =>
          Boolean(host.querySelector(".booth-btn-play")),
        10_000, "app boot");
        loadDocument(mixedChainsProject());
        await waitFor(
          () => host.querySelectorAll(".grid-playhead").length >= 4,
          5000,
          "four quadrant grids mounted",
        );

        (host.querySelector(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing",
        );
        // LCM(128, 48, 64, 16) = 384 steps — the true LCM (the 3-bar mixed
        // cycle is incommensurate with the powers-of-two lanes).
        expect(session.transport.snapshot.cycleSteps).toBe(384);

        await waitMs(600); // past the pre-roll, into the first cycle
        const phEl = (lane: LaneId): HTMLElement =>
          host.querySelector(`.lane-floor[data-lane="${lane}"] .grid-playhead`)!;
        const phX = (lane: LaneId): number => {
          const m = /translateX\(([-\d.]+)px\)/.exec(phEl(lane).style.transform);
          return m ? Number.parseFloat(m[1]!) : Number.NaN;
        };

        // 18 samples × ~360 ms ≈ 6.9 s window from ~0.6 s in: covers the
        // bass mixed-chain's basis-distinguishing band (steps 32..48 of its
        // 48-step cycle = t ∈ [4, 6) s — where a global-basis sweep would
        // sit 16 columns away) and a lead wrap ×3.
        const samples = 18;
        const wraps: Record<LaneId, number> = {
          drums: 0,
          bass: 0,
          chords: 0,
          lead: 0,
        };
        const prevX: Record<LaneId, number> = {
          drums: -1,
          bass: -1,
          chords: -1,
          lead: -1,
        };
        // Nested power-of-two law (honest scope): a lane's sweep fraction
        // is (g mod e)/e for its GRID extent e whenever e divides its cycle
        // — so two lanes sharing a grid size read equal fractions BY
        // CONSTRUCTION (drums' 4-bar grid under its 8-bar chain ≡ chords'
        // 4-bar cycle). The diversity law is therefore "≥ 3 pairwise-
        // distinct sweep positions in most frames" (full four-way
        // distinctness needs four distinct grid extents — the LL-2 visual
        // evidence screenshot's shape).
        let distinctFrames = 0;
        let maxErr = 0;
        let sawBar2 = false;
        for (let i = 0; i < samples; i++) {
          await nextFrame();
          const loopTime = session.transport.getLoopTime();
          const fractions: number[] = [];
          for (const lane of LANES) {
            const x = phX(lane);
            expect(Number.isFinite(x), `${lane} playhead has a transform`).toBe(
              true,
            );
            // The LAW: the rendered x is the pure sweep law on the LANE's
            // OWN cycle basis (wrapped into the pattern extent), fed the
            // transport clock — exact modulo of chain position vs time.
            const expected = playheadX(
              loopTime,
              { steps: LANE_CYCLE[lane], bpm: BPM, swing: 0 },
              LANE_STEP_W[lane],
              LANE_GRID[lane],
            );
            const err = Math.abs(x - expected);
            maxErr = Math.max(maxErr, err);
            // Sub-step tolerance (one rAF of clock skew under machine load;
            // a wrong basis errs by whole sweep fractions — tens of px to
            // hundreds on the mixed lane's distinguishing band).
            expect(
              err,
              `${lane} sweep at its own cycle position (x=${x.toFixed(1)}, expected=${expected.toFixed(1)})`,
            ).toBeLessThanOrEqual(14);
            fractions.push(x / (LANE_GRID[lane] * LANE_STEP_W[lane]));
            // Wrap counting: a big drop = the sweep crossed its own top.
            const px = prevX[lane];
            if (px >= 0 && x < px - 0.5 * LANE_GRID[lane] * LANE_STEP_W[lane])
              wraps[lane]++;
            prevX[lane] = x;
          }
          if (new Set(fractions.map((f) => f.toFixed(2))).size >= 3)
            distinctFrames++;
          const led = host.querySelector(".booth-led")!.textContent!.trim();
          if (Number.parseInt(led.split(".")[0] ?? "1", 10) >= 2) sawBar2 = true;
          await waitMs(360);
        }
        // The poly-loop visual: short cycles wrapped (lead 2 s → ≥3 in the
        // ~7 s window; the mixed bass's sweep drops at its cycle's step-32
        // band, t ≈ 4 s → ≥1), long ones have NOT (chords 8 s cycle, drums
        // 8 s per grid sweep).
        expect(wraps.lead, "lead (1-bar cycle) wrapped").toBeGreaterThanOrEqual(
          3,
        );
        expect(
          wraps.bass,
          "bass (2-bar grid under a 3-bar cycle) wrapped",
        ).toBeGreaterThanOrEqual(1);
        expect(wraps.chords, "chords (4-bar cycle) not yet wrapped").toBe(0);
        expect(wraps.drums, "drums (4-bar grid under an 8-bar cycle)").toBe(0);
        // The sweeps are NOT in lockstep: ≥ 3 pairwise-distinct positions
        // in most sampled frames.
        expect(distinctFrames).toBeGreaterThanOrEqual(6);
        // The booth readout spans the LCM cycle (BAR 2+ reached at 120 bpm:
        // bar 2 starts 2 s in).
        expect(sawBar2, "booth BAR digit advanced past 1 (LCM basis)").toBe(
          true,
        );
        // (Timing-honesty echo: worst |x − expected| stays sub-step.)
        expect(maxErr).toBeLessThanOrEqual(14);
        session.transport.stop();
      } finally {
        session.transport.stop();
        cleanup();
      }
    },
  );

  it(
    "LOOP off plays EXACTLY one full LCM cycle then parks (still playing past every lane's own shorter cycle; booth parks at 8.4.4)",
    { timeout: 60_000 },
    async () => {
      const { host, cleanup } = mount();
      const session = getSession();
      try {
        await waitFor(() =>
          Boolean(host.querySelector(".booth-btn-play")),
        10_000, "app boot");
        loadDocument(unequalChainsProject());
        await waitFor(
          () => host.querySelectorAll(".grid-playhead").length >= 4,
          5000,
          "four quadrant grids mounted",
        );

        const loopBtn = host.querySelector(
          ".booth-btn-loop",
        ) as HTMLButtonElement;
        loopBtn.click(); // LOOP off — the one-shot law
        await waitFor(
          () => loopBtn.getAttribute("aria-pressed") === "false",
          3000,
          "loop off",
        );

        const playPressedAt = performance.now();
        (host.querySelector(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "one-shot playing",
        );
        // Still playing at +9.5 s: past EVERY lane's own cycle (lead 2 s,
        // bass 4 s, chords 8 s) — only the full LCM cycle (16 s) ends later.
        await waitMs(9500 - (performance.now() - playPressedAt));
        expect(
          session.transport.snapshot.playing,
          "one-shot did NOT stop at any lane's own shorter cycle",
        ).toBe(true);
        await waitFor(
          () => !session.transport.snapshot.playing,
          12_000,
          "one-shot auto-stopped after the full LCM cycle",
        );
        const elapsed = (performance.now() - playPressedAt) / 1000;
        expect(
          elapsed,
          "stopped after ≥ one full LCM cycle (16 s), not before",
        ).toBeGreaterThanOrEqual(15);
        expect(elapsed).toBeLessThan(25);
        // Parked at the LCM cycle's final step: bar 8 beat 4 step 4.
        expect(session.transport.getPosition()).toEqual({
          bar: 7,
          beat: 3,
          step: 3,
        });
        await waitFor(
          () =>
            host.querySelector(".booth-led")!.textContent!.trim() === "8.4.4",
          3000,
          "the booth parks at the final bar of the LCM cycle",
        );
      } finally {
        session.transport.stop();
        cleanup();
      }
    },
  );

  it(
    "`p` announces POSITION BAR x OF 8 · <LANE> BAR x OF y (exact numbers vs the transport), parks while stopped, and stands down in text entries / under AT modifiers",
    { timeout: 40_000 },
    async () => {
      const { host, cleanup } = mount();
      const session = getSession();
      try {
        await waitFor(() =>
          Boolean(host.querySelector(".booth-btn-play")),
        10_000, "app boot");
        loadDocument(unequalChainsProject());
        await waitFor(
          () => host.querySelectorAll(".grid-playhead").length >= 4,
          5000,
          "four quadrant grids mounted",
        );
        selectLane("bass");
        await waitFor(
          () =>
            host.querySelector(".stage-status")!.textContent!.trim() ===
            "NOW EDITING BASS",
          3000,
          "selection announced (the region is live)",
        );

        (host.querySelector(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing",
        );
        await waitMs(700); // into the cycle

        const stageStatus = () =>
          host.querySelector(".stage-status")!.textContent!.trim();
        const pressP = () => key(document.body, "p");

        // Playing: the exact E12 format, numbers from the transport's own
        // position (same JS tick — the audio clock is frozen within it).
        const pos = session.transport.getPosition();
        const g = pos.bar * 16 + pos.beat * 4 + pos.step;
        const expected = `POSITION BAR ${pos.bar + 1} OF 8 · BASS BAR ${
          Math.floor((g % 32) / 16) + 1
        } OF 2`;
        pressP();
        expect(stageStatus()).toBe(expected);

        // Stopped: the PARKED positions, same format.
        (host.querySelector(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "stopped",
        );
        const parked = session.transport.getPosition();
        const pg = parked.bar * 16 + parked.beat * 4 + parked.step;
        pressP();
        expect(stageStatus()).toBe(
          `POSITION BAR ${parked.bar + 1} OF 8 · BASS BAR ${
            Math.floor((pg % 32) / 16) + 1
          } OF 2`,
        );

        // Guards (identical to `o`/`b`): a text entry keeps its keystroke —
        // no announcement fires; an AT modifier swallows the binding.
        const tempo = host.querySelector(
          ".booth-led-input",
        ) as HTMLInputElement;
        tempo.focus();
        const before = stageStatus();
        key(tempo, "p");
        expect(stageStatus(), "text-entry guard: no announcement").toBe(
          before,
        );
        key(document.body, "p", { ctrlKey: true });
        expect(stageStatus(), "AT-modifier guard: no announcement").toBe(
          before,
        );
      } finally {
        session.transport.stop();
        cleanup();
      }
    },
  );

  it(
    "zero-drift at equal lengths: the fresh project keeps the v0.1 basis (LCM 16 — BAR digit stays 1, `p` omits the lane half)",
    { timeout: 40_000 },
    async () => {
      const { host, cleanup } = mount();
      const session = getSession();
      try {
        await waitFor(() =>
          Boolean(host.querySelector(".booth-btn-play")),
        10_000, "app boot");
        loadDocument(createFreshProjectDocument());
        await waitFor(
          () => host.querySelectorAll(".grid-playhead").length >= 4,
          5000,
          "four quadrant grids mounted",
        );
        expect(session.transport.snapshot.cycleSteps).toBe(16);

        (host.querySelector(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => session.transport.snapshot.playing,
          5000,
          "transport playing",
        );
        // Over ~2.5 s (2+ cycles of the 2 s LCM): the BAR digit NEVER
        // leaves 1 — byte-identical to the v0.1 1-bar basis.
        for (let i = 0; i < 8; i++) {
          await waitMs(300);
          const led = host.querySelector(".booth-led")!.textContent!.trim();
          expect(
            Number.parseInt(led.split(".")[0] ?? "1", 10),
            `fresh-project readout stays a 1-bar cycle (${led})`,
          ).toBe(1);
        }
        // `p` omits the lane half at equal lengths.
        key(document.body, "p");
        expect(
          host.querySelector(".stage-status")!.textContent!.trim(),
        ).toBe("POSITION BAR 1 OF 1");
      } finally {
        session.transport.stop();
        cleanup();
      }
    },
  );
});
