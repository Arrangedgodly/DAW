import { DRUM_KITS, PRESET_LIBRARY } from "../audio/presets";
import { STEPS_PER_BAR } from "../audio/time";
import { pitchDomain } from "../document/pitchWindow";
import {
  CUE_MAX_CHARS,
  DRUM_PIECES,
  type ProjectDocument,
} from "../document/schema";
import { ProjectValidationError, validateProject } from "../document/validate";

/** Both preflight and apply must enforce the same agent-edit constraints. */
export function validateAgentDocument(input: unknown): ProjectDocument {
  if (JSON.stringify(input)?.length > 10 * 1024 * 1024)
    throw new ProjectValidationError(
      "Project exceeds the 10 MB editing limit.",
      ["document: exceeds the 10 MB editing limit."],
    );
  const next = validateProject(input);
  const issues: string[] = [];
  for (const [index, lane] of next.lanes.entries()) {
    if (
      lane.id === "drums"
        ? !Object.values(DRUM_KITS).some((p) => p.id === lane.kitId)
        : !Object.values(PRESET_LIBRARY).some(
            (p) => p.id === lane.presetId && p.pitchRange,
          )
    )
      issues.push(
        `lanes.${index}: Unknown sound in ${lane.id}. Call bitbounce_list_sounds.`,
      );
    const domain =
      lane.id === "drums" ? null : pitchDomain(next, lane.id).degrees;
    for (const [patternIndex, pattern] of (
      next.patterns[lane.id] ?? []
    ).entries()) {
      const path = `patterns.${lane.id}.${patternIndex}`;
      if (pattern.kind === "drums") {
        // File imports repair row lengths. Agent writes must be exact.
        const raw = (input as ProjectDocument).patterns.drums[patternIndex];
        for (const piece of DRUM_PIECES) {
          if (
            raw?.kind !== "drums" ||
            raw.steps[piece]?.length !== pattern.bars * STEPS_PER_BAR
          )
            issues.push(
              `${path}.steps.${piece}: Drum rows must have exactly bars * 16 steps (${pattern.bars * STEPS_PER_BAR}).`,
            );
        }
      } else {
        for (const [noteIndex, note] of pattern.notes.entries()) {
          if (
            !domain?.includes(note.degree) ||
            !pattern.rowDegrees.includes(note.degree)
          )
            issues.push(
              `${path}.notes.${noteIndex}.degree: Every note needs an allowed pitch degree and matching rowDegrees entry. Call bitbounce_get_pattern for allowedDegrees.`,
            );
        }
      }
    }
  }
  if (issues.length)
    throw new ProjectValidationError(
      `Invalid project document (${issues.length} issues)`,
      issues,
    );
  return next;
}

export function documentDiagnostics(error: ProjectValidationError) {
  const issues = error.issues.slice(0, 50).map((issue) => {
    if (/^lanes\.\d+\.mix:/.test(issue))
      return `${issue} In document.lanes, put volume, mute and solo directly on the lane; nested mix is only used by get_project and set_lane.`;
    if (/^chainCues\./.test(issue))
      return `${issue} Each cue is null or a label of at most ${CUE_MAX_CHARS} characters after trimming. Use pattern.name for longer section names.`;
    return issue;
  });
  return {
    valid: false as const,
    issueCount: error.issues.length,
    issues,
    truncated: error.issues.length > issues.length,
  };
}

/** Browser bridges may serialize only Error.message, dropping custom properties. */
export function documentErrorMessage(error: ProjectValidationError): string {
  const report = documentDiagnostics(error);
  const shown = report.issues.slice(0, 12);
  return [
    error.message,
    ...shown,
    ...(report.issueCount > shown.length
      ? [
          `${report.issueCount - shown.length} more issues. Call bitbounce_validate_document for a larger diagnostic report.`,
        ]
      : []),
    "No changes were applied. Correct the fields and call bitbounce_validate_document before retrying; use the latest revision when applying.",
  ].join("\n");
}
