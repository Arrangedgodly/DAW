import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enableAgentAccess,
  disableAgentAccess,
  agentStatus,
  restoreBeforeAgent,
} from "../../src/webmcp/access";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
  setTransport,
} from "../../src/state/store";
import { cdp } from "vitest/browser";

interface NativeTool {
  name: string;
  inputSchema: unknown;
}
interface NativeContext {
  getTools(): Promise<NativeTool[]>;
  executeTool(
    tool: NativeTool,
    input: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}
let context: NativeContext;
async function call(
  name: string,
  args: unknown = {},
  options?: { signal?: AbortSignal },
) {
  const tools = await context.getTools();
  const tool = tools.find((t) => t.name === `bitbounce_${name}`);
  if (!tool) throw new Error(`Native discovery missing bitbounce_${name}`);
  let result: string | null;
  try {
    result = await context.executeTool(tool, args, options);
  } catch (error) {
    // Older Chromium accepts only JSON strings; retry only the pre-execution parse rejection.
    if (
      !(error instanceof Error) ||
      !error.message.includes("Failed to parse input arguments")
    )
      throw error;
    result = await context.executeTool(tool, JSON.stringify(args), options);
  }
  if (result === null)
    throw new Error("Unexpected navigation during DAW tool execution.");
  const parsed = typeof result === "string" ? JSON.parse(result) : result;
  if (parsed?.isError)
    throw Object.assign(new Error(parsed.error.message), parsed.error);
  return parsed;
}
beforeEach(async () => {
  loadDocument(createFreshProjectDocument());
  docStore.temporal.getState().clear();
  context = (document as Document & { modelContext: NativeContext })
    .modelContext;
  expect(
    context,
    "This acceptance run REQUIRES native WebMCP; lack of support is a failure, not a skip.",
  ).toBeTruthy();
  expect(context.getTools).toBeTypeOf("function");
  expect(context.executeTool).toBeTypeOf("function");
  await enableAgentAccess();
  expect(agentStatus()).toBe("on");
});
afterEach(() => {
  disableAgentAccess();
  loadDocument(createFreshProjectDocument());
});

describe("native WebMCP discovery, execution and lifecycle", () => {
  it("records the native browser version and measures real audio through the transport", async () => {
    console.info(
      "[native WebMCP browser]",
      JSON.stringify(await cdp().send("Browser.getVersion")),
    );
    const before = docStore.getState().doc;
    await call("confirm_edit_target", {
      destination: "current",
      userConfirmed: true,
      revision: 0,
    });
    await call("set_pattern", {
      revision: 0,
      lane: "bass",
      patternId: before.patterns.bass[0].id,
      notes: [{ degree: 0, start: 0, length: 4 }],
    });
    const analysis = await call("analyze_audio", {
      revision: 1,
      maxDurationSeconds: 10,
    });
    expect(analysis.lanes.bass.active).toBe(true);
    expect(analysis.master.peak).toBeGreaterThan(0);
    const proposed = await call("propose_mix", {
      revision: 1,
      maxDurationSeconds: 10,
      options: { amount: 0.4 },
    });
    expect(proposed.proposal.previewId).toBeTypeOf("string");
    expect(docStore.temporal.getState().pastStates).toHaveLength(1);
  });
  it("discovers all tools and transports filtered results and recoverable failures", async () => {
    const tools = await context.getTools();
    expect(tools.filter((t) => t.name.startsWith("bitbounce_")).length).toBe(
      20,
    );
    expect(
      await call("list_sounds", {
        type: "pitched",
        characters: ["Dark"],
        limit: 2,
      }),
    ).toMatchObject({
      kits: [],
      presets: [
        expect.objectContaining({
          characters: expect.arrayContaining(["Dark"]),
        }),
        expect.any(Object),
      ],
    });
    await expect(call("set_tempo", { revision: 0, bpm: 135 })).rejects.toThrow(
      "DESTINATION_REQUIRED",
    );
    const project = await call("get_project");
    await call("confirm_edit_target", {
      destination: "current",
      userConfirmed: true,
      revision: project.revision,
    });
    await expect(
      call("set_tempo", { revision: 0, bpm: 500 }),
    ).rejects.toThrow();
    await call("set_tempo", { revision: 0, bpm: 135 });
    expect((await call("get_project")).transport.bpm).toBe(135);
    await expect(call("set_tempo", { revision: 0, bpm: 140 })).rejects.toThrow(
      "STALE_REVISION",
    );
    expect(docStore.temporal.getState().pastStates).toHaveLength(1);
  });
  it("previews and applies a checked batch, rejects invalid documents and restores the session", async () => {
    const before = docStore.getState().doc;
    const preview = await call("preview_project", {
      revision: 0,
      operations: [
        {
          action: "rename_pattern",
          lane: "bass",
          patternId: before.patterns.bass[0].id,
          name: "Native outro",
        },
      ],
    });
    expect(docStore.getState().doc).toBe(before);
    await call("confirm_edit_target", {
      destination: "current",
      userConfirmed: true,
      revision: 0,
    });
    await call("apply_preview", { revision: 0, previewId: preview.previewId });
    expect(docStore.getState().doc.patterns.bass[0].name).toBe("Native outro");
    const invalid = {
      ...docStore.getState().doc,
      chainCues: {
        drums: ["Label exceeds twelve"],
        bass: [null],
        chords: [null],
        lead: [null],
      },
    };
    expect(
      await call("validate_document", { document: invalid }),
    ).toMatchObject({
      valid: false,
      issues: [expect.stringContaining("chainCues.drums.0")],
    });
    await expect(
      call("apply_document", { revision: 1, document: invalid }),
    ).rejects.toThrow("INVALID_DOCUMENT");
    restoreBeforeAgent();
    expect(docStore.getState().doc).toBe(before);
    expect(
      (await context.getTools()).filter((t) => t.name.startsWith("bitbounce_"))
        .length,
    ).toBe(0);
  });
  it("invalidates previews after human edits and cancels native execution without writing", async () => {
    const draft = await call("preview_project", {
      revision: 0,
      document: { ...docStore.getState().doc, name: "Native draft" },
    });
    await call("confirm_edit_target", {
      destination: "current",
      userConfirmed: true,
      revision: 0,
    });
    setTransport({ bpm: 144 });
    await expect(
      call("apply_preview", { revision: 1, previewId: draft.previewId }),
    ).rejects.toThrow("STALE_REVISION");
    const before = docStore.getState().doc;
    const controller = new AbortController();
    controller.abort();
    await expect(
      call(
        "set_tempo",
        { revision: 1, bpm: 160 },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(docStore.getState().doc).toBe(before);
    const discovered = (await context.getTools()).find(
      (t) => t.name === "bitbounce_set_tempo",
    )!;
    disableAgentAccess();
    await expect(
      context.executeTool(discovered, { revision: 1, bpm: 160 }),
    ).rejects.toThrow();
    await enableAgentAccess();
    loadDocument(createFreshProjectDocument());
    expect(
      (await context.getTools()).filter((t) => t.name.startsWith("bitbounce_"))
        .length,
    ).toBe(0);
    await enableAgentAccess();
    expect((await call("get_project")).editTarget).toBe("awaiting_user_choice");
  });
});
