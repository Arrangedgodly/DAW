import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "solid-js/web";
import LaneGrid from "../../src/components/LaneGrid";
import {
  addInstrumentLane,
  addNote,
  createFreshProjectDocument,
  docStore,
  loadDocument,
  undo,
} from "../../src/state/store";
import { selectLane, selectPattern } from "../../src/state/selection";
import "../../src/styles/base.css";
import "../../src/styles/lane-header.css";
import "../../src/styles/unit.css";
import "../../src/styles/app.css";
import "../../src/styles/grid.css";
import "../../src/styles/membrane.css";

let cleanup = () => {};
afterEach(() => cleanup());

it.each([1440, 390])(
  "edits the selected clip at %s pixels, protects notes and follows undo",
  async (width) => {
    await page.viewport(width, 844);
    loadDocument(createFreshProjectDocument());
    selectLane("bass");
    const host = document.createElement("div");
    host.className = "app membrane";
    document.body.append(host);
    const dispose = render(() => <LaneGrid lane="bass" />, host);
    cleanup = () => {
      dispose();
      host.remove();
    };
    await page.getByLabelText("Edit clip length").click();
    const field = page.getByRole("spinbutton", { name: "Clip length in bars" });
    await field.fill("3");
    await userEvent.keyboard("{Enter}");
    expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(3);
    await page.getByRole("button", { name: "Extend clip by one bar" }).click();
    expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(4);
    const id = docStore.getState().doc.patterns.bass[0]!.id;
    addNote("bass", id, { degree: 0, start: 48, length: 1 });
    await page.getByRole("button", { name: "Shorten clip by one bar" }).click();
    expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(4);
    expect(host.querySelector(".clip-length-error")?.textContent).toContain(
      "would be cut off",
    );
    undo();
    await page.getByRole("button", { name: "Shorten clip by one bar" }).click();
    expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(3);
    undo();
    expect(
      host.querySelector<HTMLInputElement>(".clip-length input")!.value,
    ).toBe("4");
    await field.fill("2.5");
    await userEvent.keyboard("{Enter}");
    expect(host.querySelector(".clip-length-error")?.textContent).toContain(
      "whole number",
    );
    await userEvent.keyboard("{Escape}");
    expect(
      host.querySelector<HTMLDetailsElement>(".clip-length-wrap")!.open,
    ).toBe(false);
    expect(document.activeElement).toBe(
      host.querySelector(".clip-length-wrap summary"),
    );
    expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(4);
  },
);

it("offers the same length control on an added instrument", async () => {
  await page.viewport(1440, 900);
  loadDocument(createFreshProjectDocument());
  addInstrumentLane("preset-bells-crystal", "extra1");
  const id = docStore.getState().doc.patterns.extra1![0]!.id;
  selectPattern("extra1", id, 0);
  selectLane("extra1");
  const host = document.createElement("div");
  host.className = "app membrane";
  document.body.append(host);
  const dispose = render(() => <LaneGrid lane="extra1" />, host);
  cleanup = () => {
    dispose();
    host.remove();
  };
  await page.getByLabelText("Edit clip length").click();
  const field = page.getByRole("spinbutton", { name: "Clip length in bars" });
  await field.fill("7");
  await userEvent.keyboard("{Enter}");
  expect(docStore.getState().doc.patterns.extra1![0]!.bars).toBe(7);
  expect(docStore.getState().doc.patterns.bass[0]!.bars).toBe(1);
});
