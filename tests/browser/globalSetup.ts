/**
 * TH-1 browser globalSetup (node side).
 *
 * Builds the production bundle (vite build → dist/) before the browser
 * tests run. The browser project serves dist/ same-origin as its publicDir,
 * so the frame-budget test can load the REAL built app (exact bundle users
 * get, incl. the solid JSX compile that the tester's HTTP transform path
 * cannot perform in-page) in a same-origin iframe.
 *
 * The build is cached by content: if dist/ already matches the current
 * sources it is still cheap (vite rebuilds; a few seconds), and correctness
 * always wins over CI seconds here.
 */

import { build } from "vite";

export default async function setup(): Promise<() => void> {
  await build({
    configFile: "vite.config.ts",
    logLevel: "error",
  });
  return () => {};
}
