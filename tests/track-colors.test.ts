import { afterEach, describe, expect, it, vi } from "vitest";
import {
  colorInk,
  parseTrackColors,
  setTrackColor,
  trackColors,
  TRACK_COLORS_KEY,
} from "../src/state/trackColors";

afterEach(() => {
  for (const id of ["drums", "bass", "chords", "lead"] as const)
    setTrackColor(id, null);
  vi.unstubAllGlobals();
});
describe("track appearance preferences", () => {
  it("keeps valid lane colors but rejects corrupt storage and CSS injection", () => {
    expect(
      parseTrackColors(
        '{"drums":"#Aa11FF","bass":"red;display:none","lead":"#fff","other":"#000000"}',
      ),
    ).toEqual({ drums: "#aa11ff" });
    for (const raw of [null, "{", "null", "[]", '"#ffffff"'])
      expect(parseTrackColors(raw)).toEqual({});
  });
  it("saves one track independently and resets to the theme without changing its neighbors", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    setTrackColor("drums", "#FF0088");
    setTrackColor("bass", "#0088ff");
    setTrackColor("drums", null);
    expect(trackColors()).toEqual({ bass: "#0088ff" });
    expect(setItem).toHaveBeenLastCalledWith(
      TRACK_COLORS_KEY,
      '{"bass":"#0088ff"}',
    );
    setTrackColor("bass", "invalid");
    expect(trackColors().bass).toBe("#0088ff");
  });
  it("still accepts changes when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("disabled");
      },
    });
    expect(() => setTrackColor("lead", "#8844ff")).not.toThrow();
    expect(trackColors().lead).toBe("#8844ff");
  });
  it("selects readable note text for very light and very dark custom fills", () => {
    expect(colorInk("#ffffff")).toBe("#000000");
    expect(colorInk("#000000")).toBe("#ffffff");
    expect(colorInk("#00ff00")).toBe("#000000");
    expect(colorInk("#0000ff")).toBe("#ffffff");
  });
});
