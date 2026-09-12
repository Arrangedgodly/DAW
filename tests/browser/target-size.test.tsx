import { WORKSPACE_TOGGLE } from "./workspace";
/**
 * MB-3 browser gate — the PHONE TARGET-SIZE AUDIT (town-hall mobile addendum
 * m2 / WCAG 2.5.5, ≥44×44) + the phone-stage focus-order + rotation-coherence
 * laws. The plan's AC: "every primary control measures ≥44×44 at 390×844 +
 * 360×800" — measured as HIT boxes, not painted boxes: the world-respecting
 * route lets the painted control stay compact while an invisible hit strap
 * (booth chrome) or a taller input box (sliders) carries the target.
 *
 * MEASUREMENT LAW (how a hit box is proven): elementFromPoint is the truth.
 * For every control in the inventory the gate:
 *   1. scrolls the control into view (the sticky chrome stays pinned),
 *   2. walks the contiguous hit region outward from the control's center
 *      (1 px steps, both axes) — the region the pointer would actually
 *      activate — and records it in the audit table,
 *   3. probes the four corners of the centered 44×44 rect (1 px inset) —
 *      every corner must resolve to the control itself (or a descendant),
 *      which FAILS if a neighboring control's hit box encroaches (the plan's
 *      "adjacent hit boxes must not overlap" law, enforced behaviorally).
 *
 * Documented EXEMPTIONS (the audit table records them with their rationale —
 * the plan's own law: "grid cells are data targets not buttons"):
 * - Grid cells + note-edge zones: data targets / pointer gesture affordances
 *   (editing obeys the gesture laws; the keyboard twin is the cell's Enter
 *   path). Their geometry is measured and logged, never asserted ≥44. i5
 *   delta (H-4, journals only — the exemption is about the GESTURE SURFACE,
 *   not an endorsement of small targets): the cells are no longer 15 px
 *   wide — the width-fill law grows them to 15.69–20.81 px on the shipped
 *   viewports (17.5625 drums / 18.3125 pitched at 390) against 44–64 px
 *   grown row tracks; the recorded exempt-row numbers below grow with the
 *   fill, logged not asserted.
 * - The booth TEMPO number input: WCAG 2.5.5 "equivalent" exception — the
 *   flanking −/+ steppers (both ≥44 hit) are the equivalent adjustment
 *   controls; the input exists for direct entry only.
 * - The save indicator: role=status, focusable for inspection, NOT operable
 *   (no action) — target size applies to controls.
 * - The booth position LED/beat LEDs: non-interactive readouts (hidden at
 *   phone width by the MB-3 condensation anyway).
 *
 * Also gated here (the m2/m3 small-surface half):
 * - The CHROME BUDGET re-assert at 360×800 (MB-1's hard law, re-pinned
 *   because the target law moves the chrome): chrome < 50% of the viewport,
 *   usable stage ≥ 40%.
 * - i6 S-4: the shared PROJECTS popover's management states at every
 *   committed phone width — per-row RENAME/DELETE keys, the CONFIRM DELETE
 *   state, and the rename editor input join the elementFromPoint law at
 *   360×800 + 390×844 (+ the 430×932 wide-phone spot-check), and the
 *   popover box must FIT the viewport in normal/confirm/editor states while
 *   the special states never WIDEN it (audit §5: the confirm key and the
 *   editor REPLACE row content).
 * - FOCUS ORDER at phone: no positive tabindex anywhere; tab order is
 *   top-to-bottom visual order (chrome: booth → switcher → rail, then the
 *   scrolling stage: strip → grid) — the a11y §2 law at phone scale.
 * - ROTATION coherence: phone→rotated-phone keeps focus inside the app (no
 *   strand on <body>); phone→tablet (the keyed remount) lands focus on a
 *   real control via the LY-1 strip focus law.
 */

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import App from "../../src/App";
import { loadDocument } from "../../src/state/store";
import { createDemoProject } from "../../src/document/demoSong";
import { selectLane } from "../../src/state/selection";
import { showPhonePage } from "../../src/state/phonePage";
import { clearToasts, showError } from "../../src/state/toasts";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { saveProject } from "../../src/persist/projectStore";
// DA-3 fix precedent (axe gate): App imports its component CSS but NOT the
// token sheet — that is main.tsx's job in the real bundle. Without tokens
// every var(--space-*) padding/gap invalidates at computed-value time and
// the measured geometry is a LIE. Load the token base exactly as deployed.
import "../../src/styles/base.css";

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

const raf = () =>
  new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * MB-6 hardening (the coordinator-assigned SNARE load flake —
 * state.md/production-log.md "MB-4 worker"/"MB-5 worker"). MEASURED root
 * causes (see auditOverlayReachability for the full record): (1) the clip
 * box went stale under per-fill page scrolling (fixed there), and (2) a
 * classic desktop scrollbar could lay the phone out 15 px narrower than the
 * committed width (fixed by the scrollbar-width pin). This helper adds the
 * remaining discipline: geometry audits wait for `document.fonts.ready`
 * and dimension-stable polls, so they measure the settled layout the phone
 * actually holds — never a mid-swap transient. Assertion strength is
 * UNCHANGED: the full 44×44 reachability laws (clip containment + boundary
 * probes + the width law) face the same thresholds as before.
 */
async function fontsSettled(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    /* fonts API unavailable — the stability polls below still apply */
  }
  await raf();
}

/**
 * Wait until `sample()` returns a dimension-stable value (three consecutive
 * samples within 0.5 of each other) — the settled-truth poll for geometry
 * that legitimately moves while fonts/reveal layouts land.
 */
async function settleValue(
  sample: () => number,
  timeoutMs = 5_000,
): Promise<number> {
  const t0 = Date.now();
  let stable = 0;
  let last = Number.NaN;
  while (Date.now() - t0 < timeoutMs) {
    const v = sample();
    if (Math.abs(v - last) < 0.5) {
      stable++;
      if (stable >= 3) return v;
    } else {
      stable = 0;
    }
    last = v;
    await new Promise((r) => setTimeout(r, 80));
  }
  return sample();
}

interface AuditRow {
  name: string;
  painted: string;
  hit: string;
  verdict: "PASS" | "EXEMPT";
}

/** Does the element at (x, y) belong to `el` (self or descendant)? */
function hitBelongs(el: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y);
  return hit === el || (hit !== null && el.contains(hit));
}

function describeHit(el: Element): string {
  const hit = el.tagName.toLowerCase();
  const label =
    el.getAttribute("aria-label") ?? el.getAttribute("data-help") ?? "";
  return label ? `${hit}[${label.slice(0, 40)}]` : hit;
}

/**
 * The audit's core measurement. The HIT BOX is the union of the painted box
 * and the contiguous hit region found by an outward lattice scan (the
 * booth's invisible strap extends past the paint). Measurement law, tuned
 * to what elementFromPoint can honestly prove:
 *
 * - The scan walks 1 px steps outward along the center cross; the true edge
 *   lies within 0.5 px beyond the last-hitting point, so the region is
 *   edge-to-edge = scan ± 0.5 (a box spanning [2,46) measures 43 on the
 *   integer lattice — 44 true). Chromium additionally SNAPS paint/hit boxes
 *   to device pixels, so probes within ~1 px of a fractional/padding-box
 *   edge can miss inside the CSS box — the coverage proof therefore probes
 *   a 36×36 CORE at center ±18 (see below).
 * - A control FAILS if its hit box is under 44×44 CSS px (painted box or
 *   strap region short — the strap removed = red), or if any core probe
 *   resolves something else — a neighbor's hit box encroaching, a covering
 *   overlay, or a clipped scrollport all redden here.
 */
async function auditControl(
  el: Element,
  name: string,
  opts: { exempt?: boolean } = {},
): Promise<AuditRow> {
  (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
  await raf();
  const r = el.getBoundingClientRect();
  const painted = `${Math.round(r.width)}×${Math.round(r.height)}`;
  if (r.width === 0 || r.height === 0) {
    return { name, painted: "not rendered", hit: "—", verdict: "EXEMPT" };
  }
  if (opts.exempt) {
    return { name, painted, hit: "—", verdict: "EXEMPT" };
  }
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // (1) contiguous hit region on the center cross (1 px lattice).
  let left = cx;
  let right = cx;
  let top = cy;
  let bottom = cy;
  const guard = 400;
  while (left > Math.max(0, cx - guard) && hitBelongs(el, left - 1, cy)) left--;
  while (
    right < Math.min(innerWidth, cx + guard) &&
    hitBelongs(el, right + 1, cy)
  )
    right++;
  while (top > Math.max(0, cy - guard) && hitBelongs(el, cx, top - 1)) top--;
  while (
    bottom < Math.min(innerHeight, cy + guard) &&
    hitBelongs(el, cx, bottom + 1)
  )
    bottom++;
  // (2) the hit box = painted box ∪ scan region (edge-corrected ±0.5).
  const L = Math.min(r.left, left - 0.5);
  const R = Math.max(r.right, right + 0.5);
  const T = Math.min(r.top, top - 0.5);
  const B = Math.max(r.bottom, bottom + 0.5);
  const hitW = R - L;
  const hitH = B - T;
  if (hitW < 44 || hitH < 44) {
    throw new Error(
      `[${name}] hit box ${hitW.toFixed(1)}×${hitH.toFixed(1)} < 44×44 (painted ${painted}; painted box ${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}; scan ${left.toFixed(1)}..${right.toFixed(1)} × ${top.toFixed(1)}..${bottom.toFixed(1)})`,
    );
  }
  // (3) coverage: a 36×36 CORE box (center ±18 — clear of every
  // fractional/snap/padding-box boundary; the ≥44 EXTENT is proven by the
  // scan in (2)) must resolve to the control at its corners + cross — a
  // neighbor encroaching more than 4 px into the target, a covering
  // overlay, or a scrollport clipping the box all redden here (shallower
  // encroachments shrink the NEIGHBOR's own audited region instead — the
  // plan's "adjacent hit boxes must not overlap" law enforced from both
  // sides).
  const probes: Array<[number, number]> = [
    [cx - 18, cy - 18],
    [cx + 18, cy - 18],
    [cx - 18, cy + 18],
    [cx + 18, cy + 18],
    [cx, cy - 18],
    [cx, cy + 18],
    [cx - 18, cy],
    [cx + 18, cy],
    [cx, cy],
  ];
  for (const [x, y] of probes) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
      throw new Error(
        `[${name}] hit box leaves the viewport at (${x.toFixed(1)}, ${y.toFixed(1)}) — control not fully measurable`,
      );
    }
    if (!hitBelongs(el, x, y)) {
      const stolen = document.elementFromPoint(x, y);
      throw new Error(
        `[${name}] hit-box probe (${x.toFixed(1)}, ${y.toFixed(1)}) resolves ${stolen ? describeHit(stolen) : "nothing"} — under 44, overlapped by a neighbor, or clipped`,
      );
    }
  }
  return {
    name,
    painted,
    hit: `${Math.round(hitW)}×${Math.round(hitH)}`,
    verdict: "PASS",
  };
}

/** Audit every element matching `sel` (a scope suffix names the surface).
 * `optional` lets transient rows (e.g. the saved-projects list, empty on a
 * wiped origin) audit when present instead of failing on absence. */
async function auditSelector(
  sel: string,
  scope: string,
  rows: AuditRow[],
  opts: { exempt?: boolean; limit?: number; optional?: boolean } = {},
): Promise<void> {
  const els = Array.from(document.querySelectorAll(sel));
  if (els.length === 0) {
    if (opts.optional) return;
    throw new Error(`inventory selector matches nothing: ${sel}`);
  }
  const list = opts.limit ? els.slice(0, opts.limit) : els;
  for (let i = 0; i < list.length; i++) {
    rows.push(await auditControl(list[i]!, `${scope} #${i}`, opts));
  }
}

/**
 * MB-3 fix (verifier m2-3) — FULL hit-box reachability inside the strip's
 * overflow clip, at the true boundary. elementFromPoint is the truth: a
 * control whose painted box pokes past `.lane-grid-scroll`'s clip is only
 * PARTIALLY usable when the strip cannot scroll (the out-of-flow overlay
 * contributes no scrollWidth — the verifier's 38 px-of-44 SET finding on
 * 2-digit-readout rows). For every euclid overlay control, on every row:
 *   (a) the painted box lives inside the scrollport's clip box;
 *   (b) elementsFromPoint at the box's 4 corners + 4 edge midpoints (1 px
 *       inset — the true boundary, where a clip cuts) resolves to the
 *       control or a descendant — nothing covers it, nothing clips it;
 *   (c) the overlay's WIDTH LAW clamps against the SCROLLPORT, not the
 *       viewport: resolved max-width + the overlay's left offset within the
 *       scroll ≤ clientWidth. The old `100vw` law passed (a)+(b) only in a
 *       harness whose strip runs a few px wider than the phone page (the
 *       committed gate's miss) — (c) pins the law itself.
 */
async function auditOverlayReachability(): Promise<void> {
  const strip = document.querySelector(".lane-grid-scroll") as HTMLElement;
  if (!strip)
    throw new Error("inventory selector matches nothing: .lane-grid-scroll");
  const fills = Array.from(document.querySelectorAll(".row-fill.is-overlay"));
  if (fills.length === 0)
    throw new Error("inventory selector matches nothing: .row-fill.is-overlay");
  const chromeEl = document.querySelector(
    ".phone-chrome",
  ) as HTMLElement | null;
  // MB-6 hardening (the SNARE load flake) — TWO measured mechanisms, both
  // fixed measurement-side (assertions byte-identical):
  //
  // (1) STALE CLIP under page scroll: the clip box was captured ONCE for
  //     the whole walk while each fill's `scrollIntoView({block:"center"})`
  //     scrolls the PAGE (delta measured up to 202 px) — the per-fill
  //     boxes were then compared against a clip from a different scroll
  //     position (the reproduced failure: SNARE btn y[376..420] vs a stale
  //     clip starting at y=397 — an artifact, the box was inside the
  //     strip's actual clip at y[269..897] all along). The clip is now
  //     re-captured FRESH after each fill's scroll+nudge settle, so the
  //     containment law compares boxes and clip from the same layout
  //     instant.
  // (2) CLASSIC-SCROLLBAR WIDTH THEFT (the same measured mechanism as
  //     MB-1's 360 chrome flake): headed desktop Chromium may render a
  //     15 px classic scrollbar on the scrolling tester page, laying the
  //     phone out at 375/345 instead of the committed 390/360 — past the
  //     euclid overlay's 355 px container-query boundary, two-digit
  //     readout rows wrap to the two-line chassis mid-audit. The audit
  //     pins `scrollbar-width: none` (the Android-Chrome overlay-scrollbar
  //     layout — the committed phone target) for its duration, so the
  //     audited geometry is the committed width's geometry.
  const overlaySignature = (): number => {
    let sum = 0;
    for (const el of [
      ...fills,
      ...fills.flatMap((f) => Array.from(f.querySelectorAll("button"))),
    ]) {
      const r = el.getBoundingClientRect();
      sum += Math.round(r.left + r.top + r.width + r.height);
    }
    return sum;
  };
  await settleValue(overlaySignature);
  for (const fill of fills) {
    const row =
      fill.closest(".grid-row")?.querySelector(".row-label")?.textContent ??
      "?";
    // The strip scrolls with the page under the STICKY chrome — bring the
    // row into the open before probing (the horizontal clip law is
    // scroll-independent; vertical occlusion is the page's own scroll
    // state, not a target-law violation). "Center" can still park the
    // chassis's top line under the pinned rail — nudge it below.
    (fill as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
    await raf();
    const chromeBottom = chromeEl ? chromeEl.getBoundingClientRect().bottom : 0;
    if (fill.getBoundingClientRect().top < chromeBottom + 4) {
      window.scrollBy(0, fill.getBoundingClientRect().top - chromeBottom - 8);
      await raf();
    }
    // MB-6 (mechanism 1): the clip is captured FRESH here — after this
    // fill's scroll+nudge settle — so boxes and clip come from the same
    // layout instant (a page scroll between capture and compare was the
    // reproduced flake).
    const clip = strip.getBoundingClientRect();
    // (c) the width law: max-width + left offset inside the scroll content.
    const fr = fill.getBoundingClientRect();
    const leftInScroll = fr.left - clip.left + strip.scrollLeft;
    const maxW = Number.parseFloat(getComputedStyle(fill).maxWidth);
    if (
      !Number.isFinite(maxW) ||
      maxW + leftInScroll > strip.clientWidth + 0.5
    ) {
      throw new Error(
        `[euclid overlay · ${row}] width law busts the scrollport: max-width ${maxW}px + left ${leftInScroll.toFixed(1)}px > clientWidth ${strip.clientWidth}px (the clamp must derive from the strip's clip, not 100vw)`,
      );
    }
    // (a)+(b) every control box: inside the clip, and owning its boundary.
    for (const btn of Array.from(fill.querySelectorAll("button"))) {
      const r = btn.getBoundingClientRect();
      const label = btn.getAttribute("aria-label") ?? btn.className;
      if (
        r.left < clip.left - 0.5 ||
        r.right > clip.right + 0.5 ||
        r.top < clip.top - 0.5 ||
        r.bottom > clip.bottom + 0.5
      ) {
        throw new Error(
          `[euclid ${label} · ${row}] painted box x[${r.left.toFixed(1)},${r.right.toFixed(1)}] y[${r.top.toFixed(1)},${r.bottom.toFixed(1)}] leaves the scrollport clip x[${clip.left.toFixed(1)},${clip.right.toFixed(1)}] y[${clip.top.toFixed(1)},${clip.bottom.toFixed(1)}] — the hit box cannot be fully reached`,
        );
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const probes: Array<[number, number]> = [
        [r.left + 1, r.top + 1],
        [r.right - 1, r.top + 1],
        [r.left + 1, r.bottom - 1],
        [r.right - 1, r.bottom - 1],
        [cx, r.top + 1],
        [cx, r.bottom - 1],
        [r.left + 1, cy],
        [r.right - 1, cy],
      ];
      for (const [x, y] of probes) {
        if (!hitBelongs(btn, x, y)) {
          const stolen = document.elementFromPoint(x, y);
          throw new Error(
            `[euclid ${label} · ${row}] boundary probe (${x.toFixed(1)},${y.toFixed(1)}) resolves ${stolen ? describeHit(stolen) : "nothing"} — the box's edge is clipped or covered, not fully reachable`,
          );
        }
      }
    }
  }
}

function logTable(rows: AuditRow[], where: string): void {
  console.log(
    `[MB-3 target audit · ${where}]\n` +
      rows
        .map(
          (r) =>
            `  ${r.verdict.padEnd(6)} painted ${r.painted.padStart(9)}  hit ${r.hit.padStart(9)}  ${r.name}`,
        )
        .join("\n"),
  );
}

describe("MB-3 phone target-size audit (m2: ≥44×44 hit boxes + focus/rotation)", () => {
  it(
    "390×844 + 360×800 (+430×932 projects spot-check): every primary control's hit box ≥44×44, no neighbor overlap; chrome budget; focus order; rotation coherence",
    { timeout: 240_000 },
    async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      let bootDb: ProjectDb | null = null;
      let snapshotRows: Awaited<ReturnType<ProjectDb["allRecords"]>> = [];
      try {
        await page.viewport(390, 844);
        // MB-6 hardening (mechanism 2, see auditOverlayReachability): pin
        // the Android-Chrome OVERLAY-scrollbar layout for the audit — a
        // classic 15 px scrollbar on the scrolling tester page would lay
        // the phone out at 375/345 instead of the committed 390/360 (past
        // the euclid 355 px container-query boundary and into the booth's
        // extra-wrap regime). The tester page still scrolls; restored in
        // the finally below.
        document.documentElement.style.scrollbarWidth = "none";
        // MB-3 fix (verifier m2-1): every section now PROVES its viewport —
        // the committed "360×800" half ran at 390 and logged 390 numbers.
        expect(window.innerWidth, "the audit viewport is truly 390×844").toBe(
          390,
        );
        await waitFor(() => getAutosaveController() !== null, 10_000, "boot");
        bootDb = await openRawProjectDb("bitbounce");
        snapshotRows = await bootDb.allRecords();
        // i6 critique A1 teeth: a REAL-length title joins the walk. The
        // committed gates seeded short names only, so the nowrap name's
        // intrinsic min-content (the full unwrapped title — min-width: 0 on
        // .projects-item is a floor, not a ceiling) blew the popover past
        // the phone viewport unnoticed (this exact row pre-fix: 739.7px
        // popover, left edge −357.7 at 390). Seeded most-recent so the walk
        // audits it first; popoverFits's edges-inside law answers for it in
        // every state; the finally's restore deletes it (not in ids).
        await saveProject(bootDb, "i6-critique-long-name", {
          ...createDemoProject(),
          name: "A Very Long Song Name That Definitely Exceeds Forty Eight Codepoints",
        });
        // Deterministic full surfaces: the demo carries FX devices on bass,
        // chain tiles on every lane, and six drum rows with fill rails.
        loadDocument(createDemoProject());
        selectLane("drums");
        await waitFor(
          () =>
            document
              .querySelector('.lane-floor[data-lane="drums"] [role="grid"]')
              ?.getAttribute("aria-label") === "DRUMS grid · EDITING",
          4000,
          "drums stage editable",
        );
        const $ = <T extends Element>(sel: string): T => {
          const el = document.querySelector<T>(sel);
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

        // --- i6 S-4: the shared PROJECTS popover at phone width ------------
        // The popover's management states are PHONE LAWS (audit §5): every
        // new control (per-row RENAME/DELETE keys, the CONFIRM DELETE state,
        // the rename editor input) is measured by the same elementFromPoint
        // law as the rest of the chrome, and the popover itself must FIT the
        // viewport in EVERY state — the confirm row and the editor REPLACE
        // the row's content, so a special state may never WIDEN the popover
        // (the 232 px min-width anchor; m1's no-hscroll pin stays byte-green
        // because the popover is an absolute overlay with zero layout width).
        const popoverFits = (
          state: string,
          vw2: number,
          vh2: number,
        ): number => {
          const pop = document.querySelector(".projects-pop");
          if (!pop)
            throw new Error(`projects popover missing in ${state} state`);
          const r = pop.getBoundingClientRect();
          console.log(
            `[S-4 popover fit · ${state} @${vw2}×${vh2}] ${r.width.toFixed(1)}×${r.height.toFixed(1)} x[${r.left.toFixed(1)},${r.right.toFixed(1)}] y[${r.top.toFixed(1)},${r.bottom.toFixed(1)}]`,
          );
          expect(
            r.left,
            `${state}-state popover left edge inside the viewport @${vw2}`,
          ).toBeGreaterThanOrEqual(-0.5);
          expect(
            r.right,
            `${state}-state popover right edge inside the viewport @${vw2}`,
          ).toBeLessThanOrEqual(vw2 + 0.5);
          expect(
            r.top,
            `${state}-state popover top edge inside the viewport @${vw2}`,
          ).toBeGreaterThanOrEqual(-0.5);
          expect(
            r.bottom,
            `${state}-state popover bottom edge inside the viewport @${vw2}`,
          ).toBeLessThanOrEqual(vh2 + 0.5);
          return r.width;
        };
        const phoneProjectsWalk = async (
          walkRows: AuditRow[],
          vw2: number,
          vh2: number,
        ): Promise<void> => {
          click('[data-help="projects.open"]');
          await waitFor(
            () => document.querySelector(".projects-pop") !== null,
            2000,
            "projects popover open",
          );
          await raf();
          const normalW = popoverFits("normal", vw2, vh2);
          // The saved-list laws need rows; a wiped origin audits the actions
          // + the fit law only (the :256-258 `optional` rationale).
          const hasRows =
            document.querySelector(".projects-list .projects-item") !== null;
          if (hasRows) {
            // A1 tooth presence: the seeded long-titled row is in THIS walk
            // (most-recent-first puts it first). The paint may ellipsize it;
            // textContent keeps the full 68-codepoint title.
            const longRow = document.querySelector(
              'li[data-id="i6-critique-long-name"] .projects-name',
            ) as HTMLElement | null;
            expect(
              longRow?.textContent ?? "",
              "the long-title tooth row is present in the walk",
            ).toContain("Codepoints");
            await auditSelector(
              ".projects-list .projects-item",
              "projects row",
              walkRows,
              {
                limit: 2,
                optional: true,
              },
            );
            await auditSelector(".projects-x", "projects row key", walkRows, {
              limit: 2,
              optional: true,
            });
            // CONFIRM DELETE state: the row's content is replaced by the
            // danger key — same popover width, confirm row fully reachable.
            click(".projects-del");
            await waitFor(
              () => document.querySelector(".projects-confirm") !== null,
              2000,
              "projects confirm state",
            );
            await raf();
            const confirmW = popoverFits("confirm", vw2, vh2);
            expect(
              confirmW,
              "the confirm state never widens the popover (§5.3 replace law)",
            ).toBeLessThanOrEqual(normalW + 0.5);
            walkRows.push(
              await auditControl(
                $(".projects-confirm"),
                "projects CONFIRM DELETE",
              ),
            );
            // Stand the confirm down through its own §3.1 Esc law — on a
            // single-row origin the confirming row's RENAME key is REPLACED
            // (the replace law working as designed), so the editor state
            // needs the row's normal controls back first.
            $(".projects-confirm").dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
            await waitFor(
              () => document.querySelector(".projects-confirm") === null,
              2000,
              "projects confirm stood down",
            );
            await raf();
            // Rename editor state: the input REPLACES the name display; its
            // 9 probe points also prove nothing — sticky chrome included —
            // covers the focused field (the drawer precedent, §5.4).
            click(".projects-ren");
            await waitFor(
              () => document.querySelector(".projects-edit") !== null,
              2000,
              "projects rename editor",
            );
            await raf();
            const editW = popoverFits("editor", vw2, vh2);
            expect(
              editW,
              "the editor state never widens the popover (§5.3 replace law)",
            ).toBeLessThanOrEqual(normalW + 0.5);
            walkRows.push(
              await auditControl($(".projects-edit"), "projects rename editor"),
            );
            // The editor's own Escape cancels the edit only (the §2.5 gated
            // close) — dispatched AT the input so the cancel never depends
            // on focus timing; the popover stays open for the walk's close.
            $(".projects-edit").dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
            await waitFor(
              () => document.querySelector(".projects-edit") === null,
              2000,
              "projects rename editor cancelled",
            );
          }
          await auditSelector(".projects-action", "projects action", walkRows);
          keyAt("Escape");
          await waitFor(
            () => document.querySelector(".projects-pop") === null,
            2000,
            "projects popover closed",
          );
        };

        // --- steady-state chrome budget at the true 390 --------------------
        // (The FIRST-RUN twin of this law is MB-1's built-app gate — a wiped
        // IDB, the PX-1 demo boot. The tempo input's px pin makes first-run
        // and steady lay out the SAME booth, so both gates now agree.)
        // MB-6 hardening: measured at FONT/SETTLED truth (see fontsSettled —
        // the same provisional-metrics wrap race as MB-1's documented load
        // flake); the <50% law is unchanged.
        await fontsSettled();
        const chrome390H = await settleValue(
          () => $(".phone-chrome").getBoundingClientRect().height,
        );
        console.log(
          `[MB-3 chrome budget · 390×844 steady] chrome ${chrome390H.toFixed(1)} px (${((chrome390H / 844) * 100).toFixed(1)}% of viewport)`,
        );
        expect(
          chrome390H,
          "390×844 steady chrome under half the viewport",
        ).toBeLessThan(844 / 2);

        // ================= 390×844 — the full inventory =================
        const rows: AuditRow[] = [];
        // --- pinned chrome: booth (compact painted + hit straps) ---------
        rows.push(await auditControl($(".booth-btn-play"), "booth PLAY"));
        // M-4 (iteration 4): the option tools (LOOP … MASTER) live in the
        // collapsible options drawer at phone — open it for their audit,
        // close it before the stage-surface audits (the open backdrop
        // intercepts stage taps by design).
        const openOptionsDrawer = async () => {
          click('[data-help="phone.options"]');
          await waitFor(
            () => document.querySelector(".phone-options-drawer") !== null,
            2000,
            "options drawer open",
          );
        };
        const closeOptionsDrawer = async () => {
          click('[data-help="phone.options"]');
          await waitFor(
            () => document.querySelector(".phone-options-drawer") === null,
            2000,
            "options drawer closed",
          );
        };
        await openOptionsDrawer();
        rows.push(await auditControl($(".booth-btn-loop"), "booth LOOP"));
        rows.push(await auditControl($(".booth-btn-metro"), "booth METRONOME"));
        // M-2 (iteration 4): the KEYS ? / INFO ? corner buttons do not
        // render at the phone stage (render guard, not CSS) — they are
        // absent from the DOM and the a11y tree. Desktop keeps them.
        expect(
          document.querySelector(".booth-btn-help"),
          "M-2: no KEYS ? button in the phone DOM",
        ).toBeNull();
        expect(
          document.querySelector(".booth-btn-info"),
          "M-2: no INFO ? button in the phone DOM",
        ).toBeNull();
        await auditSelector(
          ".phone-chrome .booth-step-btn",
          "booth tempo stepper",
          rows,
        );
        rows.push(
          await auditControl(
            $(".scale-chip-booth"),
            "booth scale chip (strap)",
          ),
        );
        await auditSelector(".phone-chrome .booth-range", "booth slider", rows);
        await closeOptionsDrawer(); // stage surfaces below must not sit under the backdrop
        // --- pinned chrome: switcher + the SONG page key -----------------
        await auditSelector(".lane-switch-tab", "switcher tab", rows);
        rows.push(await auditControl($(WORKSPACE_TOGGLE), "SONG page key"));
        // 2026-09-11: the chain rail lives on the SONG page (the EDIT page
        // dropped the condensed row) — audit it there, then return to EDIT.
        showPhonePage("song");
        await waitFor(
          () => document.querySelector(".rail-tile") !== null,
          2000,
          "SONG page rail",
        );
        await auditSelector(".rail-tile", "rail tile", rows, { limit: 3 });
        rows.push(await auditControl($(".rail-append"), "rail append +"));
        rows.push(
          await auditControl($(".rail-tools-trigger"), "rail PAT trigger"),
        );
        showPhonePage("edit");
        await waitFor(
          () => document.querySelector(".lane-switch-tab") !== null,
          2000,
          "back on the EDIT page",
        );
        // --- scrolling stage: the lane strip -----------------------------
        await auditSelector(
          '.lane-floor [aria-label^="Previous kit"], .lane-floor [aria-label^="Previous preset"]',
          "strip preset −",
          rows,
        );
        await auditSelector(
          '.lane-floor [aria-label^="Next kit"], .lane-floor [aria-label^="Next preset"]',
          "strip preset +",
          rows,
        );
        rows.push(
          await auditControl(
            $('.lane-floor [aria-label="DRUMS volume"]'),
            "strip VOLUME slider",
          ),
        );
        rows.push(
          await auditControl(
            $('.lane-floor [aria-label="Mute DRUMS"]'),
            "strip MUTE",
          ),
        );
        rows.push(
          await auditControl(
            $('.lane-floor [aria-label="Solo DRUMS"]'),
            "strip SOLO",
          ),
        );
        rows.push(
          await auditControl(
            $('[data-help="lane.drums.scale"]'),
            "strip scale chip",
          ),
        );
        rows.push(
          await auditControl(
            $('[aria-label="Shorter gate for DRUMS"]'),
            "strip gate −",
          ),
        );
        rows.push(
          await auditControl(
            $('[aria-label="Longer gate for DRUMS"]'),
            "strip gate +",
          ),
        );
        rows.push(
          await auditControl($('[data-help="lane.drums.fx"]'), "strip FX"),
        );
        rows.push(
          await auditControl($(".head-fill-toggle"), "strip FILL toggle"),
        );
        // --- exempt recorded: data targets + gesture affordances ---------
        rows.push(
          await auditControl(
            $(
              '.lane-floor[data-lane="drums"] .cell[data-row="0"][data-step="0"]',
            ),
            "grid cell (DATA TARGET — gesture laws)",
            { exempt: true },
          ),
        );
        await openOptionsDrawer(); // the tempo input lives in the drawer (M-4)
        rows.push(
          await auditControl(
            $(".booth-led-input"),
            "tempo input (EXEMPT: equivalent steppers ≥44)",
            { exempt: true },
          ),
        );
        // MB-3 fix tooth-law (verifier m2-2): the input's BOX must be
        // font-metric-independent. `width: 5ch` resolved against whichever
        // mono face was available at first layout (measured 66px deployed /
        // 55px fallback-metrics) and — the LED face ships font-display:
        // optional, which never swaps after first paint — a cold first-run
        // kept the wider face and flipped the phone booth's wrap count
        // (405px chrome at true 360×800, busting MB-1's hard <50% gate).
        // The px pin makes the box identical under any face.
        {
          const pin = $(".booth-led-input");
          const pinW = pin.getBoundingClientRect().width;
          const clone = pin.cloneNode() as HTMLElement;
          clone.style.visibility = "hidden";
          clone.style.position = "absolute";
          pin.after(clone); // same scope (the phone-chrome pin applies in-place)
          clone.style.fontFamily = "ui-monospace, monospace";
          const cloneW = clone.getBoundingClientRect().width;
          clone.remove();
          expect(
            cloneW,
            "tempo input box must be font-metric-independent (5ch reflowed the first-run phone booth past the chrome gate)",
          ).toBe(pinW);
        }
        await closeOptionsDrawer();
        rows.push(
          await auditControl(
            $('[data-help="save.status"]'),
            "save indicator (EXEMPT: non-operable status)",
            { exempt: true },
          ),
        );

        // --- euclid overlay (reveal → steppers + SET) --------------------
        click(".head-fill-toggle");
        await new Promise((r) => setTimeout(r, 350));
        await auditSelector(
          ".row-fill.is-overlay .head-step-btn",
          "euclid stepper",
          rows,
        );
        rows.push(await auditControl($(".row-fill-apply"), "euclid SET"));
        // MB-3 fix (verifier m2-3): every overlay control box FULLY
        // reachable at the scrollport's clip boundary (all six rows).
        await auditOverlayReachability();
        click(".head-fill-toggle");
        await new Promise((r) => setTimeout(r, 350));

        // --- PAT menu (on the SONG page — EDIT carries no rail) ----------
        showPhonePage("song");
        await waitFor(
          () => document.querySelector(".rail-tools-trigger") !== null,
          2000,
          "SONG page rail (PAT)",
        );
        click(".rail-tools-trigger");
        await waitFor(
          () => document.querySelector(".rail-tools-menu") !== null,
          2000,
          "PAT menu open",
        );
        await auditSelector(
          ".rail-tools-menu .rail-tool",
          "PAT menu item",
          rows,
        );
        keyAt("Escape");
        await waitFor(
          () => document.querySelector(".rail-tools-menu") === null,
          2000,
          "PAT menu closed",
        );
        showPhonePage("edit");
        await waitFor(
          () => document.querySelector(".lane-switch-tab") !== null,
          2000,
          "back on the EDIT page (PAT)",
        );

        // --- lane scale popover -------------------------------------------
        click('[data-help="lane.drums.scale"]');
        await waitFor(
          () => document.querySelector(".scale-pop") !== null,
          2000,
          "lane scale popover open",
        );
        await auditSelector(".scale-pop-root", "scale root", rows, {
          limit: 2,
        });
        rows.push(await auditControl($(".scale-pop-mode"), "scale mode"));
        rows.push(await auditControl($(".scale-pop-commit"), "scale commit"));
        rows.push(await auditControl($(".scale-pop-detach"), "scale detach"));
        keyAt("Escape");
        await waitFor(
          () => document.querySelector(".scale-pop") === null,
          2000,
          "lane scale popover closed",
        );

        // --- booth scale popover ------------------------------------------
        // M-4 (iteration 4): at phone width the booth scale chip lives in
        // the options drawer — open it (its controls are audited by the
        // M-4 gate; here the popover is the target under audit).
        click('[data-help="phone.options"]');
        await waitFor(
          () => document.querySelector(".phone-options-drawer") !== null,
          2000,
          "options drawer open",
        );
        click('[data-help="booth.scale"]');
        await waitFor(
          () => document.querySelector(".scale-pop") !== null,
          2000,
          "booth scale popover open",
        );
        rows.push(await auditControl($(".scale-pop-root"), "booth scale root"));
        keyAt("Escape");
        await waitFor(
          () => document.querySelector(".scale-pop") === null,
          2000,
          "booth scale popover closed",
        );
        keyAt("Escape"); // closes the drawer beneath it
        await waitFor(
          () => document.querySelector(".phone-options-drawer") === null,
          2000,
          "options drawer closed",
        );

        // --- FX console (bass carries demo devices) ------------------------
        selectLane("bass");
        await waitFor(
          () =>
            document
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              // RC-1 journey delta: windowed names append the ROWS range.
              ?.getAttribute("aria-label")
              ?.startsWith("BASS grid · EDITING") === true,
          2000,
          "bass stage editable",
        );
        // --- M-7 (iteration 4): the register-window shift row (pitched
        // lanes only). i7 N-2 flip: bounds derive from the MOUNTED
        // pattern's manifest, so the row renders only where the mounted
        // manifest EXCEEDS one octave — demo bass-1 (7 rows) is a
        // full-manifest pane with no legal shift, and the row honestly
        // hides on it (the old lane-tallest bounds rendered a dead row
        // there). Audit on LEAD (the demo's tallest manifest, 15 rows —
        // always windowed). All four stepper buttons are painted-44
        // targets (the lane-switch-tab law: no strap, four share the row);
        // the readout chip is a non-operable aria-live status (recorded
        // exempt, but its painted box is 44 tall too — it must not dip
        // under the row's target line).
        selectLane("lead");
        await waitFor(
          () =>
            document
              .querySelector('.lane-floor[data-lane="lead"] [role="grid"]')
              ?.getAttribute("aria-label")
              ?.startsWith("LEAD grid · EDITING") === true,
          2000,
          "lead stage editable (register row audit)",
        );
        await auditSelector(".register-shift-btn", "register shift", rows);
        rows.push(
          await auditControl(
            $(".register-window-readout"),
            "register readout (EXEMPT: aria-live status, non-operable)",
            { exempt: true },
          ),
        );
        selectLane("bass");
        await waitFor(
          () =>
            document
              .querySelector('.lane-floor[data-lane="bass"] [role="grid"]')
              // RC-1 journey delta: windowed names append the ROWS range.
              ?.getAttribute("aria-label")
              ?.startsWith("BASS grid · EDITING") === true,
          2000,
          "bass stage editable",
        );
        click('[data-help="lane.bass.fx"]');
        await waitFor(
          () => document.querySelector(".fx-strip") !== null,
          2000,
          "fx console open",
        );
        rows.push(await auditControl($(".lane-fx-close"), "fx CLOSE"));
        await auditSelector(".fx-strip .fx-mod-btn", "fx module button", rows);
        await auditSelector(
          ".fx-strip .fx-param-slider",
          "fx param slider",
          rows,
          {
            limit: 2,
          },
        );
        rows.push(await auditControl($(".fx-add-btn"), "fx + ADD FX"));
        click('[data-help="fx.add"]');
        await waitFor(
          () => document.querySelector(".fx-add-menu") !== null,
          2000,
          "fx add menu open",
        );
        await auditSelector(".fx-add-item", "fx add item", rows);
        keyAt("Escape");
        await waitFor(
          () => document.querySelector(".fx-add-menu") === null,
          2000,
          "fx add menu closed",
        );
        click('[data-help="lane.bass.fx"]'); // close the console

        // --- projects popover ----------------------------------------------
        // i6 S-4: the walk grew into phoneProjectsWalk — the new management
        // controls + the fit/never-widen laws audit with the rows (optional
        // on a wiped origin), the actions always audit.
        await phoneProjectsWalk(rows, 390, 844);

        // --- failure chrome: a persistent error toast ----------------------
        clearToasts();
        showError("AUDIT TOAST", {
          action: { label: "ACTION", run: () => {} },
        });
        await waitFor(
          () => document.querySelector(".toast-error") !== null,
          2000,
          "error toast mounted",
        );
        rows.push(await auditControl($(".toast-action"), "toast action"));
        rows.push(await auditControl($(".toast-dismiss"), "toast dismiss"));
        clearToasts();

        logTable(rows, "390×844");

        // ================= focus order (m2 small-surface half) ============
        const tabbables = Array.from(
          document.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, [tabindex]",
          ),
        ).filter(
          (el) =>
            el.isConnected &&
            el.tabIndex !== -1 &&
            !el.disabled &&
            !el.closest('[aria-hidden="true"]') &&
            el.getClientRects().length > 0,
        );
        // M-4 (iteration 4): the phone surface's steady tabbable set
        // SHRANK — the option tools live in the collapsed drawer (zero
        // DOM → zero tab stops, the Show law; the pre-M-4 chrome alone
        // cleared >20). The floor keeps the small-surface walk honest,
        // and opening the drawer must add its tools back as tab stops.
        expect(tabbables.length).toBeGreaterThan(15);
        await openOptionsDrawer();
        const openTabbables = Array.from(
          document.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, [tabindex]",
          ),
        ).filter(
          (el) =>
            el.isConnected &&
            el.tabIndex !== -1 &&
            !el.disabled &&
            !el.closest('[aria-hidden="true"]') &&
            el.getClientRects().length > 0,
        );
        expect(
          openTabbables.length - tabbables.length,
          "the open drawer contributes its tools as tab stops",
        ).toBeGreaterThanOrEqual(7);
        await closeOptionsDrawer();
        // Earlier hit audits scroll controls into view. Return to the top
        // before comparing document order with the sticky header's geometry.
        window.scrollTo(0, 0);
        await raf();
        for (const el of tabbables) {
          expect(
            el.tabIndex,
            `${describeHit(el)} — positive tabindex reorders focus`,
          ).toBeLessThanOrEqual(0);
        }
        // Tab order = visual reading order: across wrapped rows
        // top-to-bottom; within a row (vertically overlapping controls of
        // different heights, e.g. the short save indicator beside PROJECTS)
        // left-to-right.
        for (let i = 1; i < tabbables.length; i++) {
          const a = tabbables[i - 1]!;
          const b = tabbables[i]!;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const sameRow = rb.top < ra.bottom && ra.top < rb.bottom;
          const what = `${describeHit(a)} → ${describeHit(b)}`;
          if (sameRow) {
            expect(
              rb.left,
              `${what} breaks left-to-right order`,
            ).toBeGreaterThanOrEqual(ra.left - 2);
          } else {
            expect(
              rb.top,
              `${what} breaks top-to-bottom order`,
            ).toBeGreaterThanOrEqual(ra.top - 2);
          }
        }
        // The coarse sequence: booth → switcher → rail → strip → grid (the
        // chrome pins first, the scrolling stage follows — a11y §2 at phone).
        const idxIn = (pred: (el: HTMLElement) => boolean): number =>
          tabbables.findIndex(pred);
        const boothIdx = idxIn((el) => el.closest(".booth") !== null);
        const switcherIdx = idxIn(
          (el) => el.closest(".lane-switcher") !== null,
        );
        const railIdx = idxIn((el) => el.closest(".rail") !== null);
        const stripIdx = idxIn((el) => el.closest(".lane-head-strip") !== null);
        const gridIdx = idxIn((el) => el.classList.contains("cell"));
        for (const [name, idx] of [
          ["booth", boothIdx],
          ["switcher", switcherIdx],
          ["strip", stripIdx],
          ["grid cell", gridIdx],
        ] as const) {
          expect(idx, `a ${name} tabbable must exist`).toBeGreaterThanOrEqual(
            0,
          );
        }
        expect(boothIdx).toBeLessThan(switcherIdx);
        expect(switcherIdx).toBeLessThan(stripIdx);
        expect(stripIdx).toBeLessThan(gridIdx);
        // 2026-09-11: no rail on the EDIT page — the SONG key rides the
        // pinned transport row, and the chain's own tab order is walked on
        // the SONG page (help-coverage's phone pass).
        expect(railIdx, "no rail tabbable on the phone EDIT page").toBe(-1);

        // ================= rotation coherence ==============================
        const cell = $(
          '.lane-floor[data-lane="bass"] .cell[tabindex="0"]',
        ) as HTMLElement;
        cell.focus();
        await page.viewport(844, 390); // rotated phone keeps the phone law
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "phone",
          3000,
          "rotated phone stays phone",
        );
        expect(
          document.activeElement &&
            document.activeElement !== document.body &&
            document.querySelector(".app")!.contains(document.activeElement),
          "rotation never strands focus on <body>",
        ).toBe(true);
        await page.viewport(390, 844);
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "phone",
          3000,
          "back to portrait phone",
        );
        // Phone → tablet (the keyed quadrant remount — MB-1's recorded seam:
        // "the keyed remount on lane switch/rotation is the surface MB-4's
        // focus-carry gates own"): MB-3 asserts the honest current law —
        // focus never rests inside a DETACHED surface (the phone stage's
        // nodes unmount; focus falls to <body>, the stage is fully operable
        // from there). The cross-stage focus CARRY itself is MB-4's gate.
        const stripBtn = $(
          '.lane-floor[data-lane="bass"] [aria-label^="Next preset"]',
        ) as HTMLElement;
        stripBtn.focus();
        await page.viewport(768, 1024);
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "tablet",
          3000,
          "tablet after rotation",
        );
        const active = document.activeElement;
        expect(
          active === null ||
            active === document.body ||
            document.querySelector(".app")!.contains(active),
          "focus never rests inside a detached surface after the remount",
        ).toBe(true);
        await page.viewport(390, 844);

        // ================= 360×800 — the tight viewport ===================
        // MB-3 fix (verifier m2-1): this section now runs at TRUE 360×800 —
        // the committed gate resized back to 390 here and logged 390 numbers
        // under a "360×800" label (tabs painted 91px = the 390 width; the
        // "chrome 356.5px at 360×800" record was a 390 measurement).
        await page.viewport(360, 800);
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "phone",
          3000,
          "phone again at 360×800",
        );
        await raf();
        expect(
          window.innerWidth,
          "the tight audit viewport is truly 360×800",
        ).toBe(360);
        selectLane("drums"); // the FILL toggle + kit stepper need the drums lane
        await waitFor(
          () =>
            document.querySelector(".lane-floor")?.getAttribute("data-lane") ===
            "drums",
          3000,
          "drums stage at 360×800",
        );
        // Chrome budget re-pin (MB-1's hard law — the target law moved it),
        // measured at the TRUE tight viewport. Steady state here; the
        // FIRST-RUN twin is MB-1's built-app gate, and the tempo input's px
        // pin is exactly what makes the two boots agree. MB-6 hardening:
        // font/settled measurement (the provisional-metrics wrap race), the
        // <50% + ≥40% laws unchanged.
        await fontsSettled();
        const chromeH = await settleValue(
          () => $(".phone-chrome").getBoundingClientRect().height,
        );
        console.log(
          `[MB-3 chrome budget · 360×800] chrome ${chromeH.toFixed(1)} px (${((chromeH / 800) * 100).toFixed(1)}% of viewport) · usable ${(800 - chromeH).toFixed(1)} px (${(((800 - chromeH) / 800) * 100).toFixed(1)}%)`,
        );
        expect(chromeH, "chrome under half the viewport").toBeLessThan(800 / 2);
        expect(
          800 - chromeH,
          "usable stage height ≥ 40%",
        ).toBeGreaterThanOrEqual(800 * 0.4);

        // --- euclid overlay at the tight width --------------------------------
        // The clamp-bite adaptation: the ctl wraps and SET drops to its own
        // line (a full-width commit bar) — every control on every row must
        // still be FULLY reachable inside the strip's clip.
        click(".head-fill-toggle");
        await new Promise((r) => setTimeout(r, 350));
        const rows360Fill: AuditRow[] = [];
        await auditSelector(
          ".row-fill.is-overlay .head-step-btn",
          "euclid stepper (360)",
          rows360Fill,
        );
        await auditSelector(
          ".row-fill.is-overlay .row-fill-apply",
          "euclid SET (360)",
          rows360Fill,
        );
        await auditOverlayReachability();
        logTable(rows360Fill, "360×800 fill");
        click(".head-fill-toggle");
        await new Promise((r) => setTimeout(r, 350));

        // Core inventory re-audit at the tight width.
        const rows360: AuditRow[] = [];
        rows360.push(await auditControl($(".booth-btn-play"), "booth PLAY"));
        await openOptionsDrawer(); // M-4: the option tools live in the drawer
        rows360.push(await auditControl($(".booth-btn-loop"), "booth LOOP"));
        // M-2: no KEYS ? / INFO ? at the phone stage (see the 390 block).
        expect(
          document.querySelector(".booth-btn-help"),
          "M-2: no KEYS ? button in the 360 phone DOM",
        ).toBeNull();
        expect(
          document.querySelector(".booth-btn-info"),
          "M-2: no INFO ? button in the 360 phone DOM",
        ).toBeNull();
        await auditSelector(
          ".phone-chrome .booth-step-btn",
          "booth tempo stepper",
          rows360,
        );
        await auditSelector(".booth-range", "booth slider", rows360);
        await closeOptionsDrawer();
        await auditSelector(".lane-switch-tab", "switcher tab", rows360);
        rows360.push(
          await auditControl($(WORKSPACE_TOGGLE), "SONG page key (360)"),
        );
        showPhonePage("song"); // the chain rail lives there (2026-09-11)
        await waitFor(
          () => document.querySelector(".rail-tile") !== null,
          2000,
          "SONG page rail (360)",
        );
        await auditSelector(".rail-tile", "rail tile", rows360, { limit: 2 });
        rows360.push(
          await auditControl($(".rail-tools-trigger"), "PAT trigger"),
        );
        showPhonePage("edit");
        await waitFor(
          () => document.querySelector(".lane-switch-tab") !== null,
          2000,
          "back on the EDIT page (360)",
        );
        await auditSelector(
          '.lane-floor [aria-label^="Next kit"], .lane-floor [aria-label^="Next preset"]',
          "strip preset +",
          rows360,
        );
        rows360.push(
          await auditControl(
            $('.lane-floor [aria-label^="Mute"]'),
            "strip MUTE",
          ),
        );
        rows360.push(
          await auditControl(
            $('.lane-floor [data-help^="lane."][data-help$=".fx"]'),
            "strip FX",
          ),
        );
        rows360.push(await auditControl($(".head-fill-toggle"), "strip FILL"));
        // i6 S-4: the shared popover's management states at the TIGHT width
        // too — the phone law is 360 AND 390 (+430 below), not 390 alone.
        await phoneProjectsWalk(rows360, 360, 800);
        logTable(rows360, "360×800");

        // ================= 430×932 — the wide-phone spot-check (i6 S-4) ==
        // The third committed phone viewport (the M-7 CASES convention): the
        // popover walk only — the full inventory is owned by 390/360 above.
        await page.viewport(430, 932);
        await waitFor(
          () =>
            document.querySelector(".app")?.getAttribute("data-stage") ===
            "phone",
          3000,
          "phone again at 430×932",
        );
        await raf();
        const rows430: AuditRow[] = [];
        await phoneProjectsWalk(rows430, 430, 932);
        logTable(rows430, "430×932 projects");
      } finally {
        clearToasts();
        document.documentElement.style.scrollbarWidth = ""; // MB-6 pin off
        void import("../../src/engine/session")
          .then(({ getSession }) => getSession().transport.stop?.())
          .catch(() => {});
        dispose();
        host.remove();
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
    240_000,
  );
});
