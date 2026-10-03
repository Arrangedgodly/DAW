import type { ProjectDocument, LaneId } from "../document/schema";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function compact(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length > 500 ? value.slice(0, 500) + "…" : value;
  if (Array.isArray(value))
    return {
      count: value.length,
      ...(depth < 4
        ? {
            items: value.slice(0, 8).map((item) => compact(item, depth + 1)),
            truncated: value.length > 8,
          }
        : {}),
    };
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return depth >= 4
      ? { fields: entries.map(([key]) => key).slice(0, 16) }
      : Object.fromEntries(
          entries
            .slice(0, 16)
            .map(([key, item]) => [key, compact(item, depth + 1)]),
        );
  }
  return value ?? null;
}

/** Bounded musical comparison; project-controlled strings remain untrusted content. */
export function previewChanges(
  before: ProjectDocument,
  after: ProjectDocument,
) {
  const changes: {
    path: string;
    action: "add" | "remove" | "change";
    before: unknown;
    after: unknown;
  }[] = [];
  const changedLanes = new Set<LaneId>();
  const add = (path: string, a: unknown, b: unknown) => {
    if (!same(a, b))
      changes.push({
        path,
        action: a === undefined ? "add" : b === undefined ? "remove" : "change",
        before: compact(a),
        after: compact(b),
      });
  };
  const keyed = new Set([
    "lanes",
    "patterns",
    "songChain",
    "chainCues",
    "chainModes",
    "playbackRules",
    "laneOverrides",
    "mixer",
  ]);
  for (const key of Object.keys({
    ...before,
    ...after,
  }) as (keyof ProjectDocument)[]) {
    if (!keyed.has(key)) add(key, before[key], after[key]);
  }
  const ids = new Set([...before.lanes, ...after.lanes].map((l) => l.id));
  for (const id of ids) {
    const a = before.lanes.find((l) => l.id === id),
      b = after.lanes.find((l) => l.id === id);
    if (
      !same(a, b) ||
      !same(before.patterns[id], after.patterns[id]) ||
      !same(before.songChain[id], after.songChain[id])
    )
      changedLanes.add(id);
    if (!a || !b) add(`lanes.${id}`, a, b);
    else
      for (const key of Object.keys({ ...a, ...b })) {
        add(
          `lanes.${id}.${key}`,
          (a as unknown as Record<string, unknown>)[key],
          (b as unknown as Record<string, unknown>)[key],
        );
      }
    const old = before.patterns[id] ?? [],
      next = after.patterns[id] ?? [];
    for (const patternId of new Set([...old, ...next].map((p) => p.id))) {
      const x = old.find((p) => p.id === patternId),
        y = next.find((p) => p.id === patternId);
      if (!x || !y) add(`patterns.${id}.${patternId}`, x, y);
      else
        for (const key of Object.keys({ ...x, ...y })) {
          add(
            `patterns.${id}.${patternId}.${key}`,
            (x as unknown as Record<string, unknown>)[key],
            (y as unknown as Record<string, unknown>)[key],
          );
        }
    }
    for (const key of [
      "songChain",
      "chainCues",
      "chainModes",
      "playbackRules",
      "laneOverrides",
    ] as const) {
      const x = before[key]?.[id],
        y = after[key]?.[id];
      if (!same(x, y)) changedLanes.add(id);
      add(`${key}.${id}`, x, y);
    }
    if (!same(before.mixer?.channels[id], after.mixer?.channels[id]))
      changedLanes.add(id);
    add(
      `mixer.channels.${id}`,
      before.mixer?.channels[id],
      after.mixer?.channels[id],
    );
  }
  add("mixer.master", before.mixer?.master, after.mixer?.master);
  return {
    changed: changes.length > 0,
    changeCount: changes.length,
    changes: changes.slice(0, 100),
    truncated: changes.length > 100,
    affectedLanes: [...changedLanes],
    removedPatterns: before.lanes
      .flatMap((l) =>
        (before.patterns[l.id] ?? [])
          .filter(
            (p) => !(after.patterns[l.id] ?? []).some((q) => q.id === p.id),
          )
          .map((p) => ({ lane: l.id, patternId: p.id, name: p.name })),
      )
      .slice(0, 100),
    warning:
      "Replacing notes or drum rows removes replaced events. Resize moves out-of-range events to overflow. Inspect changed content with get_pattern/get_document. Applying is one Undo step; unrelated human edits invalidate this preview.",
  };
}
