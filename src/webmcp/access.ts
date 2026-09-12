import { createSignal } from "solid-js";
import type { ProjectDocument } from "../document/schema";
import {
  commitDocumentEdit,
  docStore,
  loadDocument,
  onDocumentReplaced,
} from "../state/store";
import { showInfo } from "../state/toasts";
import type { AgentTool } from "./tools";

export interface ModelContext {
  registerTool(
    tool: AgentTool,
    options?: { signal: AbortSignal },
  ): void | Promise<void>;
  unregisterTool?: (name: string) => void;
}
export function modelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  return (
    (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  );
}

const [status, setStatus] = createSignal<"off" | "starting" | "on" | "error">(
  "off",
);
const [error, setError] = createSignal("");
const [checkpoint, setCheckpoint] = createSignal<ProjectDocument | null>(null);
export { status as agentStatus, error as agentError };
export const canRestoreAgent = () => checkpoint() !== null;
let cleanup: (() => void) | undefined;
let generation = 0;
let resetSession: ((restoreDocument: () => void) => void) | undefined;
const [targetConfirmed, setTargetConfirmed] = createSignal(false);
const [targetPrompt, setTargetPrompt] = createSignal(
  "Where should the agent work?",
);
const [targetBusy, setTargetBusy] = createSignal(false);
export {
  targetConfirmed as agentTargetConfirmed,
  targetPrompt as agentTargetPrompt,
  targetBusy as agentTargetBusy,
};
let registeredContext: ModelContext | undefined;
let editPermission = new AbortController();

export function confirmCurrentAgentTarget(): void {
  if (status() !== "on" || targetBusy()) return;
  setTargetConfirmed(true);
  setError("");
}

/** User-only destination action. The agent tool cannot choose its own target. */
export async function saveAndStartAgentProject(): Promise<void> {
  if (status() !== "on" || targetBusy()) return;
  setTargetBusy(true);
  setTargetConfirmed(false);
  editPermission.abort();
  editPermission = new AbortController();
  setError("");
  const context = registeredContext;
  const token = generation;
  try {
    const boot = await import("../persist/boot");
    const { createNewProject } = await import("../persist/newProject");
    const controller = boot.getAutosaveController();
    const db = boot.getBootDb();
    if (!controller || !db)
      throw new Error(
        "Project storage is not ready. Try again after the project finishes loading.",
      );
    const originalId = boot.getActiveProjectId();
    await controller.flush();
    if (controller.getStatus() === "error" || controller.isPending())
      throw new Error(
        "Current work could not be saved. Fix storage or save a file before starting a new project.",
      );
    if (token !== generation) return;
    const { record, doc } = await createNewProject(db);
    if (token !== generation || originalId !== boot.getActiveProjectId())
      return;
    // The final stop/flush must succeed before autosave is retargeted.
    await boot.switchToProject(record.id, { requireSaved: true });
    loadDocument(doc);
    await enableAgentAccess(context);
    if (status() === "on") {
      setTargetConfirmed(true);
      showInfo(
        "Current work saved. Agent work will use the new empty project.",
      );
    }
  } catch (reason) {
    setError(
      reason instanceof Error
        ? reason.message
        : "Could not prepare a new project. Current work is still open.",
    );
  } finally {
    setTargetBusy(false);
  }
}

export function disableAgentAccess(): void {
  editPermission.abort();
  generation++;
  cleanup?.();
  cleanup = undefined;
  setStatus("off");
  setTargetConfirmed(false);
}

export async function enableAgentAccess(
  context = modelContext(),
): Promise<void> {
  if (status() === "on" || status() === "starting") return;
  if (!context || typeof context.registerTool !== "function") {
    setError(
      "This browser does not expose WebMCP. Use a compatible browser with WebMCP enabled.",
    );
    setStatus("error");
    return;
  }
  const token = ++generation;
  editPermission = new AbortController();
  registeredContext = context;
  setTargetConfirmed(false);
  setStatus("starting");
  setError("");
  const controller = new AbortController();
  let active = true;
  const names: string[] = [];
  let dispose: (() => void) | undefined;
  const stop = () => {
    active = false;
    controller.abort();
    for (const name of names) {
      try {
        context.unregisterTool?.(name);
      } catch {
        /* Already removed by signal. */
      }
    }
    dispose?.();
  };
  cleanup = stop;
  try {
    const [{ createAgentTools }, { createSessionTools, sessionRestorer }] =
      await Promise.all([import("./tools"), import("./sessionTools")]);
    if (generation !== token) return;
    const capture = (before = docStore.getState().doc) => {
      if (!checkpoint()) {
        setCheckpoint(before);
        resetSession = sessionRestorer();
      }
    };
    const group = createAgentTools(
      () => active && status() === "on",
      (message, before) => {
        capture(before);
        showInfo(message, {
          suggestion:
            "Restore also removes any manual edits since the agent's first change.",
          action: { label: "Restore before agent", run: restoreBeforeAgent },
        });
      },
    );
    dispose = group.dispose;
    const allTools = [
      ...group.tools,
      ...createSessionTools(
        () => active && status() === "on",
        group.revision,
        capture,
      ),
    ];
    const destinationTool: AgentTool = {
      name: "bitbounce_request_edit_target",
      description:
        "Before changing anything, if it is unclear whether the user's current request should modify the open song or create a new one, call this tool and ask the user to choose in Projects. This revokes edit permission until the human chooses Edit this project or Save and start a new project. Do not choose on their behalf. Use get_project to check editTarget afterward; do not repeat this tool while waiting.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            minLength: 1,
            maxLength: 500,
            description:
              "Short plain-language description of the requested musical work.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      async execute(input, options) {
        if (!active || status() !== "on")
          throw new Error("Agent access is off.");
        options?.signal?.throwIfAborted();
        if (
          !input ||
          typeof input !== "object" ||
          Object.keys(input).some((key) => key !== "task") ||
          !("task" in input) ||
          typeof input.task !== "string" ||
          !input.task.trim() ||
          input.task.length > 500
        )
          throw new Error(
            "Supply a task description between 1 and 500 characters.",
          );
        editPermission.abort();
        editPermission = new AbortController();
        setTargetConfirmed(false);
        setTargetPrompt(input.task);
        showInfo(
          "Choose where the agent should work in Projects: edit this project, or save it and start a new one.",
        );
        return {
          editTarget: "awaiting_user_choice",
          message:
            "Ask the user to choose the destination in Projects. All edits are blocked until they choose.",
        };
      },
    };
    const policy =
      " If this request's destination is unclear, call bitbounce_request_edit_target and wait for the user to choose current or new project. Never assume the open song should be edited.";
    for (const tool of allTools) {
      const wrapped: AgentTool = {
        ...tool,
        description: tool.description + policy,
        execute: async (input, options) => {
          if (!active || status() !== "on")
            throw new Error("Agent access is off.");
          if (!tool.annotations.readOnlyHint && !targetConfirmed())
            throw new Error(
              "Choose a work destination first. Ask the user to choose Edit this project or Save and start a new project in Projects.",
            );
          const signal = tool.annotations.readOnlyHint
            ? options?.signal
            : AbortSignal.any([
                editPermission.signal,
                ...(options?.signal ? [options.signal] : []),
              ]);
          const result = await tool.execute(input, { signal });
          if (
            tool.name === "bitbounce_get_project" ||
            tool.name === "bitbounce_get_document" ||
            tool.name === "bitbounce_get_session"
          ) {
            return {
              ...(result as Record<string, unknown>),
              editTarget: targetConfirmed()
                ? "current_project_confirmed"
                : "awaiting_user_choice",
              targetPrompt: targetPrompt(),
            };
          }
          return result;
        },
      };
      await context.registerTool(wrapped, { signal: controller.signal });
      names.push(tool.name);
      if (generation !== token) {
        stop();
        return;
      }
    }
    await context.registerTool(destinationTool, { signal: controller.signal });
    names.push(destinationTool.name);
    if (generation !== token) {
      stop();
      return;
    }
    setStatus("on");
  } catch (reason) {
    stop();
    if (generation !== token) return;
    setError(
      reason instanceof Error
        ? reason.message
        : "Could not register agent tools.",
    );
    setStatus("error");
  }
}

export function restoreBeforeAgent(): void {
  const before = checkpoint();
  if (!before) return;
  disableAgentAccess();
  const restoreDocument = () =>
    commitDocumentEdit(docStore.getState().doc, before);
  if (resetSession) resetSession(restoreDocument);
  else restoreDocument();
  resetSession = undefined;
  setCheckpoint(null);
  showInfo(
    "Restored the project from before the agent's first edit. Agent access is off. Undo reverses this restore.",
  );
}

onDocumentReplaced(() => {
  disableAgentAccess();
  setCheckpoint(null);
  resetSession = undefined;
});
