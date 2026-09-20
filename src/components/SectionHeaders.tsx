import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { getSession } from "../engine/session";
import { docStore, setSongSection } from "../state/store";
import { announceStage } from "../state/selection";
import { soundingSlot } from "../state/soundingFollow";

const [launchTiming, setLaunchTiming] = createSignal<"bar" | "pattern">("bar");

export function SectionControls() {
  const session = getSession();
  const [held, setHeld] = createSignal(session.getFollowHeld());
  return (
    <div class="section-controls" data-help="rail.sections">
      <label>
        Launch sections
        <select
          value={launchTiming()}
          onChange={(e) =>
            setLaunchTiming(e.currentTarget.value as "bar" | "pattern")
          }
        >
          <option value="bar">Next bar</option>
          <option value="pattern">After current patterns</option>
        </select>
      </label>
      <button
        type="button"
        aria-pressed={held()}
        onClick={() => {
          const next = !held();
          setHeld(next);
          session.setFollowHeld(next);
          announceStage(
            next
              ? "Automatic progression held. Manual launches still work."
              : "Automatic progression resumed.",
          );
        }}
      >
        {held() ? "Resume progression" : "Hold progression"}
      </button>
      <span>
        Blocks in the same column launch together. Lanes without a block here
        keep playing.
      </span>
    </div>
  );
}

function SectionEditor(props: { slot: number; onClose: () => void }) {
  const doc = docStore.getState().doc;
  const count = Math.max(
    ...doc.lanes.map(({ id }) => doc.songChain[id]?.length ?? 0),
  );
  const initial = doc.sections?.[props.slot];
  const [name, setName] = createSignal(
    initial?.name ?? `Section ${props.slot + 1}`,
  );
  const [bars, setBars] = createSignal(String(initial?.bars ?? 8));
  const [mode, setMode] = createSignal(
    initial?.bars ? (initial.stop ? "stop" : "next") : "manual",
  );
  const [next, setNext] = createSignal(
    initial?.next ?? (props.slot + 1) % count,
  );
  let panel!: HTMLDivElement;
  onMount(() => panel.querySelector<HTMLInputElement>("input")?.focus());
  return (
    <Portal mount={document.querySelector(".app") ?? document.body}>
      <div
        ref={(element) => {
          panel = element;
        }}
        class="block-playback-panel"
        role="dialog"
        aria-modal="false"
        aria-label={`Section ${props.slot + 1} settings`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") props.onClose();
        }}
      >
        <div class="block-panel-heading">
          <h2>Section {props.slot + 1}</h2>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
        <p>
          Every block in this column launches on the same boundary. Block
          playback rules still run within the section.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSongSection(props.slot, {
              name: name(),
              ...(mode() !== "manual"
                ? {
                    bars: Number(bars()),
                    ...(mode() === "stop" ? { stop: true } : { next: next() }),
                  }
                : {}),
            });
            props.onClose();
          }}
        >
          <label>
            Section name
            <input
              value={name()}
              maxLength="24"
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <label>
            Progression
            <select
              value={mode()}
              onChange={(e) => setMode(e.currentTarget.value)}
            >
              <option value="manual">Launch manually</option>
              <option value="next">
                Launch another section after a duration
              </option>
              <option value="stop">Stop all lanes after a duration</option>
            </select>
          </label>
          <Show when={mode() !== "manual"}>
            <label>
              Play for bars
              <input
                type="number"
                min="1"
                max="128"
                step="1"
                required
                value={bars()}
                onInput={(e) => setBars(e.currentTarget.value)}
              />
            </label>
          </Show>
          <Show when={mode() === "next"}>
            <label>
              Then launch
              <select
                value={next()}
                onChange={(e) => setNext(Number(e.currentTarget.value))}
              >
                <For each={Array.from({ length: count }, (_, i) => i)}>
                  {(i) => (
                    <option value={i}>
                      {doc.sections?.[i]?.name || `Section ${i + 1}`}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <button type="submit">Save section</button>
        </form>
      </div>
    </Portal>
  );
}

export default function SectionHeaders() {
  const session = getSession();
  const [switchVersion, setSwitchVersion] = createSignal(0);
  const [playing, setPlaying] = createSignal(
    session.transport.snapshot.playing,
  );
  onCleanup(session.subscribeSwitches(() => setSwitchVersion((v) => v + 1)));
  onCleanup(session.subscribe((s) => setPlaying(s.playing)));
  const [doc, setDoc] = createSignal(docStore.getState().doc);
  onCleanup(docStore.subscribe((s) => setDoc(s.doc)));
  const count = () =>
    Math.max(...doc().lanes.map(({ id }) => doc().songChain[id]?.length ?? 0));
  const [editing, setEditing] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal("");
  const sectionState = (slot: number): "queued" | "playing" | undefined => {
    switchVersion();
    const lanes = doc().lanes.filter(({ id }) => doc().songChain[id]?.[slot]);
    if (lanes.some(({ id }) => session.getPendingSwitch(id)?.toSlot === slot))
      return "queued";
    if (
      playing() &&
      lanes.length &&
      lanes.every(({ id }) => soundingSlot()[id] === slot)
    )
      return "playing";
    return undefined;
  };
  let trigger: HTMLButtonElement | undefined;
  return (
    <>
      <div class="section-header-row" data-help="rail.sections">
        <span class="section-gutter">Sections</span>
        <div class="section-columns">
          <For each={Array.from({ length: count() }, (_, i) => i)}>
            {(slot) => (
              <div class="section-header">
                <button
                  type="button"
                  class="section-launch"
                  data-state={sectionState(slot)}
                  aria-label={`Launch ${doc().sections?.[slot]?.name || `Section ${slot + 1}`}`}
                  onClick={() => {
                    getSession().cueSection(slot, launchTiming());
                    const message = `${doc().sections?.[slot]?.name || `Section ${slot + 1}`} queued ${getSession().transport.snapshot.playing ? (launchTiming() === "bar" ? "for the next bar" : "after the current patterns") : "for playback"}.`;
                    setStatus(message);
                    announceStage(message);
                  }}
                >
                  {doc().sections?.[slot]?.name || `Section ${slot + 1}`}
                  <Show when={sectionState(slot)}>
                    <span class="section-launch-state">
                      {sectionState(slot)}
                    </span>
                  </Show>
                </button>
                <button
                  type="button"
                  class="section-settings"
                  aria-label={`Edit Section ${slot + 1}`}
                  onClick={(e) => {
                    trigger = e.currentTarget;
                    setEditing(slot);
                  }}
                >
                  {doc().sections?.[slot]?.bars
                    ? `${doc().sections![slot]!.bars} bars · ${doc().sections![slot]!.stop ? "Stop" : `Section ${(doc().sections![slot]!.next ?? 0) + 1}`}`
                    : "Set progression"}
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
      <span class="head-sr" role="status">
        {status()}
      </span>
      <Show when={editing() !== null}>
        <SectionEditor
          slot={editing()!}
          onClose={() => {
            setEditing(null);
            if (trigger?.isConnected) trigger.focus();
          }}
        />
      </Show>
    </>
  );
}
