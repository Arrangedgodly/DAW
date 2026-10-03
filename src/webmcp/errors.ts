import * as v from "valibot";
import { ProjectValidationError } from "../document/validate";
import { documentErrorMessage } from "./documentValidation";
import type { AgentTool } from "./tools";

export class AgentToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recovery: string,
    public readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(`[${code}] ${message}\nRecovery: ${recovery}`, { cause });
    this.name = "AgentToolError";
  }
}

/** Keep the code and recovery in Error.message because native bridges may drop properties. */
export function toolError(error: unknown): AgentToolError {
  if (error instanceof AgentToolError) return error;
  if (error instanceof ProjectValidationError)
    return new AgentToolError(
      "INVALID_DOCUMENT",
      documentErrorMessage(error),
      "Correct the reported paths, validate_document, then use the latest revision.",
      false,
      error,
    );
  if (v.isValiError(error))
    return new AgentToolError(
      "INVALID_INPUT",
      error.message,
      "Use the registered inputSchema; omit unknown fields and correct types/ranges.",
      false,
      error,
    );
  const message =
    error instanceof Error ? error.message : "Tool execution failed.";
  const rules: [RegExp, string, string, boolean][] = [
    [
      /abort|cancelled/i,
      "CANCELLED",
      "The operation was cancelled. Read current state before requesting it again.",
      false,
    ],
    [
      /Project changed|latest project revision|latest revision/i,
      "STALE_REVISION",
      "Read get_project, reconcile the user's current work, then regenerate any preview and retry with its revision.",
      true,
    ],
    [
      /access is off/i,
      "ACCESS_REVOKED",
      "Wait for tools to reconnect and confirm the destination before editing.",
      false,
    ],
    [
      /destination|consent/i,
      "DESTINATION_REQUIRED",
      "Ask the user for the destination and record it with confirm_edit_target.",
      false,
    ],
    [
      /Audio is locked/i,
      "AUDIO_LOCKED",
      "Ask the user to press Play once, then retry.",
      true,
    ],
    [
      /running|in progress/i,
      "BUSY",
      "Wait for the active operation to finish. Inspection and stopping playback remain available.",
      true,
    ],
    [
      /Preview missing or expired/i,
      "PREVIEW_EXPIRED",
      "Call preview_project or propose_mix again; use its new previewId and revision.",
      true,
    ],
    [
      /duration|too long|exceeds.*seconds|supports arrangements up to/i,
      "ANALYSIS_LIMIT",
      "Use a duration bound up to 180 seconds or shorten the arrangement before analysis.",
      false,
    ],
    [
      /Turn off Solo/i,
      "SOLO_ACTIVE",
      "Ask whether to turn off Solo before measuring the full mix.",
      false,
    ],
    [
      /storage|saved|save failure/i,
      "STORAGE_UNAVAILABLE",
      "Resolve storage or save the current project file before switching projects.",
      true,
    ],
    [
      /operations\.|pattern|lane|sound|notes|drum|Supply|exactly one/i,
      "INVALID_INPUT",
      "Read get_project/get_pattern/list_sounds and correct the addressed operation or input. No document changes were applied.",
      false,
    ],
  ];
  const rule = rules.find(([pattern]) => pattern.test(message));
  return rule
    ? new AgentToolError(rule[1], message, rule[2], rule[3], error)
    : new AgentToolError(
        "TOOL_FAILED",
        message,
        "Inspect current state before retrying. Report repeated failures with this code and message.",
        false,
        error,
      );
}

export function withToolErrors(tool: AgentTool): AgentTool {
  return {
    ...tool,
    async execute(input, options) {
      try {
        return await tool.execute(input, options);
      } catch (error) {
        throw toolError(error);
      }
    },
  };
}

/** Browser-facing failures are values: some native versions replace thrown errors with opaque text. */
export function withTransportErrors(tool: AgentTool): AgentTool {
  return {
    ...tool,
    async execute(input, options) {
      try {
        return await tool.execute(input, options);
      } catch (cause) {
        const error = toolError(cause);
        return {
          isError: true,
          error: {
            code: error.code,
            message: error.message,
            recovery: error.recovery,
            retryable: error.retryable,
          },
        };
      }
    },
  };
}
