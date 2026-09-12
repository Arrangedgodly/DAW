/**
 * BoothScreen — the unit's STATUS DISPLAY (THE FULL UNIT, screen-first
 * pass). A recessed LCD window set into the booth's status module that
 * answers every control you touch with its name and new value ("BASS GATE ·
 * 2ST"), carries the transport annunciators (PLAY / LOOP, lit from the real
 * transport snapshot, ghosted when off — the way an LCD's unlit legends
 * still show) plus the live tempo, and a four-lane meter bank fed by
 * audible note-ons (the meter bus). Everything shown is real state read
 * back from the control after its own handler ran — nothing is invented.
 *
 * Layout law: ZERO layout px. The window contributes no intrinsic width
 * (width 0, flex-basis 0) and only grows into the free space of the booth
 * row it rides — the booth's height and wrapping are byte-identical with or
 * without it at every desktop width; container queries shed its
 * annunciators / meter bank when that leftover is narrow. Desktop stage only
 * (Booth's compact guard + a tablet CSS hide).
 *
 * Laws: aria-hidden (a sighted-only duplicate — every value it echoes is
 * already exposed by its control); text is written as CHARACTER DATA on two
 * long-lived text nodes, and the echo fires on click/input/change — after a
 * gesture's release, never mid-gesture; meters are Web Animations (zero DOM
 * writes).
 */

import { For, createSignal, onCleanup, onMount } from "solid-js";
import { LANE_IDS, type LaneId } from "../document/schema";
import { getSession } from "../engine/session";
import { getHelp } from "../help/registry";
import { registerMeter } from "../state/meterBus";

const MAX_LABEL = 22;
const MAX_VALUE = 18;
const LANE_SHORT: Record<LaneId, string> = {
  drums: "DR",
  bass: "BS",
  chords: "CH",
  lead: "LD",
};

function clampText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim().toUpperCase();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Read the control's value AFTER its handler ran (called on the next frame). */
function readValue(target: Element, host: HTMLElement): string {
  if (target instanceof HTMLInputElement) {
    if (target.type === "range") {
      const vt = target.getAttribute("aria-valuetext");
      return vt ? vt.replace(/\s*percent$/i, "%") : target.value;
    }
    if (target.type === "number") return `${target.value} BPM`;
    return target.value;
  }
  if (target instanceof HTMLSelectElement) {
    return target.selectedOptions[0]?.textContent ?? target.value;
  }
  const pressedHost = target.closest("[aria-pressed]");
  if (pressedHost) {
    return pressedHost.getAttribute("aria-pressed") === "true" ? "ON" : "OFF";
  }
  const readout = host.querySelector(
    ".head-ctl-value, .booth-value, .booth-led-input, .rail-length-value",
  );
  if (readout instanceof HTMLInputElement) return readout.value;
  if (readout?.textContent) return readout.textContent;
  const cell = target.closest(".cell");
  if (cell) return cell.getAttribute("aria-label") ?? "";
  const btn = target.closest("button");
  return btn?.textContent ?? "";
}

export default function BoothScreen() {
  const session = getSession();
  const [playing, setPlaying] = createSignal(session.transport.snapshot.playing);
  const [loop, setLoop] = createSignal(session.transport.snapshot.loop);
  const [bpm, setBpm] = createSignal(session.transport.snapshot.bpm);

  let main: HTMLDivElement | undefined;
  let labelHost: HTMLSpanElement | undefined;
  let valueHost: HTMLSpanElement | undefined;
  const meterEls = new Map<LaneId, HTMLElement>();

  onMount(() => {
    const unsubscribe = session.subscribe((snap) => {
      setPlaying(snap.playing);
      setLoop(snap.loop);
      setBpm(snap.bpm);
    });
    onCleanup(unsubscribe);

    for (const [lane, el] of meterEls) onCleanup(registerMeter(lane, el, "x"));

    // Two long-lived text nodes: every echo is a characterData write.
    const label = document.createTextNode("BITBOUNCE BC-1");
    const value = document.createTextNode("READY");
    labelHost?.append(label);
    valueHost?.append(value);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    const echo = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element) || target.closest(".booth-screen")) return;
      const host = target.closest<HTMLElement>("[data-help]");
      const entry = host?.dataset.help ? getHelp(host.dataset.help) : undefined;
      if (!host || !entry) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nextLabel = clampText(entry.title, MAX_LABEL);
        const nextValue = clampText(readValue(target, host), MAX_VALUE);
        if (label.data !== nextLabel) label.data = nextLabel;
        if (value.data !== nextValue) value.data = nextValue;
        if (!reduce.matches) {
          main?.animate(
            [{ filter: "brightness(1.9)" }, { filter: "brightness(1)" }],
            { duration: 140, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          );
        }
      });
    };
    document.addEventListener("click", echo);
    document.addEventListener("input", echo);
    document.addEventListener("change", echo);
    onCleanup(() => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", echo);
      document.removeEventListener("input", echo);
      document.removeEventListener("change", echo);
    });
  });

  return (
    <div class="booth-screen" aria-hidden="true">
      <div class="screen-body">
        <div class="screen-annun">
          <span class="screen-annun-item" data-on={playing() ? "true" : "false"}>
            ▶ PLAY
          </span>
          <span class="screen-annun-item" data-on={loop() ? "true" : "false"}>
            LOOP
          </span>
          <span class="screen-bpm">
            {bpm()}
            <span class="screen-bpm-unit">BPM</span>
          </span>
        </div>
        <div class="screen-main" ref={(el) => (main = el)}>
          <span class="screen-label" ref={(el) => (labelHost = el)} />
          <span class="screen-value" ref={(el) => (valueHost = el)} />
        </div>
        <div class="screen-meters">
          <For each={LANE_IDS}>
            {(lane) => (
              <span class="screen-meter-row" data-lane={lane}>
                <span class="screen-meter-tag">{LANE_SHORT[lane]}</span>
                <span class="screen-meter">
                  <span
                    class="screen-meter-lit"
                    ref={(el) => meterEls.set(lane, el)}
                  />
                </span>
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
