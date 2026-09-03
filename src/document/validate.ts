/**
 * Strict validation of project documents (Captain America stance: never eval,
 * never lenient-parse file contents into the engine).
 *
 * Strictness decision (recorded): STRICT objects — unknown keys anywhere are
 * rejected, wrong types are rejected, out-of-range values are rejected. There is
 * no lenient "ignore what you don't know" path; future-version docs are handled
 * by migrations (migrate.ts) BEFORE validation, so v1 validation only ever sees
 * what v1 knows.
 *
 * Post-parse, a semantic pass checks cross-field invariants (lane order/kind vs
 * patterns, song-chain references, step-array lengths, mode names) and a
 * normalize step repairs safely-repairable length drift (pad/truncate to
 * 16 × bars) so downstream code can assume well-formed grids.
 */

import { isValiError } from "valibot";
import * as v from "valibot";
import {
  DRUM_PIECES,
  LANE_IDS,
  ProjectDocumentSchema,
  type DrumPattern,
  type LaneId,
  type Pattern,
  type PitchedCell,
  type PitchedPattern,
  type ProjectDocument,
} from "./schema";
import { isModeName } from "./scales";
import { STEPS_PER_BAR } from "../audio/time";

export class ProjectValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

function valibotIssues(error: unknown): string[] {
  if (isValiError(error)) {
    return error.issues.map(
      (issue) =>
        `${(issue.path ?? []).map((p) => String(p.key)).join(".") || "(root)"}: ${issue.message}`,
    );
  }
  return [String(error)];
}

// ---------------------------------------------------------------------------
// Dangerous-key rejection (CA-2 fuzz finding)
// ---------------------------------------------------------------------------

/**
 * valibot's strictObject flags unknown keys via `key in schemaEntries`, which
 * is TRUE for every key inherited from Object.prototype — so own keys named
 * `__proto__`, `constructor`, `toString`, … bypass the strict check (verified
 * empirically; the fuzzer's proto-keys mutation reaches validateProject with
 * them). Reject them explicitly, at every level, before schema parsing:
 * a validated document must never carry a prototype-chain-shaped own key.
 */
const DANGEROUS_OWN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function dangerousKeyIssues(
  input: unknown,
  path: string,
  issues: string[],
  depth: number,
): void {
  if (depth > 64) {
    issues.push(`${path}: nesting deeper than 64 levels before validation`);
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((el, i) =>
      dangerousKeyIssues(el, `${path}.${i}`, issues, depth + 1),
    );
    return;
  }
  if (input === null || typeof input !== "object") return;
  for (const key of Object.keys(input)) {
    if (DANGEROUS_OWN_KEYS.has(key)) {
      issues.push(
        `${path}.${key}: forbidden own key '${key}' (prototype-pollution vector)`,
      );
    }
    dangerousKeyIssues(
      (input as Record<string, unknown>)[key],
      `${path}.${key}`,
      issues,
      depth + 1,
    );
  }
}

/**
 * Strict parse: unknown → ProjectDocument, or throws ProjectValidationError
 * listing every issue found.
 */
export function validateProject(input: unknown): ProjectDocument {
  const dangerous: string[] = [];
  dangerousKeyIssues(input, "(root)", dangerous, 0);
  if (dangerous.length > 0) {
    throw new ProjectValidationError(
      `Invalid project document (${dangerous.length} issues)`,
      dangerous,
    );
  }
  const result = v.safeParse(ProjectDocumentSchema, input);
  if (!result.success) {
    throw new ProjectValidationError(
      `Invalid project document (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"})`,
      valibotIssues(result.issues),
    );
  }
  const doc = result.output as ProjectDocument;
  const issues = semanticIssues(doc);
  if (issues.length > 0) {
    throw new ProjectValidationError(
      `Invalid project document (${issues.length} issues)`,
      issues,
    );
  }
  return canonicalizeCues(normalizeProject(doc));
}

// ---------------------------------------------------------------------------
// Semantic checks (cross-field invariants valibot shape alone can't express)
// ---------------------------------------------------------------------------

function semanticIssues(doc: ProjectDocument): string[] {
  const issues: string[] = [];

  // Lanes: fixed order, exact set.
  doc.lanes.forEach((lane, i) => {
    if (lane.id !== LANE_IDS[i])
      issues.push(`lanes.${i}.id: expected '${LANE_IDS[i]}', got '${lane.id}'`);
  });

  // Scale + overrides name known modes.
  if (!isModeName(doc.scale.mode))
    issues.push(`scale.mode: unknown mode '${doc.scale.mode}'`);
  if (doc.laneOverrides) {
    for (const laneId of LANE_IDS) {
      const o = doc.laneOverrides[laneId];
      if (o && !isModeName(o.mode))
        issues.push(`laneOverrides.${laneId}.mode: unknown mode '${o.mode}'`);
    }
  }

  // Patterns per lane: kind matches lane, ids unique within a lane.
  for (const laneId of LANE_IDS) {
    const patterns = doc.patterns[laneId];
    const expectedKind = laneId === "drums" ? "drums" : "pitched";
    const seen = new Set<string>();
    patterns.forEach((p, i) => {
      if (p.kind !== expectedKind) {
        issues.push(
          `patterns.${laneId}.${i}.kind: expected '${expectedKind}', got '${p.kind}'`,
        );
      }
      if (seen.has(p.id))
        issues.push(
          `patterns.${laneId}.${i}.id: duplicate pattern id '${p.id}'`,
        );
      seen.add(p.id);
    });

    // Song chain references must exist in that lane's patterns.
    doc.songChain[laneId].forEach((id, i) => {
      if (!seen.has(id))
        issues.push(`songChain.${laneId}.${i}: unknown pattern id '${id}'`);
    });

    // DES-6 cue labels are positional: one entry per chain slot (parallel array).
    const cues = doc.chainCues?.[laneId];
    if (cues && cues.length !== doc.songChain[laneId].length) {
      issues.push(
        `chainCues.${laneId}: expected ${doc.songChain[laneId].length} cue slots (one per chain position), got ${cues.length}`,
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Normalize / sanitize (only length drift; everything else was rejected above)
// ---------------------------------------------------------------------------

function fitSteps<T>(steps: readonly T[], bars: number, fill: T): T[] {
  const len = bars * STEPS_PER_BAR;
  const out = steps.slice(0, len);
  while (out.length < len) out.push(fill);
  return out;
}

function normalizeDrumPattern(p: DrumPattern): DrumPattern {
  let changed = false;
  const steps = {} as Record<(typeof DRUM_PIECES)[number], boolean[]>;
  for (const piece of DRUM_PIECES) {
    const src = p.steps[piece];
    if (src && src.length === p.bars * STEPS_PER_BAR) {
      steps[piece] = src as boolean[];
    } else {
      changed = true;
      steps[piece] = fitSteps(src ?? [], p.bars, false);
    }
  }
  // Identity-preserving when nothing needed repair: the store bridge and grid
  // sync diff by object identity (IM-6), so valid docs must not churn.
  return changed ? { ...p, steps } : p;
}

function normalizePitchedPattern(p: PitchedPattern): PitchedPattern {
  let changed = false;
  const rows = p.rows.map((row) => {
    if (row.steps.length === p.bars * STEPS_PER_BAR) return row;
    changed = true;
    return {
      ...row,
      steps: fitSteps(row.steps, p.bars, 0 satisfies PitchedCell),
    };
  });
  return changed ? { ...p, rows } : p;
}

function normalizePattern(p: Pattern): Pattern {
  return p.kind === "drums"
    ? normalizeDrumPattern(p)
    : normalizePitchedPattern(p);
}

/**
 * Fill defaults where safe: repair step-array lengths (pad with off / truncate)
 * and add missing drum pieces as silent rows. Structural problems were already
 * rejected by strict parse — this never guesses content, only shape.
 */
export function normalizeProject(doc: ProjectDocument): ProjectDocument {
  const patterns = {} as Record<LaneId, Pattern[]>;
  let changed = false;
  for (const laneId of LANE_IDS) {
    const source = doc.patterns[laneId];
    const normalized = source.map(normalizePattern);
    // Keep array identity per lane when every pattern survived unchanged.
    patterns[laneId] = normalized.some((p, i) => p !== source[i])
      ? normalized
      : (source as Pattern[]);
    if (patterns[laneId] !== source) changed = true;
  }
  return changed ? { ...doc, patterns } : doc;
}

/**
 * Canonicalize cue labels (DES-6): trim, drop empties to null, and collapse
 * the whole `chainCues` field to null when no lane carries a label (the
 * canonical empty form — keeps default documents byte-stable for the golden
 * codec test). Identity-preserving when nothing changes.
 */
export function canonicalizeCues(doc: ProjectDocument): ProjectDocument {
  if (!doc.chainCues) return doc;
  let anyLabel = false;
  let changed = false;
  const next = {} as Record<LaneId, (string | null)[]>;
  for (const lane of LANE_IDS) {
    const slots = doc.chainCues[lane] ?? [];
    next[lane] = slots.map((label) => {
      const trimmed = (label ?? "").trim();
      if (!trimmed) {
        if (label != null) changed = true;
        return null;
      }
      anyLabel = true;
      return trimmed === label ? label : ((changed = true), trimmed);
    });
  }
  if (!anyLabel)
    return changed || doc.chainCues !== null
      ? { ...doc, chainCues: null }
      : doc;
  return changed ? { ...doc, chainCues: next } : doc;
}
