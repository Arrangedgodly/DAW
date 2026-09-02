/**
 * Project file export/import (MF-3). All document bytes flow through the
 * canonical codec (RES-6): export writes `encode(doc)` verbatim, import feeds
 * File.text() into `decode` — migrations, strict validation and future-version
 * refusal all apply through that one path, with NO new parse paths here.
 *
 * Error taxonomy (Hulk): typed results, never exceptions across the API
 * boundary — ok / corrupt / future-version / not-json / too-large / io. Each
 * failure carries a short human message plus a recovery suggestion; the UI
 * (FileIO.tsx toast) is the seed HU-2 will generalize.
 *
 * Security (Captain America): no dynamic code evaluation or Function
 * constructors anywhere in the import path (grep-verified in
 * tests/fileIO.test.ts via source scan and by construction — JSON.parse +
 * valibot only). Size guard rejects >10 MB before any text is read.
 */

import { DecodeError, decode, encode } from "../document/codec";
import { MigrationError } from "../document/migrate";
import { ProjectValidationError } from "../document/validate";
import type { ProjectDocument } from "../document/schema";
import { SCHEMA_VERSION } from "../document/schema";
import type { ProjectDb, ProjectRecord } from "./db";
import { saveProject } from "./projectStore";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORTED_SUFFIX = " (imported)";
export const FILE_EXTENSION = ".bitbounce.json";

// ---------------------------------------------------------------------------
// Typed results
// ---------------------------------------------------------------------------

export type ImportFailureKind =
  | "not-json"
  | "corrupt"
  | "future-version"
  | "too-large"
  | "io";

export interface ImportFailure {
  readonly ok: false;
  readonly kind: ImportFailureKind;
  /** Short human message for the toast (already audience-worded). */
  readonly message: string;
  /** Recovery suggestion shown next to the message. */
  readonly suggestion: string;
  /** corrupt: first validation issues (bounded) for the message body. */
  readonly issues?: readonly string[];
  /** future-version: the file's schemaVersion and the app's. */
  readonly fileVersion?: number;
  readonly appVersion?: number;
}

export interface ImportSuccess {
  readonly ok: true;
  /** The persisted row — a NEW project (fresh uuid, suffixed name). */
  readonly record: ProjectRecord;
  /** The decoded (migrated + validated) document as saved. */
  readonly doc: ProjectDocument;
}

export type ImportResult = ImportSuccess | ImportFailure;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Minimal DOM seams so unit tests can observe downloads without a browser. */
export interface DownloadSeam {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createElement(tag: string): { click(): void; href: string; download: string };
}

const defaultDownloadSeam: DownloadSeam = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createElement: (tag) => document.createElement(tag as "a") as HTMLAnchorElement,
};

/** Strip path separators/control chars so the doc name can't travel paths. */
export function safeFileStem(name: string): string {
  const cleaned = [...name]
    .filter((ch) => ch > "\u001f" && ch !== "/" && ch !== "\\")
    .join("")
    .trim();
  return cleaned.length > 0 ? cleaned : "project";
}

/**
 * Download the canonical codec bytes as `<name>.bitbounce.json`
 * (content-type application/json). Returns the filename used.
 */
export function exportProjectFile(
  doc: ProjectDocument,
  seam: DownloadSeam = defaultDownloadSeam,
): string {
  const filename = `${safeFileStem(doc.name)}${FILE_EXTENSION}`;
  const blob = new Blob([encode(doc)], { type: "application/json" });
  const url = seam.createObjectURL(blob);
  try {
    const anchor = seam.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    seam.revokeObjectURL(url);
  }
  return filename;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function failure(kind: ImportFailureKind, message: string, suggestion: string, extra: Partial<ImportFailure> = {}): ImportFailure {
  return { ok: false, kind, message, suggestion, ...extra };
}

/** Best-effort version peek for future-version messaging (display only). */
function peekVersion(text: string): number | undefined {
  try {
    const v = (JSON.parse(text) as { version?: unknown })?.version;
    return typeof v === "number" && Number.isInteger(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export interface ImportOptions {
  /** Fresh id for the new project (tests inject deterministic values). */
  readonly newId?: () => string;
  readonly now?: () => number;
  /** File.text seam (tests). */
  readonly readFile?: (file: File) => Promise<string>;
}

/**
 * File → NEW persisted project. Never clobbers: the decoded document gets a
 * fresh uuid and a "(imported)" name suffix before saveProject writes it as
 * its own row. Returns a typed result; throws nothing.
 */
export async function importProjectFile(
  file: File,
  db: ProjectDb,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  if (file.size > IMPORT_MAX_BYTES) {
    return failure(
      "too-large",
      `Project file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB; limit is 10 MB).`,
      "Use a smaller .bitbounce.json file — this one may not be a Bitbounce project.",
    );
  }
  const readFile = opts.readFile ?? ((f: File) => f.text());
  let text: string;
  try {
    text = await readFile(file);
  } catch {
    return failure(
      "io",
      "Project file could not be read.",
      "Check the file still exists, then try opening it again.",
    );
  }

  let doc: ProjectDocument;
  try {
    doc = decode(text); // the ONE parse path: JSON.parse → migrate → validate
  } catch (error) {
    const version = peekVersion(text);
    if (error instanceof MigrationError && version !== undefined && version > SCHEMA_VERSION) {
      const fileVersion = version;
      return failure(
        "future-version",
        `Project file needs a newer Bitbounce (file schema v${fileVersion}, this app supports v${SCHEMA_VERSION}).`,
        "Update Bitbounce to a newer version, then open this file again.",
        { fileVersion, appVersion: SCHEMA_VERSION },
      );
    }
    if (error instanceof DecodeError) {
      return failure(
        "not-json",
        "Project file is not valid JSON.",
        "Make sure you selected a .bitbounce.json file exported from Bitbounce.",
      );
    }
    if (error instanceof ProjectValidationError) {
      return failure(
        "corrupt",
        "Project file is damaged or incomplete.",
        "Re-export the project from the app it came from, then try again.",
        { issues: error.issues.slice(0, 3) },
      );
    }
    // MigrationError without a usable version (e.g. `version: "one"`) — the
    // file claims to be a project but its version stamp is unreadable.
    if (error instanceof MigrationError) {
      return failure(
        "corrupt",
        "Project file has an unreadable schema version.",
        "Re-export the project from the app it came from, then try again.",
        { issues: [error.message] },
      );
    }
    return failure(
      "corrupt",
      "Project file could not be understood.",
      "Re-export the project from the app it came from, then try again.",
    );
  }

  const newId = opts.newId ?? (() => crypto.randomUUID());
  const imported: ProjectDocument = { ...doc, name: `${doc.name}${IMPORTED_SUFFIX}` };
  try {
    const record = await saveProject(db, newId(), imported, { now: opts.now?.() });
    return { ok: true, record, doc: imported };
  } catch {
    return failure(
      "io",
      "Imported project could not be saved.",
      "Free up storage space (or check private-browsing mode), then try again.",
    );
  }
}
