#!/usr/bin/env node
/**
 * CA-2 standalone fuzz soak (default 50,000 cases; override with --cases=N).
 *
 * Runs the exact same deterministic harness the unit suite uses
 * (tests/fuzz-codec.test.ts via vitest, case count injected through
 * FUZZ_CASES) — no duplicated logic, no new dependencies: the harness imports
 * the real TypeScript codec, and vitest is already the project's TS runner.
 * Same seeds as CI → CI's 2,000-case slice is a strict prefix-compatible
 * sample of this soak.
 *
 * Usage: node scripts/fuzz.mjs [--cases=50000]
 * Exit code 0 = all cases safe (validate or typed-reject, zero crashes).
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let cases = "50000";
const caseArg = args.find((a) => a.startsWith("--cases="));
if (caseArg) cases = caseArg.split("=")[1];

const vitestBin = path.join(root, "node_modules", ".bin", "vitest");
const result = spawnSync(
  vitestBin,
  ["run", "--project", "unit", "tests/fuzz-codec.test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, FUZZ_CASES: cases },
    cwd: root,
  },
);

if (result.error) {
  console.error(`[fuzz] failed to launch vitest: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
