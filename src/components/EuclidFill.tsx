/**
 * EuclidFill (PX-3): the per-row Euclidean fill control for the drums lane —
 * Professor X's "instant cool rhythm" lever. A compact rail between the row
 * label and the cells: pulses stepper (0..steps) + rotation stepper, visible
 * on row hover/focus (CSS opacity gate; buttons stay tab-reachable).
 *
 * Contract (town-hall): NOT a live mode. Stepper changes PREVIEW by painting
 * the Euclidean pattern as a dashed overlay onto the row (renderer.previewRow
 * — no store write); Enter / the SET button COMMITS via applyEuclidFill,
 * which paints the pattern into the document cells. After that hand editing
 * works normally. When the row no longer matches any Euclidean pattern the
 * readout shows '—' (custom) until parameters change again (re-arm).
 *
 * Pitched lanes are out of scope by design (row-level drum tooling only).
 */

import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { type DrumPiece, DRUM_PIECES } from "../document/schema";
import { getSession } from "../engine/session";
import { applyEuclidFill, docStore } from "../state/store";
import { currentPatternFor } from "../state/selection";
import { registerHelp } from "../help/registry";
import {
  fillDisplay,
  fillKeyAction,
  fillPreview,
  readFillSession,
  stepFillParam,
  type FillSession,
} from "../state/euclidFill";

const session = getSession();

/**
 * HP-1 help entries — one per drum row's fill control (I2-6: colocated here;
 * structural placeholder copy — HP-2 rewrites it text-only).
 */
registerHelp(
  DRUM_PIECES.map((piece) => ({
    id: `euclid.${piece}.fill`,
    title: `${piece.toUpperCase()} FILL`,
    text: `Spread the pulses as evenly as possible over the ${piece.toUpperCase()} row (rotation shifts where they land). The dashed overlay previews; SET paints the row, Escape cancels.`,
  })),
);

/** The active drum pattern's row for `piece` (identity mirrors store writes). */
function drumRow(piece: DrumPiece): readonly boolean[] {
  const pattern = currentPatternFor("drums");
  return pattern?.kind === "drums" ? pattern.steps[piece] : [];
}

export interface EuclidFillProps {
  readonly piece: DrumPiece;
  /** Step count of the pattern being edited (preview length). */
  readonly steps: number;
  readonly label: string;
  /** Paint/clear the preview overlay onto the rendered row (renderer seam). */
  readonly onPreview: (row: readonly boolean[] | null) => void;
}

export default function EuclidFill(props: EuclidFillProps): JSX.Element {
  const [sessionState, setSessionState] = createSignal<FillSession>(
    readFillSession(drumRow(props.piece)),
  );

  // The baseline follows store writes: after a commit — or any hand edit on
  // the grid — the match re-derives, so an edited-away row reads CUSTOM.
  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc.patterns.drums === prev.doc.patterns.drums) return;
      setSessionState((s) =>
        s.armed ? s : readFillSession(drumRow(props.piece)),
      );
    });
    onCleanup(unsubscribe);
  });

  // PREVIEW: armed sessions paint the overlay; unarmed/cancelled clear it.
  // Pure derivation from the session — never a store write.
  createEffect(() => {
    props.onPreview(fillPreview(sessionState(), props.steps));
  });
  onCleanup(() => props.onPreview(null));

  const step = (which: "pulses" | "rotation", delta: number) => {
    setSessionState((s) => stepFillParam(s, which, delta, props.steps));
  };

  const commit = () => {
    const s = sessionState();
    if (!s.armed) return;
    applyEuclidFill(props.piece, s.params.pulses, s.params.rotation);
    setSessionState(readFillSession(drumRow(props.piece)));
    props.onPreview(null);
    void session.audition("drums", props.piece);
  };

  const cancel = () => {
    setSessionState(readFillSession(drumRow(props.piece)));
    props.onPreview(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = fillKeyAction(e.key);
    if (!action) return;
    // Buttons fire Enter/Space as native clicks; a group-level Enter must
    // not double-fire. Escape always cancels (no button maps it).
    if (action === "commit" && (e.target as HTMLElement).tagName === "BUTTON")
      return;
    if (action === "commit") commit();
    else cancel();
  };

  const display = () => fillDisplay(sessionState(), props.steps);
  const rotation = () =>
    sessionState().armed || sessionState().match
      ? String(sessionState().params.rotation)
      : "—";

  return (
    <div
      class="row-fill-ctl"
      role="group"
      aria-label={`Euclidean fill for ${props.label}`}
      data-help={`euclid.${props.piece}.fill`}
      onKeyDown={onKeyDown}
    >
      <span class="row-fill-tag" aria-hidden="true">
        E
      </span>
      <div class="head-stepper row-fill-step">
        <button
          type="button"
          class="head-step-btn"
          aria-label={`Fewer pulses for ${props.label} fill`}
          onClick={() => step("pulses", -1)}
        >
          –
        </button>
        <span class="row-fill-value" aria-live="polite">
          {display()}
        </span>
        <button
          type="button"
          class="head-step-btn"
          aria-label={`More pulses for ${props.label} fill`}
          onClick={() => step("pulses", 1)}
        >
          +
        </button>
      </div>
      <div class="head-stepper row-fill-step">
        <button
          type="button"
          class="head-step-btn"
          aria-label={`Rotate ${props.label} fill back`}
          onClick={() => step("rotation", -1)}
        >
          –
        </button>
        <span class="row-fill-value" aria-live="polite">
          {rotation()}
        </span>
        <button
          type="button"
          class="head-step-btn"
          aria-label={`Rotate ${props.label} fill forward`}
          onClick={() => step("rotation", 1)}
        >
          +
        </button>
      </div>
      <button
        type="button"
        class="row-fill-apply"
        classList={{ "is-armed": sessionState().armed }}
        disabled={!sessionState().armed}
        aria-label={`Apply Euclidean fill to ${props.label} row`}
        onClick={commit}
      >
        SET
      </button>
    </div>
  );
}
