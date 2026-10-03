import { defineConfig } from "vite";
import { playwright } from "@vitest/browser-playwright";
import base from "./vite.config.ts";

/** Separate native acceptance run: never enable experimental APIs for ordinary UI tests. */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: base.test.projects
      .filter((project) => "browser" in project.test)
      .map((project) => ({
        ...project,
        test: {
          ...project.test,
          include: ["tests/browser/webmcp-native.acceptance.tsx"],
          browser: {
            ...("browser" in project.test ? project.test.browser : {}),
            enabled: true,
            provider: playwright({
              launchOptions: {
                ...(process.env.BITBOUNCE_BROWSER_CHANNEL
                  ? { channel: process.env.BITBOUNCE_BROWSER_CHANNEL }
                  : {}),
                args: [
                  "--autoplay-policy=no-user-gesture-required",
                  "--enable-blink-features=WebMCP",
                  "--enable-experimental-web-platform-features",
                ],
              },
            }),
          },
        },
      })),
  },
});
