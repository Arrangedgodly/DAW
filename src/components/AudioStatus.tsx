/**
 * AudioStatus (HU-2): mounts the device/context watcher and renders the
 * "TAP TO RESUME AUDIO" affordance when the context suspends unexpectedly
 * (iOS interruption / OS device switch while playing). Device changes surface
 * as an info toast ("AUDIO DEVICE CHANGED"); the context is NEVER recreated.
 */

import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { getSession } from "../engine/session";
import {
  watchAudioDevices,
  type AudioContextLike,
  type MediaDevicesLike,
} from "../engine/deviceWatch";
import { showInfo } from "../state/toasts";
import { registerHelp } from "../help/registry";
import "../styles/toasts.css";

// HP-2 coverage: the resume affordance is an interactive control (I2-6
// colocated law).
registerHelp([
  {
    id: "audio.resume",
    title: "RESUME AUDIO",
    text: "Sound was interrupted — a device switch or the system standing the tab down. Press to bring it back; nothing about your song was lost.",
  },
]);

export default function AudioStatus() {
  const session = getSession();
  const [needsResume, setNeedsResume] = createSignal(false);

  onMount(() => {
    const mediaDevices: MediaDevicesLike | null =
      typeof navigator !== "undefined" && "mediaDevices" in navigator
        ? ((navigator as Navigator & { mediaDevices?: MediaDevicesLike })
            .mediaDevices ?? null)
        : null;
    const dispose = watchAudioDevices(
      {
        mediaDevices,
        getContext: () => {
          if (!session.engine.created) return null;
          // The real AudioContext satisfies the listener surface; the engine's
          // narrow AudioContextLike type just doesn't declare it.
          return session.engine.getContext() as unknown as AudioContextLike;
        },
      },
      {
        isPlaying: () => session.transport.snapshot.playing,
        duckMaster: () => session.duckMaster(),
        unlock: () => session.engine.unlock(),
      },
      {
        onDeviceChange: () => showInfo("AUDIO DEVICE CHANGED"),
        onUnexpectedSuspend: () => setNeedsResume(true),
        onAudioResumed: () => setNeedsResume(false),
      },
    );
    onCleanup(dispose);
  });

  return (
    <Show when={needsResume()}>
      <button
        type="button"
        class="audio-resume"
        data-help="audio.resume"
        onClick={() => void session.engine.unlock()}
      >
        TAP TO RESUME AUDIO
      </button>
    </Show>
  );
}
