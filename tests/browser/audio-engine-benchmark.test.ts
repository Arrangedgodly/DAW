import { describe, expect, it } from "vitest";

describe("development FX parity benchmark", () => {
  it("runs its dry, wet, stereo, and full-tail assertions in Chromium", async () => {
    const frame = document.createElement("iframe");
    frame.src = "/audio-engine-benchmark.html?test=1";
    document.body.append(frame);
    try {
      await new Promise<void>((resolve, reject) => {
        frame.addEventListener("load", () => resolve(), { once: true });
        frame.addEventListener("error", () => reject(new Error("Benchmark page failed to load")), { once: true });
      });
      const page = frame.contentDocument;
      const button = page?.querySelector<HTMLButtonElement>("#run");
      const report = page?.querySelector<HTMLElement>("#result");
      if (!button || !report) throw new Error("Benchmark page is missing its run control or report");
      button.click();

      const deadline = performance.now() + 55_000;
      while (performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const current = report.textContent ?? "";
        if (current.startsWith("Benchmark failed:")) throw new Error(current);
        if (current.includes("Settled pass final-output parity")) break;
      }
      const output = report.textContent ?? "";
      expect(output).toContain("Environment: Mozilla/");
      expect(output).toContain("Prime asserted silent");
      expect(output).toContain("Dry wire parity, all");
      expect(output).toContain("Fixed wet ConvolverNode vs el.convolve");
      expect(output).toContain("Fixed full chain (dry 0.75 + wet 0.5)");
      expect(output).toContain("L-only full stereo IR probe");
      expect(output).toContain("R-only full stereo IR probe");
      expect(output).toContain("Production createReverbDevice cold startup");
      expect(output).toContain("Settled production throughput");
      expect(output).toContain("Settled pass final-output parity");
    } finally {
      frame.remove();
    }
  }, 60_000);
});
