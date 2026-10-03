import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import LaneHeader from "../../src/components/LaneHeader";
import { docStore, setLaneSoundId } from "../../src/state/store";
import { getSession } from "../../src/engine/session";

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.restoreAllMocks();
});
async function mount() {
  setLaneSoundId("bass", "preset-bass-1");
  await vi.waitFor(() =>
    expect(docStore.getState().doc.sampleProvenance).toBeUndefined(),
  );
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <LaneHeader lane="bass" />, host);
  host.querySelector<HTMLButtonElement>(".head-sound-browse")!.click();
}
function button(label: string): HTMLButtonElement {
  const b = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sound-browser button"),
  ).find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!b) throw new Error(`Missing sound browser button: ${label}`);
  return b;
}
function search(query: string) {
  const input = document.querySelector<HTMLInputElement>(
    ".sound-search input",
  )!;
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function settle() {
  await vi.waitFor(() => expect(button("Use sound").disabled).toBe(false), {
    timeout: 10000,
  });
}

describe("sound browser selection flow", () => {
  it("previews real audio without editing, then applies only Use sound", async () => {
    await mount();
    const before = JSON.stringify(docStore.getState().doc);
    search("SUB DROP");
    button("Preview SUB DROP").click();
    await settle();
    expect(JSON.stringify(docStore.getState().doc)).toBe(before);
    button("Use sound").click();
    expect(
      docStore.getState().doc.lanes.find((l) => l.id === "bass")?.presetId,
    ).toBe("preset-bass-13");
    expect(document.querySelector(".sound-browser")).toBeNull();
    expect(document.activeElement).toBe(
      host!.querySelector(".head-sound-browse"),
    );
  });
  it("filters by category and character, keeps favorites separate from document state, and closes without applying", async () => {
    vi.spyOn(getSession(), "previewSound").mockResolvedValue();
    await mount();
    const before = JSON.stringify(docStore.getState().doc);
    const category = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".sound-categories button"),
    ).find((b) => b.textContent?.startsWith("Bells"))!;
    category.click();
    button("Soft").click();
    const rows = Array.from(document.querySelectorAll(".sound-result"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.textContent?.includes("Soft"))).toBe(true);
    const row = rows[0];
    const name = row.querySelector(".sound-result-name")!.textContent!;
    row.querySelector<HTMLButtonElement>(".sound-favorite")!.click();
    row.querySelector<HTMLButtonElement>(".sound-preview")!.click();
    await settle();
    expect(JSON.stringify(docStore.getState().doc)).toBe(before);
    button("Favorites").click();
    expect(document.querySelector(".sound-result-list")?.textContent).toContain(
      name,
    );
    button("Close").click();
    expect(JSON.stringify(docStore.getState().doc)).toBe(before);
  });
  it("reports a failed preview, supports retry, and refuses to apply until it succeeds", async () => {
    const preview = vi
      .spyOn(getSession(), "previewSound")
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValue();
    await mount();
    search("SUB DROP");
    button("Preview SUB DROP").click();
    await vi.waitFor(() =>
      expect(
        document.querySelector(".sound-browser-footer")?.textContent,
      ).toContain("could not play"),
    );
    expect(button("Use sound").disabled).toBe(true);
    button("Preview SUB DROP").click();
    await settle();
    expect(preview).toHaveBeenCalledTimes(2);
    button("Close").click();
  });
});
