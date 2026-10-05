import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "27acaec";
const sourcePath = "src/audio/fx.ts";
const source = execFileSync("git", ["show", `${revision}:${sourcePath}`], {
  cwd: root,
  encoding: "utf8",
});
const start = source.indexOf("export function createReverbDevice(");
const end = source.indexOf(
  "\n// ---------------------------------------------------------------------------\n// FxChainHost",
  start,
);
if (start < 0 || end < 0)
  throw new Error("Could not extract baseline reverb factory");

const baselineFactory = source
  .slice(start, end)
  .replace(
    "export function createReverbDevice(",
    "export function createBaselineReverbDevice(",
  );
const fixtureSource = [
  `// Generated from ${revision}:${sourcePath}; regenerate with scripts/prepare-fx-control-cost-baseline.mjs.`,
  `import { renderImpulseResponse, type FxDeviceInstance } from "../../../src/audio/fx";`,
  `import type { FxDevice } from "../../../src/document/schema";`,
  "",
  baselineFactory,
  "",
].join("\n");
const formatter = resolve(root, "node_modules/prettier/bin/prettier.cjs");
const fixture = execFileSync(
  process.execPath,
  [formatter, "--parser", "typescript"],
  {
    cwd: root,
    encoding: "utf8",
    input: fixtureSource,
  },
);
const destination = resolve(
  root,
  "tests/browser/fixtures/fx-baseline-27acaec.ts",
);
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, fixture, "utf8");
process.stdout.write(
  `Wrote baseline reverb factory from ${revision} to ${destination}\n`,
);
