import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".cache/**",
      "coverage/**",
      "src/infra/db/migrations/**",
      // A dashboard tem toolchain e eslint próprios.
      "dashboard/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { sourceType: "module", globals: { process: "readonly", console: "readonly" } },
  }
);
