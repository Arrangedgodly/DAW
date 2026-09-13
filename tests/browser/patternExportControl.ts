/** Open the lead pattern's options using the same controls as the app. */
export async function patternExportControl(
  root: Document | HTMLElement,
): Promise<HTMLButtonElement> {
  root
    .querySelector<HTMLButtonElement>('.desktop-page-nav [data-page="song"]')
    ?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const trigger = root.querySelector<HTMLButtonElement>(
    '.rail-row[data-lane="lead"] .rail-tools-trigger',
  );
  if (!trigger) throw new Error("Lead pattern options are missing");
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  for (let i = 0; i < 60; i++) {
    const button = trigger.parentElement?.querySelector<HTMLButtonElement>(
      ".pattern-midi-export",
    );
    if (button && !button.disabled) return button;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Pattern MIDI export did not become available");
}
