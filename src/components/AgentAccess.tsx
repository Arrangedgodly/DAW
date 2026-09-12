import { Show } from "solid-js";
import {
  agentStatus,
  agentError,
  canRestoreAgent,
  disableAgentAccess,
  enableAgentAccess,
  modelContext,
  restoreBeforeAgent,
  agentTargetConfirmed,
  agentTargetPrompt,
  agentTargetBusy,
  confirmCurrentAgentTarget,
  saveAndStartAgentProject,
} from "../webmcp/access";

export default function AgentAccess() {
  const supported = Boolean(modelContext());
  return (
    <section class="agent-access" aria-label="Agent access">
      <p>
        Connect an agent to inspect this project. Before edits, choose this song
        or a new project. Its provider may process project data. Access and
        recovery last until reload or a project switch.
      </p>
      <button
        type="button"
        class="booth-btn"
        aria-pressed={agentStatus() === "on"}
        disabled={
          !supported || agentStatus() === "starting" || agentTargetBusy()
        }
        onClick={() =>
          agentStatus() === "on"
            ? disableAgentAccess()
            : void enableAgentAccess()
        }
      >
        {agentStatus() === "on"
          ? "Turn agent access off"
          : agentStatus() === "starting"
            ? "Connecting agent tools..."
            : "Allow agent access"}
      </button>
      <Show when={!supported}>
        <p>WebMCP is not available in this browser.</p>
      </Show>
      <Show when={agentError()}>
        <p role="alert">{agentError()}</p>
      </Show>
      <Show when={agentStatus() === "on" && !agentTargetConfirmed()}>
        <p role="status">{agentTargetPrompt()}</p>
        <p>
          Keep changes in this song, or save it and give the agent a new empty
          project.
        </p>
        <button
          type="button"
          class="booth-btn"
          disabled={agentTargetBusy()}
          onClick={confirmCurrentAgentTarget}
        >
          Edit this project
        </button>
        <button
          type="button"
          class="booth-btn"
          disabled={agentTargetBusy()}
          onClick={() => void saveAndStartAgentProject()}
        >
          {agentTargetBusy()
            ? "Saving current work..."
            : "Save and start a new project"}
        </button>
      </Show>
      <Show when={agentTargetConfirmed()}>
        <p>Edits are allowed in the current project.</p>
      </Show>
      <Show when={canRestoreAgent()}>
        <button type="button" class="booth-btn" onClick={restoreBeforeAgent}>
          Restore before agent
        </button>
        <p>
          Restores the project before the agent's first edit, including any
          manual edits since. Individual edits also support Undo.
        </p>
      </Show>
      <span class="booth-sr" role="status">
        Agent access {agentStatus()}.
      </span>
    </section>
  );
}
