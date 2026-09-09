import { describe, it } from "vitest";
import { page } from "vitest/browser";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

async function bootIframe(w: number, h: number) {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  const iframe = document.createElement("iframe");
  iframe.style.width = `${w}px`;
  iframe.style.height = `${h}px`;
  document.body.append(iframe);
  const win = iframe.contentWindow!;
  await new Promise<void>((resolve) => {
    const req = win.indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  const doc0 = iframe.contentDocument!;
  doc0.open();
  doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}"/>
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
  doc0.close();
  const poll = (cond: () => boolean, ms: number, what: string) =>
    new Promise<void>((resolve, reject) => {
      const t0 = performance.now();
      const check = () => {
        if (cond()) return resolve();
        if (performance.now() - t0 > ms) return reject(new Error(what));
        setTimeout(check, 50);
      };
      check();
    });
  const idoc = () => iframe.contentDocument!;
  await poll(() => !!idoc().querySelector(".booth"), 15000, "boot");
  await poll(
    () => idoc().querySelectorAll(".rail-tile").length >= 2,
    8000,
    "demo tiles",
  );
  await new Promise((r) => setTimeout(r, 600));
  return iframe;
}

describe("RC-1 evidence shots", () => {
  it("1440x900 equal windows", { timeout: 90000 }, async () => {
    await page.viewport(1440, 900);
    const iframe = await bootIframe(1440, 900);
    try {
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({
        path: "/Users/arrangedgodly/Documents/Projects/daw/.impeccable/review/rc1-equal-windows-1440x900.png",
      });
    } finally {
      iframe.remove();
    }
  });

  it("390x844 phone lead", { timeout: 90000 }, async () => {
    await page.viewport(390, 844);
    const iframe = await bootIframe(390, 844);
    try {
      const idoc = () => iframe.contentDocument!;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("phone stage")), 8000);
        const check = () => {
          if (idoc().querySelector(".app")?.getAttribute("data-stage") === "phone") {
            clearTimeout(t);
            resolve();
          } else setTimeout(check, 50);
        };
        check();
      });
      (idoc().querySelector('.lane-switch-tab[data-lane="lead"]') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 700));
      await page.screenshot({
        path: "/Users/arrangedgodly/Documents/Projects/daw/.impeccable/review/rc1-phone-lead-oct-390x844.png",
      });
    } finally {
      iframe.remove();
    }
  });
});

describe("FV-1 evidence shots (full-viewport densification)", () => {
  // The three gate viewports; at 1440/1920 a 4-bar LEAD pattern is appended
  // first (the global `b` ladder — LL-1) so the shot shows the wider quadrants buying
  // more visible columns — the utilization gate's densification half.
  const shots: Array<{ w: number; h: number; fourBar: boolean }> = [
    { w: 1280, h: 800, fourBar: false },
    { w: 1440, h: 900, fourBar: true },
    { w: 1920, h: 1080, fourBar: true },
  ];

  for (const { w, h, fourBar } of shots) {
    it(`${w}x${h}${fourBar ? " + 4-bar lead" : ""}`, { timeout: 90000 }, async () => {
      await page.viewport(w, h);
      const iframe = await bootIframe(w, h);
      try {
        const idoc = () => iframe.contentDocument!;
        if (fourBar) {
          // LL-1 journey delta: +4B retired with the LENGTH stepper — the
          // honest path is select the LEAD quadrant then the global `b`
          // ladder on its selected pattern.
          (idoc().querySelector(
            '.lane-floor[data-lane="lead"]',
          ) as HTMLElement).click();
          await new Promise((r) => setTimeout(r, 200));
          for (const k of ["b", "b"]) {
            idoc().body.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: k,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
          await new Promise((r) => setTimeout(r, 800));
        }
        await new Promise((r) => setTimeout(r, 400));
        await page.screenshot({
          path: `/Users/arrangedgodly/Documents/Projects/daw/.impeccable/review/fv1-${w}x${h}${fourBar ? "-4bar" : ""}.png`,
        });
      } finally {
        iframe.remove();
        await new Promise((r) => setTimeout(r, 300));
      }
    });
  }
});
