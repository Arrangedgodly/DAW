/**
 * HL-1 (iteration 3) unit laws — the MIGRATION-FALLBACK corpus at the import
 * boundary: legacy doc combos under the new (v3) model + the codec-cap
 * boundary + hostile v3 shapes. The UX proof through the REAL OPEN FILE
 * path (toast, store untouched, no partial row) is
 * tests/browser/migration-fallback-v3.test.ts; this file pins the typed
 * RESULT for every corpus class (unit, fake idb — the fileIO.test.ts
 * harness precedent).
 *
 * | # | Corpus class                                  | Typed result            |
 * |---|-----------------------------------------------|-------------------------|
 * | 1 | 3.9 MB VALID-JSON file (under the 4 MB cap)   | imports (decode passes) |
 * | 2 | 4.1 MB VALID-JSON file (over the cap)         | too-large, HONEST msg   |
 * |   |                                               | (never "not valid JSON")|
 * | 3 | 65+-deep VALID-JSON nesting                   | corrupt, "too deeply    |
 * |   |                                               | nested" (not not-json)  |
 * | 4 | truncated JSON (cut mid-string)               | not-json                |
 * | 5 | v3 shape corrupted (patterns.bass = 5)        | corrupt + issues        |
 * | 6 | __proto__/constructor keys at v3 positions    | corrupt; Object.proto-  |
 * |   |                                               | type NEVER polluted     |
 * | 7 | v2 with loopBars ≠ chain basis                | imports; loopBars       |
 * |   |                                               | dropped; LCM basis 16   |
 * | 8 | v2 with bars=8 (out-of-v2 vocab, v3-legal)    | imports (permissive     |
 * |   |                                               | widen — no reject class)|
 * | 9 | v1→v3 ladder: 4-bar sustained runs            | imports; version 3;     |
 * |   |                                               | duration law preserved  |
 * |10 | single-pattern chains at EVERY vocab size     | imports; cycle = bars×16|
 * |11 | notes at 2047/2048 in a 128-bar pattern       | imports (legal)         |
 * |12 | note start 2047 in a 1-bar pattern            | corrupt (semantic:      |
 * |   |                                               | outside the pattern)    |
 * |13 | future version (v4)                           | future-version          |
 */

import { describe, expect, it } from "vitest";
import { DECODE_MAX_CHARS, decode, encode } from "../src/document/codec";
import {
  SCHEMA_VERSION,
  createDefaultProject,
  type PitchedPattern,
  type ProjectDocument,
} from "../src/document/schema";
import { computeLoopSteps } from "../src/audio/render";
import { laneCycleSteps } from "../src/audio/song";
import { LANE_IDS, type LaneId } from "../src/document/schema";
import { createMemoryProjectDb } from "../src/persist/db";
import { importProjectFile } from "../src/persist/fileIO";
import { v1ProjectText, sustainHeavyV1ProjectText } from "./v1Project";
import { v2ProjectText } from "./v2Project";

function jsonFile(text: string, name = "p.bitbounce.json"): File {
  return new File([text], name, { type: "application/json" });
}

async function importText(text: string) {
  return importProjectFile(jsonFile(text), createMemoryProjectDb(), {
    newId: () => "fresh-uuid",
    now: () => 500,
  });
}

/** A valid v3 doc's canonical text, space-padded to `chars` total length. */
function paddedTo(doc: ProjectDocument, chars: number): string {
  const body = encode(doc);
  const pad = chars - body.length;
  if (pad < 0) throw new Error("doc already larger than target");
  return " ".repeat(pad) + body; // leading whitespace is legal JSON
}

// ---------------------------------------------------------------------------
// Rows 1-3: the codec-cap boundary (HL-1's honest-message fix)
// ---------------------------------------------------------------------------

describe("HL-1 import corpus — the 4 MB decode-cap boundary", () => {
  it("row 1: a 3.9 MB VALID-JSON file imports (under the cap)", async () => {
    const text = paddedTo(createDefaultProject(), 3_900_000);
    expect(text.length).toBeLessThan(DECODE_MAX_CHARS);
    const result = await importText(text);
    expect(result.ok).toBe(true);
  });

  it("row 2: a 4.1 MB VALID-JSON file rejects too-large with the HONEST message", async () => {
    const text = paddedTo(createDefaultProject(), 4_300_000);
    expect(text.length).toBeGreaterThan(DECODE_MAX_CHARS);
    // Honesty precondition: the text IS valid JSON (only oversized).
    expect(() => JSON.parse(text)).not.toThrow();
    const result = await importText(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("too-large");
      expect(result.message).toContain("too large to open safely");
      expect(result.message).toContain("4 MB");
      // The pre-fix lie: this class used to read "not valid JSON".
      expect(result.message).not.toContain("not valid JSON");
    }
  });

  it("row 3: 65+-deep VALID-JSON nesting rejects corrupt with the nesting message", async () => {
    const deep = `{ "version": ${"[".repeat(100)}${"]".repeat(100)} }`;
    expect(() => JSON.parse(deep)).not.toThrow(); // valid JSON, hostile depth
    const result = await importText(deep);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("corrupt");
      expect(result.message).toContain("too deeply nested");
      expect(result.message).not.toContain("not valid JSON");
    }
  });
});

// ---------------------------------------------------------------------------
// Rows 4-6: corrupted/truncated/hostile v3 docs
// ---------------------------------------------------------------------------

describe("HL-1 import corpus — corrupted + hostile v3 shapes", () => {
  it("row 4: truncated JSON (cut mid-string) is not-json", async () => {
    const full = encode(createDefaultProject());
    const text = full.slice(0, Math.floor(full.length / 2)); // mid-value cut
    expect(text.length).toBeGreaterThan(0);
    const result = await importText(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-json");
  });

  it("row 5: a v3 shape corrupted structurally is corrupt with bounded issues", async () => {
    const bad = JSON.parse(encode(createDefaultProject()));
    bad.patterns.bass = 5;
    const result = await importText(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("corrupt");
      expect(result.message).toContain("damaged or incomplete");
      expect((result.issues?.length ?? 0) <= 3).toBe(true); // bounded
    }
  });

  it("row 6: __proto__/constructor keys at v3 positions reject corrupt and NEVER pollute Object.prototype", async () => {
    const hostile = JSON.parse(encode(createDefaultProject()));
    (hostile.patterns as Record<string, unknown>)["__proto__"] = {
      polluted: "yes",
    };
    (hostile.transport as Record<string, unknown>)["constructor"] = {
      prototype: { polluted: "yes" },
    };
    const result = await importText(
      JSON.stringify({
        ...hostile,
        patterns: {
          __proto__: { polluted: "yes" },
          constructor: { prototype: { polluted: "yes" } },
          ...hostile.patterns,
        },
        transport: hostile.transport,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("corrupt");
    // The pollution probe: own keys on fresh objects stay clean.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (Object.create(null) as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rows 7-9: legacy doc combos under the v3 model
// ---------------------------------------------------------------------------

describe("HL-1 import corpus — v2/v1 legacy combos", () => {
  it("row 7: v2 with loopBars ≠ chain basis imports; loopBars DROPPED; the LCM basis is the chain truth", async () => {
    // loopBars says 4; every chain is a single 1-bar pattern.
    const text = v2ProjectText(createDefaultProject(), 4);
    const result = await importText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.version).toBe(SCHEMA_VERSION);
    expect("loopBars" in result.doc.transport).toBe(false);
    // The new basis law (LL-2): LCM of lane chain totals = 16, not 4 bars.
    expect(
      computeLoopSteps(
        LANE_IDS.map((lane: LaneId) => laneCycleSteps(result.doc, lane)),
      ),
    ).toBe(16);
  });

  it("row 8: v2 carrying bars=8 (invalid in v2, v3-legal) imports — the permissive widen has no rejection class", async () => {
    const doc = createDefaultProject();
    doc.patterns.bass[0] = { ...doc.patterns.bass[0] as PitchedPattern, bars: 8 };
    const text = v2ProjectText(doc);
    const result = await importText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.doc.patterns.bass[0] as PitchedPattern).bars).toBe(8);
  });

  it("row 9: v1→v3 ladder — the sustain-heavy v1 doc lands at v3 with the duration law intact", async () => {
    const v1Text = sustainHeavyV1ProjectText();
    const result = await importText(v1Text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.version).toBe(SCHEMA_VERSION);
    // The SC-1 duration law survives the full ladder: decoding the same v1
    // bytes again equals the imported doc modulo the import's name suffix —
    // no ladder step touched the notes.
    const again = decode(v1Text);
    expect(again).toEqual({ ...result.doc, name: again.name });
    // The v1 twin of the default round-trips through the whole ladder too.
    expect(decode(v1ProjectText(createDefaultProject())).version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Rows 10-12: vocabulary extremes at the decode boundary
// ---------------------------------------------------------------------------

describe("HL-1 import corpus — vocabulary extremes", () => {
  it("row 10: single-pattern chains at EVERY vocabulary size import; the cycle is bars×16", async () => {
    for (const bars of [1, 2, 4, 8, 16, 32, 64, 128] as const) {
      const doc = createDefaultProject();
      doc.patterns.bass[0] = {
        ...(doc.patterns.bass[0] as PitchedPattern),
        bars,
      };
      const result = await importText(encode(doc));
      expect(result.ok, `bars=${bars}`).toBe(true);
      if (result.ok) {
        expect(laneCycleSteps(result.doc, "bass")).toBe(bars * 16);
      }
    }
  });

  it("row 11: notes at the 2047/2048 boundaries inside a 128-bar pattern import (legal overhang)", async () => {
    const doc = createDefaultProject();
    doc.patterns.lead[0] = {
      ...(doc.patterns.lead[0] as PitchedPattern),
      bars: 128,
      notes: [
        { degree: 0, start: 2047, length: 2048 }, // the space + length maxima
        { degree: 3, start: 0, length: 2048 }, // the full-span sustain
      ],
    };
    const result = await importText(encode(doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.patterns.lead[0].notes).toHaveLength(2);
    }
  });

  it("row 12: a note start at 2047 inside a 1-bar pattern is a SEMANTIC corrupt rejection", async () => {
    const bad = JSON.parse(encode(createDefaultProject()));
    bad.patterns.lead[0].notes = [{ degree: 0, start: 2047, length: 1 }];
    const result = await importText(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("corrupt");
      expect(result.issues?.[0]).toContain("outside the pattern");
    }
  });

  it("row 13: a future version stamps future-version with both numbers", async () => {
    const future = JSON.parse(encode(createDefaultProject()));
    future.version = SCHEMA_VERSION + 1;
    const result = await importText(JSON.stringify(future));
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "future-version") {
      expect(result.fileVersion).toBe(SCHEMA_VERSION + 1);
      expect(result.appVersion).toBe(SCHEMA_VERSION);
    } else {
      throw new Error("expected future-version");
    }
  });
});
