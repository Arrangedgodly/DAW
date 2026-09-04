/**
 * Migration goldens (SC-1 + SV-1): fixtures committed through the ONE parse
 * path, pinned so any change to a migration law shows up as a reviewable
 * manifest diff (docs/dev/goldens.md discipline).
 *
 * SC-1 (iteration 2): three v1 sources — the default project, the WELCOME
 * SONG demo, and the hand-authored sustain-heavy neighbor.
 *
 * SV-1 (iteration 3): the walk now continues v2→v3, so the v1 fixtures'
 * FINAL bytes are v3 (renamed -to-v3); three NEW v2→v3 fixtures pin the
 * widening itself — the v2 default, the v2 demo (the fixture re-stamps
 * version + loopBars over the live v3 docs, i.e. exactly the pre-SV-1
 * on-disk bytes), and the hand-authored v2 boundary neighbor (4-bar
 * patterns + start 63 / length 128 notes + loopBars 4 — every v2-boundary
 * value must survive unchanged; only loopBars drops). Committed BEFORE any
 * UI depends on v3 (the SC-1 law).
 */
import { describe, it } from "vitest";
import { decode, encode } from "../../src/document/codec";
import { expectGolden } from "./golden";
import {
  sustainHeavyV1ProjectText,
  v1DefaultProjectText,
  v1DemoProjectText,
} from "../v1Project";
import {
  boundaryV2ProjectText,
  v2DefaultProjectText,
  v2DemoProjectText,
} from "../v2Project";

function migratedBytes(text: string): Uint8Array {
  return new TextEncoder().encode(encode(decode(text)));
}

describe("golden: v1 → v3 migration fixtures (SC-1 walk, SV-1 final bytes)", () => {
  it("migrate/v1-default-to-v3: v1 default project bytes → canonical v3", () => {
    expectGolden(
      "migrate/v1-default-to-v3",
      migratedBytes(v1DefaultProjectText()),
    );
  });

  it("migrate/v1-demo-to-v3: v1 WELCOME SONG bytes → canonical v3", () => {
    expectGolden("migrate/v1-demo-to-v3", migratedBytes(v1DemoProjectText()));
  });

  it("migrate/v1-sustain-heavy-to-v3: sustain-heavy v1 neighbor → canonical v3", () => {
    expectGolden(
      "migrate/v1-sustain-heavy-to-v3",
      migratedBytes(sustainHeavyV1ProjectText()),
    );
  });
});

describe("golden: v2 → v3 migration fixtures (SV-1)", () => {
  it("migrate/v2-default-to-v3: v2 default project bytes → canonical v3", () => {
    expectGolden(
      "migrate/v2-default-to-v3",
      migratedBytes(v2DefaultProjectText()),
    );
  });

  it("migrate/v2-demo-to-v3: v2 WELCOME SONG bytes → canonical v3", () => {
    expectGolden("migrate/v2-demo-to-v3", migratedBytes(v2DemoProjectText()));
  });

  it("migrate/v2-boundary-to-v3: v2 boundary-note neighbor → canonical v3", () => {
    expectGolden(
      "migrate/v2-boundary-to-v3",
      migratedBytes(boundaryV2ProjectText()),
    );
  });
});
