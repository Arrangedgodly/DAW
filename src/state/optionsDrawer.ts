/**
 * Options-drawer UI state (M-4, iteration 4): the phone-stage collapsible
 * drawer that houses the booth's option tools (loop, metronome, viz, tempo,
 * scale, swing, master volume). One Solid signal + the element that opened
 * it, so dismissal can return focus (the helpOverlay/APG dialog precedent).
 * Never document state — collapsed means the drawer renders ZERO DOM (the
 * Show law, helpOverlay/vizMode precedents).
 */

import { createSignal } from "solid-js";

const [optionsOpen, setOptionsOpen] = createSignal(false);
let opener: HTMLElement | null = null;

export { optionsOpen };

export function openOptions(from?: HTMLElement): void {
  if (from) opener = from;
  setOptionsOpen(true);
}

export function closeOptions(): void {
  setOptionsOpen(false);
  opener?.focus();
  opener = null;
}

export function toggleOptions(from?: HTMLElement): void {
  if (optionsOpen()) closeOptions();
  else openOptions(from);
}
