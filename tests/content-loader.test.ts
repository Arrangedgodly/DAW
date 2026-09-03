/**
 * PS-2 — lazy sample-content loader unit gate.
 *
 * All network/audio surfaces are injected: these tests pin the LOGIC
 * (laziness, per-context caching, in-flight dedupe, typed failures,
 * same-origin discipline) without a browser. The real fetch+decode through
 * a real AudioContext runs in tests/browser/content-loader.test.ts, and the
 * built-app/CSP edge runs in tests/browser/zero-network.test.ts's
 * deliberate probes.
 */

import { describe, expect, it } from "vitest";
import {
  CONTENT_ASSETS,
  CONTENT_KIT_IDS,
  assertSameOrigin,
  assetUrl,
  createSampleLoader,
  getAsset,
  kitAssetIds,
  voiceAssetIds,
  type ContentAsset,
} from "../src/assets/content/loader";
import { DRUM_PIECES } from "../src/document/schema";

/** Minimal context stand-ins — the loader only keys on identity. */
const fakeCtx = () => ({}) as BaseAudioContext;

function fakeDeps() {
  const fetched: string[] = [];
  const decoded: string[] = [];
  const loader = createSampleLoader({
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      return new Response(new ArrayBuffer(64), { status: 200 });
    }) as typeof fetch,
    decode: async () => {
      decoded.push("x");
      return { length: 64 } as AudioBuffer;
    },
  });
  return { loader, fetched, decoded };
}

describe("PS-2 content manifest", () => {
  it("has unique ids and 33 assets (4 kits + extras + 6 voices)", () => {
    const ids = CONTENT_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(33);
  });

  it("covers every kit with all 6 drum pieces, extras only as variant 2", () => {
    for (const kit of CONTENT_KIT_IDS) {
      const assets = kitAssetIds(kit).map(
        (id) => getAsset(id) as Extract<ContentAsset, { kind: "drums" }>,
      );
      for (const piece of DRUM_PIECES) {
        const base = assets.filter(
          (a) => a.piece === piece && a.variant === undefined,
        );
        expect(base.length, `${kit}/${piece} must have exactly one base asset`)
          .toBe(1);
      }
      for (const a of assets) {
        if (a.variant !== undefined) {
          expect(a.variant, "extras are second variants").toBe(2);
          expect(a.kit, "extras only in the flagship kit").toBe("808");
        }
      }
    }
  });

  it("voice assets map onto the three pitched lane roles", () => {
    for (const role of ["bass", "chords", "lead"] as const) {
      const ids = voiceAssetIds(role);
      expect(ids.length, `role ${role}`).toBeGreaterThan(0);
      expect(ids.length, `role ${role}`).toBeLessThanOrEqual(6);
    }
  });

  it("every asset is CC0/MIT-class with a source URL", () => {
    for (const a of CONTENT_ASSETS) {
      expect(["CC0", "MIT"]).toContain(a.license);
      expect(a.sourceUrl).toMatch(/^https:\/\//);
      expect(a.author.length).toBeGreaterThan(0);
    }
  });

  it("assetUrl yields a URL naming the file (never fetches)", () => {
    for (const a of CONTENT_ASSETS) {
      const url = assetUrl(a.id);
      expect(url.length).toBeGreaterThan(0);
      expect(url.endsWith(a.file)).toBe(true);
    }
    expect(() => assetUrl("drums.nope.kick")).toThrowError(/unknown-id/);
  });
});

describe("PS-2 loader logic (injected fetch/decode)", () => {
  it("constructing a loader performs zero fetches", () => {
    const { loader, fetched } = fakeDeps();
    expect(fetched).toEqual([]);
    expect(loader.isLoaded(fakeCtx(), "drums.808.kick")).toBe(false);
  });

  it("loads once, caches per context, dedupes in-flight", async () => {
    const { loader, fetched } = fakeDeps();
    const ctxA = fakeCtx();
    const ctxB = fakeCtx();

    // concurrent loads of the same asset share one fetch/decode
    const [b1, b2] = await Promise.all([
      loader.load(ctxA, "drums.808.kick"),
      loader.load(ctxA, "drums.808.kick"),
    ]);
    expect(fetched.length).toBe(1);
    expect(b1).toBe(b2);
    expect(loader.isLoaded(ctxA, "drums.808.kick")).toBe(true);

    // cached: no further fetch on the same context
    await loader.load(ctxA, "drums.808.kick");
    expect(fetched.length).toBe(1);

    // a different context decodes its own copy (per-context rate law)
    await loader.load(ctxB, "drums.808.kick");
    expect(fetched.length).toBe(2);
  });

  it("surfaces typed failures without caching them", async () => {
    let fail = true;
    const fetched: string[] = [];
    const loader = createSampleLoader({
      fetchImpl: (async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        if (fail) return new Response("", { status: 404 });
        return new Response(new ArrayBuffer(8), { status: 200 });
      }) as typeof fetch,
      decode: async () => ({ length: 8 }) as AudioBuffer,
    });
    const ctx = fakeCtx();
    await expect(loader.load(ctx, "drums.808.kick")).rejects.toMatchObject({
      kind: "fetch",
      id: "drums.808.kick",
    });
    // a failed load is not cached — retry succeeds when the source recovers
    fail = false;
    await expect(loader.load(ctx, "drums.808.kick")).resolves.toMatchObject({
      length: 8,
    });
    expect(loader.isLoaded(ctx, "drums.808.kick")).toBe(true);
  });

  it("decode failures are typed and retried, unknown ids never fetch", async () => {
    const fetched: string[] = [];
    let decodeOk = false;
    const loader = createSampleLoader({
      fetchImpl: (async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        return new Response(new ArrayBuffer(8), { status: 200 });
      }) as typeof fetch,
      decode: async () => {
        if (!decodeOk) throw new Error("bad bytes");
        return { length: 8 } as AudioBuffer;
      },
    });
    const ctx = fakeCtx();
    await expect(loader.load(ctx, "voice.lead.highup")).rejects.toMatchObject({
      kind: "decode",
    });
    decodeOk = true;
    await expect(loader.load(ctx, "voice.lead.highup")).resolves.toMatchObject(
      { length: 8 },
    );

    await expect(loader.load(ctx, "not.an.id")).rejects.toMatchObject({
      kind: "unknown-id",
    });
    expect(fetched.length).toBe(2); // only the two voice.lead.highup fetches
  });

  it("evict clears the cache", async () => {
    const { loader, fetched } = fakeDeps();
    const ctx = fakeCtx();
    await loader.load(ctx, "drums.dusty.tom");
    expect(fetched.length).toBe(1);
    loader.evict(ctx);
    expect(loader.isLoaded(ctx, "drums.dusty.tom")).toBe(false);
    await loader.load(ctx, "drums.dusty.tom");
    expect(fetched.length).toBe(2);
  });
});

describe("PS-2 same-origin discipline (pure guard)", () => {
  it("accepts same-origin and relative URLs", () => {
    expect(() =>
      assertSameOrigin("x", "/assets/a.ogg", "https://bitbounce.example/app"),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        "x",
        "https://bitbounce.example/assets/a.ogg",
        "https://bitbounce.example/app",
      ),
    ).not.toThrow();
  });

  it("rejects cross-origin URLs with a typed error", () => {
    expect(() =>
      assertSameOrigin("x", "https://evil.example/a.ogg", "https://bitbounce.example/"),
    ).toThrowError(/cross-origin/);
    expect(() =>
      assertSameOrigin(
        "x",
        "//evil.example/a.ogg",
        "https://bitbounce.example/",
      ),
    ).toThrowError(/cross-origin/);
  });
});
