import { createBuiltInDemo, type DemoId } from "../document/builtInDemos";
import { saveProject } from "./projectStore";
import type { ProjectDb } from "./db";
import type { NewProjectOptions } from "./newProject";

/** Save under a new id; the caller retargets autosave before loading the copy. */
export async function createDemoCopy(
  db: ProjectDb,
  id: DemoId,
  opts: NewProjectOptions = {},
) {
  const doc = createBuiltInDemo(id);
  const record = await saveProject(
    db,
    (opts.newId ?? (() => crypto.randomUUID()))(),
    doc,
    { now: opts.now?.() },
  );
  return { record, doc };
}
