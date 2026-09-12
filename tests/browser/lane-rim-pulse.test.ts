/**
 * T5 browser gate — the lane-rim sounding pulse contract (route.md
 * playback-reactivity #5; plan T5 AC (a)/(c)/(d)) on the REAL BUILT APP:
 *
 * 1. IDLE: no .lane-floor carries .is-sounding (zero phantom pulses).
 * 2. PULSE CADENCE (motion mode): while the demo song plays, every lane's
 *    floor toggles .is-sounding — PRESENT at least twice and ABSENT at
 *    least once per lane over the window (the beat heartbeat at the
 *    demo's 112 bpm ≈ 536 ms; the class is held ~120 ms then removed — a
 *    stuck-lit, missing, or never-removed pulse all fail).
 * 3. SCOPE: .is-sounding only ever appears on .lane-floor elements (the
 *    chassis that carries the rim grammar).
 * 4. PARK: after STOP and the 120 ms decay, zero floors carry the class.
 * 5. REDUCED-MOTION TWIN (the JS half — add-and-hold; the CSS static-lit
 *    half is verified by the task's visual probe, the established
 *    suite/probe split): with matchMedia stubbed to "reduce" BEFORE boot,
 *    while playing the class is HELD statically — present at EVERY sample
 *    across ≥1.2 s (no blink churn) on all four floors — and cleared
 *    after STOP.
 *
 * Harness shape: rail-active-follow (fresh same-origin iframe, IDB wiped
 * for the deterministic first-run demo, real PLAY through the booth
 * button). The renderer contract behind this — onStepPulse fires per
 * crossed step from the EXISTING rAF loop and null on the playing→parked
 * edge — cannot run in the node unit project (no DOM); this built-app
 * gate is its coverage (additive; render.test.ts stays untouched).
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEW_W = 1440;
const VIEW_H = 900;
const LANES = ["drums", "bass", "chords", "lead"] as const;
/** Demo tempo (112 bpm): beat ≈ 536 ms; pulse hold 120 ms. */
const DEMO_BEAT_MS = 60_000 / 112;
const PULSE_HOLD_MS = 120;
const SAMPLE_MS = 25;

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

interface BootedApp {
  readonly doc: () => Document;
  readonly playBtn: () => HTMLButtonElement;
}

/** Boot the built app in a fresh iframe; `forceReducedMotion` stubs the
 * iframe's matchMedia BEFORE the module loads (the JS half of the twin). */
async function bootApp(forceReducedMotion: boolean): Promise<BootedApp & {
  iframe: HTMLIFrameElement;
}> {
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

  if (forceReducedMotion) {
    const orig = win.matchMedia.bind(win);
    win.matchMedia = ((q: string) => {
      if (q.includes("prefers-reduced-motion")) {
        return {
          matches: true,
          media: q,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList;
      }
      return orig(q);
    }) as typeof window.matchMedia;
  }

  await new Promise<void>((resolve) => {
    const req = win.indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

  const doc0 = iframe.contentDocument!;
  doc0.open();
  doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey!.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey!.replace("/dist/", "/")}"></script>
</body></html>`);
  doc0.close();

  const doc = () => iframe.contentDocument!;
  await poll(() => !!doc().querySelector(".booth"), 15_000, "boot");
  const playBtn = () =>
    doc().querySelector<HTMLButtonElement>(".booth-btn-play")!;
  return { iframe, doc, playBtn };
}

async function wipeDb(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const deleted = await new Promise<boolean>((resolve) => {
      const req = indexedDB.deleteDatabase("bitbounce");
      req.onsuccess = req.onerror = () => resolve(true);
      req.onblocked = () => resolve(false);
    });
    if (deleted || attempt >= 20) break;
    await waitMs(100);
  }
}

const soundingLanes = (doc: () => Document): string[] =>
  Array.from(doc().querySelectorAll(".lane-floor.is-sounding")).map((el) =>
    el.getAttribute("data-lane") ?? "?",
  );

describe("T5 lane-rim sounding pulse (built app)", () => {
  it(
    "idle shows no phantom · playing pulses .is-sounding per beat on every lane-floor · park clears · reduced-motion holds statically",
    { timeout: 120_000 },
    async () => {
      const app = await bootApp(false);
      const { iframe, doc, playBtn } = app;
      try {
        await poll(
          () =>
            Array.from(doc().querySelectorAll(".head-ctl-value")).some((v) =>
              (v.textContent ?? "").includes("SOFT STEP"),
            ),
          5_000,
          "demo cues",
        );

        // ===== 1. IDLE — no phantom pulses ==============================
        expect(
          doc().querySelectorAll(".lane-floor.is-sounding").length,
          "idle: no lane-floor carries .is-sounding",
        ).toBe(0);

        // ===== 2/3. PLAY — beat cadence + scope =========================
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          5_000,
          "transport playing",
        );
        // First beat boundary lands within one beat of PLAY.
        await poll(
          () => doc().querySelectorAll(".lane-floor.is-sounding").length > 0,
          Math.ceil(DEMO_BEAT_MS * 2),
          "first rim pulse",
        );

        // Sample ≥2 beats: each lane PRESENT ≥2 and ABSENT ≥1 (a live
        // heartbeat, not stuck); .is-sounding never leaves .lane-floor.
        const present: Record<string, number> = {};
        const absent: Record<string, number> = {};
        for (const lane of LANES) {
          present[lane] = 0;
          absent[lane] = 0;
        }
        const WINDOW_MS = Math.ceil(DEMO_BEAT_MS * 4);
        const t0 = performance.now();
        while (performance.now() - t0 < WINDOW_MS) {
          const sounding = new Set(soundingLanes(doc));
          for (const lane of LANES) {
            if (sounding.has(lane)) present[lane]++;
            else absent[lane]++;
          }
          expect(
            Array.from(doc().querySelectorAll(".is-sounding")).every((el) =>
              el.classList.contains("lane-floor"),
            ),
            "scope: .is-sounding only ever rides .lane-floor",
          ).toBe(true);
          await waitMs(SAMPLE_MS);
        }
        for (const lane of LANES) {
          expect(
            present[lane],
            `${lane}: rim pulse seen PRESENT while playing (missing seam?)`,
          ).toBeGreaterThanOrEqual(2);
          expect(
            absent[lane],
            `${lane}: rim pulse seen ABSENT between beats (stuck-lit?)`,
          ).toBeGreaterThanOrEqual(1);
        }
        console.log(
          `[T5 rim pulse] motion mode over ${WINDOW_MS}ms @25ms samples — present/absent per lane: ` +
            LANES.map((l) => `${l}:${present[l]}/${absent[l]}`).join(" "),
        );

        // ===== 4. PARK — stop clears within the decay ===================
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          5_000,
          "transport stopped",
        );
        await waitMs(PULSE_HOLD_MS * 2 + 60); // hold + decay + margin
        expect(
          doc().querySelectorAll(".lane-floor.is-sounding").length,
          "parked: no lane-floor keeps .is-sounding (no idle phantom)",
        ).toBe(0);
      } finally {
        iframe.remove();
        await wipeDb();
      }

      // ===== 5. REDUCED MOTION — the JS twin half (static hold) =========
      const rm = await bootApp(true);
      const { iframe: rmIframe, doc: rmDoc, playBtn: rmPlay } = rm;
      try {
        await poll(
          () =>
            Array.from(rmDoc().querySelectorAll(".head-ctl-value")).some((v) =>
              (v.textContent ?? "").includes("SOFT STEP"),
            ),
          5_000,
          "demo cues (reduced-motion boot)",
        );
        expect(
          rmDoc().querySelectorAll(".lane-floor.is-sounding").length,
          "reduced-motion idle: no phantom",
        ).toBe(0);
        rmPlay().click();
        await poll(
          () => rmPlay().getAttribute("aria-pressed") === "true",
          5_000,
          "transport playing (reduced motion)",
        );
        await poll(
          () =>
            rmDoc().querySelectorAll(".lane-floor.is-sounding").length ===
            LANES.length,
          Math.ceil(DEMO_BEAT_MS * 2),
          "static lit rim on every lane (first beat)",
        );
        // HELD: present at EVERY sample across >2 beats — no blink churn.
        const HOLD_MS = Math.ceil(DEMO_BEAT_MS * 2.5);
        const t1 = performance.now();
        let samples = 0;
        while (performance.now() - t1 < HOLD_MS) {
          samples++;
          expect(
            rmDoc().querySelectorAll(".lane-floor.is-sounding").length,
            "reduced-motion playing: the lit rim is HELD (static twin, no churn)",
          ).toBe(LANES.length);
          await waitMs(SAMPLE_MS);
        }
        expect(samples).toBeGreaterThanOrEqual(30);
        rmPlay().click();
        await poll(
          () => rmPlay().getAttribute("aria-pressed") === "false",
          5_000,
          "transport stopped (reduced motion)",
        );
        await waitMs(PULSE_HOLD_MS * 2 + 60);
        expect(
          rmDoc().querySelectorAll(".lane-floor.is-sounding").length,
          "reduced-motion parked: the static rim clears (park edge)",
        ).toBe(0);
        console.log(
          `[T5 rim pulse] reduced-motion twin held statically over ${samples} samples, cleared on park`,
        );
      } finally {
        rmIframe.remove();
        await wipeDb();
      }
    },
    120_000,
  );
});
