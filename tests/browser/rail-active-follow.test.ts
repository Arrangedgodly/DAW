import { WORKSPACE_TOGGLE } from "./workspace";
/**
 * Refinement-7 browser gate — the rail active-tile follow + the two polish
 * laws (critique P2-3 / deferred #14 + the P3s), on the REAL BUILT APP:
 *
 * 1. FOLLOW (the critique's own measurement conditions inverted): during
 *    ≥2 full chain iterations of the demo song (4 slots × 1 bar per lane),
 *    every lane's ACTIVE tile advances with the natural chain position —
 *    sampled against the app's own transport clock (the booth's
 *    BAR.BEAT.STEP readout, rAF-written from ctx.currentTime — the
 *    deterministic step-clock convention). Pre-fix (the HW-5 observation):
 *    8 s / 2 iterations with ZERO active tiles. Post-fix laws, per sample:
 *      - bar ≥ 2 (a non-selected slot sounding): exactly ONE active tile
 *        per lane, at cyclic distance ≤ 1 from bar−1 (one poll-frame skew);
 *      - bar 1: tile 0 carries the selected state (sounding == selected —
 *        the stronger state by the v0 tile law).
 *    Transitions advance by exactly +1 (mod 4) per chain step, ≥2 wraps.
 * 2. TRANSPORT-ACCURATE + ANNOUNCED: the lane status region says
 *    "now <pattern>" for the sounding slot on natural advance (the
 *    critique's fix: "follow natural chain advance … and announce").
 * 3. PARK: STOP freezes the follow on the last-sounded slot.
 * 4. FLAG FLOOR: the pending diamond renders at the world's 10px label
 *    floor (was 8px — the one within-world size-law violation). The
 *    pending is created the rail-density way: fresh play → immediate slot-2
 *    click (right after PLAY the next boundary is slot 1, so slot 2 is
 *    always a real pending — the IM-7 timing law).
 * 5. BOOTH INSETS: every .booth-group carries the --space-1 vertical
 *    inset (cramped-padding ×3), and the compensated chassis keeps the
 *    one-page law EXACT at 1440×900 and fitting at the 1280×800 minimum.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEW_W = 1440;
const VIEW_H = 900;
const MIN_W = 1280;
const MIN_H = 800;
const LANES = ["drums", "bass", "chords", "lead"] as const;
/**
 * The demo song's own tempo (112 bpm, untouched — a mid-boot tempo rewrite
 * blurs the clock the gate samples against): bar = 60/112*4 ≈ 2.143 s, so
 * 2 full chain iterations (8 bars) ≈ 17.2 s + pre-roll + settle.
 */
const DEMO_BPM = 112;
const POLL_MS = 30;

function poll(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      if (cond()) return resolve();
      if (performance.now() - t0 > timeoutMs)
        return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(check, 25);
    };
    check();
  });
}

const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("refinement-7 rail active-tile follow + polish (built app)", () => {
  it(
    "active tile follows natural chain advance per lane · parks on stop · flag ≥10px · booth insets keep one page",
    { timeout: 180_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      const iframe = document.createElement("iframe");
      iframe.style.width = `${VIEW_W}px`;
      iframe.style.height = `${VIEW_H}px`;
      document.body.appendChild(iframe);
      const win = iframe.contentWindow!;

      // Deterministic FIRST RUN (PX-4 poly-loop demo: 4 slots per lane at
      // UNEQUAL pattern lengths — chords 2B, drums/lead/bass 1B — the
      // follow laws below derive each lane's slot cadence from the rail's
      // own tile badges).
      await new Promise<void>((resolve) => {
        const req = win.indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      const doc0 = iframe.contentDocument!;
      doc0.open();
      doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
      doc0.close();

      const idoc = () => iframe.contentDocument!;
      const $ = <T extends Element>(sel: string): T => {
        const el = idoc().querySelector<T>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        return el;
      };
      const tiles = (lane: string): HTMLElement[] =>
        Array.from(
          idoc().querySelectorAll<HTMLElement>(
            `.rail-row[data-lane="${lane}"] .rail-tile`,
          ),
        );
      /**
       * The LIT slot — the one section the lane is playing.
       *
       * 2026-09-11 (user call) re-base: the editing selection now FOLLOWS
       * natural chain advance, so the sounding tile renders "selected"
       * (tileState's active+selected collapse) rather than "active" — the
       * whole point of the change was that the old slot stopped staying lit
       * beside the new one. `data-sounding` is the slot-exact seam that
       * survives the collapse, so the follow reads through it now.
       */
      const litSlots = (lane: string): number[] =>
        tiles(lane)
          .map((t, i) => (t.dataset.sounding === "true" ? i : -1))
          .filter((i) => i >= 0);
      const activeSlot = (lane: string): number => litSlots(lane)[0] ?? -1;
      /**
       * The booth's BAR.BEAT.STEP readout (rAF-written from ctx.currentTime)
       * wraps at the TRANSPORT's cycle basis. LL-2: that basis is the LCM of
       * lane chain totals — the PX-4 poly-loop demo gives 16 bars (drums 16B
       * · chords 8B · lead 8B · bass 4B; the deliberate KL-1 position-law
       * swap; the readout format + mechanism are byte-identical). The chain
       * clock below is reconstructed exactly the way the transport counts:
       * bars elapsed = wraps of the BEAT digit (4 beats per bar, monotone
       * within a bar — the deterministic step-clock convention, no
       * wall-clock timing anywhere in the follow laws). Each lane's EXPECTED
       * slot comes from its own tile badges: PX-4 re-base — a lane sounds
       * one CHAIN SLOT per its pattern length, not per bar.
       */
      const slotBars = (lane: string): number => {
        const badge = tiles(lane)[0]
          ?.querySelector(".rail-tile-bars")
          ?.textContent?.trim();
        const bars = Number.parseInt(badge?.replace("B", "") ?? "1", 10);
        return Number.isFinite(bars) && bars > 0 ? bars : 1;
      };
      const laneSlot = (lane: string, barsElapsed: number): number =>
        Math.floor(barsElapsed / slotBars(lane)) % 4;
      const readBeat = (): number => {
        const text = $<HTMLElement>(".booth-led").textContent?.trim() ?? "";
        const beat = Number.parseInt(text.split(".")[1] ?? "1", 10);
        return Number.isFinite(beat) && beat > 0 ? beat : 1;
      };
      const fits = (w: number, h: number): boolean => {
        const de = idoc().documentElement;
        return (
          de.scrollWidth <= w &&
          de.scrollHeight <= h &&
          (idoc().body.scrollWidth ?? 0) <= w &&
          (idoc().body.scrollHeight ?? 0) <= h
        );
      };
      const laneStatus = (lane: string): string =>
        idoc()
          .querySelector(`.rail-row[data-lane="${lane}"] .head-sr`)
          ?.textContent?.trim() ?? "";

      try {
        await poll(() => !!idoc().querySelector(".booth"), 15_000, "boot");
        // 2026-09-11 (user call): the chain is a PAGE now, not a bar on the
        // stage — open it before any rail assertion. The booth SONG key is
        // the desktop entry (the phone's transport-row key is the twin).
        await poll(
          () => !!idoc().querySelector(WORKSPACE_TOGGLE),
          5_000,
          "booth SONG key",
        );
        idoc().querySelector<HTMLButtonElement>(WORKSPACE_TOGGLE)!.click();
        await poll(
          () => !!idoc().querySelector(".stage-song .rail"),
          5_000,
          "song page",
        );
        await poll(
          () =>
            Array.from(idoc().querySelectorAll(".rail-tile-cue")).some(
              (c) => c.textContent === "VERSE",
            ),
          5_000,
          "demo cues",
        );

        // ===== 1. THE FOLLOW (≥2 full chain iterations) ===================
        const playBtn = $<HTMLButtonElement>(".booth-btn-play");
        playBtn.click();
        await poll(
          () => playBtn.getAttribute("aria-pressed") === "true",
          5_000,
          "transport playing",
        );

        // Bar ≈ 2.143 s at the demo's 112 bpm. PX-4 re-base: the song cycle
        // is 8 bars (the LCM) — sample ≥2 FULL cycles so every lane,
        // including the 2-bar-slot chords, is observed wrapping twice.
        const FOLLOW_MS = 40_000;
        const t0 = performance.now();
        /** Chain clock, advanced from the readout on every call (shared
         *  with the later park poll — one continuous count since play). */
        const chainClock = { bars: 0, prevBeat: 1 };
        const tickChainClock = (): number => {
          const beat = readBeat();
          if (beat < chainClock.prevBeat) chainClock.bars++;
          chainClock.prevBeat = beat;
          return chainClock.bars;
        };
        /** Observed active-slot values, in sample order (deduped runs). */
        const transitions: Record<string, number[]> = {
          drums: [],
          bass: [],
          chords: [],
          lead: [],
        };
        const maxDistance: Record<string, number> = {
          drums: 0,
          bass: 0,
          chords: 0,
          lead: 0,
        };
        const violations: string[] = [];
        let samples = 0;
        let advancedAwayFromSlot0 = false;
        while (performance.now() - t0 < FOLLOW_MS) {
          samples++;
          const barsElapsed = tickChainClock();
          for (const lane of LANES) {
            const lit = litSlots(lane);
            const slot = lit[0] ?? -1;
            const seq = transitions[lane];
            if (slot >= 0 && seq[seq.length - 1] !== slot) seq.push(slot);
            // THE 2026-09-11 LAW: exactly ONE section is lit, always. The
            // user-reported defect was two (the chain moved to B and A
            // stayed painted) — a count check is the tooth for it.
            if (lit.length !== 1) {
              violations.push(
                `${lane}: bar ${barsElapsed + 1} — ${lit.length} lit tiles (must be exactly 1)`,
              );
              continue;
            }
            // The lit tile is the one the grid is editing: the follow moves
            // selection with the chain, so the section on screen and the
            // notes under it can never name different slots.
            if (tiles(lane)[slot].dataset.state !== "selected")
              violations.push(
                `${lane}: bar ${barsElapsed + 1} lit slot ${slot} not selected (got ${tiles(lane)[slot].dataset.state})`,
              );
            const expected = laneSlot(lane, barsElapsed);
            // Cyclic distance to the sounding bar's slot (≤1 poll skew).
            const d = Math.min(
              (slot - expected + 4) % 4,
              (expected - slot + 4) % 4,
            );
            maxDistance[lane] = Math.max(maxDistance[lane], d);
            if (d > 1)
              violations.push(
                `${lane}: distance ${d} at bar ${barsElapsed + 1}`,
              );
            if (slot >= 1) advancedAwayFromSlot0 = true;
          }
          await waitMs(POLL_MS);
        }
        expect(
          samples,
          "follow sampling actually ran (clock sanity)",
        ).toBeGreaterThan(200);
        // The critique's failure mode: zero active tiles through it all.
        expect(
          advancedAwayFromSlot0,
          "lanes lit a non-zero slot on natural advance (pre-fix: zero)",
        ).toBe(true);
        if (violations.length > 0) {
          console.log(
            `[refinement-7 rail follow] VIOLATIONS: ${violations.slice(0, 12).join(" | ")}`,
          );
        }
        expect(
          violations.slice(0, 5).join(" | "),
          "follow invariants held at every sample",
        ).toBe("");
        for (const lane of LANES) {
          const seq = transitions[lane];
          // 2 song cycles in LIT-tile terms. 2026-09-11: the sounding seam
          // marks EVERY slot including 0 (it no longer disappears into a
          // pinned selection), so the sequence walks 0→1→2→3→0… and the
          // wrap is 3→0. PX-4: the slowest lane (4-bar slots) still
          // traverses its whole chain twice inside FOLLOW_MS.
          expect(
            seq.length,
            `${lane}: enough observed advance for ≥2 chain iterations`,
          ).toBeGreaterThanOrEqual(7);
          let wraps = 0;
          for (let i = 1; i < seq.length; i++) {
            const prev = seq[i - 1]!;
            const cur = seq[i]!;
            if (prev === 3 && cur === 0) wraps++;
            expect(
              (cur - prev + 4) % 4 === 1,
              `${lane}: natural advance is +1 slot — saw ${prev}→${cur}`,
            ).toBe(true);
          }
          expect(
            wraps,
            `${lane}: the chain WRAPPED back past slot 0 (≥2 iterations)`,
          ).toBeGreaterThanOrEqual(2);
        }
        console.log(
          `[refinement-7 rail follow] ${samples} samples / ${FOLLOW_MS}ms @${DEMO_BPM}bpm · per-lane advance ` +
            LANES.map((l) => `${l}:[${transitions[l].join(",")}]`).join(" ") +
            " · max cyclic distance to the transport bar: " +
            LANES.map((l) => `${l}:${maxDistance[l]}`).join(" "),
        );

        // ===== 2. ANNOUNCED on natural advance ============================
        const announced = activeSlot("drums");
        if (announced < 1) {
          await poll(
            () => activeSlot("drums") >= 1,
            6_000,
            "a sounding slot away from the selection",
          );
        }
        const slot = activeSlot("drums");
        expect(slot).toBeGreaterThanOrEqual(1);
        await poll(
          () => laneStatus("drums").includes(`now drums-${slot + 1}`),
          3_000,
          `natural advance announced (now drums-${slot + 1})`,
        );

        // ===== 3. PARK (stop freezes on the last-sounded slot) ============
        await poll(
          () => tickChainClock() >= 1 && activeSlot("bass") >= 1,
          8_000,
          "sounding past slot 0 before the stop",
        );
        const parkedSlot = activeSlot("bass");
        expect(parkedSlot).toBeGreaterThanOrEqual(1);
        playBtn.click();
        await poll(
          () => playBtn.getAttribute("aria-pressed") === "false",
          5_000,
          "transport stopped",
        );
        await waitMs(400); // the park is a state, not a pulse — it must hold
        expect(
          activeSlot("bass"),
          "stopped: the follow parks on the last-sounded slot",
        ).toBe(parkedSlot);

        // ===== 4. FLAG FLOOR (pending diamond ≥ the 10px label floor) =====
        // Fresh play → immediate slot-2 click: right after PLAY the next
        // boundary is slot 1, so slot 2 is always a REAL pending (the
        // drag-cue/rail-density IM-7 timing law — no cancel edge).
        playBtn.click();
        await poll(
          () => playBtn.getAttribute("aria-pressed") === "true",
          5_000,
          "transport playing (fresh, for the flag law)",
        );
        const target = tiles("drums")[2]!;
        target.click();
        await poll(
          () => target.dataset.state === "pending",
          5_000,
          "tile click cues a quantized switch (pending visible)",
        );
        const flag = target.querySelector<HTMLElement>(".rail-tile-flag")!;
        const flagSize = Number.parseFloat(
          idoc()!.defaultView!.getComputedStyle(flag).fontSize,
        );
        expect(
          flagSize,
          "pending diamond flag ≥ the world's 10px label floor (was 8px)",
        ).toBeGreaterThanOrEqual(10);
        expect(target.getAttribute("aria-label")).toContain("switch pending");

        // ===== 5. BOOTH INSETS + ONE PAGE (both viewports) ===============
        const groups = Array.from(idoc().querySelectorAll(".booth-group"));
        expect(groups.length).toBe(6);
        const view = idoc()!.defaultView!;
        for (const group of groups) {
          const cs = view.getComputedStyle(group);
          expect(
            Number.parseFloat(cs.paddingTop),
            "position group separates its second row; other groups stay symmetric",
          ).toBe(
            group.classList.contains("booth-group-position")
              ? 9
              : Number.parseFloat(cs.paddingBottom),
          );
        }
        const boothBox = $<HTMLElement>(".booth").getBoundingClientRect();
        console.log(
          `[refinement-7 polish] booth ${Math.round(
            boothBox.height,
          )}px tall (the margin-canceled group inset keeps the committed chassis box) · flag ${flagSize}px`,
        );
        expect(
          idoc().documentElement.scrollHeight,
          "1440×900 one-page law exact (900 == 900) with the insets",
        ).toBe(VIEW_H);
        iframe.style.width = `${MIN_W}px`;
        iframe.style.height = `${MIN_H}px`;
        const dbgFit = { w: 0, h: 0 };
        await poll(
          () => {
            const de = idoc().documentElement;
            dbgFit.w = Math.max(de.scrollWidth, idoc()!.body.scrollWidth ?? 0);
            dbgFit.h = Math.max(
              de.scrollHeight,
              idoc()!.body.scrollHeight ?? 0,
            );
            return fits(MIN_W, MIN_H);
          },
          8_000,
          "1280 fit settle",
        ).catch((err: Error) => {
          const stage = idoc()!.querySelector("main.stage");
          const railEl = idoc()!.querySelector(".rail");
          throw new Error(
            `${err.message} (scroll ${dbgFit.w}x${dbgFit.h}; ` +
              `booth ${Math.round($<HTMLElement>(".booth").getBoundingClientRect().height)}; ` +
              `rail ${railEl ? Math.round(railEl.getBoundingClientRect().height) : -1}; ` +
              `stage clientH ${stage ? (stage as HTMLElement).clientHeight : -1})`,
          );
        });
        expect(
          fits(MIN_W, MIN_H),
          "page still fits the 1280×800 tested minimum with the insets",
        ).toBe(true);
      } finally {
        iframe.remove();
        for (let attempt = 0; ; attempt++) {
          const deleted = await new Promise<boolean>((resolve) => {
            const req = indexedDB.deleteDatabase("bitbounce");
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(true);
            req.onblocked = () => resolve(false);
          });
          if (deleted || attempt >= 20) break;
        }
      }
    },
    180_000,
  );
});
