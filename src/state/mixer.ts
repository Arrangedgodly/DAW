import type { LaneId, ProjectDocument } from "../document/schema";
import {
  DEFAULT_CHANNEL,
  DEFAULT_MIXER,
  type ChannelProcessing,
  type MasterProcessing,
} from "../document/mixer";
import { createSignal } from "solid-js";
import { commitDocumentEdit, docStore, onDocumentReplaced } from "./store";

/** Survives page navigation, but never leaks a restore point into another project. */
export const [mixRestorePoint, setMixRestorePoint] =
  createSignal<ProjectDocument | null>(null);
const removeReplacedListener = onDocumentReplaced(() =>
  setMixRestorePoint(null),
);
import.meta.hot?.dispose(removeReplacedListener);

export function setChannelProcessing(
  lane: LaneId,
  update: (current: ChannelProcessing) => ChannelProcessing,
): void {
  const doc = docStore.getState().doc;
  if (!doc.lanes.some((l) => l.id === lane)) return;
  const mixer = doc.mixer ?? DEFAULT_MIXER;
  commitDocumentEdit(doc, {
    ...doc,
    mixer: {
      ...mixer,
      channels: {
        ...mixer.channels,
        [lane]: update(mixer.channels[lane] ?? DEFAULT_CHANNEL),
      },
    },
  });
}
export function setMasterProcessing(
  update: (current: MasterProcessing) => MasterProcessing,
): void {
  const doc = docStore.getState().doc,
    mixer = doc.mixer ?? DEFAULT_MIXER;
  commitDocumentEdit(doc, {
    ...doc,
    mixer: { ...mixer, master: update(mixer.master) },
  });
}
/** Restore mixing only, retaining subsequent notes, sounds, arrangement and FX edits. */
export function restoreMix(before: ProjectDocument): void {
  const doc = docStore.getState().doc;
  const next = {
    ...doc,
    lanes: doc.lanes.map((lane) => {
      const old = before.lanes.find((l) => l.id === lane.id);
      if (!old) return lane;
      const rest = { ...lane };
      delete rest.volume;
      return old.volume === undefined ? rest : { ...rest, volume: old.volume };
    }),
  };
  const channels = { ...doc.mixer?.channels };
  for (const lane of before.lanes) {
    if (!doc.lanes.some((current) => current.id === lane.id)) {
      delete channels[lane.id];
      continue;
    }
    const previous = before.mixer?.channels[lane.id];
    if (previous) channels[lane.id] = previous;
    else delete channels[lane.id];
  }
  const master = { ...(before.mixer?.master ?? DEFAULT_MIXER.master) };
  delete master.fxChain;
  if (doc.mixer?.master.fxChain) master.fxChain = doc.mixer.master.fxChain;
  if (
    before.mixer ||
    Object.keys(channels).length ||
    doc.mixer?.master.fxChain?.length
  )
    next.mixer = {
      channels,
      master,
    };
  else delete next.mixer;
  commitDocumentEdit(doc, next);
}
