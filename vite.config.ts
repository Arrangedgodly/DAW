import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

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
          // binding. We use the vanilla store only (D1): alias it away and
          // inline the deps so node-mode externalization can't bypass the
          // alias (neither test nor build ever resolves react).
          alias: [
            { find: /^zustand$/, replacement: "zustand/vanilla" },
          ],
          server: { deps: { inline: ["zundo", "zustand"] } },
          include: ["tests/**/*.test.ts"],
          // D8 / RES-7: a second vitest project in browser mode
          // (playwright provider, pinned Chromium) for the audio determinism
          // suite is added with IM-5/HW-2 — real OfflineAudioContext in-test.
          // It must NOT be added earlier: node/jsdom cannot render audio
          // (jsdom Web Audio open since 2020, #2900).
        },
      },
    ],
  },
});
