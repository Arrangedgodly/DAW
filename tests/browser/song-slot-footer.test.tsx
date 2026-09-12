import { expect, it } from "vitest";
import { render } from "solid-js/web";
import LaneFollow from "../../src/components/LaneFollow";
import { createDemoProject } from "../../src/document/demoSong";
import { docStore, loadDocument } from "../../src/state/store";
import { selectPattern } from "../../src/state/selection";

it("edits the selected repeated slot rather than the first matching pattern", () => {
  const previous = docStore.getState().doc;
  const doc = createDemoProject();
  const id = doc.songChain.drums[0]!;
  doc.songChain.drums = [id, id, ...doc.songChain.drums.slice(2)];
  loadDocument(doc);
  selectPattern("drums", id, 1);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <LaneFollow lane="drums" />, host);
  try {
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toContain("slot 2,");
    button.click();
    expect(docStore.getState().doc.chainModes?.drums).toEqual([
      "next",
      "loop",
      "next",
      "next",
    ]);
    selectPattern("drums", id, 0);
    expect(button.getAttribute("aria-label")).toContain("slot 1,");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  } finally {
    dispose();
    host.remove();
    loadDocument(previous);
  }
});
