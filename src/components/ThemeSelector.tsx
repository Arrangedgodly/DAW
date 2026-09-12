import { setTheme, theme } from "../state/theme";
import { registerHelp } from "../help/registry";

registerHelp([
  {
    id: "appearance.theme",
    title: "COLOR THEME",
    text: "Switches between light and dark colors. Your choice is saved on this device and applies to the editor, arrangement, and visualizer controls.",
  },
]);

export default function ThemeSelector() {
  return (
    <button
      type="button"
      class="theme-selector"
      data-help="appearance.theme"
      aria-label={`Switch to ${theme() === "dark" ? "light" : "dark"} theme`}
      onClick={() => setTheme(theme() === "dark" ? "light" : "dark")}
      title="Theme is saved on this device"
    >
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="7"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
        <path d="M10 3a7 7 0 0 1 0 14Z" fill="currentColor" />
      </svg>
      <span>{theme() === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
