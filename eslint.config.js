import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "docs", ".impeccable", ".claude"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  {
    files: ["**/*.{ts,tsx}"],
  },
  // Node-side tooling (TH-2 check-bundle gate): plain ESM with node globals.
  {
    files: ["scripts/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  // AudioWorklet globals: the worklet file is plain JS evaluated inside the
  // AudioWorkletGlobalScope (registerProcessor, sampleRate, currentTime, ...).
  {
    files: ["scripts/verify-song-layout.mjs"],
    languageOptions: { globals: { document: "readonly", innerWidth: "readonly" } },
  },
  {
    files: ["src/audio/worklets/*.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
        currentTime: "readonly",
      },
    },
  },
);
