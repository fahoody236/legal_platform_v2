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

/**
 * `generate` diffs the schema against the snapshot in migrations/meta and never
 * opens a connection; `check` and `up` are likewise offline. Demanding a
 * connection string for those would block generating a migration on a machine —
 * or in a CI job — that has no database at all.
 *
 * Anything else drizzle-kit can be asked to do does connect, so the check stays
 * for those.
 */
const OFFLINE_COMMANDS = new Set(["generate", "check", "up"]);
const command = process.argv[2];

if (!url && !OFFLINE_COMMANDS.has(command ?? "")) {
  throw new Error(`DATABASE_URL must be set to run "drizzle-kit ${command}".`);
}

export default defineConfig({
  // The directory rather than index.ts: drizzle-kit picks up each table file
  // directly, so adding a schema file needs no change here.
  schema: "./src/schema",
  out: "./migrations",
  dialect: "postgresql",
  // Only ever empty for the offline commands above, which do not read it.
  dbCredentials: { url: url ?? "" },
  strict: true,
  verbose: true,
});
