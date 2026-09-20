import { createSignal, onCleanup, Show } from "solid-js";
import { docStore } from "../state/store";
import { composition } from "../viz/compositionState";
import { trackColor } from "../state/trackColors";
import { ALL_LANE_IDS, type ProjectDocument } from "../document/schema";
import { safeFileStem } from "../persist/fileIO";
import {
  VIDEO_FORMATS,
  videoCycleBars,
  createVideoPlan,
  type VideoFormat,
} from "../viz/videoPlan";
import "../styles/viz-video-export.css";
import { registerHelp } from "../help/registry";

registerHelp([
  {
    id: "viz.video",
    title: "EXPORT VIDEO",
    text: "Render your song and visualizer together as an MP4 in this browser. Choose a desktop or phone frame and the full song or a range of bars. Preview the finished video before saving it. Cancel stops the export after any audio already rendering finishes.",
  },
]);

export default function VizVideoExport() {
  let dialog!: HTMLDialogElement;
  let controller: AbortController | undefined;
  let snapshot: ProjectDocument;
  let disposed = false;
  const [format, setFormat] = createSignal<VideoFormat>("desktop");
  const [range, setRange] = createSignal(false);
  const [bars, setBars] = createSignal(1);
  const [start, setStart] = createSignal(1);
  const [end, setEnd] = createSignal(1);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [progress, setProgress] = createSignal(0);
  const [url, setUrl] = createSignal("");
  const [filename, setFilename] = createSignal("");
  const clearResult = () => {
    if (url()) URL.revokeObjectURL(url());
    setUrl("");
  };
  const cancel = () => {
    controller?.abort();
    setMessage(
      "Cancelling… Audio already rendering will finish before cleanup.",
    );
  };
  onCleanup(() => {
    disposed = true;
    controller?.abort();
    clearResult();
  });
  const open = () => {
    snapshot = structuredClone(docStore.getState().doc);
    setBars(videoCycleBars(snapshot));
    setStart(1);
    setEnd(bars());
    setMessage("");
    clearResult();
    dialog.showModal();
  };
  const render = async () => {
    if (busy()) return;
    clearResult();
    setBusy(true);
    setProgress(0);
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const first = range() ? start() : 1;
      const last = range() ? end() : bars();
      createVideoPlan(snapshot, first, last);
      const settings = structuredClone(composition());
      const colors = Object.fromEntries(
        ALL_LANE_IDS.map((id) => [id, trackColor(id)]),
      );
      const ground = getComputedStyle(dialog)
        .getPropertyValue("--color-ground")
        .trim();
      setMessage("Loading video exporter…");
      const { exportVideo } = await import("../viz/exportVideo");
      const blob = await exportVideo(snapshot, {
        format: format(),
        startBar: first,
        endBar: last,
        composition: settings,
        colors,
        ground,
        signal,
        onProgress: (text, fraction) => {
          if (!disposed && !signal.aborted) {
            setMessage(text);
            setProgress(fraction);
          }
        },
      });
      if (disposed || signal.aborted) return;
      setFilename(`${safeFileStem(snapshot.name)}.${format()}.mp4`);
      setUrl(URL.createObjectURL(blob));
      setMessage("Your MP4 is ready. Preview it, then save the video.");
      setProgress(1);
    } catch (error) {
      if (!disposed)
        setMessage(
          signal.aborted
            ? "Export cancelled."
            : error instanceof Error
              ? error.message
              : "Video export failed. Try again.",
        );
    } finally {
      controller = undefined;
      if (!disposed) setBusy(false);
    }
  };
  return (
    <>
      <button class="viz-btn" data-help="viz.video" onClick={open}>
        Export video
      </button>
      <dialog
        ref={(element) => {
          dialog = element;
        }}
        class="viz-video-dialog"
        data-help="viz.video"
        aria-labelledby="viz-video-title"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => {
          if (busy()) {
            event.preventDefault();
            cancel();
          }
        }}
        onClose={clearResult}
      >
        <h2 id="viz-video-title">Export visualizer video</h2>
        <p>
          The current composition and track audio, rendered on this device.
          1080p · 30 fps · MP4.
        </p>
        <fieldset disabled={busy()}>
          <legend>Video settings</legend>
          <label>
            Format
            <select
              value={format()}
              onChange={(e) => {
                setFormat(e.currentTarget.value as VideoFormat);
                clearResult();
              }}
            >
              <option value="desktop">
                {VIDEO_FORMATS.desktop.label} · 1920 × 1080
              </option>
              <option value="mobile">
                {VIDEO_FORMATS.mobile.label} · 1080 × 1920
              </option>
            </select>
          </label>
          <label>
            Section
            <select
              value={range() ? "range" : "full"}
              onChange={(e) => {
                setRange(e.currentTarget.value === "range");
                clearResult();
              }}
            >
              <option value="full">
                Full arrangement · {bars()} {bars() === 1 ? "bar" : "bars"}
              </option>
              <option value="range">Choose bars</option>
            </select>
          </label>
          <Show when={range()}>
            <div class="viz-video-range">
              <label>
                First bar
                <input
                  type="number"
                  min="1"
                  max={bars()}
                  step="1"
                  value={start()}
                  onInput={(e) => {
                    setStart(e.currentTarget.valueAsNumber);
                    clearResult();
                  }}
                />
              </label>
              <label>
                Last bar
                <input
                  type="number"
                  min={start()}
                  max={bars()}
                  step="1"
                  value={end()}
                  onInput={(e) => {
                    setEnd(e.currentTarget.valueAsNumber);
                    clearResult();
                  }}
                />
              </label>
            </div>
          </Show>
        </fieldset>
        <p class="viz-video-note">
          Full arrangement means one complete song cycle, like WAV export. Song
          cycles up to 5 minutes are supported. Keep this tab open while
          rendering.
        </p>
        <Show when={busy()}>
          <progress
            aria-label="Video export progress"
            max="1"
            value={progress()}
          />
        </Show>
        <p role="status" aria-live="polite">
          {message()}
        </p>
        <Show when={url()}>
          <video
            class="viz-video-preview"
            src={url()}
            controls
            playsinline
            aria-label="Exported visualizer preview"
          />
        </Show>
        <div class="viz-video-actions">
          <Show
            when={!busy()}
            fallback={
              <button class="viz-btn" onClick={cancel}>
                Cancel export
              </button>
            }
          >
            <button class="viz-btn" onClick={() => dialog.close()}>
              Close
            </button>
            <Show
              when={url()}
              fallback={
                <button class="viz-btn" onClick={() => void render()}>
                  Render MP4
                </button>
              }
            >
              <a class="viz-btn" href={url()} download={filename()}>
                Save MP4
              </a>
            </Show>
          </Show>
        </div>
      </dialog>
    </>
  );
}
