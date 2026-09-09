/**
 * VZ-IM-3 browser journeys — the last-preset + last-seed MEMORY (J1
 * continuity: "come back to what you left") at both browser idioms:
 *
 * A. IN-PAGE (real product modules, real VizPage mount, the tester page's
 *    own localStorage — the viz-mount/joy-loop precedent): boot RESTORE
 *    (a persisted envelope boots exactly that deal), WRITE-THROUGH (a
 *    coalesced reroll burst commits once and the key holds EXACTLY the
 *    committed envelope), SESSION CONTINUITY (close + reopen keeps the
 *    committed deal), the FALLBACK journeys (corrupt JSON and an unknown
 *    presetId both boot the default — the FIRST library preset), and the
 *    NO-BOOT-WRITE law (a keyless boot stays keyless until the first
 *    commit; one cycle commit writes once).
 *
 * B. BUILT BUNDLE (the harness idiom — bootVizApp with the vizPrefs seam,
 *    the REAL hashed bundle users get): a seeded boot renders the seeded
 *    rig (its own lane anchors lit above ground), the same memory boots
 *    byte-identically twice (the returning user sees THEIR stage), and a
 *    different memory boots a visibly different stage. The cross-boot
 *    restore journey is the one localStorage exists for.
 *
 * Why pixels for B: module probes inside the iframe are unreachable by
 * design (harness scope note) — the canvas IS the observable boundary.
 * Anchor regions are derived from the SAME product modules that deal the
 * rig (generateArrangement, the node placement fractions anchorOf maps to
 * stage px — the viz-fingerprint precedent), so "anchor lit" means "the
 * exact seeded rig rendered", not "something painted".
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import VizPage from "../../src/components/VizPage";
import { bootVizApp, sleep as harnessSleep, VIZ_PREFS_STORAGE_KEY as KEY } from "./viz-harness";
import {
  activeVizArrangementControllers,
  VIZ_REROLL_COALESCE_MS,
  type VizArrangementController,
} from "../../src/viz/arrangement";
import {
  VIZ_PREFS_STORAGE_KEY,
  writeVizPrefs,
} from "../../src/viz/persist";
import { resetVizPrefsForTests } from "../../src/viz/state";
import {
  VIZ_DEFAULT_PRESET_ID,
  generateArrangement,
  VIZ_PRESETS,
} from "../../src/viz/presets";
import { VIZ_DEFAULT_SEED } from "../../src/viz/nodes";
// Token base exactly as deployed (the viz-mount precedent): the renderer
// reads lane hues from computed custom properties at boot.
import "../../src/styles/base.css";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Fresh module session + keyless storage before every journey. */
beforeEach(() => {
  localStorage.removeItem(VIZ_PREFS_STORAGE_KEY);
  resetVizPrefsForTests();
});

/** Mount one real VizPage full-bleed; dispose drops every ref (teardown law). */
function mountVizPage(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  document.body.append(host);
  const dispose = render(() => <VizPage />, host);
  let disposed = false;
  return {
    host,
    cleanup: () => {
      if (disposed) return;
      disposed = true;
      dispose();
      host.remove();
    },
  };
}

/** The one live controller after a mount (the registry idiom). */
function soleController(): VizArrangementController {
  const live = activeVizArrangementControllers();
  expect(live.length, "exactly one live controller").toBe(1);
  return live[0]!;
}

// ---------------------------------------------------------------------------
// A. In-page journeys — restore, write-through, continuity, fallbacks
// ---------------------------------------------------------------------------

describe("VZ-IM-3 in-page memory journeys (real VizPage mount)", () => {
  it(
    "restore boots the persisted deal · a reroll burst commits once and persists · reopen keeps the deal",
    { timeout: 60_000 },
    async () => {
      // A PREVIOUS SESSION's memory: a valid envelope on disk (the exact
      // bytes the product's own serializer writes).
      writeVizPrefs(
        { version: 1, presetId: "river-glass", seed: 1357 },
        localStorage,
      );

      let committed: ReturnType<VizArrangementController["envelope"]>;
      const first = mountVizPage();
      try {
        const controller = soleController();
        // RESTORE: the boot deal IS the persisted envelope (VizPage read
        // the key at mount — no teardown/re-deal happens at boot).
        expect(controller.envelope()).toEqual({
          version: 1,
          presetId: "river-glass",
          seed: 1357,
        });
        expect(controller.probe()).toMatchObject({ commits: 0 });

        // WRITE TIMING: 12 rapid reroll REQUESTS inside the window — all
        // pending, the key still holds the boot envelope.
        for (let i = 0; i < 12; i++) controller.reroll();
        expect(controller.probe()).toMatchObject({
          pendingReroll: true,
          commits: 0,
        });
        expect(
          JSON.parse(localStorage.getItem(VIZ_PREFS_STORAGE_KEY)!),
        ).toEqual({ version: 1, presetId: "river-glass", seed: 1357 });

        // The window closes: ONE commit; the key now holds EXACTLY the
        // committed envelope (write-through, no amplification).
        await sleep(VIZ_REROLL_COALESCE_MS + 450);
        committed = controller.envelope();
        expect(controller.probe()).toMatchObject({
          commits: 1,
          rerollCommits: 1,
          pendingReroll: false,
        });
        expect(committed.presetId).toBe("river-glass"); // same rig, fresh seed
        expect(committed.seed).not.toBe(1357);
        expect(
          JSON.parse(localStorage.getItem(VIZ_PREFS_STORAGE_KEY)!),
        ).toEqual(committed);
      } finally {
        first.cleanup();
      }

      // SESSION CONTINUITY: close VIZ, reopen — the new page boots the
      // session's CURRENT deal (the committed one), never rewinds to the
      // envelope that was on disk at first mount (the disk already holds
      // it too: cross-boot continuity is the same value).
      const second = mountVizPage();
      try {
        const reopened = soleController();
        expect(reopened.envelope()).toEqual(committed);
        expect(reopened.envelope().seed).not.toBe(1357);
        expect(reopened.probe()).toMatchObject({
          commits: 0, // a fresh controller, the SESSION deal
        });
      } finally {
        second.cleanup();
      }
    },
  );

  it(
    "corrupt JSON and an unknown presetId both boot the DEFAULT (first library preset) — silently",
    { timeout: 60_000 },
    async () => {
      // CORRUPT JSON: discarded to defaults, no crash, no UI error.
      localStorage.setItem(VIZ_PREFS_STORAGE_KEY, "{corrupt-memory");
      let page = mountVizPage();
      try {
        expect(soleController().envelope()).toEqual({
          version: 1,
          presetId: VIZ_DEFAULT_PRESET_ID,
          seed: VIZ_DEFAULT_SEED,
        });
      } finally {
        page.cleanup();
      }

      // UNKNOWN PRESET (an id from some hypothetical older library): same
      // fallback — the FIRST library preset, per the plan's wording.
      localStorage.setItem(
        VIZ_PREFS_STORAGE_KEY,
        JSON.stringify({ version: 1, presetId: "removed-in-v2", seed: 42 }),
      );
      resetVizPrefsForTests(); // a later session re-reads the key
      page = mountVizPage();
      try {
        expect(VIZ_DEFAULT_PRESET_ID).toBe(VIZ_PRESETS[0]!.id);
        expect(soleController().envelope()).toEqual({
          version: 1,
          presetId: VIZ_PRESETS[0]!.id,
          seed: VIZ_DEFAULT_SEED,
        });
      } finally {
        page.cleanup();
      }

      // And a fallback boot never WRITES the discarded value away — the
      // stale bytes sit untouched until the user's next committed deal.
      expect(localStorage.getItem(VIZ_PREFS_STORAGE_KEY)).toBe(
        JSON.stringify({ version: 1, presetId: "removed-in-v2", seed: 42 }),
      );
    },
  );

  it(
    "a keyless boot stays keyless (no boot-time write); one cycle commit writes the new deal",
    { timeout: 60_000 },
    async () => {
      expect(localStorage.getItem(VIZ_PREFS_STORAGE_KEY)).toBeNull();
      const page = mountVizPage();
      try {
        const controller = soleController();
        expect(controller.envelope()).toEqual({
          version: 1,
          presetId: VIZ_DEFAULT_PRESET_ID,
          seed: VIZ_DEFAULT_SEED,
        });
        // Let the page run a beat: restore reads, boots, draws — no write.
        await sleep(250);
        expect(localStorage.getItem(VIZ_PREFS_STORAGE_KEY)).toBeNull();

        // One committed cycle = one write of exactly the committed deal.
        controller.cycle(1);
        const committed = controller.envelope();
        expect(committed.presetId).toBe(VIZ_PRESETS[1]!.id);
        expect(
          JSON.parse(localStorage.getItem(VIZ_PREFS_STORAGE_KEY)!),
        ).toEqual(committed);
      } finally {
        page.cleanup();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// B. Built-bundle journeys — the cross-boot restore (what a returning user sees)
// ---------------------------------------------------------------------------

/** One sampled region of the canvas (fractions of the backing store). */
interface Region {
  readonly name: string;
  readonly fx: number;
  readonly fy: number;
  readonly size: number;
}

/**
 * Lane-anchor regions of a would-be restored rig: the FIRST node dealt per
 * lane, positioned by its placement fractions (anchorOf maps exactly these
 * to stage px — bloom anchors carry lit rest marks, the fingerprint gate's
 * proven detector shape).
 */
function laneAnchorRegions(presetId: string, seed: number): Region[] {
  const preset = VIZ_PRESETS.find((p) => p.id === presetId)!;
  const rig = generateArrangement(preset, seed);
  const regions: Region[] = [];
  for (const node of rig.nodes) {
    const lane = String(node.placement.lane);
    if (lane === "any") continue; // lane-bound anchors only (stable names)
    if (regions.some((r) => r.name === `${presetId}:${lane}`)) continue;
    const x = Number(node.placement.x);
    const y = Number(node.placement.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    regions.push({
      name: `${presetId}:${lane}`,
      fx: Math.min(1, Math.max(0, x)),
      fy: Math.min(1, Math.max(0, y)),
      size: 8,
    });
  }
  return regions;
}

describe("VZ-IM-3 built-bundle memory journeys (the returning user)", () => {
  it(
    "seeded boots render the seeded rig · same memory ⇒ identical stage across boots · different memory ⇒ different stage",
    { timeout: 240_000 },
    async () => {
      const A = { presetId: "first-light", seed: 20260905 };
      const C = { presetId: "wash-field", seed: 707070 };
      // Union of both rigs' lane anchors + center + a ground corner.
      const union: Region[] = [
        { name: "ground", fx: 0.03, fy: 0.03, size: 8 },
        { name: "center", fx: 0.5, fy: 0.5, size: 8 },
        ...laneAnchorRegions(A.presetId, A.seed),
        ...laneAnchorRegions(C.presetId, C.seed),
      ];
      expect(union.length).toBeGreaterThanOrEqual(6);

      const anchorNamesOf = (presetId: string): string[] =>
        union
          .filter((r) => r.name.startsWith(`${presetId}:`))
          .map((r) => r.name);
      expect(anchorNamesOf(A.presetId).length).toBe(4); // one per lane
      expect(anchorNamesOf(C.presetId).length).toBe(4);

      const fingerprints: Record<string, number[] | null>[] = [];
      const plans: readonly { prefs: typeof A; label: string }[] = [
        { prefs: A, label: "A-boot-1" },
        { prefs: A, label: "A-boot-2" },
        { prefs: C, label: "C-boot" },
      ];
      for (const plan of plans) {
        const app = await bootVizApp({
          width: 1280,
          height: 960,
          vizPrefs: plan.prefs,
        });
        try {
          // The key the app read carries EXACTLY the seeded envelope (the
          // product's own serializer wrote it — harness + product, one key).
          expect(JSON.parse(app.win.localStorage.getItem(KEY)!)).toEqual({
            version: 1,
            presetId: plan.prefs.presetId,
            seed: plan.prefs.seed,
          });
          await app.openViz();
          await harnessSleep(300); // the still diagram settles (fingerprint law)
          const read = app.readCanvasRegions(union);
          // THE RIG IS THE RESTORED MEMORY: the seeded rig's own lane
          // anchors are LIT above the ground corner — the exact deal the
          // envelope names rendered, not the default and not a blank.
          const ground = JSON.stringify(read.ground);
          for (const name of anchorNamesOf(plan.prefs.presetId)) {
            expect(
              JSON.stringify(read[name]),
              `${plan.label}: seeded anchor ${name} must be lit above ground`,
            ).not.toBe(ground);
          }
          fingerprints.push(read);
        } finally {
          await app.teardown();
        }
      }

      const sig = (
        read: Record<string, number[] | null>,
        name: string,
      ): string => JSON.stringify(read[name]);

      // SAME MEMORY, TWO BOOTS ⇒ byte-identical stage (the returning user
      // sees THEIR rig, deterministically re-dealt from the envelope).
      for (const region of union) {
        expect(
          sig(fingerprints[0]!, region.name) ===
            sig(fingerprints[1]!, region.name),
          `region ${region.name} must be identical across same-memory boots`,
        ).toBe(true);
      }

      // DIFFERENT MEMORY ⇒ visibly different stage.
      const differing = union.filter(
        (region) =>
          sig(fingerprints[2]!, region.name) !==
          sig(fingerprints[0]!, region.name),
      );
      expect(
        differing.length,
        "a different persisted deal must render a different stage",
      ).toBeGreaterThan(0);
    },
  );
});
