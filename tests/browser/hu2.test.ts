/**
 * HU-2 browser tests — the real-event paths:
 *  1. boot quarantine through REAL IndexedDB: a bad newest row is renamed
 *     (bytes kept), a fresh default loads, and the RECOVER action exports the
 *     original bytes through the real download seam (URL.createObjectURL).
 *  2. voice-steal stats through the REAL worklet: >8 simultaneous notes on
 *     one lane steal voices and the host/session counters observe it.
 */

import { describe, expect, it, vi } from "vitest";
import { openRawProjectDb, type ProjectRecord } from "../../src/persist/db";
import { initPersistence, getAutosaveController } from "../../src/persist/boot";
import { createDefaultProject } from "../../src/document/schema";
import { docStore, createFreshProjectDocument } from "../../src/state/store";
import { clearToasts, toastStack } from "../../src/state/toasts";
import {
  createVoiceEngine,
  workletContextFor,
} from "../../src/audio/voiceEngine";
import type { VoiceNoteOnEvent } from "../../src/audio/presets";

async function freshDb(name: string) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  return openRawProjectDb(name);
}

function badRow(): ProjectRecord {
  const base = createDefaultProject();
  const bad = JSON.stringify({
    ...base,
    transport: { ...base.transport, bpm: 9999 },
  });
  return {
    id: "default",
    name: "broken song",
    schemaVersion: 1,
    updatedAt: 5000,
    dirty: false,
    json: bad,
  };
}

describe("boot quarantine (real IndexedDB)", () => {
  it("renames the bad row, boots a fresh default, and RECOVER exports original bytes", async () => {
    const db = await freshDb("bitbounce-test-hu2-quarantine");
    const bad = badRow();
    await db.putRecord(bad);
    clearToasts();

    const boot = await initPersistence({
      db,
      newId: () => "fresh-1",
      now: () => 42,
    });
    try {
      // Row renamed, never deleted; original key freed.
      const rows = await db.allRecords();
      expect(rows).toHaveLength(2);
      const qrow = rows.find((r) => r.id.includes(".corrupt"));
      expect(qrow).toBeDefined();
      expect(qrow!.json).toBe(bad.json);
      expect(await db.getRecord("default")).toBeUndefined();

      // Fresh default booted + autosave targets it.
      expect(boot.projectId).toBe("fresh-1");
      expect(boot.quarantined?.quarantineId).toBe(qrow!.id);
      expect(docStore.getState().doc.name).toBe("Untitled");

      // Sticky error toast with the RECOVER action wired to the raw bytes.
      const toasts = toastStack();
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.kind).toBe("error");
      expect(toasts[0]!.message).toContain("broken song");

      // RECOVER exports the original bytes through the real seam.
      const downloads: { name: string; blob: Blob }[] = [];
      const urlSpy = vi
        .spyOn(URL, "createObjectURL")
        .mockImplementation((blob) => {
          downloads.push({ name: "", blob });
          return "blob:hu2";
        });
      const revokeSpy = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => undefined);
      try {
        toasts[0]!.action!.run();
        expect(downloads).toHaveLength(1);
        expect(await downloads[0]!.blob.text()).toBe(bad.json);
      } finally {
        urlSpy.mockRestore();
        revokeSpy.mockRestore();
      }
    } finally {
      clearToasts();
      await getAutosaveController()?.stop();
      docStore.setState({ doc: createFreshProjectDocument() });
    }
  });
});

describe("voice-steal stats (real worklet)", () => {
  it("reports steals when >8 voices are requested on one lane", async () => {
    const ctx = new AudioContext({ sampleRate: 44100 });
    try {
      if (ctx.state === "suspended") await ctx.resume();
      let stolen = 0;
      const host = await createVoiceEngine(workletContextFor(ctx), 1, {
        onStolen: () => {
          stolen += 1;
        },
      });
      const t0 = ctx.currentTime + 0.3;
      // 12 simultaneous long notes → the 8-voice pool must steal 4 times.
      const events: VoiceNoteOnEvent[] = Array.from({ length: 12 }, (_, i) => ({
        time: t0,
        midi: 48 + i,
        holdSeconds: 0.5,
        seedSalt: i,
      })) as unknown as VoiceNoteOnEvent[];
      host.sendEvents(0, events);

      // Wait past the event time; steals are posted as they fire.
      await new Promise((r) => setTimeout(r, 700));
      expect(stolen).toBeGreaterThanOrEqual(1);
      expect(host.stolenCount?.(0)).toBe(stolen);
      host.dispose();
    } finally {
      await ctx.close();
    }
  });
});
