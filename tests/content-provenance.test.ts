/**
 * PS-2 — PROVENANCE + content-budget gate (Captain America).
 *
 * Every committed byte under src/assets/content/ must be accounted for in
 * PROVENANCE.md (repo root) with file, size, sha256, license (CC0/MIT-class
 * ONLY), author, source URL, fetch date, and transformations — and the
 * machine-readable manifest (src/assets/content/loader.ts CONTENT_ASSETS)
 * must agree with both the rows and the bytes on disk. The budget pin is
 * the RES-10 envelope: ≤ 1 MB working / 2 MB hard. This runs in the unit
 * suite (`npm test`) so CI enforces it; `npm run check:content` is the
 * named alias.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_ASSETS } from "../src/assets/content/loader";

const CONTENT_DIR = "src/assets/content";
const PROVENANCE = "PROVENANCE.md";

const WORKING_BUDGET = 1024 * 1024; // 1 MB
const HARD_BUDGET = 2 * 1024 * 1024; // 2 MB

interface Row {
  file: string;
  bytes: number;
  sha256: string;
  license: string;
  author: string;
  source: string;
  fetched: string;
  transform: string;
}

function parseProvenance(): Row[] {
  const md = readFileSync(PROVENANCE, "utf8");
  const lines = md.split("\n");
  const header = lines.findIndex((l) => l.startsWith("| file |"));
  expect(header, "PROVENANCE.md table header not found").toBeGreaterThan(-1);
  const rows: Row[] = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 9 || cells[1] === "---") continue;
    rows.push({
      file: cells[1],
      bytes: Number(cells[2]),
      sha256: cells[3],
      license: cells[4],
      author: cells[5],
      source: cells[6],
      fetched: cells[7],
      transform: cells[8],
    });
  }
  return rows;
}

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("PS-2 PROVENANCE + content budget gate", () => {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".ogg"));
  const rows = parseProvenance();
  const rowsByFile = new Map(rows.map((r) => [r.file, r]));
  const totalBytes = files.reduce(
    (n, f) => n + statSync(`${CONTENT_DIR}/${f}`).size,
    0,
  );

  it("PROVENANCE.md accounts for every committed file — 1:1, no orphans", () => {
    expect(files.length).toBeGreaterThanOrEqual(33);
    expect(rows.length).toBe(files.length);
    for (const f of files) expect(rowsByFile.has(f), `missing row for ${f}`)
      .toBe(true);
    for (const r of rows)
      expect(files.includes(r.file), `row for absent file ${r.file}`).toBe(
        true,
      );
  });

  it("each row's size + sha256 recomputes from the bytes on disk", () => {
    for (const f of files) {
      const row = rowsByFile.get(f)!;
      const path = `${CONTENT_DIR}/${f}`;
      expect(row.bytes, `${f} size`).toBe(statSync(path).size);
      expect(row.sha256, `${f} sha256`).toBe(sha256(path));
    }
  });

  it("license rule: CC0/MIT-class only, verified source URL + fetch date", () => {
    for (const r of rows) {
      expect(["CC0", "MIT"]).toContain(r.license);
      expect(r.source).toMatch(
        /^https:\/\/(freesound\.org|kenney\.nl|github\.com)\//,
      );
      expect(r.fetched).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(r.author.length).toBeGreaterThan(0);
      expect(r.transform.length).toBeGreaterThan(0);
    }
  });

  it("manifest ↔ PROVENANCE ↔ disk agree (ids, files, license, source, author)", () => {
    const manifestByFile = new Map(CONTENT_ASSETS.map((a) => [a.file, a]));
    for (const a of CONTENT_ASSETS) {
      const row = rowsByFile.get(a.file);
      expect(row, `manifest asset ${a.id} has no PROVENANCE row`).toBeDefined();
      expect(manifestByFile.size).toBe(CONTENT_ASSETS.length); // unique files
      expect(row!.license).toBe(a.license);
      expect(row!.source).toBe(a.sourceUrl);
      expect(row!.author).toBe(a.author);
    }
    for (const f of files) {
      expect(
        manifestByFile.has(f),
        `file ${f} on disk is not in the manifest`,
      ).toBe(true);
    }
  });

  it("budget: ≤ 1 MB working / 2 MB hard (RES-10 envelope)", () => {
    expect(totalBytes).toBeLessThan(HARD_BUDGET);
    expect(
      totalBytes,
      `content grew past the 1 MB working budget (${totalBytes} B) — ` +
        `trim the library or move kits to v1`,
    ).toBeLessThanOrEqual(WORKING_BUDGET);
  });
});
