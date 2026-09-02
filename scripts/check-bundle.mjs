#!/usr/bin/env node
/**
 * TH-2 — bundle budget gate.
 *
 * Builds the app (real `npm run build`), then measures the production
 * dist/ and asserts the INITIAL-LOAD JavaScript stays ≤ 300 KB gzipped
 * (plan.md committed budget: "≤300 KB gz initial"). Initial-load JS =
 * the entry chunk plus every chunk it EAGERLY (statically) imports —
 * dynamic-import chunks (TH-2: the export pipelines) are excluded by
 * design; they load on demand from the Projects popover.
 *
 * Also prints the per-category breakdown the budget doc commits to
 * (js / fonts / worklet) and warns (not fails) on the ≤50 KB font budget
 * so a soft regression is visible before it becomes a hard one.
 *
 * Exit code: 0 within budget, 1 over (CI gate: `npm run check:bundle`).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const JS_BUDGET_KB = 300 * 1024; // bytes, gzipped
const FONT_BUDGET_KB = 50 * 1024; // bytes, raw woff2 (fonts are already compressed)

function build() {
  if (process.env.SKIP_BUILD === "1") {
    if (!existsSync(join(DIST, "index.html"))) {
      console.error("SKIP_BUILD=1 but dist/ has no build — run npm run build first.");
      process.exit(1);
    }
    console.log("check-bundle: SKIP_BUILD=1 — measuring existing dist/");
    return;
  }
  console.log("check-bundle: building (tsc --noEmit && vite build)…");
  execFileSync("npm", ["run", "build"], { stdio: "inherit", cwd: ROOT });
}

/** All <script type="module" src=...> entry points in dist/index.html. */
function entryScripts() {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const srcs = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(
    (m) => m[1],
  );
  if (srcs.length === 0) throw new Error("no module script found in dist/index.html");
  return srcs;
}

/** Static (eager) import graph from a chunk's source. Names are "assets/<file>". */
function eagerImports(chunkName, seen = new Set()) {
  if (seen.has(chunkName)) return seen;
  seen.add(chunkName);
  const src = readFileSync(join(DIST, chunkName), "utf8");
  for (const m of src.matchAll(/import\s[^"']*from?\s*["'](\.\/[^"']+\.(?:js|mjs))["']/g)) {
    eagerImports(`assets/${m[1].slice(2)}`, seen);
  }
  // Chunk-to-chunk static imports may also appear as plain import "..." forms.
  for (const m of src.matchAll(/import\s*["'](\.\/[^"']+\.(?:js|mjs))["']/g)) {
    eagerImports(`assets/${m[1].slice(2)}`, seen);
  }
  return seen;
}

const gz = (bytes) => gzipSync(bytes, { level: 9 }).length;
const kb = (bytes, digits = 2) => `${(bytes / 1024).toFixed(digits)} KB`;

build();

const assets = join(DIST, "assets");
const allJs = readdirSync(assets).map((f) => `assets/${f}`).filter((f) => f.endsWith(".js"));
const entryNames = entryScripts().map((s) => s.replace(/^\/?/, ""));
const eager = new Set();
for (const e of entryNames) eagerImports(e, eager);

const sizes = new Map(); // assets/<file> -> gz bytes
for (const f of allJs) sizes.set(f, gz(readFileSync(join(DIST, f))));

const initialJs = [...eager].reduce((n, f) => n + (sizes.get(f) ?? 0), 0);
const lazyJs = allJs.filter((f) => !eager.has(f));

const fonts = readdirSync(assets).filter((f) => f.endsWith(".woff2")).map((f) => `assets/${f}`);
const fontBytes = fonts.reduce((n, f) => n + readFileSync(join(DIST, f)).length, 0);
// The worklet asset (matched by name) is fetched via URL when audio starts —
// it is never module-imported, so it can never appear in the eager graph;
// listed under its own category so the breakdown names it explicitly.
const worklet = allJs.filter((f) => /voiceEngine|worklet/i.test(f));


console.log("\nBundle breakdown (TH-2 gate):");
console.log("  initial-load JS (entry + eager chunks, gz):");
for (const f of [...eager].sort()) console.log(`    ${f.padEnd(34)} ${kb(sizes.get(f) ?? 0).padStart(9)}`);
console.log(`    ${"-".repeat(34)} ${"-".repeat(9)}`);
console.log(`    ${"TOTAL".padEnd(34)} ${kb(initialJs).padStart(9)}`);
console.log("  lazy chunks (dynamic import, on demand, gz):");
for (const f of lazyJs.sort())
  console.log(`    ${f.padEnd(34)} ${kb(sizes.get(f) ?? 0).padStart(9)}${worklet.includes(f) ? "  (worklet: fetched at first play)" : ""}`);
console.log(`  fonts (woff2, raw): ${fonts.length} files, ${kb(fontBytes)} — budget ≤ 50 KB ${fontBytes > FONT_BUDGET_KB ? "OVER" : "ok"}`);
const cssFile = readdirSync(assets).find((f) => f.endsWith(".css"));
if (cssFile)
  console.log(`  css (info, not gated): ${cssFile} ${kb(gz(readFileSync(join(assets, cssFile))))} gz`);

console.log(
  `\nGate: initial JS ${kb(initialJs)} gz ≤ 300 KB gz → ${initialJs <= JS_BUDGET_KB ? "PASS" : "FAIL"}`,
);
if (initialJs > JS_BUDGET_KB) {
  console.error(`Bundle budget exceeded: ${kb(initialJs)} > 300 KB gz initial JS.`);
  process.exit(1);
}
if (fontBytes > FONT_BUDGET_KB) {
  // Fonts are a committed budget (perf-budget.md §4) — hard-fail too.
  console.error(`Font budget exceeded: ${kb(fontBytes)} > 50 KB woff2.`);
  process.exit(1);
}
