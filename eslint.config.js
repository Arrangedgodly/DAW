import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "docs", ".impeccable"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
  },
  // AudioWorklet globals: the worklet file is plain JS evaluated inside the
  // AudioWorkletGlobalScope (registerProcessor, sampleRate, currentTime, ...).
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
