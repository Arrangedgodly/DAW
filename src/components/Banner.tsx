/**
 * HU-1 — support banners: renders at most one boot-time banner derived from
 * the pure `bannerFor` selection (detect.ts + banners.ts). Banners are
 * role=alert, keyboard-dismissible (button + Escape), styled in-world.
 *
 * NO LAYOUT SHIFT: the banner renders as a fixed overlay strip (position:
 * fixed, top), so appearing/disappearing never reflows the stage — a
 * reserved layout slot is unnecessary by construction (Hulk: degradation
 * must be visible without breaking what still works).
 */

import { Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  bannerFor,
  dismissBanner,
  isBannerDismissed,
} from "../support/banners";
import { detectSupport } from "../support/detect";
import { registerHelp } from "../help/registry";
import "../styles/banner.css";

// HP-2 coverage: the support banner's dismiss is an interactive control
// (I2-6 colocated law) — failure chrome explains itself like everything else.
registerHelp([
  {
    id: "banner.dismiss",
    title: "DISMISS BANNER",
    text: "Hides this browser-support notice for the session (Escape works too). Whatever the notice says still stands — the app keeps running on what does work.",
  },
]);

const DISMISS_LABEL: Record<string, string> = {
  unsupported: "Dismiss unsupported-browser banner",
  "degraded-worklet": "Dismiss no-sound banner",
  safari: "Dismiss Safari experimental banner",
};

export default function SupportBanners() {
  const [dismissedKinds, setDismissedKinds] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const refresh = () => setDismissedKinds(new Set(isBannerDismissedSet()));

  const report = detectSupport(globalThis.window);
  const model = bannerFor(report, globalThis.navigator?.userAgent ?? "");

  const dismiss = () => {
    if (!model) return;
    dismissBanner(model.kind);
    refresh();
  };

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={model && !dismissedKinds().has(model.kind)}>
      <div class={`support-banner support-banner-${model!.kind}`} role="alert">
        <div class="support-banner-copy">
          <p class="support-banner-title">{model!.title}</p>
          <p class="support-banner-body">{model!.body}</p>
        </div>
        <button
          type="button"
          class="support-banner-dismiss"
          data-help="banner.dismiss"
          aria-label={DISMISS_LABEL[model!.kind]}
          onClick={dismiss}
        >
          ✕<span class="sr-only"> DISMISS</span>
        </button>
      </div>
    </Show>
  );
}

function isBannerDismissedSet(): Set<string> {
  // Snapshot the session-dismissal store for the reactive signal.
  const all = ["unsupported", "degraded-worklet", "safari"] as const;
  return new Set(all.filter((kind) => isBannerDismissed(kind)));
}
