import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import AgentAccess from "../../src/components/AgentAccess";
import {
  agentStatus,
  confirmCurrentAgentTarget,
  saveAndStartAgentProject,
  agentTargetConfirmed,
  agentError,
  canRestoreAgent,
  disableAgentAccess,
  enableAgentAccess,
  restoreBeforeAgent,
  type ModelContext,
} from "../../src/webmcp/access";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
  setTransport,
  undo,
} from "../../src/state/store";
import type { AgentTool } from "../../src/webmcp/tools";
import { getSession } from "../../src/engine/session";
import { createMemoryProjectDb } from "../../src/persist/db";
import {
  getActiveProjectId,
  getAutosaveController,
  initPersistence,
} from "../../src/persist/boot";
import { decode } from "../../src/document/codec";

let tools: Map<string, AgentTool>;
let context: ModelContext;
const call = (name: string, input: unknown = {}) =>
  tools.get(`bitbounce_${name}`)!.execute(input);
beforeEach(() => {
  loadDocument(createFreshProjectDocument());
  docStore.temporal.getState().clear();
  tools = new Map();
  context = {
    registerTool(tool, options) {
      if (tools.has(tool.name)) throw new Error("Duplicate tool");
      tools.set(tool.name, tool);
      options?.signal.addEventListener("abort", () => tools.delete(tool.name));
    },
  };
});
afterEach(async () => {
  await getAutosaveController()?.stop();
  loadDocument(createFreshProjectDocument());
  Object.defineProperty(document, "modelContext", {
    value: undefined,
    configurable: true,
  });
});

describe("WebMCP access and recovery in a real browser", () => {
  it("blocks every edit until the human selects a destination, while reads remain available", async () => {
    await enableAgentAccess(context);
    expect(await call("get_project")).toMatchObject({
      editTarget: "awaiting_user_choice",
    });
    const before = docStore.getState().doc;
    await expect(call("set_tempo", { revision: 0, bpm: 150 })).rejects.toThrow(
      "destination",
    );
    await expect(
      call("control_session", { masterVolume: 0.1 }),
    ).rejects.toThrow("destination");
    expect(docStore.getState().doc).toBe(before);
    confirmCurrentAgentTarget();
    await call("set_tempo", { revision: 0, bpm: 150 });
    expect(docStore.getState().doc.transport.bpm).toBe(150);
  });
  it("an ambiguous new request revokes permission and the tool cannot approve its own destination", async () => {
    await enableAgentAccess(context);
    confirmCurrentAgentTarget();
    await call("request_edit_target", { task: "Make a new battle theme" });
    expect(agentTargetConfirmed()).toBe(false);
    await expect(
      call("request_edit_target", { task: "Compose", destination: "current" }),
    ).rejects.toThrow();
    await expect(call("set_tempo", { revision: 0, bpm: 150 })).rejects.toThrow(
      "destination",
    );
    confirmCurrentAgentTarget();
    await expect(call("get_project")).resolves.toMatchObject({
      editTarget: "current_project_confirmed",
    });
  });
  it("a fresh destination request cancels an export before its download is dispatched", async () => {
    await enableAgentAccess(context);
    confirmCurrentAgentTarget();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      const exporting = call("export", { format: "project", revision: 0 });
      const rejected = expect(exporting).rejects.toThrow();
      await call("request_edit_target", { task: "Start a separate idea" });
      await rejected;
      expect(click).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });
  it("saves all current work before switching to a separate empty project and authorizing it", async () => {
    const db = createMemoryProjectDb();
    await initPersistence({ db });
    setTransport({ bpm: 163 });
    const originalId = getActiveProjectId()!;
    await enableAgentAccess(context);
    await saveAndStartAgentProject();
    expect(getActiveProjectId()).not.toBe(originalId);
    expect(decode((await db.getRecord(originalId))!.json).transport.bpm).toBe(
      163,
    );
    expect(docStore.getState().doc.transport.bpm).toBe(120);
    expect(
      docStore.getState().doc.patterns.drums[0].steps.kick.every((hit) => !hit),
    ).toBe(true);
    expect(agentTargetConfirmed()).toBe(true);
    expect(agentStatus()).toBe("on");
    expect(await db.allRecords()).toHaveLength(2);
    await call("set_tempo", { revision: 0, bpm: 140 });
    await getAutosaveController()!.flush();
    expect(decode((await db.getRecord(originalId))!.json).transport.bpm).toBe(
      163,
    );
    restoreBeforeAgent();
    expect(docStore.getState().doc.transport.bpm).toBe(120);
  });
  it("save failure leaves the original project open and edits blocked", async () => {
    const db = createMemoryProjectDb();
    let fail = false;
    await initPersistence({
      db: {
        ...db,
        async putRecord(record) {
          if (fail) throw new Error("Storage quota reached");
          await db.putRecord(record);
        },
      },
    });
    setTransport({ bpm: 169 });
    const originalId = getActiveProjectId();
    await getAutosaveController()!.flush();
    const before = docStore.getState().doc;
    await enableAgentAccess(context);
    fail = true;
    await saveAndStartAgentProject();
    expect(agentError()).toContain("Storage quota");
    expect(getActiveProjectId()).toBe(originalId);
    expect(docStore.getState().doc).toBe(before);
    expect(agentTargetConfirmed()).toBe(false);
    expect(await db.allRecords()).toHaveLength(1);
    fail = false;
  });
  it("registers tools on opt-in, retains callbacks safely after revocation, and restores a whole agent session", async () => {
    const before = docStore.getState().doc;
    await enableAgentAccess(context);
    confirmCurrentAgentTarget();
    expect(agentStatus()).toBe("on");
    expect(tools.size).toBe(13);
    await call("set_tempo", { revision: 0, bpm: 130 });
    await call("set_lane", { revision: 1, lane: "bass", mix: { mute: true } });
    expect(canRestoreAgent()).toBe(true);
    setTransport({ bpm: 155 });
    const callback = tools.get("bitbounce_get_project")!;
    const edited = docStore.getState().doc;
    restoreBeforeAgent();
    expect(docStore.getState().doc).toBe(before);
    expect(agentStatus()).toBe("off");
    expect(tools.size).toBe(0);
    await expect(callback.execute({})).rejects.toThrow("off");
    undo();
    expect(docStore.getState().doc).toBe(edited);
  });
  it("ends access and discards the checkpoint when another project is loaded", async () => {
    await enableAgentAccess(context);
    confirmCurrentAgentTarget();
    await call("set_tempo", { revision: 0, bpm: 130 });
    loadDocument(createFreshProjectDocument());
    expect(agentStatus()).toBe("off");
    expect(canRestoreAgent()).toBe(false);
    expect(tools.size).toBe(0);
  });
  it("restores master gain and loop mode and stops playback", async () => {
    const session = getSession();
    session.setMasterVolume(0.7);
    session.setLoop(true);
    await enableAgentAccess(context);
    confirmCurrentAgentTarget();
    await call("control_session", { loop: false, masterVolume: 0.2 });
    expect(session.masterVolume).toBe(0.2);
    restoreBeforeAgent();
    expect(session.masterVolume).toBe(0.7);
    expect(session.transport.snapshot.loop).toBe(true);
    expect(session.transport.snapshot.playing).toBe(false);
  });
  it("cleans up partial registration failure without removing another owner's tool", async () => {
    const other: AgentTool = {
      name: "bitbounce_list_sounds",
      description: "Existing",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      execute: async () => ({}),
    };
    tools.set(other.name, other);
    await enableAgentAccess(context);
    confirmCurrentAgentTarget();
    expect(agentStatus()).toBe("error");
    expect([...tools.values()]).toEqual([other]);
  });
  it("disabling during asynchronous legacy registration removes the late registration", async () => {
    let finish: (() => void) | undefined;
    const context: ModelContext = {
      registerTool(tool) {
        return new Promise<void>((resolve) => {
          finish = () => {
            tools.set(tool.name, tool);
            resolve();
          };
        });
      },
      unregisterTool(name) {
        tools.delete(name);
      },
    };
    const enabling = enableAgentAccess(context);
    await expect.poll(() => Boolean(finish)).toBe(true);
    disableAgentAccess();
    finish!();
    await enabling;
    expect(agentStatus()).toBe("off");
    expect(tools.size).toBe(0);
  });
  it("renders the access and restore controls, and unsupported browsers stay usable", async () => {
    Object.defineProperty(document, "modelContext", {
      value: context,
      configurable: true,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <AgentAccess />, host);
    try {
      const allow = host.querySelector("button")!;
      allow.focus();
      expect(document.activeElement).toBe(allow);
      allow.click();
      await expect.poll(agentStatus).toBe("on");
      expect(allow.getAttribute("aria-pressed")).toBe("true");
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit this project")!
        .click();
      await call("set_tempo", { revision: 0, bpm: 130 });
      const restore = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Restore before agent",
      )!;
      expect(restore).toBeDefined();
      restore.click();
      expect(docStore.getState().doc.transport.bpm).toBe(120);
      expect(agentStatus()).toBe("off");
    } finally {
      dispose();
      host.remove();
    }
    Object.defineProperty(document, "modelContext", {
      value: undefined,
      configurable: true,
    });
    const unsupported = document.createElement("div");
    document.body.append(unsupported);
    const disposeUnsupported = render(() => <AgentAccess />, unsupported);
    expect(unsupported.querySelector("button")!.disabled).toBe(true);
    disposeUnsupported();
    unsupported.remove();
  });
});
