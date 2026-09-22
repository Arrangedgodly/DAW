import MixerParam from "./MixerParam";
import type { MixerSpectrum } from "./MixerGraph";
import MixerEq from "./MixerEq";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import {
  DEFAULT_CHANNEL,
  DEFAULT_MASTER,
  type ChannelProcessing,
  type Compressor,
} from "../document/mixer";
import type { LaneId, ProjectDocument } from "../document/schema";
import { ALL_LANE_IDS } from "../document/schema";
import { dbToGain, gainToDb } from "../audio/mixer";
import {
  measureArrangementContext,
  measureStereo,
  proposeAutoMix,
  type AudioStats,
  type MixProposal,
} from "../audio/autoMix";
import { renderProjectToBuffer, type RenderedLoop } from "../audio/render";
import { getSession } from "../engine/session";
import { commitDocumentEdit, docStore, setLaneMix } from "../state/store";
import {
  restoreMix,
  mixRestorePoint as restore,
  setMixRestorePoint as setRestore,
  setChannelProcessing,
  setMasterProcessing,
} from "../state/mixer";
import { activeLane, selectLane } from "../state/selection";
import { laneDisplayName } from "./laneMeta";
import { trackColor } from "../state/trackColors";
import FxStrip from "./FxStrip";
import { registerHelp } from "../help/registry";

registerHelp([
  {
    id: "mixer.rack",
    title: "DEVICE RACK",
    text: "Effects run from left to right. Scroll sideways to reach more devices, or focus the rack and use the arrow keys. Add FX opens the effect picker for the selected track or Master. Each added device can be moved earlier or later, bypassed, or removed. Changes are saved with the project and included in audio exports.",
  },
  {
    id: "mixer.auto",
    title: "AUTO MIX",
    text: "Analyze the arrangement on this device, then compare before and after at matched volume. Balance makes more room for the lead when supporting tracks play alongside it. EQ makes small tone cuts where tracks overlap. Dynamics controls peaks and can add a little level when there is headroom. Amount scales the changes. Locked tracks stay as you set them. Apply makes one undoable edit; Restore returns to the previous mix.",
  },
  {
    id: "mixer.channel",
    title: "CHANNEL STRIP",
    text: "Select a track to edit its processing below. Level sets its output volume; M mutes it and S solos it. Lock excludes the track from Auto Mix. The meter shows the sound after processing. Master controls the combined output.",
  },
  {
    id: "mixer.pan",
    title: "PAN",
    text: "Move this track left or right in the stereo image. Zero keeps it centered. Panning is saved with the project and included in audio exports.",
  },
  {
    id: "mixer.eq",
    title: "EQUALIZER",
    text: "Add up to eight EQ bands. Select a numbered node to change its type, frequency, gain or Q. Every band can move across the full frequency range. Drag nodes or use arrow keys; hold Shift to adjust Q. Bypass a band or the whole equalizer to compare without losing settings.",
  },
  {
    id: "mixer.compressor",
    title: "COMPRESSION",
    text: "Enable compression to reduce peaks above Threshold. Ratio sets how strongly they are reduced. Attack and Release control how quickly it responds and recovers. Makeup restores output level. The master glue compressor gently controls the combined mix.",
  },
  {
    id: "mixer.limiter",
    title: "MASTER LIMITER",
    text: "Enable the limiter to hold sample peaks below Ceiling. Release controls how quickly attenuation recovers. It catches sample peaks without lookahead and does not measure true peaks. Bypass returns to the original output protection.",
  },
]);

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  set: (value: number) => void;
}): JSX.Element {
  return (
    <label class="mixer-control">
      <span>
        {props.label}
        <output>
          {props.value.toFixed(props.step && props.step < 1 ? 1 : 0)}
          {props.unit ?? ""}
        </output>
      </span>
      <input
        type="range"
        aria-label={props.label}
        aria-valuetext={`${props.value}${props.unit ?? ""}`}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.set(Number(e.currentTarget.value))}
      />
    </label>
  );
}
function CompressorControls(props: {
  value: Compressor;
  set: (value: Compressor) => void;
  title: string;
}): JSX.Element {
  const set = (key: keyof Compressor, value: number | boolean) =>
    props.set({ ...props.value, [key]: value });
  return (
    <section class="mixer-device mixer-compressor" data-help="mixer.compressor">
      <div class="mixer-device-heading">
        <h3>{props.title}</h3>
        <button
          aria-label={`${props.value.enabled ? "Bypass" : "Enable"} ${props.title.toLowerCase()}`}
          aria-pressed={props.value.enabled}
          onClick={() => set("enabled", !props.value.enabled)}
        >
          {props.value.enabled ? "On" : "Bypassed"}
        </button>
      </div>
      <div class="mixer-control-grid">
        <MixerParam
          label="Threshold"
          value={props.value.threshold}
          min={-60}
          max={0}
          unit=" dB"
          set={(v) => set("threshold", v)}
        />
        <MixerParam
          label="Ratio"
          value={props.value.ratio}
          min={1}
          max={12}
          step={0.1}
          unit=":1"
          set={(v) => set("ratio", v)}
        />
        <MixerParam
          label="Attack"
          value={props.value.attack * 1000}
          min={1}
          max={100}
          unit=" ms"
          set={(v) => set("attack", v / 1000)}
        />
        <MixerParam
          label="Release"
          value={props.value.release * 1000}
          min={20}
          max={1000}
          unit=" ms"
          set={(v) => set("release", v / 1000)}
        />
        <MixerParam
          label="Makeup"
          value={props.value.makeup}
          min={0}
          max={12}
          step={0.1}
          unit=" dB"
          set={(v) => set("makeup", v)}
        />
      </div>
    </section>
  );
}
export default function MixerPage(): JSX.Element {
  const [doc, setDoc] = createSignal(docStore.getState().doc);
  const unsubscribe = docStore.subscribe((state) => setDoc(state.doc));
  onCleanup(unsubscribe);
  const ids = createMemo(() => doc().lanes.map((lane) => lane.id));
  const [selected, setSelected] = createSignal<LaneId | "master">(activeLane());
  const current = () =>
    doc().mixer?.channels[selected() as LaneId] ?? DEFAULT_CHANNEL;
  const master = () => doc().mixer?.master ?? DEFAULT_MASTER;
  const laneName = (id: LaneId) => {
    const lane = doc().lanes.find((l) => l.id === id);
    return lane
      ? laneDisplayName(id, lane.id === "drums" ? lane.kitId : lane.presetId)
      : id;
  };
  const patch = (update: (p: ChannelProcessing) => ChannelProcessing) =>
    setChannelProcessing(selected() as LaneId, update);
  const [meters, setMeters] = createSignal<
    Record<
      string,
      { peak: number; rms: number; reduction: number; limiter: number }
    >
  >({});
  const [spectrum, setSpectrum] = createSignal<MixerSpectrum>();
  const [autoOpen, setAutoOpen] = createSignal(false);
  const session = getSession();
  onMount(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const values: ReturnType<typeof meters> = {};
      for (const id of [...ids(), "master"] as const) {
        const audio = session.readMixerLevel(id);
        const reduction = session.readMixerReduction(id);
        values[id] = {
          peak: gainToDb(audio.peak),
          rms: gainToDb(audio.rms),
          reduction: reduction.compressor,
          limiter: reduction.limiter,
        };
      }
      setMeters(values);
      const bins = new Float32Array(2048);
      const sampleRate = session.readMixerSpectrum(selected(), bins);
      setSpectrum({ bins, sampleRate });
    }, 80);
    onCleanup(() => {
      clearInterval(timer);
      session.releaseMixerTaps();
    });
  });
  createEffect(() => {
    if (selected() !== "master" && !ids().includes(selected() as LaneId))
      setSelected("master");
  });
  const [busy, setBusy] = createSignal(false),
    [status, setStatus] = createSignal("");
  const [amount, setAmount] = createSignal(0.65),
    [balance, setBalance] = createSignal(true),
    [eq, setEq] = createSignal(true),
    [dynamics, setDynamics] = createSignal(true);
  const [proposal, setProposal] = createSignal<MixProposal | null>(null);
  const [basis, setBasis] = createSignal<ProjectDocument | null>(null);
  const [previewing, setPreviewing] = createSignal<"before" | "after" | null>(
    null,
  );
  let beforeAudio: RenderedLoop | null = null,
    afterAudio: RenderedLoop | null = null;
  let previewContext: AudioContext | null = null,
    source: AudioBufferSourceNode | null = null,
    previewGain: GainNode | null = null,
    disposed = false,
    generation = 0,
    previewGeneration = 0;
  const stopPreview = () => {
    previewGeneration++;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
      source = null;
    }
    previewGain?.disconnect();
    previewGain = null;
    setPreviewing(null);
  };
  const invalidate = () => {
    generation++;
    setProposal(null);
    setBasis(null);
    beforeAudio = null;
    afterAudio = null;
    stopPreview();
  };
  onCleanup(() => {
    disposed = true;
    generation++;
    stopPreview();
    void previewContext?.close();
  });
  const analyze = async () => {
    invalidate();
    const token = generation;
    const snapshot = doc();
    setBusy(true);
    setStatus("Rendering the arrangement and measuring each track…");
    try {
      if (snapshot.lanes.some((lane) => lane.solo))
        throw new Error("Turn off Solo before analyzing the full mix.");
      const before = await renderProjectToBuffer(snapshot, {
        arrangement: "linear",
        stereoLaneStems: true,
        maxDurationSeconds: 180,
      });
      if (disposed || token !== generation) return;
      const stats: Partial<Record<LaneId, AudioStats>> = {};
      snapshot.lanes.forEach((lane, index) => {
        stats[lane.id] = measureStereo(
          before.stereoLaneStems![index],
          before.sampleRate,
        );
      });
      const result = proposeAutoMix(
        snapshot,
        stats,
        {
          amount: amount(),
          balance: balance(),
          eq: eq(),
          dynamics: dynamics(),
        },
        measureArrangementContext(
          before.stereoLaneStems!,
          snapshot.lanes.map((lane) => lane.id),
          before.channels,
          before.sampleRate,
        ),
      );
      setStatus("Rendering the proposed mix for comparison…");
      const after =
        result.document === snapshot
          ? before
          : await renderProjectToBuffer(result.document, {
              arrangement: "linear",
              maxDurationSeconds: 180,
            });
      if (disposed || token !== generation) return;
      if (docStore.getState().doc !== snapshot)
        throw new Error(
          "The project changed during analysis. Analyze again to use your latest edits.",
        );
      beforeAudio = {
        ...before,
        laneStems: undefined,
        stereoLaneStems: undefined,
      };
      afterAudio = {
        ...after,
        laneStems: undefined,
        stereoLaneStems: undefined,
      };
      setBasis(snapshot);
      setProposal(result);
      setStatus(
        result.document === snapshot
          ? "No changes needed."
          : "Ready to compare. Preview levels are matched; Apply keeps the proposed output level.",
      );
    } catch (error) {
      if (!disposed)
        setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  const preview = async (which: "before" | "after") => {
    try {
      if (previewing() === which) {
        stopPreview();
        return;
      }
      const audio = which === "before" ? beforeAudio : afterAudio;
      if (!audio || !beforeAudio || !afterAudio) return;
      const previousOffset =
        previewContext && source
          ? previewContext.currentTime - previewStarted
          : 0;
      stopPreview();
      session.transport.stop();
      const token = previewGeneration;
      previewContext ??= new AudioContext();
      await previewContext.resume();
      if (disposed || token !== previewGeneration) return;
      const buffer = previewContext.createBuffer(
        2,
        audio.channels[0].length,
        audio.sampleRate,
      );
      audio.channels.forEach((channel, index) =>
        buffer.copyToChannel(Float32Array.from(channel), index),
      );
      const rms = (render: RenderedLoop) =>
        measureStereo(render.channels, render.sampleRate).activeDb;
      const beforeDb = rms(beforeAudio),
        afterDb = rms(afterAudio);
      const gain = previewContext.createGain();
      previewGain = gain;
      gain.gain.value = dbToGain(
        Math.min(beforeDb, afterDb) - (which === "before" ? beforeDb : afterDb),
      );
      source = previewContext.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(previewContext.destination);
      source.onended = () => {
        source?.disconnect();
        source = null;
        setPreviewing(null);
        gain.disconnect();
      };
      const offset = Math.min(
        previousOffset,
        Math.max(0, buffer.duration - 0.01),
      );
      previewStarted = previewContext.currentTime - offset;
      source.start(0, offset);
      setPreviewing(which);
    } catch (error) {
      setStatus(
        `Preview could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  let previewStarted = 0;
  const stale = () => basis() !== null && basis() !== doc();
  createEffect(() => {
    if (stale()) stopPreview();
  });
  const stopForTransport = session.subscribe((snapshot) => {
    if (snapshot.playing) stopPreview();
  });
  onCleanup(stopForTransport);
  const apply = () => {
    const result = proposal(),
      expected = basis();
    if (!result || !expected) return;
    try {
      stopPreview();
      commitDocumentEdit(expected, result.document);
      setRestore(expected);
      invalidate();
      setStatus(
        "Auto Mix applied. Every setting is editable. Undo or Restore before Auto Mix returns to your previous mix.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <main class="mixer-page" aria-label="Mixer">
      <header class="mixer-heading">
        <div>
          <h1>Mixer</h1>
        </div>
        <div class="mixer-heading-actions">
          <span>{ids().length} tracks + master</span>
          <button
            aria-expanded={autoOpen()}
            aria-controls="mixer-auto-panel"
            onClick={() => setAutoOpen(!autoOpen())}
          >
            Auto Mix
          </button>
        </div>
      </header>
      <section
        id="mixer-auto-panel"
        hidden={!autoOpen()}
        data-help="mixer.auto"
        class="mixer-auto"
        aria-label="Auto Mix"
      >
        <div>
          <h2>Auto Mix</h2>
          <p>
            Make room where tracks play together, then add a little punch if the
            mix has headroom. Your effects and locked tracks stay as you set
            them.
          </p>
        </div>
        <div class="mixer-auto-options">
          <label>
            <input
              type="checkbox"
              checked={balance()}
              disabled={busy()}
              onChange={(e) => {
                setBalance(e.currentTarget.checked);
                invalidate();
              }}
            />
            Balance
          </label>
          <label>
            <input
              type="checkbox"
              checked={eq()}
              disabled={busy()}
              onChange={(e) => {
                setEq(e.currentTarget.checked);
                invalidate();
              }}
            />
            EQ
          </label>
          <label>
            <input
              type="checkbox"
              checked={dynamics()}
              disabled={busy()}
              onChange={(e) => {
                setDynamics(e.currentTarget.checked);
                invalidate();
              }}
            />
            Dynamics
          </label>
          <Slider
            label="Amount"
            value={amount() * 100}
            min={0}
            max={100}
            unit="%"
            set={(v) => {
              setAmount(v / 100);
              invalidate();
            }}
          />
          <button
            class="mixer-primary"
            disabled={busy() || (!balance() && !eq() && !dynamics())}
            onClick={() => void analyze()}
          >
            {busy() ? "Analyzing…" : "Analyze arrangement"}
          </button>
        </div>
        <p class="mixer-status" role="status">
          {stale()
            ? "The project changed. Analyze again before applying this mix."
            : status() ||
              "Analyzes the full arrangement, up to 3 minutes. Nothing changes until you apply it."}
        </p>
        <Show when={proposal()}>
          <div class="mixer-proposal">
            <ul>
              <For each={proposal()!.changes}>
                {(change) => <li>{change}</li>}
              </For>
            </ul>
            <div class="mixer-actions">
              <button
                disabled={stale()}
                aria-pressed={previewing() === "before"}
                onClick={() => void preview("before")}
              >
                {previewing() === "before" ? "Stop before" : "Hear before"}
              </button>
              <button
                disabled={stale()}
                aria-pressed={previewing() === "after"}
                onClick={() => void preview("after")}
              >
                {previewing() === "after" ? "Stop after" : "Hear after"}
              </button>
              <button
                class="mixer-primary"
                disabled={stale() || proposal()!.document === basis()}
                onClick={apply}
              >
                Apply mix
              </button>
              <button onClick={invalidate}>Discard</button>
            </div>
          </div>
        </Show>
        <Show when={restore()}>
          <button
            onClick={() => {
              stopPreview();
              restoreMix(restore()!);
              setRestore(null);
              invalidate();
              setStatus(
                "Previous mix restored. Your notes and arrangement are unchanged.",
              );
            }}
          >
            Restore before Auto Mix
          </button>
        </Show>
      </section>
      <div class="mixer-strips" aria-label="Channel strips">
        <For each={[...ids(), "master"] as (LaneId | "master")[]}>
          {(id) => {
            const lane = () => doc().lanes.find((l) => l.id === id);
            const level = () => meters()[id];
            const value = () =>
              id === "master"
                ? master().gainDb
                : Math.max(-60, gainToDb(lane()?.volume ?? 1));
            const title = () => (id === "master" ? "Master" : laneName(id));
            const accessibleTitle = () =>
              id === "master"
                ? "Master"
                : `${title()}, track ${ALL_LANE_IDS.indexOf(id) + 1}`;
            return (
              <section
                class="mixer-strip"
                role="group"
                tabIndex={0}
                aria-label={`${accessibleTitle()} channel`}
                onPointerDown={() => {
                  setSelected(id);
                  if (id !== "master") selectLane(id);
                }}
                onKeyDown={(e) => {
                  if (
                    e.target === e.currentTarget &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    setSelected(id);
                    if (id !== "master") selectLane(id);
                  }
                }}
                data-help="mixer.channel"
                data-lane={id}
                classList={{
                  "is-selected": selected() === id,
                  "is-master": id === "master",
                }}
                style={{
                  "--track-color":
                    id === "master" ? "var(--theme-accent)" : trackColor(id),
                }}
              >
                <button
                  class="mixer-channel-name"
                  aria-label={`${accessibleTitle()} processing`}
                  aria-pressed={selected() === id}
                  onClick={() => {
                    setSelected(id);
                    if (id !== "master") selectLane(id);
                  }}
                >
                  <span>
                    {id === "master"
                      ? "OUT"
                      : String(ALL_LANE_IDS.indexOf(id) + 1).padStart(2, "0")}
                  </span>
                  {title()}
                </button>
                <div
                  class="mixer-meter"
                  role="meter"
                  aria-label={`${accessibleTitle()} output level`}
                  aria-valuemin={-60}
                  aria-valuemax={0}
                  aria-valuenow={Math.max(
                    -60,
                    Math.min(0, level()?.rms ?? -60),
                  )}
                  aria-valuetext={`${(level()?.rms ?? -120).toFixed(1)} dBFS RMS`}
                >
                  <i
                    style={{
                      height: `${Math.max(0, Math.min(100, (((level()?.rms ?? -60) + 60) / 60) * 100))}%`,
                    }}
                  />
                  <b
                    style={{
                      bottom: `${Math.max(0, Math.min(100, (((level()?.peak ?? -60) + 60) / 60) * 100))}%`,
                    }}
                  />
                </div>
                <output
                  class="mixer-peak"
                  classList={{ "is-clipping": (level()?.peak ?? -120) >= 0 }}
                >
                  {(level()?.peak ?? -120) <= -60
                    ? "−∞"
                    : level()!.peak.toFixed(1)}{" "}
                  <small>dBFS peak</small>
                </output>
                <Slider
                  label={`${accessibleTitle()} level`}
                  value={value()}
                  min={id === "master" ? -24 : -60}
                  max={id === "master" ? 6 : 0}
                  step={0.1}
                  unit=" dB"
                  set={(v) =>
                    id === "master"
                      ? setMasterProcessing((p) => ({ ...p, gainDb: v }))
                      : setLaneMix(id, { volume: v <= -60 ? 0 : dbToGain(v) })
                  }
                />
                <Show when={id !== "master"}>
                  <div class="mixer-channel-pan">
                    <MixerParam
                      compact
                      label="Pan"
                      min={-100}
                      max={100}
                      value={
                        (doc().mixer?.channels[id as LaneId]?.pan ?? 0) * 100
                      }
                      set={(v) =>
                        setChannelProcessing(id as LaneId, (p) => ({
                          ...p,
                          pan: v / 100,
                        }))
                      }
                    />
                  </div>
                </Show>
                <Show
                  when={id !== "master"}
                  fallback={
                    <p class="mixer-strip-note">
                      Glue {Math.abs(level()?.reduction ?? 0).toFixed(1)} dB
                      <br />
                      Limit {Math.abs(level()?.limiter ?? 0).toFixed(1)} dB
                    </p>
                  }
                >
                  <div class="mixer-channel-buttons">
                    <button
                      aria-label={`Mute ${accessibleTitle()}`}
                      aria-pressed={lane()?.mute === true}
                      onClick={() =>
                        setLaneMix(id as LaneId, { mute: !lane()?.mute })
                      }
                    >
                      M
                    </button>
                    <button
                      aria-label={`Solo ${accessibleTitle()}`}
                      aria-pressed={lane()?.solo === true}
                      onClick={() =>
                        setLaneMix(id as LaneId, { solo: !lane()?.solo })
                      }
                    >
                      S
                    </button>
                    <button
                      aria-label={`Lock ${accessibleTitle()} for Auto Mix`}
                      aria-pressed={
                        doc().mixer?.channels[id as LaneId]?.locked ?? false
                      }
                      onClick={() =>
                        setChannelProcessing(id as LaneId, (p) => ({
                          ...p,
                          locked: !p.locked,
                        }))
                      }
                    >
                      Lock
                    </button>
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
      </div>
      <section class="mixer-inspector" aria-label="Selected channel processing">
        <header class="mixer-inspector-heading">
          <h2>
            {selected() === "master"
              ? "Master output"
              : laneName(selected() as LaneId)}
          </h2>
          <span>
            Compression reducing{" "}
            {Math.abs(meters()[selected()]?.reduction ?? 0).toFixed(1)} dB
          </span>
          <div id="mixer-fx-tools" />
        </header>
        <div
          class="mixer-rack"
          data-help="mixer.rack"
          role="region"
          aria-label="Device rack"
          tabIndex={0}
        >
          <Show when={selected()} keyed>
            {(id) => <FxStrip lane={id} spectrum={spectrum()} />}
          </Show>
          <Show
            when={selected() !== "master"}
            fallback={
              <>
                <CompressorControls
                  title="Glue compressor"
                  value={master().compressor}
                  set={(value) =>
                    setMasterProcessing((p) => ({ ...p, compressor: value }))
                  }
                />
                <section
                  class="mixer-device mixer-limiter"
                  data-help="mixer.limiter"
                >
                  <div class="mixer-device-heading">
                    <h3>Sample-peak limiter</h3>
                    <button
                      aria-label={`${master().limiter.enabled ? "Bypass" : "Enable"} master limiter`}
                      aria-pressed={master().limiter.enabled}
                      onClick={() =>
                        setMasterProcessing((p) => ({
                          ...p,
                          limiter: {
                            ...p.limiter,
                            enabled: !p.limiter.enabled,
                          },
                        }))
                      }
                    >
                      {master().limiter.enabled ? "On" : "Bypassed"}
                    </button>
                  </div>
                  <div class="mixer-control-grid">
                    <MixerParam
                      label="Ceiling"
                      min={-12}
                      max={-0.1}
                      step={0.1}
                      value={master().limiter.ceiling}
                      unit=" dBFS"
                      set={(v) =>
                        setMasterProcessing((p) => ({
                          ...p,
                          limiter: { ...p.limiter, ceiling: v },
                        }))
                      }
                    />
                    <MixerParam
                      label="Limiter release"
                      min={20}
                      max={500}
                      value={master().limiter.release * 1000}
                      unit=" ms"
                      set={(v) =>
                        setMasterProcessing((p) => ({
                          ...p,
                          limiter: { ...p.limiter, release: v / 1000 },
                        }))
                      }
                    />
                  </div>
                </section>
              </>
            }
          >
            <MixerEq
              value={current().eq}
              spectrum={spectrum()}
              set={(eq) => patch((p) => ({ ...p, eq }))}
            />
            <CompressorControls
              title="Channel compressor"
              value={current().compressor}
              set={(value) => patch((p) => ({ ...p, compressor: value }))}
            />
          </Show>
        </div>
      </section>
    </main>
  );
}
