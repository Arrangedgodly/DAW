/**
 * Audio device / context-state watch (HU-2, Hulk: device or sample-rate
 * change mid-session must RECOVER, not crash). Policy (town-hall): keep the
 * AudioContext — recreating it kills every voice — duck the master briefly to
 * avoid pops when resuming, and surface an info toast. An UNEXPECTED suspend
 * (context leaves "running" while the transport is playing — iOS interruption,
 * OS device switch; NOT a user stop, which stops the transport first) shows a
 * "TAP TO RESUME AUDIO" affordance wired to engine.unlock().
 *
 * DOM-free core: both event sources (navigator.mediaDevices and the context)
 * are injected, so the logic is unit-testable with fake targets.
 */

/** What the watcher needs from the session/engine (all injectable). */
export interface DeviceWatchSession {
  /** True while the transport is playing (user stop clears this first). */
  readonly isPlaying: () => boolean;
  /** Brief master duck (pop guard around device transitions). */
  readonly duckMaster: () => void;
  /** Gesture-safe resume (the TAP TO RESUME button's click handler). */
  readonly unlock: () => Promise<void>;
}

export interface MediaDevicesLike {
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
}

export interface AudioContextLike {
  readonly state: string;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

export interface DeviceWatchHandlers {
  /** A device was added/removed (info toast + master duck). */
  readonly onDeviceChange: () => void;
  /** Context left "running" while playing (show TAP TO RESUME). */
  readonly onUnexpectedSuspend: () => void;
  /** Context returned to "running" (clear the resume affordance). */
  readonly onAudioResumed: () => void;
}

/** True when a context state counts as suspended-but-should-be-running. */
export function isSuspiciousState(state: string): boolean {
  // "interrupted" is iOS-only; not in the TS AudioContextState union.
  return state === "suspended" || state === "interrupted" || state === "closed";
}

/**
 * Wire the two listeners. Returns a dispose function (Solid onCleanup).
 * `getContext` lets the lazily-created AudioContext attach when it exists.
 */
export function watchAudioDevices(
  targets: {
    readonly mediaDevices?: MediaDevicesLike | null;
    readonly getContext: () => AudioContextLike | null;
  },
  session: DeviceWatchSession,
  handlers: DeviceWatchHandlers,
): () => void {
  let disposed = false;
  let attached: AudioContextLike | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const onDeviceChange = () => {
    // Keep the context (voices live); duck to keep any transition pop quiet.
    session.duckMaster();
    handlers.onDeviceChange();
  };
  const onStateChange = () => {
    const ctx = attached;
    if (!ctx) return;
    if (ctx.state === "running") {
      handlers.onAudioResumed();
    } else if (isSuspiciousState(ctx.state) && session.isPlaying()) {
      // Not a user stop: the transport is still playing but audio halted.
      handlers.onUnexpectedSuspend();
    }
  };

  targets.mediaDevices?.addEventListener("devicechange", onDeviceChange);

  const attach = (ctx: AudioContextLike) => {
    attached = ctx;
    ctx.addEventListener("statechange", onStateChange);
  };
  const first = targets.getContext();
  if (first) {
    attach(first);
  } else {
    // The AudioContext is created lazily on first audio use; poll cheaply
    // (500 ms, no audio-thread impact) until it exists.
    poll = setInterval(() => {
      if (disposed) {
        if (poll) clearInterval(poll);
        return;
      }
      const ctx = targets.getContext();
      if (ctx) {
        attach(ctx);
        if (poll) clearInterval(poll);
        poll = null;
      }
    }, 500);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    targets.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
    attached?.removeEventListener("statechange", onStateChange);
    if (poll) clearInterval(poll);
  };
}
