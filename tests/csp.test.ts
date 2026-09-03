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


describe("CA-1 CSP guard", () => {
  it("index.html carries the exact strict zero-network policy", () => {
    const html = readFileSync("index.html", "utf8");
    // Formatting-tolerant: extract the content attribute (prettier may wrap the
    // tag across lines) and pin its VALUE verbatim against the canonical policy.
    const content = html.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/,
    )?.[1];
    expect(content).toBeDefined();
    expect(content).toBe(CSP_POLICY);
    // Exactly one policy — no accidental duplicate/softer meta.
    expect(html.match(/http-equiv="Content-Security-Policy"/g)?.length).toBe(1);
  });

  it("built dist/index.html (when present) carries the same policy", () => {
    if (!existsSync("dist/index.html")) return; // pre-build unit run — fine
    const html = readFileSync("dist/index.html", "utf8");
    expect(html).toContain(`content="${CSP_POLICY}"`);
  });

  // PS-2: connect-src was refined 'none' -> 'self' for lazy same-origin
  // sample content (RES-10). These pins make the refinement un-widenable:
  // same-origin only, never a third-party hole.
  it("connect-src is exactly 'self' — same-origin asset fetch only", () => {
    const connect = CSP_POLICY.match(/connect-src ([^;]+)/)?.[1];
    expect(connect?.trim()).toBe("'self'");
  });

  it("no directive may grant a host, scheme, wildcard, or blob: source", () => {
    const allowed = new Set(["'self'", "'none'", "data:"]);
    for (const directive of CSP_POLICY.split(";")) {
      const d = directive.trim();
      if (!d) continue;
      // The only granted keywords are 'self', 'none', and data: (font/img
      // inlining) — anything else (https:, *., *.tld, blob:) is a widening.
      const granted = d.slice(d.indexOf(" ") + 1);
      for (const token of granted.split(/\s+/)) {
        expect(
          allowed.has(token),
          `unexpected CSP source token "${token}" in "${d}"`,
        ).toBe(true);
      }
    }
    expect(CSP_POLICY).not.toMatch(/blob:|https?:|\*/);
  });
});
