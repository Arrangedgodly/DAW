/**
 * NEW project flow (HU-2): persist a fresh default document under a NEW id
 * (never clobbers the working project's row — same no-clobber law as MF-3
 * import) and hand back the record + doc. The caller retargets autosave via
 * boot.switchToProject BEFORE loading the doc (import's ordering rule).
 */

import { createFreshProjectDocument } from "../state/store";
import type { ProjectDocument } from "../document/schema";
import { saveProject } from "./projectStore";
import type { ProjectDb, ProjectRecord } from "./db";

export interface NewProjectOptions {
  /** Fresh id (tests inject deterministic values). */
  readonly newId?: () => string;
  readonly now?: () => number;
}

export async function createNewProject(
  db: ProjectDb,
  opts: NewProjectOptions = {},
): Promise<{ record: ProjectRecord; doc: ProjectDocument }> {
  const doc = createFreshProjectDocument();
  const record = await saveProject(
    db,
    (opts.newId ?? (() => crypto.randomUUID()))(),
    doc,
    {
      now: opts.now?.(),
    },
  );
  return { record, doc };
}
