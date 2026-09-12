import { describe, expect, it } from "vitest";
import { createMemoryProjectDb } from "../src/persist/db";
import { startAutosave, type DocStoreLike } from "../src/persist/autosave";
import { createBuiltInDemo } from "../src/document/builtInDemos";
import type { ProjectDocument } from "../src/document/schema";
import { decode } from "../src/document/codec";
function storeFor(doc: ProjectDocument) {
  let state = { doc };
  const listeners = new Set<Parameters<DocStoreLike["subscribe"]>[0]>();
  return {
    getState: () => state,
    subscribe: (fn: Parameters<DocStoreLike["subscribe"]>[0]) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set: (doc: ProjectDocument) => {
      const prev = state;
      state = { doc };
      for (const fn of listeners) fn(state, prev);
    },
  };
}
describe("demo preview autosave", () => {
  it("never writes untouched content, including equivalent commits, flush and stop", async () => {
    const db = createMemoryProjectDb();
    const doc = createBuiltInDemo("glass-arcade");
    const store = storeFor(doc);
    let edits = 0;
    const save = startAutosave({
      db,
      projectId: "copy",
      store,
      previewDocument: doc,
      onPreviewEdited: () => edits++,
      intervalMs: 0,
    });
    store.set(structuredClone(doc));
    await save.flush();
    await save.stop();
    expect(await db.getRecord("copy")).toBeUndefined();
    expect(edits).toBe(0);
  });
  it("promotes once, saves the first edit and captures later edits on stop", async () => {
    const db = createMemoryProjectDb();
    const doc = createBuiltInDemo("after-hours");
    const store = storeFor(doc);
    let edits = 0;
    const save = startAutosave({
      db,
      projectId: "copy",
      store,
      previewDocument: doc,
      onPreviewEdited: () => edits++,
      intervalMs: 0,
    });
    const first = { ...doc, transport: { ...doc.transport, bpm: 99 } };
    store.set(first);
    await save.flush();
    expect(edits).toBe(1);
    expect(decode((await db.getRecord("copy"))!.json)).toEqual(first);
    const second = { ...first, name: "My variation" };
    store.set(second);
    await save.stop();
    expect(edits).toBe(1);
    expect(decode((await db.getRecord("copy"))!.json)).toEqual(second);
    expect(createBuiltInDemo("after-hours")).toEqual(doc);
  });
});

import {
  initPersistence,
  openBuiltInDemo,
  getAutosaveController,
  getActiveProjectId,
  builtInDemo,
  switchToProject,
} from "../src/persist/boot";
import { setLaneSoundId } from "../src/state/store";
import { selectLane } from "../src/state/selection";
import { listProjects } from "../src/persist/projectStore";
it("library previews leave no rows, first preset edit creates one, switching flushes it", async () => {
  const db = createMemoryProjectDb();
  await initPersistence({ db });
  await openBuiltInDemo("glass-arcade");
  selectLane("bass");
  await getAutosaveController()!.flush();
  expect(builtInDemo()).toBe(true);
  expect(getActiveProjectId()).toBeNull();
  expect(await listProjects(db)).toHaveLength(0);
  await openBuiltInDemo("after-hours");
  expect(await listProjects(db)).toHaveLength(0);
  setLaneSoundId("extra1", "preset-bells-crystal");
  const id = getActiveProjectId()!;
  expect(id).toBeTruthy();
  expect(builtInDemo()).toBe(false);
  await openBuiltInDemo("welcome");
  expect(await listProjects(db)).toHaveLength(1);
  expect(
    decode((await db.getRecord(id))!.json).lanes.find((l) => l.id === "extra1"),
  ).toMatchObject({ presetId: "preset-bells-crystal" });
  await switchToProject(id);
  expect(builtInDemo()).toBe(false);
  await getAutosaveController()!.stop();
});

it("undoing the first edit before debounce saves the actual resulting content", async () => {
  const db = createMemoryProjectDb();
  const doc = createBuiltInDemo("glass-arcade");
  const store = storeFor(doc);
  const save = startAutosave({
    db,
    projectId: "undo-copy",
    store,
    previewDocument: doc,
    intervalMs: 0,
  });
  store.set({ ...doc, name: "Changed" });
  await Promise.resolve();
  store.set(doc);
  await save.stop();
  expect(decode((await db.getRecord("undo-copy"))!.json)).toEqual(doc);
});
