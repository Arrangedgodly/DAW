import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [solid()],
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
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          // zundo reaches for the zustand root entry, which pulls the React
          // binding. We use vanilla only (D1): alias it away and
          // inline the deps so node-mode externalization can't bypass the
          // alias (neither test nor build ever resolves react).
          alias: [
            { find: /^zustand$/, replacement: "zustand/vanilla" },
          ],
          server: { deps: { inline: ["zundo", "zustand"] } },
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**"],
        },
      },
      {
        test: {
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
          include: ["tests/browser/**/*.test.ts"],
          globalSetup: ["tests/browser/globalSetup.ts"],
          alias: [
            { find: /^zustand$/, replacement: "zustand/vanilla" },
          ],
          browser: {
            enabled: true,
            provider: playwright({
              launchOptions: {
                args: ["--autoplay-policy=no-user-gesture-required"],
              },
            }),
            instances: [{ browser: "chromium" }],
            headless: !!process.env.CI,
          },
          maxWorkers: 1,
          minWorkers: 1,
        },
      },
    ],
  },
});
