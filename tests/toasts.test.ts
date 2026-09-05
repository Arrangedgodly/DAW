/**
 * HU-2 toast bus behavior: kind semantics (error sticky, info/success
 * auto-dismiss), the max-3 stack with oldest-dropped, dismiss, and the
 * one-shot action (runs then dismisses).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_DISMISS_MS,
  MAX_TOASTS,
  clearToasts,
  dismissToast,
  pushToast,
  showError,
  showInfo,
  toastStack,
} from "../src/state/toasts";

describe("toast bus (HU-2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });
  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it("errors are sticky until dismissed", () => {
    showError("damaged", { suggestion: "re-export" });
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 3);
    expect(toastStack()).toHaveLength(1);
    expect(toastStack()[0]!.kind).toBe("error");
    expect(toastStack()[0]!.suggestion).toBe("re-export");

    dismissToast(toastStack()[0]!.id);
    expect(toastStack()).toHaveLength(0);
  });

  it("info and success auto-dismiss; a dismiss cancels the timer", () => {
    showInfo("AUDIO DEVICE CHANGED");
    showInfo("another");
    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(toastStack()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(toastStack()).toHaveLength(0);

    const sid = pushToast({ kind: "success", message: "NEW PROJECT READY" });
    dismissToast(sid); // before the timer fires
    vi.advanceTimersByTime(AUTO_DISMISS_MS + 1);
    expect(toastStack()).toHaveLength(0);
  });

  it("XP-1: sticky info toasts never auto-dismiss — the owner's dismiss is the only exit", () => {
    // A 128-bar offline render outlives AUTO_DISMISS_MS; the RENDERING…
    // state must stay on screen for the whole render.
    const id = showInfo("RENDERING WAV…", { sticky: true });
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 10);
    expect(toastStack()).toHaveLength(1);
    expect(toastStack()[0]!.message).toBe("RENDERING WAV…");

    // Explicit dismiss (the export handler's finally) removes it.
    dismissToast(id);
    expect(toastStack()).toHaveLength(0);

    // Non-sticky twins still auto-dismiss (the default is unchanged).
    showInfo("plain info");
    vi.advanceTimersByTime(AUTO_DISMISS_MS + 1);
    expect(toastStack()).toHaveLength(0);
  });

  it("caps the stack at 3, dropping the OLDEST toast", () => {
    showInfo("one");
    showInfo("two");
    showInfo("three");
    showInfo("four");
    expect(toastStack()).toHaveLength(MAX_TOASTS);
    expect(toastStack().map((t) => t.message)).toEqual([
      "two",
      "three",
      "four",
    ]);
    // The dropped toast's timer is cancelled too — it cannot resurrect.
    vi.advanceTimersByTime(AUTO_DISMISS_MS + 1);
    expect(toastStack()).toHaveLength(0);
  });

  it("an action runs exactly once and then dismisses the toast", () => {
    const run = vi.fn();
    showError("saved project damaged", { action: { label: "RECOVER", run } });
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2); // errors never auto-dismiss
    expect(toastStack()).toHaveLength(1);

    const action = toastStack()[0]!.action!;
    expect(action.label).toBe("RECOVER");
    action.run();
    action.run(); // second invocation is a second explicit call, not the toast's
    expect(run).toHaveBeenCalledTimes(2);

    // The documented Toasts-component behavior: click = run + dismiss.
    dismissToast(toastStack()[0]!.id);
    expect(toastStack()).toHaveLength(0);
  });

  it("keeps kinds separated for the component's polite/assertive regions", () => {
    showInfo("i");
    showError("e");
    pushToast({ kind: "success", message: "s" });
    const kinds = toastStack().map((t) => t.kind);
    expect(kinds.filter((k) => k === "error")).toEqual(["error"]);
    expect(kinds.filter((k) => k !== "error")).toEqual(["info", "success"]);
  });
});
