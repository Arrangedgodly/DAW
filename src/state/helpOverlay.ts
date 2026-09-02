/**
 * Help-overlay UI state (DA-1): one Solid signal + the element that opened
 * it, so dismissal can return focus (APG dialog law). Never document state.
 */

import { createSignal } from "solid-js";

const [helpOpen, setHelpOpen] = createSignal(false);
let opener: HTMLElement | null = null;

export { helpOpen };

export function openHelp(from?: HTMLElement): void {
  if (from) opener = from;
  setHelpOpen(true);
}

export function closeHelp(): void {
  setHelpOpen(false);
  opener?.focus();
  opener = null;
}
