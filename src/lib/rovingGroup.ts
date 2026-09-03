/**
 * Roving-group helper (DA-1): make a container's focusable descendants one
 * Tab stop (APG composite widget law). Arrow Left/Right move between the
 * controls, updating tabIndex; Home/End jump to the first/last. The first
 * control is the initial tab stop. Pure DOM — no framework coupling.
 *
 * Not used for grids (the renderer owns its cell roving) or the rail
 * (per-lane tile rows already rove, DES-6).
 */

export interface RovingGroup {
  dispose(): void;
}

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled])";

export function rovingGroup(container: HTMLElement): RovingGroup {
  const focusables = (): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );

  const setRoving = (el: HTMLElement, all: HTMLElement[]) => {
    for (const f of all) f.tabIndex = -1;
    el.tabIndex = 0;
  };

  // Seed: first control carries the tab stop.
  const initial = focusables();
  if (initial[0]) setRoving(initial[0], initial);

  const move = (from: HTMLElement, delta: number): HTMLElement | null => {
    const all = focusables();
    const i = all.indexOf(from);
    if (i < 0 || all.length === 0) return null;
    const next = all[Math.min(Math.max(i + delta, 0), all.length - 1)]!;
    setRoving(next, all);
    next.focus();
    return next;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (!container.contains(target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser combos untouched
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      // Range/select inputs keep native arrow semantics.
      if (isNativeArrowTarget(target)) return;
      e.preventDefault();
      move(target, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      if (isNativeArrowTarget(target)) return;
      e.preventDefault();
      move(target, -1);
    } else if (e.key === "Home" || e.key === "End") {
      if (isNativeArrowTarget(target)) return;
      e.preventDefault();
      const all = focusables();
      const next = all[e.key === "Home" ? 0 : all.length - 1];
      if (next instanceof HTMLElement) {
        setRoving(next, all);
        next.focus();
      }
    }
  };

  const onfocusin = () => {
    // Keep the roving tab stop in sync with actual focus (mouse users).
    const el = document.activeElement;
    if (
      el instanceof HTMLElement &&
      container.contains(el) &&
      el.matches(FOCUSABLE)
    ) {
      setRoving(el, focusables());
    }
  };

  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("focusin", onfocusin);
  return {
    dispose() {
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("focusin", onfocusin);
    },
  };
}

function isNativeArrowTarget(el: HTMLElement): boolean {
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    el.isContentEditable
  );
}
