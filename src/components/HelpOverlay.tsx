/**
 * HelpOverlay (DA-1): the in-world "?" overlay listing every keyboard
 * binding (docs/dev/keyboard.md is the source of truth — keep in sync).
 * role="dialog" aria-modal, focus-trapped (Tab cycles inside), Escape or
 * CLOSE dismisses and focus returns to the opener.
 */

import { For, Show, onCleanup, onMount, type JSX } from "solid-js";
// onMount retained for the trapTab listener registration below.
import { closeHelp, helpOpen } from "../state/helpOverlay";
import "../styles/help.css";

interface Binding {
  readonly keys: string;
  readonly action: string;
}

/**
 * PX-4 (i3-1..i3-4): the overlay now names every iteration-3 binding in the
 * octave/cycle vocabulary — the OCTAVE transpose + the VIEW-only register
 * window (the conflation fence), the LENGTH ladder in BARS, the rail `+` as
 * a NEW blank clip (DUP stays the only duplicator), and the `p` position
 * readout in CYCLE bars. Exported for the help-language unit tests.
 */
export const HELP_SECTIONS: readonly {
  title: string;
  bindings: readonly Binding[];
}[] = [
  {
    title: "GRID",
    bindings: [
      { keys: "←→↑↓", action: "move one step / row" },
      { keys: "HOME / END", action: "first / last step of row" },
      { keys: "ENTER / SPACE", action: "toggle cell (auditions)" },
      { keys: "SHIFT+ENTER", action: "audition without toggle" },
      { keys: "CTRL+← / → · , / .", action: "jump one beat (4 steps)" },
      { keys: "PGUP / PGDN · CTRL+↑↓ · [ ]", action: "move lane" },
      { keys: "SHIFT+↑↓", action: "scroll register window one octave (view)" },
      { keys: "ESC", action: "to lane header" },
    ],
  },
  {
    title: "PATTERNS",
    bindings: [
      { keys: "N", action: "new blank 1-bar pattern, appended" },
      { keys: "+ / =", action: "new blank pattern (on a focused rail tile)" },
      { keys: "B / SHIFT+B", action: "LENGTH ladder: grow / shrink pattern (bars)" },
      { keys: "D", action: "duplicate pattern (the only duplicator)" },
      { keys: "R", action: "rename (focuses rail REN)" },
      { keys: "F2", action: "rename (on rail tile)" },
      { keys: "L", action: "label section cue" },
      { keys: "DEL", action: "remove chain slot" },
      { keys: "O / SHIFT+O", action: "active lane octave +1 / −1 (sound)" },
    ],
  },
  {
    title: "TRANSPORT / EDIT",
    bindings: [
      { keys: "SPACE", action: "play / stop (outside grid)" },
      {
        keys: "P",
        action: "announce position — song cycle bar + active lane's cycle bar when lane cycles differ",
      },
      { keys: "CTRL+Z", action: "undo" },
      { keys: "CTRL+SHIFT+Z / CTRL+Y", action: "redo" },
      { keys: "?", action: "this overlay" },
    ],
  },
];

const SECTIONS = HELP_SECTIONS;

export default function HelpOverlay(): JSX.Element {
  let panel: HTMLDivElement | undefined;

  const trapTab = (e: KeyboardEvent) => {
    if (!helpOpen() || e.key !== "Tab" || !panel) return;
    const focusables = [
      ...panel.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea",
      ),
    ].filter((el) => !el.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  onCleanup(() => {
    window.removeEventListener("keydown", trapTab, true);
  });
  onMount(() => {
    window.addEventListener("keydown", trapTab, true);
  });

  return (
    <Show when={helpOpen()}>
      <div class="help-backdrop" onClick={() => closeHelp()}>
        <div
          class="help-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          ref={(el) => {
            panel = el;
            // Focus on open (the panel is created by Show when help opens —
            // a component-level onMount would run before it exists).
            queueMicrotask(() => el.focus());
          }}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closeHelp();
            }
          }}
        >
          <h2 class="help-title">KEYS</h2>
          <div class="help-sections">
            <For each={SECTIONS}>
              {(section) => (
                <section class="help-section" aria-label={section.title}>
                  <h3 class="help-section-title">{section.title}</h3>
                  <dl class="help-list">
                    <For each={section.bindings}>
                      {(b) => (
                        <div class="help-row">
                          <dt>
                            <kbd>{b.keys}</kbd>
                          </dt>
                          <dd>{b.action}</dd>
                        </div>
                      )}
                    </For>
                  </dl>
                </section>
              )}
            </For>
          </div>
          <button type="button" class="help-close" onClick={() => closeHelp()}>
            CLOSE
          </button>
        </div>
      </div>
    </Show>
  );
}
