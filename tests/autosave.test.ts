/**
 * MF-2 unit tests — autosave controller: debounce / interval / flush-on-hide
 * timing (fake timers), content-hash no-op skip, and the crash-draft dirty
 * flag (marked before flush, cleared by it). Everything runs against a fake
 * store seam + the in-memory ProjectDb; both are injected seams.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decode } from "../src/document/codec";
import {
  createDefaultProject,
  type ProjectDocument,
} from "../src/document/schema";
import {
  createMemoryProjectDb,
  type ProjectDb,
  type ProjectRecord,
} from "../src/persist/db";
import { startAutosave, type DocStoreLike } from "../src/persist/autosave";
import { saveProject } from "../src/persist/projectStore";

function sampleDoc(name = "Untitled"): ProjectDocument {
  return { ...createDefaultProject(), name };
}

function editedDoc(doc: ProjectDocument): ProjectDocument {
  return { ...doc, name: `${doc.name}!` };
}

function fakeStore(
  initial: ProjectDocument,
): DocStoreLike & { set(doc: ProjectDocument): void } {
  let state = { doc: initial };
  const subs: ((
    s: { doc: ProjectDocument },
    p: { doc: ProjectDocument },
  ) => void)[] = [];
  return {
    subscribe(fn) {
      subs.push(fn);
      return () => {
        const i = subs.indexOf(fn);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    getState: () => state,
    set(doc) {
      const prev = state;
      state = { doc };
      for (const fn of [...subs]) fn(state, prev);
    },
  };
}

function spyDb(base: ProjectDb) {
  const puts: ProjectRecord[] = [];
  const gets: string[] = [];
  return {
    db: {
      ...base,
      async putRecord(record: ProjectRecord) {
        puts.push(record);
        return base.putRecord(record);
      },
      async getRecord(id: string) {
        gets.push(id);
        return base.getRecord(id);
      },
    } as ProjectDb,
    puts,
    gets,
  };
}

function fakeWindow() {
  const listeners = new Map<string, (() => void)[]>();
  return {
    addEventListener(type: string, fn: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      );
    },
    dispatch(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autosave debounce + flush", () => {
  it("flushes once, ~800 ms after the last commit", async () => {
    const store = fakeStore(sampleDoc());
    const { db, puts } = spyDb(createMemoryProjectDb());
    const ctl = startAutosave({ db, projectId: "p1", store });
    store.set(editedDoc(store.getState().doc));
    expect(ctl.getStatus()).toBe("dirty");
    expect(ctl.isPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(799);
    expect(ctl.isPending()).toBe(true); // still inside the trailing window

    store.set(editedDoc(store.getState().doc)); // second edit restarts the window
    await vi.advanceTimersByTimeAsync(799);
    expect(ctl.isPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(ctl.isPending()).toBe(false);
    expect(ctl.getStatus()).toBe("saved");
    // One metadata mark + one full flush — the flush is the LAST put.
    const fullPuts = puts.filter((p) => !p.dirty);
    expect(fullPuts.length).toBe(1);
    expect(decode(fullPuts[0]!.json).name).toBe("Untitled!!");
    expect(ctl.getLastSaved()?.hash).toBe(ctl.currentHash());
    await ctl.stop();
  });

  it("manual flush() persists immediately and clears timers", async () => {
    const store = fakeStore(sampleDoc());
    const { db } = spyDb(createMemoryProjectDb());
    const ctl = startAutosave({ db, projectId: "p1", store });
    store.set(editedDoc(store.getState().doc));
    await ctl.flush();
    expect(ctl.isPending()).toBe(false);
    const loaded = await db.getRecord("p1");
    expect(loaded?.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(5000); // stale debounce must not re-fire
    expect(ctl.isPending()).toBe(false);
    await ctl.stop();
  });

  it("interval flush catches changes whose debounce was suppressed", async () => {
    const store = fakeStore(sampleDoc());
    const { db } = spyDb(createMemoryProjectDb());
    const ctl = startAutosave({
      db,
      projectId: "p1",
      store,
      debounceMs: 60_000, // push the debounce past the interval
      intervalMs: 30_000,
    });
    store.set(editedDoc(store.getState().doc));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ctl.isPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctl.isPending()).toBe(false); // interval flushed it
    expect((await db.getRecord("p1"))?.dirty).toBe(false);
    await ctl.stop();
  });

  it("pagehide / visibilitychange→hidden flush pending changes", async () => {
    const store = fakeStore(sampleDoc());
    const { db } = spyDb(createMemoryProjectDb());
    const win = fakeWindow();
    const ctl = startAutosave({
      db,
      projectId: "p1",
      store,
      windowImpl: win as never,
    });

    store.set(editedDoc(store.getState().doc));
    win.dispatch("pagehide");
    await vi.advanceTimersByTimeAsync(0); // let the flush microtask settle
    expect((await db.getRecord("p1"))?.dirty).toBe(false);
    expect(ctl.getStatus()).toBe("saved");

    store.set(editedDoc(store.getState().doc));
    // visibilitychange only fires the flush when actually hidden.
    (globalThis as { document?: { visibilityState: string } }).document = {
      visibilityState: "visible",
    };
    win.dispatch("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.isPending()).toBe(true);
    (globalThis as { document?: { visibilityState: string } }).document = {
      visibilityState: "hidden",
    };
    win.dispatch("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.isPending()).toBe(false);
    delete (globalThis as { document?: unknown }).document;
    await ctl.stop();
  });
});

describe("autosave hash-skip", () => {
  it("a commit whose content equals the saved hash writes nothing", async () => {
    const store = fakeStore(sampleDoc());
    const { db, puts } = spyDb(createMemoryProjectDb());
    const ctl = startAutosave({ db, projectId: "p1", store });
    store.set(editedDoc(store.getState().doc));
    await vi.advanceTimersByTimeAsync(800);
    const putsAfterSave = puts.length;

    // Different object identity, identical canonical content (e.g. a no-op
    // re-commit through a copy).
    store.set({ ...store.getState().doc });
    await vi.advanceTimersByTimeAsync(800);
    expect(puts.length).toBe(putsAfterSave); // no full write
    expect(ctl.isPending()).toBe(false);
    expect(ctl.getStatus()).toBe("saved");
    await ctl.stop();
  });

  it("undo back to the saved state cancels the pending write", async () => {
    const store = fakeStore(sampleDoc());
    const { db, puts } = spyDb(createMemoryProjectDb());
    // Persist the baseline first so the controller seeds its saved hash.
    await saveProject(db, "p1", store.getState().doc, { now: 0 });
    const baselinePuts = puts.length;
    const ctl = startAutosave({ db, projectId: "p1", store });
    await vi.advanceTimersByTimeAsync(0); // baseline seed settles
    const saved = store.getState().doc;
    store.set(editedDoc(saved));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.isPending()).toBe(true);
    store.set(saved); // undo
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctl.isPending()).toBe(false);
    // Only metadata puts happened (dirty mark + its clear) — no full json
    // write: every put still carries the baseline bytes.
    for (const put of puts.slice(baselinePuts)) {
      expect(decode(put.json)).toEqual(saved);
    }
    await ctl.stop();
  });
});

describe("crash-draft dirty flag", () => {
  it("row is flagged dirty after an unflushed edit and cleared by the flush", async () => {
    const store = fakeStore(sampleDoc());
    const mem = createMemoryProjectDb();
    const { db, puts } = spyDb(mem);
    const ctl = startAutosave({ db, projectId: "p1", store });
    // Establish a saved baseline (the row the crash draft protects).
    await ctl.flush();
    store.set(editedDoc(store.getState().doc));
    await vi.advanceTimersByTimeAsync(0); // mark-dirty write settles

    const marked = await mem.getRecord("p1");
    expect(marked?.dirty).toBe(true);
    // The mark keeps the LAST SAVED bytes — the draft mechanism is the row
    // itself; recovery (HU-3) reads dirty + the previous good json.
    expect(decode(marked!.json).name).toBe("Untitled");

    await vi.advanceTimersByTimeAsync(800);
    const flushed = await mem.getRecord("p1");
    expect(flushed?.dirty).toBe(false);
    expect(decode(flushed!.json).name).toBe("Untitled!");
    expect(puts[puts.length - 1]!.dirty).toBe(false);
    await ctl.stop();
  });
});

describe("controller lifecycle", () => {
  it("stop() unsubscribes and stops the interval", async () => {
    const store = fakeStore(sampleDoc());
    const { db, puts } = spyDb(createMemoryProjectDb());
    const ctl = startAutosave({ db, projectId: "p1", store, intervalMs: 1000 });
    await ctl.stop();
    const putsAtStop = puts.length;
    store.set(editedDoc(store.getState().doc)); // no listener anymore
    await vi.advanceTimersByTimeAsync(60_000);
    expect(puts.length).toBe(putsAtStop);
  });
});
