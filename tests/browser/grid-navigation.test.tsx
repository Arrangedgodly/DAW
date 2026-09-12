import { afterEach, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "solid-js/web";
import LaneGrid from "../../src/components/LaneGrid";
import {
  createFreshProjectDocument,
  loadDocument,
  docStore,
} from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import type { PitchedPattern } from "../../src/document/schema";
import "../../src/styles/base.css";
import "../../src/styles/lane-header.css";
import "../../src/styles/unit.css";
import "../../src/styles/app.css";
import "../../src/styles/grid.css";
import "../../src/styles/membrane.css";

let cleanup = () => {};
afterEach(() => cleanup());
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(lane: "bass" | "drums" = "bass", bars: 4 | 8 = 4) {
  await page.viewport(390, 844);
  const doc = createFreshProjectDocument();
  doc.patterns[lane][0]!.bars = bars;
  loadDocument(doc);
  selectLane(lane);
  const host = document.createElement("div");
  host.className = "app membrane";
  document.body.append(host);
  const dispose = render(() => <LaneGrid lane={lane} />, host);
  cleanup = () => {
    dispose();
    host.remove();
  };
  await wait(150);
  const pane = host.querySelector<HTMLElement>(".lane-grid-scroll")!;
  const scroll = pane.querySelector<HTMLElement>(".grid-hscroll") ?? pane;
  const cell = () =>
    [...pane.querySelectorAll<HTMLElement>(".cell")].find((el) => {
      const r = el.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      return (
        r.left > p.left + 160 &&
        r.right < p.right &&
        r.top >= p.top &&
        r.bottom <= p.bottom
      );
    })!;
  const notes = () =>
    (docStore.getState().doc.patterns.bass[0] as PitchedPattern).notes;
  return { host, pane, scroll, cell, notes };
}

function pointer(el: HTMLElement, type: string, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: x,
      clientY: y,
    }),
  );
}

it("hold then drag scrolls a four-bar grid without adding notes", async () => {
  const { pane, scroll, cell, notes } = await setup();
  const target = cell();
  const r = target.getBoundingClientRect();
  pointer(target, "pointerdown", r.x + 5, r.y + 5);
  await wait(400);
  pointer(pane, "pointermove", r.x - 95, r.y + 5);
  pointer(pane, "pointerup", r.x - 95, r.y + 5);
  expect(notes()).toHaveLength(0);
  expect(scroll.scrollLeft).toBeGreaterThan(50);
});

it.each(["bass", "drums"] as const)(
  "hold pans an eight-bar %s grid without document writes",
  async (lane) => {
    const { pane, scroll, cell } = await setup(lane, 8);
    const before = docStore.getState().doc;
    const target = cell();
    const r = target.getBoundingClientRect();
    pointer(target, "pointerdown", r.x + 5, r.y + 5);
    await wait(400);
    pointer(pane, "pointermove", r.x - 95, r.y + 5);
    pointer(pane, "pointerup", r.x - 95, r.y + 5);
    expect(scroll.scrollLeft).toBeGreaterThan(50);
    expect(docStore.getState().doc).toBe(before);
  },
);

it("lost capture cancels a hold and releases pan feedback", async () => {
  const { pane, cell, notes } = await setup();
  const target = cell();
  const r = target.getBoundingClientRect();
  pointer(target, "pointerdown", r.x + 5, r.y + 5);
  await wait(400);
  expect(pane.dataset.panReady).toBe("true");
  const hint = pane
    .closest(".lane-floor")!
    .querySelector<HTMLElement>(".grid-pan-hint")!;
  expect(hint.textContent).toBe("Drag to scroll");
  expect(getComputedStyle(hint).clipPath).toBe("none");
  expect(hint.getBoundingClientRect().height).toBeGreaterThan(1);
  const navigation = hint.closest(".grid-navigation")!;
  expect(navigation.getBoundingClientRect().height).toBe(44);
  pointer(pane, "lostpointercapture", r.x + 5, r.y + 5);
  expect(pane.dataset.panReady).toBeUndefined();
  expect(getComputedStyle(hint).display).toBe("none");
  pointer(pane, "pointerup", r.x + 5, r.y + 5);
  expect(notes()).toHaveLength(0);
});

it("navigation reaches both ends and Scroll mode never edits", async () => {
  const { host, pane, scroll, cell, notes } = await setup();
  const back = host.querySelector<HTMLButtonElement>(
    '[aria-label="Scroll grid backward"]',
  )!;
  const forward = host.querySelector<HTMLButtonElement>(
    '[aria-label="Scroll grid forward"]',
  )!;
  expect(back.disabled).toBe(true);
  for (let i = 0; i < 30 && !forward.disabled; i++) forward.click();
  expect(forward.disabled).toBe(true);
  expect(scroll.scrollLeft).toBe(scroll.scrollWidth - scroll.clientWidth);
  expect(host.querySelector(".grid-position")!.textContent).toContain(
    "64 / 64",
  );
  const mode = [
    ...host.querySelectorAll<HTMLButtonElement>(".grid-touch-modes button"),
  ][1]!;
  mode.click();
  const r = cell().getBoundingClientRect();
  pointer(cell(), "pointerdown", r.x + 5, r.y + 5);
  pointer(pane, "pointermove", r.x + 85, r.y + 5);
  pointer(pane, "pointerup", r.x + 85, r.y + 5);
  expect(scroll.scrollLeft).toBeLessThan(
    scroll.scrollWidth - scroll.clientWidth,
  );
  expect(notes()).toHaveLength(0);
  for (let i = 0; i < 30 && !back.disabled; i++) back.click();
  expect(scroll.scrollLeft).toBe(0);
  expect(back.disabled).toBe(true);
});

it("quick pull draws, edge pull resizes, and cancellation discards the hold", async () => {
  const { pane, cell, notes } = await setup();
  const target = cell();
  const r = target.getBoundingClientRect();
  pointer(target, "pointerdown", r.x + 5, r.y + 5);
  pointer(pane, "pointermove", r.x + 40, r.y + 5);
  pointer(pane, "pointerup", r.x + 40, r.y + 5);
  expect(notes()).toHaveLength(1);
  const length = notes()[0]!.length;
  expect(length).toBeGreaterThan(1);
  const edge = pane.querySelector<HTMLElement>(".note-edge")!;
  const e = edge.getBoundingClientRect();
  pointer(edge, "pointerdown", e.x + e.width / 2, e.y + 5);
  pointer(pane, "pointermove", e.x + e.width / 2 + 35, e.y + 5);
  pointer(pane, "pointerup", e.x + e.width / 2 + 35, e.y + 5);
  expect(notes()[0]!.length).toBeGreaterThan(length);
  const before = JSON.stringify(notes());
  pointer(target, "pointerdown", r.x + 5, r.y + 5);
  pointer(pane, "pointercancel", r.x + 5, r.y + 5);
  await wait(400);
  expect(pane.dataset.panReady).toBeUndefined();
  expect(JSON.stringify(notes())).toBe(before);
});

it("trusted touch holds pan over empty cells and notes without changing the document", async () => {
  const { pane, scroll, cell, notes } = await setup();
  const session = cdp();
  const touch = async (type: string, points: { x: number; y: number }[]) => {
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points,
    });
  };
  const target = cell();
  const r = target.getBoundingClientRect();
  const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await touch("touchStart", [p]);
  await wait(400);
  expect(pane.dataset.panReady).toBe("true");
  await touch("touchMove", [{ x: p.x - 80, y: p.y }]);
  await touch("touchEnd", []);
  expect(scroll.scrollLeft).toBeGreaterThan(50);
  expect(notes()).toHaveLength(0);
  const next = cell().getBoundingClientRect();
  const q = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
  await touch("touchStart", [q]);
  await wait(30);
  await touch("touchEnd", []);
  expect(notes()).toHaveLength(1);
  const before = JSON.stringify(notes());
  await touch("touchStart", [q]);
  await wait(400);
  await touch("touchMove", [{ x: q.x + 60, y: q.y }]);
  await touch("touchEnd", []);
  expect(JSON.stringify(notes())).toBe(before);
});

it("navigation controls fit phone, landscape and desktop", async () => {
  const { host } = await setup();
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [844, 390],
    [1440, 900],
  ]) {
    await page.viewport(width!, height!);
    await wait(120);
    const nav = host.querySelector<HTMLElement>(".grid-navigation")!;
    if (width! > 1024) expect(getComputedStyle(nav).display).toBe("none");
    else {
      expect(nav.getBoundingClientRect().right).toBeLessThanOrEqual(width!);
      for (const button of nav.querySelectorAll("button")) {
        expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(
          44,
        );
      }
    }
    await page.screenshot({
      path: `__screenshots__/grid-navigation-${width}.png`,
      element: host,
    });
  }
});
