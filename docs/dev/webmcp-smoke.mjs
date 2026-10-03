import { chromium } from "../../node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const output = new URL("./webmcp-review/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BITBOUNCE_BROWSER_CHANNEL
    ? { channel: process.env.BITBOUNCE_BROWSER_CHANNEL }
    : {}),
  args: [
    "--enable-blink-features=WebMCP",
    "--enable-experimental-web-platform-features",
  ],
});
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    // Each viewport gets isolated project storage and native registrations.
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let api = null,
      execution = null,
      restored = null,
      layout = null,
      failure = null;
    try {
      await page.goto(process.env.BITBOUNCE_URL ?? "http://127.0.0.1:4175/");
      await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
      api = await page.evaluate(() => {
        const context = document.modelContext ?? navigator.modelContext;
        return {
          available: Boolean(context),
          methods: context
            ? Object.getOwnPropertyNames(Object.getPrototypeOf(context))
            : [],
        };
      });
      await page.screenshot({
        path: fileURLToPath(new URL(`before-${viewport.width}.png`, output)),
        fullPage: true,
      });
      if (!api.available)
        throw new Error(
          "Native WebMCP unavailable; acceptance was not exercised.",
        );
      await page
        .getByText(
          "Agent tools connected. Confirm the current project or a new one in your agent conversation.",
          { exact: true },
        )
        .waitFor();
      execution = await page.evaluate(async () => {
        const context = document.modelContext ?? navigator.modelContext;
        if (!context.getTools || !context.executeTool)
          throw new Error("Native tool discovery/execution unavailable.");
        const tools = await context.getTools();
        const assert = (condition, message) => {
          if (!condition) throw new Error(message);
        };
        let inputFormat = "object";
        const invoke = async (name, args = {}) => {
          const tool = tools.find((tool) => tool.name === `bitbounce_${name}`);
          assert(tool, `Missing tool ${name}`);
          let result;
          try {
            result = await context.executeTool(tool, args);
          } catch (error) {
            if (!String(error).includes("Failed to parse input arguments"))
              throw error;
            inputFormat = "legacy-json-string";
            result = await context.executeTool(tool, JSON.stringify(args));
          }
          return typeof result === "string" ? JSON.parse(result) : result;
        };
        assert(
          tools.filter((t) => t.name.startsWith("bitbounce_")).length === 20,
          "Unexpected tool inventory.",
        );
        const before = await invoke("get_document");
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(before.doc)),
        );
        const beforeDocumentHash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const sounds = await invoke("list_sounds", {
          type: "pitched",
          characters: ["Dark", "Sustained"],
          limit: 2,
        });
        assert(
          sounds.presets.length > 0 &&
            sounds.presets.length <= 2 &&
            sounds.kits.length === 0,
          "Filtered sound discovery failed.",
        );
        const blocked = await invoke("set_tempo", {
          revision: before.revision,
          bpm: 132,
        });
        assert(
          blocked.isError && blocked.error.code === "DESTINATION_REQUIRED",
          "Destination guard failed.",
        );
        const confirmed = await invoke("confirm_edit_target", {
          destination: "current",
          userConfirmed: true,
          revision: before.revision,
        });
        assert(!confirmed.isError, "Destination confirmation failed.");
        const project = await invoke("get_project");
        const invalid = structuredClone(before.doc);
        invalid.lanes[0].mix = { volume: 0.5 };
        const preflight = await invoke("validate_document", {
          document: invalid,
        });
        assert(
          preflight.valid === false &&
            preflight.issues.some((i) => i.includes("lanes.0.mix")),
          "Validation diagnostics were lost.",
        );
        const invalidApply = await invoke("apply_document", {
          revision: project.revision,
          document: invalid,
        });
        assert(
          invalidApply.isError &&
            invalidApply.error.code === "INVALID_DOCUMENT",
          "Invalid document failure was lost.",
        );
        const preview = await invoke("preview_project", {
          revision: project.revision,
          operations: [
            {
              action: "rename_pattern",
              lane: "bass",
              patternId: project.lanes.find((l) => l.id === "bass").patterns[0]
                .id,
              name: "Native smoke",
            },
          ],
        });
        assert(
          preview.previewId && preview.changed,
          "Preview creation failed.",
        );
        assert(
          (await invoke("get_project")).revision === project.revision,
          "Preview mutated the project.",
        );
        const edited = await invoke("apply_preview", {
          revision: project.revision,
          previewId: preview.previewId,
        });
        assert(
          edited.changed && edited.revision === project.revision + 1,
          "Preview apply failed.",
        );
        const stale = await invoke("set_tempo", {
          revision: project.revision,
          bpm: 132,
        });
        assert(
          stale.isError && stale.error.code === "STALE_REVISION",
          "Stale revision failure was lost.",
        );
        return {
          toolCount: tools.length,
          inputFormat,
          beforeDocumentHash,
          beforeName: before.doc.name,
          beforeBpm: before.doc.transport.bpm,
          preflightIssueCount: preflight.issueCount,
          soundCount: sounds.presets.length,
          edited,
          failureCodes: [
            blocked.error.code,
            invalidApply.error.code,
            stale.error.code,
          ],
        };
      });
      const restore = page
        .getByRole("button", { name: "Restore before agent", exact: true })
        .first();
      await restore.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: fileURLToPath(new URL(`edited-${viewport.width}.png`, output)),
        fullPage: true,
      });
      await restore.click();
      await page
        .getByText(
          "Agent tools connected. Confirm the current project or a new one in your agent conversation.",
          { exact: true },
        )
        .waitFor();
      restored = await page.evaluate(async () => {
        const context = document.modelContext ?? navigator.modelContext;
        const tool = (await context.getTools()).find(
          (t) => t.name === "bitbounce_get_document",
        );
        let result;
        try {
          result = await context.executeTool(tool, {});
        } catch (error) {
          if (!String(error).includes("Failed to parse input arguments"))
            throw error;
          result = await context.executeTool(tool, "{}");
        }
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(parsed.doc)),
        );
        return {
          ...parsed,
          documentHash: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        };
      });
      if (
        restored.documentHash !== execution.beforeDocumentHash ||
        restored.doc.name !== execution.beforeName ||
        restored.doc.transport.bpm !== execution.beforeBpm ||
        restored.editTarget !== "awaiting_user_choice"
      )
        throw new Error("Restoration or edit-target reset failed.");
      layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      if (errors.length)
        throw new Error("Page errors during native acceptance.");
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    results.push({
      viewport,
      browser: browser.version(),
      api,
      execution,
      restored: restored
        ? {
            documentHash: restored.documentHash,
            editTarget: restored.editTarget,
            name: restored.doc.name,
            bpm: restored.doc.transport.bpm,
          }
        : null,
      layout,
      errors,
      failure,
      passed: failure === null,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  new URL("results.json", output),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
if (results.length !== 2 || results.some((result) => !result.passed))
  process.exitCode = 1;
