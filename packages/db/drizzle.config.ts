import { defineConfig } from "drizzle-kit";

/**
 * Reading the environment here is deliberate and confined to this file. This is
 * a CLI tool, run by a person or by CI, not application code — `src/client.ts`
 * still takes its connection string as an argument so that callers choose which
 * role they connect as.
 *
 * Paths are relative because drizzle-kit resolves them against the working
 * directory, so these scripts must be run from this package. `pnpm --filter`
 * does that.
 */
const url = process.env["DATABASE_URL"];

if (!url) {
  throw new Error("DATABASE_URL must be set to run drizzle-kit.");
}

export default defineConfig({
  // The directory rather than index.ts: drizzle-kit picks up each table file
  // directly, so adding a schema file needs no change here.
  schema: "./src/schema",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
