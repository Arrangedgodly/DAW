/**
 * CA-1 browser test — ZERO-NETWORK JOURNEY under the full production CSP.
 *
 * Town-hall acceptance criterion 9: "Zero network calls at runtime; no data
 * leaves the device except explicit file exports." This test proves it by
 * running the REAL BUILT app (the exact dist/ bundle users get — globalSetup
 * builds it, and the browser project serves dist/ as publicDir so every
 * absolute /assets/... URL resolves exactly as in deployment: hashed bundle,
 * CSS, self-hosted fonts, the audio worklet module, and the on-demand
 * exportWav/exportMidi dynamic-import chunks) inside an about:blank iframe
 * written with the EXACT CSP meta from index.html (tests/csp-policy.ts; the
 * unit guard tests/csp.test.ts pins source ↔ constant drift).
 *
 * PS-2 refinement (2026-09-03, recorded journey change): the CSP's
 * connect-src was widened from 'none' to 'self' — same-origin ONLY — for the
 * RES-10 lazy sample content (build-bundled hashed /assets/*.ogg). The
 * journey therefore now asserts: third-party calls stay at ZERO, while
 * same-origin bundled-asset fetches are permitted. After the main ledger,
 * two DELIBERATE probes pin both edges exactly:
 *   - POSITIVE: fetching a real committed content OGG through the iframe's
 *     fetch under the CSP succeeds, and its bytes decode via
 *     AudioContext.decodeAudioData (the PS-2 loader contract).
 *   - NEGATIVE: a cross-origin fetch is BLOCKED by the CSP (fetch rejects +
 *     a securitypolicyviolation event naming connect-src) — third-party
 *     remains impossible.
 *
 * Instrumentation, installed on the iframe window BEFORE any app code runs
 * (about:blank inherits the parent origin, so 'self' in the CSP covers the
 * dev-server origin serving the assets):
 *   - fetch / XMLHttpRequest.open / WebSocket / EventSource /
 *     navigator.sendBeacon shims that record (and would still allow) calls
 *   - a `securitypolicyviolation` listener (fires if the app ever attempts
 *     anything the CSP forbids — an attempted fetch is as damning as a
 *     completed one)
 *   - URL.createObjectURL recording (the only sanctioned data egress: the
 *     three explicit exports, which are programmatic blob downloads)
 *
 * Journey: boot → play 2 bars → edit cells → add + bypass an FX device →
 * export WAV → export MIDI → SAVE FILE → wait for the IndexedDB autosave
 * flush. Assertions: zero third-party fetch/XHR/WS/EventSource/beacon calls
 * (same-origin /assets/ fetches allowed — none occur on the boot path by
 * the TH-4(d) lazy law), zero CSP violations during the journey, every
 * performance resource entry same-origin, then the two deliberate probes.
 *
 * The iframe approach (vs. loading the served /index.html directly) exists
 * because (a) the dev pipeline strips the CSP meta (cspDevStrip — HMR needs
 * inline styles + ws:) so a dev-served index.html would silently run without
 * it, and (b) the shims must be installed before the app module executes,
 * which is only possible on a window we create ourselves.
 */

import { describe, expect, it } from "vitest";
import { CSP_POLICY } from "../csp-policy";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");
const contentOggGlob = import.meta.glob("/dist/assets/*.ogg");

interface NetworkCall {
  readonly kind: "fetch" | "xhr" | "websocket" | "eventsource" | "beacon";
  readonly target: string;
}

interface JourneyMonitor {
  calls: NetworkCall[];
  violations: string[];
  objectUrls: string[];
}

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
      setTimeout(check, 50);
    };
    check();
  });
}

describe("CA-1 zero-network journey (built app under full CSP)", () => {
  it(
    "boots, plays, edits, exports, and saves with zero network activity",
    { timeout: 120_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();
      // publicDir ("dist") maps the built asset URLs into /assets/...
      const scriptUrl = bundleKey.replace("/dist/", "/");
      const styleUrl = cssKey.replace("/dist/", "/");

      // --- Build the instrumented, CSP'd iframe ---------------------------
      const iframe = document.createElement("iframe");
      iframe.style.width = "1280px";
      iframe.style.height = "900px";
      document.body.appendChild(iframe);
      const win = iframe.contentWindow!;
      const monitor: JourneyMonitor = {
        calls: [],
        violations: [],
        objectUrls: [],
      };

      // Shims FIRST — the iframe document has not been written yet, so these
      // land before any app script can possibly run.
      const w = win as unknown as Record<string, unknown>;
      const origFetch = win.fetch.bind(win);
      w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const target =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        monitor.calls.push({ kind: "fetch", target });
        return origFetch(input as RequestInfo, init);
      };
      const OrigXHR = win.XMLHttpRequest;
      const RecXHR = class extends OrigXHR {
        open(
          method: string,
          url: string | URL,
          ...rest: [boolean?, (string | null)?]
        ) {
          monitor.calls.push({ kind: "xhr", target: String(url) });
          return super.open(method, url, ...rest);
        }
      };
      w.XMLHttpRequest = RecXHR;
      const OrigWS = win.WebSocket;
      const RecWS = class extends OrigWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          monitor.calls.push({ kind: "websocket", target: String(url) });
          super(url, protocols);
        }
      };
      w.WebSocket = RecWS;
      const OrigES = win.EventSource;
      if (OrigES) {
        const RecES = class extends OrigES {
          constructor(url: string | URL) {
            monitor.calls.push({ kind: "eventsource", target: String(url) });
            super(url);
          }
        };
        w.EventSource = RecES;
      }
      const nav = win.navigator as Navigator & {
        sendBeacon?: (u: string | URL) => boolean;
      };
      if (nav.sendBeacon) {
        nav.sendBeacon = (u: string | URL) => {
          monitor.calls.push({ kind: "beacon", target: String(u) });
          return true;
        };
      }
      const origCreateObjectURL = win.URL.createObjectURL.bind(win.URL);
      win.URL.createObjectURL = (blob: Blob) => {
        const url = origCreateObjectURL(blob);
        monitor.objectUrls.push(`${url} (${blob.type}, ${blob.size}B)`);
        return url;
      };

      // R14 hygiene: this journey EDITS + AUTOSAVES through the real boot
      // path into the shared-origin IndexedDB. Wipe it BEFORE the app boots
      // (deterministic first-run demo) and again in teardown so no journey
      // state leaks into later same-origin boots.
      await new Promise<void>((resolve) => {
        const req = win.indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      // Write the document: CSP meta is the FIRST thing in head (it must be
      // seen by the parser before any subresource), then the built stylesheet
      // and module. document.open() creates a fresh Document — attach the
      // violation listener to THAT document, before writing into it.
      const doc = iframe.contentDocument!;
      doc.open();
      doc.addEventListener("securitypolicyviolation", (e) => {
        monitor.violations.push(
          `${e.violatedDirective} blocked ${e.blockedURI}`,
        );
      });
      doc.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />
<link rel="stylesheet" href="${styleUrl}" />
</head><body><div id="root"></div>
<script type="module" src="${scriptUrl}"></script>
</body></html>`);
      doc.close();

      // --- BOOT ------------------------------------------------------------
      await poll(
        () => !!iframe.contentDocument?.querySelector(".booth"),
        15_000,
        "app to mount under CSP",
      );
      const appDoc = iframe.contentDocument!;
      expect(appDoc.querySelectorAll(".lane-grid").length).toBe(4);

      // --- PLAY 2 BARS ------------------------------------------------------
      const playBtn =
        appDoc.querySelector<HTMLButtonElement>(".booth-btn-play")!;
      playBtn.click();
      await poll(
        () => playBtn.textContent === "STOP",
        5_000,
        "transport to start",
      );
      let playheadMoves = 0;
      let lastTransform = "";
      const t0 = performance.now();
      while (performance.now() - t0 < 2_400) {
        await new Promise((r) => requestAnimationFrame(r));
        const ph = appDoc.querySelector<HTMLElement>(".grid-playhead");
        if (ph && ph.style.transform !== lastTransform) {
          lastTransform = ph.style.transform;
          playheadMoves++;
        }
      }
      playBtn.click(); // stop
      expect(
        playheadMoves,
        "playhead never moved — audio path dead?",
      ).toBeGreaterThan(10);

      // --- EDIT CELLS -------------------------------------------------------
      const cells = Array.from(
        appDoc.querySelectorAll<HTMLElement>(".lane-grid .cell"),
      );
      expect(cells.length).toBeGreaterThan(0);
      for (let i = 0; i < 24; i++) {
        cells[(i * 37) % cells.length].click();
      }

      // --- TOGGLE FX (open a lane's strip, add a device, bypass it) ---------
      // Refinement-1 law: only the SELECTED quadrant's FX entry is live
      // (the 24-cell walk above may have moved selection) — click the
      // visible one instead of the first `.head-fx` in document order.
      appDoc
        .querySelector<HTMLButtonElement>(
          '.lane-floor[data-editing="true"] .head-fx',
        )!
        .click();
      const addBtn = await (async () => {
        for (let i = 0; i < 40; i++) {
          const el = appDoc.querySelector<HTMLButtonElement>(".fx-add-btn");
          if (el) return el;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("FX strip never opened");
      })();
      addBtn.click();
      const addItem = await (async () => {
        for (let i = 0; i < 40; i++) {
          const el = appDoc.querySelector<HTMLButtonElement>(".fx-add-item");
          if (el) return el;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("FX add menu never opened");
      })();
      addItem.click();
      const fxMod = await (async () => {
        for (let i = 0; i < 40; i++) {
          const el = appDoc.querySelector<HTMLElement>(".fx-mod");
          if (el) return el;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("FX module never appeared");
      })();
      expect(fxMod).toBeTruthy();
      const bypass = appDoc.querySelector<HTMLButtonElement>(".fx-bypass-btn")!;
      bypass.click();
      await poll(
        () => !!appDoc.querySelector(".fx-mod.is-bypassed"),
        2_000,
        "FX bypass to latch",
      );

      // --- EXPORT WAV (offline render — real audio pipeline) ----------------
      const projectsBtn =
        appDoc.querySelector<HTMLButtonElement>(".projects-btn")!;
      projectsBtn.click();
      const actionByLabel = async (label: string) => {
        for (let i = 0; i < 60; i++) {
          const b = Array.from(
            appDoc.querySelectorAll<HTMLButtonElement>(".projects-action"),
          ).find((x) => x.textContent?.trim() === label && !x.disabled);
          if (b) return b;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`projects action ${label} not found`);
      };
      (await actionByLabel("EXPORT WAV")).click();
      await poll(
        () =>
          Array.from(appDoc.querySelectorAll(".toast-message")).some((t) =>
            t.textContent?.includes("WAV EXPORTED"),
          ),
        60_000,
        "WAV export toast",
      );

      // --- EXPORT MIDI (popover stays open through exports — no re-toggle) ---
      (await actionByLabel("EXPORT MIDI")).click();
      await poll(
        () =>
          Array.from(appDoc.querySelectorAll(".toast-message")).some((t) =>
            t.textContent?.includes("MIDI EXPORTED"),
          ),
        10_000,
        "MIDI export toast",
      );

      // --- SAVE FILE (project JSON download) ---------------------------------
      (await actionByLabel("SAVE FILE")).click();

      // --- SAVE PROJECT (autosave → real IndexedDB) ---------------------------
      await poll(
        () =>
          appDoc
            .querySelector(".save-indicator")
            ?.getAttribute("data-status") === "saved",
        15_000,
        "autosave flush to IndexedDB",
      );

      // Let any trailing rAF/idle work settle before reading the ledger.
      await new Promise((r) => setTimeout(r, 500));

      // --- THE LEDGER ----------------------------------------------------------
      // 1. Zero THIRD-PARTY network API calls (PS-2: same-origin bundled
      //    asset fetches are permitted — none occur on the boot→save path by
      //    the TH-4(d) lazy law, but the allowance is deliberate).
      const sameOriginAllowed = (target: string) => {
        try {
          const u = new URL(target, win.location.href);
          return (
            u.origin === win.location.origin &&
            u.pathname.startsWith("/assets/")
          );
        } catch {
          return false;
        }
      };
      const thirdParty = monitor.calls.filter(
        (c) => !sameOriginAllowed(c.target),
      );
      expect(
        thirdParty,
        `third-party network API calls: ${JSON.stringify(thirdParty)}`,
      ).toEqual([]);

      // 2. Zero CSP violations during the journey — nothing even ATTEMPTED a
      //    forbidden load (the deliberate negative probe below is checked
      //    separately, after this point).
      expect(
        monitor.violations,
        `CSP violations: ${JSON.stringify(monitor.violations)}`,
      ).toEqual([]);

      // 3. Every resource the page loaded was same-origin (module, CSS,
      //    fonts, worklet, on-demand export chunks). No cross-origin URL,
      //    no CDN, no data leaving the device.
      const entries = win.performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      expect(entries.length).toBeGreaterThan(3); // the app really loaded things
      // `data:` URLs (the two smallest woff2 faces Vite inlines into the CSS,
      // per CA-1) are NOT network loads — nothing leaves the device — but
      // Chromium only sometimes surfaces them in resource timing, which made
      // this filter flake (HW-4 deflake). Only genuine remote URLs fail.
      const crossOrigin = entries.filter(
        (e) =>
          !e.name.startsWith("data:") &&
          !e.name.startsWith(win.location.origin),
      );
      expect(
        crossOrigin.map((e) => e.name),
        "cross-origin resource loads",
      ).toEqual([]);

      // 4. The ONLY sanctioned egress: the three explicit exports, all
      //    programmatic blob-anchor downloads (never network writes).
      expect(monitor.objectUrls.length).toBeGreaterThanOrEqual(3);
      const exportSummary = monitor.objectUrls.join(", ");
      expect(exportSummary).toContain("audio/wav");
      expect(exportSummary).toContain("audio/midi");

      console.log(
        `[CA-1 zero-network] resources=${entries.length} (all same-origin) ` +
          `thirdPartyCalls=0 cspViolations=0 ` +
          `blobDownloads=${monitor.objectUrls.length}`,
      );

      // --- PS-2 DELIBERATE PROBES (recorded journey extension) --------------
      // The connect-src 'self' refinement has exactly two edges; pin both.
      const oggKeys = Object.keys(contentOggGlob);
      expect(
        oggKeys.length,
        "committed content OGGs missing from dist/assets — " +
          "did the PS-2 loader entry stop emitting them?",
      ).toBeGreaterThanOrEqual(33);

      // POSITIVE: a real committed content OGG fetched + decoded under the
      // full CSP through the iframe's own fetch/AudioContext.
      const oggUrl = oggKeys[0].replace("/dist/", "/");
      const res = await win.fetch(oggUrl);
      expect(
        res.ok,
        `same-origin content fetch ${oggUrl} blocked by CSP?`,
      ).toBe(true);
      const bytes = await res.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(1000);
      const probeCtx = new win.AudioContext();
      try {
        const buffer = await probeCtx.decodeAudioData(bytes.slice(0));
        expect(buffer.length).toBeGreaterThan(0);
        expect(buffer.sampleRate).toBe(probeCtx.sampleRate);
      } finally {
        await probeCtx.close();
      }

      // NEGATIVE: a cross-origin fetch must be BLOCKED — rejected promise +
      // a CSP violation naming connect-src. Third-party stays impossible.
      const before = monitor.violations.length;
      await expect(
        win.fetch("https://bitbounce-csp-negative-probe.example/x.ogg"),
        "cross-origin fetch was NOT blocked by the CSP",
      ).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 100)); // violation event is async
      expect(monitor.violations.length).toBe(before + 1);
      expect(monitor.violations[before]).toContain("connect-src");

      console.log(
        `[CA-1 PS-2 probes] sameOriginOgg=${oggUrl} ` +
          `${bytes.byteLength}B decoded; crossOriginBlockedBy=CSP`,
      );

      iframe.remove();
      // R14 teardown: remove the iframe FIRST (closing its open DB
      // connections — deleting under a live connection only blocks), then
      // wipe the shared-origin DB (retry while the removal settles) so no
      // journey state leaks into later same-origin boots.
      for (let attempt = 0; ; attempt++) {
        const deleted = await new Promise<boolean>((resolve) => {
          const req = indexedDB.deleteDatabase("bitbounce");
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(true);
          req.onblocked = () => resolve(false);
        });
        if (deleted || attempt >= 20) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    120_000,
  );
});
