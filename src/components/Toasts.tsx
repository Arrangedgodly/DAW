/**
 * Toasts (HU-2) — the single renderer for the shared toast bus
 * (src/state/toasts.ts). Errors render inside a role=alert region (assertive
 * aria-live) with a real dismiss button and the optional action; info and
 * success render in a role=status polite region and self-dismiss. Keyboard
 * operable: every control is a real <button>.
 */

import { For } from "solid-js";
import { dismissToast, toastStack, type Toast } from "../state/toasts";
import "../styles/toasts.css";

function ToastCard(props: { toast: Toast }) {
  const t = () => props.toast;
  return (
    <div class={`toast toast-${t().kind}`} data-kind={t().kind}>
      <div class="toast-body">
        <p class="toast-message">{t().message}</p>
        {t().details && t().details!.length > 0 && (
          <ul class="toast-details">
            {t()
              .details!.slice(0, 3)
              .map((line) => (
                <li>{line}</li>
              ))}
          </ul>
        )}
        {t().suggestion && <p class="toast-suggestion">{t().suggestion}</p>}
        {t().action && (
          <button
            type="button"
            class="toast-action"
            onClick={() => {
              t().action!.run();
              dismissToast(t().id);
            }}
          >
            {t().action!.label}
          </button>
        )}
      </div>
      <button
        type="button"
        class="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(t().id)}
      >
        ✕
      </button>
    </div>
  );
}

export default function Toasts() {
  const errors = () => toastStack().filter((t) => t.kind === "error");
  const polite = () => toastStack().filter((t) => t.kind !== "error");
  return (
    // DA-2: no aria-label here — a generic div may not carry one
    // (axe aria-prohibited-attr); the two live regions below carry the
    // semantics and the messages announce through them.
    <div class="toasts">
      <div class="toasts-polite" role="status" aria-live="polite">
        <For each={polite()}>{(t) => <ToastCard toast={t} />}</For>
      </div>
      <div class="toasts-errors" role="alert" aria-live="assertive">
        <For each={errors()}>{(t) => <ToastCard toast={t} />}</For>
      </div>
    </div>
  );
}
