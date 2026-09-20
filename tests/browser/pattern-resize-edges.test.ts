/** Real-app resize: pointer/keyboard parity, retained notes, undo, limits, and uninterrupted transport. */
import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { createDefaultProject } from "../../src/document/schema";
import { createDemoProject } from "../../src/document/demoSong";
import { showPhonePage } from "../../src/state/phonePage";
import {
  addNote,
  docStore,
  loadDocument,
  removeNote,
} from "../../src/state/store";
import { activePatterns, selectLane } from "../../src/state/selection";
import { getSession } from "../../src/engine/session";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// Token sheet exactly as deployed (the pattern-resize precedent).
import "../../src/styles/base.css";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(App, host);
  return {
    host,
    cleanup: () => {
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

async function snapshotDb(): Promise<{
  db: ProjectDb;
  rows: Awaited<ReturnType<ProjectDb["allRecords"]>>;
} | null> {
  try {
    const db = await openRawProjectDb("bitbounce");
    return { db, rows: await db.allRecords() };
  } catch {
    return null;
  }
}

async function restoreDb(
  snap: Awaited<ReturnType<typeof snapshotDb>>,
): Promise<void> {
  if (!snap) return;
  try {
    const ids = new Set(snap.rows.map((r) => r.id));
    const current = await snap.db.allRecords();
    for (const row of snap.rows) await snap.db.putRecord(row);
    for (const row of current)
      if (!ids.has(row.id)) await snap.db.deleteRecord(row.id);
  } catch {
    /* best-effort restore */
  }
}

function key(el: Element, k: string, opts: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
}

function growKey(): void {
  key(document.body, "b");
}

function shrinkKey(): void {
  key(document.body, "B", { shiftKey: true });
}

function undoKey(): void {
  key(document.body, "z", { ctrlKey: true, metaKey: true });
}

interface Ctx {
  host: HTMLElement;
  $: <T extends Element>(sel: string) => T;
  bars: () => number;
  patternId: () => string;
  announce: () => string;
  menuOpen: () => boolean;
  openMenu: () => Promise<void>;
  closeMenu: () => Promise<void>;
  stepper: (dir: "grow" | "shrink") => HTMLButtonElement;
}

async function bootBass(): Promise<Ctx & { cleanup: () => void }> {
  const { host, cleanup } = mount();
  await waitFor(
    () => getAutosaveController() !== null,
    10_000,
    "boot autosave controller",
  );
  loadDocument(createDemoProject());
  // 2026-09-11 (user call): the chain is its own SONG page now - the
  // rail is not on the stage. Open it before addressing rail tiles.
  showPhonePage("song");
  selectLane("bass");
  await waitFor(
    () =>
      host
        .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
        ?.getAttribute("aria-label")
        ?.startsWith("Bass, track 2 grid · EDITING") === true,
    4000,
    "bass quadrant editable (demo loaded)",
  );
  const ctx: Ctx = {
    host,
    $: <T extends Element>(sel: string): T => {
      const el = host.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    },
    bars: () => {
      const id = activePatterns().bass;
      return docStore.getState().doc.patterns.bass.find((p) => p.id === id)!
        .bars as number;
    },
    patternId: () => activePatterns().bass,
    announce: (): string =>
      host.querySelector<HTMLSpanElement>(
        '.rail-row[data-lane="bass"] > .head-sr[role="status"]',
      )?.textContent ?? "",
    menuOpen: () =>
      host.querySelector('.rail-row[data-lane="bass"] .rail-tools-menu') !==
      null,
    openMenu: async () => {
      (
        host.querySelector<HTMLElement>(
          '.rail-row[data-lane="bass"] .rail-tools-trigger',
        ) as HTMLElement
      ).click();
      await waitFor(
        () =>
          host.querySelector('.rail-row[data-lane="bass"] .rail-tools-menu') !==
          null,
        2000,
        "PAT menu open",
      );
    },
    stepper: (dir: "grow" | "shrink") =>
      host.querySelector<HTMLButtonElement>(
        `.rail-row[data-lane="bass"] button[aria-label^="${
          dir === "grow" ? "Grow" : "Shrink"
        } Bass, track 2 selected pattern"]`,
      )!,
    closeMenu: async () => {
      host
        .querySelector<HTMLElement>(
          '.rail-row[data-lane="bass"] .rail-tools-menu',
        )
        ?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      await waitFor(
        () =>
          host.querySelector('.rail-row[data-lane="bass"] .rail-tools-menu') ===
          null,
        2000,
        "PAT menu closed",
      );
    },
  };
  return { ...ctx, cleanup };
}

describe("HL-1 resize edge table (real app)", () => {
  it(
    "keyboard and pointer retain spanning notes; undo, limits, and empty ladder",
    { timeout: 120_000 },
    async () => {
      const c = await bootBass();
      const snap = await snapshotDb();
      try {
        // --- Row 1: a SPANNING note (anchor bar 4, tail into bar 5) -------
        for (let i = 0; i < 3; i++) growKey(); // 1→8 bars
        await waitFor(() => c.bars() === 8, 2000, "grown to 8 bars");
        expect(
          addNote("bass", c.patternId(), { degree: 0, start: 60, length: 10 }),
        ).toBe(true); // end 70: spans the 4-bar edge (anchor bar 4)
        const original = docStore.getState().doc;
        shrinkKey();
        await waitFor(
          () => c.bars() === 4 && c.announce() === "PATTERN A · 4 BARS",
          2000,
          "spanning-note shrink via keyboard",
        );
        const current = () => {
          const p = docStore
            .getState()
            .doc.patterns.bass.find((x) => x.id === c.patternId())!;
          if (p.kind !== "pitched") throw new Error("Expected pitched bass");
          return p;
        };
        expect(current().notes).toContainEqual({
          degree: 0,
          start: 60,
          length: 10,
        });
        await c.openMenu();
        c.stepper("grow").click();
        await waitFor(() => c.bars() === 8, 2000, "grow back");
        c.stepper("shrink").click();
        await waitFor(
          () => c.bars() === 4 && c.announce() === "PATTERN A · 4 BARS",
          2000,
          "pointer shrink matches keyboard",
        );
        expect(current().notes).toContainEqual({
          degree: 0,
          start: 60,
          length: 10,
        });
        await c.closeMenu();
        undoKey();
        await waitFor(
          () => c.bars() === 8,
          2000,
          "undo restores pre-resize extent",
        );
        expect(docStore.getState().doc).toEqual(original);

        // --- Row 2: the 128 limit no-op announces on both paths ------------
        for (let i = 0; i < 4; i++) growKey(); // 8→128
        await waitFor(() => c.bars() === 128, 4000, "ladder reaches 128");
        growKey();
        await waitFor(
          () => c.announce() === "PATTERN A · 128 BARS · AT LIMIT",
          2000,
          "keyboard limit no-op announces",
        );
        expect(c.bars()).toBe(128);
        await c.openMenu();
        c.stepper("grow").click();
        await waitFor(
          () => c.announce() === "PATTERN A · 128 BARS · AT LIMIT",
          2000,
          "stepper limit no-op announces identically",
        );
        expect(c.bars()).toBe(128);
        await c.closeMenu();

        // --- Row 3: empty-pattern shrink 128→1 on the real ladder ----------
        expect(removeNote("bass", c.patternId(), 0, 60)).toBe(true);
        for (let i = 0; i < 7; i++) shrinkKey();
        await waitFor(() => c.bars() === 1, 6000, "empty pattern walks to 1");
        await waitFor(
          () => c.announce() === "PATTERN A · 1 BAR",
          2000,
          "the final clean shrink announces",
        );
      } finally {
        c.cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "grow and retained shrink while PLAYING; resize while one-shot PARKED",
    { timeout: 120_000 },
    async () => {
      const c = await bootBass();
      const snap = await snapshotDb();
      try {
        // The DEFAULT project (empty 1-bar patterns everywhere): the
        // one-shot below then runs a SHORT cycle instead of the demo's
        // 80 s grown LCM — same laws, CI-sane park wait.
        loadDocument(createDefaultProject());
        selectLane("bass");
        await waitFor(
          () =>
            c.host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              ?.getAttribute("aria-label")
              ?.startsWith("Bass, track 2 grid · EDITING") === true,
          4000,
          "bass quadrant editable (default loaded)",
        );
        const session = getSession();
        const play = () =>
          (c.$(".booth-btn-play") as HTMLButtonElement).click();
        // --- Row 5: grow while playing ----------------------------------
        play();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );
        growKey();
        await waitFor(() => c.bars() === 2, 2000, "mid-play grow commits");
        await waitFor(
          () => c.announce() === "PATTERN A · 2 BARS",
          2000,
          "mid-play announcement lands",
        );
        expect(session.transport.snapshot.playing).toBe(true);

        // --- Row 6: refusal while playing --------------------------------
        expect(
          addNote("bass", c.patternId(), { degree: 0, start: 24, length: 4 }),
        ).toBe(true); // bar 2 — past the 1-bar end
        shrinkKey();
        await waitFor(
          () => c.announce() === "PATTERN A · 1 BAR",
          2000,
          "mid-play retained shrink announces",
        );
        expect(c.bars()).toBe(1);
        const shrunk = docStore
          .getState()
          .doc.patterns.bass.find((p) => p.id === c.patternId())!;
        expect(shrunk.kind === "pitched" ? shrunk.overflow : []).toContainEqual(
          { degree: 0, start: 24, length: 4 },
        );
        growKey();
        await waitFor(
          () => c.bars() === 2,
          2000,
          "mid-play growth restores hidden note",
        );
        const grown = docStore
          .getState()
          .doc.patterns.bass.find((p) => p.id === c.patternId())!;
        expect(grown.kind === "pitched" ? grown.notes : []).toContainEqual({
          degree: 0,
          start: 24,
          length: 4,
        });
        expect(session.transport.snapshot.playing).toBe(true);

        // --- Row 7: resize while one-shot PARKED -------------------------
        play(); // stop
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "transport stopped",
        );
        const loopBtn = c.$(".booth-btn-loop") as HTMLButtonElement;
        loopBtn.click(); // LOOP off — the one-shot law
        play(); // one full LCM cycle then park
        // The booth play handler awaits the context resume BEFORE the
        // transport flips — confirm the start before waiting for the park
        // (a !playing poll right after the click races the async start).
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "one-shot started",
        );
        const cycleSec = (session.transport.snapshot.cycleSteps / 16) * 2; // 120 bpm
        await waitFor(
          () => !session.transport.snapshot.playing,
          Math.ceil(cycleSec * 1000) + 8000,
          "one-shot exhausted (parked)",
        );
        const parked = session.transport.getPosition();
        growKey();
        await waitFor(() => c.bars() === 4, 2000, "parked resize commits");
        await waitFor(
          () => c.announce() === "PATTERN A · 4 BARS",
          2000,
          "parked resize announces",
        );
        expect(session.transport.snapshot.playing).toBe(false); // stays parked
        // The parked readout is DERIVED from the cycle tail (getPosition at
        // oneShotEnded = the last step of the CURRENT basis), so a basis grow
        // moves the parked BAR with it — the law is: no resurrection, no
        // reset to the cycle start (1.1.1).
        const now = session.transport.getPosition();
        expect(`${now.bar}.${now.beat}.${now.step}`).not.toBe("1.1.1");
        expect(now.bar).toBeGreaterThanOrEqual(parked.bar);
        // And the parked transport still restarts cleanly (nothing stuck).
        play();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "parked transport restarts after the resize",
        );
        play(); // stop (test hygiene)
        await waitFor(
          () => !session.transport.snapshot.playing,
          4000,
          "stopped again",
        );
        loopBtn.click(); // LOOP back on (test hygiene)
      } finally {
        const session = getSession();
        if (session.transport.snapshot.playing) {
          (c.$(".booth-btn-play") as HTMLButtonElement).click();
        }
        c.cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "8. grow that changes the LCM mid-play: the booth BAR readout never resets (absolute-grid continuity)",
    { timeout: 90_000 },
    async () => {
      const c = await bootBass();
      const snap = await snapshotDb();
      try {
        // All-lanes-1-bar doc → LCM 16 steps = 2 s @120 bpm: the readout
        // wraps every 2 s at BAR 1. Grow drums to 2 bars mid-bar-2: the
        // basis becomes 32; the ABSOLUTE-GRID law keeps the clock where it
        // is (BAR 2 of the new 4-bar cycle) — a cursor re-base would slam
        // the readout back to BAR 1.
        loadDocument(createDefaultProject());
        selectLane("drums");
        await waitFor(
          () =>
            c.host
              .querySelector('.lane-floor[data-lane="drums"] [role="grid"]')
              ?.getAttribute("aria-label")
              ?.startsWith("Drums, track 1 grid · EDITING") === true,
          4000,
          "drums quadrant editable",
        );
        const session = getSession();
        const readout = () =>
          c.$<HTMLElement>(".booth-group-position .booth-led").textContent ??
          "";
        const barOf = () => Number(readout().split(".")[0]);

        // Drums to 2 bars FIRST (cycle 32 = 2 bars): BAR 2 exists in the
        // basis being swapped AWAY from.
        key(document.body, "b");
        await waitFor(
          () => session.transport.snapshot.cycleSteps === 32,
          2000,
          "basis 32 before play",
        );
        (c.$(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );
        // Wait into BAR 2 of the 2-bar cycle (t ∈ [2 s, 4 s) of each pass).
        await waitFor(
          () => barOf() === 2,
          6000,
          "readout in BAR 2 of the 32-step cycle",
        );
        key(document.body, "b"); // drums 2→4: LCM 32 → 64
        // The very next readout samples stay ≥ bar 2 — no reset to BAR 1.
        let sawReset = false;
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (barOf() < 2) sawReset = true;
        }
        expect(sawReset, "readout reset to BAR 1 across the basis swap").toBe(
          false,
        );
        expect(session.transport.snapshot.cycleSteps).toBe(64);
        expect(session.transport.snapshot.playing).toBe(true);
      } finally {
        // The session is a module-level singleton across tests in this file —
        // always leave it STOPPED so later structure edits land immediately.
        const session = getSession();
        if (session.transport.snapshot.playing) {
          (c.$(".booth-btn-play") as HTMLButtonElement).click();
          await waitFor(
            () => !session.transport.snapshot.playing,
            4000,
            "stopped (test hygiene)",
          );
        }
        c.cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "9. grow of the LAST pattern in a chain mid-play: commit now, engine rebuild at the boundary, lane cycle follows",
    { timeout: 90_000 },
    async () => {
      const c = await bootBass();
      const snap = await snapshotDb();
      try {
        // The DEFAULT project: one 1-bar bass pattern (the demo's bass row
        // has four slots — not the two-slot chain this row wants).
        loadDocument(createDefaultProject());
        selectLane("bass");
        await waitFor(
          () =>
            c.host
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              ?.getAttribute("aria-label")
              ?.startsWith("Bass, track 2 grid · EDITING") === true,
          4000,
          "bass quadrant editable (default loaded)",
        );
        // Chain [A(1 bar), B(1 bar)] on bass — the lane cycle is 32 steps;
        // B (the LAST slot) grows to 4 bars mid-play. appendBlankPattern is
        // the rail `+` funnel (create + append, one commit).
        const { appendBlankPattern } = await import("../../src/state/store");
        const bId = appendBlankPattern("bass", "B");
        const session = getSession();
        // Stopped: the appended chain's schedule is already live (no IM-7
        // deferral) — pin the pre-state before pressing play.
        await waitFor(
          () => session.getLaneCycleSteps("bass") === 32,
          4000,
          "lane cycle 32 pre-resize",
        );
        (c.$(".booth-btn-play") as HTMLButtonElement).click();
        await waitFor(
          () => session.transport.snapshot.playing,
          4000,
          "transport playing",
        );

        // Select B (the last slot's pattern) and grow it mid-play.
        selectLane("bass");
        const { selectPattern } = await import("../../src/state/selection");
        selectPattern("bass", bId);
        await waitFor(() => c.patternId() === bId, 2000, "pattern B selected");
        for (let i = 0; i < 2; i++) growKey(); // B 1→4 bars
        await waitFor(() => c.bars() === 4, 2000, "B committed at 4 bars");
        expect(session.transport.snapshot.playing).toBe(true);
        // The store is committed NOW; the ENGINE defers the rebuild to the
        // lane's iteration boundary (IM-7), then the lane cycle follows:
        // 16 + 64 = 80 steps.
        await waitFor(
          () => session.getLaneCycleSteps("bass") === 80,
          8000,
          "lane cycle 80 after the iteration boundary (16 + 64)",
        );
        expect(session.transport.snapshot.playing).toBe(true);
        // The rail badge of B carries the new length.
        await waitFor(
          () =>
            Array.from(
              c.host.querySelectorAll(
                '.rail-row[data-lane="bass"] .rail-tile .rail-tile-bars',
              ),
            ).some((el) => el.textContent === "4B"),
          2000,
          "B's rail badge reads 4B",
        );
      } finally {
        c.cleanup();
        await restoreDb(snap);
      }
    },
  );
});
