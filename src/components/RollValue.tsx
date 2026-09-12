/**
 * RollValue — the digital-unit readout roll (THE FULL UNIT, lightning-fast
 * pass). A stepper's value does not swap silently: the new value DROPS into
 * its window from above with a one-frame over-bright flash, ~110ms, like a
 * fast counter wheel landing on its detent. Web Animations only — no class
 * or attribute writes (zero MutationObserver records beyond the text change
 * itself), compositor transform/opacity plus a tiny filter flash on a
 * few-glyph span. The first render never animates; reduced motion never
 * animates (the value change itself is the information).
 */

import { createEffect, on, type JSX } from "solid-js";

const REDUCE = "(prefers-reduced-motion: reduce)";

export default function RollValue(props: { readonly children: JSX.Element; readonly value: unknown }) {
  let el: HTMLSpanElement | undefined;
  createEffect(
    on(
      () => props.value,
      () => {
        if (!el || window.matchMedia(REDUCE).matches) return;
        el.animate(
          [
            { transform: "translateY(-0.55em)", opacity: 0, filter: "brightness(2.2)" },
            { transform: "translateY(0.06em)", opacity: 1, filter: "brightness(1.5)", offset: 0.7 },
            { transform: "translateY(0)", opacity: 1, filter: "brightness(1)" },
          ],
          { duration: 110, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
        );
      },
      { defer: true },
    ),
  );
  return (
    <span class="roll-value" ref={(node) => (el = node)}>
      {props.children}
    </span>
  );
}
