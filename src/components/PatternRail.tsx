/**
 * PatternRail (DES-6): the song arrangement rail under the booth. Per lane,
 * one row of pattern TILES — chain instances in the lane's chain order
 * (repeats allowed; a tile = one chain slot referencing a pattern) — plus the
 * lane's pattern-management controls (ADD 1/2/4 bars, DUP, REN, RM, "+"
 * append slot).
 *
 * Click a tile while playing → quantized switch request (engineBridge.
 * requestPatternSwitch); the tile shows PENDING (from session.
 * getPendingSwitch via subscribeSwitches) until the boundary lands, then
 * ACTIVE. While stopped a click only selects the pattern for editing (the
 * grid follows the selection — collapse/expand never loses your place).
 *
 * Named cue states (the raise): every tile can carry a text label ("VERSE",
 * "DROP") stored in the document's chainCues (positional, per slot — the
 * second A can be the DROP). Sections therefore read as labeled cue states,
 * text-equivalent (label text + aria, never color alone). Edit: double-click
 * the cue line or press L on a focused tile; Enter commits, Esc cancels.
 *
 * Chain STRUCTURE edits (add/remove slot, pattern remove) are quantized at
 * the lane's next iteration boundary by the engine (IM-7); the row shows a
 * "CHAIN EDIT QUEUED" badge from session.hasPendingSchedule until it lands
 * (cheap because the session emits the same switch events on queue + apply).
 *
 * Keyboard (Daredevil): roving tabindex along each row (arrows), Enter/
 * Space triggers the tile, Delete removes the chain slot, F2 renames the
 * pattern, L edits the cue. Pending/active changes announce via aria-live.
 *
 * View toggle (the collapse/expand raise): FOCUS collapses the rail to the
 * active tiles and enlarges the grids; CHAIN shows the full arrangement.
 * Selection is preserved across toggles by construction (selection.ts).
 */

import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { CUE_MAX_CHARS, type LaneId, type PatternBars } from "../document/schema";
import { LANE_NAMES } from "./laneMeta";
import { getSession } from "../engine/session";
import { requestPatternSwitch } from "../state/engineBridge";
import {
  appendChainSlot,
  addPattern,
  docStore,
  duplicatePattern,
  removeChainSlot,
  removePattern,
  renamePattern,
  setChainCue,
} from "../state/store";
import {
  clampCue,
  clampSlot,
  patternPool,
  pendingAnnouncement,
  railTiles,
  structurePendingAnnouncement,
  tileState,
  type RailTile,
} from "../state/patternRail";
import {
  activePatterns,
  selectPattern,
  toggleViewMode,
  viewMode,
} from "../state/selection";

const session = getSession();
const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

/** Editable inline text field (cue label / pattern name). Esc cancels. */
function InlineEdit(props: {
  initial: string;
  maxChars: number;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = createSignal(props.initial);
  return (
    <input
      class="rail-edit"
      type="text"
      value={value()}
      maxLength={props.maxChars}
      aria-label={props.label}
      ref={(el) => {
        el.focus();
        el.select();
      }}
      onInput={(e) => setValue(e.currentTarget.value)}
      onBlur={() => props.onCommit(clampCue(value(), props.maxChars))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          props.onCommit(clampCue(value(), props.maxChars));
        } else if (e.key === "Escape") {
          e.stopPropagation();
          props.onCancel();
        }
      }}
    />
  );
}

function LaneRail(props: { lane: LaneId }): JSX.Element {
  const [tiles, setTiles] = createSignal(railTiles(docStore.getState().doc, props.lane));
  const [pool, setPool] = createSignal(patternPool(docStore.getState().doc, props.lane));
  const [playing, setPlaying] = createSignal(session.transport.snapshot.playing);
  const [switchVersion, setSwitchVersion] = createSignal(0);
  const [structurePending, setStructurePending] = createSignal(false);
  const [focusedSlot, setFocusedSlot] = createSignal(0);
  const [editing, setEditing] = createSignal<
    { kind: "cue"; slot: number } | { kind: "name" } | null
  >(null);
  const [announce, setAnnounce] = createSignal("");

  onMount(() => {
    const unsubDoc = docStore.subscribe((state, prev) => {
      if (
        state.doc.songChain[props.lane] !== prev.doc.songChain[props.lane] ||
        state.doc.patterns[props.lane] !== prev.doc.patterns[props.lane] ||
        state.doc.chainCues !== prev.doc.chainCues
      ) {
        setTiles(railTiles(state.doc, props.lane));
        setPool(patternPool(state.doc, props.lane));
        setFocusedSlot((f) => Math.min(f, Math.max(0, state.doc.songChain[props.lane].length - 1)));
      }
    });
    const unsubTransport = session.subscribe((snap) => setPlaying(snap.playing));
    const unsubSwitch = session.subscribeSwitches(() => {
      setSwitchVersion((v) => v + 1);
      setStructurePending(session.hasPendingSchedule(props.lane));
    });
    setStructurePending(session.hasPendingSchedule(props.lane));
    onCleanup(() => {
      unsubDoc();
      unsubTransport();
      unsubSwitch();
    });
  });

  // Event-driven announcements (Daredevil: pending/active states announced).
  createEffect(() => {
    void switchVersion();
    const pending = session.getPendingSwitch(props.lane);
    if (pending) setAnnounce(pendingAnnouncement(LANE_NAMES[props.lane], pending));
    else if (session.hasPendingSchedule(props.lane)) {
      setAnnounce(structurePendingAnnouncement(LANE_NAMES[props.lane]));
    } else {
      const active = session.getActivePattern(props.lane);
      setAnnounce(active ? `${LANE_NAMES[props.lane]}: now ${active}` : "");
    }
  });

  const selectedId = () => activePatterns()[props.lane];

  const stateFor = (tile: RailTile) => {
    void switchVersion();
    return tileState(tile, {
      activePatternId: session.getActivePattern(props.lane),
      pending: session.getPendingSwitch(props.lane),
      structurePending: structurePending(),
      selectedPatternId: selectedId(),
    });
  };

  const triggerTile = (tile: RailTile) => {
    selectPattern(props.lane, tile.patternId);
    if (playing()) requestPatternSwitch(props.lane, tile.patternId);
  };

  const handleAdd = (bars: PatternBars) => {
    const n = patternPool(docStore.getState().doc, props.lane).length;
    const name = n < 26 ? String.fromCharCode(65 + n) : `P${n + 1}`;
    const id = addPattern(props.lane, bars, name);
    selectPattern(props.lane, id);
  };

  const handleDuplicate = () => {
    const id = duplicatePattern(props.lane, selectedId());
    selectPattern(props.lane, id);
  };

  const handleRemovePattern = () => {
    removePattern(props.lane, selectedId());
  };

  const tileKeyDown = (e: KeyboardEvent, tile: RailTile) => {
    const count = tiles().length;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = clampSlot(count, tile.slot, e.key === "ArrowRight" ? 1 : -1);
      setFocusedSlot(next);
      const row = (e.currentTarget as HTMLElement).parentElement;
      const tileButtons = row ? row.querySelectorAll<HTMLButtonElement>(".rail-tile") : [];
      tileButtons[next]?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (removeChainSlot(props.lane, tile.slot)) {
        setAnnounce(`${LANE_NAMES[props.lane]}: removed chain slot ${tile.slot + 1}`);
      }
    } else if (e.key === "F2") {
      e.preventDefault();
      setEditing({ kind: "name" });
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      setEditing({ kind: "cue", slot: tile.slot });
    }
  };

  const commitCue = (slot: number, value: string) => {
    setEditing(null);
    setChainCue(props.lane, slot, value === "" ? null : value);
  };

  return (
    <div class="rail-row" data-lane={props.lane}>
      <span class="rail-lane-name">{LANE_NAMES[props.lane]}</span>

      <div class="rail-tiles" role="group" aria-label={`${LANE_NAMES[props.lane]} song chain`}>
        <For each={tiles()}>
          {(tile) => (
            <button
              type="button"
              class="rail-tile"
              data-state={stateFor(tile)}
              tabindex={tile.slot === focusedSlot() ? 0 : -1}
              aria-label={`${LANE_NAMES[props.lane]} chain slot ${tile.slot + 1}: pattern ${tile.name}, ${tile.bars} bar${tile.bars === 1 ? "" : "s"}${tile.cue ? `, section ${tile.cue}` : ""}${stateFor(tile) === "pending" ? ", switch pending" : stateFor(tile) === "active" ? ", playing" : ""}`}
              onClick={() => triggerTile(tile)}
              onDblClick={() => setEditing({ kind: "name" })}
              onKeyDown={(e) => tileKeyDown(e, tile)}
            >
              <Show
                when={editing()?.kind === "cue" && (editing() as { slot: number }).slot === tile.slot}
              >
                <InlineEdit
                  initial={tile.cue ?? ""}
                  maxChars={CUE_MAX_CHARS}
                  label={`Section label for ${LANE_NAMES[props.lane]} slot ${tile.slot + 1}`}
                  onCommit={(v) => commitCue(tile.slot, v)}
                  onCancel={() => setEditing(null)}
                />
              </Show>
              <span
                class="rail-tile-cue"
                classList={{ "is-empty": !tile.cue }}
                onDblClick={(e) => {
                  e.stopPropagation();
                  setEditing({ kind: "cue", slot: tile.slot });
                }}
                title="Double-click to label this section"
              >
                {tile.cue ?? "—"}
              </span>
              <span class="rail-tile-name">{tile.name}</span>
              <span class="rail-tile-bars">{tile.bars}B</span>
              <Show when={stateFor(tile) === "pending"}>
                <span class="rail-tile-flag" aria-hidden="true">◆</span>
              </Show>
            </button>
          )}
        </For>
        <button
          type="button"
          class="rail-append"
          aria-label={`Append ${LANE_NAMES[props.lane]} selected pattern to chain`}
          onClick={() => appendChainSlot(props.lane, selectedId())}
        >
          +
        </button>
        <Show when={structurePending()}>
          <span class="rail-struct-flag" role="status">CHAIN EDIT QUEUED</span>
        </Show>
      </div>

      <div class="rail-tools" role="group" aria-label={`${LANE_NAMES[props.lane]} pattern tools`}>
        <Show
          when={editing()?.kind === "name"}
          fallback={
            <button
              type="button"
              class="rail-tool"
              aria-label={`Rename ${LANE_NAMES[props.lane]} selected pattern`}
              onClick={() => setEditing({ kind: "name" })}
            >
              REN
            </button>
          }
        >
          <InlineEdit
            initial={pool().find((p) => p.patternId === selectedId())?.name ?? ""}
            maxChars={8}
            label={`Name for ${LANE_NAMES[props.lane]} selected pattern`}
            onCommit={(v) => {
              setEditing(null);
              if (v !== "") renamePattern(props.lane, selectedId(), v);
            }}
            onCancel={() => setEditing(null)}
          />
        </Show>
        <For each={[1, 2, 4] as const}>
          {(bars) => (
            <button
              type="button"
              class="rail-tool"
              aria-label={`Add ${bars}-bar pattern to ${LANE_NAMES[props.lane]}`}
              onClick={() => handleAdd(bars)}
            >
              +{bars}B
            </button>
          )}
        </For>
        <button
          type="button"
          class="rail-tool"
          aria-label={`Duplicate ${LANE_NAMES[props.lane]} selected pattern`}
          onClick={handleDuplicate}
        >
          DUP
        </button>
        <button
          type="button"
          class="rail-tool"
          aria-label={`Remove ${LANE_NAMES[props.lane]} selected pattern`}
          disabled={pool().length <= 1}
          onClick={handleRemovePattern}
        >
          RM
        </button>
      </div>

      <span class="head-sr" role="status" aria-live="polite">
        {announce()}
      </span>
    </div>
  );
}

export default function PatternRail(): JSX.Element {
  return (
    <section class="rail" data-view={viewMode()} aria-label="Song chain rail">
      <div class="rail-head">
        <span class="rail-title">SONG CHAIN</span>
        <button
          type="button"
          class="rail-view-toggle"
          aria-pressed={viewMode() === "focus"}
          onClick={() => toggleViewMode()}
        >
          {viewMode() === "chain" ? "COLLAPSE TO PATTERN" : "EXPAND TO CHAIN"}
        </button>
      </div>
      <For each={LANES}>
        {(lane) => <LaneRail lane={lane} />}
      </For>
    </section>
  );
}
