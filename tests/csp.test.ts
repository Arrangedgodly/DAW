/**
 * CA-1 unit guard — the strict CSP meta must ship in index.html verbatim.
 *
 * The browser journey (tests/browser/zero-network.test.ts) runs the built
 * app under this exact policy; this test pins the SOURCE so the meta and the
 * tested policy can never drift apart silently. It also proves the policy
 * survives into the built artifact when dist/ exists (the browser pipeline
 * rebuilds it; a stale-but-present dist is rebuilt before browser tests, and
 * vite build copies index.html through with the meta intact).
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSP_POLICY } from "./csp-policy";

const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />`;

describe("CA-1 CSP guard", () => {
  it("index.html carries the exact strict zero-network policy", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(meta);
    // Exactly one policy — no accidental duplicate/softer meta.
    expect(html.match(/http-equiv="Content-Security-Policy"/g)?.length).toBe(1);
  });

  it("built dist/index.html (when present) carries the same policy", () => {
    if (!existsSync("dist/index.html")) return; // pre-build unit run — fine
    const html = readFileSync("dist/index.html", "utf8");
    expect(html).toContain(`content="${CSP_POLICY}"`);
  });
});
