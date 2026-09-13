import { createSignal } from "solid-js";
import type { LaneId } from "../document/schema";
import { docStore } from "../state/store";
import { showError, showSuccess } from "../state/toasts";
import { registerHelp } from "../help/registry";

registerHelp([
  {
    id: "pattern.midi",
    title: "EXPORT PATTERN MIDI",
    text: "Downloads this pattern as a MIDI file with one note track and a tempo track. It includes tempo, swing, scale, transposition, chord notes, and GM drum mapping. It preserves the pattern's bar length, including trailing silence; notes are bounded by the pattern end. Arrangement repeats and live actions are excluded. MIDI carries notes, not the instrument sounds or effects.",
  },
]);

export default function PatternMidiExport(props: {
  lane: LaneId;
  patternId: string;
}) {
  const [busy, setBusy] = createSignal(false);
  const download = async () => {
    if (busy()) return;
    const project = docStore.getState().doc;
    const lane = props.lane;
    const id = props.patternId;
    setBusy(true);
    try {
      const { exportPatternMidi } = await import("../audio/exportMidi");
      const result = exportPatternMidi(project, lane, id);
      if (result.ok)
        showSuccess(
          `PATTERN MIDI EXPORTED · ${result.bars} BAR${result.bars === 1 ? "" : "S"} · ${result.noteCount} NOTES`,
        );
      else showError(result.message, { suggestion: result.suggestion });
    } catch {
      showError("Pattern MIDI export could not start.", {
        suggestion: "Reload the page and try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      class="rail-tool pattern-midi-export"
      data-help="pattern.midi"
      disabled={!props.patternId}
      aria-disabled={busy() || undefined}
      aria-busy={busy() || undefined}
      onClick={() => void download()}
    >
      {busy() ? "Exporting MIDI…" : "Export pattern MIDI"}
    </button>
  );
}
