/* global process */
import { readFile } from "node:fs/promises";
import { summarizeAndroidWindow } from "./android-live-math.mjs";

const path = process.argv[2];
if (!path) throw new Error("Usage: node tests/perf/android-live-report.mjs <raw.json>");
const raw = JSON.parse(await readFile(path, "utf8"));
const summaries = raw.windows.map(summarizeAndroidWindow);
process.stdout.write(JSON.stringify({ revision: raw.revision, mode: raw.mode,
  device: raw.device, windows: summaries, traces: raw.traces, errors: raw.errors }, null, 2) + "\n");
