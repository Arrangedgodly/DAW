/**
 * SC-1 golden: v1 → v2 migration fixtures (plan requirement: golden migration
 * fixtures committed BEFORE any UI depends on v2). Three v1 sources — the
 * default project, the WELCOME SONG demo, and the hand-authored sustain-heavy
 * neighbor — migrate through the ONE parse path and their resulting canonical
 * v2 bytes are pinned. Any change to the migration law or the note model
 * shows up as a reviewable manifest diff (docs/dev/goldens.md discipline).
 */
import { describe, it } from "vitest";
import { decode, encode } from "../../src/document/codec";
import { expectGolden } from "./golden";
import {
  sustainHeavyV1ProjectText,
  v1DefaultProjectText,
  v1DemoProjectText,
} from "../v1Project";

function migratedBytes(v1Text: string): Uint8Array {
  return new TextEncoder().encode(encode(decode(v1Text)));
}

describe("golden: v1 → v2 migration fixtures (SC-1)", () => {
  it("migrate/v1-default-to-v2: v1 default project bytes → canonical v2", () => {
    expectGolden(
      "migrate/v1-default-to-v2",
      migratedBytes(v1DefaultProjectText()),
    );
  });

  it("migrate/v1-demo-to-v2: v1 WELCOME SONG bytes → canonical v2", () => {
    expectGolden("migrate/v1-demo-to-v2", migratedBytes(v1DemoProjectText()));
  });

  it("migrate/v1-sustain-heavy-to-v2: sustain-heavy v1 neighbor → canonical v2", () => {
    expectGolden(
      "migrate/v1-sustain-heavy-to-v2",
      migratedBytes(sustainHeavyV1ProjectText()),
    );
  });
});
