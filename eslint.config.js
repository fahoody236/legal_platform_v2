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

/**
 * The repository boundary.
 *
 * Tenant scoping is an invariant, not a filter someone remembers to add. It
 * holds because every read and write goes through a repository function that
 * takes the transaction from `withTenant()` — a handle that already carries the
 * tenant context the row-level security policies test against. Code that
 * imports a table and builds its own query is code that can leave that path,
 * and the failure is silent: the query looks correct and returns whatever the
 * connection happens to be scoped to.
 */
const REPOSITORY_BOUNDARY = {
  patterns: [
    {
      group: [
        "**/schema",
        "**/schema/**",
        "@legal/db/schema",
        "@legal/db/schema/**",
      ],
      message:
        "Schema tables are private to packages/db. Use a repository from packages/db/src/repositories/ — it takes the transaction from withTenant(), so a query cannot escape the tenant boundary.",
    },
    {
      group: [
        "drizzle-orm/node-postgres",
        "drizzle-orm/node-postgres/**",
        "pg",
      ],
      message:
        "Database clients are built only in packages/db/src/client.ts. A client constructed elsewhere is a connection nobody scoped with withTenant().",
    },
  ],
};

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
    rules: {
      "no-restricted-imports": ["error", REPOSITORY_BOUNDARY],
    },
  },

  // Exemptions. Later objects win in flat config, so this must stay last.
  //
  // Each entry is a place that legitimately sits on the database side of the
  // boundary rather than the application side of it. The list is short by
  // design: every addition is one more file that can query a table directly,
  // so it should be argued for, not assumed.
  {
    files: [
      // Defines the boundary — these are the functions everyone else calls.
      "packages/db/src/repositories/**/*.ts",
      // Declares the tables in the first place.
      "packages/db/src/schema/**/*.ts",
      // The single sanctioned place a client is constructed.
      "packages/db/src/client.ts",
      // Migration tooling, which runs as a privileged role by design.
      "packages/db/src/migrate.ts",
      "packages/db/drizzle.config.ts",
      // Tests must reach past the boundary to prove the boundary holds: the
      // isolation suite seeds fixtures and verifies rejected writes through a
      // privileged connection that no application code may have.
      "**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
