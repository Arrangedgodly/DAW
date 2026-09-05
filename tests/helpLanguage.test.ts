/**
 * PX-4 tests — the octave/cycle UI LANGUAGE audit as an executable law
 * (i3-1..i3-4: the UI says what things ARE — OCTAVE, CYCLE, BARS, ROWS a–b
 * OF n — never ambiguous "size" wording; the "+ duplicates" mental model is
 * gone from copy; the KL-1 conflation fence is drawn in help text).
 *
 * These assert the colocated registry's CONTENT (the HP law: the entries
 * live next to their controls; importing the components registers them) +
 * the KEYS overlay's binding rows (keyboard.md v3 is the source of truth —
 * the overlay must stay in sync). The exact export-toast strings are pinned
 * by the browser suites (export-busy-guard + e2e-happy-path).
 *
 * Node note: importing the .tsx components needs solid's JSX transform
 * (registered at the unit-project level, vite.config.ts) and a minimal
 * window/document stub for solid-js/web's module-scope delegateEvents —
 * stubbed for the imports, then removed so nothing leaks into other files.
 * Nothing mounts; the engine session is lazy (no AudioContext in node).
 */

import { describe, expect, it } from "vitest";

const stubDocument = {
  addEventListener(): void {},
  removeEventListener(): void {},
};
const g = globalThis as { window?: unknown; document?: unknown };
const hadWindow = "window" in g;
const hadDocument = "document" in g;
g.window = { document: stubDocument };
g.document = stubDocument;
try {
  const { getHelp } = await import("../src/help/registry");
  await import("../src/components/LaneHeader");
  await import("../src/components/LaneGrid");
  await import("../src/components/PatternRail");
  await import("../src/components/Booth");
  await import("../src/components/Projects");
  const { HELP_SECTIONS } = await import("../src/components/HelpOverlay");
  // The registrations have run — solid never needs the DOM again here.
  if (!hadWindow) delete g.window;
  if (!hadDocument) delete g.document;

  const PITCHED = ["bass", "chords", "lead"] as const;

  describe("PX-4 language audit — the OCTAVE entries (KL-1 conflation fence)", () => {
    it("every pitched lane's OCT entry says OCTAVE, names the ±3 clamps, and fences SOUND transpose from VIEW scroll", () => {
      for (const lane of PITCHED) {
        const entry = getHelp(`lane.${lane}.oct`);
        expect(entry, `lane.${lane}.oct registered`).toBeDefined();
        const text = entry!.text;
        // The vocabulary law: the control is named for what it is.
        expect(entry!.title.endsWith("OCTAVE")).toBe(true);
        expect(text).toContain("OCTAVE");
        // KL-1 (keyboard.md §OCT): the entry MUST say the control changes
        // SOUND — and distinguish it from the VIEW-only window scroll.
        expect(text).toContain("SOUND");
        expect(text).toContain("SEE");
        expect(text).toContain("HEAR");
        expect(text).toContain("−3");
        expect(text).toContain("+3");
        expect(text).toMatch(/Shift\+arrows/);
      }
    });

    it("drums carries no OCTAVE entry (it answers DRUMS HAS NO OCTAVE instead)", () => {
      expect(getHelp("lane.drums.oct")).toBeUndefined();
    });

    it("the pitched grid entries draw the same fence from the window side (ONE OCTAVE, view only)", () => {
      for (const lane of PITCHED) {
        const text = getHelp(`grid.${lane}`)!.text;
        expect(text).toContain("ONE OCTAVE");
        expect(text).toContain("SEE");
        expect(text.toLowerCase()).toContain("view only");
        expect(text).toContain("OCT"); // points back at the SOUND control
      }
    });
  });

  describe("PX-4 language audit — cycle/bars vocabulary on the length surfaces", () => {
    it("LENGTH teaches BARS + the CYCLE consequence (never bare 'size')", () => {
      const text = getHelp("rail.length")!.text;
      expect(text).toContain("BARS");
      expect(text).toContain("CYCLE");
      expect(text).toContain("1, 2, 4, 8, 16, 32, 64 or 128");
      expect(text).toContain("refuses"); // the refuse-by-default law stays said
      // The audit law: no bare "size" noun ("resize" the verb is fine).
      expect(text.toLowerCase()).not.toMatch(/\bsize\b/);
    });

    it("the chain tile names its BARS and the lane's CYCLE", () => {
      const text = getHelp("rail.tile")!.text;
      expect(text).toContain("BARS");
      expect(text).toContain("CYCLE");
    });

    it("the pattern toolbox counts in BARS", () => {
      expect(getHelp("rail.tools")!.text).toContain("BARS");
    });

    it("LOOP and the export entries speak in CYCLES (one full cycle = the longest lane)", () => {
      expect(getHelp("booth.loop")!.text).toContain("ONE full song CYCLE");
      expect(getHelp("booth.loop")!.text).toContain("longest lane");
      expect(getHelp("projects.wav")!.text).toContain("ONE FULL CYCLE");
      expect(getHelp("projects.midi")!.text).toContain("ONE FULL CYCLE");
    });

    it("no audited new-surface entry leans on ambiguous 'size' wording", () => {
      const audited = [
        ...PITCHED.map((lane) => `lane.${lane}.oct` as string),
        ...PITCHED.map((lane) => `grid.${lane}` as string),
        "rail.tile",
        "rail.length",
        "rail.append",
        "rail.tools",
        "booth.loop",
        "projects.wav",
        "projects.midi",
      ];
      for (const id of audited) {
        expect(
          getHelp(id)!.text.toLowerCase(),
          `${id} must say what things ARE (octave / cycle / bars)`,
        ).not.toMatch(/\bsize\b/);
      }
    });
  });

  describe("PX-4 language audit — the `+` mental model is NEW BLANK, never duplicate", () => {
    it("rail.append says NEW blank + names DUP the only duplicator; no stale duplication wording survives", () => {
      const entry = getHelp("rail.append")!;
      expect(entry.title).toBe("NEW BLANK CLIP");
      expect(entry.text).toContain("NEW blank");
      expect(entry.text).toContain("only duplicator");
      // The retired v2 mental model (BC-1's E11 audit) must stay dead.
      expect(entry.text).not.toContain("slot playing");
      expect(entry.text).not.toMatch(/\+ .*duplicate/i);
    });
  });

  describe("PX-4 language audit — the KEYS overlay rows (keyboard.md v3 in sync)", () => {
    const rows = (): { keys: string; action: string }[] =>
      HELP_SECTIONS.flatMap((s) => s.bindings);

    it("carries the LL-1 LENGTH ladder row in bars vocabulary", () => {
      const row = rows().find((b) => b.keys === "B / SHIFT+B");
      expect(row, "the B ladder row exists (was missing pre-PX-4)").toBeDefined();
      expect(row!.action).toContain("LENGTH");
      expect(row!.action).toContain("bars");
    });

    it("carries the rail `+` row as a NEW blank clip, and N/D say the same thing", () => {
      const plus = rows().find((b) => b.keys === "+ / =");
      expect(plus, "the rail-local + row exists").toBeDefined();
      expect(plus!.action).toContain("new blank");
      const n = rows().find((b) => b.keys === "N");
      expect(n!.action).toContain("new blank");
      const d = rows().find((b) => b.keys === "D");
      expect(d!.action).toContain("only duplicator");
    });

    it("carries the register-window + octave rows with the view/sound fence", () => {
      const win = rows().find((b) => b.keys === "SHIFT+↑↓");
      expect(win!.action).toContain("octave");
      expect(win!.action).toContain("view");
      const oct = rows().find((b) => b.keys === "O / SHIFT+O");
      expect(oct!.action.toLowerCase()).toContain("octave");
      expect(oct!.action.toLowerCase()).toContain("sound");
    });

    it("the `p` row speaks in cycle vocabulary", () => {
      const p = rows().find((b) => b.keys === "P");
      expect(p, "the P row exists").toBeDefined();
      expect(p!.action).toContain("cycle");
    });
  });
} finally {
  // Belt and braces: never leak the stub into another file's globals.
  if (!hadWindow) delete g.window;
  if (!hadDocument) delete g.document;
}
