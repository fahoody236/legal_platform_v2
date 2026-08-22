/**
 * Flat ESLint config, scoped to the new apps/ and packages/ tree.
 *
 * The prototype under artifacts/ and lib/ is deliberately not linted: it is
 * being replaced, and a few thousand findings against code on its way out would
 * bury the findings that matter in the code being written.
 *
 * CommonJS because the root package.json declares no "type", so Node — and
 * therefore ESLint — loads a root .js file as CommonJS. Rename to
 * eslint.config.mjs to write this in ESM.
 */
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "artifacts/**",
      "lib/**",
    ],
  },
  {
    // Positive scoping, so anything outside these two trees is out of range
    // whether or not it is also listed above.
    files: ["apps/**/*.{ts,tsx,mts,cts}", "packages/**/*.{ts,tsx,mts,cts}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // Last, so it can switch off the stylistic rules that would otherwise
      // disagree with Prettier.
      prettier,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
  },
);
