/**
 * UnitOptics — THE FULL UNIT overdrive (2026-09-11): the one-shot power-on
 * (styles/unit.css owns the paint). The pointer-tracked studio light that
 * first shipped here was removed at the user's call the same day — the unit
 * is lit statically by its tokens, never by the cursor.
 *
 * The power-on: first open per session only (sessionStorage flag, guarded —
 * storage can throw), never under reduced motion. It stamps `is-booting` on
 * the app root for the self-check animations and mounts the
 * pointer-events-none veil; the face is interactive from frame one.
 * aria-hidden decoration: no focus, no a11y tree, no hit target, never a
 * state signal.
 */

import { Show, createSignal, onCleanup, onMount } from "solid-js";

const BOOT_KEY = "bitbounce.unit-booted";
const BOOT_MS = 900;

function shouldBoot(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  try {
    if (window.sessionStorage.getItem(BOOT_KEY)) return false;
    window.sessionStorage.setItem(BOOT_KEY, "1");
  } catch {
    return false; // no storage, no ceremony — the app itself is unaffected
  }
  return true;
}

export default function UnitOptics() {
  let veil: HTMLDivElement | undefined;
  const [booting, setBooting] = createSignal(shouldBoot());

  onMount(() => {
    const app = veil?.parentElement;
    if (!booting() || !app) return;
    app.classList.add("is-booting");
    const done = window.setTimeout(() => {
      app.classList.remove("is-booting");
      setBooting(false);
    }, BOOT_MS);
    onCleanup(() => {
      window.clearTimeout(done);
      app.classList.remove("is-booting");
    });
  });

  return (
    <Show when={booting()}>
      <div ref={(el) => (veil = el)} class="unit-boot" aria-hidden="true" />
    </Show>
  );
}
