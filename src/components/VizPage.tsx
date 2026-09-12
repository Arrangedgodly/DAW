import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { getSession } from "../engine/session";
import {
  LANE_IDS,
  documentLaneMixGains,
  type DefaultLaneId as LaneId,
} from "../document/schema";
import { docStore } from "../state/store";
import { helpOpen } from "../state/helpOverlay";
import { helpMode } from "../state/helpMode";
import { closeViz } from "../state/vizMode";
import { createVizRenderer } from "../viz/renderer";
import { createVizPipeline } from "../viz/pipeline";
import { createCompositionEngine } from "../viz/compositionEngine";
import {
  composition,
  changeComposition,
  restoreComposition,
} from "../viz/compositionState";
import { rerollComposition, type MotionMode } from "../viz/composition";
import {
  createVizAnnouncer,
  VIZ_ON_ANNOUNCEMENT,
  VIZ_ON_IDLE_ANNOUNCEMENT,
} from "../viz/announcements";
import {
  createVizActivitySummarizer,
  releaseVizActivitySummarizer,
} from "../viz/textEquivalence";
import VizRemote from "./VizRemote";
import { trackColor } from "../state/trackColors";
import "../styles/viz.css";

export default function VizPage(): JSX.Element {
  restoreComposition();
  const session = getSession();
  const [selected, setSelected] = createSignal<LaneId>("drums");
  const [playing, setPlaying] = createSignal(
    session.transport.snapshot.playing,
  );
  const motionMode = () => composition().motion ?? "fluid";
  const blended = () => composition().blended ?? true;
  const [viewOnly, setViewOnly] = createSignal(false);
  const [reduced, setReduced] = createSignal(false);
  let canvas!: HTMLCanvasElement,
    stage!: HTMLDivElement,
    region!: HTMLDivElement,
    error!: HTMLDivElement;
  let engine: ReturnType<typeof createCompositionEngine> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const announcer = createVizAnnouncer();
  const announce = (text: string): void => announcer.announce(text);
  const cancelReroll = (): void => {
    clearTimeout(pending);
    pending = undefined;
  };
  const reroll = (): void => {
    cancelReroll();
    pending = setTimeout(() => {
      pending = undefined;
      changeComposition(rerollComposition(composition()));
      announce(
        "Composition rerolled. All four effects and orbit angles changed.",
      );
    }, 150);
  };
  createEffect(() => {
    const next = composition();
    engine?.setComposition(next);
  });
  onMount(() => {
    announcer.attach(region);
    const entry = setTimeout(
      () =>
        announce(playing() ? VIZ_ON_ANNOUNCEMENT : VIZ_ON_IDLE_ANNOUNCEMENT),
      0,
    );
    document
      .querySelector<HTMLButtonElement>('[aria-label="Select drums"]')
      ?.focus();
    const styles = getComputedStyle(stage);
    const colors = Object.fromEntries(
      LANE_IDS.map((id) => [
        id,
        styles.getPropertyValue(`--color-lane-${id}`).trim(),
      ]),
    ) as Record<LaneId, string>;
    engine = createCompositionEngine(composition(), colors);
    // Update paint only; keep active note envelopes and playback intact.
    createEffect(() => {
      engine?.setColors(
        Object.fromEntries(
          LANE_IDS.map((id) => [id, trackColor(id)]),
        ) as Record<LaneId, string>,
      );
    });
    engine.setPlaying(playing());
    let bpm = docStore.getState().doc.transport.bpm;
    let mixGains: number[] = [];
    const syncMix = () => {
      const doc = docStore.getState().doc;
      bpm = doc.transport.bpm;
      mixGains = documentLaneMixGains(doc);
      mixGains.forEach((gain, index) =>
        engine?.setAudible(LANE_IDS[index]!, gain > 0),
      );
    };
    syncMix();
    const stopDoc = docStore.subscribe(syncMix);
    const stopTransport = session.subscribe((snap) => {
      if (snap.playing !== playing()) {
        setPlaying(snap.playing);
        engine?.setPlaying(snap.playing);
        announce(
          snap.playing
            ? "Playback started."
            : "Playback stopped. Return to DAW to play.",
        );
      }
    });
    const clock = (): number =>
      session.engine.created
        ? session.engine.getContext().currentTime
        : Number.NaN;
    const summary = createVizActivitySummarizer();
    const pipeline = createVizPipeline({
      subscribeNoteOns: (listener) => session.subscribeNoteOns(listener),
      subscribeTransport: (listener) => session.subscribe(listener),
      subscribeVisibility: (listener) => {
        const handler = (): void => listener(document.hidden);
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
      audioTime: clock,
      onDueHits: (hits, now) => {
        for (const hit of hits) {
          const index = LANE_IDS.findIndex((id) => id === hit.lane);
          if (index < 0 || !(mixGains[index]! > 0)) continue;
          engine?.ignite(hit);
          if (reduced()) {
            const line = summary.note(hit, now);
            if (line) announce(line);
          }
        }
      },
    });
    const renderer = createVizRenderer({
      canvas,
      onFrame: (ctx, frame) => {
        pipeline.onFrame(ctx, frame);
        engine?.draw(ctx, frame, clock(), bpm);
      },
      onReducedMotionChange: (value) => {
        setReduced(value);
        engine?.setReducedMotion(value);
      },
      onError: () => {
        error.textContent =
          "The visual display stopped. Return to DAW and reopen it to try again. Audio is unaffected.";
        announce(error.textContent);
      },
    });
    renderer.start();
    setReduced(renderer.probe().reducedMotion);
    engine.setReducedMotion(reduced());
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || helpOpen() || helpMode()) return;
      // Let the native palette close first, without leaving the visualizer.
      if (document.querySelector(".track-swatch-panel:popover-open")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (viewOnly()) {
        setViewOnly(false);
        queueMicrotask(() =>
          document
            .querySelector<HTMLButtonElement>(
              `[aria-label="Select ${selected()}"]`,
            )
            ?.focus(),
        );
      } else closeViz();
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      clearTimeout(entry);
      cancelReroll();
      stopDoc();
      stopTransport();
      window.removeEventListener("keydown", onKey, true);
      renderer.dispose();
      pipeline.dispose();
      engine?.dispose();
      engine = undefined;
      releaseVizActivitySummarizer(summary);
      announcer.dispose();
    });
  });
  return (
    <section
      class="viz-page"
      classList={{ "viz-view-only": viewOnly() }}
      aria-label="VIZ — visualizer stage"
    >
      <header class="viz-header">
        <div>
          <h1>Visual composition</h1>
          <p>
            {playing()
              ? "Following your song"
              : "Playback stopped · Return to DAW to play"}
            {reduced() ? " · Reduced motion" : ""}
          </p>
        </div>
        <div class="viz-motion-controls" aria-label="Composition motion">
          <label data-help="viz.motion">
            Motion{" "}
            <select
              aria-label="Motion direction"
              value={motionMode()}
              onChange={(e) => {
                cancelReroll();
                changeComposition({
                  ...composition(),
                  motion: e.currentTarget.value as MotionMode,
                });
              }}
            >
              <option value="fluid">Fluid folds</option>
              <option value="trails">Flowing trails</option>
              <option value="orbit">Orbit</option>
            </select>
          </label>
          <label data-help="viz.blending">
            Composition{" "}
            <select
              aria-label="Instrument blending"
              disabled={motionMode() === "orbit"}
              value={blended() ? "blend" : "distinct"}
              onChange={(e) => {
                cancelReroll();
                changeComposition({
                  ...composition(),
                  blended: e.currentTarget.value === "blend",
                });
              }}
            >
              <option value="blend">Blended</option>
              <option value="distinct">Distinct</option>
            </select>
          </label>
        </div>
        <div class="viz-header-actions">
          <button
            class="viz-btn"
            data-help="viz.view"
            aria-pressed={viewOnly()}
            onClick={() => setViewOnly(!viewOnly())}
          >
            {viewOnly() ? "Edit composition" : "Hide controls"}
          </button>
          <button
            class="viz-btn"
            data-help="viz.exit"
            onClick={() => closeViz()}
          >
            Return to DAW
          </button>
        </div>
      </header>
      <div class="viz-workspace">
        <div
          class="viz-stage"
          ref={(el) => {
            stage = el;
          }}
        >
          <canvas
            ref={(el) => {
              canvas = el;
            }}
            class="viz-canvas"
            aria-hidden="true"
          />
          <svg
            class="viz-orbit-guide"
            viewBox="0 0 100 100"
            aria-hidden="true"
            style={{
              display:
                viewOnly() || motionMode() !== "orbit" ? "none" : undefined,
            }}
          >
            <circle
              cx="50"
              cy="50"
              r={
                (32 * (composition().lanes[selected()].orbitStrength ?? 60)) /
                100
              }
            />
            <path d="M48 50h4M50 48v4" />
          </svg>
          <p class="viz-stage-hint" hidden={viewOnly()}>
            {motionMode() === "orbit"
              ? "One shared center. Set each instrument's scale and orbit strength."
              : "Set the motion and overlap above. Each effect follows its own MIDI notes."}
          </p>
          <div
            class="viz-error"
            ref={(el) => {
              error = el;
            }}
          />
        </div>
        <VizRemote
          showOrbit={motionMode() === "orbit"}
          selected={selected()}
          onSelect={setSelected}
          announce={announce}
          beforeEdit={cancelReroll}
        />
      </div>
      <footer class="viz-footer">
        <button
          class="viz-btn viz-reroll"
          data-help="viz.reroll"
          onClick={reroll}
        >
          Reroll composition
        </button>
        <span>New effects. Your motion settings. Same song.</span>
        <output aria-live="off" aria-label="Composition seed">
          Seed {composition().seed}
        </output>
      </footer>
      <div
        ref={(el) => {
          region = el;
        }}
        class="viz-announce"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="VIZ announcements"
      />
    </section>
  );
}
