import { Show } from "solid-js";
import { registerHelp } from "../help/registry";
import {
  agentStatus,
  agentError,
  canRestoreAgent,
  restoreBeforeAgent,
  agentTargetConfirmed,
} from "../webmcp/access";

registerHelp([
  {
    id: "projects.agent",
    title: "AGENT ACCESS",
    text: "Agent tools connect automatically when WebMCP is available. Tell your agent whether to edit this project or start a new one. Its provider may process project data. Restore before agent also removes manual edits made after the recovery point.",
  },
]);

export default function AgentAccess() {
  return (
    <Show when={agentStatus() !== "off" || canRestoreAgent()}>
      <section
        class="agent-access"
        aria-label="Agent access"
        data-help="projects.agent"
      >
        <p role="status">
          {agentStatus() === "on"
            ? agentTargetConfirmed()
              ? "Agent tools connected. Edits are allowed in this project."
              : "Agent tools connected. Confirm the current project or a new one in your agent conversation."
            : agentStatus() === "starting"
              ? "Connecting agent tools..."
              : "Agent tools paused."}
        </p>
        <p>Your agent provider may process project data.</p>
        <Show when={agentError()}>
          <p role="alert">{agentError()}</p>
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
      </section>
    </Show>
  );
}
