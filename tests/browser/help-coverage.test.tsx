/**
 * HP-2 browser gate — help CONTENT + COVERAGE (iteration-2 AC #6 coverage
 * clauses): every interactive region of the mounted app carries a registered,
 * substantive help entry, so a NEW unregistered control FAILS the suite.
 *
 * The walk mounts the real App, opens every surface state in turn, and at
 * each state enumerates every interactive element (button / input / select /
 * textarea / positive-tabindex element that is connected, rendered, and not
 * aria-hidden) — each must resolve through `closest("[data-help]")` to a
 * registry entry with substantive text. That is the anti-rot teeth: adding a
 * control without a colocated registration breaks this test.
 *
 * States walked: base chrome (booth + four quadrant strips + four grids +
 * euclid rails + rail) · FX strip with devices mounted · FX add menu ·
 * projects popover · lane scale popover (the HP-1 deferral HP-2 owns) ·
 * booth project-scale popover · rail pattern-tools menu + rename inline
 * editor (refinement-6: the tools live behind the row's PAT popover).
 *
 * Documented EXCLUSIONS (deliberate, per plan law):
 * - The KEYS overlay (.help-backdrop): the keyboard-shortcut reference is a
 *   SEPARATE surface that stays unchanged (town-hall item 7); its own "?"
 *   affordance (booth.keys) is registered. A modal reference dialog does not
 *   need info-mode help for its CLOSE button.
 * - The info view itself (.info-view): role=status, never focusable — there
 *   is nothing to explain about the explainer, and it owns no controls.
 *
 * Content quality (the "no placeholders survive" clause): every registry
 * entry must be substantive prose — no placeholder markers, a minimum
 * length — in addition to HP-1's non-empty invariants.
 *
 * Journey clause: with help mode ON, focusing representatives of the newly
 * covered surfaces (scale popover internals, rename field) drives the info
 * region's text — coverage is not just structural, it is readable.
 */

import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { getHelp, helpEntryIds } from "../../src/help/registry";
import { setHelpMode } from "../../src/state/helpMode";
import { selectLane } from "../../src/state/selection";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// DA-3 fix precedent (axe gate): App imports its component CSS but NOT the
// token sheet — that is main.tsx's job in the real bundle. Without tokens
// computed values misbehave; load the token base exactly as deployed.
import "../../src/styles/base.css";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return {
    host,
    cleanup: () => {
      setHelpMode(false);
      dispose();
      host.remove();
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  ms = 4000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

/** Placeholder markers that must never survive in shipped help text. */
const PLACEHOLDER_RE = /\b(tbd|todo|fixme|placeholder|lorem|xxx)\b/i;
/** Substantive prose floor — every real entry comfortably clears it. */
const MIN_TEXT = 40;

interface WalkFinding {
  describe: string;
  scope: string;
}

/**
 * THE WALK: every interactive element in the document must resolve to a
 * registered entry with substantive text. Returns every violation.
 */
function walkInteractive(scope: string): WalkFinding[] {
  const findings: WalkFinding[] = [];
  const els = document.querySelectorAll(
    'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  for (const el of els) {
    if (!el.isConnected) continue;
    // Hidden machinery (e.g. the projects file input seam) and unrendered
    // controls (a view-only quadrant's display:none edit row) are not
    // interactive surfaces.
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.getClientRects().length === 0) continue;
    // Documented exclusions (see file header).
    if (el.closest(".help-backdrop")) continue;
    if (el.closest(".info-view")) continue;
    const describe =
      el.getAttribute("aria-label") ??
      (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60) ??
      el.tagName.toLowerCase();
    const host = el.closest("[data-help]");
    if (!host) {
      findings.push({ describe, scope });
      continue;
    }
    const entry = getHelp(host.getAttribute("data-help") ?? "");
    if (!entry) {
      findings.push({ describe, scope: `${scope} (unregistered id)` });
      continue;
    }
    if (
      PLACEHOLDER_RE.test(entry.text) ||
      entry.text.trim().length < MIN_TEXT
    ) {
      findings.push({
        describe,
        scope: `${scope} (thin text: "${entry.text}")`,
      });
    }
  }
  return findings;
}

describe("HP-2 help coverage — every interactive surface explains itself", () => {
  it(
    "walks every surface state: no unregistered control, no placeholder text",
    { timeout: 90_000 },
    async () => {
      const { host, cleanup } = mount();
      // Snapshot the shared-origin project rows so teardown restores state
      // (in-page mounts cannot deleteDatabase — the boot connection stays
      // open; the iframe-based suites wipe at their start).
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();

        // Deterministic content: the shared browser origin restores whatever
        // the previous suite left — load the DEMO (FX devices on bass/chords/
        // lead, four rail rows, six drum rows with euclid rails) so the walk
        // sees the full surface set every run.
        loadDocument(createDemoProject());
        selectLane("drums");

        // Park the shared browser's REAL cursor on unregistered ground (the
        // HP-1 deflake law): trusted boundary events under a stationary
        // cursor must not race this gate's info-region assertions later.
        const railTitle = host.querySelector(".rail-title");
        if (railTitle) await userEvent.click(railTitle);

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const click = (sel: string) =>
          $(sel).dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        const keyAt = (k: string) =>
          ((document.activeElement as Element) ?? document.body).dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );

        // The registry itself: substantive prose everywhere (HP-1's non-empty
        // invariant raised to HP-2's no-placeholder clause).
        const ids = helpEntryIds();
        expect(
          ids.length,
          "coverage count — every surface family registers",
        ).toBeGreaterThanOrEqual(70);
        const thin = ids.filter((id) => {
          const text = getHelp(id)!.text;
          return PLACEHOLDER_RE.test(text) || text.trim().length < MIN_TEXT;
        });
        expect(thin, "entries with placeholder/thin text").toEqual([]);

        // --- STATE 1: base chrome --------------------------------------
        // (demo loaded: booth, all four quadrant strips, the selected drums
        // grid + euclid rails, all four rail rows)
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="drums"] [role="grid"]')
              ?.getAttribute("aria-label") === "DRUMS grid · EDITING",
          4000,
          "drums quadrant editable (demo loaded)",
        );
        let findings = walkInteractive("base chrome");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "base chrome must be fully covered",
        ).toEqual([]);

        // --- STATE 2: FX strip with devices mounted ---------------------
        selectLane("bass"); // demo bass lane carries FX devices
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              ?.getAttribute("aria-label") === "BASS grid · EDITING",
          2000,
          "bass quadrant editable",
        );
        click('[data-help="lane.bass.fx"]');
        await waitFor(
          () => host.querySelector(".fx-strip") !== null,
          2000,
          "fx strip open",
        );
        findings = walkInteractive("fx strip");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "fx strip must be fully covered",
        ).toEqual([]);

        // --- STATE 3: FX add menu --------------------------------------
        click('[data-help="fx.add"]');
        await waitFor(
          () => host.querySelector(".fx-add-menu") !== null,
          2000,
          "add menu open",
        );
        findings = walkInteractive("fx add menu");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "fx add menu must be fully covered",
        ).toEqual([]);
        keyAt("Escape"); // menu's own Escape (mode is off)
        await waitFor(
          () => host.querySelector(".fx-add-menu") === null,
          2000,
          "add menu closed",
        );
        click('[data-help="lane.bass.fx"]'); // close the strip

        // --- STATE 4: projects popover ---------------------------------
        click('[data-help="projects.open"]');
        await waitFor(
          () => host.querySelector(".projects-pop") !== null,
          2000,
          "projects popover open",
        );
        findings = walkInteractive("projects popover");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "projects popover must be fully covered",
        ).toEqual([]);
        keyAt("Escape");
        await waitFor(
          () => host.querySelector(".projects-pop") === null,
          2000,
          "projects popover closed",
        );

        // --- STATE 5: LANE scale popover (HP-1's deferral to HP-2) ------
        click('[data-help="lane.bass.scale"]');
        await waitFor(
          () => host.querySelector(".scale-pop") !== null,
          2000,
          "lane scale popover open",
        );
        findings = walkInteractive("lane scale popover");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "scale popover internals must be covered (HP-1 deferral)",
        ).toEqual([]);
        // Journey clause: with help mode ON, focusing a popover internal
        // drives the info region (coverage is readable, not structural).
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        $<HTMLButtonElement>('.scale-pop [data-root="9"]').focus();
        expect(
          host.querySelector(".info-view-title")?.textContent?.trim(),
        ).toBe("ROOT");
        $<HTMLButtonElement>(".scale-pop-detach").focus();
        expect(
          host.querySelector(".info-view-title")?.textContent?.trim(),
        ).toBe("USE PROJECT SCALE");
        setHelpMode(false);
        await waitFor(() => host.querySelector(".info-view") === null);
        keyAt("Escape"); // popover's own Escape (mode off now)
        await waitFor(
          () => host.querySelector(".scale-pop") === null,
          2000,
          "lane scale popover closed",
        );

        // --- STATE 6: PROJECT (booth) scale popover --------------------
        click('[data-help="booth.scale"]');
        await waitFor(
          () => host.querySelector(".scale-pop") !== null,
          2000,
          "project scale popover open",
        );
        findings = walkInteractive("project scale popover");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "project scale popover must be fully covered",
        ).toEqual([]);
        keyAt("Escape");
        await waitFor(
          () => host.querySelector(".scale-pop") === null,
          2000,
          "project scale popover closed",
        );

        // --- STATE 7: rail pattern-tools menu + rename inline editor ------
        // Refinement-6: the six management tools live behind the row's PAT
        // popover — walk it OPEN (every tool must still resolve to its
        // registered entry), then the rename field inside it.
        click('.rail-row[data-lane="bass"] .rail-tools-trigger');
        await waitFor(
          () => host.querySelector(".rail-tools-menu") !== null,
          2000,
          "pattern tools menu open",
        );
        findings = walkInteractive("rail pattern tools menu");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "the tools menu must be fully covered",
        ).toEqual([]);
        click('.rail-row[data-lane="bass"] [data-help="rail.rename"]');
        await waitFor(
          () => host.querySelector(".rail-tools .rail-edit") !== null,
          2000,
          "rename editor open",
        );
        findings = walkInteractive("rail rename editor");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "the inline rename field must be covered",
        ).toEqual([]);
        // Close it deterministically: the field's Escape handler is bound to
        // the input (Solid-delegated), and the synthetic click path leaves
        // document.activeElement elsewhere — dispatch AT the field.
        $<HTMLInputElement>(".rail-tools .rail-edit").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => host.querySelector(".rail-tools .rail-edit") === null,
          2000,
          "rename editor closed",
        );
        // Then the menu's own Escape (the documented order: inline edits
        // consume first, popovers second) — focus rests in the menu after
        // the field's guard refocus, so the menu's bubbled handler sees it.
        keyAt("Escape");
        await waitFor(
          () => host.querySelector(".rail-tools-menu") === null,
          2000,
          "pattern tools menu closed",
        );

        // --- Final: the coverage census (the log's count) ---------------
        // Distinct registry entries seen by the walk across all states ≥ the
        // core surfaces; guards against a walk that silently shrank.
        const seen = new Set<string>();
        for (const el of document.querySelectorAll("[data-help]")) {
          const id = el.getAttribute("data-help") ?? "";
          if (getHelp(id)) seen.add(id);
        }
        expect(
          seen.size,
          "the mounted chrome alone exposes most of the registry",
        ).toBeGreaterThanOrEqual(50);
      } finally {
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        // Stop the boot autosave controller first (no writes may land after
        // the restore), then put the pre-test rows back (HP-1 gate precedent).
        try {
          await getAutosaveController()?.stop();
          if (bootDb) {
            const ids = new Set(snapshotRows.map((r) => r.id));
            const current = await bootDb.allRecords();
            for (const row of snapshotRows) await bootDb.putRecord(row);
            for (const row of current) {
              if (!ids.has(row.id)) await bootDb.deleteRecord(row.id);
            }
          }
        } catch {
          /* best-effort restore; the wiping suites clean the origin anyway */
        }
      }
    },
  );

  // MB-3 (mobile slice — the plan's AC: "help coverage holds at phone
  // width"): the PHONE STAGE renders a different surface set (sticky chrome
  // with the lane switcher + condensed rail, ONE lane's strip + grid, the
  // euclid OVERLAY controls always tab-reachable behind the opacity gate,
  // the FILL reveal toggle) — every one of them must resolve to a registered
  // entry exactly as the quadrant stage does.
  it(
    "phone-width pass: the single-lane stage's surfaces stay fully covered",
    { timeout: 90_000 },
    async () => {
      await page.viewport(390, 844);
      const { host, cleanup } = mount();
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        loadDocument(createDemoProject());
        selectLane("drums");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="drums"] [role="grid"]')
              ?.getAttribute("aria-label") === "DRUMS grid · EDITING",
          4000,
          "drums stage editable (demo loaded)",
        );
        expect(
          host.querySelector(".app")?.getAttribute("data-stage"),
        ).toBe("phone");

        const click = (sel: string) =>
          host.querySelector(sel)!.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        const keyAt = (k: string) =>
          ((document.activeElement as Element) ?? document.body).dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              bubbles: true,
              cancelable: true,
            }),
          );

        // --- PHONE STATE 1: base chrome + the drums lane ------------------
        // (booth, switcher tabs, condensed rail, the drums strip incl. the
        // FILL toggle, the grid, the euclid overlay steppers — hidden behind
        // the opacity gate but tab-reachable, so the walk sees them.)
        let findings = walkInteractive("phone base chrome");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "phone base chrome must be fully covered",
        ).toEqual([]);

        // --- PHONE STATE 2: the pitched lane + FX console ------------------
        selectLane("bass");
        await waitFor(
          () =>
            host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              ?.getAttribute("aria-label") === "BASS grid · EDITING",
          2000,
          "bass stage editable",
        );
        findings = walkInteractive("phone bass lane");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "the phone bass lane must be fully covered",
        ).toEqual([]);
        click('[data-help="lane.bass.fx"]');
        await waitFor(
          () => host.querySelector(".fx-strip") !== null,
          2000,
          "fx strip open at phone width",
        );
        findings = walkInteractive("phone fx strip");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "the phone fx strip must be fully covered",
        ).toEqual([]);
        keyAt("Escape"); // closes the console (page-level law)
        await waitFor(
          () => host.querySelector(".fx-strip") === null,
          2000,
          "fx strip closed",
        );

        // --- PHONE STATE 3: projects popover + PAT menu --------------------
        click('[data-help="projects.open"]');
        await waitFor(
          () => host.querySelector(".projects-pop") !== null,
          2000,
          "projects popover open",
        );
        findings = walkInteractive("phone projects popover");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "the phone projects popover must be fully covered",
        ).toEqual([]);
        keyAt("Escape");
        await waitFor(
          () => host.querySelector(".projects-pop") === null,
          2000,
          "projects popover closed",
        );
        click(".rail-tools-trigger");
        await waitFor(
          () => host.querySelector(".rail-tools-menu") !== null,
          2000,
          "pattern tools menu open",
        );
        findings = walkInteractive("phone pattern tools menu");
        expect(
          findings.map((f) => `${f.scope}: "${f.describe}"`),
          "the phone tools menu must be fully covered",
        ).toEqual([]);
        keyAt("Escape");
        await waitFor(
          () => host.querySelector(".rail-tools-menu") === null,
          2000,
          "pattern tools menu closed",
        );

        // --- Journey clause at phone width: TAP-driven inspection ---------
        // (the m3 model: the click observer resolves the tapped registered
        // control — structural coverage made readable by the tap path).
        setHelpMode(true);
        await waitFor(() => host.querySelector(".info-view") !== null);
        const tab = host.querySelector<HTMLElement>(
          '.lane-switch-tab[data-lane="drums"]',
        )!;
        tab.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await waitFor(
          () =>
            host.querySelector(".info-view-title")?.textContent?.trim() ===
            "LANE SWITCHER",
          2000,
          "the click path shows the switcher entry",
        );
        setHelpMode(false);
        await waitFor(() => host.querySelector(".info-view") === null);
      } finally {
        setHelpMode(false);
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        cleanup();
        await page.viewport(1280, 800); // leave the tester viewport as configured
        try {
          await getAutosaveController()?.stop();
          if (bootDb) {
            const ids = new Set(snapshotRows.map((r) => r.id));
            const current = await bootDb.allRecords();
            for (const row of snapshotRows) await bootDb.putRecord(row);
            for (const row of current) {
              if (!ids.has(row.id)) await bootDb.deleteRecord(row.id);
            }
          }
        } catch {
          /* best-effort restore; the wiping suites clean the origin anyway */
        }
      }
    },
  );
});
