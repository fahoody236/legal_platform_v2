import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createClient } from "./client.js";

/**
 * Applies the tracked migrations. A CLI tool, run by a person or by CI, which is
 * why it reads the environment directly — `client.ts` deliberately does not.
 *
 * This is the one entry point that may legitimately connect as a privileged
 * role: creating tables, policies, and grants is owner work. The application
 * must still connect as the unprivileged role, for the reasons in `client.ts`.
 */
const url = process.env["DATABASE_URL"];

if (!url) {
  console.error("DATABASE_URL must be set to run migrations.");
  process.exit(1);
}

// Resolved from this file rather than the working directory, so the script
// applies the same migrations wherever it is invoked from.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const { db, pool } = createClient(url);

try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Without this the pool keeps the event loop alive and the process hangs.
  await pool.end();
}
