/**
 * PS-2 — real-path content loader gate (browser).
 *
 * The unit gate (tests/content-loader.test.ts) pins logic with injected
 * fetch/decode; THIS test runs the real thing against the same origin that
 * serves the test page: dynamic-import the loader (proving the module
 * import alone performs ZERO fetches — the TH-4(d) lazy law at module
 * level), then load a drum piece + a pitched voice through the REAL fetch
 * and a REAL AudioContext.decodeAudioData. The built-app/CSP edges are the
 * zero-network journey's deliberate probes (same-origin ogg fetch succeeds
 * under `connect-src 'self'`; cross-origin blocked).
 */

import { describe, expect, it } from "vitest";

describe("PS-2 sample loader (real fetch + decode, same origin)", () => {
  it("module import fetches nothing; load() fetches + decodes once, then caches", async () => {
    const fetched: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push(String(input));
      return origFetch(input, init);
    }) as typeof fetch;
    try {
      const mod = await import("../../src/assets/content/loader");
      // give any stray microtask a chance — import must not fetch
      await new Promise((r) => setTimeout(r, 50));
      expect(fetched, "importing the loader must not fetch").toEqual([]);

      const loader = mod.createSampleLoader();
      const ctx = new AudioContext();
      try {
        const drum = await loader.load(ctx, "drums.808.kick");
        expect(drum.length).toBeGreaterThan(0);
        expect(drum.sampleRate).toBe(ctx.sampleRate);
        expect(fetched.length).toBe(1);
        expect(fetched[0]).toMatch(/drums-808-kick.*\.ogg(\?.*)?$/);
        expect(new URL(fetched[0], location.href).origin).toBe(
          location.origin,
        );
        expect(loader.isLoaded(ctx, "drums.808.kick")).toBe(true);

        // cache: same context, no second fetch
        await loader.load(ctx, "drums.808.kick");
        expect(fetched.length).toBe(1);

        // a pitched voice too — the Kenney lane of the manifest
        const voice = await loader.load(ctx, "voice.lead.phaserup");
        expect(voice.length).toBeGreaterThan(0);
        expect(fetched.length).toBe(2);

        // second context = its own decode (per-context rate law)
        const ctx2 = new AudioContext();
        try {
          await loader.load(ctx2, "drums.808.kick");
          expect(fetched.length).toBe(3);
        } finally {
          await ctx2.close();
        }
      } finally {
        await ctx.close();
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
