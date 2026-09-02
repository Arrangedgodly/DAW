/**
 * HU-1 — banner selection + session dismissal.
 *
 * Pure selection: `bannerFor(report, userAgent)` maps a support report (plus
 * the cosmetic Safari UA sniff) to at most one banner model. The Solid
 * component (Banner.tsx) renders whatever this returns and consults the
 * dismissal store, so every render condition is unit-testable in node
 * without a DOM.
 *
 * Dismissal is IN-MEMORY ONLY (a module-level Set, survives for the session,
 * resets on reload). Why: v0 has no settings storage — the document store is
 * the only persisted state and project files must not carry UI prefs.
 * Recorded in docs/dev/browser-support.md.
 */

import { isSafariUA, type SupportReport } from "./detect";

export type BannerKind = "unsupported" | "safari" | "degraded-worklet";

export interface BannerModel {
  readonly kind: BannerKind;
  /** In-world headline (Silkscreen label style, uppercase by convention). */
  readonly title: string;
  /** Honest explanation of exactly what does/doesn't work. */
  readonly body: string;
}

export function bannerFor(report: SupportReport, userAgent: string): BannerModel | null {
  if (report.tier === "unsupported") {
    return {
      kind: "unsupported",
      title: "THIS BROWSER CAN'T RUN BITBOUNCE",
      body:
        report.missing.length > 0
          ? `Missing: ${report.missing.join(", ")}. Chrome or Edge on desktop is recommended.`
          : "Missing required browser features. Chrome or Edge on desktop is recommended.",
    };
  }
  if (report.tier === "degraded-worklet") {
    return {
      kind: "degraded-worklet",
      title: "NO SOUND IN THIS BROWSER",
      body:
        "Web Audio works but AudioWorklet doesn't, and Bitbounce's voice engine " +
        "needs it — there is no fallback engine yet, so nothing will sound " +
        "(editing and saving still work). Chrome or Edge on desktop is recommended.",
    };
  }
  // full tier — only the cosmetic Safari warn-and-attempt remains
  if (isSafariUA(userAgent)) {
    return {
      kind: "safari",
      title: "SAFARI SUPPORT IS EXPERIMENTAL — CHROME RECOMMENDED",
      body:
        "Bitbounce targets Chromium first. Safari may work; if something " +
        "misbehaves, switch to Chrome or Edge.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session-dismissal store (in-memory; see header comment for why)
// ---------------------------------------------------------------------------

const dismissed = new Set<BannerKind>();

export function dismissBanner(kind: BannerKind): void {
  dismissed.add(kind);
}

/** Test seam: reset session dismissals between unit tests. */
export function resetDismissedBanners(): void {
  dismissed.clear();
}

export function isBannerDismissed(kind: BannerKind): boolean {
  return dismissed.has(kind);
}
