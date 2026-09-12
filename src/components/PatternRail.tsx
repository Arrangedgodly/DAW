/**
 * PatternRail (DES-6 + IN-3): the song arrangement rail under the booth. Per
 * lane, one row of pattern TILES — chain instances in the lane's chain order
 * (repeats allowed; a tile = one chain slot referencing a pattern) — plus the
 * lane's pattern-management controls (LENGTH resize, DUP, REN, RM) behind
 * one PAT trigger per row (refinement-6: the six-tool row ×4 lanes competed
 * with the tiles for scan space — the tools are pool management, so they
 * distill into the popover vocabulary; every control keeps its function,
 * help entry, and keyboard twin) and the "+" new-clip slot with the tiles
 * (chain structure lives next to the chain it extends).
 *
 * BC-1 (I3-a, keyboard.md v3): the rail `+` — button AND rail-local key —
 * creates a NEW blank next-letter pattern (1 bar), appends it to the lane's
 * chain and selects it (immediately editable), announcing
 * `PATTERN B CREATED · 1 BAR · APPENDED` through the lane's rail status
 * region. DUP (PAT menu + global `d`) is unchanged and is the ONLY
 * duplication path.
 *
 * LL-1 (i3-4, keyboard.md v3 §"Pattern resize"): pattern LENGTH is the only
 * length control — the PAT menu's LENGTH stepper and the global `b`/
 * Shift+`b` ladder resize the SELECTED pattern across
 * 1·2·4·8·16·32·64·128 bars (grow always proceeds; shrink refuses by
 * default when any note would be lost — the E10 refusal names the blocking
 * note). The v2 +1B/+2B/+4B create buttons retired with it (creation is
 * `+`/`n` at 1 bar; LENGTH grows it).
 *
 * Click a tile while playing → quantized switch request (engineBridge.
 * requestPatternSwitch); the tile shows PENDING (from session.
 * getPendingSwitch via subscribeSwitches) until the boundary lands, then
 * follows the sounding state. Refinement-7 (critique P2-3 / deferred #14,
 * the HW-5 observation): the ACTIVE tile is the slot SOUNDING now — the
 * follow advances naturally with each lane's chain position during playback
 * (session.getSoundingPattern, audible-time accurate) and parks on the last
 * slot that sounded while stopped; before anything has sounded it falls
 * back to the switch-target state (getActivePattern, IM-7 semantics
 * untouched). While stopped a click only selects the pattern for editing (the
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
  untrack,
  type JSX,
} from "solid-js";
import { CUE_MAX_CHARS, type LaneId } from "../document/schema";
import { LANE_NAMES } from "./laneMeta";
import { getSession } from "../engine/session";
import { requestSlotCue } from "../state/engineBridge";
import { mountSoundingFollow, sounding } from "../state/soundingFollow";
import ModeIcon from "./ModeIcon";
import {
  appendBlankPattern,
  docStore,
  toggleChainSlotMode,
  duplicatePattern,
  removeChainSlot,
  removePattern,
  renamePattern,
  resizePattern,
  setChainCue,
} from "../state/store";
import {
  barOfStep,
  clampCue,
  clampSlot,
  clampSlotTo,
  nextPatternLength,
  nextPatternLabel,
  patternCreatedAnnouncement,
  patternPool,
  pendingAnnouncement,
  queuedLanesAnnouncement,
  RAIL_ROWS,
  railTiles,
  rangeCommitSlot,
  rangeExtend,
  rangeIncludes,
  rangeRows,
  resizeLimitAnnouncement,
  resizeRefusalAnnouncement,
  resizeRowLabel,
  resizeSuccessAnnouncement,
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
  isDoubleTap,
  type TapRecord,
} from "../interaction/drag";
import {
  activePatterns,
  currentPatternFor,
  selectPattern,
  toggleViewMode,
  viewMode,
} from "../state/selection";
import { registerHelp } from "../help/registry";

const session = getSession();

/**
 * HP-2 help content for the rail (Professor X voice on HP-1's registry;
 * I2-6 colocated law). One shared tile entry: every tile in every lane
 * carries the same id — the tile's own aria-label names the lane/pattern.
 */
registerHelp([
  {
    id: "rail.tile",
    title: "CHAIN TILE",
    text: "One slot in this lane's song chain. The lit tile is the slot sounding right now — it walks the chain as the song plays. The tile's number is its pattern's BARS; the tiles added together are the lane's CYCLE — how long it plays before coming round again, and lanes with different cycles weave against each other. Click — or Enter — while playing to jump the lane to this tile; the jump waits (PENDING) and lands when the pattern playing now ends. The arrow in the corner says what the tile does when it ends: ⟲ loops it until you pick another tile, → plays it once and moves to the next (click the arrow, or press M, to flip it). Drag across several tiles, or Shift+arrows then Enter, to cue a whole section; double-click the name to rename, the top line to label the section.",
  },
  {
    id: "rail.append",
    title: "NEW BLANK CLIP",
    text: "Creates a NEW blank pattern — next letter, one bar — appends it to the end of this lane's chain and selects it for editing. The + key on a focused tile does the same. To copy the selected pattern instead, use DUP: it is the only duplicator.",
  },
  {
    id: "rail.length",
    title: "LENGTH",
    text: "Resizes the lane's SELECTED pattern one step along the length ladder, counted in BARS — 1, 2, 4, 8, 16, 32, 64 or 128 (shortcut B grows, Shift+B shrinks). A pattern's bars set how long the lane's CYCLE runs, so lanes of different lengths loop against each other instead of in lockstep. Growing always works; shrinking refuses while any note would be lost past the new end — move or shorten the note first. New patterns start at 1 bar and grow from here.",
  },
  {
    id: "rail.duplicate",
    title: "DUPLICATE",
    text: "Copies the lane's selected pattern and switches editing to the copy — the safe way to vary a section. Shortcut: D.",
  },
  {
    id: "rail.rename",
    title: "RENAME",
    text: "Renames the lane's selected pattern. In the field: Enter saves, Escape cancels (shortcut R, or F2 on a tile).",
  },
  {
    id: "rail.remove",
    title: "REMOVE",
    text: "Deletes the lane's selected pattern from the pool — a lane always keeps at least one. To cut a slot from the chain instead, focus a tile and press Delete.",
  },
  {
    id: "rail.view",
    title: "RAIL VIEW",
    text: "COLLAPSE zooms the grids in on the selected pattern; EXPAND shows every lane's full chain.",
  },
  {
    id: "rail.tools",
    title: "PATTERN TOOLS",
    text: "Opens this lane's pattern toolbox: rename, LENGTH resize (1 to 128 BARS — the field stays open while you step it), duplicate, remove. The keys reach them without opening it — N new, B longer, Shift+B shorter, D duplicate, R rename — and it closes itself after an action or on Escape.",
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
/**
 * Refinement-6 (critique P3, heuristic 8): which lane's pattern-tools menu
 * is open (null = all closed). Rail-level ephemeral signal (the cueSweep
 * pattern — never document state); one lane at a time, so opening another
 * row's toolbox closes the first.
 */
const [toolsLane, setToolsLane] = createSignal<LaneId | null>(null);

/* ---------------------------------------------------------------------------
 * LL-1 (iteration 3, i3-4 — keyboard.md v3 §"Pattern resize"): the LENGTH
 * funnel. ONE path every input takes (PAT menu LENGTH −/+ buttons, global
 * `b`/Shift+`b`; the E5 pointer/keyboard parity law): one vocabulary step
 * along 1·2·4·8·16·32·64·128 on the lane's SELECTED pattern, through the
 * store's `resizePattern` (grow always proceeds; shrink refuses by default
 * when any note would be lost — never a silent truncation). Every outcome
 * speaks through the lane's rail status region (E10): success/limit/
 * refusal — the limit no-op still announces, the refusal names the blocking
 * note deterministically.
 *
 * `lengthLine` renders over the region's pending/follow line; a SUCCESS
 * additionally arms `pendingLengthFlush` — the resize commit is a chain
 * STRUCTURE edit, which synchronously emits a lane switch event that bumps
 * `switchVersion` and queues the announce effect: that exact run consumes
 * the flush (the BC-1 creation-override law). Refusals/limits write no
 * document, emit nothing — their line stands until the next real announce
 * event replaces it.
 * ------------------------------------------------------------------------- */
const [lengthLine, setLengthLine] = createSignal<Partial<Record<LaneId, string>>>(
  {},
);
const pendingLengthFlush = new Map<LaneId, string>();

export function stepPatternLength(lane: LaneId, delta: 1 | -1): void {
  const pattern = currentPatternFor(lane);
  if (!pattern) return;
  const next = nextPatternLength(pattern.bars, delta);
  if (next === null) {
    setLengthLine((prev) => ({
      ...prev,
      [lane]: resizeLimitAnnouncement(pattern.name, pattern.bars),
    }));
    return;
  }
  const result = resizePattern(lane, pattern.id, next);
  if (result.ok) {
    const text = resizeSuccessAnnouncement(pattern.name, next);
    pendingLengthFlush.set(lane, text);
    setLengthLine((prev) => ({ ...prev, [lane]: text }));
    return;
  }
  if (result.reason === "blocked") {
    const doc = docStore.getState().doc;
    setLengthLine((prev) => ({
      ...prev,
      [lane]: resizeRefusalAnnouncement(
        pattern.name,
        result.toBars,
        resizeRowLabel(doc, lane, result.blocking.row),
        barOfStep(result.blocking.start),
      ),
    }));
  }
  // "no-op"/"not-found" cannot occur through the ladder — silent.
}

// Refinement-7's SOUNDING follow (the active tile tracks what is audible,
// frozen mid-gesture per TH-4(b)) lives in state/soundingFollow.ts — shared
// with the lane ⟲/→ footers since 2026-09-11.

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
 * individual-click law — selectPattern always, a SLOT CUE (requestSlotCue)
 * while playing. One queued cue per touched lane; the summary counts the
 * lanes whose cue was requested.
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
      requestSlotCue(target.lane, target.slot);
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
  /** HP-2 coverage: optional data-help id — the rail's name editor resolves
   *  to rail.rename; the in-tile cue editor keeps its tile's entry. */
  help?: string;
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
      data-help={props.help}
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

  const selectedId = () => activePatterns()[props.lane];

  /**
   * Refinement-7: the lane's sounding pattern (the follow), falling back to
   * the switch-target state (getActivePattern) before anything has sounded
   * — identical to the pre-follow behavior in that window.
   */
  const activeFollow = (): string | null =>
    sounding()[props.lane] ?? session.getActivePattern(props.lane);

  // Event-driven announcements (Daredevil: pending/active states announced).
  // Refinement-7: the "now <pattern>" line follows the SOUNDING slot too —
  // natural chain advance announces exactly like a landed switch (the
  // critique's fix: "follow natural chain advance … and announce").
  // BC-1 (I3-a) announcement ordering: the append's commit synchronously
  // emits a switch event (chain edits always do), which bumps switchVersion
  // and queues this effect's run — that run would repaint the region with
  // the follow line before the creation text is ever read. The override is
  // consumed BY that exact run: the effect writes the creation line once,
  // then returns to its pending/follow duty.
  let pendingAnnounceOverride: string | null = null;
  createEffect(() => {
    void switchVersion();
    if (pendingAnnounceOverride !== null) {
      // BC-1: this flush belongs to the creation announcement — one line,
      // then the region returns to its pending/follow duty.
      const text = pendingAnnounceOverride;
      pendingAnnounceOverride = null;
      setAnnounce(text);
      return;
    }
    // LL-1: a LENGTH success arms its flush BEFORE the resize commit emits
    // this run (the BC-1 ordering law) — consume it and re-write the same
    // line, so the region shows the resize text, not the follow line.
    const lengthFlush = pendingLengthFlush.get(props.lane);
    if (lengthFlush !== undefined) {
      pendingLengthFlush.delete(props.lane);
      setAnnounce(lengthFlush);
      setLengthLine((prev) => ({ ...prev, [props.lane]: undefined }));
      return;
    }
    // Any LATER announce event replaces a lingering refusal/limit line. The
    // read is UNTRACKED: this effect must fire on switch events only — a
    // tracked read would re-run it on the refusal's own write and wipe the
    // line in the same tick it appeared.
    if (untrack(() => lengthLine()[props.lane]) !== undefined) {
      setLengthLine((prev) => ({ ...prev, [props.lane]: undefined }));
    }
    const pending = session.getPendingSwitch(props.lane);
    if (pending)
      setAnnounce(pendingAnnouncement(LANE_NAMES[props.lane], pending));
    else if (session.hasPendingSchedule(props.lane)) {
      setAnnounce(structurePendingAnnouncement(LANE_NAMES[props.lane]));
    } else {
      const active = activeFollow();
      setAnnounce(active ? `${LANE_NAMES[props.lane]}: now ${active}` : "");
    }
  });

  /** IN-3: the pointer-sweep preview for one tile ("target" = will cue). */
  const sweepPreview = (tile: RailTile): string | undefined => {
    const sweep = cueSweep();
    if (!sweep || !sweep.touched.has(`${props.lane}:${tile.slot}`))
      return undefined;
    return sweep.lastByLane.get(props.lane) === tile.slot ? "target" : "swept";
  };

  /** IN-3: the keyboard range marks its tiles (text-equivalent, D9). */
  const inRange = (tile: RailTile): boolean => {
    const range = railRange();
    return range ? rangeIncludes(range, props.lane, tile.slot) : false;
  };

  const stateFor = (tile: RailTile) => {
    void switchVersion();
    return tileState(tile, {
      activePatternId: activeFollow(),
      pending: session.getPendingSwitch(props.lane),
      structurePending: structurePending(),
      selectedPatternId: selectedId(),
    });
  };

  /**
   * T6 (EMISSION-RAIL grammar): the RAW sounding seam, independent of
   * tileState. tileState deliberately collapses sounding+selected into
   * "selected" (the strongest fill) — but the rail's DOUBLED sounding
   * hairline must survive that collapse or the arrangement read loses the
   * lit tile exactly on the lane the user last touched (the T6 probe
   * finding). `data-sounding` is an ADDITIVE attribute riding the same
   * getSoundingPattern follow signal that drives data-state — no new seam,
   * no new writes while a pointer gesture is armed (the follow's TH-4(b)
   * freeze covers both attributes).
   */
  const isSounding = (tile: RailTile): boolean =>
    sounding()[props.lane] === tile.patternId;

  const triggerTile = (tile: RailTile) => {
    selectPattern(props.lane, tile.patternId);
    // ⟲/→ follow: a tap while playing cues THIS chain slot (the lane jumps
    // there at the end of the segment it is playing, then follows its mode).
    if (playing()) requestSlotCue(props.lane, tile.slot);
  };

  /** Flip a slot between ⟲ LOOP and → NEXT (tile glyph click / M key). */
  const flipMode = (tile: RailTile) => {
    const mode = toggleChainSlotMode(props.lane, tile.slot);
    setAnnounce(
      `SLOT ${tile.slot + 1} · ${tile.name} · ${mode === "loop" ? "LOOPS" : "PLAYS ONCE, THEN NEXT"}`,
    );
  };

  /**
   * LL-1 (i3-4): the LENGTH stepper's live value — the SELECTED pattern's
   * bars (the stepper resizes it; create-at-size = `+`/`n` then grow, the
   * BC-1 ladder flow). The stepper OWNS ITS LIFECYCLE inside the popover
   * (stays open across presses — the rename-field precedent), so this is
   * read reactively per press.
   */
  const selectedBars = (): number =>
    pool().find((p) => p.patternId === selectedId())?.bars ?? 1;

  /**
   * BC-1 (I3-a): THE rail `+` action — one press creates a NEW blank
   * next-letter pattern (addPattern's default bars, 1), appends it to the
   * chain, selects it (the grid remounts to the blank — immediately
   * editable), and announces the creation through this lane's rail status
   * region. Both trigger shapes share it (the row's `+` button and the
   * rail-local `+`/`=` key); DUP (PAT menu + global `d`) stays the only
   * duplication path. Store side: ONE commit → ONE undo step (create +
   * append co-revert).
   */
  const handleAppendBlank = () => {
    const n = patternPool(docStore.getState().doc, props.lane).length;
    const label = nextPatternLabel(n);
    const id = appendBlankPattern(props.lane, label);
    selectPattern(props.lane, id);
    const bars =
      docStore.getState().doc.patterns[props.lane].find((p) => p.id === id)
        ?.bars ?? 1;
    const text = patternCreatedAnnouncement(label, bars);
    pendingAnnounceOverride = text;
    setAnnounce(text); // immediate; the queued effect re-writes the same line
  };

  const handleDuplicate = () => {
    const id = duplicatePattern(props.lane, selectedId());
    selectPattern(props.lane, id);
  };

  const handleRemovePattern = () => {
    removePattern(props.lane, selectedId());
  };

  // ---- Refinement-6: the per-lane pattern-tools menu ---------------------
  // Distill of the six-tool row (critique P3): the management controls live
  // in the popover vocabulary (scale-pop/fx-add-menu law — ground chassis,
  // 25%-ink border, 6px radius, chassis cast), NOT in the row competing
  // with the tiles. Keyboard contract unchanged: `r` opens this menu
  // focused on REN (KeyboardShortcuts clicks the trigger when REN is not
  // rendered); `n`/`d`/tile F2/dblclick never routed through the buttons.
  // Actions close the menu (fx handleAdd precedent); the rename field runs
  // its own Enter/Esc/blur lifecycle inside it. Escape closes with focus
  // returned to the trigger (stopPropagation keeps the page-level Escape
  // order: inline edits/popovers consume before the FX console/region pops).
  const toolsOpen = () => toolsLane() === props.lane;
  let toolsBtn: HTMLButtonElement | undefined;
  let toolsMenuEl: HTMLDivElement | undefined;

  const openTools = () => {
    setToolsLane(props.lane);
    // Menu convention (DA-3 fx add menu): focus lands on the first control.
    queueMicrotask(() =>
      toolsMenuEl?.querySelector<HTMLButtonElement>(".rail-tool")?.focus(),
    );
  };
  const closeTools = (refocus = true) => {
    if (toolsLane() === props.lane) setToolsLane(null);
    // Never strand focus on <body> when the menu unmounts under it.
    if (refocus) toolsBtn?.focus();
  };
  /**
   * DA-3 law inside the menu: ending the rename edit unmounts the field, so
   * focus would drop to <body>. Land it back on the menu's first control —
   * but ONLY when it actually dropped (a blur-commit that moved focus
   * somewhere real, e.g. a clicked tile, is never yanked back).
   */
  const refocusToolsAfterEdit = () => {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!active || active === document.body) {
        toolsMenuEl?.querySelector<HTMLButtonElement>(".rail-tool")?.focus();
      }
    });
  };
  /**
   * Tile dblclick / F2 rename entries (DES-6, unchanged function): the name
   * field lives in the tools menu, so these paths OPEN it — the field
   * renders in place of REN and focuses itself (the IN-4 dblclick focus
   * re-assert inside InlineEdit covers the double-press race).
   */
  const beginRename = () => {
    setToolsLane(props.lane);
    setEditing({ kind: "name" });
  };

  /**
   * MB-2 (mobile slice): the dblclick TAP TWINS under touch input. A touch
   * pointerup on an UNMOVED press records the tap; a second tap on the same
   * target inside the isDoubleTap window/radius fires exactly the actions
   * the dblclick handlers own — cue line → cue edit, tile → rename. This is
   * the belt-and-braces twin: Android Chrome usually synthesizes dblclick
   * from a double-tap once the tile's touch-action pans are pinned, but a
   * double-tap-zoom that consumes the second tap would eat it — the twin
   * makes rename/cue-edit double-tap-proof on real digitizers. The two
   * paths cannot double-fire an action: both invoke the same idempotent
   * signal writes (open menu / set the editing state), and the native
   * clicks of both taps run exactly as they always did before a dblclick.
   */
  let lastTileTap: TapRecord | null = null;
  const onTileTapUp = (e: PointerEvent, tile: RailTile) => {
    if (e.pointerType !== "touch") return;
    const sweep = cueSweep();
    if (sweep && cueSweepMoved(sweep)) return; // a sweep is a drag, not a tap
    const onCue = Boolean(
      (e.target as Element | null)?.closest?.(".rail-tile-cue"),
    );
    const tap: TapRecord = {
      x: e.clientX,
      y: e.clientY,
      time: e.timeStamp,
      target: `${props.lane}:${tile.slot}${onCue ? ":cue" : ""}`,
    };
    if (isDoubleTap(lastTileTap, tap)) {
      lastTileTap = null; // the pair is consumed by the dbltap
      if (onCue) setEditing({ kind: "cue", slot: tile.slot });
      else beginRename();
      return;
    }
    lastTileTap = tap;
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
      beginRename();
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      setEditing({ kind: "cue", slot: tile.slot });
    } else if (
      !inTextEntry &&
      (e.key === "m" || e.key === "M") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      // ⟲/→ slot follow: the keyboard twin of the tile glyph (E5 parity).
      e.preventDefault();
      e.stopPropagation();
      flipMode(tile);
    } else if (e.key === "+" || e.key === "=") {
      // BC-1 (I3-a): "+" creates a NEW blank next-letter pattern, appended
      // + selected — the keyboard twin of the rail's + button. DUP (the
      // PAT menu + the global `d`) is the only duplication path.
      e.preventDefault();
      handleAppendBlank();
      // The row rebuilds on chain edits — land focus on the NEW tile (the
      // DA-3 focus-after-edit law: the appended slot), never on <body>.
      focusSlotAfterEdit(
        docStore.getState().doc.songChain[props.lane].length - 1,
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

      {/*
        PX-4 (i3-4): the lane's CYCLE length speaks through the row's group
        name — the tiles' BARS added together, in cycle vocabulary. A tiny
        label-text change only (the string lives here); no new visual
        surface — the per-tile `4B` badges stay the visible numbers, and the
        arrangement story ("how long until this lane comes round") rides the
        same aria group the tiles already report through.
      */}
      <div
        class="rail-tiles"
        role="group"
        aria-label={`${LANE_NAMES[props.lane]} song chain · ${tiles().reduce((sum, tile) => sum + tile.bars, 0)}-BAR CYCLE`}
      >
        <For each={tiles()}>
          {(tile) => (
            <button
              type="button"
              class="rail-tile"
              data-state={stateFor(tile)}
              data-sounding={isSounding(tile) ? "true" : undefined}
              data-cue-preview={sweepPreview(tile)}
              data-in-range={inRange(tile) ? "true" : undefined}
              data-help="rail.tile"
              tabindex={tile.slot === focusedSlot() ? 0 : -1}
              aria-label={`${LANE_NAMES[props.lane]} chain slot ${tile.slot + 1}: pattern ${tile.name}, ${tile.bars} bar${tile.bars === 1 ? "" : "s"}${tile.mode === "loop" ? ", loops" : ""}${tile.cue ? `, section ${tile.cue}` : ""}${stateFor(tile) === "pending" ? ", switch pending" : stateFor(tile) === "active" || isSounding(tile) ? ", playing" : ""}${inRange(tile) ? ", in cue range" : ""}`}
              onFocus={() => setFocusedSlot(tile.slot)}
              onPointerUp={(e) => onTileTapUp(e, tile)}
              onClick={() => {
                // IN-3: pointer-driven commits swallow their trailing click.
                if (suppressTileClick) return;
                triggerTile(tile);
              }}
              onDblClick={() => beginRename()}
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
              {/* ⟲/→ slot follow: a click here flips the slot's mode and
                  never reaches the tile's cue/select/sweep/rename paths. */}
              <span
                class="rail-tile-mode"
                data-mode={tile.mode}
                title={
                  tile.mode === "loop"
                    ? "⟲ Loops until you pick another tile — click for → next"
                    : "→ Plays once, then the next tile — click for ⟲ loop"
                }
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onDblClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  flipMode(tile);
                }}
              >
                <ModeIcon mode={tile.mode} />
              </span>
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
          aria-label={`Append new blank pattern to ${LANE_NAMES[props.lane]} chain`}
          onClick={() => handleAppendBlank()}
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
        <button
          type="button"
          class="rail-tool rail-tools-trigger"
          data-help="rail.tools"
          aria-haspopup="dialog"
          aria-expanded={toolsOpen()}
          aria-label={`${LANE_NAMES[props.lane]} pattern tools`}
          ref={(el) => {
            toolsBtn = el;
          }}
          onClick={() => (toolsOpen() ? closeTools(false) : openTools())}
        >
          PAT
        </button>
        <Show when={toolsOpen()}>
          <div
            class="rail-tools-menu"
            role="dialog"
            aria-modal="false"
            aria-label={`${LANE_NAMES[props.lane]} pattern tools`}
            ref={(el) => {
              toolsMenuEl = el;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Consumes BEFORE the page-level Escape order (the
                // fx-add-menu law) — the inline rename field one level
                // deeper consumes its own keystroke first.
                e.stopPropagation();
                closeTools();
              }
            }}
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
                help="rail.rename"
                onCommit={(v) => {
                  setEditing(null);
                  if (v !== "") renamePattern(props.lane, selectedId(), v);
                  refocusToolsAfterEdit();
                }}
                onCancel={() => {
                  setEditing(null);
                  refocusToolsAfterEdit();
                }}
              />
            </Show>
            {/*
              LL-1 (i3-4): the LENGTH stepper — the resize surface (the v2
              +1B/+2B/+4B create buttons retire here; the recorded
              production decision: creation is `+`/`n` (1 bar, BC-1) and
              LENGTH grows it — the KL-1 v3 coverage table's only PAT-menu
              length row is this stepper). Owns its lifecycle inside the
              popover: stays open across presses (the rename-field
              precedent); announcements ride the lane's rail status region.
            */}
            <div
              class="rail-length"
              role="group"
              aria-label={`Pattern length for ${LANE_NAMES[props.lane]} selected pattern`}
            >
              <button
                type="button"
                class="rail-tool"
                data-help="rail.length"
                aria-label={`Shrink ${LANE_NAMES[props.lane]} selected pattern one length step (Shift+B)`}
                onClick={() => stepPatternLength(props.lane, -1)}
              >
                LENGTH −
              </button>
              <span class="rail-length-value" aria-live="polite">
                {`LENGTH ${selectedBars()} BAR${selectedBars() === 1 ? "" : "S"}`}
              </span>
              <button
                type="button"
                class="rail-tool"
                data-help="rail.length"
                aria-label={`Grow ${LANE_NAMES[props.lane]} selected pattern one length step (B)`}
                onClick={() => stepPatternLength(props.lane, 1)}
              >
                LENGTH +
              </button>
            </div>
            <button
              type="button"
              class="rail-tool"
              data-help="rail.duplicate"
              aria-label={`Duplicate ${LANE_NAMES[props.lane]} selected pattern`}
              onClick={() => {
                handleDuplicate();
                closeTools();
              }}
            >
              DUP
            </button>
            <button
              type="button"
              class="rail-tool"
              data-help="rail.remove"
              aria-label={`Remove ${LANE_NAMES[props.lane]} selected pattern`}
              disabled={pool().length <= 1}
              onClick={() => {
                handleRemovePattern();
                closeTools();
              }}
            >
              RM
            </button>
          </div>
        </Show>
      </div>

      <span class="head-sr" role="status" aria-live="polite">
        {lengthLine()[props.lane] ?? announce()}
      </span>
    </div>
  );
}

export default function PatternRail(): JSX.Element {
  onMount(() => {
    // Refinement-7: the sounding follow (transport-aligned, frozen while a
    // pointer gesture is armed — TH-4(b)); ref-counted, shared state module.
    const releaseFollow = mountSoundingFollow();
    // Ephemeral gesture state must never leak across mounts (test hygiene).
    onCleanup(() => {
      releaseFollow();
      setCueSweep(null);
      setRailRange(null);
      setToolsLane(null);
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
      {/*
        MB-1 (mobile slice) — the CONDENSED PHONE RAIL, the recorded
        production decision: at phone width the rail shows ONLY the active
        lane's row (lane name + tiles + the + append + the one PAT trigger —
        the refinement-6 distill is exactly what a 390 px chrome wants), and
        the rail head (title + COLLAPSE/EXPAND toggle) hides: the one-lane
        stage IS the focused view at phone width. Tiles scroll horizontally
        inside their strip (chrome height stays stable while pinned); every
        tile law — quantized switch, sweep cue, sounding follow, cues,
        rename — is per-lane state and works unchanged on the visible row.
        Tablet and desktop render the full four-row rail (m4 byte-identity).
      */}
      {/* 2026-09-11: the phone rail now lives only on the SONG page, which
          shows every lane (the condensed one-row chrome rail retired). */}
      <For each={RAIL_ROWS}>
        {(lane) => <LaneRail lane={lane} />}
      </For>
    </section>
  );
}
