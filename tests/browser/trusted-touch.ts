import { cdp } from "vitest/browser";

/** Real touch down/up events, including Chromium's compatibility click.
 * synthesizeTapGesture currently delivers pointer/touch events without a
 * click even on a plain native button in our Chromium harness. */
export async function trustedTapAt(
  point: { x: number; y: number },
  count = 1,
): Promise<void> {
  const session = cdp();
  for (let tap = 0; tap < count; tap++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    if (tap + 1 < count)
      await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
