/**
 * NOTE PREVIEW (2026-09-18, Ableton's "preview" headphones): when on, placing
 * a note or drum hit on a grid sounds it immediately — the quick-sketch
 * workflow — whether or not the transport is playing. A per-user preference
 * (never a document field: it changes nothing about the song), persisted in
 * localStorage. Explicit auditions (Shift+Enter, the lane header's sound
 * button) always sound; only PLACEMENT auditions consult this switch.
 */

import { createSignal } from "solid-js";

export const NOTE_PREVIEW_STORAGE_KEY = "bitbounce.notePreview.v1";

function initialNotePreview(): boolean {
  try {
    return localStorage.getItem(NOTE_PREVIEW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const [notePreview, setNotePreviewSignal] = createSignal(initialNotePreview());
export { notePreview };

export function setNotePreview(on: boolean): void {
  setNotePreviewSignal(on);
  try {
    localStorage.setItem(NOTE_PREVIEW_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // The toggle still works for this session when storage is unavailable.
  }
}

export function toggleNotePreview(): void {
  setNotePreview(!notePreview());
}
