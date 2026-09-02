import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
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
