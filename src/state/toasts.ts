/**
 * Shared toast bus (HU-2, promoting MF-3's per-component toast): one
 * module-level Solid signal list every surface pushes into; the single
 * <Toasts/> component in the App shell renders it. Failure-state contract
 * (town-hall "Important states"): every failure needs a visible, recoverable
 * state — errors are STICKY with an explicit dismiss (plus an optional
 * one-shot action like RECOVER); info/success auto-dismiss. Errors announce
 * assertively (role=alert), info/success politely (role=status). Max 3
 * stacked — the OLDEST toast is dropped first so a burst never floods the
 * screen.
 *
 * Timers: auto-dismiss uses setTimeout captured at push time (unit tests use
 * fake timers). Dismissing cancels the pending timer.
 */

import { createSignal } from "solid-js";

export type ToastKind = "error" | "info" | "success";

export interface ToastAction {
  readonly label: string;
  /**
   * Runs then the toast dismisses — UNLESS the run resolves `false`: a
   * failed async action (i6 §4.6: UNDO's re-put under a full storage quota)
   * keeps the toast armed so the user can retry after freeing space. Sync
   * `void` returns (the RECOVER precedent) keep the one-shot vehicle exactly
   * as before.
   */
  run: () => void | boolean | Promise<void | boolean>;
}

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  /** Recovery suggestion shown under the message (errors mainly). */
  readonly suggestion?: string;
  /** Bounded detail lines (e.g. first validation issues). */
  readonly details?: readonly string[];
  /** Optional one-shot action (RECOVER…); runs then dismisses. */
  readonly action?: ToastAction;
  /**
   * XP-1: no auto-dismiss timer — the toast stays until explicitly
   * dismissed (by its owner or the user's ✕). For in-flight work states
   * (RENDERING WAV…) that must stay on screen for as long as the work
   * runs; a 128-bar offline render outlives the 5 s auto-dismiss window.
   */
  readonly sticky?: boolean;
}

export interface ToastInput {
  readonly kind: ToastKind;
  readonly message: string;
  readonly suggestion?: string;
  readonly details?: readonly string[];
  readonly action?: ToastAction;
  /** XP-1: see Toast.sticky — the caller owns dismissal. */
  readonly sticky?: boolean;
}

export const MAX_TOASTS = 3;
export const AUTO_DISMISS_MS = 5000;

const [toasts, setToasts] = createSignal<readonly Toast[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Current stack, oldest first (reactive read for the Toasts component). */
export function toastStack(): readonly Toast[] {
  return toasts();
}

function cancelTimer(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

/** Push a toast; returns its id. Info/success auto-dismiss; stack caps at 3. */
export function pushToast(input: ToastInput): number {
  const id = nextId++;
  setToasts((stack) => {
    const next = [...stack, { id, ...input }];
    // Cap: drop the OLDEST entries (and their timers) beyond MAX_TOASTS.
    while (next.length > MAX_TOASTS) {
      const dropped = next.shift();
      if (dropped) cancelTimer(dropped.id);
    }
    return next;
  });
  if (input.kind !== "error" && !input.sticky) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), AUTO_DISMISS_MS),
    );
  }
  return id;
}

/** Explicit dismiss (error toasts, toast buttons). No-op on unknown ids. */
export function dismissToast(id: number): void {
  cancelTimer(id);
  setToasts((stack) => stack.filter((t) => t.id !== id));
}

/** Drop everything (tests). */
export function clearToasts(): void {
  for (const id of [...timers.keys()]) cancelTimer(id);
  setToasts([]);
}

/** Convenience wrappers for the three kinds. */
export const showError = (
  message: string,
  extra: Omit<ToastInput, "kind" | "message"> = {},
) => pushToast({ kind: "error", message, ...extra });
export const showInfo = (
  message: string,
  extra: Omit<ToastInput, "kind" | "message"> = {},
) => pushToast({ kind: "info", message, ...extra });
export const showSuccess = (
  message: string,
  extra: Omit<ToastInput, "kind" | "message"> = {},
) => pushToast({ kind: "success", message, ...extra });
