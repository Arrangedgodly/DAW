/**
 * MB-1 unit guard — the mobile viewport meta is pinned in index.html.
 *
 * The responsive stage (tests/browser/mobile-viewport.test.ts) only behaves
 * as designed on a real mobile browser when the page declares
 * `width=device-width, initial-scale=1` — otherwise a 390px phone reports a
 * 980px layout viewport and every breakpoint computes against the wrong
 * width. The pin also REFUSES zoom-locking (`maximum-scale`,
 * `user-scalable=no`): the mobile addendum's non-goals deliberately do not
 * design for pinch-zoom, which means it must stay AVAILABLE (blocking it is
 * an accessibility regression, WCAG 1.4.4, not a scope decision).
 *
 * Same law as tests/csp.test.ts: pin the SOURCE so the meta and the
 * browser-gated layout can never drift apart silently.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MB-1 viewport meta guard", () => {
  it("index.html declares the responsive viewport exactly", () => {
    const html = readFileSync("index.html", "utf8");
    const content = html.match(
      /<meta\s+name="viewport"\s+content="([^"]*)"\s*\/>/,
    )?.[1];
    expect(content).toBeDefined();
    expect(content).toBe("width=device-width, initial-scale=1.0");
    // Exactly one viewport meta — no accidental duplicate.
    expect(html.match(/name="viewport"/g)?.length).toBe(1);
  });

  it("the meta never locks pinch-zoom (available ≠ designed-for)", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/maximum-scale/i);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/i);
  });

  it("built dist/index.html (when present) carries the same meta", () => {
    if (!existsSync("dist/index.html")) return; // pre-build unit run — fine
    const html = readFileSync("dist/index.html", "utf8");
    const content = html.match(
      /<meta\s+name="viewport"\s+content="([^"]*)"\s*\/>/,
    )?.[1];
    expect(content).toBe("width=device-width, initial-scale=1.0");
  });
});
