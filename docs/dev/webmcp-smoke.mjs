import { chromium } from "../../node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const output = new URL("./webmcp-review/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
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
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.BITBOUNCE_URL ?? "http://127.0.0.1:4175/");
    await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
    const api = await page.evaluate(() => {
      const context = document.modelContext ?? navigator.modelContext;
      return {
        available: Boolean(context),
        methods: context
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(context))
          : [],
      };
    });
    await page
      .getByRole("button", { name: "Allow agent access", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: new URL(`before-${viewport.width}.png`, output).pathname.slice(1),
      fullPage: true,
    });
    let execution = null;
    if (api.available) {
      await page
        .getByRole("button", { name: "Allow agent access", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Turn agent access off", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Edit this project", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: new URL(`choose-${viewport.width}.png`, output).pathname.slice(1),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Edit this project", exact: true })
        .click();
      execution = await page.evaluate(async () => {
        const context = document.modelContext ?? navigator.modelContext;
        if (!context.getTools || !context.executeTool)
          return { registered: true, discoveryUnavailable: true };
        const tools = await context.getTools();
        const invoke = async (tool, args) => {
          try {
            return await context.executeTool(tool, args);
          } catch (error) {
            if (!String(error).includes("parse input")) throw error;
            return context.executeTool(tool, JSON.stringify(args));
          }
        };
        const result = await invoke(
          tools.find((tool) => tool.name === "bitbounce_get_project"),
          {},
        );
        const project =
          typeof result === "string" ? JSON.parse(result) : result;
        const edited = await invoke(
          tools.find((tool) => tool.name === "bitbounce_set_tempo"),
          { revision: project.revision, bpm: 132 },
        );
        return {
          toolCount: tools.length,
          beforeBpm: project.transport.bpm,
          edited,
        };
      });
      const restore = page
        .getByRole("button", { name: "Restore before agent", exact: true })
        .first();
      if (execution?.toolCount) {
        await restore.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: new URL(`edited-${viewport.width}.png`, output).pathname.slice(
            1,
          ),
          fullPage: true,
        });
        await restore.click();
        await page
          .getByRole("button", { name: "Allow agent access", exact: true })
          .waitFor();
      }
    }
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    results.push({
      viewport,
      browser: browser.version(),
      api,
      execution,
      layout,
      errors,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  new URL("results.json", output),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
