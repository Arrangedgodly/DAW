import { expect, it, vi } from "vitest";
import { createDefaultProject } from "../src/document/schema";
import {
  addFxDevice,
  docStore,
  loadDocument,
  setLaneSoundId,
} from "../src/state/store";

it("sample metadata loading preserves musical edits made while the manifest loads", async () => {
  loadDocument(createDefaultProject());
  setLaneSoundId("drums", "kit-808");
  addFxDevice("bass", "delay");
  const expected = docStore
    .getState()
    .doc.lanes.find((l) => l.id === "bass")!.fxChain;
  await expect
    .poll(() => docStore.getState().doc.sampleProvenance)
    .toBeDefined();
  expect(
    docStore.getState().doc.lanes.find((l) => l.id === "bass")!.fxChain,
  ).toEqual(expected);
});

it("sample metadata loading cannot replace a newly opened project", async () => {
  loadDocument(createDefaultProject());
  setLaneSoundId("drums", "kit-808");
  loadDocument({ ...createDefaultProject(), name: "New idea" });
  const expected = docStore.getState().doc;
  await vi.dynamicImportSettled();
  expect(docStore.getState().doc).toBe(expected);
  expect(docStore.getState().doc.sampleProvenance).toBeUndefined();
});
