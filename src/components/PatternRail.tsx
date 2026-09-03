/**
 * PatternRail (DES-6 + IN-3): the song arrangement rail under the booth. Per
 * lane, one row of pattern TILES — chain instances in the lane's chain order
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
 * IN-3 multi-clip cueing: ONE pointer gesture sweeping across N tiles cues
 * every touched lane — each lane at its LAST-touched tile, through the exact
 * individual-click funnel (selectPattern + requestPatternSwitch per lane,
 * IM-7 same-lane supersede), committed once on release. Previews during the
 * gesture are pure signals (zero store/engine writes). The keyboard twin is
 * the Shift+arrow range + Enter CUE ALL path (keyboard.md v2) through the
 * same commit; both announce `QUEUED <n> LANES` in the rail status region
 * (E5 — no announcement depends on pointer-only events).
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
 * IN-3: Shift+arrows extend a multi-clip range (carried + clamped across
 * rows), plain arrows rove + collapse it, Escape collapses it first, Enter/
 * Space on an active range = CUE ALL.
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
import {
  CUE_MAX_CHARS,
  type LaneId,
  type PatternBars,
} from "../document/schema";
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
  clampSlotTo,
  patternPool,
  pendingAnnouncement,
  queuedLanesAnnouncement,
  RAIL_ROWS,
  railTiles,
  rangeCommitSlot,
  rangeExtend,
  rangeIncludes,
  rangeRows,
  structurePendingAnnouncement,
  tileState,
  type RailCell,
  type RailRange,
  type RailRangeKey,
  type RailTile,
} from "../state/patternRail";
import {
  cueSweepBegin,
  cueSweepCommit,
  cueSweepMove,
  cueSweepMoved,
  type CueSweep,
} from "../interaction/drag";
import {
  activePatterns,
  selectPattern,
  toggleViewMode,
  viewMode,
} from "../state/selection";
import { registerHelp } from "../help/registry";

const session = getSession();

/**
 * HP-1 help entries for the rail (I2-6: colocated here, next to the tiles and
 * tools they describe; structural placeholder copy — HP-2 rewrites it
 * text-only). One shared tile entry: every tile in every lane carries the
 * same id — the tile's own aria-label names the lane/pattern.
 */
registerHelp([
  {
    id: "rail.tile",
    title: "CHAIN TILE",
    text: "One slot in this lane's song chain. Click to switch the lane to this pattern — it lands on the next bar line (pending until then). Double-click the name to rename, the top line to label the section.",
  },
  {
    id: "rail.append",
    title: "APPEND SLOT",
    text: "Appends the lane's selected pattern to the chain as a new slot.",
  },
  {
    id: "rail.add",
    title: "ADD PATTERN",
    text: "Adds a new pattern of this length (1, 2 or 4 bars) to the lane and selects it for editing.",
  },
  {
    id: "rail.duplicate",
    title: "DUPLICATE",
    text: "Copies the lane's selected pattern and selects the copy.",
  },
  {
    id: "rail.rename",
    title: "RENAME",
    text: "Renames the lane's selected pattern.",
  },
  {
    id: "rail.remove",
    title: "REMOVE",
    text: "Removes the lane's selected pattern from the pool (a lane always keeps at least one).",
  },
  {
    id: "rail.view",
    title: "RAIL VIEW",
    text: "COLLAPSE focuses the view on the selected pattern's grid; EXPAND shows the whole song chain.",
  },
]);

// ---------------------------------------------------------------------------
// IN-3 multi-clip cueing — shared gesture/range state (rail-level, ephemeral:
// pure signals like selection.ts, NEVER document state; cueing writes no doc)
// ---------------------------------------------------------------------------

/** The active pointer sweep (null = no gesture). */
const [cueSweep, setCueSweep] = createSignal<CueSweep | null>(null);
/** The active keyboard range selection (null = collapsed). */
const [railRange, setRailRange] = createSignal<RailRange | null>(null);
/** The rail summary line both paths announce identically (E5). */
const [cueSummary, setCueSummary] = createSignal("");

let railEl: HTMLElement | undefined;
let sweepPointerId = -1;
let sweepCaptured = false;
/** IN-2 pattern: suppress the trailing click after a pointer-driven commit. */
let suppressTileClick = false;
let suppressClearTimer: number | undefined;

function armClickSuppression(): void {
  suppressTileClick = true;
  if (suppressClearTimer !== undefined) window.clearTimeout(suppressClearTimer);
  // Expires on the next macrotask — the trailing click (if any) arrives in
  // the same task as pointerup; a later, genuine click must never be eaten.
  suppressClearTimer = window.setTimeout(() => {
    suppressTileClick = false;
  }, 0);
}

/** Chain row lengths at interaction time (the range math's bounds input). */
function rowLengths(): Record<LaneId, number> {
  const chain = docStore.getState().doc.songChain;
  return {
    drums: chain.drums.length,
    bass: chain.bass.length,
    chords: chain.chords.length,
    lead: chain.lead.length,
  };
}

/**
 * THE multi-clip commit funnel (pointer sweep + keyboard CUE ALL share it —
 * E5 parity by construction): per target lane, top→bottom, the exact
 * individual-click law — selectPattern always, requestPatternSwitch while
 * playing. One queued switch per touched lane; the summary counts the lanes
 * whose switch was requested.
 */
function cueTiles(
  targets: readonly RailCell[],
  announceSummary: boolean,
): void {
  const chain = docStore.getState().doc.songChain;
  const playing = session.transport.snapshot.playing;
  let queued = 0;
  for (const target of targets) {
    const patternId = chain[target.lane][target.slot];
    if (!patternId) continue;
    selectPattern(target.lane, patternId);
    if (playing) {
      requestPatternSwitch(target.lane, patternId);
      queued++;
    }
  }
  if (announceSummary && queued > 0)
    setCueSummary(queuedLanesAnnouncement(queued));
}

/** Keyboard CUE ALL: commit the active range, top→bottom (spec v2). */
function commitRangeCue(): void {
  const range = railRange();
  if (!range) return;
  setRailRange(null);
  const lengths = rowLengths();
  cueTiles(
    rangeRows(range).map((lane) => ({
      lane,
      slot: rangeCommitSlot(range, lengths[lane]),
    })),
    true,
  );
}

/** Move DOM focus to a rail tile (cross-row roving; onFocus syncs the row). */
function focusRailCell(cell: RailCell): void {
  const row = railEl?.querySelector(`.rail-row[data-lane="${cell.lane}"]`);
  const tile =
    row?.querySelectorAll<HTMLButtonElement>(".rail-tile")[cell.slot];
  tile?.focus();
}

/** The rail tile under viewport coordinates (null off-tile). */
function railCellAtPoint(x: number, y: number): RailCell | null {
  const hit = document.elementFromPoint(x, y);
  const tile = hit?.closest(".rail-tile") ?? null;
  const row = tile?.closest(".rail-row") ?? null;
  const lane = row?.getAttribute("data-lane") as LaneId | null;
  if (!tile || !row || !lane) return null;
  const slot = Array.prototype.indexOf.call(
    row.querySelectorAll(".rail-tile"),
    tile,
  );
  return slot < 0 ? null : { lane, slot };
}

// The pointer sweep (IN-2 gesture framework laws: preview = zero writes,
// commit on release, pointercancel cancels cleanly, capture only once the
// gesture actually extends so unmoved presses keep native click/dblclick).
const onRailPointerDown = (e: PointerEvent): void => {
  if (cueSweep() || !e.isPrimary || e.button !== 0) return;
  const tile = (e.target as Element).closest(".rail-tile");
  if (!tile) return; // tools / append / labels keep their native behavior
  const cell = railCellAtPoint(e.clientX, e.clientY);
  if (!cell || cell.slot < 0) return;
  sweepPointerId = e.pointerId;
  sweepCaptured = false;
  setCueSweep(cueSweepBegin(cell.lane, cell.slot));
};

const onRailPointerMove = (e: PointerEvent): void => {
  const sweep = cueSweep();
  if (!sweep || e.pointerId !== sweepPointerId) return;
  const hit = railCellAtPoint(e.clientX, e.clientY);
  const next = cueSweepMove(sweep, hit?.lane ?? null, hit?.slot ?? -1);
  if (next === sweep) return;
  // The sweep extended: capture NOW (never on press) so up-outside commits
  // and pointercancel stays deliverable — the IN-2 capture law.
  if (!sweepCaptured && railEl) {
    try {
      railEl.setPointerCapture(e.pointerId);
      sweepCaptured = true;
    } catch {
      /* synthetic test pointers carry no active pointer — proceed uncaptured */
    }
  }
  setCueSweep(next);
};

const endSweepCapture = (e: PointerEvent): void => {
  if (sweepCaptured && railEl) {
    try {
      railEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  sweepPointerId = -1;
  sweepCaptured = false;
};

const onRailPointerUp = (e: PointerEvent): void => {
  const sweep = cueSweep();
  if (!sweep || e.pointerId !== sweepPointerId) return;
  endSweepCapture(e);
  setCueSweep(null); // preview off first; the commit drives engine state
  if (!cueSweepMoved(sweep)) return; // unmoved press = the native click law
  armClickSuppression();
  cueTiles(cueSweepCommit(sweep, RAIL_ROWS), true);
};

const onRailPointerCancel = (e: PointerEvent): void => {
  if (!cueSweep() || e.pointerId !== sweepPointerId) return;
  endSweepCapture(e);
  setCueSweep(null); // cancel cleanly: no commits, no announcements (IN-4 law)
};

/** IN-4: an active sweep owns the pointer — no context menu mid-gesture. */
const onRailContextMenu = (e: MouseEvent): void => {
  if (cueSweep()) e.preventDefault();
};

/** Focus left the tiles → collapse the keyboard range (stale ranges surprise). */
const onRailFocusOut = (e: FocusEvent): void => {
  const next = e.relatedTarget as Element | null;
  if (next?.closest?.(".rail-tile")) return;
  setRailRange(null);
};

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
        // IN-4 (verifier finding): a dblclick-opened editor loses the focus
        // race — the second press's default focus finalization lands on the
        // TILE after this ref already focused the input, so the first typed
        // character went to the tile. Re-assert past the finalization.
        window.setTimeout(() => {
          if (el.isConnected) {
            el.focus();
            el.select();
          }
        }, 0);
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
  const [tiles, setTiles] = createSignal(
    railTiles(docStore.getState().doc, props.lane),
  );
  const [pool, setPool] = createSignal(
    patternPool(docStore.getState().doc, props.lane),
  );
  const [playing, setPlaying] = createSignal(
    session.transport.snapshot.playing,
  );
  const [switchVersion, setSwitchVersion] = createSignal(0);
  const [structurePending, setStructurePending] = createSignal(false);
  const [focusedSlot, setFocusedSlot] = createSignal(0);
  const [editing, setEditing] = createSignal<
    { kind: "cue"; slot: number } | { kind: "name" } | null
  >(null);
  const [announce, setAnnounce] = createSignal("");
  let railRowEl: HTMLDivElement | undefined;

  onMount(() => {
    const unsubDoc = docStore.subscribe((state, prev) => {
      if (
        state.doc.songChain[props.lane] !== prev.doc.songChain[props.lane] ||
        state.doc.patterns[props.lane] !== prev.doc.patterns[props.lane] ||
        state.doc.chainCues !== prev.doc.chainCues
      ) {
        setTiles(railTiles(state.doc, props.lane));
        setPool(patternPool(state.doc, props.lane));
        setFocusedSlot((f) =>
          Math.min(f, Math.max(0, state.doc.songChain[props.lane].length - 1)),
        );
      }
    });
    const unsubTransport = session.subscribe((snap) =>
      setPlaying(snap.playing),
    );
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
    if (pending)
      setAnnounce(pendingAnnouncement(LANE_NAMES[props.lane], pending));
    else if (session.hasPendingSchedule(props.lane)) {
      setAnnounce(structurePendingAnnouncement(LANE_NAMES[props.lane]));
    } else {
      const active = session.getActivePattern(props.lane);
      setAnnounce(active ? `${LANE_NAMES[props.lane]}: now ${active}` : "");
    }
  });

  const selectedId = () => activePatterns()[props.lane];

  /** IN-3: the pointer-sweep preview for one tile ("target" = will cue). */
  const sweepPreview = (tile: RailTile): string | undefined => {
    const sweep = cueSweep();
    if (!sweep || !sweep.touched.has(`${props.lane}:${tile.slot}`))
      return undefined;
    return sweep.lastByLane.get(props.lane) === tile.slot
      ? "target"
      : "swept";
  };

  /** IN-3: the keyboard range marks its tiles (text-equivalent, D9). */
  const inRange = (tile: RailTile): boolean => {
    const range = railRange();
    return range ? rangeIncludes(range, props.lane, tile.slot) : false;
  };

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

  /**
   * DA-3: chain edits rebuild the tile row (For reference diff), which drops
   * focus to <body>. After an edit, land focus on the tile now occupying
   * `slot` — or the new last tile when the edit appended one.
   */
  const focusSlotAfterEdit = (slot: number): void => {
    queueMicrotask(() => {
      const row = railRowEl?.querySelectorAll<HTMLButtonElement>(".rail-tile");
      if (!row || row.length === 0) return;
      const target = Math.min(slot, row.length - 1);
      setFocusedSlot(target);
      row[target]?.focus();
    });
  };

  const tileKeyDown = (e: KeyboardEvent, tile: RailTile) => {
    const count = tiles().length;
    // Text-entry guard (spec law): no rail keys fire from the inline edits.
    const inTextEntry = (e.target as HTMLElement).tagName === "INPUT";
    // IN-3: Shift+arrows extend the multi-clip range (anchor = where the
    // shift began; focus edge moves, carried + clamped across rows).
    if (
      !inTextEntry &&
      e.shiftKey &&
      (e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown")
    ) {
      e.preventDefault();
      const next = rangeExtend(
        railRange(),
        { lane: props.lane, slot: tile.slot },
        e.key as RailRangeKey,
        rowLengths(),
      );
      setRailRange(next);
      focusRailCell(next.focus);
      return;
    }
    // IN-3: plain ↑/↓ rove focus to the adjacent row's tile (slot carried,
    // clamped) and collapse any range — plain arrows never extend.
    if (
      !inTextEntry &&
      !e.shiftKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
      setRailRange(null);
      const index = RAIL_ROWS.indexOf(props.lane);
      const next = e.key === "ArrowUp" ? index - 1 : index + 1;
      if (next >= 0 && next < RAIL_ROWS.length) {
        const lane = RAIL_ROWS[next];
        focusRailCell({
          lane,
          slot: clampSlotTo(rowLengths()[lane], tile.slot),
        });
      }
      return;
    }
    // IN-3: Enter/Space on an ACTIVE range = CUE ALL (the multi-clip commit;
    // without a range Enter/Space keep their native single-tile activation).
    if (!inTextEntry && railRange() && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      commitRangeCue();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setRailRange(null); // plain roving collapses the range (cancel-extend)
      const next = clampSlot(count, tile.slot, e.key === "ArrowRight" ? 1 : -1);
      setFocusedSlot(next);
      const row = (e.currentTarget as HTMLElement).parentElement;
      const tileButtons = row
        ? row.querySelectorAll<HTMLButtonElement>(".rail-tile")
        : [];
      tileButtons[next]?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (removeChainSlot(props.lane, tile.slot)) {
        setAnnounce(
          `${LANE_NAMES[props.lane]}: removed chain slot ${tile.slot + 1}`,
        );
        // DA-3: the tile row rebuilds on chain edits — move focus to the tile
        // now occupying this slot (or the new last tile) instead of stranding
        // it on <body>.
        focusSlotAfterEdit(tile.slot);
      }
    } else if (e.key === "F2") {
      e.preventDefault();
      setEditing({ kind: "name" });
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      setEditing({ kind: "cue", slot: tile.slot });
    } else if (e.key === "+" || e.key === "=") {
      // DA-3 (spec gap fix): "+" appends the selected pattern to the chain —
      // the keyboard twin of the rail's + button.
      e.preventDefault();
      const wasLast = tile.slot === tiles().length - 1;
      appendChainSlot(props.lane, selectedId());
      setAnnounce(
        `${LANE_NAMES[props.lane]}: appended chain slot ${tiles().length + 1}`,
      );
      // The row rebuilds on chain edits — hand focus to the appended tile
      // (or stay on this slot) so focus is never stranded on <body>.
      focusSlotAfterEdit(
        wasLast
          ? docStore.getState().doc.songChain[props.lane].length - 1
          : tile.slot,
      );
    } else if (e.key === "Escape") {
      // IN-3 (cancel-first): an active range collapses BEFORE the region-head
      // pop applies (spec v2: "no chain edit happened").
      if (railRange()) {
        e.preventDefault();
        setRailRange(null);
        return;
      }
      // DA-3 (spec gap fix): Escape pops to the rail head (the view toggle),
      // matching the region-head law in docs/dev/keyboard.md.
      e.preventDefault();
      (e.currentTarget as HTMLElement)
        .closest(".rail")
        ?.querySelector<HTMLElement>(".rail-view-toggle")
        ?.focus();
    }
  };

  const commitCue = (slot: number, value: string) => {
    setEditing(null);
    setChainCue(props.lane, slot, value === "" ? null : value);
  };

  return (
    <div
      class="rail-row"
      data-lane={props.lane}
      ref={(el) => {
        railRowEl = el;
      }}
    >
      <span class="rail-lane-name">{LANE_NAMES[props.lane]}</span>

      <div
        class="rail-tiles"
        role="group"
        aria-label={`${LANE_NAMES[props.lane]} song chain`}
      >
        <For each={tiles()}>
          {(tile) => (
            <button
              type="button"
              class="rail-tile"
              data-state={stateFor(tile)}
              data-cue-preview={sweepPreview(tile)}
              data-in-range={inRange(tile) ? "true" : undefined}
              data-help="rail.tile"
              tabindex={tile.slot === focusedSlot() ? 0 : -1}
              aria-label={`${LANE_NAMES[props.lane]} chain slot ${tile.slot + 1}: pattern ${tile.name}, ${tile.bars} bar${tile.bars === 1 ? "" : "s"}${tile.cue ? `, section ${tile.cue}` : ""}${stateFor(tile) === "pending" ? ", switch pending" : stateFor(tile) === "active" ? ", playing" : ""}${inRange(tile) ? ", in cue range" : ""}`}
              onFocus={() => setFocusedSlot(tile.slot)}
              onClick={() => {
                // IN-3: pointer-driven commits swallow their trailing click.
                if (suppressTileClick) return;
                triggerTile(tile);
              }}
              onDblClick={() => setEditing({ kind: "name" })}
              onKeyDown={(e) => tileKeyDown(e, tile)}
            >
              <Show
                when={
                  editing()?.kind === "cue" &&
                  (editing() as { slot: number }).slot === tile.slot
                }
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
                <span class="rail-tile-flag" aria-hidden="true">
                  ◆
                </span>
              </Show>
            </button>
          )}
        </For>
        <button
          type="button"
          class="rail-append"
          data-help="rail.append"
          aria-label={`Append ${LANE_NAMES[props.lane]} selected pattern to chain`}
          onClick={() => appendChainSlot(props.lane, selectedId())}
        >
          +
        </button>
        <Show when={structurePending()}>
          <span class="rail-struct-flag" role="status">
            CHAIN EDIT QUEUED
          </span>
        </Show>
      </div>

      <div
        class="rail-tools"
        role="group"
        aria-label={`${LANE_NAMES[props.lane]} pattern tools`}
      >
        <Show
          when={editing()?.kind === "name"}
          fallback={
            <button
              type="button"
              class="rail-tool"
              data-help="rail.rename"
              aria-label={`Rename ${LANE_NAMES[props.lane]} selected pattern`}
              onClick={() => setEditing({ kind: "name" })}
            >
              REN
            </button>
          }
        >
          <InlineEdit
            initial={
              pool().find((p) => p.patternId === selectedId())?.name ?? ""
            }
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
              data-help="rail.add"
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
          data-help="rail.duplicate"
          aria-label={`Duplicate ${LANE_NAMES[props.lane]} selected pattern`}
          onClick={handleDuplicate}
        >
          DUP
        </button>
        <button
          type="button"
          class="rail-tool"
          data-help="rail.remove"
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
  onMount(() => {
    // Ephemeral gesture state must never leak across mounts (test hygiene).
    onCleanup(() => {
      setCueSweep(null);
      setRailRange(null);
      sweepPointerId = -1;
      sweepCaptured = false;
    });
  });
  return (
    <section
      class="rail"
      data-view={viewMode()}
      aria-label="Song chain rail"
      ref={(el) => {
        railEl = el;
      }}
      onPointerDown={onRailPointerDown}
      onPointerMove={onRailPointerMove}
      onPointerUp={onRailPointerUp}
      onPointerCancel={onRailPointerCancel}
      onContextMenu={onRailContextMenu}
      onFocusOut={onRailFocusOut}
    >
      <div class="rail-head">
        <span class="rail-title">SONG CHAIN</span>
        {/* IN-3 E5: the rail summary region — the pointer sweep and the
            Shift+arrow range + Enter path announce the SAME text through it. */}
        <span
          class="head-sr rail-cue-summary"
          role="status"
          aria-live="polite"
          aria-label="Cue queue summary"
        >
          {cueSummary()}
        </span>
        <button
          type="button"
          class="rail-view-toggle"
          data-help="rail.view"
          aria-pressed={viewMode() === "focus"}
          onClick={() => toggleViewMode()}
        >
          {viewMode() === "chain" ? "COLLAPSE TO PATTERN" : "EXPAND TO CHAIN"}
        </button>
      </div>
      <For each={RAIL_ROWS}>{(lane) => <LaneRail lane={lane} />}</For>
    </section>
  );
}
