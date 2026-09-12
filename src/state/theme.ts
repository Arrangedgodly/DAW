import { createSignal } from "solid-js";

export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "bitbounce.theme.v1";

function initialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

const [theme, setThemeSignal] = createSignal<Theme>(initialTheme());
export { theme };

export function setTheme(value: Theme): void {
  setThemeSignal(value);
  if (typeof document !== "undefined" && document.documentElement)
    document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // The current session can still change theme when storage is unavailable.
  }
}

if (typeof document !== "undefined" && document.documentElement)
  document.documentElement.dataset.theme = theme();
