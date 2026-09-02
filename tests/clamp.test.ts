import { describe, expect, it } from "vitest";
import { clamp } from "../src/lib/clamp";

describe("clamp", () => {
  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("passes through in-range values", () => {
    expect(clamp(7, 0, 10)).toBe(7);
  });
});
