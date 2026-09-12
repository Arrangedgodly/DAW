import { beforeEach, onTestFailed } from "vitest";
import { page } from "vitest/browser";

// Full scenario titles can exceed filesystem filename limits. The stable
// task id is short and unique; log the mapping so CI artifacts remain useful.
beforeEach(() => {
  onTestFailed(async ({ task }) => {
    for (const error of task.result?.errors ?? [])
      console.error(`[failure detail] ${task.name}: ${error.message}`);
    const path = `__screenshots__/failures/${task.id}.png`;
    try {
      await page.screenshot({ path, element: document.documentElement });
      console.info(`[failure screenshot] ${task.name}: ${path}`);
    } catch (error) {
      console.warn(`[failure screenshot] ${task.name}:`, error);
    }
  });
});
