/**
 * HU-1 tests: detectSupport() against fake windows (each required feature
 * missing, worklet present/absent via constructor prototypes), Safari UA
 * sniff (including Chromium/Edg/FxiOS exclusion), banner selection per tier,
 * and session-persistent (in-memory) dismissal.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { detectSupport, isSafariUA, type WindowLike } from "../src/support/detect";
import {
  bannerFor,
  dismissBanner,
  isBannerDismissed,
  resetDismissedBanners,
} from "../src/support/banners";
import type { SupportReport } from "../src/support/detect";

function fakeWindow(overrides: Partial<WindowLike> = {}): WindowLike {
  const AudioContext = function AudioContext() {};
  const OfflineAudioContext = function OfflineAudioContext() {};
  // Real browsers expose audioWorklet on the constructor prototype.
  AudioContext.prototype.audioWorklet = { addModule: function addModule() {} };
  const base: WindowLike & Record<string, unknown> = {
    AudioContext,
    OfflineAudioContext,
    indexedDB: {},
    isSecureContext: true,
  };
  return { ...base, ...overrides };
}

function stripWorklet(win: WindowLike): WindowLike {
  const ctor = win.AudioContext as { prototype?: Record<string, unknown> } | undefined;
  if (ctor?.prototype) delete ctor.prototype.audioWorklet;
  return win;
}

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("detectSupport (HU-1)", () => {
  it("full tier when every feature is present", () => {
    const report = detectSupport(fakeWindow());
    expect(report.tier).toBe("full");
    expect(report.missing).toEqual([]);
    expect(report.features.audioWorklet).toBe(true);
  });

  it("detects audioWorklet on OfflineAudioContext too", () => {
    const win = fakeWindow();
    // Some engines expose audioWorklet only on OfflineAudioContext.
    (win.OfflineAudioContext as { prototype: Record<string, unknown> }).prototype.audioWorklet =
      { addModule: () => {} };
    const stripped = stripWorklet(win);
    expect(detectSupport(stripped).features.audioWorklet).toBe(true);
  });

  it("degraded-worklet tier when worklet is missing", () => {
    const report = detectSupport(stripWorklet(fakeWindow()));
    expect(report.tier).toBe("degraded-worklet");
    expect(report.features.audioContext).toBe(true);
    expect(report.missing).toEqual([]); // required features still present
  });

  it("unsupported when AudioContext is missing", () => {
    const report = detectSupport(fakeWindow({ AudioContext: undefined }));
    expect(report.tier).toBe("unsupported");
    expect(report.missing).toContain("Web Audio (AudioContext)");
  });

  it("unsupported when OfflineAudioContext is missing", () => {
    const report = detectSupport(fakeWindow({ OfflineAudioContext: undefined }));
    expect(report.tier).toBe("unsupported");
    expect(report.missing).toContain("Offline Audio (OfflineAudioContext)");
  });

  it("unsupported when indexedDB is missing", () => {
    const report = detectSupport(fakeWindow({ indexedDB: undefined }));
    expect(report.tier).toBe("unsupported");
    expect(report.missing).toContain("IndexedDB storage");
  });

  it("unsupported when not a secure context", () => {
    const report = detectSupport(fakeWindow({ isSecureContext: false }));
    expect(report.tier).toBe("unsupported");
    expect(report.missing).toContain("Secure context (HTTPS or localhost)");
  });

  it("worklet without addModule is not worklet-capable", () => {
    const win = fakeWindow();
    (win.AudioContext as { prototype: Record<string, unknown> }).prototype.audioWorklet = {};
    const report = detectSupport(win);
    expect(report.features.audioWorklet).toBe(false);
    expect(report.tier).toBe("degraded-worklet");
  });

  it("native accessor worklet (getter that throws off-instance) counts as present", () => {
    // Real AudioWorklet is an accessor on AudioContext.prototype; reading it
    // through a subclass prototype throws "Illegal invocation" (the frame-
    // budget test subclasses AudioContext exactly like this).
    const NativeCtx = function NativeCtx() {};
    Object.defineProperty(NativeCtx.prototype, "audioWorklet", {
      get(this: unknown) {
        if (!(this instanceof NativeCtx)) throw new TypeError("Illegal invocation");
        return { addModule: () => {} };
      },
    });
    const SubCtx = class SubCtx extends (NativeCtx as unknown as new () => object) {};
    const report = detectSupport(fakeWindow({ AudioContext: SubCtx }));
    expect(report.features.audioWorklet).toBe(true);
    expect(report.tier).toBe("full");
  });
});

describe("isSafariUA (cosmetic sniff)", () => {
  it("matches plain Safari", () => {
    expect(isSafariUA(SAFARI_UA)).toBe(true);
  });
  it("excludes Chrome (contains 'Safari' token but is Chromium)", () => {
    expect(isSafariUA(CHROME_UA)).toBe(false);
  });
  it("excludes Edge, Opera, Firefox-on-iOS", () => {
    expect(isSafariUA(SAFARI_UA.replace("Version/17.4", "Edg/128"))).toBe(false);
    expect(isSafariUA("Mozilla/5.0 ... OPR/113 Safari/537.36")).toBe(false);
    expect(isSafariUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) FxiOS/128 Safari/605.1.15")).toBe(false);
  });
});

describe("bannerFor (HU-1 render conditions)", () => {
  it("unsupported → CAN'T RUN banner listing missing features", () => {
    const model = bannerFor(detectSupport(fakeWindow({ indexedDB: undefined })), CHROME_UA);
    expect(model?.kind).toBe("unsupported");
    expect(model?.title).toBe("THIS BROWSER CAN'T RUN BITBOUNCE");
    expect(model?.body).toContain("IndexedDB storage");
  });

  it("degraded-worklet → NO SOUND banner stating honestly there is no fallback engine", () => {
    const model = bannerFor(detectSupport(stripWorklet(fakeWindow())), CHROME_UA);
    expect(model?.kind).toBe("degraded-worklet");
    expect(model?.title).toBe("NO SOUND IN THIS BROWSER");
    expect(model?.body).toContain("no fallback engine yet");
    expect(model?.body).toContain("editing and saving still work");
  });

  it("full tier + Safari UA → experimental banner", () => {
    const model = bannerFor(detectSupport(fakeWindow()), SAFARI_UA);
    expect(model?.kind).toBe("safari");
    expect(model?.title).toBe("SAFARI SUPPORT IS EXPERIMENTAL — CHROME RECOMMENDED");
  });

  it("full tier + Chromium UA → no banner", () => {
    expect(bannerFor(detectSupport(fakeWindow()), CHROME_UA)).toBeNull();
  });

  it("unsupported outranks the Safari warning", () => {
    const model = bannerFor(
      detectSupport(fakeWindow({ AudioContext: undefined })),
      SAFARI_UA,
    );
    expect(model?.kind).toBe("unsupported");
  });
});

describe("banner dismissal (session, in-memory)", () => {
  beforeEach(() => resetDismissedBanners());

  it("persists for the session after dismiss", () => {
    const report: SupportReport = detectSupport(fakeWindow());
    const kind = bannerFor(report, SAFARI_UA)!.kind;
    expect(isBannerDismissed(kind)).toBe(false);
    dismissBanner(kind);
    expect(isBannerDismissed(kind)).toBe(true);
    // still dismissed later in the same session (no re-show logic exists)
    expect(isBannerDismissed(kind)).toBe(true);
  });

  it("dismissing one kind does not dismiss another", () => {
    dismissBanner("safari");
    expect(isBannerDismissed("unsupported")).toBe(false);
    expect(isBannerDismissed("degraded-worklet")).toBe(false);
  });

  it("reset restores banners (reload semantics)", () => {
    dismissBanner("unsupported");
    resetDismissedBanners();
    expect(isBannerDismissed("unsupported")).toBe(false);
  });
});
