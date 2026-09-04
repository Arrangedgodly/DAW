import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { playwright } from "@vitest/browser-playwright";
import { onRenderFingerprintConsoleLog } from "./tests/golden/render-fp-recorder.ts";
import type { Plugin } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * CA-1: the strict zero-network CSP meta in index.html (connect-src 'none' …)
 * is the production privacy guarantee, but `vite dev` cannot live under it —
 * HMR injects inline <style> tags (style-src 'unsafe-inline') and opens a
 * ws:// websocket (connect-src ws:). Serve-only transform: strip the meta
 * from the dev page so DX keeps working. Builds are untouched — the served
 * artifact always carries the full policy, and the browser pipeline test
 * (tests/browser/zero-network.test.ts) re-applies the exact built policy to
 * a real journey to prove the app runs clean under it.
 */
function cspDevStrip(): Plugin {
  return {
    name: "csp-dev-strip",
    apply: "serve",
    transformIndexHtml(html) {
      return html
        .replace(/\s*<!--\s*\n?\s*CA-1 zero-network[\s\S]*?-->\n?/, "")
        .replace(
          /\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>\n?/,
          "\n",
        );
    },
  };
}

export default defineConfig({
  plugins: [solid(), cspDevStrip()],
  build: {
    rollupOptions: {
      // PS-2 (RES-10): emit the sample-content loader as its OWN entry so
      // the committed CC0 OGGs (referenced by its import.meta.glob) ship as
      // hashed same-origin /assets/*.ogg while staying OUT of the app's
      // initial-load JS graph — index.html never references this chunk, so
      // check-bundle counts it as lazy, and the app doesn't import it until
      // PS-4 wires the SampleVoiceHost (fetches happen only via load()).
      input: {
        // key "index" keeps the app entry chunk named index-<hash>.js — the
        // browser gates glob /dist/assets/index-*.js to load the built app.
        index: resolve(__dirname, "index.html"),
        content: resolve(__dirname, "src/assets/content/loader.ts"),
      },
    },
  },
  resolve: {
    alias: [
      {
        // Build-side twin of the test alias below: zundo imports the zustand
        // root entry (React binding); we use vanilla only (D1) so the bundle
        // never resolves react.
        find: /^zustand$/,
        replacement: "zustand/vanilla",
      },
    ],
  },
  test: {
    // DA-3: vite-plugin-solid's config hook defaults test-mode configs to a
    // jsdom environment (an uninstalled optional peer) when none is set.
    // Both projects pin node anyway; pin the root too so a bare `vitest run`
    // never attempts to load jsdom.
    environment: "node",
    // HW-2: browser tests can't write files; the render-fingerprint golden
    // test emits a machine-readable console line that this node-side hook
    // writes into tests/golden/manifest.json — only under UPDATE_GOLDENS=1
    // (npm run goldens:update). Non-prefixed lines pass through untouched.
    onConsoleLog: (log) => onRenderFingerprintConsoleLog(String(log)),
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          // zundo reaches for the zustand root entry, which pulls the React
          // binding. We use vanilla only (D1): alias it away and
          // inline the deps so node-mode externalization can't bypass the
          // alias (neither test nor build ever resolves react).
          alias: [{ find: /^zustand$/, replacement: "zustand/vanilla" }],
          server: { deps: { inline: ["zundo", "zustand"] } },
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**"],
        },
      },
      {
        // MF-3: browser tests import .tsx components (FileIO). Project servers
        // don't reliably apply the root solid() plugin's JSX transform, so
        // register it at project level for the served page.
        plugins: [solid()],
        // CA-1: serve the BUILT app (dist/, produced by globalSetup before
        // these tests run) as the publicDir so its absolute /assets/... URLs —
        // hashed bundle, CSS, fonts, worklet module, and the on-demand
        // exportWav/exportMidi dynamic-import chunks — all resolve same-origin
        // exactly as they do in deployment. The zero-network test loads the
        // built bundle in an iframe under the full production CSP this way.
        // Serve-only: `vite build` keeps the (empty) default publicDir.
        publicDir: "dist",
        test: {
          // vite-plugin-solid's config hook defaults mode==='test' projects to
          // a jsdom environment when none is set; pin node (browser mode
          // ignores it) so no jsdom install is ever attempted.
          environment: "node",
          // D8 / RES-7 / TH-1: browser-mode audio determinism + frame-budget
          // project. Real Chromium (pinned by the playwright version in
          // package.json → exact browser build) via the playwright provider;
          // headless whenever CI is set; workers: 1 so renders are not
          // contended; autoplay flag so AudioContext.resume() works without
          // a synthetic user gesture.
          name: "browser",
          // Projects do NOT inherit root config (plugins/resolve) unless they
          // extend it — the zustand vanilla alias comes from the root config.
          extends: true,
          include: ["tests/browser/**/*.test.{ts,tsx}"],
          globalSetup: ["tests/browser/globalSetup.ts"],
          alias: [{ find: /^zustand$/, replacement: "zustand/vanilla" }],
          browser: {
            enabled: true,
            provider: playwright({
              launchOptions: {
                args: ["--autoplay-policy=no-user-gesture-required"],
              },
            }),
            instances: [{ browser: "chromium" }],
            headless: !!process.env.CI,
            // Refinement-4 (critique P2-5): the browser gate runs at the
            // product's TESTED MINIMUM (DESIGN.md: 1280×800 — the one-page
            // law's floor, asserted by quadrant-layout §1b). vitest's default
            // 414×896 page viewport was never a deliberate choice: below
            // 1280 the page scrolls and view-only quadrants h-scroll with no
            // keyboard access (small-surface behavior the mobile slice MB-1/
            // MB-3 owns and will gate in its own viewport). Tests that size
            // their own iframes (quadrant-layout, frame-budget, e2e,
            // zero-network) are unaffected by this page viewport.
            viewport: { width: 1280, height: 800 },
          },
          maxWorkers: 1,
          minWorkers: 1,
        },
      },
    ],
  },
});
