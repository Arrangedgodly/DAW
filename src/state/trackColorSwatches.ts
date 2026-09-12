/** Fixed light / middle / dark choices, shared by the DAW and visualizer. */
export const TRACK_COLOR_SWATCHES = [
  { name: "Red", colors: ["#ffb3b3", "#f05b64", "#a62838"] },
  { name: "Orange", colors: ["#ffd0a3", "#f39449", "#b95620"] },
  { name: "Yellow", colors: ["#fff0a3", "#e7cd4b", "#9c7a19"] },
  { name: "Green", colors: ["#b9e6b0", "#70bd79", "#287849"] },
  { name: "Cyan", colors: ["#ade9e5", "#52c9cc", "#167c88"] },
  { name: "Blue", colors: ["#b2d1ff", "#689eea", "#3159aa"] },
  { name: "Purple", colors: ["#d9c0f5", "#aa82dc", "#7043a5"] },
  { name: "Pink", colors: ["#f7c1dc", "#e980b4", "#aa3e77"] },
  { name: "Brown", colors: ["#ddc2a9", "#ad8565", "#6b4936"] },
  { name: "Gray", colors: ["#e0e5e9", "#98a3ad", "#515e69"] },
] as const;
export const TRACK_COLOR_SHADES = ["Light", "Middle", "Dark"] as const;
